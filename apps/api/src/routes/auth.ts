import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, users } from '../db';
import { authMiddleware } from '../middleware/auth';
import { signJWT, hashPassword, verifyPassword } from '../lib/crypto';
import { JWT_EXPIRY, ERROR_CODES } from '@r2shelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6个字符'),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
});

const updateProfileSchema = z.object({
  name: z.string().max(100, '昵称过长').optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6, '新密码至少6个字符').optional(),
}).refine(
  (d) => !(d.newPassword && !d.currentPassword),
  { message: '修改密码需要提供当前密码', path: ['currentPassword'] }
);

const deleteAccountSchema = z.object({
  password: z.string().min(1, '请输入密码确认注销'),
});

// ── Register ──────────────────────────────────────────────────────────────
app.post('/register', async (c) => {
  const body = await c.req.json();
  const result = registerSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400,
    );
  }

  const { email, password, name } = result.data;
  const db = getDb(c.env.DB);

  const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该邮箱已被注册' } },
      400,
    );
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(users).values({
    id: userId, email, passwordHash, name: name || null,
    role: 'user', storageQuota: 10737418240, storageUsed: 0,
    createdAt: now, updatedAt: now,
  });

  const token = await signJWT({ userId, email, role: 'user' }, c.env.JWT_SECRET);
  await c.env.KV.put(`session:${token}`, JSON.stringify({ userId, email }), {
    expirationTtl: Math.floor(JWT_EXPIRY / 1000),
  });

  return c.json({
    success: true,
    data: {
      user: { id: userId, email, name: name || null, role: 'user', storageQuota: 10737418240, storageUsed: 0, createdAt: now, updatedAt: now },
      token,
    },
  });
});

// ── Login ─────────────────────────────────────────────────────────────────
app.post('/login', async (c) => {
  const body = await c.req.json();
  const result = loginSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400,
    );
  }

  const { email, password } = result.data;
  const db = getDb(c.env.DB);

  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '邮箱或密码错误' } }, 401);
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '邮箱或密码错误' } }, 401);
  }

  const token = await signJWT({ userId: user.id, email: user.email, role: user.role }, c.env.JWT_SECRET);
  await c.env.KV.put(`session:${token}`, JSON.stringify({ userId: user.id, email: user.email }), {
    expirationTtl: Math.floor(JWT_EXPIRY / 1000),
  });

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        storageQuota: user.storageQuota, storageUsed: user.storageUsed,
        createdAt: user.createdAt, updatedAt: user.updatedAt,
      },
      token,
    },
  });
});

// ── Logout ────────────────────────────────────────────────────────────────
app.post('/logout', authMiddleware, async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.slice(7);
  if (token) await c.env.KV.delete(`session:${token}`);
  return c.json({ success: true, data: { message: '已退出登录' } });
});

// ── Get current user ──────────────────────────────────────────────────────
app.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env.DB);

  const user = await db.select().from(users).where(eq(users.id, userId!)).get();
  if (!user) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '用户不存在' } }, 404);
  }

  return c.json({
    success: true,
    data: {
      id: user.id, email: user.email, name: user.name, role: user.role,
      storageQuota: user.storageQuota, storageUsed: user.storageUsed,
      createdAt: user.createdAt, updatedAt: user.updatedAt,
    },
  });
});

// ── Update profile (name + optional password change) ─────────────────────
app.patch('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = updateProfileSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400,
    );
  }

  const { name, currentPassword, newPassword } = result.data;
  const db = getDb(c.env.DB);

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '用户不存在' } }, 404);
  }

  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  // Update display name
  if (name !== undefined) {
    updateData.name = name || null;
  }

  // Update password
  if (newPassword && currentPassword) {
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '当前密码错误' } },
        401,
      );
    }
    updateData.passwordHash = await hashPassword(newPassword);
  }

  await db.update(users).set(updateData).where(eq(users.id, userId));

  const updated = await db.select().from(users).where(eq(users.id, userId)).get();

  return c.json({
    success: true,
    data: {
      id: updated!.id, email: updated!.email, name: updated!.name, role: updated!.role,
      storageQuota: updated!.storageQuota, storageUsed: updated!.storageUsed,
      createdAt: updated!.createdAt, updatedAt: updated!.updatedAt,
    },
  });
});

// ── Delete account ────────────────────────────────────────────────────────
app.delete('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = deleteAccountSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400,
    );
  }

  const db = getDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '用户不存在' } }, 404);
  }

  const isValid = await verifyPassword(result.data.password, user.passwordHash);
  if (!isValid) {
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '密码错误，无法注销账户' } }, 401);
  }

  // Delete the user — CASCADE will remove files, shares, webdav_sessions
  // But we need to manually clean R2 objects since that's not in the DB cascade
  // For simplicity we soft-note this; a background job would do actual R2 cleanup
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.slice(7);
  if (token) await c.env.KV.delete(`session:${token}`);

  await db.delete(users).where(eq(users.id, userId));

  return c.json({ success: true, data: { message: '账户已注销' } });
});

// ── Stats for current user (used by dashboard) ────────────────────────────
app.get('/stats', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const { isNull, isNotNull, eq: deq, and, count, sum } = await import('drizzle-orm');
  const { files } = await import('../db');

  // Active files (not deleted, not folders)
  const activeFiles = await db.select().from(files)
    .where(and(deq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const fileCount = activeFiles.filter((f) => !f.isFolder).length;
  const folderCount = activeFiles.filter((f) => f.isFolder).length;
  const trashCount = await db.select().from(files)
    .where(and(deq(files.userId, userId), isNotNull(files.deletedAt)))
    .all().then((r) => r.length);

  // Recent files (last 10, not folders)
  const recentFiles = activeFiles
    .filter((f) => !f.isFolder)
    .sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
    .slice(0, 10);

  // Breakdown by type
  const typeBreakdown: Record<string, number> = {};
  for (const f of activeFiles.filter((f) => !f.isFolder)) {
    const category = f.mimeType?.startsWith('image/') ? 'image'
      : f.mimeType?.startsWith('video/') ? 'video'
      : f.mimeType?.startsWith('audio/') ? 'audio'
      : f.mimeType === 'application/pdf' ? 'pdf'
      : f.mimeType?.startsWith('text/') ? 'text'
      : 'other';
    typeBreakdown[category] = (typeBreakdown[category] || 0) + f.size;
  }

  const { users: usersTable, storageBuckets } = await import('../db');
  const userRow = await db.select().from(usersTable).where(deq(usersTable.id, userId)).get();

  // Multi-bucket storage: sum all active buckets for used; use per-user quota
  const bucketRows = await db.select().from(storageBuckets)
    .where(and(deq(storageBuckets.userId, userId), deq(storageBuckets.isActive, true)))
    .all();
  const bucketStorageUsed = bucketRows.reduce((sum, b) => sum + (b.storageUsed ?? 0), 0);
  // Use the max of user-level tracking vs bucket-level tracking (they should converge)
  const totalStorageUsed = Math.max(userRow?.storageUsed ?? 0, bucketStorageUsed);

  // Per-bucket breakdown for frontend
  const bucketBreakdown = bucketRows.map((b) => ({
    id: b.id,
    name: b.name,
    provider: b.provider,
    storageUsed: b.storageUsed ?? 0,
    storageQuota: b.storageQuota ?? null,
    fileCount: b.fileCount ?? 0,
    isDefault: b.isDefault,
  }));

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

export default app;
