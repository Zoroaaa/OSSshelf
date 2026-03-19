/**
 * auth.service.ts
 * 用户认证业务逻辑服务
 *
 * 功能:
 * - 用户注册与登录
 * - 登录失败锁定保护
 * - 设备管理与会话控制
 * - 用户信息查询与更新
 */

import { eq, and, gt, lt, desc, isNull, isNotNull } from 'drizzle-orm';
import { getDb, users, loginAttempts, userDevices, files, storageBuckets } from '../db';
import { signJWT, hashPassword, verifyPassword } from '../lib/crypto';
import {
  JWT_EXPIRY,
  ERROR_CODES,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCKOUT_DURATION,
  DEVICE_SESSION_EXPIRY,
} from '@osshelf/shared';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import type { Env } from '../types/env';

const REG_CONFIG_KEY = 'admin:registration_config';
const INVITE_PREFIX = 'admin:invite:';

interface RegConfig {
  open: boolean;
  requireInviteCode: boolean;
}

async function getRegConfig(kv: KVNamespace): Promise<RegConfig> {
  const raw = await kv.get(REG_CONFIG_KEY);
  if (!raw) return { open: true, requireInviteCode: false };
  try {
    return JSON.parse(raw);
  } catch {
    return { open: true, requireInviteCode: false };
  }
}

export async function checkLoginLockout(
  db: ReturnType<typeof getDb>,
  email: string,
  ipAddress: string
): Promise<{ locked: boolean; remainingAttempts: number; lockoutUntil: string | null }> {
  const now = new Date();
  const lockoutThreshold = new Date(now.getTime() - LOGIN_LOCKOUT_DURATION).toISOString();

  const recentByEmail = await db
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.createdAt, lockoutThreshold)))
    .all();

  const failedByEmail = recentByEmail.filter((a) => !a.success);

  if (failedByEmail.length >= LOGIN_MAX_ATTEMPTS) {
    const lastFailed = failedByEmail.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
    const lockoutUntil = new Date(new Date(lastFailed.createdAt).getTime() + LOGIN_LOCKOUT_DURATION);
    return { locked: true, remainingAttempts: 0, lockoutUntil: lockoutUntil.toISOString() };
  }

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

export async function recordLoginAttempt(
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

export async function detectDeviceType(userAgent: string | null): Promise<string> {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    return 'mobile';
  }
  return 'desktop';
}

export async function registerOrUpdateDevice(
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

export async function registerUser(
  env: Env,
  db: ReturnType<typeof getDb>,
  data: { email: string; password: string; name?: string; inviteCode?: string }
) {
  const { email, password, name, inviteCode } = data;

  const regConfig = await getRegConfig(env.KV);
  const allUsers = await db.select({ id: users.id }).from(users).all();
  const isFirstUser = allUsers.length === 0;

  if (!isFirstUser) {
    if (!regConfig.open) {
      return { success: false, error: { code: 'REGISTRATION_CLOSED', message: '注册已关闭，请联系管理员' } };
    }
    if (regConfig.requireInviteCode) {
      if (!inviteCode) {
        return { success: false, error: { code: 'INVITE_CODE_REQUIRED', message: '需要邀请码才能注册' } };
      }
      const codeKey = `${INVITE_PREFIX}${inviteCode.toUpperCase()}`;
      const codeMeta = await env.KV.get(codeKey);
      if (!codeMeta) {
        return { success: false, error: { code: 'INVITE_CODE_INVALID', message: '邀请码无效或已过期' } };
      }
      let meta: { usedBy: string | null } = { usedBy: null };
      try {
        meta = JSON.parse(codeMeta);
      } catch {
        /* ignore */
      }
      if (meta.usedBy) {
        return { success: false, error: { code: 'INVITE_CODE_USED', message: '邀请码已被使用' } };
      }
    }
  }

  const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    return { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该邮箱已被注册' } };
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
    createdAt: now,
    updatedAt: now,
  });

  if (!isFirstUser && regConfig.requireInviteCode && inviteCode) {
    await env.KV.put(
      `${INVITE_PREFIX}${inviteCode.toUpperCase()}`,
      JSON.stringify({ usedBy: userId, usedAt: now, createdAt: now }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
  }

  const token = await signJWT({ userId, email, role }, env.JWT_SECRET);
  await env.KV.put(`session:${token}`, JSON.stringify({ userId, email }), {
    expirationTtl: Math.floor(JWT_EXPIRY / 1000),
  });

  const deviceId = crypto.randomUUID();
  await registerOrUpdateDevice(db, userId, deviceId, undefined, null, null);

  return {
    success: true,
    data: {
      user: {
        id: userId,
        email,
        name: name || null,
        role,
        storageQuota: 10737418240,
        storageUsed: 0,
        createdAt: now,
        updatedAt: now,
      },
      token,
      deviceId,
    },
  };
}

export async function loginUser(
  env: Env,
  db: ReturnType<typeof getDb>,
  data: { email: string; password: string; deviceId?: string; deviceName?: string },
  clientInfo: { ipAddress: string; userAgent: string }
) {
  const { email, password, deviceId: providedDeviceId, deviceName } = data;
  const { ipAddress, userAgent } = clientInfo;

  const lockoutStatus = await checkLoginLockout(db, email, ipAddress);
  if (lockoutStatus.locked) {
    return {
      success: false,
      error: {
        code: ERROR_CODES.LOGIN_LOCKED,
        message: `登录失败次数过多，请等待至 ${lockoutStatus.lockoutUntil} 后重试`,
      },
    };
  }

  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    await recordLoginAttempt(db, email, ipAddress, false, userAgent);
    return { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '邮箱或密码错误' } };
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    await recordLoginAttempt(db, email, ipAddress, false, userAgent);
    const newLockoutStatus = await checkLoginLockout(db, email, ipAddress);
    return {
      success: false,
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: `邮箱或密码错误，剩余尝试次数: ${newLockoutStatus.remainingAttempts}`,
      },
    };
  }

  await recordLoginAttempt(db, email, ipAddress, true, userAgent);

  const token = await signJWT({ userId: user.id, email: user.email, role: user.role }, env.JWT_SECRET);
  await env.KV.put(`session:${token}`, JSON.stringify({ userId: user.id, email: user.email }), {
    expirationTtl: Math.floor(JWT_EXPIRY / 1000),
  });

  const deviceId = providedDeviceId || crypto.randomUUID();
  await registerOrUpdateDevice(db, user.id, deviceId, deviceName, userAgent, ipAddress);

  return {
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
  };
}

