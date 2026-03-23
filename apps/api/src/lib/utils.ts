/**
 * utils.ts
 * 通用工具函数
 */

import { eq, and, isNull } from 'drizzle-orm';
import { users, files } from '../db/schema';
import type { DrizzleDb } from '../db';

export function encodeFilename(name: string): string {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
}

export async function getUserOrFail(db: DrizzleDb, userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('用户不存在');
  return user;
}

export interface RegConfig {
  open: boolean;
  requireInviteCode: boolean;
}

const REG_CONFIG_KEY = 'admin:registration_config';

export async function getRegConfig(kv: KVNamespace): Promise<RegConfig> {
  const raw = await kv.get(REG_CONFIG_KEY);
  if (!raw) return { open: true, requireInviteCode: false };
  try {
    return JSON.parse(raw);
  } catch {
    return { open: true, requireInviteCode: false };
  }
}

const pathCache = new Map<string, string>();

export function clearFilePathCache() {
  pathCache.clear();
}

export async function buildFilePath(
  db: DrizzleDb,
  userId: string,
  parentId: string | null,
  fileName: string
): Promise<string> {
  if (!parentId) {
    return `/${fileName}`;
  }

  const cacheKey = `${parentId}:${fileName}`;
  const cachedPath = pathCache.get(cacheKey);
  if (cachedPath) {
    return cachedPath;
  }

  const parent = await db
    .select()
    .from(files)
    .where(and(eq(files.id, parentId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!parent) {
    const result = `/${fileName}`;
    pathCache.set(cacheKey, result);
    return result;
  }

  const parentPath = await buildFilePath(db, userId, parent.parentId, parent.name);
  const result = `${parentPath}/${fileName}`;
  pathCache.set(cacheKey, result);
  return result;
}

export async function buildFolderPath(db: DrizzleDb, userId: string, parentId: string | null): Promise<string> {
  if (!parentId) {
    return '/';
  }

  const cacheKey = `folder:${parentId}`;
  const cachedPath = pathCache.get(cacheKey);
  if (cachedPath) {
    return cachedPath;
  }

  const parent = await db
    .select()
    .from(files)
    .where(and(eq(files.id, parentId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!parent) {
    pathCache.set(cacheKey, '/');
    return '/';
  }

  const parentPath = await buildFolderPath(db, userId, parent.parentId);
  const result = `${parentPath}${parent.name}/`;
  pathCache.set(cacheKey, result);
  return result;
}
