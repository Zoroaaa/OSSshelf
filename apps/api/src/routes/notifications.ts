/**
 * notifications.ts
 * 通知系统路由
 *
 * 功能:
 * - 获取通知列表
 * - 未读数量统计
 * - 标记已读
 * - 删除通知
 */

import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb, notifications } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Env, Variables } from '../types/env';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const db = getDb(c.env.DB);

  const conditions = [eq(notifications.userId, userId)];
  if (unreadOnly) conditions.push(eq(notifications.isRead, false));

  const offset = (page - 1) * limit;

  const items = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(and(...conditions))
    .get();

  const total = countResult?.count || 0;

  return c.json({
    success: true,
    data: {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

app.get('/unread-count', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .get();

  return c.json({
    success: true,
    data: { count: result?.count || 0 },
  });
});

app.put('/:id/read', async (c) => {
  const userId = c.get('userId')!;
  const notificationId = c.req.param('id');
  const db = getDb(c.env.DB);

  const notification = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .get();

  if (!notification) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '通知不存在' } }, 404);
  }

  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, notificationId));

  return c.json({ success: true, data: { message: '已标记为已读' } });
});

app.put('/read-all', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return c.json({ success: true, data: { message: '已全部标记为已读' } });
});

app.delete('/read', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  await db.delete(notifications).where(and(eq(notifications.userId, userId), eq(notifications.isRead, true)));

  return c.json({ success: true, data: { message: '已清除已读通知' } });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const notificationId = c.req.param('id');
  const db = getDb(c.env.DB);

  const notification = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .get();

  if (!notification) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '通知不存在' } }, 404);
  }

  await db.delete(notifications).where(eq(notifications.id, notificationId));

  return c.json({ success: true, data: { message: '已删除' } });
});

export async function createNotification(
  db: ReturnType<typeof getDb>,
  env: Env,
  data: {
    userId: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, any>;
  }
) {
  const id = crypto.randomUUID();
  await db.insert(notifications).values({
    id,
    userId: data.userId,
    type: data.type,
    title: data.title,
    body: data.body || null,
    data: data.data ? JSON.stringify(data.data) : null,
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export default app;
