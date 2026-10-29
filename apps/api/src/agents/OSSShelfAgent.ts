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
 */

import { AIChatAgent, type ChatResponseResult, type OnChatMessageOptions } from '@cloudflare/ai-chat';
import { convertToModelMessages, pruneMessages, stepCountIs, streamText } from 'ai';
import type { UIMessage } from 'ai';
import { eq, sql } from 'drizzle-orm';
import type { Connection, ConnectionContext } from 'agents';
import type { Env } from '../types/env';
import { getVerifiedIdentity } from './auth';
import { getDb, aiChatMessages, aiChatSessions } from '../db';
import { resolveLanguageModel } from '../lib/ai/modelResolver';
import { buildAgentTools } from '../lib/ai/toolAdapter';
import { getAiConfigNumber } from '../lib/ai/aiConfigService';
import { AGENT_SYSTEM_PROMPT } from '../lib/ai/prompts/agentSystem';
import { recordUsage } from '../lib/ai/usage';
import { mapAiError } from '../lib/ai/aiErrors';
import { logger } from '@osshelf/shared';

export interface OSSshelfAgentState {
  userId: string;
  sessionId: string;
  modelId?: string;
}

const DEFAULT_MAX_STEPS = 20;

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export class OSSShelfAgent extends AIChatAgent<Env, OSSshelfAgentState> {
  initialState: OSSshelfAgentState = { userId: '', sessionId: '' };

  maxPersistedMessages = 200;
  messageConcurrency = 'queue' as const;
  chatStreamStallTimeoutMs = 120_000;

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
      this.setState({ userId, sessionId });
    }

    await super.onConnect(connection, ctx);
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

    try {
      const requestedModelId =
        typeof options?.body?.modelId === 'string' ? (options.body.modelId as string) : undefined;

      if (requestedModelId && requestedModelId !== this.state.modelId) {
        this.setState({ ...this.state, modelId: requestedModelId });
      }

      const [{ model, config }, tools] = await Promise.all([
        resolveLanguageModel(this.env, userId, requestedModelId ?? this.state.modelId),
        buildAgentTools(this.env, userId),
      ]);

      const maxSteps = await getAiConfigNumber(this.env, 'ai.agent.max_steps', DEFAULT_MAX_STEPS);
      const messages = pruneMessages({
        messages: await convertToModelMessages(this.messages),
        reasoning: 'before-last-message',
        toolCalls: 'before-last-2-messages',
      });

      const startedAt = Date.now();
      const db = getDb(this.env.DB);

      // D1 审计镜像：供管理端与历史统计使用，DO 仍是消息事实源
      const userMessage = [...this.messages].reverse().find((message) => message.role === 'user');
      if (userMessage) {
        try {
          await db
            .insert(aiChatMessages)
            .values({
              id: userMessage.id,
              sessionId,
              role: 'user',
              content: getMessageText(userMessage),
              mentionedFiles: JSON.stringify(options?.body?.contextFileIds ?? []),
              createdAt: new Date().toISOString(),
            })
            .onConflictDoNothing();
        } catch {
          // 审计写入失败不阻塞对话
        }
      }

      const result = streamText({
        model,
        system: AGENT_SYSTEM_PROMPT,
        messages,
        tools,
        temperature: config.temperature,
        stopWhen: stepCountIs(maxSteps),
        abortSignal: options?.abortSignal,
        onFinish: async (event) => {
          await onFinish(event);

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

          try {
            await db
              .insert(aiChatMessages)
              .values({
                id: crypto.randomUUID(),
                sessionId,
                role: 'assistant',
                content: event.text ?? '',
                toolCalls: JSON.stringify(event.toolCalls ?? []),
                reasoning:
                  (event as unknown as { reasoning?: Array<{ text?: string }> }).reasoning
                    ?.map((part) => part.text ?? '')
                    .join('') || null,
                modelUsed: config.modelId,
                latencyMs: Date.now() - startedAt,
                inputTokens: usage?.inputTokens ?? 0,
                outputTokens: usage?.outputTokens ?? 0,
                createdAt: new Date().toISOString(),
              });
          } catch {
            // 审计写入失败不阻塞回复
          }

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
      const aiError = mapAiError(error);
      logger.error('Agent', 'onChatMessage failed', { userId, sessionId, code: aiError.code }, error);

      return new Response(JSON.stringify({ error: aiError.message, code: aiError.code }), {
        status: aiError.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  protected async onChatResponse(result: ChatResponseResult): Promise<void> {
    if (result.status !== 'completed' || !this.state.sessionId) return;

    try {
      const db = getDb(this.env.DB);
      await db
        .update(aiChatSessions)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(aiChatSessions.id, this.state.sessionId));
    } catch {
      // ignore
    }
  }
}
