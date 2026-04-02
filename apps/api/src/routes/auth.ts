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
import { getDb, users, loginAttempts, userDevices, files, storageBuckets, emailTokens } from '../db';
import { eq, and, gt, lt, desc, isNull, isNotNull, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth';
import { signJWT, hashPassword, verifyPassword } from '../lib/crypto';
import {
  JWT_EXPIRY,
  ERROR_CODES,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCKOUT_DURATION,
  DEVICE_SESSION_EXPIRY,
} from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { getRegConfig } from '../lib/utils';
import { AppError, throwAppError } from '../middleware/error';
import { createNotification, sendNotification } from '../lib/notificationUtils';
import { sendEmail, emailTemplates, parseEmailPreferences, shouldSendEmail } from '../lib/emailService';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6个字符'),
  name: z.string().optional(),
  inviteCode: z.string().optional(),
});

const INVITE_PREFIX = 'admin:invite:';

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

async function checkLoginLockout(
  db: ReturnType<typeof getDb>,
  email: string,
  ipAddress: string
): Promise<{ locked: boolean; remainingAttempts: number; lockoutUntil: string | null }> {
  const now = new Date();
  const lockoutThreshold = new Date(now.getTime() - LOGIN_LOCKOUT_DURATION).toISOString();

  // 双维度查询：按邮箱 OR 按 IP，分别评估是否触发锁定
  // 防止攻击者通过对某账号持续发错密码实施 DoS
  const recentByEmail = await db
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.createdAt, lockoutThreshold)))
    .all();

  const failedByEmail = recentByEmail.filter((a) => !a.success);

  // 邮箱维度：对账号实施锁定（正常防暴力破解）
  if (failedByEmail.length >= LOGIN_MAX_ATTEMPTS) {
    const lastFailed = failedByEmail.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
    const lockoutUntil = new Date(new Date(lastFailed.createdAt).getTime() + LOGIN_LOCKOUT_DURATION);
    return { locked: true, remainingAttempts: 0, lockoutUntil: lockoutUntil.toISOString() };
  }

  // IP 维度：若同一 IP 针对同一邮箱反复失败，同样触发锁定
  // 避免攻击者从同一 IP 暴力枚举多个账号时绕过单账号限制
  if (ipAddress) {
    const failedByIp = recentByEmail.filter((a) => !a.success && a.ipAddress === ipAddress);
    if (failedByIp.length >= LOGIN_MAX_ATTEMPTS) {
      const lastFailed = failedByIp.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
      const lockoutUntil = new Date(new Date(lastFailed.createdAt).getTime() + LOGIN_LOCKOUT_DURATION);
      return { locked: true, remainingAttempts: 0, lockoutUntil: lockoutUntil.toISOString() };
    }
  }

  return { locked: false, remainingAttempts: LOGIN_MAX_ATTEMPTS - failedByEmail.length, lockoutUntil: null };
}

async function recordLoginAttempt(
  db: ReturnType<typeof getDb>,
  email: string,
  ipAddress: string,
  success: boolean,
  userAgent: string | null
): Promise<void> {
  await db.insert(loginAttempts).values({
    id: crypto.randomUUID(),
    email,
    ipAddress,
    success,
    userAgent,
    createdAt: new Date().toISOString(),
  });
}

async function detectDeviceType(userAgent: string | null): Promise<string> {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    return 'mobile';
  }
  return 'desktop';
}

async function registerOrUpdateDevice(
  db: ReturnType<typeof getDb>,
  userId: string,
  deviceId: string,
  deviceName: string | undefined,
  userAgent: string | null,
  ipAddress: string | null
): Promise<void> {
  const deviceType = await detectDeviceType(userAgent);
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), eq(userDevices.deviceId, deviceId)))
    .get();

  if (existing) {
    await db
      .update(userDevices)
      .set({
        deviceName: deviceName || existing.deviceName,
        deviceType,
        ipAddress,
        userAgent,
        lastActive: now,
      })
      .where(eq(userDevices.id, existing.id));
  } else {
    await db.insert(userDevices).values({
      id: crypto.randomUUID(),
      userId,
      deviceId,
      deviceName: deviceName || `${deviceType} 设备`,
      deviceType,
      ipAddress,
      userAgent,
      lastActive: now,
      createdAt: now,
    });
  }
}

