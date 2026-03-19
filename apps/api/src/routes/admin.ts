/**
 * admin.ts
 * 管理员路由
 *
 * 功能:
 * - 用户管理（列表、查询、禁用、删除）
 * - 注册配置管理
 * - 邀请码管理
 * - 系统统计与审计日志
 *
 * 所有接口需要管理员权限
 */

import { Hono } from 'hono';
import { getDb, users } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import {
  checkAdminPermission,
  getAllUsersWithStats,
  getUserById,
  updateUser,
  deleteUser,
  getRegistrationConfig,
  updateRegistrationConfig,
  createInviteCodes,
  revokeInviteCode,
  getSystemStats,
  getAuditLogs,
} from '../services/admin.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', authMiddleware);

app.use('*', async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '未授权' } }, 401);
  }
  const db = getDb(c.env.DB);
  const { authorized, user } = await checkAdminPermission(db, userId);
  if (!authorized) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '需要管理员权限' } }, 403);
  }
  c.set('user', { id: user!.id, email: user!.email, role: user!.role });
  await next();
});

const patchUserSchema = z
  .object({
    name: z.string().max(100).optional(),
    role: z.enum(['admin', 'user']).optional(),
    storageQuota: z.number().int().min(0).optional(),
    newPassword: z.string().min(6).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: '至少提供一个更新字段' });

const registrationSchema = z.object({
  open: z.boolean().optional(),
  requireInviteCode: z.boolean().optional(),
});

app.get('/users', async (c) => {
  const db = getDb(c.env.DB);
  const enriched = await getAllUsersWithStats(db);
  return c.json({ success: true, data: enriched });
});

app.get('/users/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const safe = await getUserById(db, id);
  if (!safe) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '用户不存在' } }, 404);
  }
  return c.json({ success: true, data: safe });
});

app.patch('/users/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const result = patchUserSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const updated = await updateUser(db, id, result.data);
  if (!updated) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '用户不存在' } }, 404);
  }

  await createAuditLog({
    env: c.env,
    userId: c.get('userId'),
    action: 'user.update',
    resourceType: 'user',
    resourceId: id,
    details: {
      name: result.data.name !== undefined,
      role: result.data.role,
      storageQuota: result.data.storageQuota,
      passwordReset: !!result.data.newPassword,
    },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '用户已更新' } });
});

app.delete('/users/:id', async (c) => {
  const adminId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const result = await deleteUser(c.env, db, adminId, id);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } },
      result.error === '用户不存在' ? 404 : 400
    );
  }

  return c.json({ success: true, data: { message: '用户已删除' } });
});

app.get('/registration', async (c) => {
  const data = await getRegistrationConfig(c.env.KV);
  return c.json({ success: true, data });
});

app.put('/registration', async (c) => {
  const body = await c.req.json();
  const result = registrationSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const updated = await updateRegistrationConfig(c.env.KV, result.data);
  return c.json({ success: true, data: updated });
});

app.post('/registration/codes', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const count = Math.max(1, Math.min(50, Number(body.count) || 1));

  const data = await createInviteCodes(c.env.KV, count);
  return c.json({ success: true, data });
});

app.delete('/registration/codes/:code', async (c) => {
  const code = c.req.param('code');
  await revokeInviteCode(c.env.KV, code);
  return c.json({ success: true, data: { message: '邀请码已撤销' } });
});

app.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const stats = await getSystemStats(db);
  return c.json({ success: true, data: stats });
});

app.get('/audit-logs', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20')));
  const userId = c.req.query('userId');
  const action = c.req.query('action');

  const db = getDb(c.env.DB);
  const data = await getAuditLogs(db, { page, limit, userId, action });

  return c.json({ success: true, data });
});

export default app;
