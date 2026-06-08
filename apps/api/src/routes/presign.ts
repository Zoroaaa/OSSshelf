/**
 * presign.ts
 * 预签名URL路由
 *
 * 功能:
 * - 生成预签名上传URL
 * - 生成预签名下载URL
 *
 * 浏览器直接与对象存储交互，无需服务器代理
 *
 * 端点:
 * - POST /api/presign/upload - 获取上传URL
 * - GET /api/presign/download/:id - 获取下载URL
 * - GET /api/presign/preview/:id - 获取预览URL
 */

import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, isPreviewableMimeType } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import { getEncryptionKey } from '../lib/crypto';
import type { Env, Variables } from '../types/env';
import { s3PresignUrl } from '../lib/s3client';
import { resolveBucketConfig } from '../lib/bucketResolver';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

// ── Shared helpers ─────────────────────────────────────────────────────────

/** 6-hour download expiry (large files take time) */
const DOWNLOAD_EXPIRY = 21600;

// ── GET /api/presign/download/:id ─────────────────────────────────────────

app.get('/download/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '无法下载文件夹');

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    // Fall back to proxy download
    return c.json({ success: true, data: { useProxy: true, proxyUrl: `/api/files/${fileId}/download` } });
  }

  // Telegram 桶不支持预签名下载，让前端使用代理下载
  if (bucketConfig.provider === 'telegram') {
    return c.json({ success: true, data: { useProxy: true, proxyUrl: `/api/files/${fileId}/download` } });
  }

  const downloadUrl = await s3PresignUrl(bucketConfig, 'GET', file.r2Key, DOWNLOAD_EXPIRY);

  return c.json({
    success: true,
    data: {
      downloadUrl,
      fileName: file.name,
      mimeType: file.mimeType,
      size: file.size,
      expiresIn: DOWNLOAD_EXPIRY,
    },
  });
});

// ── GET /api/presign/preview/:id ──────────────────────────────────────────

app.get('/preview/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '文件夹无法预览');

  if (!isPreviewableMimeType(file.mimeType, file.name)) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该文件类型不支持预览' } },
      400
    );
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: true, data: { useProxy: true, proxyUrl: `/api/files/${fileId}/preview` } });
  }

  // Telegram 桶不支持预签名预览，让前端使用代理预览
  if (bucketConfig.provider === 'telegram') {
    return c.json({ success: true, data: { useProxy: true, proxyUrl: `/api/files/${fileId}/preview` } });
  }

  // Shorter TTL for previews — 2 hours
  const previewUrl = await s3PresignUrl(bucketConfig, 'GET', file.r2Key, 7200);

  return c.json({
    success: true,
    data: {
      previewUrl,
      mimeType: file.mimeType,
      size: file.size,
      expiresIn: 7200,
    },
  });
});

export default app;
