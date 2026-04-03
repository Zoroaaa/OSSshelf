/**
 * tasks.ts
 * 上传任务路由
 *
 * 功能:
 * - 创建上传任务
 * - 分片上传管理
 * - 任务状态查询
 * - 暂停/恢复/取消
 */

import { Hono } from 'hono';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb, uploadTasks, users, storageBuckets, files, telegramFileRefs, telegramFileChunks } from '../db';
import type { DrizzleDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import {
  ERROR_CODES,
  MAX_FILE_SIZE,
  UPLOAD_TASK_EXPIRY,
  MULTIPART_THRESHOLD,
  UPLOAD_CHUNK_SIZE,
  inferMimeType,
  logger,
} from '@osshelf/shared';
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
  s3ListParts,
  s3UploadPart,
  type MultipartPart,
} from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { checkFolderMimeTypeRestriction } from '../lib/folderPolicy';
import {
  tgUploadFile,
  TG_MAX_FILE_SIZE,
  TG_MAX_CHUNKED_FILE_SIZE,
  type TelegramBotConfig,
} from '../lib/telegramClient';
import { needsChunking, tgUploadChunked, TG_CHUNK_SIZE, TG_CHUNK_THRESHOLD } from '../lib/telegramChunked';
import { decryptSecret, s3Delete } from '../lib/s3client';
import { getUserOrFail, encodeFilename } from '../lib/utils';
import { checkAndClaimDedup } from '../lib/dedup';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const UPLOAD_EXPIRY = 3600;

const createTaskSchema = z.object({
  fileName: z.string().min(1, '文件名不能为空').max(1024),
  fileSize: z.number().int().min(1).max(MAX_FILE_SIZE),
  mimeType: z.string().optional().default('application/octet-stream'),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
});

const uploadPartSchema = z.object({
  taskId: z.string().min(1),
  partNumber: z.number().int().min(1).max(10000),
});

const completeTaskSchema = z.object({
  taskId: z.string().min(1),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1),
        etag: z.string().min(1, 'etag 不能为空'),
      })
    )
    .min(0)
    .default([]),
  hash: z.string().optional(),
});