app.post('/register', async (c) => {
  const body = await c.req.json();
  const result = registerSchema.safeParse(body);

  if (!result.success) {
    throwAppError('VALIDATION_ERROR', result.error.errors[0].message);
  }

  const { email, password, name, inviteCode } = result.data;
  const db = getDb(c.env.DB);

  const regConfig = await getRegConfig(c.env.KV);
  const allUsers = await db.select({ id: users.id }).from(users).all();
  const isFirstUser = allUsers.length === 0;

  if (!isFirstUser) {
    if (!regConfig.open) {
      throwAppError('FEATURE_DISABLED', '注册已关闭，请联系管理员');
    }
    if (regConfig.requireInviteCode) {
      if (!inviteCode) {
        throwAppError('VALIDATION_ERROR', '需要邀请码才能注册');
      }
      const codeKey = `${INVITE_PREFIX}${inviteCode.toUpperCase()}`;
      const codeMeta = await c.env.KV.get(codeKey);
      if (!codeMeta) {
        throwAppError('VALIDATION_ERROR', '邀请码无效或已过期');
      }
      let meta: { usedBy: string | null } = { usedBy: null };
      try {
        meta = JSON.parse(codeMeta);
      } catch {
        /* ignore */
      }
      if (meta.usedBy) {
        throwAppError('VALIDATION_ERROR', '邀请码已被使用');
      }
    }
  }

  const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    throwAppError('EMAIL_ALREADY_REGISTERED');
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const role = isFirstUser ? 'admin' : 'user';

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    name: name || null,
    role,
    storageQuota: 10737418240,
    storageUsed: 0,
    emailVerified: isFirstUser ? true : false,
    emailPreferences: '{}',
    createdAt: now,
    updatedAt: now,
  });

  if (!isFirstUser && regConfig.requireInviteCode && inviteCode) {
    await c.env.KV.put(
      `${INVITE_PREFIX}${inviteCode.toUpperCase()}`,
      JSON.stringify({ usedBy: userId, usedAt: now, createdAt: now }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
  }

  // 非首个用户需要邮箱验证
  if (!isFirstUser) {
    if (!c.env.PUBLIC_URL) {
      console.error('PUBLIC_URL not configured, cannot send verification email');
      throwAppError('EMAIL_NOT_CONFIGURED', '邮件服务未配置：缺少PUBLIC_URL');
    }

    const verifyToken = crypto.randomUUID();
    const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifyToken));
    const tokenHashHex = Array.from(new Uint8Array(tokenHash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await db.insert(emailTokens).values({
      id: crypto.randomUUID(),
      userId,
      email,
      type: 'verify_email',
      tokenHash: tokenHashHex,
      expiresAt: verifyExpiry,
      createdAt: now,
    });

    const verifyLink = `${c.env.PUBLIC_URL}/verify-email?token=${verifyToken}`;
    const html = emailTemplates.verifyEmail(name || email, verifyLink);
    await sendEmail(c.env, email, '验证您的邮箱', html);
  }

  const token = await signJWT({ userId, email, role }, c.env.JWT_SECRET);
  await c.env.KV.put(`session:${token}`, JSON.stringify({ userId, email }), {
    expirationTtl: Math.floor(JWT_EXPIRY / 1000),
  });

  const deviceId = crypto.randomUUID();
  await registerOrUpdateDevice(db, userId, deviceId, undefined, getUserAgent(c), getClientIp(c));

  await createAuditLog({
    env: c.env,
    userId,
    action: 'user.register',
    resourceType: 'user',
    resourceId: userId,
    details: { email, name, requireEmailVerification: !isFirstUser },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({
    success: true,
    data: {
      requireEmailVerification: !isFirstUser,
      message: !isFirstUser ? '注册成功，请查收验证邮件' : '注册成功',
      user: {
        id: userId,
        email,
        name: name || null,
        role,
        storageQuota: 10737418240,
        storageUsed: 0,
        emailVerified: isFirstUser ? true : false,
        createdAt: now,
        updatedAt: now,
      },
      token,
      deviceId,
    },
  });
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

  const { email, password, deviceId: providedDeviceId, deviceName } = result.data;
  const db = getDb(c.env.DB);
  const ipAddress = getClientIp(c);
  const userAgent = getUserAgent(c);

  const lockoutStatus = await checkLoginLockout(db, email, ipAddress || '');
  if (lockoutStatus.locked) {
    await createAuditLog({
      env: c.env,
      userId: undefined,
      action: 'user.login',
      resourceType: 'user',
      status: 'failed',
      errorMessage: '账户已锁定',
      ipAddress,
      userAgent,
    });
    throwAppError('LOGIN_LOCKED', `登录失败次数过多，请等待至 ${lockoutStatus.lockoutUntil} 后重试`);
  }

  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    await recordLoginAttempt(db, email, ipAddress || '', false, userAgent);
    throwAppError('WRONG_PASSWORD', '邮箱或密码错误');
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    await recordLoginAttempt(db, email, ipAddress || '', false, userAgent);
    const newLockoutStatus = await checkLoginLockout(db, email, ipAddress || '');
    await createAuditLog({
      env: c.env,
      userId: user.id,
      action: 'user.login',
      resourceType: 'user',
      status: 'failed',
      errorMessage: '密码错误',
      ipAddress,
      userAgent,
    });
    throwAppError('WRONG_PASSWORD', `邮箱或密码错误，剩余尝试次数: ${newLockoutStatus.remainingAttempts}`);
  }

  await recordLoginAttempt(db, email, ipAddress || '', true, userAgent);

  const token = await signJWT({ userId: user.id, email: user.email, role: user.role }, c.env.JWT_SECRET);
  await c.env.KV.put(`session:${token}`, JSON.stringify({ userId: user.id, email: user.email }), {
    expirationTtl: Math.floor(JWT_EXPIRY / 1000),
  });

  const deviceId = providedDeviceId || crypto.randomUUID();
  await registerOrUpdateDevice(db, user.id, deviceId, deviceName, userAgent, ipAddress);

  await createAuditLog({
    env: c.env,
    userId: user.id,
    action: 'user.login',
    resourceType: 'user',
    resourceId: user.id,
    details: { deviceId, deviceName },
    ipAddress,
    userAgent,
  });

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        storageQuota: user.storageQuota,
        storageUsed: user.storageUsed,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      token,
      deviceId,
    },
  });
});

