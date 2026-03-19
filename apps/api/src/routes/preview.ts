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
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, users } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, CODE_HIGHLIGHT_EXTENSIONS, OFFICE_MIME_TYPES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { s3Get } from '../lib/s3client';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { verifyJWT, getEncryptionKey } from '../lib/crypto';
import type { Context, MiddlewareHandler } from 'hono';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

type AppEnv = { Bindings: Env; Variables: Variables };

async function verifyTokenFromQuery(
  c: Context<AppEnv>
): Promise<{ userId: string; email: string; role: string } | null> {
  const token = c.req.query('token');
  if (!token) return null;

  try {
    const decoded = await verifyJWT(token, c.env.JWT_SECRET);
    // 与 authMiddleware 保持一致：校验 KV session 是否仍有效（防止已注销的 token 仍可预览）
    const session = await c.env.KV.get(`session:${token}`);
    if (!session) return null;
    return decoded;
  } catch {
    return null;
  }
}

const previewAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const decoded = await verifyTokenFromQuery(c);
  if (decoded) {
    c.set('userId', decoded.userId);
    c.set('user', { id: decoded.userId, email: decoded.email, role: decoded.role });
    return next();
  }
  return authMiddleware(c, next);
};

app.use('*', previewAuthMiddleware);

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '';
}

function getLanguageFromExtension(ext: string): string | null {
  return CODE_HIGHLIGHT_EXTENSIONS[ext] || null;
}

function isPreviewable(mimeType: string | null, fileName: string): { previewable: boolean; type: string } {
  if (!mimeType) {
    const ext = getFileExtension(fileName);
    if (CODE_HIGHLIGHT_EXTENSIONS[ext]) {
      return { previewable: true, type: 'code' };
    }
    return { previewable: false, type: 'unknown' };
  }

  if (mimeType.startsWith('image/')) {
    return { previewable: true, type: 'image' };
  }
  if (mimeType.startsWith('video/')) {
    return { previewable: true, type: 'video' };
  }
  if (mimeType.startsWith('audio/')) {
    return { previewable: true, type: 'audio' };
  }
  if (mimeType === 'application/pdf') {
    return { previewable: true, type: 'pdf' };
  }
  if (mimeType.startsWith('text/')) {
    if (mimeType === 'text/markdown' || fileName.endsWith('.md')) {
      return { previewable: true, type: 'markdown' };
    }
    return { previewable: true, type: 'text' };
  }
  if (mimeType === 'application/json' || mimeType === 'application/xml') {
    return { previewable: true, type: 'code' };
  }

  const ext = getFileExtension(fileName);
  if (CODE_HIGHLIGHT_EXTENSIONS[ext]) {
    return { previewable: true, type: 'code' };
  }

  if (OFFICE_MIME_TYPES.includes(mimeType as (typeof OFFICE_MIME_TYPES)[number])) {
    return { previewable: true, type: 'office' };
  }

  return { previewable: false, type: 'unknown' };
}

app.get('/:id/info', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (file.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '文件夹无法预览' } }, 400);
  }

  const { previewable, type } = isPreviewable(file.mimeType, file.name);

  const ext = getFileExtension(file.name);
  const language = getLanguageFromExtension(ext);

  return c.json({
    success: true,
    data: {
      id: file.id,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      previewable,
      previewType: type,
      language,
      extension: ext,
      canPreview: previewable && file.size <= MAX_PREVIEW_SIZE,
    },
  });
});

app.get('/:id/raw', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (file.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '文件夹无法预览' } }, 400);
  }

  if (file.size > MAX_PREVIEW_SIZE) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.FILE_TOO_LARGE, message: '文件过大，无法在线预览' } },
      400
    );
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404);
  }

  const content = await s3Res.text();

  return c.json({
    success: true,
    data: {
      content,
      mimeType: file.mimeType,
      name: file.name,
      size: file.size,
    },
  });
});

app.get('/:id/stream', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (file.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '文件夹无法预览' } }, 400);
  }

  const { type } = isPreviewable(file.mimeType, file.name);
  if (!['image', 'video', 'audio', 'pdf'].includes(type)) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该文件类型不支持流式预览' } },
      400
    );
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const range = c.req.header('Range');
  const s3Res = await s3Get(bucketConfig, file.r2Key);

  if (!s3Res.ok) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404);
  }

  const headers: Record<string, string> = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Length': file.size.toString(),
    'Accept-Ranges': 'bytes',
  };

  if (type === 'video' || type === 'audio') {
    headers['Content-Disposition'] = 'inline';
  }

  return new Response(s3Res.body, { headers });
});

app.get('/:id/thumbnail', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const width = parseInt(c.req.query('width') || '256', 10);
  const height = parseInt(c.req.query('height') || '256', 10);

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (!file.mimeType?.startsWith('image/')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只支持图片文件生成缩略图' } },
      400
    );
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404);
  }

  const imageBuffer = await s3Res.arrayBuffer();

  return new Response(imageBuffer, {
    headers: {
      'Content-Type': file.mimeType,
      'Cache-Control': 'public, max-age=31536000',
      'X-Thumbnail-Size': `${width}x${height}`,
    },
  });
});

app.get('/:id/office', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (!OFFICE_MIME_TYPES.includes(file.mimeType as (typeof OFFICE_MIME_TYPES)[number])) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '不支持该文件类型' } }, 400);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404);
  }

  const fileBuffer = await s3Res.arrayBuffer();
  const base64Content = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

  return c.json({
    success: true,
    data: {
      fileName: file.name,
      mimeType: file.mimeType,
      base64Content,
      size: file.size,
    },
  });
});

export default app;
