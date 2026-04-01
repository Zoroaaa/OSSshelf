/**
 * webhook.ts
 * Webhook 事件分发库
 *
 * 功能:
 * - 事件分发
 * - 签名生成
 * - 重试机制
 */

import { eq, and } from 'drizzle-orm';
import { getDb, webhooks } from '../db';
import type { Env } from '../types/env';

export type WebhookEvent =
  | 'file.uploaded'
  | 'file.deleted'
  | 'file.updated'
  | 'share.created'
  | 'share.deleted'
  | 'permission.granted'
  | 'permission.revoked';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export const WEBHOOK_EVENTS: Array<{ value: WebhookEvent | '*'; label: string; description: string }> = [
  { value: '*', label: '所有事件', description: '接收所有事件通知' },
  { value: 'file.uploaded', label: '文件上传', description: '文件上传成功时触发' },
  { value: 'file.deleted', label: '文件删除', description: '文件被删除时触发' },
  { value: 'file.updated', label: '文件更新', description: '文件内容更新时触发' },
  { value: 'share.created', label: '分享创建', description: '创建分享链接时触发' },
  { value: 'share.deleted', label: '分享删除', description: '删除分享链接时触发' },
  { value: 'permission.granted', label: '权限授予', description: '授予权限时触发' },
  { value: 'permission.revoked', label: '权限撤销', description: '撤销权限时触发' },
];

export async function dispatchWebhook(
  env: Env,
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  const db = getDb(env.DB);

  const hooks = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.userId, userId), eq(webhooks.isActive, true)))
    .all();

  if (hooks.length === 0) {
    return;
  }

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const dispatchPromises = hooks
    .filter((hook) => {
      const events = JSON.parse(hook.events) as (WebhookEvent | '*')[];
      return events.includes('*') || events.includes(event);
    })
    .map((hook) => sendWebhookRequest(env, hook, payload));

  await Promise.allSettled(dispatchPromises);
}

async function sendWebhookRequest(
  env: Env,
  webhook: typeof webhooks.$inferSelect,
  payload: WebhookPayload
): Promise<void> {
  const db = getDb(env.DB);
  const body = JSON.stringify(payload);
  const signature = await hmacSha256(webhook.secret, body);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': payload.event,
        'X-Webhook-Timestamp': payload.timestamp,
        'User-Agent': 'OSSShelf-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    await db.update(webhooks).set({ lastStatus: response.status }).where(eq(webhooks.id, webhook.id));

    if (!response.ok) {
      console.error(`Webhook ${webhook.id} failed with status ${response.status}`);
    }
  } catch (error) {
    await db.update(webhooks).set({ lastStatus: 0 }).where(eq(webhooks.id, webhook.id));

    console.error(`Webhook ${webhook.id} request failed:`, error);
  }
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const hexArray = Array.from(new Uint8Array(signature));
  return hexArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function verifyWebhookSignature(secret: string, signature: string, body: string): Promise<boolean> {
  return hmacSha256(secret, body).then((computed) => computed === signature);
}

export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
