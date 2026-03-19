/**
 * share.ts
 * 文件分享路由
 *
 * 功能:
 * - 创建分享链接
 * - 分享权限管理
 * - 分享文件预览与下载
 * - 密码保护与访问限制
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { getEncryptionKey } from '../lib/crypto';
import {
  createShare,
  listUserShares,
  deleteShare,
  getShareInfo,
  getSharePreview,
  downloadSharedFile,
} from '../services/share.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createShareSchema = z.object({
  fileId: z.string().min(1, '文件ID不能为空'),
  password: z.string().min(4, '密码至少4个字符').max(32).optional(),
  expiresAt: z.string().datetime().optional(),
  downloadLimit: z.number().int().min(1).max(1000).optional(),
});

app.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createShareSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const shareResult = await createShare(c.env, getDb(c.env.DB), userId, result.data);

  if (!shareResult.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: shareResult.error } }, 404);
  }

  return c.json({ success: true, data: shareResult.data });
});

app.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const shares = await listUserShares(getDb(c.env.DB), userId);
  return c.json({ success: true, data: shares });
});

app.delete('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const shareId = c.req.param('id');

  const result = await deleteShare(getDb(c.env.DB), userId, shareId);

  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, 404);
  }

  return c.json({ success: true, data: { message: '分享已删除' } });
});

app.get('/:id/info', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');

  const result = await getShareInfo(getDb(c.env.DB), shareId, password);

  if (!result.success) {
    const statusCode = 'status' in result ? result.status : 400;
    return c.json({ success: false, error: result.error }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

app.get('/:id/preview', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');

  const result = await getSharePreview(c.env, getDb(c.env.DB), shareId, password);

  if (!result.success) {
    const statusCode = 'status' in result ? result.status : 400;
    return c.json({ success: false, error: result.error }, statusCode);
  }

  return new Response(result.data!.body, { headers: result.data!.headers });
});

app.get('/:id/download', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');

  const result = await downloadSharedFile(c.env, getDb(c.env.DB), shareId, password);

  if (!result.success) {
    const statusCode = 'status' in result ? result.status : 400;
    return c.json({ success: false, error: result.error }, statusCode);
  }

  return new Response(result.data!.body, { headers: result.data!.headers });
});

export default app;
