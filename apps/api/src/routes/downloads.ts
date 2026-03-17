/**
 * downloads.ts
 * 离线下载路由
 * 
 * 功能:
 * - 创建离线下载任务
 * - 任务状态管理
 * - 暂停/恢复/重试
 * - 任务清理
 */

import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, downloadTasks, users, files, storageBuckets } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, MAX_FILE_SIZE } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { s3Put } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const createTaskSchema = z.object({
  url: z.string().url('请输入有效的 URL'),
  fileName: z.string().min(1).max(255).optional(),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
});

const updateTaskSchema = z.object({
  fileName: z.string().min(1).max(255).optional(),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
});

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

app.post('/create', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createTaskSchema.safeParse(body);
  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } }, 400);
  }

  const { url, fileName, parentId, bucketId } = result.data;
  const db = getDb(c.env.DB);

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '用户不存在' } }, 401);
  }

  const encKey = c.env.JWT_SECRET || 'ossshelf-key';
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, bucketId, parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未配置存储桶' } }, 400);
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

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.upload',
    resourceType: 'download_task',
    resourceId: taskId,
    details: { url, fileName: resolvedFileName },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  c.executionCtx.waitUntil(
    (async () => {
      let downloadedBytes = 0;
      let totalSize = 0;
      try {
        await db.update(downloadTasks)
          .set({ status: 'downloading', updatedAt: new Date().toISOString() })
          .where(eq(downloadTasks.id, taskId));

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'OSSshelf/1.0',
          },
        });

        if (!response.ok) {
          throw new Error(`下载失败: HTTP ${response.status}`);
        }

        const contentLength = response.headers.get('Content-Length');
        const fileSize = contentLength ? parseInt(contentLength, 10) : 0;

        if (fileSize > MAX_FILE_SIZE) {
          throw new Error(`文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB）`);
        }

        const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

        if (user.storageUsed + fileSize > user.storageQuota) {
          throw new Error('用户存储配额已满');
        }

        const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
        if (quotaErr) {
          throw new Error(quotaErr);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('无法读取响应内容');
        }

        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();

        const uploadPromise = (async () => {
          const fileId = crypto.randomUUID();
          const r2Key = `files/${userId}/${fileId}/${resolvedFileName}`;
          const path = parentId ? `${parentId}/${resolvedFileName}` : `/${resolvedFileName}`;

          await s3Put(bucketConfig, r2Key, readable, contentType);

          return { fileId, r2Key, path };
        })();

        let lastProgressUpdate = Date.now();
        const PROGRESS_UPDATE_INTERVAL = 1000;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          await writer.write(value);
          downloadedBytes += value.length;

          const now = Date.now();
          if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
            const progress = fileSize > 0 ? Math.round((downloadedBytes / fileSize) * 100) : 0;
            await db.update(downloadTasks)
              .set({ progress, fileSize: downloadedBytes, updatedAt: new Date().toISOString() })
              .where(eq(downloadTasks.id, taskId));
            lastProgressUpdate = now;
          }
        }

        await writer.close();
        totalSize = downloadedBytes;

        const { fileId, r2Key, path } = await uploadPromise;

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

        await db.update(users)
          .set({ storageUsed: user.storageUsed + totalSize, updatedAt: now })
          .where(eq(users.id, userId));

        await updateBucketStats(db, bucketConfig.id, totalSize, 1);

        await db.update(downloadTasks)
          .set({
            status: 'completed',
            progress: 100,
            fileSize: totalSize,
            updatedAt: now,
            completedAt: now,
          })
          .where(eq(downloadTasks.id, taskId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '下载失败';
        await db.update(downloadTasks)
          .set({
            status: 'failed',
            errorMessage,
            fileSize: downloadedBytes || null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(downloadTasks.id, taskId));
      }
    })()
  );

  return c.json({
    success: true,
    data: {
      id: taskId,
      url,
      fileName: resolvedFileName,
      status: 'pending',
      createdAt: now,
    },
  });
});

app.get('/list', async (c) => {
  const userId = c.get('userId')!;
  const status = c.req.query('status') as 'pending' | 'downloading' | 'completed' | 'failed' | undefined;
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const db = getDb(c.env.DB);

  const conditions = [eq(downloadTasks.userId, userId)];
  if (status) {
    conditions.push(eq(downloadTasks.status, status));
  }

  const tasks = await db.select().from(downloadTasks)
    .where(and(...conditions))
    .orderBy(desc(downloadTasks.createdAt))
    .limit(limit)
    .offset((page - 1) * limit)
    .all();

  const total = await db.select().from(downloadTasks)
    .where(and(...conditions))
    .all()
    .then((r) => r.length);

  return c.json({
    success: true,
    data: {
      items: tasks,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

app.delete('/completed', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const result = await db.delete(downloadTasks)
    .where(and(eq(downloadTasks.userId, userId), eq(downloadTasks.status, 'completed')))
    .returning({ id: downloadTasks.id });

  return c.json({
    success: true,
    data: {
      message: `已清理 ${result.length} 个已完成的任务`,
      count: result.length,
    },
  });
});

app.delete('/failed', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const result = await db.delete(downloadTasks)
    .where(and(eq(downloadTasks.userId, userId), eq(downloadTasks.status, 'failed')))
    .returning({ id: downloadTasks.id });

  return c.json({
    success: true,
    data: {
      message: `已清理 ${result.length} 个失败的任务`,
      count: result.length,
    },
  });
});

app.get('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  return c.json({ success: true, data: task });
});

app.patch('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const body = await c.req.json();
  const result = updateTaskSchema.safeParse(body);

  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } }, 400);
  }

  const db = getDb(c.env.DB);

  const task = await db.select().from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status !== 'pending') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能修改待处理的任务' } }, 400);
  }

  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (result.data.fileName) {
    updateData.fileName = result.data.fileName;
  }
  if (result.data.parentId !== undefined) {
    updateData.parentId = result.data.parentId || null;
  }
  if (result.data.bucketId !== undefined) {
    updateData.bucketId = result.data.bucketId || null;
  }

  await db.update(downloadTasks)
    .set(updateData)
    .where(eq(downloadTasks.id, taskId));

  const updated = await db.select().from(downloadTasks)
    .where(eq(downloadTasks.id, taskId))
    .get();

  return c.json({ success: true, data: updated });
});

app.delete('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status === 'downloading') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无法删除正在下载的任务' } }, 400);
  }

  await db.delete(downloadTasks).where(eq(downloadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已删除' } });
});

app.post('/:taskId/retry', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status !== 'failed') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能重试失败的任务' } }, 400);
  }

  await db.update(downloadTasks)
    .set({
      status: 'pending',
      progress: 0,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(downloadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已重新排队' } });
});

app.post('/:taskId/pause', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status !== 'downloading' && task.status !== 'pending') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能暂停下载中或等待中的任务' } }, 400);
  }

  await db.update(downloadTasks)
    .set({
      status: 'paused',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(downloadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已暂停' } });
});

app.post('/:taskId/resume', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const task = await db.select().from(downloadTasks)
    .where(and(eq(downloadTasks.id, taskId), eq(downloadTasks.userId, userId)))
    .get();

  if (!task) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '任务不存在' } }, 404);
  }

  if (task.status !== 'paused') {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只能恢复已暂停的任务' } }, 400);
  }

  await db.update(downloadTasks)
    .set({
      status: 'pending',
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(downloadTasks.id, taskId));

  return c.json({ success: true, data: { message: '任务已恢复' } });
});

export default app;
