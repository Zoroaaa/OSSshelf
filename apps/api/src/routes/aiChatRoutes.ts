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
import { authMiddleware, denyApiKeyAuth } from '../middleware';
import { aiRateLimit } from '../middleware/aiRateLimit';
import {
  getDb,
  aiChatSessions,
  aiChatMessages,
  aiMemories,
  aiModels,
  aiUsageEvents,
  aiTaskRuns,
  aiTaskSteps,
  aiTaskEvents,
} from '../db';
import { AgentMemory } from '../lib/ai/agentMemory';
import { completeText } from '../lib/ai/modelRuntime';
import { getActiveRun, getRunView, listRunEvents, resumeRun } from '../lib/ai/planRuntime';
import { buildToolCatalog } from '../lib/ai/toolCatalog';
import { AI_AGENT_DEFAULTS, getAiConfigNumber } from '../lib/ai/aiConfigService';
import { buildAgentInstanceName, issueWsTicket } from '../agents/auth';
import type { OSSShelfAgent } from '../agents/OSSShelfAgent';
import type { Env, Variables } from '../types/env';
import { logger } from '@osshelf/shared';
import { AppError, throwAppError } from '../middleware/error';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);
// 会话/记忆/任务涉及个人数据与模型计费，API Key 一律不可用（R9）
app.use('/*', denyApiKeyAuth());
app.use('/ws-ticket', aiRateLimit({ estimatedTokens: 0 }));
app.use('/sessions/:sessionId/title', aiRateLimit());

/** 标题清洗：去换行、去首尾引号、限长 */
function normalizeTitle(input: string, maxLength = 60): string {
  return input
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * 删除会话时同步清理任务编排数据。
 * ai_task_* 没有外键（D1 上无法保证级联），不清理会留下跨会话的任务与事件孤儿。
 */
async function purgeTaskData(db: ReturnType<typeof getDb>, sessionIds: string[]): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const slice = sessionIds.slice(i, i + CHUNK);
    const runs = await db
      .select({ id: aiTaskRuns.id })
      .from(aiTaskRuns)
      .where(inArray(aiTaskRuns.sessionId, slice))
      .all();
    const runIds = runs.map((run) => run.id);
    for (let j = 0; j < runIds.length; j += CHUNK) {
      const runSlice = runIds.slice(j, j + CHUNK);
      await db.delete(aiTaskEvents).where(inArray(aiTaskEvents.runId, runSlice));
      await db.delete(aiTaskSteps).where(inArray(aiTaskSteps.runId, runSlice));
    }
    await db.delete(aiTaskRuns).where(inArray(aiTaskRuns.sessionId, slice));
  }
}

app.post('/ws-ticket', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';

  if (!sessionId) {
    throwAppError('VALIDATION_ERROR', '缺少 sessionId');
  }

  const db = getDb(c.env.DB);
  const session = await db
    .select({ id: aiChatSessions.id })
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!session) {
    throwAppError('NOT_FOUND', '会话不存在');
  }

  const ticketTtlMs = Math.max(
    60_000,
    await getAiConfigNumber(c.env, 'ai.agent.ticket_ttl_ms', AI_AGENT_DEFAULTS.ticketTtlMs)
  );
  const ticket = await issueWsTicket(c.env, userId, sessionId, ticketTtlMs);
  return c.json({
    success: true,
    data: {
      ticket,
      agent: 'OSSShelfAgent',
      name: buildAgentInstanceName(userId, sessionId),
      expiresIn: Math.floor(ticketTtlMs / 1000),
    },
  });
});

/**
 * 工具目录：前端展示的 label/category 由后端定义派生，不再手写映射。
 * 只返回展示元数据，不含参数 schema 与执行器。
 */
app.get('/tools', (c) => {
  return c.json({ success: true, data: buildToolCatalog() });
});

