/**
 * routes/aiChatRoutes.ts
 * AI 会话管理（Agent 运行时）
 *
 * 旧 SSE / chat / confirm / cancel 链路已移除：
 * - 对话与工具审批全部走 /agents WebSocket
 * - HTTP 仅保留会话 CRUD、WS ticket、记忆管理
 */

import { Hono } from 'hono';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { getAgentByName } from 'agents';
import { authMiddleware } from '../middleware';
import { aiRateLimit } from '../middleware/aiRateLimit';
import { getDb, aiChatSessions, aiChatMessages, aiMemories, aiUsageEvents } from '../db';
import { AgentMemory } from '../lib/ai/agentMemory';
import { ModelGateway } from '../lib/ai/modelGateway';
import { buildAgentInstanceName, issueWsTicket, WS_TICKET_TTL_MS } from '../agents/auth';
import type { OSSShelfAgent } from '../agents/OSSShelfAgent';
import type { Env, Variables } from '../types/env';
import { ERROR_CODES, logger } from '@osshelf/shared';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);
app.use('/ws-ticket', aiRateLimit());
app.use('/sessions/:sessionId/title', aiRateLimit());

/** 标题清洗：去换行、去首尾引号、限长 */
function normalizeTitle(input: string, maxLength = 60): string {
  return input
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim()
    .slice(0, maxLength);
}

app.post('/ws-ticket', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';

  if (!sessionId) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少 sessionId' } }, 400);
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

    // token / 工具调用以 ai_usage_events 为准（Agent 写入），回退到会话行累计值
    let usageRows: Array<{ sessionId: string | null; tokens: number; toolCalls: number }> = [];
    if (sessions.length > 0) {
      try {
        usageRows = await db
          .select({
            sessionId: aiUsageEvents.sessionId,
            tokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}), 0)`,
            toolCalls: sql<number>`coalesce(sum(${aiUsageEvents.toolCalls}), 0)`,
          })
          .from(aiUsageEvents)
          .where(
            and(
              eq(aiUsageEvents.userId, userId),
              sql`${aiUsageEvents.sessionId} IN (${sql.join(
                sessions.map((s) => sql`${s.id}`),
                sql`, `
              )})`
            )
          )
          .groupBy(aiUsageEvents.sessionId)
          .all();
      } catch (error) {
        // 用量表异常不影响会话列表
        logger.error('AI Chat', 'Failed to aggregate session usage', { userId }, error);
      }
    }

    const usageMap = new Map(usageRows.map((row) => [row.sessionId, row]));

    return c.json({
      success: true,
      data: sessions.map((session) => {
        const usage = usageMap.get(session.id);
        return {
          ...session,
          messageCount: countMap.get(session.id) ?? 0,
          totalTokensUsed: Math.max(usage?.tokens ?? 0, session.totalTokensUsed ?? 0),
          lastToolCallCount: Math.max(usage?.toolCalls ?? 0, session.lastToolCallCount ?? 0),
        };
      }),
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
    const safeTitle = normalizeTitle(title) || '新对话';

    const existing = await db
      .select({ id: aiChatSessions.id })
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
      .get();

    const newSession = {
      id: sessionId,
      userId,
      title: safeTitle,
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

/**
 * 首轮对话后自动生成标题。
 * 失败不覆盖原标题：前端只在成功时刷新列表。
 */
app.post('/sessions/:sessionId/title', async (c) => {
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

  try {
    const rows = await db
      .select({ role: aiChatMessages.role, content: aiChatMessages.content })
      .from(aiChatMessages)
      .where(eq(aiChatMessages.sessionId, sessionId))
      .orderBy(asc(aiChatMessages.createdAt))
      .limit(4)
      .all();

    const transcript = rows
      .filter((row) => row.content.trim())
      .map((row) => `${row.role === 'user' ? '用户' : '助手'}：${row.content.slice(0, 800)}`)
      .join('\n')
      .slice(0, 2400);

    if (!transcript) {
      return c.json({ success: true, data: { id: sessionId, title: session.title } });
    }

    const gateway = new ModelGateway(c.env);
    const response = await gateway.chatCompletion(userId, {
      messages: [
        {
          role: 'system',
          content:
            '你是会话标题生成器。根据对话前两轮内容生成一个 8-16 字的中文标题，概括用户意图。只输出标题本身，不要引号、标点结尾或解释。',
        },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
    });

    const title = normalizeTitle(response.content ?? '', 24);
    if (!title) {
      return c.json({ success: true, data: { id: sessionId, title: session.title } });
    }

    await db
      .update(aiChatSessions)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { id: sessionId, title } });
  } catch (error) {
    logger.error('AI Chat', 'Generate session title failed', { userId, sessionId }, error);
    return c.json({ success: true, data: { id: sessionId, title: session.title } });
  }
});

/** 导出会话为 Markdown：数据来自 D1 审计镜像，按时间正序 */
app.get('/sessions/:sessionId/export', async (c) => {
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

  const rows = await db
    .select()
    .from(aiChatMessages)
    .where(eq(aiChatMessages.sessionId, sessionId))
    .orderBy(asc(aiChatMessages.createdAt))
    .all();

  const lines: string[] = [`# ${session.title}`, '', `> 导出时间：${new Date().toISOString()}`, ''];
  for (const row of rows) {
    lines.push(row.role === 'user' ? '## 你' : '## 助手', '');
    if (row.content.trim()) lines.push(row.content.trim(), '');
    if (row.aborted) lines.push('> 该回复被中断', '');
    if (row.toolCalls) {
      try {
        const calls = JSON.parse(row.toolCalls) as Array<{ toolName?: string; input?: unknown }>;
        for (const call of calls) {
          if (!call.toolName) continue;
          const args = JSON.stringify(call.input ?? {});
          lines.push(`> 工具调用：\`${call.toolName}\` ${args.slice(0, 300)}`, '>');
        }
        if (calls.length > 0) lines.push('');
      } catch {
        // 审计数据损坏时跳过工具段
      }
    }
  }

  const markdown = lines.join('\n');
  const safeName = session.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  return c.body(markdown, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}.md"`,
    'Cache-Control': 'private, no-store',
  });
});

