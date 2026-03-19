/**
 * downloads.service.ts
 * 离线下载业务逻辑服务
 *
 * 功能:
 * - 创建离线下载任务
 * - 任务状态管理
 * - 暂停/恢复/重试
 * - 任务清理
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb, downloadTasks, users, files, storageBuckets } from '../db';
import { ERROR_CODES, MAX_FILE_SIZE } from '@osshelf/shared';
import { s3Put } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { getEncryptionKey } from '../lib/crypto';
import type { Env } from '../types/env';

export interface DownloadTask {
  id: string;
  userId: string;
  url: string;
  fileName: string;
  fileSize: number | null;
  parentId: string | null;
  bucketId: string | null;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface RunDownloadParams {
  db: ReturnType<typeof getDb>;
  userId: string;
  taskId: string;
  task: { url: string; fileName: string | null; parentId: string | null; bucketId: string | null };
  bucketConfig: import('../lib/s3client').S3BucketConfig | null;
  env: Env;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function getFileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      return decodeURIComponent(segments[segments.length - 1]);
    }
    return 'downloaded_file';
  } catch {
    return 'downloaded_file';
  }
}

export async function createDownloadTask(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  data: { url: string; fileName?: string; parentId?: string | null; bucketId?: string | null }
) {
  const { url, fileName, parentId, bucketId } = data;

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, bucketId ?? null, parentId ?? null);
  if (!bucketConfig) {
    return { success: false, error: '未配置存储桶' };
  }

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();
  const resolvedFileName = fileName || getFileNameFromUrl(url);

  await db.insert(downloadTasks).values({
    id: taskId,
    userId,
    url,
    fileName: resolvedFileName,
    fileSize: null,
    parentId: parentId || null,
    bucketId: bucketConfig.id,
    status: 'pending',
    progress: 0,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });

  return {
    success: true,
    data: {
      id: taskId,
      url,
      fileName: resolvedFileName,
      status: 'pending',
      createdAt: now,
      bucketId: bucketConfig.id,
    },
  };
}

export async function runDownload({ db, userId, taskId, task, bucketConfig, env }: RunDownloadParams): Promise<void> {
  if (!bucketConfig) return;
  const { url, fileName, parentId } = task;
  const resolvedFileName = fileName || 'downloaded_file';
  let downloadedBytes = 0;
  let totalSize = 0;
  const now = new Date().toISOString();

  try {
    await db
      .update(downloadTasks)
      .set({ status: 'downloading', updatedAt: new Date().toISOString() })
      .where(eq(downloadTasks.id, taskId));

    const response = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'OSSshelf/1.0' } });
    if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);

    const contentLength = response.headers.get('Content-Length');
    const fileSize = contentLength ? parseInt(contentLength, 10) : 0;

    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB）`);
    }

    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

    const freshUser = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!freshUser) throw new Error('用户不存在');
    if (freshUser.storageUsed + fileSize > freshUser.storageQuota) throw new Error('用户存储配额已满');

    const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
    if (quotaErr) throw new Error(quotaErr);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应内容');

    const chunks: Uint8Array[] = [];
    let lastProgressUpdate = Date.now();
    const PROGRESS_UPDATE_INTERVAL = 1000;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloadedBytes += value.length;
      const nowTs = Date.now();
      if (nowTs - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
        const progress = fileSize > 0 ? Math.round((downloadedBytes / fileSize) * 100) : 0;
        await db
          .update(downloadTasks)
          .set({ progress, fileSize: downloadedBytes, updatedAt: new Date().toISOString() })
          .where(eq(downloadTasks.id, taskId));
        lastProgressUpdate = nowTs;
      }
    }

    totalSize = downloadedBytes;
    const fileData = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      fileData.set(chunk, offset);
    offset += chunk.length;
    }

    const fileId = crypto.randomUUID();
    const r2Key = `files/${userId}/${fileId}/${resolvedFileName}`;
    const path = parentId ? `${parentId}/${resolvedFileName}` : `/${resolvedFileName}`;

    await s3Put(bucketConfig, r2Key, fileData, contentType, undefined, totalSize);

    await db.insert(files).values({
      id: fileId,
      userId,
      parentId: parentId || null,
      name: resolvedFileName,
      path,
      type: 'file',
      size: totalSize,
      r2Key,
      mimeType: contentType,
      hash: null,
      isFolder: false,
      bucketId: bucketConfig.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await db
      .update(users)
      .set({ storageUsed: freshUser.storageUsed + totalSize, updatedAt: now })
      .where(eq(users.id, userId));

    await updateBucketStats(db, bucketConfig.id, totalSize, 1);

    await db
      .update(downloadTasks)
      .set({ status: 'completed', progress: 100, fileSize: totalSize, updatedAt: now, completedAt: now })
      .where(eq(downloadTasks.id, taskId));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '下载失败';
    await db
      .update(downloadTasks)
      .set({ status: 'failed', errorMessage, fileSize: downloadedBytes || null, updatedAt: new Date().toISOString() })
      .where(eq(downloadTasks.id, taskId));
  }
}

export async function getDownloadTasks(
  db: ReturnType<typeof getDb>,
  userId: string,
  params: { status?: 'pending' | 'downloading' | 'completed' | 'failed'; page?: number; limit?: number }
) {
  const { status, page = 1, limit = 20 } = params;

  const conditions = [eq(downloadTasks.userId, userId)];
  if (status) {
    conditions.push(eq(downloadTasks.status, status));
  }

  const tasks = await db
    .select()
    .from(downloadTasks)
    .where(and(...conditions))
    .orderBy(desc(downloadTasks.createdAt))
    .limit(limit)
    .offset((page - 1) * limit)
    .all();

  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(downloadTasks)
    .where(and(...conditions))
    .get();
  const total = Number(totalResult?.count ?? 0);

  return {
    items: tasks,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getDownloadTaskById(db: ReturnType<typeof getDb>, userId: string, taskId: string) {
  const task = await db
    .select()
    .from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return null;
  }

  return task;
}

export async function updateDownloadTask(
  db: ReturnType<typeof getDb>,
  userId: string,
  taskId: string,
  data: { fileName?: string; parentId?: string | null; bucketId?: string | null }
) {
  const task = await db
    .select()
    .from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status !== 'pending') {
    return { success: false, error: '只能修改待处理的任务' };
  }

  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (data.fileName) {
    updateData.fileName = data.fileName;
  }
  if (data.parentId !== undefined) {
    updateData.parentId = data.parentId || null;
  }
  if (data.bucketId !== undefined) {
    updateData.bucketId = data.bucketId || null;
  }

  await db.update(downloadTasks).set(updateData).where(eq(downloadTasks.id, taskId));

  const updated = await db.select().from(downloadTasks).where(eq(downloadTasks.id, taskId)).get();

  return { success: true, data: updated };
}

export async function deleteDownloadTask(db: ReturnType<typeof getDb>, userId: string, taskId: string) {
  const task = await db
    .select()
    .from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status === 'downloading') {
    return { success: false, error: '无法删除正在下载的任务' };
  }

  await db.delete(downloadTasks).where(eq(downloadTasks.id, taskId));

  return { success: true };
}

export async function retryDownloadTask(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  taskId: string
) {
  const task = await db
    .select()
    .from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status !== 'failed') {
    return { success: false, error: '只能重试失败的任务' };
  }

  const now = new Date().toISOString();
  await db
    .update(downloadTasks)
    .set({ status: 'pending', progress: 0, errorMessage: null, updatedAt: now })
    .where(eq(downloadTasks.id, taskId));

  const bucketConfig = task.bucketId
    ? await resolveBucketConfig(db, userId, encKey, task.bucketId, task.parentId)
    : null;

  return {
    success: true,
    bucketConfig,
    task: {
      url: task.url,
      fileName: task.fileName,
      parentId: task.parentId,
      bucketId: task.bucketId,
    },
  };
}

export async function pauseDownloadTask(db: ReturnType<typeof getDb>, userId: string, taskId: string) {
  const task = await db
    .select()
    .from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status !== 'downloading' && task.status !== 'pending') {
    return { success: false, error: '只能暂停下载中或等待中的任务' };
  }

  await db
    .update(downloadTasks)
    .set({
      status: 'paused',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(downloadTasks.id, taskId));

  return { success: true };
}

export async function resumeDownloadTask(db: ReturnType<typeof getDb>, userId: string, taskId: string) {
  const task = await db
    .select()
    .from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  if (task.status !== 'paused') {
    return { success: false, error: '只能恢复已暂停的任务' };
  }

  await db
    .update(downloadTasks)
    .set({
      status: 'pending',
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(downloadTasks.id, taskId));

  return { success: true };
}

export async function clearCompletedTasks(db: ReturnType<typeof getDb>, userId: string) {
  const result = await db
    .delete(downloadTasks)
    .where(and(eq(downloadTasks.userId, userId), eq(downloadTasks.status, 'completed')))
    .returning({ id: downloadTasks.id });

  return {
    success: true,
    count: result.length,
  };
}

export async function clearFailedTasks(db: ReturnType<typeof getDb>, userId: string) {
  const result = await db
    .delete(downloadTasks)
    .where(and(eq(downloadTasks.userId, userId), eq(downloadTasks.status, 'failed')))
    .returning({ id: downloadTasks.id });

  return {
    success: true,
    count: result.length,
  };
}
