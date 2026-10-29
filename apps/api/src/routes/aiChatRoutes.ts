/**
 * routes/aiChatRoutes.ts
 * AI 会话管理（Agent 运行时）
 *
 * 旧 SSE / chat / confirm / cancel 链路已移除：
 * - 对话与工具审批全部走 /agents WebSocket
 * - HTTP 仅保留会话 CRUD、WS ticket、记忆管理
 */

import { Hono } from 'hono';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware';
import { aiRateLimit } from '../middleware/aiRateLimit';
import { getDb, aiChatSessions, aiChatMessages, aiMemories } from '../db';
import { AgentMemory } from '../lib/ai/agentMemory';
import { ModelGateway } from '../lib/ai/modelGateway';
import { buildAgentInstanceName, issueWsTicket, WS_TICKET_TTL_MS } from '../agents/auth';
import type { Env, Variables } from '../types/env';
import { ERROR_CODES, logger } from '@osshelf/shared';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);
app.use('/ws-ticket', aiRateLimit());

app.post('/ws-ticket', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';

  if (!sessionId) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少 sessionId' } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const session = await db
    .select({ id: aiChatSessions.id })
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!session) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
  }

  const ticket = await issueWsTicket(c.env, userId, sessionId);
  return c.json({
    success: true,
    data: {
      ticket,
      agent: 'OSSShelfAgent',
      name: buildAgentInstanceName(userId, sessionId),
      expiresIn: Math.floor(WS_TICKET_TTL_MS / 1000),
    },
  });
});

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

    const msgCounts =
      sessions.length === 0
        ? []
        : await db
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

    const countMap = new Map(msgCounts.map((row) => [row.sessionId, row.cnt]));

    return c.json({
      success: true,
      data: sessions.map((session) => ({
        ...session,
        messageCount: countMap.get(session.id) ?? 0,
      })),
    });
  } catch (error) {
    logger.error('AI Chat', 'Failed to get sessions', { userId }, error);
    return c.json(
      { success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '获取会话列表失败' }, data: [] },
      500
    );
  }
});

app.post('/sessions', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const { title = '新对话', modelId, id } = body as { title?: string; modelId?: string; id?: string };

  try {
    const db = getDb(c.env.DB);
    const sessionId = typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : crypto.randomUUID();

    const existing = await db
      .select({ id: aiChatSessions.id })
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
      .get();

    const newSession = {
      id: sessionId,
      userId,
      title,
      modelId: modelId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (!existing) await db.insert(aiChatSessions).values(newSession);

    return c.json({ success: true, data: newSession });
  } catch (error) {
    logger.error('AI Chat', 'Failed to create session', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '创建会话失败' } }, 500);
  }
});

app.put('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();
  const title = typeof body?.title === 'string' ? body.title.trim() : '';

  if (!title) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '标题不能为空' } }, 400);
  }

  try {
    const db = getDb(c.env.DB);
    const existing = await db
      .select({ id: aiChatSessions.id })
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
      .get();

    if (!existing) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
    }

    await db
      .update(aiChatSessions)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { id: sessionId, title } });
  } catch (error) {
    logger.error('AI Chat', 'Failed to update session', { userId, sessionId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '更新会话失败' } }, 500);
  }
});

app.delete('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);

  const existing = await db
    .select({ id: aiChatSessions.id })
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!existing) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
  }

  try {
    await db.delete(aiChatMessages).where(eq(aiChatMessages.sessionId, sessionId));
    await db.delete(aiMemories).where(eq(aiMemories.sessionId, sessionId));
    await db.delete(aiChatSessions).where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { message: '会话已删除' } });
  } catch (error) {
    logger.error('AI Chat', 'Failed to delete session', { userId, sessionId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '删除会话失败' } }, 500);
  }
});

app.get('/memories', async (c) => {
  const userId = c.get('userId')!;
  const type = c.req.query('type');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const memory = new AgentMemory(new ModelGateway(c.env), c.env);
    const result = await memory.listMemories(userId, { type, limit, offset });
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('AI Chat', 'List memories failed', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '获取记忆列表失败' } }, 500);
  }
});

app.delete('/memories/:id', async (c) => {
  const userId = c.get('userId')!;
  const memoryId = c.req.param('id');

  try {
    const memory = new AgentMemory(new ModelGateway(c.env), c.env);
    const success = await memory.deleteMemory(memoryId, userId);
    if (!success) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '记忆不存在' } }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error('AI Chat', 'Delete memory failed', { userId, memoryId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '删除记忆失败' } }, 500);
  }
});

export default app;
