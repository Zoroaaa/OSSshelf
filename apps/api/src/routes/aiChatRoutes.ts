/**
 * aiChatRoutes.ts
 * AI 会话管理路由（增强版）
 *
 * 功能:
 * - 会话 CRUD
 * - 消息记录
 * - 流式聊天（SSE）
 * - RAG 集成
 */

import { Hono } from 'hono';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { getDb, aiChatSessions, aiChatMessages, files } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { ModelGateway, RagEngine } from '../lib/ai';
import { AgentEngine, type AgentChunk } from '../lib/ai/agentEngine';
import type { StreamChunk } from '../lib/ai/types';
import { logger } from '@osshelf/shared';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

app.get('/sessions', async (c) => {
  const userId = c.get('userId')!;

  try {
    const db = getDb(c.env.DB);

    const sessions = await db
      .select()
      .from(aiChatSessions)
      .where(eq(aiChatSessions.userId, userId))
      .orderBy(desc(aiChatSessions.updatedAt))
      .limit(50)
      .all();

    // Single batch query for all message counts
    const msgCounts = await db
      .select({ sessionId: aiChatMessages.sessionId, cnt: count(aiChatMessages.id) })
      .from(aiChatMessages)
      .where(
        sql`${aiChatMessages.sessionId} IN (${sql.join(
          sessions.map((s) => sql`${s.id}`),
          sql`, `
        )})`
      )
      .groupBy(aiChatMessages.sessionId)
      .all();

    const countMap = new Map(msgCounts.map((r) => [r.sessionId, r.cnt]));

    const sessionWithCounts = sessions.map((session) => ({
      ...session,
      messageCount: countMap.get(session.id) ?? 0,
    }));

    return c.json({
      success: true,
      data: sessionWithCounts,
    });
  } catch (error) {
    logger.error('AI Chat', 'Failed to get sessions', { userId }, error);
    return c.json({
      success: false,
      error: { code: ERROR_CODES.INTERNAL_ERROR, message: '获取会话列表失败' },
      data: [],
    });
  }
});

app.post('/sessions', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const { title = '新对话', modelId } = body as { title?: string; modelId?: string };

  try {
    const db = getDb(c.env.DB);

    const newSession = {
      id: crypto.randomUUID(),
      userId,
      title,
      modelId: modelId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.insert(aiChatSessions).values(newSession);

    return c.json({ success: true, data: newSession });
  } catch (error) {
    logger.error('AI Chat', 'Failed to create session', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '创建会话失败' } }, 500);
  }
});

app.get('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);

  const session = await db
    .select()
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!session) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
  }

  const messages = await db
    .select()
    .from(aiChatMessages)
    .where(eq(aiChatMessages.sessionId, sessionId))
    .orderBy(aiChatMessages.createdAt)
    .all();

  return c.json({
    success: true,
    data: {
      ...session,
      messages: messages.map((m) => ({
        ...m,
        sources: m.sources ? JSON.parse(m.sources) : undefined,
      })),
    },
  });
});

app.put('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();
  const { title } = body as { title?: string };

  if (!title) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '标题不能为空' } }, 400);
  }

  const db = getDb(c.env.DB);

  const existingSession = await db
    .select()
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!existingSession) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
  }

  try {
    await db
      .update(aiChatSessions)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { id: sessionId, title } });
  } catch (error) {
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '更新会话失败' } }, 500);
  }
});

app.delete('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);

  const existingSession = await db
    .select()
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!existingSession) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
  }

  try {
    await db.delete(aiChatSessions).where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { message: '会话已删除' } });
  } catch (error) {
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '删除会话失败' } }, 500);
  }
});

const chatSchema = z.object({
  query: z.string().min(1).max(2000),
  sessionId: z.string().optional(),
  modelId: z.string().optional(),
  maxFiles: z.number().int().min(1).max(10).default(5),
  includeFileContent: z.boolean().default(false),
  stream: z.boolean().default(false),
});

app.post('/chat', async (c) => {
  const userId = c.get('userId')!;

  const body = await c.req.json();
  const result = chatSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { query, sessionId, modelId, maxFiles, includeFileContent, stream } = result.data;

  if (stream) {
    return handleStreamChat(c, userId, query, sessionId, modelId);
  }

  return handleNormalChat(c, userId, query, sessionId, modelId, maxFiles, includeFileContent);
});

