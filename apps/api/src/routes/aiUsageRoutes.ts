/**
 * routes/aiUsageRoutes.ts
 * AI 用量查询
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware';
import { getUsageSummary, getQuotaStatus } from '../lib/ai/usage';
import type { Env, Variables } from '../types/env';
import { logger } from '@osshelf/shared';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

app.get('/summary', async (c) => {
  const userId = c.get('userId')!;
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '7', 10) || 7, 1), 90);

  try {
    const summary = await getUsageSummary(c.env, userId, days);
    return c.json({ success: true, data: { days, ...summary } });
  } catch (error) {
    logger.error('AI_USAGE', 'Failed to get usage summary', { userId }, error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: '获取用量统计失败' } }, 500);
  }
});

app.get('/quota', async (c) => {
  const userId = c.get('userId')!;

  try {
    const quota = await getQuotaStatus(c.env, userId);
    return c.json({ success: true, data: quota });
  } catch (error) {
    logger.error('AI_USAGE', 'Failed to get quota status', { userId }, error);
    return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: '获取配额状态失败' } }, 500);
  }
});

export default app;
