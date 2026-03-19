/**
 * preview.ts
 * 文件预览路由
 *
 * 功能:
 * - 获取预览信息（类型、语言等）
 * - 获取原始文本内容
 * - 流媒体预览
 * - 缩略图生成
 * - Office文档预览
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, OFFICE_MIME_TYPES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { getEncryptionKey, verifyJWT } from '../lib/crypto';
import type { Context, MiddlewareHandler } from 'hono';
import {
  getPreviewInfo,
  getRawContent,
  getStreamContent,
  getThumbnail,
  getOfficePreview,
  verifyTokenFromQuery,
} from '../services/preview.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

type AppEnv = { Bindings: Env; Variables: Variables };

const previewAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.query('token');
  if (token) {
    const decoded = await verifyTokenFromQuery(c.env, token);
    if (decoded) {
      c.set('userId', decoded.userId);
      c.set('user', { id: decoded.userId, email: decoded.email, role: decoded.role });
      return next();
    }
  }
  return authMiddleware(c, next);
};

app.use('*', previewAuthMiddleware);

app.get('/:id/info', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const result = await getPreviewInfo(db, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

app.get('/:id/raw', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await getRawContent(c.env, db, encKey, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

app.get('/:id/stream', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await getStreamContent(c.env, db, encKey, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return new Response(result.data!.body, { headers: result.data!.headers });
});

app.get('/:id/thumbnail', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const width = parseInt(c.req.query('width') || '256', 10);
  const height = parseInt(c.req.query('height') || '256', 10);

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await getThumbnail(c.env, db, encKey, userId, fileId, width, height);

  if (!result.success) {
    const statusCode = result.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return new Response(result.data!.buffer, { headers: result.data!.headers });
});

app.get('/:id/office', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await getOfficePreview(c.env, db, encKey, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

export default app;