app.post('/logout', authMiddleware, async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.slice(7);
  if (token) await c.env.KV.delete(`session:${token}`);

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

  const user = await db.select().from(users).where(eq(users.id, userId!)).get();
  if (!user) {
    throwAppError('USER_NOT_FOUND');
  }

  const activeFiles = await db
    .select({ size: files.size, isFolder: files.isFolder })
    .from(files)
    .where(and(eq(files.userId, userId!), isNull(files.deletedAt), eq(files.isFolder, false)))
    .all();
  const actualStorageUsed = activeFiles.reduce((sum, f) => sum + f.size, 0);

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      storageQuota: user.storageQuota,
      storageUsed: actualStorageUsed,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
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

  const { name, currentPassword, newPassword } = result.data;
  const db = getDb(c.env.DB);

  const user = await db.select().from(users).where(eq(users.id, userId!)).get();
  if (!user) {
    throwAppError('USER_NOT_FOUND');
  }

  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (name !== undefined) {
    updateData.name = name || null;
  }

  if (newPassword && currentPassword) {
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      throwAppError('WRONG_PASSWORD', '当前密码错误');
    }
    updateData.passwordHash = await hashPassword(newPassword);
    updateData.passwordChangedAt = now;
  }

  await db.update(users).set(updateData).where(eq(users.id, userId));

  await createAuditLog({
    env: c.env,
    userId,
    action: 'user.update',
    resourceType: 'user',
    resourceId: userId,
    details: { nameChanged: name !== undefined, passwordChanged: !!newPassword },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  if (newPassword) {
    sendNotification(c, {
      userId,
      type: 'password_changed',
      title: '密码已更改',
      body: '您的账户密码已成功更改，如非本人操作请立即修改密码',
      data: {
        changedAt: now,
      },
    });
  }

  const updated = await db.select().from(users).where(eq(users.id, userId)).get();

  return c.json({
    success: true,
    data: {
      id: updated!.id,
      email: updated!.email,
      name: updated!.name,
      role: updated!.role,
      storageQuota: updated!.storageQuota,
      storageUsed: updated!.storageUsed,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    },
  });
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
  const user = await db.select().from(users).where(eq(users.id, userId!)).get();
  if (!user) {
    throwAppError('USER_NOT_FOUND');
  }

  const isValid = await verifyPassword(result.data.password, user.passwordHash);
  if (!isValid) {
    throwAppError('WRONG_PASSWORD', '密码错误，无法注销账户');
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader?.slice(7);
  if (token) await c.env.KV.delete(`session:${token}`);

  await createAuditLog({
    env: c.env,
    userId,
    action: 'user.delete',
    resourceType: 'user',
    resourceId: userId,
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  await db.delete(users).where(eq(users.id, userId));

  return c.json({ success: true, data: { message: '账户已注销' } });
});

app.get('/devices', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  // 修复说明：过期设备的自动清理已从此处移除，改由 cron 任务统一处理。
  //
  // 原逻辑在每次 GET /devices 时静默删除 7 天未活跃的设备记录，会引发以下竞态：
  //   1. 用户打开设备列表页面，前端缓存了含旧设备的列表（含其 deviceId）
  //   2. 后台自动清理将该设备从 D1 删除
  //   3. 用户点击注销该旧设备 → DELETE /devices/:deviceId → 后端查不到 → 404
  //
  // 清理任务已移至 cron 路由（runAllCleanupTasks），按计划定期执行，
  // 避免与前端持有的 deviceId 产生不一致。

  const devices = await db
    .select()
    .from(userDevices)
    .where(eq(userDevices.userId, userId))
    .orderBy(desc(userDevices.lastActive))
    .all();

  return c.json({ success: true, data: devices });
});

app.delete('/devices/:deviceId', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const deviceId = c.req.param('deviceId');
  const db = getDb(c.env.DB);

  const device = await db
    .select()
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), eq(userDevices.deviceId, deviceId)))
    .get();

  if (!device) {
    // 修复说明：设备记录不存在时返回幂等成功，而非 404。
    //
    // 触发场景：
    //   - cron 自动清理已将该设备删除，但前端仍显示旧列表中的条目
    //   - 用户在多个标签页同时执行注销操作
    //
    // 对于"移除登录设备"这类操作，设备不存在与删除成功在语义上等价——
    // 最终状态都是该设备不再存在，向用户报错无实际意义。
    return c.json({ success: true, data: { message: '设备已移除' } });
  }

  await db.delete(userDevices).where(eq(userDevices.id, device.id));

  await createAuditLog({
    env: c.env,
    userId,
    action: 'user.logout',
    resourceType: 'device',
    resourceId: deviceId,
    details: { deviceName: device.deviceName },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '设备已移除' } });
});

