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
import { AI_REQUEST_DEFAULTS, getAiConfigNumber } from '../lib/ai/aiConfigService';
import { AGENT_SYSTEM_PROMPT } from '../lib/ai/prompts/agentSystem';
import { AgentMemory } from '../lib/ai/agentMemory';
import { recordUsage, reserveAiQuota, type QuotaReservation } from '../lib/ai/usage';
import { mapAiError } from '../lib/ai/aiErrors';
import { estimateTokens } from '../lib/ai/utils';
import { logger } from '@osshelf/shared';

export interface OSSshelfAgentState {
  userId: string;
  sessionId: string;
  modelId?: string;
  /** 已做记忆提取的消息数量，用于节流，避免每轮都调用一次模型 */
  memoryExtractedMessageCount?: number;
}

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_MAX_CONTEXT_TOKENS = 100_000;
/** 预算只用来裁剪历史，保留 70% 给历史 + 30% 给工具结果与回复 */
const CONTEXT_HISTORY_RATIO = 0.7;
/** 至少保留最近 N 条消息，避免把当前轮上下文裁掉 */
const MIN_KEEP_MESSAGES = 2;
/** 已处理的对话轮数，每达到该阈值做一次记忆提取 */
const MEMORY_EXTRACT_INTERVAL = 4;
const MAX_CONTEXT_FILES = 5;

interface MessageMetadata {
  createdAt?: string;
  aborted?: boolean;
}

interface PendingUsage {
  userId: string;
  sessionId: string;
  requestId?: string;
  provider: string;
  modelId: string;
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

/** 用 JSON 序列化后的字符数估算一条 UIMessage 的 token 成本 */
function estimateMessageTokens(message: UIMessage): number {
  try {
    return estimateTokens(JSON.stringify(message.parts ?? []));
  } catch {
    return 0;
  }
}

/** 历史裁剪：从最旧开始丢弃，直到落在预算内；保持消息边界，不破坏 tool call/result 配对 */
function trimMessagesByBudget(messages: UIMessage[], budgetTokens: number): UIMessage[] {
  if (messages.length <= MIN_KEEP_MESSAGES) return messages;

  let total = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  let start = 0;
  while (start < messages.length - MIN_KEEP_MESSAGES && total > budgetTokens) {
    const oldest = messages[start];
    if (!oldest) break;
    total -= estimateMessageTokens(oldest);
    start++;
  }
  return start === 0 ? messages : messages.slice(start);
}

export class OSSShelfAgent extends AIChatAgent<Env, OSSshelfAgentState> {
  initialState: OSSshelfAgentState = { userId: '', sessionId: '' };

  maxPersistedMessages = 200;
  messageConcurrency = 'queue' as const;
  chatStreamStallTimeoutMs = 120_000;

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

      const history: UIMessage[] = rows
        .filter((row) => row.role === 'user' || row.content.trim().length > 0 || row.toolCalls)
        .map((row) => {
          const parts: UIMessage['parts'] = [];
          const metadata: MessageMetadata = { createdAt: row.createdAt };

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
          } as UIMessage;
        })
        .filter((message) => message.parts.length > 0);

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
  private async buildContextSection(options?: OnChatMessageOptions): Promise<string> {
    const contextFileIds = Array.isArray(options?.body?.contextFileIds)
      ? (options?.body?.contextFileIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const contextFolderId =
      typeof options?.body?.contextFolderId === 'string' ? (options.body.contextFolderId as string) : '';

    if (contextFileIds.length === 0 && !contextFolderId) return '';

    try {
      const db = getDb(this.env.DB);
      const ids = [...new Set([...contextFileIds.slice(0, MAX_CONTEXT_FILES), contextFolderId].filter(Boolean))];
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

      if (requestedModelId && requestedModelId !== this.state.modelId) {
        this.setState({ ...this.state, modelId: requestedModelId });
      }

      const lastUserText = [...this.messages].reverse().find((message) => message.role === 'user');
      const lastUserQuery = lastUserText ? getMessageText(lastUserText) : '';

      const [{ model, config }, tools] = await Promise.all([
        resolveModelRuntime(this.env, userId, requestedModelId ?? this.state.modelId),
        buildAgentTools(this.env, userId, { query: lastUserQuery }),
      ]);

      const [maxSteps, maxContextTokens, maxRetries] = await Promise.all([
        getAiConfigNumber(this.env, 'ai.agent.max_steps', DEFAULT_MAX_STEPS),
        getAiConfigNumber(this.env, 'ai.agent.max_context_tokens', DEFAULT_MAX_CONTEXT_TOKENS),
        getAiConfigNumber(this.env, 'ai.request.max_retries', AI_REQUEST_DEFAULTS.maxRetries),
      ]);

      const [contextSection, memorySection] = await Promise.all([
        this.buildContextSection(options),
        this.buildMemorySection(lastUserQuery),
      ]);

      const system = [AGENT_SYSTEM_PROMPT, contextSection, memorySection].filter(Boolean).join('\n\n');

      // 先按 token 预算裁剪 UIMessage 历史，再转成 ModelMessage 并做 tool/reasoning 剪枝
      const budget = Math.floor(maxContextTokens * CONTEXT_HISTORY_RATIO);
      const prunedUiMessages = trimMessagesByBudget(this.messages, budget);
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
        startedAt,
        inputTokensEstimate:
          estimateTokens(system) + prunedUiMessages.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
      };

      // D1 审计镜像：供管理端与历史统计使用，DO 仍是消息事实源
      if (lastUserText && (await this.isOwnMessage(lastUserText.id, sessionId))) {
        try {
          await db
            .insert(aiChatMessages)
            .values({
              id: lastUserText.id,
              sessionId,
              role: 'user',
              content: getMessageText(lastUserText),
              mentionedFiles: JSON.stringify(options?.body?.contextFileIds ?? []),
              createdAt: readMetadata(lastUserText).createdAt ?? new Date().toISOString(),
            })
            .onConflictDoUpdate({
              target: aiChatMessages.id,
              set: {
                content: getMessageText(lastUserText),
                mentionedFiles: JSON.stringify(options?.body?.contextFileIds ?? []),
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
        providerOptions: buildProviderOptions('chat', config),
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
                modelId: config.modelId,
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

      return result.toUIMessageStreamResponse();
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
            createdAt: readMetadata(assistantMessage).createdAt ?? new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: aiChatMessages.id,
            set: {
              content: getMessageText(assistantMessage),
              toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
              reasoning: getReasoningText(assistantMessage) || null,
              aborted,
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
    if (turns % MEMORY_EXTRACT_INTERVAL !== 0) return;

    try {
      const recent = this.messages.slice(-MEMORY_EXTRACT_INTERVAL * 2);
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
