/**
 * utils.ts
 * 通用工具函数
 */

import { eq, and, isNull } from 'drizzle-orm';
import { users, files, storageBuckets, telegramFileRefs } from '../db/schema';
import type { DrizzleDb } from '../db';
import { getDb } from '../db';
import type { Env } from '../types/env';
import { makeBucketConfigAsync } from './s3client';
import { s3Get } from './s3client';
import { tgDownloadFile, type TelegramBotConfig } from './telegramClient';

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

export async function getFileContent(env: Env, bucketId: string, r2Key: string): Promise<ArrayBuffer | null> {
  const db = getDbFromEnv(env);
  const bucket = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();

  if (!bucket) {
    if (bucketId === 'r2' && env.FILES) {
      const object = await env.FILES.get(r2Key);
      if (!object) return null;
      return object.arrayBuffer();
    }
    return null;
  }

  if (bucket.provider === 'telegram') {
    const tgRef = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.r2Key, r2Key)).get();
    if (!tgRef) return null;

    try {
      const { decryptSecret } = await import('./s3client');
      const botToken = await decryptSecret(bucket.accessKeyId, env.JWT_SECRET);
      const tgConfig: TelegramBotConfig = {
        botToken,
        chatId: bucket.bucketName,
        apiBase: bucket.endpoint || undefined,
      };
      const response = await tgDownloadFile(tgConfig, tgRef.tgFileId);
      return response.arrayBuffer();
    } catch {
      return null;
    }
  }

  if (bucket.provider === 'r2' && env.FILES) {
    const object = await env.FILES.get(r2Key);
    if (!object) return null;
    return object.arrayBuffer();
  }

  const bucketConfig = await makeBucketConfigAsync(bucket, env.JWT_SECRET);
  if (!bucketConfig) return null;

  try {
    const response = await s3Get(bucketConfig, r2Key);
    if (!response.ok) return null;
    return response.arrayBuffer();
  } catch {
    return null;
  }
}

function getDbFromEnv(env: Env): DrizzleDb {
  return getDb(env.DB);
}
