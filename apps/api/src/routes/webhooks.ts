/**
 * webhooks.ts
 * Webhook 管理路由
 *
 * 功能:
 * - 创建/列出/删除 Webhook
 * - 测试 Webhook
 * - 查看 Webhook 日志
 */

import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, webhooks } from '../db';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { dispatchWebhook, WEBHOOK_EVENTS, type WebhookEvent } from '../lib/webhook';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const VALID_EVENTS: WebhookEvent[] = [
  'file.uploaded',
  'file.deleted',
  'file.updated',
  'share.created',
  'share.deleted',
  'permission.granted',
  'permission.revoked',
];

const createWebhookSchema = z.object({
  url: z.string().url('请输入有效的 URL'),
  events: z.array(z.string()).min(1, '至少选择一个事件'),
  secret: z.string().min(8, '密钥至少 8 个字符').optional(),
});

app.get('/events', (c) => {
  return c.json({
    success: true,
    data: WEBHOOK_EVENTS,
  });
});

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const hooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.userId, userId))
    .orderBy(desc(webhooks.createdAt))
    .all();

  return c.json({
    success: true,
    data: hooks.map((h) => ({
      ...h,
      events: JSON.parse(h.events),
      secret: undefined,
    })),
  });
});

app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createWebhookSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { url, events, secret } = result.data;

  const invalidEvents = events.filter((e) => e !== '*' && !VALID_EVENTS.includes(e as WebhookEvent));
  if (invalidEvents.length > 0) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: `无效的事件类型: ${invalidEvents.join(', ')}` },
      },
      400
    );
  }

  const webhookSecret = secret || generateSecret();

  const webhookId = crypto.randomUUID();
  const now = new Date().toISOString();

  const db = getDb(c.env.DB);
  await db.insert(webhooks).values({
    id: webhookId,
    userId,
    url,
    secret: webhookSecret,
    events: JSON.stringify(events),
    isActive: true,
    lastStatus: null,
    createdAt: now,
  });

  await createAuditLog({
    env: c.env,
    userId,
    action: 'webhook.create',
    resourceType: 'webhook',
    resourceId: webhookId,
    details: { url, events },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({
    success: true,
    data: {
      id: webhookId,
      url,
      secret: webhookSecret,
      events,
      isActive: true,
      warning: '请妥善保存此密钥，系统不会再次显示',
    },
  });
});

app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const webhookId = c.req.param('id');
  const db = getDb(c.env.DB);

  const webhook = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
    .get();

  if (!webhook) {
    throwAppError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
  }

  return c.json({
    success: true,
    data: {
      ...webhook,
      events: JSON.parse(webhook!.events),
      secret: undefined,
    },
  });
});

app.put('/:id', async (c) => {
  const userId = c.get('userId')!;
  const webhookId = c.req.param('id');
  const body = await c.req.json();
  const db = getDb(c.env.DB);

  const webhook = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
    .get();

  if (!webhook) {
    throwAppError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
  }

  const updateData: Record<string, unknown> = {};

  if (body.url !== undefined) {
    if (!z.string().url().safeParse(body.url).success) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请输入有效的 URL' } },
        400
      );
    }
    updateData.url = body.url;
  }

  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '至少选择一个事件' } },
        400
      );
    }
    const invalidEvents = body.events.filter((e: string) => e !== '*' && !VALID_EVENTS.includes(e as WebhookEvent));
    if (invalidEvents.length > 0) {
      return c.json(
        {
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: `无效的事件类型: ${invalidEvents.join(', ')}` },
        },
        400
      );
    }
    updateData.events = JSON.stringify(body.events);
  }

  if (body.isActive !== undefined) {
    updateData.isActive = !!body.isActive;
  }

  if (Object.keys(updateData).length === 0) {
    return c.json({ success: true, data: { message: '无更新' } });
  }

  await db.update(webhooks).set(updateData).where(eq(webhooks.id, webhookId));

  await createAuditLog({
    env: c.env,
    userId,
    action: 'webhook.update',
    resourceType: 'webhook',
    resourceId: webhookId,
    details: updateData,
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: 'Webhook 已更新' } });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const webhookId = c.req.param('id');
  const db = getDb(c.env.DB);

  const webhook = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
    .get();

  if (!webhook) {
    throwAppError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'webhook.delete',
    resourceType: 'webhook',
    resourceId: webhookId,
    details: { url: webhook.url },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  await db.delete(webhooks).where(eq(webhooks.id, webhookId));

  return c.json({ success: true, data: { message: 'Webhook 已删除' } });
});

app.post('/:id/test', async (c) => {
  const userId = c.get('userId')!;
  const webhookId = c.req.param('id');
  const db = getDb(c.env.DB);

  const webhook = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
    .get();

  if (!webhook) {
    throwAppError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
  }

  await dispatchWebhook(c.env, userId, 'file.uploaded', {
    test: true,
    message: '这是一个测试事件',
    triggeredAt: new Date().toISOString(),
  });

  return c.json({ success: true, data: { message: '测试事件已发送' } });
});

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default app;