app.get('/stats', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const activeFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const fileCount = activeFiles.filter((f) => !f.isFolder).length;
  const folderCount = activeFiles.filter((f) => f.isFolder).length;
  const trashCount = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
    .all()
    .then((r) => r.length);

  // 按 updatedAt 降序取最近 10 个文件（最近访问/修改优先）
  const recentFiles = activeFiles
    .filter((f) => !f.isFolder)
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    .slice(0, 10);

  const typeBreakdown: Record<string, number> = {};
  for (const f of activeFiles.filter((f) => !f.isFolder)) {
    const mime = f.mimeType || '';
    let category: string;

    if (mime.startsWith('image/')) {
      category = 'image';
    } else if (mime.startsWith('video/')) {
      category = 'video';
    } else if (mime.startsWith('audio/')) {
      category = 'audio';
    } else if (mime === 'application/pdf') {
      category = 'pdf';
    } else if (mime.startsWith('text/')) {
      category = 'text';
    } else if (
      [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text',
      ].includes(mime)
    ) {
      category = 'document';
    } else if (
      [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.spreadsheet',
        'text/csv',
      ].includes(mime)
    ) {
      category = 'spreadsheet';
    } else if (
      [
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.presentation',
      ].includes(mime)
    ) {
      category = 'presentation';
    } else if (
      [
        'application/zip',
        'application/x-rar-compressed',
        'application/x-7z-compressed',
        'application/x-tar',
        'application/gzip',
        'application/x-bzip2',
      ].includes(mime)
    ) {
      category = 'archive';
    } else if (
      [
        'application/x-msdownload',
        'application/x-msi',
        'application/x-apple-diskimage',
        'application/x-newton-compatible-pkg',
        'application/vnd.debian.binary-package',
        'application/x-rpm',
        'application/vnd.android.package-archive',
        'application/x-executable',
      ].includes(mime)
    ) {
      category = 'installer';
    } else if (
      [
        'application/javascript',
        'application/typescript',
        'application/json',
        'application/xml',
        'application/x-sh',
        'application/x-python',
      ].includes(mime) ||
      mime.includes('script')
    ) {
      category = 'code';
    } else {
      category = 'other';
    }

    typeBreakdown[category] = (typeBreakdown[category] || 0) + f.size;
  }

  const userRow = await db.select().from(users).where(eq(users.id, userId)).get();

  const bucketRows = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true)))
    .all();

  const actualBucketStats = new Map<string, { storageUsed: number; fileCount: number }>();
  for (const f of activeFiles.filter((f) => !f.isFolder)) {
    const bucketId = f.bucketId || '__no_bucket__';
    const stats = actualBucketStats.get(bucketId) || { storageUsed: 0, fileCount: 0 };
    stats.storageUsed += f.size;
    stats.fileCount += 1;
    actualBucketStats.set(bucketId, stats);
  }

  const bucketBreakdown = bucketRows.map((b) => {
    const actualStats = actualBucketStats.get(b.id) || { storageUsed: 0, fileCount: 0 };
    return {
      id: b.id,
      name: b.name,
      provider: b.provider,
      storageUsed: actualStats.storageUsed,
      storageQuota: b.storageQuota ?? null,
      fileCount: actualStats.fileCount,
      isDefault: b.isDefault,
    };
  });

  const totalStorageUsed = activeFiles.filter((f) => !f.isFolder).reduce((sum, f) => sum + f.size, 0);

  return c.json({
    success: true,
    data: {
      fileCount,
      folderCount,
      trashCount,
      storageUsed: totalStorageUsed,
      storageQuota: userRow?.storageQuota ?? 10737418240,
      recentFiles,
      typeBreakdown,
      bucketBreakdown,
    },
  });
});