app.post('/create', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createTaskSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileName, fileSize, mimeType: providedMimeType, parentId, bucketId: requestedBucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const mimeType = inferMimeType(fileName, providedMimeType);

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
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未配置存储桶' } }, 400);
  }

  // ── Telegram 桶：返回特殊标记，让前端走代理上传路径 ──────────────────
  if (bucketConfig.provider === 'telegram') {
    // 分片上传支持最大 2GB（Telegram Bot API 真实上限），前端每片 20MB
    if (fileSize > TG_MAX_CHUNKED_FILE_SIZE) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.FILE_TOO_LARGE,
            message: `Telegram 存储桶文件上限 2GB，当前文件 ${(fileSize / 1024 / 1024 / 1024).toFixed(2)}GB`,
          },
        },
        413
      );
    }

    const taskId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const r2Key = `files/${userId}/${fileId}/${encodeFilename(fileName)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + UPLOAD_TASK_EXPIRY).toISOString();
    const isSmallFile = fileSize <= TG_CHUNK_THRESHOLD;

    // 50MB 以下：直接上传（小文件模式）
    if (isSmallFile) {
      await db.insert(uploadTasks).values({
        id: taskId,
        userId,
        fileName,
        fileSize,
        mimeType: mimeType || null,
        parentId: parentId || null,
        bucketId: bucketConfig.id,
        r2Key,
        uploadId: 'telegram', // 小文件标记
        totalParts: 1,
        uploadedParts: '[]',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });

      return c.json({
        success: true,
        data: {
          taskId,
          fileId,
          uploadId: 'telegram',
          r2Key,
          bucketId: bucketConfig.id,
          totalParts: 1,
          partSize: fileSize,
          isTelegramUpload: true,
          isSmallFile: true,
          expiresAt,
        },
      });
    }

    // 50MB 以上：分片上传
    const groupId = crypto.randomUUID();
    const totalParts = Math.ceil(fileSize / TG_CHUNK_SIZE);
    const uploadId = `telegram-chunked:${groupId}`;

    await db.insert(uploadTasks).values({
      id: taskId,
      userId,
      fileName,
      fileSize,
      mimeType: mimeType || null,
      parentId: parentId || null,
      bucketId: bucketConfig.id,
      r2Key,
      uploadId,
      totalParts,
      uploadedParts: '[]',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    return c.json({
      success: true,
      data: {
        taskId,
        fileId,
        uploadId,
        r2Key,
        bucketId: bucketConfig.id,
        totalParts,
        partSize: TG_CHUNK_SIZE,
        isTelegramUpload: true,
        isSmallFile: false,
        expiresAt,
      },
    });
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
  if (quotaErr) {
    throwAppError('STORAGE_EXCEEDED', quotaErr);
  }

  const taskId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const r2Key = `files/${userId}/${fileId}/${encodeFilename(fileName)}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + UPLOAD_TASK_EXPIRY).toISOString();
  const isSmallFile = fileSize <= MULTIPART_THRESHOLD;

  if (isSmallFile) {
    const uploadUrl = await s3PresignUrl(bucketConfig, 'PUT', r2Key, UPLOAD_EXPIRY, mimeType);

    await db.insert(uploadTasks).values({
      id: taskId,
      userId,
      fileName,
      fileSize,
      mimeType: mimeType || null,
      parentId: parentId || null,
      bucketId: bucketConfig.id,
      r2Key,
      uploadId: '', // 小文件不需要 multipart uploadId
      totalParts: 1,
      uploadedParts: '[]',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    return c.json({
      success: true,
      data: {
        taskId,
        fileId,
        uploadId: '',
        r2Key,
        bucketId: bucketConfig.id,
        totalParts: 1,
        partSize: fileSize,
        uploadUrl, // 直传 URL
        isSmallFile: true,
        expiresAt,
      },
    });
  }

  const totalParts = Math.ceil(fileSize / UPLOAD_CHUNK_SIZE);
  const uploadId = await s3CreateMultipartUpload(bucketConfig, r2Key, mimeType);

  await db.insert(uploadTasks).values({
    id: taskId,
    userId,
    fileName,
    fileSize,
    mimeType: mimeType || null,
    parentId: parentId || null,
    bucketId: bucketConfig.id,
    r2Key,
    uploadId,
    totalParts,
    uploadedParts: '[]',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  const firstPartUrl = await s3PresignUploadPart(bucketConfig, r2Key, uploadId, 1, UPLOAD_EXPIRY);

  return c.json({
    success: true,
    data: {
      taskId,
      fileId,
      uploadId,
      r2Key,
      bucketId: bucketConfig.id,
      totalParts,
      partSize: UPLOAD_CHUNK_SIZE,
      firstPartUrl,
      isSmallFile: false,
      expiresAt,
    },
  });
});

app.get('/list', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const tasks = await db.select().from(uploadTasks).where(eq(uploadTasks.userId, userId)).all();

  // 返回所有任务，包括已完成和过期的
  return c.json({
    success: true,
    data: tasks.map((t) => {
      let rawParts: unknown[] = [];
      try {
        rawParts = JSON.parse(t.uploadedParts || '[]');
      } catch {
        /* ignore */
      }
      // 兼容旧格式（数字数组）和新格式（{partNumber,etag}[]）
      const uploadedPartNumbers = rawParts.map((p) =>
        typeof p === 'number' ? p : (p as { partNumber: number }).partNumber
      );
      return { ...t, uploadedParts: uploadedPartNumbers };
    }),
  });
});

app.delete('/clear', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  // 只删除已完成、失败、过期、取消的任务
  await db
    .delete(uploadTasks)
    .where(
      and(eq(uploadTasks.userId, userId), inArray(uploadTasks.status, ['completed', 'failed', 'expired', 'aborted']))
    );

  return c.json({ success: true, data: { message: '已清空历史任务记录' } });
});

app.delete('/clear-completed', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  // 只删除已完成的任务
  await db.delete(uploadTasks).where(and(eq(uploadTasks.userId, userId), eq(uploadTasks.status, 'completed')));

  return c.json({ success: true, data: { message: '已清空已完成的任务' } });
});

app.delete('/clear-failed', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  // 只删除失败、过期、取消的任务
  await db
    .delete(uploadTasks)
    .where(and(eq(uploadTasks.userId, userId), inArray(uploadTasks.status, ['failed', 'expired', 'aborted'])));

  return c.json({ success: true, data: { message: '已清空失败/过期/取消的任务' } });
});

app.delete('/clear-all', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  // 删除所有任务记录
  await db.delete(uploadTasks).where(eq(uploadTasks.userId, userId));

  return c.json({ success: true, data: { message: '已清空所有任务记录' } });
});

app.post('/start', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const taskId = body.taskId as string;

  if (!taskId) {
    throwAppError('VALIDATION_ERROR', '缺少任务ID');
  }

  const db = getDb(c.env.DB);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (task.status !== 'pending') {
    return c.json({ success: true, data: { message: '任务已开始', status: task.status } });
  }

  if (new Date(task.expiresAt) < new Date()) {
    throwAppError('TASK_EXPIRED', '上传任务已过期');
  }

  await db
    .update(uploadTasks)
    .set({ status: 'uploading', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已开始', status: 'uploading' } });
});

app.post('/part', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = uploadPartSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { taskId, partNumber } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (task.status === 'completed') {
    throwAppError('VALIDATION_ERROR', '任务已完成');
  }

  if (new Date(task.expiresAt) < new Date()) {
    throwAppError('TASK_EXPIRED', '上传任务已过期');
  }

  if (task.uploadId === 'telegram' || task.uploadId?.startsWith('telegram-chunked:')) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Telegram 存储桶请使用 /api/tasks/telegram-part 端点上传分片',
        },
      },
      400
    );
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
  }

  const partUrl = await s3PresignUploadPart(bucketConfig, task.r2Key, task.uploadId, partNumber, UPLOAD_EXPIRY);

  return c.json({ success: true, data: { partUrl, partNumber, expiresIn: UPLOAD_EXPIRY } });
});