/** 当前会话进行中的任务（前端计划条 / 续跑入口） */
app.get('/sessions/:sessionId/run', async (c) => {
  const userId = c.get('userId');
  if (!userId) throwAppError('UNAUTHORIZED', '未认证');
  const sessionId = c.req.param('sessionId');

  const session = await getDb(c.env.DB)
    .select({ id: aiChatSessions.id })
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();
  if (!session) throwAppError('NOT_FOUND', '会话不存在');

  const view = await getActiveRun(c.env, userId, sessionId);
  return c.json({ success: true, data: view });
});

app.get('/runs/:runId', async (c) => {
  const userId = c.get('userId');
  if (!userId) throwAppError('UNAUTHORIZED', '未认证');
  const view = await getRunView(c.env, userId, c.req.param('runId'));
  if (!view) throwAppError('NOT_FOUND', '任务不存在');
  return c.json({ success: true, data: view });
});

app.get('/runs/:runId/events', async (c) => {
  const userId = c.get('userId');
  if (!userId) throwAppError('UNAUTHORIZED', '未认证');
  const rawLimit = parseInt(c.req.query('limit') || '100', 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
  const events = await listRunEvents(c.env, userId, c.req.param('runId'), limit);
  return c.json({ success: true, data: events });
});

/**
 * 续跑入口：把中断遗留的步骤退回 pending 并恢复 run。
 * 真正的续跑由前端发一条「继续执行」消息触发，Agent 通过 L1 任务状态从当前步骤继续，
 * 不在服务端重放历史工具调用。
 */
app.post('/runs/:runId/resume', async (c) => {
  const userId = c.get('userId');
  if (!userId) throwAppError('UNAUTHORIZED', '未认证');
  const view = await resumeRun(c.env, userId, c.req.param('runId'));
  if (!view) throwAppError('NOT_FOUND', '任务不存在');
  return c.json({
    success: true,
    data: {
      run: view.run,
      steps: view.steps,
      resumeMessage: '继续执行未完成的任务，从当前步骤接着做，不要重复已完成的步骤。',
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
            .select({
              sessionId: aiChatMessages.sessionId,
              cnt: count(aiChatMessages.id),
              // 工具调用数按审计镜像里每轮 tool_calls JSON 长度求和：即便 ai_usage_events 缺行也能给出累计值
              toolCalls: sql<number>`coalesce(sum(case when json_valid(${aiChatMessages.toolCalls}) then json_array_length(${aiChatMessages.toolCalls}) else 0 end), 0)`,
            })
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
    const messageToolCallMap = new Map(msgCounts.map((row) => [row.sessionId, row.toolCalls ?? 0]));

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
          lastToolCallCount: Math.max(
            usage?.toolCalls ?? 0,
            session.lastToolCallCount ?? 0,
            messageToolCallMap.get(session.id) ?? 0
          ),
        };
      }),
    });
  } catch (error) {
    logger.error('AI Chat', 'Failed to get sessions', { userId }, error);
    throwAppError('INTERNAL_ERROR', '获取会话列表失败');
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
      .where(eq(aiChatSessions.id, sessionId))
      .get();

    if (existing) {
      throwAppError('CONFLICT', '会话 ID 已存在');
    }

    const newSession = {
      id: sessionId,
      userId,
      title: safeTitle,
      modelId: modelId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.insert(aiChatSessions).values(newSession);

    return c.json({ success: true, data: newSession });
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error('AI Chat', 'Failed to create session', { userId }, error);
    throwAppError('INTERNAL_ERROR', '创建会话失败');
  }
});

