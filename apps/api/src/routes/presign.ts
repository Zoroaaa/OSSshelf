/**
 * presign.ts
 * 预签名URL路由
 *
 * 功能:
 * - 生成预签名上传URL
 * - 生成预签名下载URL
 * - 分片上传初始化与管理
 * - 上传确认与完成
 *
 * 浏览器直接与对象存储交互，无需服务器代理
 *
 * 端点:
 * - POST /api/presign/upload - 获取上传URL
 * - POST /api/presign/multipart/init - 初始化分片上传
 * - POST /api/presign/multipart/part - 获取分片上传URL
 * - POST /api/presign/multipart/complete - 完成分片上传
 * - POST /api/presign/multipart/abort - 取消分片上传
 * - GET /api/presign/download/:id - 获取下载URL
 * - GET /api/presign/preview/:id - 获取预览URL
 */

import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, users, storageBuckets } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, MAX_FILE_SIZE, isPreviewableMimeType } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import { getEncryptionKey } from '../lib/crypto';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import {
  s3PresignUrl,
  s3PresignUploadPart,
  s3CreateMultipartUpload,
  s3CompleteMultipartUpload,
  s3AbortMultipartUpload,
  s3UploadPart,
  type MultipartPart,
} from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, updateUserStorage, checkBucketQuota } from '../lib/bucketResolver';
import { checkFolderMimeTypeRestriction } from '../lib/folderPolicy';
import { getUserOrFail, encodeFilename } from '../lib/utils';
import { computeSha256Hex, checkAndClaimDedup, releaseFileRef } from '../lib/dedup';
import { indexFileVector, buildFileTextForVector, isAIConfigured } from '../lib/vectorIndex';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

// ── Validation schemas ─────────────────────────────────────────────────────

const presignUploadSchema = z.object({
  fileName: z.string().min(1, '文件名不能为空').max(1024),
  fileSize: z.number().int().min(1).max(MAX_FILE_SIZE),
  mimeType: z.string().optional().default('application/octet-stream'),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
});

const presignConfirmSchema = z.object({
  fileId: z.string().min(1),
  fileName: z.string().min(1).max(1024),
  fileSize: z.number().int().min(1),
  mimeType: z.string().optional().default('application/octet-stream'),
  parentId: z.string().nullable().optional(),
  r2Key: z.string().min(1),
  bucketId: z.string().nullable().optional(),
});

const multipartInitSchema = z.object({
  fileName: z.string().min(1).max(1024),
  fileSize: z.number().int().min(1),
  mimeType: z.string().optional().default('application/octet-stream'),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
});

const multipartPartSchema = z.object({
  r2Key: z.string().min(1),
  uploadId: z.string().min(1),
  partNumber: z.number().int().min(1).max(10000),
  bucketId: z.string().nullable().optional(),
});

const multipartCompleteSchema = z.object({
  fileId: z.string().min(1),
  fileName: z.string().min(1).max(1024),
  fileSize: z.number().int().min(1),
  mimeType: z.string().optional().default('application/octet-stream'),
  parentId: z.string().nullable().optional(),
  r2Key: z.string().min(1),
  uploadId: z.string().min(1),
  bucketId: z.string().nullable().optional(),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1),
        etag: z.string().min(1),
      })
    )
    .min(1),
});

const multipartAbortSchema = z.object({
  r2Key: z.string().min(1),
  uploadId: z.string().min(1),
  bucketId: z.string().nullable().optional(),
});

// ── Shared helpers ─────────────────────────────────────────────────────────

/** 1-hour presign window for upload, 6-hour for download (large files take time) */
const UPLOAD_EXPIRY = 3600;
const DOWNLOAD_EXPIRY = 21600;

// ── POST /api/presign/upload ───────────────────────────────────────────────
// Phase 1: Return a presigned PUT URL. The browser uploads directly.
// Phase 2: Browser calls /confirm after a successful upload.

