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
import { eq, and } from 'drizzle-orm';
import { getDb, uploadTasks, users, storageBuckets } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, MAX_FILE_SIZE, UPLOAD_TASK_EXPIRY, MULTIPART_THRESHOLD, UPLOAD_CHUNK_SIZE } from '@osshelf/shared';
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
  parts: z.array(z.object({
    partNumber: z.number().int().min(1),
    etag: z.string().min(1, 'etag 不能为空'),
  })).min(1),
}).refine((data) => {
  const hasEmptyEtag = data.parts.some(p => !p.etag || p.etag.trim() === '');
  return !hasEmptyEtag;
}, { message: '所有分片的 etag 不能为空' });

async function getUserOrFail(db: ReturnType<typeof getDb>, userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('用户不存在');
  return user;
}

async function checkFolderMimeTypeRestriction(
  db: ReturnType<typeof getDb>,
  parentId: string | null | undefined,
  mimeType: string,
): Promise<{ allowed: boolean; allowedTypes?: string[] }> {
  if (!parentId) return { allowed: true };
  
  const { files } = await import('../db');
  const parentFolder = await db.select().from(files)
    .where(and(eq(files.id, parentId), eq(files.isFolder, true)))
    .get();
  
  if (!parentFolder || !parentFolder.allowedMimeTypes) {
    return { allowed: true };
  }
  
  try {
    const allowedTypes: string[] = JSON.parse(parentFolder.allowedMimeTypes);
    if (allowedTypes.length === 0) return { allowed: true };
    
    const isAllowed = allowedTypes.some((allowed) => {
      if (allowed.endsWith('/*')) {
        return mimeType.startsWith(allowed.slice(0, -1));
      }
      return mimeType === allowed;
    });
    
    return { allowed: isAllowed, allowedTypes };
  } catch {
    return { allowed: true };
  }
}

