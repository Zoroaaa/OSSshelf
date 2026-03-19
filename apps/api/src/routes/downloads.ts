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
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { getEncryptionKey } from '../lib/crypto';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { resolveBucketConfig } from '../lib/bucketResolver';
import {
  createDownloadTask,
  runDownload,
  getDownloadTasks,
  getDownloadTaskById,
  updateDownloadTask,
  deleteDownloadTask,
  retryDownloadTask,
  pauseDownloadTask,
  resumeDownloadTask,
  clearCompletedTasks,
  clearFailedTasks,
} from '../services/downloads.service';

import type { RunDownloadParams } from '../services/downloads.service';

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

  const { url, fileName, parentId, bucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const taskResult = await createDownloadTask(c.env, db, encKey, userId, {
    url,
    fileName,
    parentId,
    bucketId,
  });

  if (!taskResult.success) {
    const errorCode = taskResult.error === '用户不存在' ? ERROR_CODES.UNAUTHORIZED : 'NO_STORAGE';
    return c.json({ success: false, error: { code: errorCode, message: taskResult.error } }, 400);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.upload',
    resourceType: 'download_task',
    resourceId: taskResult.data!.id,
    details: { url, fileName: taskResult.data!.fileName },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, taskResult.data!.bucketId, parentId || null);
  if (bucketConfig) {
    c.executionCtx.waitUntil(
      runDownload({
        db,
        userId,
        taskId: taskResult.data!.id,
        task: { url, fileName: taskResult.data!.fileName, parentId: parentId || null, bucketId: taskResult.data!.bucketId },
        bucketConfig,
        env: c.env,
      })
    );
  }

  return c.json({ success: true, data: taskResult.data });
});

app.get('/list', async (c) => {
  const userId = c.get('userId')!;
  const status = c.req.query('status') as 'pending' | 'downloading' | 'completed' | 'failed' | undefined;
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const db = getDb(c.env.DB);
  const result = await getDownloadTasks(db, userId, { status, page, limit });
  return c.json({ success: true, data: result });
});

app.delete('/completed', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const result = await clearCompletedTasks(db, userId);
  return c.json({
    success: true,
    data: {
      message: `已清理 ${result.count} 个已完成的任务`,
      count: result.count,
    },
  });
});

app.delete('/failed', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const result = await clearFailedTasks(db, userId);
  return c.json({
    success: true,
    data: {
      message: `已清理 ${result.count} 个失败的任务`,
      count: result.count,
    },
  });
});

app.get('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);
  const task = await getDownloadTaskById(db, userId, taskId);
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
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const updateResult = await updateDownloadTask(db, userId, taskId, result.data);

  if (!updateResult.success) {
    const statusCode = updateResult.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: updateResult.error } }, statusCode);
  }

  return c.json({ success: true, data: updateResult.data });
});

app.delete('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);
  const result = await deleteDownloadTask(db, userId, taskId);

  if (!result.success) {
    const statusCode = result.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: { message: '任务已删除' } });
});

app.post('/:taskId/retry', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const retryResult = await retryDownloadTask(c.env, db, encKey, userId, taskId);

  if (!retryResult.success) {
    const statusCode = retryResult.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: retryResult.error } }, statusCode);
  }

  if (retryResult.bucketConfig) {
    c.executionCtx.waitUntil(
      runDownload({
        db,
        userId,
        taskId,
        task: retryResult.task!,
        bucketConfig: retryResult.bucketConfig,
        env: c.env,
      })
    );
  }

  return c.json({ success: true, data: { message: '任务已重新开始下载' } });
});

app.post('/:taskId/pause', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const result = await pauseDownloadTask(db, userId, taskId);

  if (!result.success) {
    const statusCode = result.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: { message: '任务已暂停' } });
});

app.post('/:taskId/resume', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const result = await resumeDownloadTask(db, userId, taskId);

  if (!result.success) {
    const statusCode = result.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: { message: '任务已恢复' } });
});

export default app;