async function handleNormalChat(
  c: any,
  userId: string,
  query: string,
  sessionId?: string,
  modelId?: string,
  maxFiles?: number,
  includeFileContent?: boolean
) {
  const startTime = Date.now();
  let actualSessionId = sessionId;

  try {
    const db = getDb(c.env.DB);

    if (!actualSessionId) {
      const newSession = {
        id: crypto.randomUUID(),
        userId,
        title: query.slice(0, 50),
        modelId: modelId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.insert(aiChatSessions).values(newSession);
      actualSessionId = newSession.id;

      c.executionCtx.waitUntil(
        (async () => {
          try {
            const gateway = new ModelGateway(c.env);
            const titleResponse = await gateway.chatCompletion(userId, {
              messages: [
                { role: 'system', content: '用 8-12 个中文字概括用户对话的主题。只输出标题，不加标点和解释。' },
                { role: 'user', content: query },
              ],
              maxTokens: 30,
              temperature: 0.5,
            });
            const generatedTitle = titleResponse.content.trim().slice(0, 20);
            if (generatedTitle && generatedTitle !== query.slice(0, 20)) {
              await db
                .update(aiChatSessions)
                .set({ title: generatedTitle })
                .where(eq(aiChatSessions.id, actualSessionId));
            }
          } catch {}
        })()
      );
    } else {
      await db
        .update(aiChatSessions)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(aiChatSessions.id, actualSessionId));
    }

    await db.insert(aiChatMessages).values({
      id: crypto.randomUUID(),
      sessionId: actualSessionId,
      role: 'user',
      content: query,
      createdAt: new Date().toISOString(),
    });

    const existingMessages = await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.sessionId, actualSessionId))
      .orderBy(aiChatMessages.createdAt)
      .all();

    const conversationHistory = existingMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const ragEngine = new RagEngine(c.env);
    const ragContext = await ragEngine.buildContext({
      query,
      userId,
      maxFiles,
      includeFileContent,
      conversationHistory,
    });

    const gateway = new ModelGateway(c.env);
    const response = await gateway.chatCompletion(
      userId,
      {
        messages: ragContext.messages,
      },
      modelId
    );

    const latencyMs = Date.now() - startTime;
    const sourcesJson = JSON.stringify(
      ragContext.relevantFiles.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        score: f.similarityScore,
      }))
    );

    await db.insert(aiChatMessages).values({
      id: crypto.randomUUID(),
      sessionId: actualSessionId,
      role: 'assistant',
      content: response.content + ragEngine.formatSourcesForResponse(ragContext.relevantFiles),
      sources: sourcesJson,
      modelUsed: response.model,
      latencyMs,
      createdAt: new Date().toISOString(),
    });

    return c.json({
      success: true,
      data: {
        answer: response.content,
        sources: ragContext.relevantFiles.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          score: f.similarityScore,
        })),
        sessionId: actualSessionId,
        latencyMs,
      },
    });
  } catch (error) {
    logger.error('AI Chat', 'Chat failed', { userId, query: query.slice(0, 50) }, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'AI对话失败，请重试',
        },
      },
      500
    );
  }
}

