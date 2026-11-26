/**
 * agents/OSSShelfAgent.ts
 * OSSshelf 会话 Agent（Cloudflare Agents SDK / Durable Object）
 *
 * 职责:
 * - 承载单个会话的持久化消息（DO SQLite）
 * - 通过 AI SDK 执行流式推理与工具调用
 * - 断线续传、多端同步、写操作审批
 *
 * 身份: 实例名固定为 `${userId}:${sessionId}`，由 onBeforeConnect 校验后注入请求头。
 *
 * 数据一致性约定:
 * - DO 是消息事实源；D1 ai_chat_messages 仅作审计镜像，必须复用同一条 message.id
 * - 消息时间/中断标记写入 UIMessage.metadata，前端直接读取，避免每次渲染重新造时间
 */

import { AIChatAgent, type ChatResponseResult, type OnChatMessageOptions } from '@cloudflare/ai-chat';
import { convertToModelMessages, pruneMessages, stepCountIs, streamText } from 'ai';
import type { UIMessage } from 'ai';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Connection, ConnectionContext } from 'agents';
import type { Env } from '../types/env';
import { getVerifiedIdentity } from './auth';
import { getDb, aiChatMessages, aiChatSessions, files } from '../db';
import { resolveModelRuntime, buildProviderOptions } from '../lib/ai/modelRuntime';
import { buildAgentTools } from '../lib/ai/toolAdapter';
import {
  AI_AGENT_DEFAULTS,
  AI_MODEL_DEFAULTS,
  AI_UI_DEFAULTS,
  AI_REQUEST_DEFAULTS,
  getAiConfigNumber,
} from '../lib/ai/aiConfigService';
import { AGENT_SYSTEM_PROMPT } from '../lib/ai/prompts/agentSystem';
import { AgentMemory } from '../lib/ai/agentMemory';
import { recordUsage, reserveAiQuota, type QuotaReservation } from '../lib/ai/usage';
import { mapAiError } from '../lib/ai/aiErrors';
import { estimateTokens } from '../lib/ai/utils';
import {
  allocateContext,
  estimateMessageTokens,
  limitSection,
  loadContextBudget,
  trimMessagesByBudget,
} from '../lib/ai/contextBuilder';
import { buildTaskContext } from '../lib/ai/planRuntime';
import { logger } from '@osshelf/shared';

export interface OSSshelfAgentState {
  userId: string;
  sessionId: string;
  modelId?: string;
  /** 已做记忆提取的消息数量，用于节流，避免每轮都调用一次模型 */
  memoryExtractedMessageCount?: number;
}

/** 单条消息的引用文件（前端刷新后仍需显示名称，不能只存 id） */
interface MentionedFileMeta {
  id: string;
  name: string;
}

interface MessageUsageMeta {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

interface MessageMetadata {
  createdAt?: string;
  aborted?: boolean;
  /** ai_models 行 id（会话级模型选择用它，不是供应商的 model key） */
  modelId?: string;
  modelName?: string;
  provider?: string;
  usage?: MessageUsageMeta;
  toolCallCount?: number;
  latencyMs?: number;
  mentionedFiles?: MentionedFileMeta[];
}

const MAX_MENTIONED_FILES_META = 20;

/** UIMessage 的 metadata 在 SDK 里是 unknown，内部统一按 MessageMetadata 读写 */
type AgentUIMessage = UIMessage & { metadata?: MessageMetadata };

interface PendingUsage {
  userId: string;
  sessionId: string;
  requestId?: string;
  provider: string;
  modelId: string;
  /** ai_models 行 id，会话行 model_id 用它回显 */
  modelConfigId: string;
  modelName: string;
  startedAt: number;
  inputTokensEstimate: number;
}

const QUOTA_REASON_MESSAGE: Record<string, string> = {
  rate_limit: 'AI 请求过于频繁，请稍后再试',
  request_quota: '今日 AI 调用次数已达上限',
  token_quota: '今日 AI Token 配额已用完',
};

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function getReasoningText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'reasoning'; text: string } => part.type === 'reasoning')
    .map((part) => part.text)
    .join('');
}

