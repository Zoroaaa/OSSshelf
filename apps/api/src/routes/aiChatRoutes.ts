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
import { eq, and, desc } from 'drizzle-orm';
import { getDb, aiChatSessions, aiChatMessages, files } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { ModelGateway, RagEngine } from '../lib/ai';
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

    const sessionWithCounts = await Promise.all(
      sessions.map(async (session) => {
        try {
          const messages = await db
            .select({ id: aiChatMessages.id })
            .from(aiChatMessages)
            .where(eq(aiChatMessages.sessionId, session.id))
            .all();

          return {
            ...session,
            messageCount: messages.length,
          };
        } catch (msgError) {
          logger.error('AI Chat', 'Failed to get message count', { sessionId: session.id }, msgError);
          return {
            ...session,
            messageCount: 0,
          };
        }
      })
    );

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
    return c.json(
      { success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '创建会话失败' } },
      500
    );
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
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '标题不能为空' } },
      400
    );
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
    return c.json(
      { success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '更新会话失败' } },
      500
    );
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
    return c.json(
      { success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '删除会话失败' } },
      500
    );
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
    return handleStreamChat(c, userId, query, sessionId, modelId, maxFiles, includeFileContent);
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

    const ragEngine = new RagEngine(c.env);
    const ragContext = await ragEngine.buildContext({
      query,
      userId,
      maxFiles,
      includeFileContent,
    });

    const gateway = new ModelGateway(c.env);
    const response = await gateway.chatCompletion(
      userId,
      {
        messages: [{ role: 'user', content: ragContext.assembledPrompt }],
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
      tokenCount: response.usage?.totalTokens || 0,
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
        usage: response.usage,
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

    const ragEngine = new RagEngine(c.env);
    const ragContext = await ragEngine.buildContext({
      query,
      userId,
      maxFiles,
      includeFileContent,
    });

    const gateway = new ModelGateway(c.env);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullContent = '';

          await gateway.chatCompletionStream(
            userId,
            {
              messages: [{ role: 'user', content: ragContext.assembledPrompt }],
            },
            (chunk: StreamChunk) => {
              if (chunk.done) {
                controller.enqueue(`data: ${JSON.stringify({ done: true, sessionId: actualSessionId })}\n\n`);
                controller.close();
              } else {
                fullContent += chunk.content;
                controller.enqueue(`data: ${JSON.stringify({ content: chunk.content, done: false })}\n\n`);
              }
            },
            c.req.raw.signal
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

          const finalContent =
            fullContent + ragEngine.formatSourcesForResponse(ragContext.relevantFiles);

          await db.insert(aiChatMessages).values({
            id: crypto.randomUUID(),
            sessionId: actualSessionId!,
            role: 'assistant',
            content: finalContent,
            sources: sourcesJson,
            tokenCount: Math.ceil(finalContent.length * 0.5),
            latencyMs,
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          logger.error('AI Chat', 'Stream chat failed', { userId }, error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    logger.error('AI Chat', 'Failed to start stream', { userId }, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : '启动流式对话失败',
        },
      },
      500
    );
  }
}

export default app;
