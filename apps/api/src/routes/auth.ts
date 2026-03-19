/**
 * auth.ts
 * 用户认证路由
 *
 * 功能:
 * - 用户注册与登录
 * - 登录失败锁定保护
 * - 设备管理与会话控制
 * - 用户信息查询与更新
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import {
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  updateProfile,
  deleteAccount,
  getUserDevices,
  removeDevice,
  getUserStats,
  getRegConfig,
} from '../services/auth.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6个字符'),
  name: z.string().optional(),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
  deviceId: z.string().optional(),
  deviceName: z.string().optional(),
});

const updateProfileSchema = z
  .object({
    name: z.string().max(100, '昵称过长').optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6, '新密码至少6个字符').optional(),
  })
  .refine((d) => !(d.newPassword && !d.currentPassword), {
    message: '修改密码需要提供当前密码',
    path: ['currentPassword'],
  });

const deleteAccountSchema = z.object({
  password: z.string().min(1, '请输入密码确认注销'),
});

app.get('/registration-config', async (c) => {
  const config = await getRegConfig(c.env.KV);
  return c.json({ success: true, data: config });
});

app.post('/register', async (c) => {
  const body = await c.req.json();
  const result = registerSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const regResult = await registerUser(c.env, db, result.data);

  if (!regResult.success) {
    const statusCode = regResult.error!.code === 'REGISTRATION_CLOSED' ? 403 : 400;
    return c.json({ success: false, error: regResult.error }, statusCode);
  }

  await createAuditLog({
    env: c.env,
    userId: regResult.data!.user.id,
    action: 'user.register',
    resourceType: 'user',
    resourceId: regResult.data!.user.id,
    details: { email: result.data.email, name: result.data.name },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: regResult.data });
});

app.post('/login', async (c) => {
  const body = await c.req.json();
  const result = loginSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const ipAddress = getClientIp(c) || '';
  const userAgent = getUserAgent(c) || '';

  const loginResult = await loginUser(c.env, db, result.data, { ipAddress, userAgent });

  if (!loginResult.success) {
    const code = loginResult.error!.code;
    const statusCode = code === ERROR_CODES.LOGIN_LOCKED ? 429 : 401;
    await createAuditLog({
      env: c.env,
      userId: undefined,
      action: 'user.login',
      resourceType: 'user',
      status: 'failed',
      errorMessage: loginResult.error!.message,
      ipAddress,
      userAgent,
    });
    return c.json({ success: false, error: loginResult.error }, statusCode);
  }

  await createAuditLog({
    env: c.env,
    userId: loginResult.data!.user.id,
    action: 'user.login',
    resourceType: 'user',
    resourceId: loginResult.data!.user.id,
    details: { deviceId: loginResult.data!.deviceId, deviceName: result.data.deviceName },
    ipAddress,
    userAgent,
  });

  return c.json({ success: true, data: loginResult.data });
});

app.post('/logout', authMiddleware, async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.slice(7);
  await logoutUser(c.env, token || '');

  await createAuditLog({
    env: c.env,
    userId: c.get('userId'),
    action: 'user.logout',
    resourceType: 'user',
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '已退出登录' } });
});

app.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env.DB);

  const user = await getCurrentUser(db, userId!);
  if (!user) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '用户不存在' } }, 404);
  }

  return c.json({ success: true, data: user });
});

app.patch('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = updateProfileSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const updateResult = await updateProfile(db, userId, result.data);

  if (!updateResult.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: updateResult.error } },
      updateResult.error === '当前密码错误' ? 401 : 404
    );
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'user.update',
    resourceType: 'user',
    resourceId: userId,
    details: { nameChanged: result.data.name !== undefined, passwordChanged: !!result.data.newPassword },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: updateResult.data });
});

app.delete('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = deleteAccountSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.slice(7);

  const deleteResult = await deleteAccount(c.env, db, userId, result.data.password, token || '');

  if (!deleteResult.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: deleteResult.error } },
      deleteResult.error === '密码错误，无法注销账户' ? 401 : 404
    );
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'user.delete',
    resourceType: 'user',
    resourceId: userId,
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '账户已注销' } });
});

app.get('/devices', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const devices = await getUserDevices(db, userId);
  return c.json({ success: true, data: devices });
});

app.delete('/devices/:deviceId', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const deviceId = c.req.param('deviceId');
  const db = getDb(c.env.DB);

  const result = await removeDevice(c.env, db, userId, deviceId);

  await createAuditLog({
    env: c.env,
    userId,
    action: 'user.logout',
    resourceType: 'device',
    resourceId: deviceId,
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: result.message } });
});

app.get('/stats', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const stats = await getUserStats(db, userId);
  return c.json({ success: true, data: stats });
});

export default app;