function readMetadata(message: UIMessage): MessageMetadata {
  const raw = message.metadata;
  return raw && typeof raw === 'object' ? (raw as MessageMetadata) : {};
}

/**
 * mentioned_files 列兼容两种历史格式：
 * - 旧格式：`["file-id", ...]`（只有 id，名称需要回查 files 表）
 * - 新格式：`[{ id, name }, ...]`
 */
function parseMentionedFiles(raw: string | null | undefined): MentionedFileMeta[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const files: MentionedFileMeta[] = [];
    const seen = new Set<string>();
    for (const item of parsed.slice(0, MAX_MENTIONED_FILES_META)) {
      if (typeof item === 'string') {
        if (item && !seen.has(item)) {
          seen.add(item);
          files.push({ id: item, name: '' });
        }
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const id = (item as { id?: unknown }).id;
      const name = (item as { name?: unknown }).name;
      if (typeof id !== 'string' || !id || seen.has(id)) continue;
      seen.add(id);
      files.push({ id, name: typeof name === 'string' ? name : '' });
    }
    return files;
  } catch {
    return [];
  }
}

export class OSSShelfAgent extends AIChatAgent<Env, OSSshelfAgentState> {
  initialState: OSSshelfAgentState = { userId: '', sessionId: '' };

  maxPersistedMessages: number = AI_AGENT_DEFAULTS.maxPersistedMessages;
  messageConcurrency = 'queue' as const;
  chatStreamStallTimeoutMs: number = AI_AGENT_DEFAULTS.streamStallTimeoutMs;

  /**
   * 本轮请求的待记账信息。
   * 正常结束由 onFinish 用真实 usage 记账并清空；中断/异常时 onFinish 不触发，
   * 由 onChatResponse 用估算值兜底记账，避免"点停止即免费"。
   */
  private pendingUsage: PendingUsage | null = null;
  /** 本轮消息的配额预扣；模型调用完成后结算，异常时回滚 */
  private pendingQuota: QuotaReservation | null = null;

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const { userId, sessionId } = getVerifiedIdentity(ctx.request);

    if (!userId || !sessionId) {
      connection.close(4001, 'Unauthorized');
      return;
    }

    const expectedName = `${userId}:${sessionId}`;
    if (this.ctx.id.name !== expectedName) {
      connection.close(4001, 'Identity mismatch');
      return;
    }

    if (!this.state.userId) {
      this.setState({ userId, sessionId, memoryExtractedMessageCount: 0 });
    }

    // 类字段在构造时无法 await 配置；连接建立时同步一次，回种与后续持久化都按配置上限
    try {
      const [persistedMax, stallTimeout] = await Promise.all([
        getAiConfigNumber(this.env, 'ai.agent.max_persisted_messages', AI_AGENT_DEFAULTS.maxPersistedMessages),
        getAiConfigNumber(this.env, 'ai.agent.stream_stall_timeout_ms', AI_AGENT_DEFAULTS.streamStallTimeoutMs),
      ]);
      this.maxPersistedMessages = Math.max(20, Math.floor(persistedMax));
      this.chatStreamStallTimeoutMs = Math.max(30_000, Math.floor(stallTimeout));
    } catch {
      // 配置读取失败时沿用注册表默认值
    }

    await super.onConnect(connection, ctx);