const partDoneSchema = z.object({
  taskId: z.string().min(1),
  partNumber: z.number().int().min(1).max(10000),
  etag: z.string().min(1, 'etag 不能为空'),
});

app.post('/part-done', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = partDoneSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { taskId, partNumber, etag } = result.data;
  const db = getDb(c.env.DB);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (task.status === 'completed') {
    return c.json({ success: true, data: { message: '任务已完成' } });
  }

  if (new Date(task.expiresAt) < new Date()) {
    throwAppError('TASK_EXPIRED', '上传任务已过期');
  }

  // 存储 {partNumber, etag} 对象以支持断点续传时直接使用，无需再次调用 S3 ListParts
  const uploadedParts: Array<{ partNumber: number; etag: string }> =
    typeof task.uploadedParts === 'string' ? JSON.parse(task.uploadedParts || '[]') : [];
  const alreadyRecorded = uploadedParts.some((p) => p.partNumber === partNumber);
  if (!alreadyRecorded) {
    uploadedParts.push({ partNumber, etag });
    const progress = task.totalParts > 0 ? Math.round((uploadedParts.length / task.totalParts) * 100) : 0;
    await db
      .update(uploadTasks)
      .set({
        uploadedParts: JSON.stringify(uploadedParts),
        status: 'uploading',
        progress,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(uploadTasks.id, taskId));
  }

  return c.json({ success: true, data: { partNumber, etag, uploadedParts: uploadedParts.map((p) => p.partNumber) } });
});