// ── Email Verification ─────────────────────────────────────────────────────

app.get('/verify-email', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    throwAppError('VALIDATION_ERROR', '缺少验证Token');
  }

  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHashHex = Array.from(new Uint8Array(tokenHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const tokenRecord = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, tokenHashHex)).get();

  if (!tokenRecord) {
    throwAppError('EMAIL_TOKEN_INVALID', '验证链接无效');
  }

  if (tokenRecord.usedAt) {
    throwAppError('EMAIL_TOKEN_USED', '验证链接已使用');
  }

  if (new Date(tokenRecord.expiresAt) < new Date(now)) {
    throwAppError('EMAIL_TOKEN_EXPIRED', '验证链接已过期');
  }

  await db.update(users).set({ emailVerified: true, updatedAt: now }).where(eq(users.id, tokenRecord.userId));

  await db.update(emailTokens).set({ usedAt: now }).where(eq(emailTokens.id, tokenRecord.id));

  await createAuditLog({
    env: c.env,
    userId: tokenRecord.userId,
    action: 'user.update',
    resourceType: 'user',
    resourceId: tokenRecord.userId,
    details: { action: 'verify_email' },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({
    success: true,
    data: { message: '邮箱验证成功' },
  });
});

app.post('/resend-verification', async (c) => {
  const body = await c.req.json();
  const { email } = body;

  if (!email) {
    throwAppError('VALIDATION_ERROR', '请输入邮箱地址');
  }

  const rateKey = `rate:resend:${email}`;
  const exists = await c.env.KV.get(rateKey);
  if (exists) {
    throwAppError('RATE_LIMIT_EXCEEDED', '请等待1分钟后重试');
  }

  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.email, email)).get();

  if (!user) {
    return c.json({ success: true, data: { message: '如果邮箱存在，您将收到验证邮件' } });
  }

  if (user.emailVerified) {
    return c.json({ success: true, data: { message: '邮箱已验证' } });
  }

  const now = new Date().toISOString();
  const verifyToken = crypto.randomUUID();
  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifyToken));
  const tokenHashHex = Array.from(new Uint8Array(tokenHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.insert(emailTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    email: user.email,
    type: 'verify_email',
    tokenHash: tokenHashHex,
    expiresAt: verifyExpiry,
    createdAt: now,
  });

  if (!c.env.PUBLIC_URL) {
    console.error('PUBLIC_URL not configured, cannot send verification email');
    throwAppError('EMAIL_NOT_CONFIGURED', '邮件服务未配置：缺少PUBLIC_URL');
  }

  const verifyLink = `${c.env.PUBLIC_URL}/verify-email?token=${verifyToken}`;
  const html = emailTemplates.verifyEmail(user.name || user.email, verifyLink);
  await sendEmail(c.env, user.email, '验证您的邮箱', html);

  await c.env.KV.put(rateKey, '1', { expirationTtl: 60 });

  return c.json({ success: true, data: { message: '如果邮箱存在，您将收到验证邮件' } });
});

