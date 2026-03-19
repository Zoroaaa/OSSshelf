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
import { getDb, uploadTasks, users, storageBuckets, files, telegramFileRefs } from '../db';
import { authMiddleware } from '../middleware/auth';
import {
  ERROR_CODES,
  MAX_FILE_SIZE,
  UPLOAD_TASK_EXPIRY,
  MULTIPART_THRESHOLD,
  UPLOAD_CHUNK_SIZE,
  inferMimeType,
} from '@osshelf/shared';
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
  type TelegramBotConfig,
} from '../lib/telegramClient';
import { decryptSecret } from '../lib/s3client';

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

const completeTaskSchema = z
  .object({
    taskId: z.string().min(1),
    parts: z
      .array(
        z.object({
          partNumber: z.number().int().min(1),
          etag: z.string().min(1, 'etag 不能为空'),
        })
      )
      .min(1),
  })
  .refine(
    (data) => {
      const hasEmptyEtag = data.parts.some((p) => !p.etag || p.etag.trim() === '');
      return !hasEmptyEtag;
    },
    { message: '所有分片的 etag 不能为空' }
  );

async function getUserOrFail(db: ReturnType<typeof getDb>, userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('用户不存在');
  return user;
}

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
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: '用户存储配额已满' } }, 400);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId, parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未配置存储桶' } }, 400);
  }

  // ── Telegram 桶：返回特殊标记，让前端走代理上传路径 ──────────────────
  if (bucketConfig.provider === 'telegram') {
    // 检查文件大小限制
    if (fileSize > TG_MAX_FILE_SIZE) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.FILE_TOO_LARGE,
            message: `Telegram 存储桶单文件上限 50MB，当前文件 ${(fileSize / 1024 / 1024).toFixed(1)}MB`,
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

    // 存一条 pending 任务记录方便前端追踪
    await db.insert(uploadTasks).values({
      id: taskId,
      userId,
      fileName,
      fileSize,
      mimeType: mimeType || null,
      parentId: parentId || null,
      bucketId: bucketConfig.id,
      r2Key,
      uploadId: 'telegram',
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
        isTelegramUpload: true, // 前端识别标志
        proxyUploadUrl: `/api/tasks/telegram-upload`,
        isSmallFile: true,
        expiresAt,
      },
    });
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
  if (quotaErr) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: quotaErr } }, 400);
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status === 'completed') {
    return c.json({ success: true, data: { message: '任务已完成' } });
  }

  if (new Date(task.expiresAt) < new Date()) {
    return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
  }

  // 存储 {partNumber, etag} 对象以支持断点续传时直接使用，无需再次调用 S3 ListParts
  const uploadedParts: Array<{ partNumber: number; etag: string }> = JSON.parse(task.uploadedParts || '[]');
  const alreadyRecorded = uploadedParts.some((p) => p.partNumber === partNumber);
  if (!alreadyRecorded) {
    uploadedParts.push({ partNumber, etag });
    await db
      .update(uploadTasks)
      .set({ uploadedParts: JSON.stringify(uploadedParts), status: 'uploading', updatedAt: new Date().toISOString() })
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
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少必要参数' } }, 400);
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
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

  const uploadedParts: Array<{ partNumber: number; etag: string }> = JSON.parse(task.uploadedParts || '[]');
  const alreadyRecorded = uploadedParts.some((p) => p.partNumber === partNumber);
  if (!alreadyRecorded) {
    uploadedParts.push({ partNumber, etag });
    await db
      .update(uploadTasks)
      .set({ uploadedParts: JSON.stringify(uploadedParts), status: 'uploading', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
  }

  return c.json({ success: true, data: { partNumber, etag } });
});

// ── POST /api/tasks/telegram-upload ─────────────────────────────────────
// 接收前端 multipart 文件，转发到 Telegram Bot API，完成后写入 DB
app.post('/telegram-upload', async (c) => {
  const userId = c.get('userId')!;
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data' } }, 400);
  }

  const formData = await c.req.formData();
  const taskId = formData.get('taskId') as string | null;
  const fileBlob = formData.get('file') as File | null;

  if (!taskId || !fileBlob) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少 taskId 或 file' } }, 400);
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }
  if (task.uploadId !== 'telegram') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '非 Telegram 上传任务' } }, 400);
  }
  if (new Date(task.expiresAt) < new Date()) {
    return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
  }

  // 获取 Telegram 桶配置
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

  const now = new Date().toISOString();
  const caption = `📁 ${task.fileName}\n🗂 OSSshelf | ${now.slice(0, 10)}`;

  let tgResult;
  try {
    const fileBuffer = await fileBlob.arrayBuffer();
    tgResult = await tgUploadFile(tgConfig, fileBuffer, task.fileName, task.mimeType, caption);
  } catch (e: any) {
    await db.update(uploadTasks).set({ status: 'failed', updatedAt: now }).where(eq(uploadTasks.id, taskId));
    return c.json({ success: false, error: { code: 'TG_UPLOAD_FAILED', message: e?.message || 'Telegram 上传失败' } }, 502);
  }

  // 生成 fileId（使用 r2Key 中内嵌的那个 UUID 保持一致）
  const r2KeyParts = task.r2Key.split('/');
  const fileId = r2KeyParts[2] || crypto.randomUUID();
  const path = task.parentId ? `${task.parentId}/${task.fileName}` : `/${task.fileName}`;

  // 写入 files 表
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

  // 写入 telegram_file_refs
  await db.insert(telegramFileRefs).values({
    id: crypto.randomUUID(),
    fileId,
    r2Key: task.r2Key,
    tgFileId: tgResult.fileId,
    tgFileSize: tgResult.fileSize,
    bucketId: task.bucketId!,
    createdAt: now,
  });

  // 更新用户存储用量 & 桶统计
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user) {
    await db.update(users).set({ storageUsed: user.storageUsed + task.fileSize, updatedAt: now }).where(eq(users.id, userId));
  }
  await updateBucketStats(db, task.bucketId!, task.fileSize, 1);

  // 标记任务完成
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
});

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

  const { taskId, parts } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  try {
    const task = await db
      .select()
      .from(uploadTasks)
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
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '任务缺少存储桶ID' } },
        400
      );
    }

    const isSmallFile = !task.uploadId || task.uploadId === '';
    const isTelegramTask = task.uploadId === 'telegram';
    const now = new Date().toISOString();

    // Telegram 任务已在 /telegram-upload 端点完成全部处理，直接返回
    if (isTelegramTask) {
      return c.json({
        success: true,
        data: {
          id: taskId,
          name: task.fileName,
          size: task.fileSize,
          mimeType: task.mimeType,
          bucketId: task.bucketId,
          createdAt: now,
        },
      });
    }

    if (!isSmallFile) {
      // 大文件：校验分片数量并合并
      if (parts.length !== task.totalParts) {
        console.warn(`Parts count mismatch: expected ${task.totalParts}, got ${parts.length}`);
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
        console.error('S3 Complete Multipart Upload Error:', s3Error);
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
    console.error('Complete upload task error:', error);
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
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少任务ID' } }, 400);
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
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
    } catch (e) {
      console.error('Abort multipart upload error:', e);
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status === 'completed') {
    return c.json({ success: true, data: { ...task, uploadedParts: JSON.parse(task.uploadedParts || '[]') } });
  }

  if (new Date(task.expiresAt) < new Date()) {
    await db
      .update(uploadTasks)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
    return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶配置不存在' } }, 400);
  }

  // 优先使用 DB 中缓存的已上传分片信息（包含 etag），避免每次断点续传都调 S3 ListParts
  let storedParts: Array<{ partNumber: number; etag: string }> = [];
  try {
    storedParts = JSON.parse(task.uploadedParts || '[]');
    // 兼容旧格式（数字数组）
    if (storedParts.length > 0 && typeof storedParts[0] === 'number') {
      storedParts = (storedParts as unknown as number[]).map((n) => ({ partNumber: n, etag: '' }));
    }
  } catch {
    /* ignore */
  }

  let parts: MultipartPart[] = storedParts.filter((p) => p.etag); // 只保留有 etag 的

  // 若 DB 缓存为空或缺少 etag（旧数据兼容），降级调 S3 ListParts
  if (parts.length === 0 && task.uploadId) {
    try {
      parts = await s3ListParts(bucketConfig, task.r2Key, task.uploadId);
      // 回写 DB 缓存（含 etag）以便后续断点续传复用
      if (parts.length > 0) {
        await db
          .update(uploadTasks)
          .set({ uploadedParts: JSON.stringify(parts), status: 'uploading', updatedAt: new Date().toISOString() })
          .where(eq(uploadTasks.id, taskId));
      }
    } catch (e) {
      console.error('List parts error:', e);
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
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
    return c.json({ success: false, error: { code: ERROR_CODES.TASK_EXPIRED, message: '上传任务已过期' } }, 410);
  }

  await db
    .update(uploadTasks)
    .set({ status: 'pending', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已恢复' } });
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  await db.delete(uploadTasks).where(eq(uploadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已删除' } });
});

function encodeFilename(name: string): string {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
}

export default app;