app.post('/part-proxy', async (c) => {
  const userId = c.get('userId')!;
  const contentType = c.req.header('Content-Type') || '';

  if (!contentType.includes('multipart/form-data')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data 格式' } },
      400
    );
  }

  const formData = await c.req.formData();
  const taskId = formData.get('taskId') as string;
  const partNumber = parseInt(formData.get('partNumber') as string, 10);
  const chunk = formData.get('chunk') as File | null;

  if (!taskId || !partNumber || !chunk) {
    throwAppError('VALIDATION_ERROR', '缺少必要参数');
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (new Date(task.expiresAt) < new Date()) {
    throwAppError('TASK_EXPIRED', '上传任务已过期');
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
  }

  const chunkBuffer = await chunk.arrayBuffer();
  const etag = await s3UploadPart(bucketConfig, task.r2Key, task.uploadId, partNumber, chunkBuffer);

  const uploadedParts: Array<{ partNumber: number; etag: string }> =
    typeof task.uploadedParts === 'string' ? JSON.parse(task.uploadedParts || '[]') : [];
  const alreadyRecorded = uploadedParts.some((p) => p.partNumber === partNumber);
  if (!alreadyRecorded) {
    uploadedParts.push({ partNumber, etag });
    const progress = task.totalParts > 0 ? Math.round((uploadedParts.length / task.totalParts) * 100) : 0;
    await db
      .update(uploadTasks)
      .set({
        uploadedParts: JSON.stringify(uploadedParts),
        status: 'uploading',
        progress,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(uploadTasks.id, taskId));
  }

  return c.json({ success: true, data: { partNumber, etag } });
});

// ── POST /api/tasks/telegram-part ────────────────────────────────────────
// 接收单个分片（≤30MB）或小文件（≤50MB），转发到 Telegram Bot API。
// multipart/form-data 格式，字段: taskId, partNumber, chunk (File)
// - 小文件（uploadId='telegram'）：直接上传整个文件
// - 分片（uploadId='telegram-chunked:xxx'）：上传分片并记录
app.post('/telegram-part', async (c) => {
  const userId = c.get('userId')!;
  const contentType = c.req.header('Content-Type') || '';

  if (!contentType.includes('multipart/form-data')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data 格式' } },
      400
    );
  }

  const formData = await c.req.formData();
  const taskId = formData.get('taskId') as string | null;
  const partNumberStr = formData.get('partNumber') as string | null;
  const chunk = formData.get('chunk') as File | null;

  if (!taskId || !partNumberStr || !chunk) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少 taskId、partNumber 或 chunk' } },
      400
    );
  }

  const partNumber = parseInt(partNumberStr, 10);
  if (isNaN(partNumber) || partNumber < 1) {
    throwAppError('VALIDATION_ERROR', 'partNumber 无效');
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (!task.uploadId || (task.uploadId !== 'telegram' && !task.uploadId.startsWith('telegram-chunked:'))) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '非 Telegram 上传任务' } },
      400
    );
  }
  if (new Date(task.expiresAt) < new Date()) {
    throwAppError('TASK_EXPIRED', '上传任务已过期');
  }

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, task.bucketId!), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket || bucket.provider !== 'telegram') {
    return c.json({ success: false, error: { code: 'TG_CONFIG_ERROR', message: '找不到 Telegram 存储桶' } }, 404);
  }

  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  const tgConfig: TelegramBotConfig = {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };

  const chunkBuffer = await chunk.arrayBuffer();
  const now = new Date().toISOString();

  // ── 小文件直接上传模式 ───────────────────────────────────────────────
  if (task.uploadId === 'telegram') {
    const caption = `📁 ${task.fileName}\n🗂 OSSshelf | ${now.slice(0, 10)}`;
    let tgFileId: string;
    try {
      const result = await tgUploadFile(tgConfig, chunkBuffer, task.fileName, task.mimeType, caption);
      tgFileId = result.fileId;
    } catch (e: any) {
      await db
        .update(uploadTasks)
        .set({ status: 'failed', errorMessage: e?.message || 'Telegram 上传失败', updatedAt: now })
        .where(eq(uploadTasks.id, taskId));
      return c.json(
        { success: false, error: { code: 'TG_UPLOAD_ERROR', message: e?.message || 'Telegram 上传失败' } },
        500
      );
    }

    await db
      .update(uploadTasks)
      .set({
        uploadedParts: JSON.stringify([{ partNumber: 1, etag: tgFileId }]),
        status: 'uploading',
        progress: 100,
        updatedAt: now,
      })
      .where(eq(uploadTasks.id, taskId));

    return c.json({ success: true, data: { partNumber: 1, tgFileId, isSmallFile: true } });
  }

  // ── 分片上传模式 ───────────────────────────────────────────────────────
  const groupId = task.uploadId.slice('telegram-chunked:'.length);
  const chunkFileName = `${task.fileName}.part${String(partNumber).padStart(3, '0')}`;
  const caption = `📦 ${task.fileName} [${partNumber}/${task.totalParts}]\n🗂 OSSshelf chunk | group:${groupId.slice(0, 8)}`;

  let tgFileId: string;
  try {
    const result = await tgUploadFile(tgConfig, chunkBuffer, chunkFileName, task.mimeType, caption);
    tgFileId = result.fileId;
  } catch (e: any) {
    await db
      .update(uploadTasks)
      .set({ status: 'failed', errorMessage: e?.message || 'Telegram 上传分片失败', updatedAt: now })
      .where(eq(uploadTasks.id, taskId));
    return c.json(
      { success: false, error: { code: 'TG_UPLOAD_ERROR', message: e?.message || 'Telegram 上传分片失败' } },
      500
    );
  }

  // 用 Drizzle insert，避免 (db as any).run() 的 API 兼容问题
  await db
    .insert(telegramFileChunks)
    .values({
      id: crypto.randomUUID(),
      groupId,
      chunkIndex: partNumber - 1,
      tgFileId,
      chunkSize: chunkBuffer.byteLength,
      bucketId: task.bucketId!,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: telegramFileChunks.id,
      set: { tgFileId, chunkSize: chunkBuffer.byteLength, createdAt: now },
    });

  const uploadedParts: Array<{ partNumber: number; etag: string }> =
    typeof task.uploadedParts === 'string' ? JSON.parse(task.uploadedParts || '[]') : [];
  if (!uploadedParts.some((p) => p.partNumber === partNumber)) {
    uploadedParts.push({ partNumber, etag: tgFileId });
    const progress = task.totalParts > 0 ? Math.round((uploadedParts.length / task.totalParts) * 100) : 0;
    await db
      .update(uploadTasks)
      .set({ uploadedParts: JSON.stringify(uploadedParts), status: 'uploading', progress, updatedAt: now })
      .where(eq(uploadTasks.id, taskId));
  }

  return c.json({ success: true, data: { partNumber, tgFileId } });
});

// ── POST /api/tasks/telegram-upload (legacy, kept for backward compat) ───
// 旧版单次整包上传入口，已被 /telegram-part 分片方案取代。
// 保留此路由避免旧客户端 404，但建议前端升级为分片流程。
app.post('/telegram-upload', async (c) => {
  const userId = c.get('userId')!;
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data' } },
      400
    );
  }

  const formData = await c.req.formData();
  const taskId = formData.get('taskId') as string | null;
  const fileBlob = formData.get('file') as File | null;

  if (!taskId || !fileBlob) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少 taskId 或 file' } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }
  if (new Date(task.expiresAt) < new Date()) {
    throwAppError('TASK_EXPIRED', '上传任务已过期');
  }

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, task.bucketId!), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket || bucket.provider !== 'telegram') {
    return c.json({ success: false, error: { code: 'TG_CONFIG_ERROR', message: '找不到 Telegram 存储桶' } }, 404);
  }

  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  const tgConfig: TelegramBotConfig = {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };

  const r2KeyParts = task.r2Key.split('/');
  const fileId = r2KeyParts[2] || crypto.randomUUID();

  await db
    .update(uploadTasks)
    .set({ status: 'uploading', progress: 0, updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  const fileBuffer = await fileBlob.arrayBuffer();

  c.executionCtx.waitUntil(
    runTelegramUpload({
      db,
      userId,
      taskId,
      fileId,
      task: {
        fileName: task.fileName,
        fileSize: task.fileSize,
        mimeType: task.mimeType,
        parentId: task.parentId,
        bucketId: task.bucketId!,
        r2Key: task.r2Key,
      },
      tgConfig,
      fileBuffer,
    })
  );

  return c.json({
    success: true,
    data: {
      taskId,
      status: 'uploading',
      message: '上传任务已启动，请轮询进度',
    },
  });
});