async function handleStreamChat(
  c: any,
  userId: string,
  query: string,
  sessionId?: string,
  modelId?: string
) {
  const startTime = Date.now();
  let actualSessionId = sessionId;

  try {
    const db = getDb(c.env.DB);

    // Ensure session exists
    if (!actualSessionId) {
      const newSession = {
        id: crypto.randomUUID(),
        userId,
        title: query.slice(0, 50),
        modelId: modelId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.insert(aiChatSessions).values(newSession);
      actualSessionId = newSession.id;

      // 异步生成 LLM 标题（与 handleNormalChat 保持一致）
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const gateway = new ModelGateway(c.env);
            const titleResponse = await gateway.chatCompletion(userId, {
              messages: [
                { role: 'system', content: '用 8-12 个中文字概括用户对话的主题。只输出标题，不加标点和解释。' },
                { role: 'user', content: query },
              ],
              maxTokens: 30,
              temperature: 0.5,
            });
            const generatedTitle = titleResponse.content.trim().slice(0, 20);
            if (generatedTitle && generatedTitle !== query.slice(0, 20)) {
              await db
                .update(aiChatSessions)
                .set({ title: generatedTitle })
                .where(eq(aiChatSessions.id, actualSessionId));
            }
          } catch {}
        })()
      );
    } else {
      await db
        .update(aiChatSessions)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(aiChatSessions.id, actualSessionId));
    }

    // Save user message
    await db.insert(aiChatMessages).values({
      id: crypto.randomUUID(),
      sessionId: actualSessionId,
      role: 'user',
      content: query,
      createdAt: new Date().toISOString(),
    });

    // Load conversation history for context
    const existingMessages = await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.sessionId, actualSessionId))
      .orderBy(aiChatMessages.createdAt)
      .all();

    const conversationHistory = existingMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const agentEngine = new AgentEngine(c.env);

    let fullText = '';
    let finalSources: Array<{ id: string; name: string; mimeType: string | null; score: number }> = [];
    let resolveStream!: () => void;
    let doneEmitted = false;
    const streamDone = new Promise<void>((r) => {
      resolveStream = r;
    });

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (data: object) => {
          try {
            controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
          } catch {
            // controller already closed
          }
        };

        const emitDone = (data: object) => {
          if (doneEmitted) return;
          doneEmitted = true;
          enqueue(data);
          try {
            controller.close();
          } catch {}
          resolveStream();
        };

        try {
          const result = await agentEngine.run(
            userId,
            query,
            conversationHistory,
            modelId,
            (chunk: AgentChunk) => {
              if (chunk.done) {
                if (chunk.type === 'done') {
                  finalSources = chunk.sources;
                  emitDone({ done: true, sessionId: actualSessionId, sources: chunk.sources });
                } else {
                  emitDone({ done: true, error: (chunk as any).message, sessionId: actualSessionId, sources: [] });
                }
              } else {
                if (chunk.type === 'text') {
                  fullText += chunk.content;
                  enqueue({ content: chunk.content, done: false });
                } else if (chunk.type === 'reasoning') {
                  enqueue({ reasoning: true, content: chunk.content, done: false });
                } else if (chunk.type === 'tool_start') {
                  enqueue({
                    toolStart: true,
                    toolName: chunk.toolName,
                    toolCallId: chunk.toolCallId,
                    args: chunk.args,
                    done: false,
                  });
                } else if (chunk.type === 'tool_result') {
                  enqueue({
                    toolResult: true,
                    toolCallId: chunk.toolCallId,
                    toolName: chunk.toolName,
                    result: chunk.result,
                    done: false,
                  });
                }
              }
            },
            c.req.raw.signal
          );

          // Guard: agent finished without emitting done
          if (!doneEmitted) {
            finalSources = result.sources;
            emitDone({ done: true, sessionId: actualSessionId, sources: result.sources });
          }
        } catch (error) {
          logger.error('AI Agent', 'Stream failed', { userId }, error);
          enqueue({ done: true, error: 'AI 响应出错', sessionId: actualSessionId, sources: [] });
          try {
            controller.close();
          } catch {}
          resolveStream();
        }
      },
    });

    // Save assistant message after stream completes
    c.executionCtx.waitUntil(
      (async () => {
        await streamDone;
        try {
          if (!fullText.trim()) return;
          const latencyMs = Date.now() - startTime;
          await db.insert(aiChatMessages).values({
            id: crypto.randomUUID(),
            sessionId: actualSessionId!,
            role: 'assistant',
            content: fullText,
            sources: JSON.stringify(finalSources),
            latencyMs,
            createdAt: new Date().toISOString(),
          });
          logger.info('AI Agent', 'Message saved', { sessionId: actualSessionId, latencyMs });
        } catch (error) {
          logger.error('AI Agent', 'Failed to save message', { userId }, error);
        }
      })()
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    logger.error('AI Chat', 'Failed to start agent stream', { userId }, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : '启动对话失败',
        },
      },
      500
    );
  }
}

export default app;
