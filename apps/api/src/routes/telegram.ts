/**
 * telegram.ts
 * Telegram 存储专用路由
 *
 * 功能:
 * - Telegram Bot 配置管理
 * - 文件上传/下载
 * - 消息发送
 * - Webhook 处理
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { getEncryptionKey } from '../lib/crypto';
import { getDb } from '../db';
import {
  testTelegramConnection,
  listTelegramBuckets,
} from '../services/telegram.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const testConnectionSchema = z.object({
  botToken: z.string().min(10, 'Bot Token 不能为空'),
  chatId: z.string().min(1, 'Chat ID 不能为空'),
  apiBase: z.string().url('代理地址必须是有效的 URL').optional().or(z.literal('')),
});

app.post('/test', async (c) => {
  const body = await c.req.json();
  const result = testConnectionSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const userId = c.get('userId')!;

  const tgResult = await testTelegramConnection(db, encKey, userId, {
    botToken: result.data.botToken,
    chatId: result.data.chatId,
    apiBase: result.data.apiBase || undefined,
  });

  return c.json({
    success: tgResult.connected,
    data: {
      connected: tgResult.connected,
      message: tgResult.message,
      botName: tgResult.botName,
      chatTitle: tgResult.chatTitle,
    },
  });
});

app.get('/buckets', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const buckets = await listTelegramBuckets(db, userId);
  return c.json({ success: true, data: buckets });
});

export default app;