// ── Telegram 异步上传执行器 ─────────────────────────────────────────────
interface RunTelegramUploadParams {
  db: DrizzleDb;
  userId: string;
  taskId: string;
  fileId: string;
  task: {
    fileName: string;
    fileSize: number;
    mimeType: string | null;
    parentId: string | null;
    bucketId: string;
    r2Key: string;
  };
  tgConfig: TelegramBotConfig;
  fileBuffer: ArrayBuffer;
}

async function runTelegramUpload(params: RunTelegramUploadParams): Promise<void> {
  const { db, userId, taskId, fileId, task, tgConfig, fileBuffer } = params;
  const now = new Date().toISOString();
  const path = task.parentId ? `${task.parentId}/${task.fileName}` : `/${task.fileName}`;

  let tgFileId: string;
  let tgFileSize: number;

  try {
    if (needsChunking(fileBuffer.byteLength)) {
      const chunked = await tgUploadChunked(
        tgConfig,
        fileBuffer,
        task.fileName,
        task.mimeType,
        db,
        task.bucketId,
        async (progress) => {
          await db
            .update(uploadTasks)
            .set({ progress: progress.percent, updatedAt: new Date().toISOString() })
            .where(eq(uploadTasks.id, taskId));
        }
      );
      tgFileId = chunked.virtualFileId;
      tgFileSize = chunked.totalBytes;
    } else {
      await db
        .update(uploadTasks)
        .set({ progress: 50, updatedAt: new Date().toISOString() })
        .where(eq(uploadTasks.id, taskId));

      const caption = `📁 ${task.fileName}\n🗂 OSSshelf | ${now.slice(0, 10)}`;
      const result = await tgUploadFile(tgConfig, fileBuffer, task.fileName, task.mimeType, caption);
      tgFileId = result.fileId;
      tgFileSize = result.fileSize;
    }
  } catch (e: any) {
    await db
      .update(uploadTasks)
      .set({ status: 'failed', errorMessage: e?.message || 'Telegram 上传失败', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
    return;
  }

  try {
    await db.insert(files).values({
      id: fileId,
      userId,
      parentId: task.parentId,
      name: task.fileName,
      path,
      type: 'file',
      size: task.fileSize,
      r2Key: task.r2Key,
      mimeType: task.mimeType,
      hash: null,
      refCount: 1,
      isFolder: false,
      bucketId: task.bucketId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await db.insert(telegramFileRefs).values({
      id: crypto.randomUUID(),
      fileId,
      r2Key: task.r2Key,
      tgFileId,
      tgFileSize,
      bucketId: task.bucketId,
      createdAt: now,
    });

    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      await db
        .update(users)
        .set({ storageUsed: user.storageUsed + task.fileSize, updatedAt: now })
        .where(eq(users.id, userId));
    }
    await updateBucketStats(db, task.bucketId, task.fileSize, 1);

    await db
      .update(uploadTasks)
      .set({ status: 'completed', progress: 100, updatedAt: now })
      .where(eq(uploadTasks.id, taskId));
  } catch (e: any) {
    await db
      .update(uploadTasks)
      .set({ status: 'failed', errorMessage: e?.message || '数据库写入失败', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
  }
}

app.post('/complete', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = completeTaskSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { taskId, parts, hash } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  try {
    const task = await db
      .select()
      .from(uploadTasks)
      .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
      .get();

    if (!task) {
      throwAppError('TASK_NOT_FOUND');
    }

    if (task.status === 'completed') {
      return c.json({ success: true, data: { message: '任务已完成', taskId } });
    }

    if (new Date(task.expiresAt) < new Date()) {
      throwAppError('TASK_EXPIRED', '上传任务已过期');
    }

    const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, task.parentId);
    if (!bucketConfig) {
      return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
    }

    if (!task.bucketId) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '任务缺少存储桶ID' } },
        400
      );
    }

    const isSmallFile = !task.uploadId || task.uploadId === '';
    const isTelegramChunked = task.uploadId?.startsWith('telegram-chunked:');
    const isTelegramSmall = task.uploadId === 'telegram';
    const now = new Date().toISOString();

    // Telegram 小文件任务：写入 files + telegramFileRefs
    if (isTelegramSmall) {
      const uploadedParts: Array<{ partNumber: number; etag: string }> = (() => {
        try {
          return typeof task.uploadedParts === 'string' ? JSON.parse(task.uploadedParts || '[]') : [];
        } catch {
          return [];
        }
      })();

      if (uploadedParts.length === 0) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '文件尚未上传完成' } },
          400
        );
      }

      const tgFileId = uploadedParts[0].etag;
      const fileId = task.r2Key.split('/')[2] || crypto.randomUUID();
      const path = task.parentId ? `${task.parentId}/${task.fileName}` : `/${task.fileName}`;

      const existingFile = await db.select().from(files).where(eq(files.id, fileId)).get();
      if (!existingFile) {
        // ── CoW 去重（TG 小文件）─────────────────────────────────────────
        let finalR2Key = task.r2Key;
        let isDedupHit = false;
        if (hash && task.bucketId) {
          const dedupResult = await checkAndClaimDedup(db, hash, task.bucketId, userId);
          if (dedupResult.isDuplicate && dedupResult.existingR2Key) {
            finalR2Key = dedupResult.existingR2Key;
            isDedupHit = true;
          }
        }
        // ─────────────────────────────────────────────────────────────────

        await db.insert(files).values({
          id: fileId,
          userId,
          parentId: task.parentId,
          name: task.fileName,
          path,
          type: 'file',
          size: task.fileSize,
          r2Key: finalR2Key,
          mimeType: task.mimeType,
          hash: hash ?? null,
          refCount: 1,
          isFolder: false,
          bucketId: task.bucketId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });

        // 命中去重时不写新的 telegramFileRefs，复用旧记录的 tgFileId
        if (!isDedupHit) {
          await db.insert(telegramFileRefs).values({
            id: crypto.randomUUID(),
            fileId,
            r2Key: finalR2Key,
            tgFileId,
            tgFileSize: task.fileSize,
            bucketId: task.bucketId!,
            createdAt: now,
          });
        }

        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        if (user) {
          await db
            .update(users)
            .set({ storageUsed: user.storageUsed + task.fileSize, updatedAt: now })
            .where(eq(users.id, userId));
        }
        const physicalDelta = isDedupHit ? 0 : task.fileSize;
        await updateBucketStats(db, task.bucketId!, physicalDelta, 1);
      }

      await db
        .update(uploadTasks)
        .set({ status: 'completed', progress: 100, updatedAt: now })
        .where(eq(uploadTasks.id, taskId));

      return c.json({
        success: true,
        data: {
          id: fileId,
          name: task.fileName,
          size: task.fileSize,
          mimeType: task.mimeType,
          path,
          bucketId: task.bucketId,
          createdAt: now,
        },
      });
    }

    // Telegram 新版分片任务：写入 files + telegramFileRefs
    if (isTelegramChunked) {
      const groupId = task.uploadId!.slice('telegram-chunked:'.length);

      // ── 校验所有分片是否都已上传 ──────────────────────────────────────
      const uploadedParts: Array<{ partNumber: number; etag: string }> = (() => {
        try {
          return typeof task.uploadedParts === 'string' ? JSON.parse(task.uploadedParts || '[]') : [];
        } catch {
          return [];
        }
      })();

      if (uploadedParts.length !== task.totalParts) {
        return c.json(
          {
            success: false,
            error: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: `分片未全部完成：已上传 ${uploadedParts.length}/${task.totalParts} 片`,
            },
          },
          400
        );
      }

      // 从 DB 二次确认分片记录完整性
      const chunkRows = await db.select().from(telegramFileChunks).where(eq(telegramFileChunks.groupId, groupId)).all();

      if (chunkRows.length !== task.totalParts) {
        return c.json(
          {
            success: false,
            error: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: `Telegram 分片记录不完整：数据库中找到 ${chunkRows.length}/${task.totalParts} 片，请重试`,
            },
          },
          400
        );
      }
      // ──────────────────────────────────────────────────────────────────

      const virtualFileId = `chunked:${groupId}`;
      const fileId = task.r2Key.split('/')[2] || crypto.randomUUID();
      const path = task.parentId ? `${task.parentId}/${task.fileName}` : `/${task.fileName}`;

      // 检查是否已写入（幂等）
      const existingFile = await db.select().from(files).where(eq(files.id, fileId)).get();
      if (!existingFile) {
        // ── CoW 去重（TG 分片）──────────────────────────────────────────
        let finalR2Key = task.r2Key;
        let isDedupHit = false;
        if (hash && task.bucketId) {
          const dedupResult = await checkAndClaimDedup(db, hash, task.bucketId, userId);
          if (dedupResult.isDuplicate && dedupResult.existingR2Key) {
            finalR2Key = dedupResult.existingR2Key;
            isDedupHit = true;
          }
        }
        // ─────────────────────────────────────────────────────────────────

        await db.insert(files).values({
          id: fileId,
          userId,
          parentId: task.parentId,
          name: task.fileName,
          path,
          type: 'file',
          size: task.fileSize,
          r2Key: finalR2Key,
          mimeType: task.mimeType,
          hash: hash ?? null,
          refCount: 1,
          isFolder: false,
          bucketId: task.bucketId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });

        // 命中去重时不写新的 telegramFileRefs（分片记录已在 telegramFileChunks 里，
        // 但 download 路由通过 telegramFileRefs.tgFileId 找旧记录即可）
        if (!isDedupHit) {
          await db.insert(telegramFileRefs).values({
            id: crypto.randomUUID(),
            fileId,
            r2Key: finalR2Key,
            tgFileId: virtualFileId,
            tgFileSize: task.fileSize,
            bucketId: task.bucketId!,
            createdAt: now,
          });
        }

        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        if (user) {
          await db
            .update(users)
            .set({ storageUsed: user.storageUsed + task.fileSize, updatedAt: now })
            .where(eq(users.id, userId));
        }
        const physicalDelta = isDedupHit ? 0 : task.fileSize;
        await updateBucketStats(db, task.bucketId!, physicalDelta, 1);
      }

      await db
        .update(uploadTasks)
        .set({ status: 'completed', progress: 100, updatedAt: now })
        .where(eq(uploadTasks.id, taskId));

      return c.json({
        success: true,
        data: {
          id: fileId,
          name: task.fileName,
          size: task.fileSize,
          mimeType: task.mimeType,
          path,
          bucketId: task.bucketId,
          createdAt: now,
        },
      });
    }

    if (!isSmallFile) {
      // 大文件：校验分片数量、etag 完整性并合并
      const hasEmptyEtag = parts.some((p) => !p.etag || p.etag.trim() === '');
      if (hasEmptyEtag) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '所有分片的 etag 不能为空' } },
          400
        );
      }
      if (parts.length !== task.totalParts) {
        logger.warn('TASKS', '分片数量不匹配', { expected: task.totalParts, got: parts.length });
        return c.json(
          {
            success: false,
            error: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: `分片数量不匹配：期望 ${task.totalParts} 个，实际 ${parts.length} 个`,
            },
          },
          400
        );
      }

      try {
        await s3CompleteMultipartUpload(bucketConfig, task.r2Key, task.uploadId, parts as MultipartPart[]);
      } catch (s3Error: any) {
        logger.error('TASKS', 'S3分片上传完成失败', { r2Key: task.r2Key }, s3Error);
        await db.update(uploadTasks).set({ status: 'failed', updatedAt: now }).where(eq(uploadTasks.id, taskId));
        return c.json(
          {
            success: false,
            error: {
              code: 'S3_ERROR',
              message: `合并分片失败: ${s3Error.message || '未知错误'}`,
            },
          },
          500
        );
      }
    }
    // 小文件：文件已通过预签名 PUT 直传到 S3，无需合并步骤

    const fileId = crypto.randomUUID();
    const path = task.parentId ? `${task.parentId}/${task.fileName}` : `/${task.fileName}`;

    // ── CoW 去重：使用前端上报的 SHA-256 hash ─────────────────────────────
    let finalR2Key = task.r2Key;
    let finalRefCount = 1;
    if (hash && task.bucketId) {
      const dedupResult = await checkAndClaimDedup(db, hash, task.bucketId, userId);
      if (dedupResult.isDuplicate && dedupResult.existingR2Key) {
        // 命中去重：删除刚上传的冗余对象，复用现有 r2Key
        try {
          await s3Delete(bucketConfig, task.r2Key);
        } catch (error) {
          logger.warn('TASKS', '去重删除冗余S3对象失败', { r2Key: task.r2Key }, error);
        }
        finalR2Key = dedupResult.existingR2Key;
        // 去重命中时 ref_count 已在 checkAndClaimDedup 内递增，新记录从 1 开始
        finalRefCount = 1;
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    await db.insert(files).values({
      id: fileId,
      userId,
      parentId: task.parentId,
      name: task.fileName,
      path,
      type: 'file',
      size: task.fileSize,
      r2Key: finalR2Key,
      mimeType: task.mimeType,
      hash: hash ?? null,
      refCount: finalRefCount,
      isFolder: false,
      bucketId: task.bucketId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      await db
        .update(users)
        .set({ storageUsed: user.storageUsed + task.fileSize, updatedAt: now })
        .where(eq(users.id, userId));
    }

    await updateBucketStats(db, task.bucketId, task.fileSize, 1);

    await db.update(uploadTasks).set({ status: 'completed', updatedAt: now }).where(eq(uploadTasks.id, taskId));

    return c.json({
      success: true,
      data: {
        id: fileId,
        name: task.fileName,
        size: task.fileSize,
        mimeType: task.mimeType,
        path,
        bucketId: task.bucketId,
        createdAt: now,
      },
    });
  } catch (error: any) {
    logger.error('TASKS', '完成上传任务失败', { taskId }, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error.message || '上传完成失败',
        },
      },
      500
    );
  }
});

