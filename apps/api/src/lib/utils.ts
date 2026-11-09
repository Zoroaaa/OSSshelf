/**
 * utils.ts
 * 通用工具函数
 */

import { eq } from 'drizzle-orm';
import { users, storageBuckets, telegramFileRefs } from '../db/schema';
import type { DrizzleDb } from '../db';
import { getDb } from '../db';
import type { Env } from '../types/env';
import { makeBucketConfigAsync } from './s3client';
import { s3Get } from './s3client';
import { tgDownloadFile, type TelegramBotConfig } from './telegramClient';
import { getEncryptionKey } from './crypto';

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
      const botToken = await decryptSecret(bucket.accessKeyId, getEncryptionKey(env));
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

  const bucketConfig = await makeBucketConfigAsync(bucket, getEncryptionKey(env));
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