// ── Password Reset ─────────────────────────────────────────────────────────

app.post('/forgot-password', async (c) => {
  const body = await c.req.json();
  const { email } = body;

  if (!email) {
    throwAppError('VALIDATION_ERROR', '请输入邮箱地址');
  }

  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.email, email)).get();

  if (!user) {
    return c.json({ success: true, data: { message: '如果邮箱存在，您将收到重置邮件' } });
  }

  const now = new Date().toISOString();
  const resetToken = crypto.randomUUID();
  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(resetToken));
  const tokenHashHex = Array.from(new Uint8Array(tokenHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await db.insert(emailTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    email: user.email,
    type: 'reset_password',
    tokenHash: tokenHashHex,
    expiresAt: resetExpiry,
    createdAt: now,
  });

  if (!c.env.PUBLIC_URL) {
    console.error('PUBLIC_URL not configured, cannot send reset password email');
    throwAppError('EMAIL_NOT_CONFIGURED', '邮件服务未配置：缺少PUBLIC_URL');
  }

  const resetLink = `${c.env.PUBLIC_URL}/reset-password?token=${resetToken}`;
  const html = emailTemplates.resetPassword(user.name || user.email, resetLink);
  await sendEmail(c.env, user.email, '重置您的密码', html);

  return c.json({ success: true, data: { message: '如果邮箱存在，您将收到重置邮件' } });
});

app.post('/reset-password', async (c) => {
  const body = await c.req.json();
  const { token, newPassword } = body;

  if (!token || !newPassword) {
    throwAppError('VALIDATION_ERROR', '缺少必要参数');
  }

  if (newPassword.length < 6) {
    throwAppError('VALIDATION_ERROR', '密码至少6个字符');
  }

  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHashHex = Array.from(new Uint8Array(tokenHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const tokenRecord = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, tokenHashHex)).get();

  if (!tokenRecord || tokenRecord.type !== 'reset_password') {
    throwAppError('EMAIL_TOKEN_INVALID', '重置链接无效');
  }

  if (tokenRecord.usedAt) {
    throwAppError('EMAIL_TOKEN_USED', '重置链接已使用');
  }

  if (new Date(tokenRecord.expiresAt) < new Date(now)) {
    throwAppError('EMAIL_TOKEN_EXPIRED', '重置链接已过期');
  }

  const passwordHash = await hashPassword(newPassword);

  await db
    .update(users)
    .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
    .where(eq(users.id, tokenRecord.userId));

  await db.update(emailTokens).set({ usedAt: now }).where(eq(emailTokens.id, tokenRecord.id));

  const user = await db.select().from(users).where(eq(users.id, tokenRecord.userId)).get();

  if (user && user.email) {
    const preferences = parseEmailPreferences(user.emailPreferences);
    if (shouldSendEmail('password_changed', preferences)) {
      const html = emailTemplates.passwordChanged(user.name || user.email, getClientIp(c) || 'unknown', now);
      await sendEmail(c.env, user.email, '密码已更改', html);
    }
  }

  await createAuditLog({
    env: c.env,
    userId: tokenRecord.userId,
    action: 'user.update',
    resourceType: 'user',
    resourceId: tokenRecord.userId,
    details: { action: 'reset_password' },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '密码重置成功' } });
});

// ── Change Email ───────────────────────────────────────────────────────────