app.post('/abort', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const taskId = body.taskId as string;

  if (!taskId) {
    throwAppError('VALIDATION_ERROR', '缺少任务ID');
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (task.status === 'completed') {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '任务已完成，无法中止' } },
      400
    );
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (bucketConfig) {
    try {
      await s3AbortMultipartUpload(bucketConfig, task.r2Key, task.uploadId);
    } catch (error) {
      logger.error('TASKS', '中止分片上传失败', { r2Key: task.r2Key }, error);
    }
  }

  await db
    .update(uploadTasks)
    .set({ status: 'failed', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '上传已中止' } });
});

app.get('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (task.status === 'completed') {
    return c.json({
      success: true,
      data: {
        ...task,
        uploadedParts:
          typeof task.uploadedParts === 'string' ? JSON.parse(task.uploadedParts || '[]') : task.uploadedParts,
      },
    });
  }

  if (task.status === 'failed') {
    return c.json({
      success: true,
      data: {
        ...task,
        uploadedParts:
          typeof task.uploadedParts === 'string' ? JSON.parse(task.uploadedParts || '[]') : task.uploadedParts,
        errorMessage: task.errorMessage,
      },
    });
  }

  if (new Date(task.expiresAt) < new Date()) {
    await db
      .update(uploadTasks)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
    throwAppError('TASK_EXPIRED', '上传任务已过期');
  }

  if (task.uploadId === 'telegram' || task.uploadId?.startsWith('telegram-chunked:')) {
    return c.json({
      success: true,
      data: {
        ...task,
        uploadedParts: (typeof task.uploadedParts === 'string'
          ? JSON.parse(task.uploadedParts || '[]')
          : task.uploadedParts
        ).map((p: { partNumber: number; etag: string } | number) => (typeof p === 'number' ? p : p.partNumber)),
        progress: task.progress ?? 0,
      },
    });
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
  }

  let storedParts: Array<{ partNumber: number; etag: string }> = [];
  try {
    storedParts = typeof task.uploadedParts === 'string' ? JSON.parse(task.uploadedParts || '[]') : [];
    if (storedParts.length > 0 && typeof storedParts[0] === 'number') {
      storedParts = (storedParts as unknown as number[]).map((n) => ({ partNumber: n, etag: '' }));
    }
  } catch {
    /* ignore */
  }

  let parts: MultipartPart[] = storedParts.filter((p) => p.etag);

  if (parts.length === 0 && task.uploadId) {
    try {
      parts = await s3ListParts(bucketConfig, task.r2Key, task.uploadId);
      if (parts.length > 0) {
        await db
          .update(uploadTasks)
          .set({ uploadedParts: JSON.stringify(parts), status: 'uploading', updatedAt: new Date().toISOString() })
          .where(eq(uploadTasks.id, taskId));
      }
    } catch (error) {
      logger.error('TASKS', '列出分片失败', {}, error);
    }
  }

  const uploadedPartNumbers = parts.map((p) => p.partNumber);

  return c.json({
    success: true,
    data: {
      ...task,
      uploadedParts: uploadedPartNumbers,
      parts,
    },
  });
});

