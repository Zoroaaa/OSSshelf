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
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, MAX_FILE_SIZE } from '@osshelf/shared';
import { getEncryptionKey } from '../lib/crypto';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import {
  createUploadTask,
  listUploadTasks,
  clearUploadTasks,
  getUploadPartUrl,
  recordPartDone,
  uploadPartProxy,
  telegramUpload,
  completeUploadTask,
  abortUploadTask,
  getUploadTaskStatus,
  deleteUploadTask,
  pauseUploadTask,
  resumeUploadTask,
} from '../services/tasks.service';
import type { MultipartPart } from '../lib/s3client';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

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

const partDoneSchema = z.object({
  taskId: z.string().min(1),
  partNumber: z.number().int().min(1).max(10000),
  etag: z.string().min(1, 'etag 不能为空'),
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

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const taskResult = await createUploadTask(c.env, db, encKey, userId, result.data);

  if (!taskResult.success) {
    const errorCode = taskResult.error?.includes('超过限制')
      ? ERROR_CODES.FILE_TOO_LARGE
      : taskResult.error?.includes('配额')
        ? ERROR_CODES.STORAGE_EXCEEDED
        : 'NO_STORAGE';
    return c.json({ success: false, error: { code: errorCode, message: taskResult.error } }, 400);
  }

  return c.json({ success: true, data: taskResult.data });
});

app.get('/list', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const tasks = await listUploadTasks(db, userId);
  return c.json({ success: true, data: tasks });
});

app.delete('/clear', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  await clearUploadTasks(db, userId, 'all');
  return c.json({ success: true, data: { message: '已清空历史任务记录' } });
});

app.delete('/clear-completed', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  await clearUploadTasks(db, userId, 'completed');
  return c.json({ success: true, data: { message: '已清空已完成的任务' } });
});

app.delete('/clear-failed', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  await clearUploadTasks(db, userId, 'failed');
  return c.json({ success: true, data: { message: '已清空失败/过期/取消的任务' } });
});

app.delete('/clear-all', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  await clearUploadTasks(db, userId, 'all');
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

  const partResult = await getUploadPartUrl(db, encKey, userId, { taskId, partNumber });

  if (!partResult.success) {
    const statusCode = partResult.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: partResult.error } }, statusCode);
  }

  return c.json({ success: true, data: partResult.data });
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

  const partResult = await recordPartDone(db, userId, { taskId, partNumber, etag });

  if (!partResult.success) {
    const statusCode = partResult.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: partResult.error } }, statusCode);
  }

  return c.json({ success: true, data: partResult.data });
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

  const chunkBuffer = await chunk.arrayBuffer();
  const partResult = await uploadPartProxy(c.env, db, encKey, userId, { taskId, partNumber, chunk: chunkBuffer });

  if (!partResult.success) {
    const statusCode = partResult.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: partResult.error } }, statusCode);
  }

  return c.json({ success: true, data: partResult.data });
});

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
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少 taskId 或 file' } }, 400);
  }

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const uploadResult = await telegramUpload(c.env, db, encKey, userId, { taskId, file: fileBlob });

  if (!uploadResult.success) {
    const statusCode = uploadResult.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: uploadResult.error } }, statusCode);
  }

  return c.json({ success: true, data: uploadResult.data });
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

  const completeResult = await completeUploadTask(c.env, db, encKey, userId, {
    taskId,
    parts: parts as MultipartPart[],
  });

  if (!completeResult.success) {
    const statusCode = completeResult.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: completeResult.error } }, statusCode);
  }

  return c.json({ success: true, data: completeResult.data });
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

  const abortResult = await abortUploadTask(db, encKey, userId, taskId);

  if (!abortResult.success) {
    const statusCode = abortResult.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: abortResult.error } }, statusCode);
  }

  return c.json({ success: true, data: { message: '上传已中止' } });
});

app.get('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await getUploadTaskStatus(db, encKey, userId, taskId);

  if (!result.success) {
    const statusCode = result.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

app.delete('/:taskId', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const result = await deleteUploadTask(db, userId, taskId);

  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, 404);
  }

  return c.json({ success: true, data: { message: '任务已删除' } });
});

app.post('/:taskId/pause', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const result = await pauseUploadTask(db, userId, taskId);

  if (!result.success) {
    const statusCode = result.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: { message: '任务已暂停' } });
});

app.post('/:taskId/resume', async (c) => {
  const userId = c.get('userId')!;
  const taskId = c.req.param('taskId');
  const db = getDb(c.env.DB);

  const result = await resumeUploadTask(db, userId, taskId);

  if (!result.success) {
    const statusCode = result.error === '任务不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: { message: '任务已恢复' } });
});

export default app;
