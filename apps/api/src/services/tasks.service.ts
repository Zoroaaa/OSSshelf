/**
 * tasks.service.ts
 * 上传任务业务逻辑服务
 *
 * 功能:
 * - 创建上传任务
 * - 分片上传管理
 * - 任务状态查询
 * - 暂停/恢复/取消
 */

import { eq, and, inArray } from 'drizzle-orm';
import { getDb, uploadTasks, users, storageBuckets, files, telegramFileRefs } from '../db';
import {
  ERROR_CODES,
  MAX_FILE_SIZE,
  UPLOAD_TASK_EXPIRY,
  MULTIPART_THRESHOLD,
  UPLOAD_CHUNK_SIZE,
  inferMimeType,
} from '@osshelf/shared';
import { getEncryptionKey } from '../lib/crypto';
import type { Env } from '../types/env';
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
import { tgUploadFile, TG_MAX_FILE_SIZE, type TelegramBotConfig } from '../lib/telegramClient';
import { decryptSecret } from '../lib/s3client';

const UPLOAD_EXPIRY = 3600;

function encodeFilename(name: string): string {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
}

async function getUserOrFail(db: ReturnType<typeof getDb>, userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('用户不存在');
  return user;
}

export async function createUploadTask(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: {
    fileName: string;
    fileSize: number;
    mimeType?: string;
    parentId?: string | null;
    bucketId?: string | null;
  }
) {
  const { fileName, fileSize, mimeType: providedMimeType, parentId, bucketId: requestedBucketId } = params;

  const mimeType = inferMimeType(fileName, providedMimeType);

  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId ?? null, mimeType);
  if (!mimeCheck.allowed) {
    return { success: false, error: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}` };
  }

  const user = await getUserOrFail(db, userId);
  if (user.storageUsed + fileSize > user.storageQuota) {
    return { success: false, error: '用户存储配额已满' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId ?? null, parentId ?? null);
  if (!bucketConfig) {
    return { success: false, error: '未配置存储桶' };
  }

  if (bucketConfig.provider === 'telegram') {
    if (fileSize > TG_MAX_FILE_SIZE) {
      return { success: false, error: `Telegram 存储桶单文件上限 50MB，当前文件 ${(fileSize / 1024 / 1024).toFixed(1)}MB` };
    }

    const taskId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const r2Key = `files/${userId}/${fileId}/${encodeFilename(fileName)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + UPLOAD_TASK_EXPIRY).toISOString();

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

    return {
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
        proxyUploadUrl: `/api/tasks/telegram-upload`,
        isSmallFile: true,
        expiresAt,
      },
    };
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
  if (quotaErr) {
    return { success: false, error: quotaErr };
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
      uploadId: '',
      totalParts: 1,
      uploadedParts: '[]',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    return {
      success: true,
      data: {
        taskId,
        fileId,
        uploadId: '',
        r2Key,
        bucketId: bucketConfig.id,
        totalParts: 1,
        partSize: fileSize,
        uploadUrl,
        isSmallFile: true,
        expiresAt,
      },
    };
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

  return {
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
  };
}

export async function listUploadTasks(db: ReturnType<typeof getDb>, userId: string) {
  const tasks = await db.select().from(uploadTasks).where(eq(uploadTasks.userId, userId)).all();

  return tasks.map((t) => {
    let rawParts: unknown[] = [];
    try {
      rawParts = JSON.parse(t.uploadedParts || '[]');
  } catch {
    /* ignore */
  }
    const uploadedPartNumbers = rawParts.map((p) =>
      typeof p === 'number' ? p : (p as { partNumber: number }).partNumber
    );
    return { ...t, uploadedParts: uploadedPartNumbers };
  });
}

export async function clearUploadTasks(db: ReturnType<typeof getDb>, userId: string, type: 'all' | 'completed' | 'failed') {
  if (type === 'all') {
    await db.delete(uploadTasks).where(eq(uploadTasks.userId, userId));
  } else if (type === 'completed') {
    await db.delete(uploadTasks).where(and(eq(uploadTasks.userId, userId), eq(uploadTasks.status, 'completed')));
  } else {
    await db
      .delete(uploadTasks)
      .where(and(eq(uploadTasks.userId, userId), inArray(uploadTasks.status, ['failed', 'expired', 'aborted'])));
  }
  return { success: true };
}