app.delete('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  await db.delete(uploadTasks).where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已删除' } });
});

app.post('/:taskId/pause', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (task.status !== 'uploading' && task.status !== 'pending') {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能暂停上传中或等待中的任务' } },
      400
    );
  }

  await db
    .update(uploadTasks)
    .set({ status: 'paused', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已暂停' } });
});

// ── POST /api/tasks/:taskId/retry ─────────────────────────────────────────
// Telegram 上传失败后重试：清除 errorMessage、将状态重置为 pending
// 前端重新从 uploadedParts 断点继续上传剩余分片即可
app.post('/:taskId/retry', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (task.status !== 'failed') {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能重试失败的任务' } },
      400
    );
  }

  if (new Date(task.expiresAt) < new Date()) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '任务已过期，请重新上传' } },
      410
    );
  }

  const uploadedParts: Array<{ partNumber: number; etag: string }> = (() => {
    try {
      return JSON.parse(task.uploadedParts || '[]');
    } catch {
      return [];
    }
  })();

  await db
    .update(uploadTasks)
    .set({
      status: 'pending',
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(uploadTasks.id, taskId));

  return c.json({
    success: true,
    data: {
      taskId,
      uploadId: task.uploadId,
      r2Key: task.r2Key,
      totalParts: task.totalParts,
      uploadedParts: uploadedParts.map((p) => p.partNumber),
      // 前端用 uploadedParts 跳过已完成分片，从失败的分片继续
    },
  });
});

app.post('/:taskId/resume', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    throwAppError('TASK_NOT_FOUND');
  }

  if (task.status !== 'paused') {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能恢复已暂停的任务' } },
      400
    );
  }

  if (new Date(task.expiresAt) < new Date()) {
    await db
      .update(uploadTasks)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
    throwAppError('TASK_EXPIRED', '上传任务已过期');
  }

  await db
    .update(uploadTasks)
    .set({ status: 'pending', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已恢复' } });
});

export default app;