app.post('/create', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createTaskSchema.safeParse(body);
  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } }, 400);
  }

  const { fileName, fileSize, mimeType, parentId, bucketId: requestedBucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'ossshelf-key';

  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId, mimeType);
  if (!mimeCheck.allowed) {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}`,
      },
    }, 400);
  }

  const user = await getUserOrFail(db, userId);
  if (user.storageUsed + fileSize > user.storageQuota) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: '用户存储配额已满' } }, 400);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId, parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未配置存储桶' } }, 400);
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
  if (quotaErr) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: quotaErr } }, 400);
  }

  const taskId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const r2Key = `files/${userId}/${fileId}/${encodeFilename(fileName)}`;
  const totalParts = Math.ceil(fileSize / UPLOAD_CHUNK_SIZE);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + UPLOAD_TASK_EXPIRY).toISOString();

  const uploadId = await s3CreateMultipartUpload(bucketConfig, r2Key, mimeType || 'application/octet-stream');

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
      expiresAt,
    },
  });
});

app.get('/list', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const tasks = await db.select().from(uploadTasks)
    .where(eq(uploadTasks.userId, userId))
    .all();

  const activeTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'expired');
  const now = new Date();
  const validTasks = activeTasks.filter((t) => new Date(t.expiresAt) > now);

  return c.json({
    success: true,
    data: validTasks.map((t) => ({
      ...t,
      uploadedParts: JSON.parse(t.uploadedParts || '[]'),
    })),
  });
});

app.post('/part', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = uploadPartSchema.safeParse(body);
  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } }, 400);
  }

  const { taskId, partNumber } = result.data;
  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'ossshelf-key';

  const task = await db.select().from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status === 'completed') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '任务已完成' } }, 400);
  }

  if (new Date(task.expiresAt) < new Date()) {
    return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
  }

  const partUrl = await s3PresignUploadPart(bucketConfig, task.r2Key, task.uploadId, partNumber, UPLOAD_EXPIRY);

  return c.json({ success: true, data: { partUrl, partNumber, expiresIn: UPLOAD_EXPIRY } });
});

app.post('/part-proxy', async (c) => {
  const userId = c.get('userId')!;
  const contentType = c.req.header('Content-Type') || '';

  if (!contentType.includes('multipart/form-data')) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data 格式' } }, 400);
  }

  const formData = await c.req.formData();
  const taskId = formData.get('taskId') as string;
  const partNumber = parseInt(formData.get('partNumber') as string, 10);
  const chunk = formData.get('chunk') as File | null;

  if (!taskId || !partNumber || !chunk) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少必要参数' } }, 400);
  }

  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'ossshelf-key';

  const task = await db.select().from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (new Date(task.expiresAt) < new Date()) {
    return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
  }

  const chunkBuffer = await chunk.arrayBuffer();
  const etag = await s3UploadPart(bucketConfig, task.r2Key, task.uploadId, partNumber, chunkBuffer);

  const uploadedParts = JSON.parse(task.uploadedParts || '[]');
  if (!uploadedParts.includes(partNumber)) {
    uploadedParts.push(partNumber);
    await db.update(uploadTasks)
      .set({ uploadedParts: JSON.stringify(uploadedParts), status: 'uploading', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
  }

  return c.json({ success: true, data: { partNumber, etag } });
});

app.post('/complete', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = completeTaskSchema.safeParse(body);
  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } }, 400);
  }

  const { taskId, parts } = result.data;
  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'ossshelf-key';

  try {
    const task = await db.select().from(uploadTasks)
      .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
      .get();

    if (!task) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
    }

    if (task.status === 'completed') {
      return c.json({ success: true, data: { message: '任务已完成', taskId } });
    }

    if (new Date(task.expiresAt) < new Date()) {
      return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
    }

    const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, task.parentId);
    if (!bucketConfig) {
      return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
    }

    if (!task.bucketId) {
      return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '任务缺少存储桶ID' } }, 400);
    }

    if (parts.length !== task.totalParts) {
      console.warn(`Parts count mismatch: expected ${task.totalParts}, got ${parts.length}`);
      return c.json({ 
        success: false, 
        error: { 
          code: ERROR_CODES.VALIDATION_ERROR, 
          message: `分片数量不匹配：期望 ${task.totalParts} 个，实际 ${parts.length} 个` 
        } 
      }, 400);
    }

    const fileId = crypto.randomUUID();
    const now = new Date().toISOString();
    const path = task.parentId ? `${task.parentId}/${task.fileName}` : `/${task.fileName}`;

    try {
      await s3CompleteMultipartUpload(bucketConfig, task.r2Key, task.uploadId, parts as MultipartPart[]);
    } catch (s3Error: any) {
      console.error('S3 Complete Multipart Upload Error:', s3Error);
      await db.update(uploadTasks)
        .set({ status: 'failed', updatedAt: now })
        .where(eq(uploadTasks.id, taskId));
      return c.json({ 
        success: false, 
        error: { 
          code: 'S3_ERROR', 
          message: `合并分片失败: ${s3Error.message || '未知错误'}` 
        } 
      }, 500);
    }

    const { files } = await import('../db');
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
      isFolder: false,
      bucketId: task.bucketId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      await db.update(users)
        .set({ storageUsed: user.storageUsed + task.fileSize, updatedAt: now })
        .where(eq(users.id, userId));
    }

    await updateBucketStats(db, task.bucketId, task.fileSize, 1);

    await db.update(uploadTasks)
      .set({ status: 'completed', updatedAt: now })
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
  } catch (error: any) {
    console.error('Complete upload task error:', error);
    return c.json({ 
      success: false, 
      error: { 
        code: ERROR_CODES.INTERNAL_ERROR, 
        message: error.message || '上传完成失败' 
      } 
    }, 500);
  }
});

app.post('/abort', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const taskId = body.taskId as string;

  if (!taskId) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少任务ID' } }, 400);
  }

  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'ossshelf-key';

  const task = await db.select().from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status === 'completed') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '任务已完成，无法中止' } }, 400);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (bucketConfig) {
    try {
      await s3AbortMultipartUpload(bucketConfig, task.r2Key, task.uploadId);
    } catch (e) {
      console.error('Abort multipart upload error:', e);
    }
  }

  await db.update(uploadTasks)
    .set({ status: 'failed', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '上传已中止' } });
});

app.get('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'ossshelf-key';

  const task = await db.select().from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status === 'completed') {
    return c.json({ success: true, data: { ...task, uploadedParts: JSON.parse(task.uploadedParts || '[]') } });
  }

  if (new Date(task.expiresAt) < new Date()) {
    await db.update(uploadTasks).set({ status: 'expired', updatedAt: new Date().toISOString() }).where(eq(uploadTasks.id, taskId));
    return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
  }

  let uploadedParts: number[] = [];
  try {
    const parts = await s3ListParts(bucketConfig, task.r2Key, task.uploadId);
    uploadedParts = parts.map((p) => p.partNumber);
    await db.update(uploadTasks)
      .set({ uploadedParts: JSON.stringify(uploadedParts), status: 'uploading', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
  } catch (e) {
    console.error('List parts error:', e);
  }

  return c.json({
    success: true,
    data: {
      ...task,
      uploadedParts,
    },
  });
});

app.delete('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  await db.delete(uploadTasks).where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已删除' } });
});

app.post('/:taskId/pause', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status !== 'uploading' && task.status !== 'pending') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能暂停上传中或等待中的任务' } }, 400);
  }

  await db.update(uploadTasks)
    .set({ status: 'paused', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已暂停' } });
});

app.post('/:taskId/resume', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status !== 'paused') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能恢复已暂停的任务' } }, 400);
  }

  if (new Date(task.expiresAt) < new Date()) {
    await db.update(uploadTasks).set({ status: 'expired', updatedAt: new Date().toISOString() }).where(eq(uploadTasks.id, taskId));
    return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
  }

  await db.update(uploadTasks)
    .set({ status: 'pending', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已恢复' } });
});

app.delete('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  await db.delete(uploadTasks).where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已删除' } });
});

function encodeFilename(name: string): string {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
}

export default app;