export async function getUploadPartUrl(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: { taskId: string; partNumber: number }
) {
  const { taskId, partNumber } = params;

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status === 'completed') {
    return { success: false, error: '任务已完成' };
  }

  if (new Date(task.expiresAt) < new Date()) {
    return { success: false, error: '上传任务已过期' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return { success: false, error: '存储桶配置不存在' };
  }

  const partUrl = await s3PresignUploadPart(bucketConfig, task.r2Key, task.uploadId, partNumber, UPLOAD_EXPIRY);

  return { success: true, data: { partUrl, partNumber, expiresIn: UPLOAD_EXPIRY } };
}

export async function recordPartDone(
  db: ReturnType<typeof getDb>,
  userId: string,
  params: { taskId: string; partNumber: number; etag: string }
) {
  const { taskId, partNumber, etag } = params;

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status === 'completed') {
    return { success: true, data: { message: '任务已完成' } };
  }

  if (new Date(task.expiresAt) < new Date()) {
    return { success: false, error: '上传任务已过期' };
  }

  const uploadedParts: Array<{ partNumber: number; etag: string }> = JSON.parse(task.uploadedParts || '[]');
  const alreadyRecorded = uploadedParts.some((p) => p.partNumber === partNumber);
  if (!alreadyRecorded) {
    uploadedParts.push({ partNumber, etag });
    await db
      .update(uploadTasks)
      .set({ uploadedParts: JSON.stringify(uploadedParts), status: 'uploading', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
  }

  return { success: true, data: { partNumber, etag, uploadedParts: uploadedParts.map((p) => p.partNumber) } };
}

export async function uploadPartProxy(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: { taskId: string; partNumber: number; chunk: ArrayBuffer }
) {
  const { taskId, partNumber, chunk } = params;

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (new Date(task.expiresAt) < new Date()) {
    return { success: false, error: '上传任务已过期' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return { success: false, error: '存储桶配置不存在' };
  }

  const etag = await s3UploadPart(bucketConfig, task.r2Key, task.uploadId, partNumber, chunk);

  const uploadedParts: Array<{ partNumber: number; etag: string }> = JSON.parse(task.uploadedParts || '[]');
  const alreadyRecorded = uploadedParts.some((p) => p.partNumber === partNumber);
  if (!alreadyRecorded) {
    uploadedParts.push({ partNumber, etag });
    await db
      .update(uploadTasks)
      .set({ uploadedParts: JSON.stringify(uploadedParts), status: 'uploading', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
  }

  return { success: true, data: { partNumber, etag } };
}

export async function telegramUpload(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: { taskId: string; file: File }
) {
  const { taskId, file } = params;

  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }
  if (task.uploadId !== 'telegram') {
    return { success: false, error: '非 Telegram 上传任务' };
  }
  if (new Date(task.expiresAt) < new Date()) {
    return { success: false, error: '上传任务已过期' };
  }

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, task.bucketId!), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket || bucket.provider !== 'telegram') {
    return { success: false, error: '找不到 Telegram 存储桶' };
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
    const fileBuffer = await file.arrayBuffer();
    tgResult = await tgUploadFile(tgConfig, fileBuffer, task.fileName, task.mimeType, caption);
  } catch (e: any) {
    await db.update(uploadTasks).set({ status: 'failed', updatedAt: now }).where(eq(uploadTasks.id, taskId));
    return { success: false, error: e?.message || 'Telegram 上传失败' };
  }

  const r2KeyParts = task.r2Key.split('/');
  const fileId = r2KeyParts[2] || crypto.randomUUID();
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

  await db.insert(telegramFileRefs).values({
    id: crypto.randomUUID(),
    fileId,
    r2Key: task.r2Key,
    tgFileId: tgResult.fileId,
    tgFileSize: tgResult.fileSize,
    bucketId: task.bucketId!,
    createdAt: now,
  });

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user) {
    await db.update(users).set({ storageUsed: user.storageUsed + task.fileSize, updatedAt: now }).where(eq(users.id, userId));
  }
  await updateBucketStats(db, task.bucketId!, task.fileSize, 1);

  await db.update(uploadTasks).set({ status: 'completed', updatedAt: now }).where(eq(uploadTasks.id, taskId));

  return {
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
  };
}

