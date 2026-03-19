/**
 * permissions.ts
 * 文件权限与标签路由
 *
 * 功能:
 * - 文件权限授予与撤销
 * - 权限查询与检查
 * - 文件标签管理
 * - 批量标签操作
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import {
  checkFilePermission,
  grantPermission,
  revokePermission,
  getFilePermissions,
  addTag,
  removeTag,
  getFileTags,
  getUserTags,
  getBatchTags,
  checkPermission,
  searchUsers,
} from '../services/permissions.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const grantPermissionSchema = z.object({
  fileId: z.string().min(1),
  userId: z.string().min(1),
  permission: z.enum(['read', 'write', 'admin']),
});

const revokePermissionSchema = z.object({
  fileId: z.string().min(1),
  userId: z.string().min(1),
});

const addTagSchema = z.object({
  fileId: z.string().min(1),
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const removeTagSchema = z.object({
  fileId: z.string().min(1),
  tagName: z.string().min(1),
});

app.post('/grant', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = grantPermissionSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, userId: targetUserId, permission } = result.data;
  const db = getDb(c.env.DB);

  const grantResult = await grantPermission(db, userId, fileId, targetUserId, permission);

  if (!grantResult.success) {
    const statusCode = grantResult.error === '文件不存在或无权限' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: grantResult.error } }, statusCode);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.move',
    resourceType: 'permission',
    resourceId: fileId,
    details: { targetUserId, permission },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: grantResult.data });
});

app.post('/revoke', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = revokePermissionSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, userId: targetUserId } = result.data;
  const db = getDb(c.env.DB);

  const revokeResult = await revokePermission(db, userId, fileId, targetUserId);

  if (!revokeResult.success) {
    const statusCode = revokeResult.error === '文件不存在或无权限' ? 404 : 400;
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: revokeResult.error } }, statusCode);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.delete',
    resourceType: 'permission',
    resourceId: fileId,
    details: { targetUserId },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: revokeResult.data });
});

app.get('/file/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const result = await getFilePermissions(db, fileId, userId);

  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: result.error } }, 403);
  }

  return c.json({ success: true, data: result.data });
});

app.post('/tags/add', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = addTagSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, name, color } = result.data;
  const db = getDb(c.env.DB);

  const tagResult = await addTag(db, userId, fileId, name, color);

  if (!tagResult.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: tagResult.error } }, 403);
  }

  return c.json({ success: true, data: tagResult.data });
});

app.post('/tags/remove', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = removeTagSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, tagName } = result.data;
  const db = getDb(c.env.DB);

  const tagResult = await removeTag(db, userId, fileId, tagName);

  if (!tagResult.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: tagResult.error } }, 403);
  }

  return c.json({ success: true, data: tagResult.data });
});

app.get('/tags/file/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const result = await getFileTags(db, fileId, userId);

  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: result.error } }, 403);
  }

  return c.json({ success: true, data: result.data });
});

app.get('/tags/user', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const result = await getUserTags(db, userId);

  return c.json({ success: true, data: result.data });
});

const batchTagsSchema = z.object({
  fileIds: z.array(z.string().min(1)).max(100),
});

app.post('/tags/batch', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchTagsSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds } = result.data;
  const db = getDb(c.env.DB);

  const tagsResult = await getBatchTags(db, fileIds);

  return c.json({ success: true, data: tagsResult.data });
});

app.get('/check/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const result = await checkPermission(db, fileId, userId);

  return c.json({ success: true, data: result.data });
});

app.get('/users/search', async (c) => {
  const userId = c.get('userId')!;
  const query = c.req.query('q') || '';
  const db = getDb(c.env.DB);

  const result = await searchUsers(db, userId, query);

  return c.json({ success: true, data: result.data });
});

export { checkFilePermission };
export default app;