app.put('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const modelId = typeof body?.modelId === 'string' && body.modelId.trim() ? body.modelId.trim() : undefined;

  // 标题与模型可以单独更新：会话内切模型不能要求前端同时提交标题
  if (!title && !modelId) {
    throwAppError('VALIDATION_ERROR', '标题或模型不能为空');
  }

  try {
    const db = getDb(c.env.DB);
    const existing = await db
      .select({ id: aiChatSessions.id })
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
      .get();

    if (!existing) {
      throwAppError('NOT_FOUND', '会话不存在');
    }

    if (modelId) {
      // 只能选择自己名下且可用的模型，防止把别人的模型 id 写进会话
      const model = await db
        .select({ id: aiModels.id, isActive: aiModels.isActive })
        .from(aiModels)
        .where(and(eq(aiModels.id, modelId), eq(aiModels.userId, userId)))
        .get();
      if (!model) {
        throwAppError('NOT_FOUND', '模型不存在');
      }
    }

    await db
      .update(aiChatSessions)
      .set({
        ...(title ? { title } : {}),
        ...(modelId ? { modelId } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { id: sessionId, ...(title ? { title } : {}), ...(modelId ? { modelId } : {}) } });
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error('AI Chat', 'Failed to update session', { userId, sessionId }, error);
    throwAppError('INTERNAL_ERROR', '更新会话失败');
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
    throwAppError('NOT_FOUND', '会话不存在');
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

    const response = await completeText(c.env, userId, {
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
    c.set('aiUsageTokens', (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0));
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
    throwAppError('NOT_FOUND', '会话不存在');
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
    await purgeTaskData(db, ids);
    await db.delete(aiChatSessions).where(eq(aiChatSessions.userId, userId));
  } catch (error) {
    logger.error('AI Chat', 'Failed to clear sessions', { userId }, error);
    throwAppError('INTERNAL_ERROR', '清空会话失败');
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
    throwAppError('NOT_FOUND', '会话不存在');
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
    await purgeTaskData(db, [sessionId]);
    await db.delete(aiChatSessions).where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { message: '会话已删除' } });
  } catch (error) {
    logger.error('AI Chat', 'Failed to delete session', { userId, sessionId }, error);
    throwAppError('INTERNAL_ERROR', '删除会话失败');
  }
});

app.get('/memories', async (c) => {
  const userId = c.get('userId')!;
  const type = c.req.query('type');
  const rawLimit = parseInt(c.req.query('limit') || '50', 10);
  const rawOffset = parseInt(c.req.query('offset') || '0', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  try {
    const memory = new AgentMemory(c.env);
    const result = await memory.listMemories(userId, { type, limit, offset });
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('AI Chat', 'List memories failed', { userId }, error);
    throwAppError('INTERNAL_ERROR', '获取记忆列表失败');
  }
});

app.post('/memories/batch-delete', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json().catch(() => ({}));
  const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  const ids = rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 200);

  if (ids.length === 0) {
    throwAppError('VALIDATION_ERROR', '请提供记忆ID列表');
  }

  try {
    const memory = new AgentMemory(c.env);
    const deleted = await memory.deleteMemories(ids, userId);
    return c.json({ success: true, data: { deleted } });
  } catch (error) {
    logger.error('AI Chat', 'Batch delete memories failed', { userId, count: ids.length }, error);
    throwAppError('INTERNAL_ERROR', '批量删除记忆失败');
  }
});

app.delete('/memories', async (c) => {
  const userId = c.get('userId')!;

  try {
    const memory = new AgentMemory(c.env);
    const deleted = await memory.deleteAllMemories(userId);
    return c.json({ success: true, data: { deleted } });
  } catch (error) {
    logger.error('AI Chat', 'Delete all memories failed', { userId }, error);
    throwAppError('INTERNAL_ERROR', '清空记忆失败');
  }
});

app.delete('/memories/:id', async (c) => {
  const userId = c.get('userId')!;
  const memoryId = c.req.param('id');

  try {
    const memory = new AgentMemory(c.env);
    const success = await memory.deleteMemory(memoryId, userId);
    if (!success) {
      throwAppError('NOT_FOUND', '记忆不存在');
    }
    return c.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error('AI Chat', 'Delete memory failed', { userId, memoryId }, error);
    throwAppError('INTERNAL_ERROR', '删除记忆失败');
  }
});

export default app;