export async function completeUploadTask(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: { taskId: string; parts: MultipartPart[] }
) {
  const { taskId, parts } = params;

  try {
    const task = await db
      .select()
      .from(uploadTasks)
      .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
      .get();

    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    if (task.status === 'completed') {
      return { success: true, data: { message: '任务已完成', taskId } };
    }

    if (new Date(task.expiresAt) < new Date()) {
      return { success: false, error: '上传任务已过期' };
    }

    const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, task.parentId);
    if (!bucketConfig) {
      return { success: false, error: '存储桶配置不存在' };
    }

    if (!task.bucketId) {
      return { success: false, error: '任务缺少存储桶ID' };
    }

    const isSmallFile = !task.uploadId || task.uploadId === '';
    const isTelegramTask = task.uploadId === 'telegram';
    const now = new Date().toISOString();

    if (isTelegramTask) {
      return {
        success: true,
        data: {
          id: taskId,
          name: task.fileName,
          size: task.fileSize,
          mimeType: task.mimeType,
          bucketId: task.bucketId,
          createdAt: now,
        },
      };
    }

    if (!isSmallFile) {
      if (parts.length !== task.totalParts) {
        return { success: false, error: `分片数量不匹配：期望 ${task.totalParts} 个，实际 ${parts.length} 个` };
      }

      try {
        await s3CompleteMultipartUpload(bucketConfig, task.r2Key, task.uploadId, parts);
      } catch (s3Error: any) {
        console.error('S3 Complete Multipart Upload Error:', s3Error);
        await db.update(uploadTasks).set({ status: 'failed', updatedAt: now }).where(eq(uploadTasks.id, taskId));
        return { success: false, error: `合并分片失败: ${s3Error.message || '未知错误'}` };
      }
    }

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

    return {
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
    };
  } catch (error: any) {
    console.error('Complete upload task error:', error);
    return { success: false, error: error.message || '上传完成失败' };
  }
}

export async function abortUploadTask(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  taskId: string
) {
  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status === 'completed') {
    return { success: false, error: '任务已完成，无法中止' };
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

  return { success: true };
}

export async function getUploadTaskStatus(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  taskId: string
) {
  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status === 'completed') {
    return { success: true, data: { ...task, uploadedParts: JSON.parse(task.uploadedParts || '[]') } };
  }

  if (new Date(task.expiresAt) < new Date()) {
    await db
      .update(uploadTasks)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
    return { success: false, error: '上传任务已过期' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, task.bucketId, null);
  if (!bucketConfig) {
    return { success: false, error: '存储桶配置不存在' };
  }

  let storedParts: Array<{ partNumber: number; etag: string }> = [];
  try {
    storedParts = JSON.parse(task.uploadedParts || '[]');
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
    } catch (e) {
      console.error('List parts error:', e);
    }
  }

  const uploadedPartNumbers = parts.map((p) => p.partNumber);

  return {
    success: true,
    data: {
      ...task,
      uploadedParts: uploadedPartNumbers,
      parts,
    },
  };
}

export async function deleteUploadTask(db: ReturnType<typeof getDb>, userId: string, taskId: string) {
  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  await db.delete(uploadTasks).where(eq(uploadTasks.id, taskId));
  return { success: true };
}

export async function pauseUploadTask(db: ReturnType<typeof getDb>, userId: string, taskId: string) {
  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status !== 'uploading' && task.status !== 'pending') {
    return { success: false, error: '只能暂停上传中或等待中的任务' };
  }

  await db
    .update(uploadTasks)
    .set({ status: 'paused', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return { success: true };
}

export async function resumeUploadTask(db: ReturnType<typeof getDb>, userId: string, taskId: string) {
  const task = await db
    .select()
    .from(uploadTasks)
    .where(and(eq(uploadTasks.id, taskId), eq(uploadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status !== 'paused') {
    return { success: false, error: '只能恢复已暂停的任务' };
  }

  if (new Date(task.expiresAt) < new Date()) {
    await db
      .update(uploadTasks)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(uploadTasks.id, taskId));
    return { success: false, error: '上传任务已过期' };
  }

  await db
    .update(uploadTasks)
    .set({ status: 'pending', updatedAt: new Date().toISOString() })
    .where(eq(uploadTasks.id, taskId));

  return { success: true };
}