app.post('/upload', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = presignUploadSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileName, fileSize, mimeType, parentId, bucketId: requestedBucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId, mimeType);
  if (!mimeCheck.allowed) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}`,
        },
      },
      400
    );
  }

  const user = await getUserOrFail(db, userId);
  if (user.storageUsed + fileSize > user.storageQuota) {
    throwAppError('STORAGE_EXCEEDED', '用户存储配额已满');
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId, parentId);

  // No S3 config → tell frontend to use the proxy upload route
  if (!bucketConfig) {
    return c.json({ success: true, data: { useProxy: true } });
  }

  // Telegram 桶不支持预签名上传，让前端使用代理上传
  if (bucketConfig.provider === 'telegram') {
    return c.json({ success: true, data: { useProxy: true, bucketId: bucketConfig.id } });
  }

  // Check per-bucket quota
  const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
  if (quotaErr) {
    throwAppError('STORAGE_EXCEEDED', quotaErr);
  }

  const fileId = crypto.randomUUID();
  const r2Key = `files/${userId}/${fileId}/${encodeFilename(fileName)}`;

  const uploadUrl = await s3PresignUrl(bucketConfig, 'PUT', r2Key, UPLOAD_EXPIRY, mimeType);

  return c.json({
    success: true,
    data: {
      uploadUrl,
      fileId,
      r2Key,
      bucketId: bucketConfig.id,
      expiresIn: UPLOAD_EXPIRY,
    },
  });
});

// ── POST /api/presign/confirm ──────────────────────────────────────────────
// Called by the browser after a successful direct PUT upload.
// Creates the DB record and updates storage stats.

app.post('/confirm', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = presignConfirmSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, fileName, fileSize, mimeType, parentId, r2Key, bucketId } = result.data;
  const db = getDb(c.env.DB);

  // Guard: check file ID not already used (idempotency protection)
  const existing = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (existing) {
    return c.json({ success: true, data: { id: existing.id, name: existing.name, alreadyConfirmed: true } });
  }

  const now = new Date().toISOString();
  const path = parentId ? `${parentId}/${fileName}` : `/${fileName}`;

  // Note: presign confirm receives the final hash from client (or null if unsupported).
  // Server-side hash computation is not possible here since the file was uploaded directly
  // to S3. We record the hash as provided; dedup on confirm path is best-effort.
  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name: fileName,
    path,
    type: 'file',
    size: fileSize,
    r2Key,
    mimeType: mimeType || null,
    hash: null,
    refCount: 1,
    isFolder: false,
    bucketId: bucketId || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  // Update user storage usage (atomic SQL, no read-then-write)
  await updateUserStorage(db, userId, fileSize);

  // Update bucket stats
  if (bucketId) {
    await updateBucketStats(db, bucketId, fileSize, 1);
  }

  c.executionCtx.waitUntil(
    (async () => {
      try {
        if (await isAIConfigured(c.env)) {
          const text = await buildFileTextForVector(c.env, fileId);
          if (text) {
            await indexFileVector(c.env, fileId, text);
          }
        }
      } catch (error) {
        console.error('Failed to index file vector:', error);
      }
    })()
  );

  return c.json({
    success: true,
    data: { id: fileId, name: fileName, size: fileSize, mimeType, path, bucketId: bucketId || null, createdAt: now },
  });
});

// ── POST /api/presign/multipart/init ──────────────────────────────────────
// Start a multipart upload. Returns UploadId + presigned part URL for part 1.

app.post('/multipart/init', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = multipartInitSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileName, fileSize, mimeType, parentId, bucketId: requestedBucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId, mimeType);
  if (!mimeCheck.allowed) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}`,
        },
      },
      400
    );
  }

  // Quota checks
  const user = await getUserOrFail(db, userId);
  if (user.storageUsed + fileSize > user.storageQuota) {
    throwAppError('STORAGE_EXCEEDED', '用户存储配额已满');
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId, parentId);
  if (!bucketConfig) {
    return c.json({ success: true, data: { useProxy: true } });
  }

  // Telegram 桶不支持分片上传，回落到代理上传
  if (bucketConfig.provider === 'telegram') {
    return c.json({ success: true, data: { useProxy: true, bucketId: bucketConfig.id } });
  }

  const fileId = crypto.randomUUID();
  const r2Key = `files/${userId}/${fileId}/${encodeFilename(fileName)}`;

  const uploadId = await s3CreateMultipartUpload(bucketConfig, r2Key, mimeType || 'application/octet-stream');

  // Pre-generate part URL for part 1 so the frontend can start immediately
  const firstPartUrl = await s3PresignUploadPart(bucketConfig, r2Key, uploadId, 1, UPLOAD_EXPIRY);

  return c.json({
    success: true,
    data: {
      uploadId,
      fileId,
      r2Key,
      bucketId: bucketConfig.id,
      firstPartUrl,
      expiresIn: UPLOAD_EXPIRY,
    },
  });
});

// ── POST /api/presign/multipart/part ──────────────────────────────────────
// Get a presigned URL for uploading a specific part.

app.post('/multipart/part', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = multipartPartSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { r2Key, uploadId, partNumber, bucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未找到存储桶配置' } }, 400);
  }

  const partUrl = await s3PresignUploadPart(bucketConfig, r2Key, uploadId, partNumber, UPLOAD_EXPIRY);

  return c.json({ success: true, data: { partUrl, partNumber, expiresIn: UPLOAD_EXPIRY } });
});

// ── POST /api/presign/multipart/complete ──────────────────────────────────
// Finalize the multipart upload + write the DB record.

app.post('/multipart/complete', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = multipartCompleteSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, fileName, fileSize, mimeType, parentId, r2Key, uploadId, bucketId, parts } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, bucketId, parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未找到存储桶配置' } }, 400);
  }

  // Guard: idempotency
  const existing = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (existing) {
    return c.json({ success: true, data: { id: existing.id, name: existing.name, alreadyConfirmed: true } });
  }

  // Complete the S3 multipart upload
  await s3CompleteMultipartUpload(bucketConfig, r2Key, uploadId, parts as MultipartPart[]);

  // Write DB record
  const now = new Date().toISOString();
  const path = parentId ? `${parentId}/${fileName}` : `/${fileName}`;

  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name: fileName,
    path,
    type: 'file',
    size: fileSize,
    r2Key,
    mimeType: mimeType || null,
    hash: null,
    refCount: 1,
    isFolder: false,
    bucketId: bucketConfig.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  await updateUserStorage(db, userId, fileSize);
  await updateBucketStats(db, bucketConfig.id, fileSize, 1);

  c.executionCtx.waitUntil(
    (async () => {
      try {
        if (await isAIConfigured(c.env)) {
          const text = await buildFileTextForVector(c.env, fileId);
          if (text) {
            await indexFileVector(c.env, fileId, text);
          }
        }
      } catch (error) {
        console.error('Failed to index file vector:', error);
      }
    })()
  );

  return c.json({
    success: true,
    data: { id: fileId, name: fileName, size: fileSize, mimeType, path, bucketId: bucketConfig.id, createdAt: now },
  });
});

// ── POST /api/presign/multipart/abort ─────────────────────────────────────

app.post('/multipart/abort', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = multipartAbortSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { r2Key, uploadId, bucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未找到存储桶配置' } }, 400);
  }

  await s3AbortMultipartUpload(bucketConfig, r2Key, uploadId);

  return c.json({ success: true, data: { message: '分片上传已中止' } });
});

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
