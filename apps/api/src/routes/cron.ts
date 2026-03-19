/**
 * cron.ts
 * 定时任务路由
 *
 * 功能:
 * - 回收站自动清理
 * - 会话/设备自动清理
 * - 分享链接过期清理
 * - 全量清理任务
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import type { Env } from '../types/env';
import {
  runTrashCleanup,
  runSessionCleanup,
  runShareCleanup,
  runAllCleanupTasks,
} from '../services/cron.service';

const app = new Hono<{ Bindings: Env }>();

app.post('/cron/trash-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const result = await runTrashCleanup(c.env, db);
  return c.json({ success: true, data: result });
});

app.post('/cron/session-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const result = await runSessionCleanup(c.env, db);
  return c.json({ success: true, data: result });
});

app.post('/cron/share-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const result = await runShareCleanup(db);
  return c.json({ success: true, data: result });
});

app.post('/cron/all', async (c) => {
  const db = getDb(c.env.DB);
  const results = await runAllCleanupTasks(c.env, db);
  return c.json({ success: true, data: results });
});

export default app;