app.post('/change-email', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const { newEmail, password } = body;

  if (!newEmail || !password) {
    throwAppError('VALIDATION_ERROR', '缺少必要参数');
  }

  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, userId)).get();

  if (!user) {
    throwAppError('USER_NOT_FOUND');
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throwAppError('WRONG_PASSWORD', '密码错误');
  }

  const existingUser = await db.select().from(users).where(eq(users.email, newEmail)).get();
  if (existingUser) {
    throwAppError('EMAIL_ALREADY_REGISTERED', '该邮箱已被使用');
  }

  const now = new Date().toISOString();
  const changeToken = crypto.randomUUID();
  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(changeToken));
  const tokenHashHex = Array.from(new Uint8Array(tokenHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const changeExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await db.insert(emailTokens).values({
    id: crypto.randomUUID(),
    userId,
    email: newEmail,
    type: 'change_email',
    tokenHash: tokenHashHex,
    expiresAt: changeExpiry,
    createdAt: now,
  });

  if (!c.env.PUBLIC_URL) {
    console.error('PUBLIC_URL not configured, cannot send change email confirmation');
    throwAppError('EMAIL_NOT_CONFIGURED', '邮件服务未配置：缺少PUBLIC_URL');
  }

  const changeLink = `${c.env.PUBLIC_URL}/confirm-change-email?token=${changeToken}`;
  const html = emailTemplates.changeEmail(user.name || user.email, newEmail, changeLink);
  await sendEmail(c.env, newEmail, '确认更换邮箱', html);

  return c.json({ success: true, data: { message: '确认邮件已发送到新邮箱' } });
});

app.get('/confirm-change-email', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    throwAppError('VALIDATION_ERROR', '缺少验证Token');
  }

  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHashHex = Array.from(new Uint8Array(tokenHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const tokenRecord = await db.select().from(emailTokens).where(eq(emailTokens.tokenHash, tokenHashHex)).get();

  if (!tokenRecord || tokenRecord.type !== 'change_email') {
    throwAppError('EMAIL_TOKEN_INVALID', '验证链接无效');
  }

  if (tokenRecord.usedAt) {
    throwAppError('EMAIL_TOKEN_USED', '验证链接已使用');
  }

  if (new Date(tokenRecord.expiresAt) < new Date(now)) {
    throwAppError('EMAIL_TOKEN_EXPIRED', '验证链接已过期');
  }

  const user = await db.select().from(users).where(eq(users.id, tokenRecord.userId)).get();
  if (!user) {
    throwAppError('USER_NOT_FOUND');
  }

  const oldEmail = user.email;

  await db.update(users).set({ email: tokenRecord.email!, updatedAt: now }).where(eq(users.id, tokenRecord.userId));

  await db.update(emailTokens).set({ usedAt: now }).where(eq(emailTokens.id, tokenRecord.id));

  const preferences = parseEmailPreferences(user.emailPreferences);
  if (shouldSendEmail('system', preferences)) {
    const html = emailTemplates.systemNotify(
      oldEmail,
      '邮箱已更换',
      `您的账户邮箱已从 ${oldEmail} 更换为 ${tokenRecord.email}`
    );
    await sendEmail(c.env, oldEmail, '邮箱已更换', html);
  }

  await createAuditLog({
    env: c.env,
    userId: tokenRecord.userId,
    action: 'user.update',
    resourceType: 'user',
    resourceId: tokenRecord.userId,
    details: { action: 'change_email', oldEmail, newEmail: tokenRecord.email },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '邮箱更换成功' } });
});

// ── Email Preferences ─────────────────────────────────────────────────────

app.get('/email-preferences', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    throwAppError('USER_NOT_FOUND');
  }

  const defaultPreferences = {
    mention: true,
    share_received: true,
    quota_warning: true,
    ai_complete: false,
    system: true,
  };

  let preferences = defaultPreferences;
  if (user.emailPreferences) {
    try {
      preferences = { ...defaultPreferences, ...JSON.parse(user.emailPreferences) };
    } catch (e) {
      // 使用默认值
    }
  }

  return c.json({ success: true, data: preferences });
});

app.put('/email-preferences', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const schema = z.object({
    mention: z.boolean().optional(),
    share_received: z.boolean().optional(),
    quota_warning: z.boolean().optional(),
    ai_complete: z.boolean().optional(),
    system: z.boolean().optional(),
  });

  const result = schema.safeParse(body);
  if (!result.success) {
    throwAppError('VALIDATION_ERROR', '无效的偏好设置');
  }

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    throwAppError('USER_NOT_FOUND');
  }

  let currentPrefs = {};
  if (user.emailPreferences) {
    try {
      currentPrefs = JSON.parse(user.emailPreferences);
    } catch (e) {
      // 使用空对象
    }
  }

  const updatedPrefs = { ...currentPrefs, ...result.data };
  const prefsJson = JSON.stringify(updatedPrefs);

  await db.update(users).set({ emailPreferences: prefsJson, updatedAt: now }).where(eq(users.id, userId));

  return c.json({ success: true, data: updatedPrefs });
});

export default app;
