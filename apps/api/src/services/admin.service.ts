/**
 * admin.service.ts
 * 管理员业务逻辑服务
 *
 * 功能:
 * - 用户管理（列表、查询、禁用、删除）
 * - 注册配置管理
 * - 邀请码管理
 * - 系统统计与审计日志
 */

import { eq, and, isNull, isNotNull, desc, sql } from 'drizzle-orm';
import { getDb, users, files, storageBuckets, auditLogs } from '../db';
import { ERROR_CODES } from '@osshelf/shared';
import { hashPassword } from '../lib/crypto';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import type { Env } from '../types/env';

const REG_CONFIG_KEY = 'admin:registration_config';
const INVITE_PREFIX = 'admin:invite:';

interface RegistrationConfig {
  open: boolean;
  requireInviteCode: boolean;
}

export async function getRegConfig(kv: KVNamespace): Promise<RegistrationConfig> {
  const raw = await kv.get(REG_CONFIG_KEY);
  if (!raw) return { open: true, requireInviteCode: false };
  try {
    return JSON.parse(raw);
  } catch {
    return { open: true, requireInviteCode: false };
  }
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${segment()}-${segment()}-${segment()}`;
}

export async function checkAdminPermission(db: ReturnType<typeof getDb>, userId: string): Promise<{ authorized: boolean; user?: typeof users.$inferSelect }> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || user.role !== 'admin') {
    return { authorized: false };
  }
  return { authorized: true, user };
}

export async function getAllUsersWithStats(db: ReturnType<typeof getDb>) {
  const allUsers = await db.select().from(users).all();

  const enriched = await Promise.all(
    allUsers.map(async (u) => {
      const userFiles = await db
        .select({ size: files.size, isFolder: files.isFolder })
        .from(files)
        .where(and(eq(files.userId, u.id), isNull(files.deletedAt)))
        .all();
      const actualStorageUsed = userFiles.filter((f) => !f.isFolder).reduce((sum, f) => sum + f.size, 0);
      const fileCount = userFiles.filter((f) => !f.isFolder).length;

      const buckets = await db
        .select()
        .from(storageBuckets)
        .where(and(eq(storageBuckets.userId, u.id), eq(storageBuckets.isActive, true)))
        .all();

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        storageQuota: u.storageQuota,
        storageUsed: actualStorageUsed,
        fileCount,
        bucketCount: buckets.length,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      };
    })
  );

  return enriched;
}

export async function getUserById(db: ReturnType<typeof getDb>, id: string) {
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (!user) {
    return null;
  }
  const { passwordHash: _pw, ...safe } = user;
  return safe;
}

export async function updateUser(
  db: ReturnType<typeof getDb>,
  id: string,
  data: { name?: string; role?: 'admin' | 'user'; storageQuota?: number; newPassword?: string }
) {
  const user = await db.select().from(users).where(eq(users.id, id)).get();
  if (!user) {
    return null;
  }

  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.storageQuota !== undefined) updateData.storageQuota = data.storageQuota;
  if (data.newPassword) updateData.passwordHash = await hashPassword(data.newPassword);

  await db.update(users).set(updateData).where(eq(users.id, id));
  return { success: true };
}

export async function deleteUser(
  env: Env,
  db: ReturnType<typeof getDb>,
  adminId: string,
  targetId: string
) {
  if (targetId === adminId) {
    return { success: false, error: '不能删除自己的账户' };
  }

  const user = await db.select().from(users).where(eq(users.id, targetId)).get();
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  await createAuditLog({
    env,
    userId: adminId,
    action: 'user.delete',
    resourceType: 'user',
    resourceId: targetId,
    details: { targetEmail: user.email, targetName: user.name },
    ipAddress: '',
    userAgent: '',
  });

  await db.delete(users).where(eq(users.id, targetId));
  return { success: true };
}

export async function getRegistrationConfig(kv: KVNamespace) {
  const config = await getRegConfig(kv);

  const list = await kv.list({ prefix: INVITE_PREFIX });
  const codes = await Promise.all(
    list.keys.map(async ({ name }) => {
      const raw = await kv.get(name);
      const code = name.replace(INVITE_PREFIX, '');
      try {
        const meta = raw ? JSON.parse(raw) : {};
        return { code, ...meta };
      } catch {
        return { code, usedBy: null, createdAt: null };
      }
    })
  );

  return { ...config, inviteCodes: codes };
}

export async function updateRegistrationConfig(kv: KVNamespace, data: { open?: boolean; requireInviteCode?: boolean }) {
  const current = await getRegConfig(kv);
  const updated: RegistrationConfig = { ...current, ...data };
  await kv.put(REG_CONFIG_KEY, JSON.stringify(updated));
  return updated;
}

export async function createInviteCodes(kv: KVNamespace, count: number) {
  const codes: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    const code = generateInviteCode();
    await kv.put(
      `${INVITE_PREFIX}${code}`,
      JSON.stringify({ usedBy: null, createdAt: now }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
    codes.push(code);
  }

  return { codes, createdAt: now };
}

export async function revokeInviteCode(kv: KVNamespace, code: string) {
  await kv.delete(`${INVITE_PREFIX}${code}`);
  return { success: true };
}

export async function getSystemStats(db: ReturnType<typeof getDb>) {
  const allUsers = await db.select().from(users).all();
  const allFiles = await db.select().from(files).where(isNull(files.deletedAt)).all();
  const allBuckets = await db.select().from(storageBuckets).all();

  const totalStorage = allUsers.reduce((sum, u) => sum + (u.storageUsed ?? 0), 0);
  const totalQuota = allUsers.reduce((sum, u) => sum + (u.storageQuota ?? 0), 0);

  const providerBreakdown: Record<string, { bucketCount: number; storageUsed: number }> = {};
  for (const b of allBuckets) {
    if (!providerBreakdown[b.provider]) {
      providerBreakdown[b.provider] = { bucketCount: 0, storageUsed: 0 };
    }
    providerBreakdown[b.provider].bucketCount++;
    providerBreakdown[b.provider].storageUsed += b.storageUsed ?? 0;
  }

  return {
    userCount: allUsers.length,
    adminCount: allUsers.filter((u) => u.role === 'admin').length,
    fileCount: allFiles.length,
    folderCount: allFiles.filter((f) => f.isFolder).length,
    bucketCount: allBuckets.length,
    totalStorageUsed: totalStorage,
    totalStorageQuota: totalQuota,
    providerBreakdown,
  };
}

export async function getAuditLogs(
  db: ReturnType<typeof getDb>,
  params: { page: number; limit: number; userId?: string; action?: string }
) {
  const { page, limit, userId, action } = params;

  const conditions: any[] = [];
  if (userId) conditions.push(eq(auditLogs.userId, userId));
  if (action) conditions.push(eq(auditLogs.action, action));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)
      .all(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(whereClause)
      .get(),
  ]);

  const total = countResult?.count ?? 0;

  const enrichedItems = await Promise.all(
    items.map(async (log) => {
      let userEmail = null;
      if (log.userId) {
        const user = await db.select({ email: users.email }).from(users).where(eq(users.id, log.userId)).get();
        userEmail = user?.email ?? null;
      }
      return {
        ...log,
        userEmail,
      };
    })
  );

  return {
    items: enrichedItems,
    total,
    page,
    limit,
  };
}

export { REG_CONFIG_KEY, INVITE_PREFIX };
export type { RegistrationConfig };
