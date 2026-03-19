/**
 * files.ts
 * 文件管理路由
 *
 * 功能:
 * - 文件/文件夹的增删改查
 * - 文件上传与下载
 * - 回收站管理
 * - 文件预览与缩略图
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, MAX_FILE_SIZE, isPreviewableMimeType, inferMimeType } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { getEncryptionKey } from '../lib/crypto';
import {
  createFolder,
  uploadFile,
  listFiles,
  getFileById,
  updateFile,
  updateFolderSettings,
  moveFile,
  softDeleteFile,
  downloadFile,
  previewFile,
  listTrash,
  restoreFile,
  permanentDeleteFile,
  emptyTrash,
} from '../services/files.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createFolderSchema = z.object({
  name: z.string().min(1, '文件夹名称不能为空').max(255, '名称过长'),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
});

const updateFileSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(255, '名称过长').optional(),
  parentId: z.string().nullable().optional(),
});

const updateFolderSettingsSchema = z.object({
  allowedMimeTypes: z.array(z.string()).nullable().optional(),
});

const moveFileSchema = z.object({
  targetParentId: z.string().nullable(),
});

app.get('/:id/preview', async (c) => {
  let userId: string | undefined;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const { verifyJWT } = await import('../lib/crypto');
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      if (payload?.userId) userId = payload.userId;
    } catch {
      /* ignore */
    }
  }
  if (!userId) {
    const queryToken = c.req.query('token');
    if (queryToken) {
      try {
        const { verifyJWT } = await import('../lib/crypto');
        const payload = await verifyJWT(queryToken, c.env.JWT_SECRET);
        if (payload?.userId) userId = payload.userId;
      } catch {
        /* ignore */
      }
    }
  }
  if (!userId) return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '未授权' } }, 401);

  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await previewFile(c.env, db, encKey, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } }, statusCode);
  }

  return new Response(result.data!.body, { headers: result.data!.headers });
});

app.use('*', authMiddleware);

app.post('/upload', async (c) => {
  const userId = c.get('userId')!;
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data 格式上传' } },
      400
    );
  }

  const formData = await c.req.formData();
  const uploadFileData = formData.get('file') as File | null;
  const parentId = formData.get('parentId') as string | null;
  const requestedBucketId = formData.get('bucketId') as string | null;

  if (!uploadFileData)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请选择要上传的文件' } },
      400
    );

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await uploadFile(c.env, db, encKey, userId, {
    file: uploadFileData,
    parentId,
    bucketId: requestedBucketId,
  });

  if (!result.success) {
    const errorCode = result.error?.includes('超过限制') ? ERROR_CODES.FILE_TOO_LARGE : ERROR_CODES.VALIDATION_ERROR;
    return c.json({ success: false, error: { code: errorCode, message: result.error } }, 400);
  }

  return c.json({ success: true, data: result.data });
});

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const parentId = c.req.query('parentId') || null;
  const search = c.req.query('search') || '';
  const sortBy = (c.req.query('sortBy') || 'createdAt') as 'name' | 'size' | 'createdAt' | 'updatedAt';
  const sortOrder = (c.req.query('sortOrder') || 'desc') as 'asc' | 'desc';

  const db = getDb(c.env.DB);
  const items = await listFiles(db, userId, { parentId, search, sortBy, sortOrder });

  return c.json({ success: true, data: items });
});

app.get('/trash', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const items = await listTrash(db, userId);
  return c.json({ success: true, data: items });
});

app.post('/trash/:id/restore', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const result = await restoreFile(db, userId, fileId);
  if (!result.success)
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, 404);
  return c.json({ success: true, data: result.data });
});

app.delete('/trash/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const result = await permanentDeleteFile(c.env, db, encKey, userId, fileId);
  if (!result.success)
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, 404);
  return c.json({ success: true, data: result.data });
});

app.delete('/trash', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const result = await emptyTrash(c.env, db, encKey, userId);
  return c.json({ success: true, data: result.data });
});

app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createFolderSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );

  const { name, parentId, bucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const folderResult = await createFolder(db, encKey, userId, { name, parentId, bucketId });

  if (!folderResult.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: folderResult.error } }, 400);
  }

  return c.json({ success: true, data: folderResult.data });
});

app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const result = await getFileById(db, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '无权访问此文件' ? 403 : 404;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

app.put('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const body = await c.req.json();
  const result = updateFileSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  const db = getDb(c.env.DB);

  const updateResult = await updateFile(db, userId, fileId, result.data);

  if (!updateResult.success) {
    const statusCode = updateResult.error === '无权修改此文件' ? 403 : 404;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: updateResult.error } }, statusCode);
  }

  return c.json({ success: true, data: updateResult.data });
});

app.put('/:id/settings', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const body = await c.req.json();
  const result = updateFolderSettingsSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );

  const db = getDb(c.env.DB);
  const updateResult = await updateFolderSettings(db, userId, fileId, result.data);

  if (!updateResult.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: updateResult.error } }, 404);
  }

  return c.json({ success: true, data: updateResult.data });
});

app.post('/:id/move', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const body = await c.req.json();
  const result = moveFileSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  const { targetParentId } = result.data;
  const db = getDb(c.env.DB);

  const moveResult = await moveFile(db, userId, fileId, targetParentId);

  if (!moveResult.success) {
    const statusCode = moveResult.error === '文件不存在' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: moveResult.error } }, statusCode);
  }

  return c.json({ success: true, data: moveResult.data });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const result = await softDeleteFile(db, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '无权删除此文件' ? 403 : 404;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return c.json({ success: true, data: result.data });
});

app.get('/:id/download', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await downloadFile(c.env, db, encKey, userId, fileId);

  if (!result.success) {
    const statusCode = result.error === '无权下载此文件' ? 403 : 404;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, statusCode);
  }

  return new Response(result.data!.body, { headers: result.data!.headers });
});

export default app;