    // 旧会话消息只存在于 D1 审计表，DO 首次唤醒时补种一次。
    // 必须在 super.onConnect 之后执行，persistMessages 的广播才能到达当前连接。
    if (this.messages.length === 0) {
      await this.seedFromAudit(sessionId);
    }
  }

  /** 删除会话时由 REST 调用：清空 DO 内的消息，避免再次进入时"复活"旧对话 */
  async resetConversation(): Promise<void> {
    try {
      await this.persistMessages([], undefined, { _deleteStaleRows: true });
      this.messages = [];
    } catch (error) {
      logger.error('Agent', 'resetConversation failed', { sessionId: this.state.sessionId }, error);
      this.messages = [];
    }
  }

  private async seedFromAudit(sessionId: string): Promise<void> {
    try {
      const db = getDb(this.env.DB);
      const rows = await db
        .select()
        .from(aiChatMessages)
        .where(eq(aiChatMessages.sessionId, sessionId))
        .orderBy(desc(aiChatMessages.createdAt))
        .limit(this.maxPersistedMessages)
        .all();
      rows.reverse();

      const history = rows
        .filter((row) => row.role === 'user' || row.content.trim().length > 0 || row.toolCalls)
        .map((row) => {
          const parts: UIMessage['parts'] = [];
          const metadata: MessageMetadata = { createdAt: row.createdAt };

          // 历史消息也要带上模型/用量/引用文件，否则刷新后气泡底部信息与引用卡片全部丢失
          const usageInput = row.inputTokens ?? 0;
          const usageOutput = row.outputTokens ?? 0;
          if (usageInput > 0 || usageOutput > 0) {
            metadata.usage = {
              inputTokens: usageInput,
              outputTokens: usageOutput,
              totalTokens: usageInput + usageOutput,
            };
          }
          if (row.modelUsed) metadata.modelName = row.modelUsed;
          const mentioned = parseMentionedFiles(row.mentionedFiles);
          if (mentioned.length > 0) metadata.mentionedFiles = mentioned;

          if (row.reasoning) parts.push({ type: 'reasoning', text: row.reasoning } as UIMessage['parts'][number]);

          if (row.content) parts.push({ type: 'text', text: row.content } as UIMessage['parts'][number]);

          // 还原工具调用，避免历史会话丢失工具卡片
          if (row.toolCalls) {
            try {
              const calls = JSON.parse(row.toolCalls) as Array<{
                toolName?: string;
                toolCallId?: string;
                input?: unknown;
                args?: unknown;
                output?: unknown;
                result?: unknown;
              }>;
              for (const call of calls) {
                const name = call.toolName;
                if (!name) continue;
                parts.push({
                  type: `tool-${name}`,
                  toolCallId: call.toolCallId ?? `${row.id}-${parts.length}`,
                  state: 'output-available',
                  input: call.input ?? call.args ?? {},
                  output: call.output ?? call.result ?? null,
                } as unknown as UIMessage['parts'][number]);
              }
            } catch {
              // 审计数据损坏时只恢复文本
            }
          }

          if (row.aborted) metadata.aborted = true;

          return {
            id: row.id,
            role: row.role === 'user' ? ('user' as const) : ('assistant' as const),
            metadata,
            parts,
          } as AgentUIMessage & { metadata: MessageMetadata };
        })
        .filter((message) => message.parts.length > 0);

      // 旧格式只存了 id，这里一次性回查文件名，避免历史气泡显示 "文件"
      const missingNames = new Set<string>();
      for (const message of history) {
        for (const file of message.metadata.mentionedFiles ?? []) {
          if (!file.name) missingNames.add(file.id);
        }
      }
      if (missingNames.size > 0) {
        try {
          const resolved = await db
            .select({ id: files.id, name: files.name })
            .from(files)
            .where(inArray(files.id, [...missingNames]))
            .all();
          const nameById = new Map(resolved.map((row) => [row.id, row.name]));
          for (const message of history) {
            for (const file of message.metadata.mentionedFiles ?? []) {
              if (!file.name) file.name = nameById.get(file.id) ?? '已删除文件';
            }
          }
        } catch (error) {
          for (const message of history) {
            for (const file of message.metadata.mentionedFiles ?? []) {
              if (!file.name) file.name = '文件';
            }
          }
          logger.warn('Agent', 'Failed to resolve mentioned file names', { sessionId }, error);
        }
      }

      if (history.length === 0) return;

      // persistMessages 以当前 this.messages 作为 prior 做增量，必须先写库再赋值，
      // 否则会被判定为"无变化"而跳过 SQLite 持久化
      await this.persistMessages(history);
      this.messages = history;
    } catch (error) {
      logger.error('Agent', 'Failed to seed history from D1', { sessionId }, error);
    }
  }

  /** 拼接本次请求的运行时上下文：当前文件夹 + 用户引用文件 */
  private async buildContextSection(options?: OnChatMessageOptions, maxFiles: number = AI_AGENT_DEFAULTS.maxContextFiles): Promise<string> {
    const contextFileIds = Array.isArray(options?.body?.contextFileIds)
      ? (options?.body?.contextFileIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const contextFolderId =
      typeof options?.body?.contextFolderId === 'string' ? (options.body.contextFolderId as string) : '';

    if (contextFileIds.length === 0 && !contextFolderId) return '';

    try {
      const db = getDb(this.env.DB);
      const ids = [...new Set([...contextFileIds.slice(0, maxFiles), contextFolderId].filter(Boolean))];
      if (ids.length === 0) return '';

      const rows = await db
        .select({
          id: files.id,
          name: files.name,
          mimeType: files.mimeType,
          size: files.size,
          isFolder: files.isFolder,
        })
        .from(files)
        .where(and(eq(files.userId, this.state.userId), inArray(files.id, ids), isNull(files.deletedAt)))
        .all();

      const folder = contextFolderId ? rows.find((row) => row.id === contextFolderId && row.isFolder) : undefined;
      const refs = rows.filter((row) => !row.isFolder && contextFileIds.includes(row.id));

      if (!folder && refs.length === 0) return '';

      const lines = ['## 本次对话上下文'];
      if (folder) lines.push(`当前文件夹：${folder.name} (id: ${folder.id})，用户说"这里/当前目录"时指向它`);
      if (refs.length > 0) {
        lines.push('用户引用文件（优先处理）：');
        for (const file of refs) {
          lines.push(`- ${file.name} (id: ${file.id}, ${file.mimeType ?? '未知类型'}, ${file.size} bytes)`);
        }
      }
      return lines.join('\n');
    } catch (error) {
      logger.warn('Agent', 'Failed to build context section', { sessionId: this.state.sessionId }, error);
      return '';
    }
  }

  /** 跨会话语义记忆召回 */
  private async buildMemorySection(query: string): Promise<string> {
    if (!query.trim()) return '';
    try {
      const memory = new AgentMemory(this.env);
      const recalled = await memory.recallMemories(this.state.userId, query);
      return recalled ? `## 跨会话记忆\n${recalled.replace(/^\s*\[历史记忆\]\s*/m, '')}` : '';
    } catch (error) {
      logger.warn('Agent', 'Memory recall failed', { userId: this.state.userId }, error);
      return '';
    }
  }

  async onChatMessage(onFinish: Parameters<AIChatAgent['onChatMessage']>[0], options?: OnChatMessageOptions) {
    const userId = this.state.userId;
    const sessionId = this.state.sessionId;

    if (!userId || !sessionId) {
      return new Response(JSON.stringify({ error: 'AI 会话身份校验失败', code: 'AI_UNAUTHORIZED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ticket 只在建立连接时校验一次，会话期间每条消息都必须重新执行原子配额预扣
    const lastUserText = [...this.messages].reverse().find((message) => message.role === 'user');
    const lastUserQuery = lastUserText ? getMessageText(lastUserText) : '';

    // 输入长度上限来自 ai.ui.max_query_length（前端同源），超限直接拒绝，不占用配额
    const maxQueryLength = await getAiConfigNumber(this.env, 'ai.ui.max_query_length', AI_UI_DEFAULTS.maxQueryLength);
    if (lastUserQuery.length > maxQueryLength) {
      return new Response(
        JSON.stringify({
          error: `消息长度不能超过 ${maxQueryLength} 字符，当前 ${lastUserQuery.length} 字符`,
          code: 'AI_INPUT_TOO_LONG',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const estimatedInput =
      estimateTokens(AGENT_SYSTEM_PROMPT) +
      this.messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    const quota = await reserveAiQuota(this.env, userId, { estimatedTokens: estimatedInput });
    if (!quota.allowed || !quota.reservation) {
      const decision = quota.decision;
      const message = QUOTA_REASON_MESSAGE[decision.reason ?? 'rate_limit'] ?? 'AI 配额不足';
      return new Response(
        JSON.stringify({
          error: message,
          code: decision.reason === 'rate_limit' ? 'AI_RATE_LIMIT' : 'AI_QUOTA_EXCEEDED',
          quota: {
            usedTokens: decision.usedTokens,
            tokenLimit: decision.tokenLimit,
            usedRequests: decision.usedRequests,
            requestLimit: decision.requestLimit,
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    this.pendingQuota = quota.reservation;

    try {
      const requestedModelId =
        typeof options?.body?.modelId === 'string' ? (options.body.modelId as string) : undefined;
      // 切换模型时把"上一轮用的是别的模型"显式注入 system：新模型实例没有这层记忆，
      // 不说明容易把已有结论当新问题重新问一遍
      const previousModelId = this.state.modelId;

      if (requestedModelId && requestedModelId !== this.state.modelId) {
        this.setState({ ...this.state, modelId: requestedModelId });
      }

      // 单一预算源：总量来自 ai.agent.max_context_tokens，各层比例来自注册表
      const [budget, maxSteps, maxRetries, thinkingBudget] = await Promise.all([
        loadContextBudget(this.env),
        getAiConfigNumber(this.env, 'ai.agent.max_steps', AI_AGENT_DEFAULTS.maxSteps),
        getAiConfigNumber(this.env, 'ai.request.max_retries', AI_REQUEST_DEFAULTS.maxRetries),
        getAiConfigNumber(this.env, 'ai.model.anthropic_thinking_budget', AI_MODEL_DEFAULTS.anthropicThinkingBudget),
      ]);

      const [{ model, config }, tools, contextSection, memorySection, taskSection] = await Promise.all([
        resolveModelRuntime(this.env, userId, requestedModelId ?? this.state.modelId),
        buildAgentTools(this.env, userId, { query: lastUserQuery, sessionId }),
        this.buildContextSection(options, budget.maxContextFiles),
        this.buildMemorySection(lastUserQuery),
        buildTaskContext(this.env, userId, sessionId),
      ]);

      const allocation = allocateContext(budget);
      const modelSwitchSection =
        previousModelId && config.id !== previousModelId
          ? `## 模型切换\n本会话此前由另一个模型回复，本轮已切换到「${config.name}」。请延续已有对话上下文与结论继续，不要要求用户重复背景。`
          : '';
      const system = [
        AGENT_SYSTEM_PROMPT,
        modelSwitchSection,
        limitSection(taskSection, allocation.taskStateTokens),
        limitSection(contextSection, allocation.assetTokens),
        memorySection,
      ]
        .filter(Boolean)
        .join('\n\n');

      // 先按 token 预算裁剪 UIMessage 历史，再转成 ModelMessage 并做 tool/reasoning 剪枝
      const prunedUiMessages = trimMessagesByBudget(
        this.messages,
        allocation.historyTokens,
        budget.minKeepMessages
      );
      const messages = pruneMessages({
        messages: await convertToModelMessages(prunedUiMessages),
        reasoning: 'before-last-message',
        toolCalls: 'before-last-2-messages',
      });

      const startedAt = Date.now();
      const db = getDb(this.env.DB);

      // 记录本轮的估算输入成本：中断时无法拿到 provider usage，用该值兜底
      this.pendingUsage = {
        userId,
        sessionId,
        requestId: options?.requestId,
        provider: config.provider,
        modelId: config.modelId,
        modelConfigId: config.id,
        modelName: config.name,
        startedAt,
        inputTokensEstimate:
          estimateTokens(system) + prunedUiMessages.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
      };

      // D1 审计镜像：供管理端与历史统计使用，DO 仍是消息事实源
      if (lastUserText && (await this.isOwnMessage(lastUserText.id, sessionId))) {
        // 引用文件优先取客户端随消息 metadata 带来的 {id,name}；旧客户端只有 body 里的 id 时保留 id 形态，
        // seedFromAudit 会按 id 回查文件名
        const bodyFileIds = Array.isArray(options?.body?.contextFileIds)
          ? (options.body.contextFileIds as unknown[]).filter((value): value is string => typeof value === 'string')
          : [];
        const clientMentions = readMetadata(lastUserText).mentionedFiles ?? [];
        const mentionedFiles =
          clientMentions.length > 0
            ? clientMentions.slice(0, MAX_MENTIONED_FILES_META)
            : bodyFileIds.slice(0, MAX_MENTIONED_FILES_META).map((id) => ({ id, name: '' }));
        const mentionedJson = JSON.stringify(mentionedFiles);

        try {
          await db
            .insert(aiChatMessages)
            .values({
              id: lastUserText.id,
              sessionId,
              role: 'user',
              content: getMessageText(lastUserText),
              mentionedFiles: mentionedJson,
              createdAt: readMetadata(lastUserText).createdAt ?? new Date().toISOString(),
            })
            .onConflictDoUpdate({
              target: aiChatMessages.id,
              set: {
                content: getMessageText(lastUserText),
                mentionedFiles: mentionedJson,
              },
            });
        } catch {
          // 审计写入失败不阻塞对话
        }
      }

      const result = streamText({
        model,
        system,
        messages,
        tools,
        temperature: config.temperature,
        providerOptions: buildProviderOptions('chat', config, thinkingBudget),
        maxRetries,
        stopWhen: stepCountIs(maxSteps),
        abortSignal: options?.abortSignal,
        onFinish: async (event) => {
          try {
            await onFinish(event);
          } catch (error) {
            logger.error('Agent', 'onFinish persistence failed', { userId, sessionId }, error);
          }

          const usage = event.totalUsage ?? event.usage;
          const toolCallCount = event.toolCalls?.length ?? 0;

          await recordUsage(this.env, {
            userId,
            sessionId,
            requestId: options?.requestId,
            feature: 'chat',
            provider: config.provider,
            modelId: config.modelId,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            latencyMs: Date.now() - startedAt,
            toolCalls: toolCallCount,
            status: 'completed',
          });

          // 真实用量已记账，onChatResponse 不再兜底，避免重复计费
          this.pendingUsage = null;

          // 用真实总 token 结算配额预扣（差额回补/补扣）
          await this.pendingQuota?.settle((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
          this.pendingQuota = null;

          try {
            await db
              .update(aiChatSessions)
              .set({
                // 会话里存 ai_models 行 id，前端下拉与刷新回显都按该 id 匹配
                modelId: config.id,
                lastToolCallCount: toolCallCount,
                totalTokensUsed: sql`total_tokens_used + ${(usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)}`,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(aiChatSessions.id, sessionId));
          } catch {
            // 会话统计回写失败不影响回复
          }
        },
      });

      // 模型与用量随流下发：客户端立即显示在气泡底部，DO 也会合并进消息 metadata 落库，
      // 刷新/换设备后仍能还原（messageMetadata 在 start 与 finish 两个事件各回调一次）
      return result.toUIMessageStreamResponse({
        messageMetadata: ({ part }) => {
          if (part.type === 'start') {
            return {
              modelId: config.id,
              modelName: config.name,
              provider: config.provider,
              createdAt: new Date().toISOString(),
            } satisfies MessageMetadata;
          }
          if (part.type === 'finish') {
            const usage = part.totalUsage;
            return {
              usage: {
                inputTokens: usage?.inputTokens ?? 0,
                outputTokens: usage?.outputTokens ?? 0,
                totalTokens: usage?.totalTokens ?? 0,
                cachedTokens: usage?.inputTokenDetails?.cacheReadTokens ?? undefined,
              },
              latencyMs: Date.now() - startedAt,
            } satisfies MessageMetadata;
          }
          return undefined;
        },
      });
    } catch (error) {
      // 模型调用未发生（配置解析失败等）：全额回滚本轮预扣
      await this.pendingQuota?.release();
      this.pendingQuota = null;

      const aiError = mapAiError(error);
      logger.error('Agent', 'onChatMessage failed', { userId, sessionId, code: aiError.code }, error);

      return new Response(JSON.stringify({ error: aiError.message, code: aiError.code }), {
        status: aiError.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * D1 镜像按 message.id 做 upsert，而 id 由客户端提供。
   * 写入前确认该 id 不属于其它会话，避免伪造 id 覆盖他人消息。
   */
  private async isOwnMessage(messageId: string, sessionId: string): Promise<boolean> {
    const existing = await getDb(this.env.DB)
      .select({ sessionId: aiChatMessages.sessionId })
      .from(aiChatMessages)
      .where(eq(aiChatMessages.id, messageId))
      .get();

    return !existing || existing.sessionId === sessionId;
  }

  protected async onChatResponse(result: ChatResponseResult): Promise<void> {
    if (!this.state.sessionId) return;

    const db = getDb(this.env.DB);
    const assistantMessage = result.message;
    const aborted = result.status === 'aborted';
    const assistantMeta = assistantMessage ? readMetadata(assistantMessage) : {};
    const assistantUsage = assistantMeta.usage;

    // 助手审计镜像：使用与 DO 完全相同的 message.id，避免历史恢复时重复
    if (assistantMessage && (await this.isOwnMessage(assistantMessage.id, this.state.sessionId))) {
      try {
        const toolCalls = assistantMessage.parts
          .filter((part) => typeof (part as { type?: unknown }).type === 'string')
          .filter((part) => ((part as { type: string }).type ?? '').startsWith('tool-'))
          .map((part) => {
            const toolPart = part as { type: string; toolCallId?: string; input?: unknown; output?: unknown };
            return {
              toolName: toolPart.type.slice(5),
              toolCallId: toolPart.toolCallId,
              input: toolPart.input,
              result: toolPart.output,
            };
          });

        await db
          .insert(aiChatMessages)
          .values({
            id: assistantMessage.id,
            sessionId: this.state.sessionId,
            role: 'assistant',
            content: getMessageText(assistantMessage),
            toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
            reasoning: getReasoningText(assistantMessage) || null,
            aborted,
            // 每条回复的模型与用量都落到审计表：历史列表/导出与 seedFromAudit 恢复都依赖这几列
            modelUsed: assistantMeta.modelName ?? null,
            inputTokens: assistantUsage?.inputTokens ?? 0,
            outputTokens: assistantUsage?.outputTokens ?? 0,
            latencyMs: assistantMeta.latencyMs ?? null,
            createdAt: readMetadata(assistantMessage).createdAt ?? new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: aiChatMessages.id,
            set: {
              content: getMessageText(assistantMessage),
              toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
              reasoning: getReasoningText(assistantMessage) || null,
              aborted,
              modelUsed: assistantMeta.modelName ?? null,
              inputTokens: assistantUsage?.inputTokens ?? 0,
              outputTokens: assistantUsage?.outputTokens ?? 0,
              latencyMs: assistantMeta.latencyMs ?? null,
            },
          });
      } catch (error) {
        logger.error('Agent', 'Failed to mirror assistant message to D1', { sessionId: this.state.sessionId }, error);
      }
    }

    try {
      await db
        .update(aiChatSessions)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(aiChatSessions.id, this.state.sessionId));
    } catch {
      // ignore
    }

    if (result.status !== 'completed') {
      const pending = this.pendingUsage;
      this.pendingUsage = null;

      // 中断/异常时 onFinish 不会触发：用部分回答文本估算 output token，
      // 否则用户点「停止」即可免费拿到已生成内容，用量统计也会系统性失真。
      if (pending) {
        const partialText = assistantMessage ? getMessageText(assistantMessage) : '';
        const partialOutputTokens = estimateTokens(partialText);
        const toolCallCount =
          assistantMessage?.parts.filter((part) => ((part as { type?: string }).type ?? '').startsWith('tool-'))
            .length ?? 0;

        try {
          await recordUsage(this.env, {
            userId: pending.userId,
            sessionId: pending.sessionId,
            requestId: pending.requestId ?? result.requestId,
            feature: 'chat',
            provider: pending.provider,
            modelId: pending.modelId,
            inputTokens: pending.inputTokensEstimate,
            outputTokens: partialOutputTokens,
            latencyMs: Date.now() - pending.startedAt,
            toolCalls: toolCallCount,
            status: aborted ? 'aborted' : 'error',
          });
        } catch {
          // 用量记录失败不影响会话
        }

        // onFinish 未触发：用估算的输入 + 已生成内容结算预扣
        await this.pendingQuota?.settle(pending.inputTokensEstimate + partialOutputTokens);
        this.pendingQuota = null;

        // 中断的轮次同样要回写会话统计，否则侧栏停在上一轮的数值（表现为"只显示第一次"）
        try {
          await db
            .update(aiChatSessions)
            .set({
              modelId: pending.modelConfigId,
              lastToolCallCount: toolCallCount,
              totalTokensUsed: sql`total_tokens_used + ${pending.inputTokensEstimate + partialOutputTokens}`,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(aiChatSessions.id, this.state.sessionId));
        } catch {
          // 统计回写失败不影响中断流程
        }
      }
      return;
    }

    // 正常完成的请求由 onFinish 记账与结算；这里清空兜底状态，避免影响下一轮
    this.pendingUsage = null;
    this.pendingQuota = null;

    await this.maybeExtractMemories(assistantMessage);
  }

  /** 记忆提取节流：每 N 轮对话触发一次额外推理 */
  private async maybeExtractMemories(assistantMessage?: UIMessage): Promise<void> {
    // messages 会被 maxPersistedMessages 裁剪，不能用「数组长度差」判断新增消息，
    // 否则达到上限后差值恒为负，记忆提取会永久停摆。改为按对话轮数取模。
    const turns = (this.state.memoryExtractedMessageCount ?? 0) + 1;
    this.setState({ ...this.state, memoryExtractedMessageCount: turns });

    const configuredInterval = await getAiConfigNumber(
      this.env,
      'ai.agent.memory_extract_interval',
      AI_AGENT_DEFAULTS.memoryExtractInterval
    );
    const interval = Math.max(1, Math.floor(configuredInterval));
    if (turns % interval !== 0) return;

    try {
      const recent = this.messages.slice(-interval * 2);
      const userText = recent
        .filter((message) => message.role === 'user')
        .map((message) => getMessageText(message))
        .join('\n')
        .slice(-4000);
      const assistantText = recent
        .filter((message) => message.role === 'assistant')
        .map((message) => getMessageText(message))
        .join('\n')
        .slice(-2000);
      const toolCallsStr = JSON.stringify(
        assistantMessage?.parts.filter((part) => ((part as { type?: string }).type ?? '').startsWith('tool-')) ?? []
      ).slice(-2000);

      if (!userText.trim()) return;

      const memory = new AgentMemory(this.env);
      await memory.extractAndSaveMemories(
        this.state.userId,
        this.state.sessionId,
        `${userText}\n${assistantText}`,
        toolCallsStr
      );
      this.setState({ ...this.state, memoryExtractedMessageCount: turns });
    } catch (error) {
      logger.warn('Agent', 'Memory extraction failed', { sessionId: this.state.sessionId }, error);
    }
  }

  /**
   * 消息持久化前统一补齐 metadata：
   * - createdAt 只写一次，后续 tool 更新不刷新时间
   * - aborted 由 onChatResponse 写入后的下一轮持久化保留
   */
  protected sanitizeMessageForPersistence(message: UIMessage): UIMessage {
    const metadata = readMetadata(message);
    const nextMetadata: MessageMetadata = { ...metadata };
    if (!nextMetadata.createdAt) {
      nextMetadata.createdAt = new Date().toISOString();
    }
    return { ...message, metadata: nextMetadata };
  }
}
