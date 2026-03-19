/**
 * telegram.ts
 * Telegram 存储专用路由
 *
 * POST /api/telegram/test          — 测试 Bot 连通性（临时配置，不保存）
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { tgTestConnection } from '../lib/telegramClient';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

// ── POST /api/telegram/test ───────────────────────────────────────────────
// 传入临时配置验证 Bot Token + Chat ID，不保存到数据库
app.post('/test', async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    botToken: z.string().min(10, 'Bot Token 不能为空'),
    chatId: z.string().min(1, 'Chat ID 不能为空'),
    apiBase: z.string().url('代理地址必须是有效的 URL').optional().or(z.literal('')),
  });

  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const tgResult = await tgTestConnection({
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

export default app;