app.delete('/sessions', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const sessions = await db
    .select({ id: aiChatSessions.id })
    .from(aiChatSessions)
    .where(eq(aiChatSessions.userId, userId))
    .all();

  const ids = sessions.map((session) => session.id);
  if (ids.length === 0) {
    return c.json({ success: true, data: { deleted: 0 } });
  }

  // 逐个重置 DO 内的对话，失败不阻塞 D1 清理
  const AGENT_BATCH = 20;
  for (let i = 0; i < ids.length; i += AGENT_BATCH) {
    await Promise.allSettled(
      ids.slice(i, i + AGENT_BATCH).map(async (sessionId) => {
        try {
          const stub = await getAgentByName<Env, OSSShelfAgent>(
            c.env.OSSShelfAgent as unknown as DurableObjectNamespace<OSSShelfAgent>,
            buildAgentInstanceName(userId, sessionId)
          );
          await stub.resetConversation();
        } catch (error) {
          logger.warn('AI Chat', 'Failed to reset agent conversation', { userId, sessionId }, error);
        }
      })
    );
  }

  // D1 单条 SQL 绑定参数上限为 100，按批清理
  const CHUNK = 100;
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      await db.delete(aiChatMessages).where(inArray(aiChatMessages.sessionId, slice));
      await db.delete(aiMemories).where(inArray(aiMemories.sessionId, slice));
    }
    await db.delete(aiChatSessions).where(eq(aiChatSessions.userId, userId));
  } catch (error) {
    logger.error('AI Chat', 'Failed to clear sessions', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '清空会话失败' } }, 500);
  }

  // ai_usage_events 保留：计费与审计口径
  return c.json({ success: true, data: { deleted: ids.length } });
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
    // 先清空 DO 内的消息，否则同名会话再次打开会读到"已删除"的旧对话。
    // 失败不阻塞 D1 删除：会话列表已不可见，残留数据不会暴露给同用户之外的人。
    try {
      const stub = await getAgentByName<Env, OSSShelfAgent>(
        c.env.OSSShelfAgent as unknown as DurableObjectNamespace<OSSShelfAgent>,
        buildAgentInstanceName(userId, sessionId)
      );
      await stub.resetConversation();
    } catch (error) {
      logger.warn('AI Chat', 'Failed to reset agent conversation', { userId, sessionId }, error);
    }

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

app.post('/memories/batch-delete', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json().catch(() => ({}));
  const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  const ids = rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 200);

  if (ids.length === 0) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请提供记忆ID列表' } }, 400);
  }

  try {
    const memory = new AgentMemory(new ModelGateway(c.env), c.env);
    const deleted = await memory.deleteMemories(ids, userId);
    return c.json({ success: true, data: { deleted } });
  } catch (error) {
    logger.error('AI Chat', 'Batch delete memories failed', { userId, count: ids.length }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '批量删除记忆失败' } }, 500);
  }
});

app.delete('/memories', async (c) => {
  const userId = c.get('userId')!;

  try {
    const memory = new AgentMemory(new ModelGateway(c.env), c.env);
    const deleted = await memory.deleteAllMemories(userId);
    return c.json({ success: true, data: { deleted } });
  } catch (error) {
    logger.error('AI Chat', 'Delete all memories failed', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '清空记忆失败' } }, 500);
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