export async function logoutUser(env: Env, token: string) {
  if (token) await env.KV.delete(`session:${token}`);
  return { success: true };
}

export async function getCurrentUser(db: ReturnType<typeof getDb>, userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return null;
  }

  const activeFiles = await db
    .select({ size: files.size, isFolder: files.isFolder })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .all();
  const actualStorageUsed = activeFiles.reduce((sum, f) => sum + f.size, 0);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    storageQuota: user.storageQuota,
    storageUsed: actualStorageUsed,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function updateProfile(
  db: ReturnType<typeof getDb>,
  userId: string,
  data: { name?: string; currentPassword?: string; newPassword?: string }
) {
  const { name, currentPassword, newPassword } = data;

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (name !== undefined) {
    updateData.name = name || null;
  }

  if (newPassword && currentPassword) {
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return { success: false, error: '当前密码错误' };
    }
    updateData.passwordHash = await hashPassword(newPassword);
  }

  await db.update(users).set(updateData).where(eq(users.id, userId));

  const updated = await db.select().from(users).where(eq(users.id, userId)).get();

  return {
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
  };
}

export async function deleteAccount(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  password: string,
  token: string
) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return { success: false, error: '密码错误，无法注销账户' };
  }

  if (token) await env.KV.delete(`session:${token}`);

  await db.delete(users).where(eq(users.id, userId));

  return { success: true };
}

export async function getUserDevices(db: ReturnType<typeof getDb>, userId: string) {
  const devices = await db
    .select()
    .from(userDevices)
    .where(eq(userDevices.userId, userId))
    .orderBy(desc(userDevices.lastActive))
    .all();

  return devices;
}

export async function removeDevice(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  deviceId: string
) {
  const device = await db
    .select()
    .from(userDevices)
    .where(and(eq(userDevices.userId, userId), eq(userDevices.deviceId, deviceId)))
    .get();

  if (!device) {
    return { success: true, message: '设备已移除' };
  }

  await db.delete(userDevices).where(eq(userDevices.id, device.id));

  return { success: true, message: '设备已移除' };
}

export async function getUserStats(db: ReturnType<typeof getDb>, userId: string) {
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

  return {
    fileCount,
    folderCount,
    trashCount,
    storageUsed: totalStorageUsed,
    storageQuota: userRow?.storageQuota ?? 10737418240,
    recentFiles,
    typeBreakdown,
    bucketBreakdown,
  };
}

export { REG_CONFIG_KEY, INVITE_PREFIX, getRegConfig };
export type { RegConfig };
