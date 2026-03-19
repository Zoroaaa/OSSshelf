/**
 * presign.ts
 * 预签名URL路由
 *
 * 功能:
 * - 生成预签名上传URL
 * - 生成预签名下载URL
 * - 分片上传初始化与管理
 * - 上传确认与完成
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, MAX_FILE_SIZE, isPreviewableMimeType } from '@osshelf/shared';
import { getEncryptionKey } from '../lib/crypto';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import {
  getPresignedUploadUrl,
  confirmUpload,
  initMultipartUpload,
  getMultipartPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  getPresignedDownloadUrl,
  getPresignedPreviewUrl,
} from '../services/presign.service';
import type { MultipartPart } from '../lib/s3client';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

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

  const uploadResult = await getPresignedUploadUrl(c.env, db, encKey, userId, {
    fileName,
    fileSize,
    mimeType,
    parentId,
    bucketId: requestedBucketId,
  });

  if (!uploadResult.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: uploadResult.error } }, 400);
  }

  return c.json({ success: true, data: uploadResult.data });
});

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

  const confirmResult = await confirmUpload(c.env, db, userId, {
    fileId,
    fileName,
    fileSize,
    mimeType,
    parentId,
    r2Key,
    bucketId,
  });

  return c.json({ success: true, data: confirmResult.data });
});

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

  const initResult = await initMultipartUpload(c.env, db, encKey, userId, {
    fileName,
    fileSize,
    mimeType,
    parentId,
    bucketId: requestedBucketId,
  });

  if (!initResult.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: initResult.error } }, 400);
  }

  return c.json({ success: true, data: initResult.data });
});

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

  const partResult = await getMultipartPartUrl(db, encKey, userId, {
    r2Key,
    uploadId,
    partNumber,
    bucketId,
  });

  if (!partResult.success) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: partResult.error } }, 400);
  }

  return c.json({ success: true, data: partResult.data });
});

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

  const completeResult = await completeMultipartUpload(c.env, db, encKey, userId, {
    fileId,
    fileName,
    fileSize,
    mimeType,
    parentId,
    r2Key,
    uploadId,
    bucketId,
    parts: parts as MultipartPart[],
  });

  if (!completeResult.success) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: completeResult.error } }, 400);
  }

  return c.json({ success: true, data: completeResult.data });
});

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

  const abortResult = await abortMultipartUpload(db, encKey, userId, {
    r2Key,
    uploadId,
    bucketId,
  });

  if (!abortResult.success) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: abortResult.error } }, 400);
  }

  return c.json({ success: true, data: abortResult.data });
});

app.get('/download/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await getPresignedDownloadUrl(db, encKey, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

app.get('/preview/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await getPresignedPreviewUrl(db, encKey, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

export default app;
