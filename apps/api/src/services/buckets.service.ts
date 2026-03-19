/**
 * buckets.service.ts
 * 存储桶管理业务逻辑服务
 *
 * 功能:
 * - 多厂商存储桶配置（R2、S3、OSS、COS、OBS、B2、MinIO等）
 * - 存储桶增删改查
 * - 存储桶测试与切换
 * - 凭证AES-GCM加密存储
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, storageBuckets, files, users } from '../db';
import { ERROR_CODES } from '@osshelf/shared';
import { getEncryptionKey } from '../lib/crypto';
import { encryptSecret, testS3Connection, makeBucketConfigAsync, decryptSecret } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import type { Env } from '../types/env';

export const PROVIDERS = {
  r2: { name: 'Cloudflare R2', defaultEndpoint: 'https://<accountId>.r2.cloudflarestorage.com', pathStyle: false },
  s3: { name: 'Amazon S3', defaultEndpoint: '', pathStyle: false },
  oss: { name: 'Aliyun OSS', defaultEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com', pathStyle: false },
  cos: { name: 'Tencent COS', defaultEndpoint: 'https://cos.ap-guangzhou.myqcloud.com', pathStyle: false },
  obs: { name: 'Huawei OBS', defaultEndpoint: 'https://obs.cn-north-4.myhuaweicloud.com', pathStyle: false },
  b2: { name: 'Backblaze B2', defaultEndpoint: 'https://s3.us-west-004.backblazeb2.com', pathStyle: true },
  minio: { name: 'MinIO', defaultEndpoint: 'http://localhost:9000', pathStyle: true },
  custom: { name: '自定义 S3 兼容', defaultEndpoint: '', pathStyle: false },
  telegram: { name: 'Telegram', defaultEndpoint: '', pathStyle: false },
} as const;

function sanitize(bucket: typeof storageBuckets.$inferSelect) {
  const { accessKeyId, secretAccessKey, ...safe } = bucket;
  const displayAkId = bucket.provider === 'telegram'
    ? accessKeyId.slice(0, 8) + '••••••••'
    : accessKeyId.slice(0, 4) + '••••••••' + accessKeyId.slice(-4);
  return {
    ...safe,
    accessKeyId: displayAkId,
    secretAccessKeyMasked: bucket.provider === 'telegram' ? '(telegram)' : '••••••••••••••••',
  };
}

export async function listBuckets(db: ReturnType<typeof getDb>, userId: string) {
  const buckets = await db.select().from(storageBuckets).where(eq(storageBuckets.userId, userId)).all();

  const activeFiles = await db
    .select({ bucketId: files.bucketId, size: files.size, isFolder: files.isFolder })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const bucketStats = new Map<string, { storageUsed: number; fileCount: number }>();
  for (const f of activeFiles.filter((f) => !f.isFolder)) {
    const bucketId = f.bucketId || '__no_bucket__';
    const stats = bucketStats.get(bucketId) || { storageUsed: 0, fileCount: 0 };
    stats.storageUsed += f.size;
    stats.fileCount += 1;
    bucketStats.set(bucketId, stats);
  }

  const sorted = [...buckets].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });

  const result = sorted.map((b) => {
    const actualStats = bucketStats.get(b.id) || { storageUsed: 0, fileCount: 0 };
    const sanitized = sanitize(b);
    return {
      ...sanitized,
      storageUsed: actualStats.storageUsed,
      fileCount: actualStats.fileCount,
    };
  });

  return result;
}

export async function createBucket(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  data: {
    name: string;
    provider: string;
    bucketName: string;
    endpoint?: string;
    region?: string;
    accessKeyId: string;
    secretAccessKey: string;
    pathStyle?: boolean;
    isDefault?: boolean;
    notes?: string;
    storageQuota?: number | null;
  }
) {
  const now = new Date().toISOString();

  if (data.isDefault) {
    await db
      .update(storageBuckets)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true)));
  }

  const existing = await db.select().from(storageBuckets).where(eq(storageBuckets.userId, userId)).all();
  const shouldBeDefault = data.isDefault || existing.length === 0;

  const id = crypto.randomUUID();
  const encryptedAccessKeyId = await encryptSecret(data.accessKeyId, encKey);
  const encryptedSecretAccessKey = await encryptSecret(data.secretAccessKey, encKey);

  const newBucket = {
    id,
    userId,
    name: data.name,
    provider: data.provider,
    bucketName: data.bucketName,
    endpoint: data.endpoint || null,
    region: data.region || null,
    accessKeyId: encryptedAccessKeyId,
    secretAccessKey: encryptedSecretAccessKey,
    pathStyle: data.pathStyle ?? false,
    isDefault: shouldBeDefault,
    isActive: true,
    storageUsed: 0,
    fileCount: 0,
    storageQuota: data.storageQuota ?? null,
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(storageBuckets).values(newBucket);

  return sanitize(newBucket as typeof storageBuckets.$inferSelect);
}

export async function getBucketById(db: ReturnType<typeof getDb>, userId: string, id: string) {
  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return null;
  }

  return sanitize(bucket);
}

export async function updateBucket(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  id: string,
  data: {
    name?: string;
    provider?: string;
    bucketName?: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    pathStyle?: boolean;
    isDefault?: boolean;
    notes?: string;
    storageQuota?: number | null;
  }
) {
  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return null;
  }

  const now = new Date().toISOString();

  if (data.isDefault && !bucket.isDefault) {
    await db
      .update(storageBuckets)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true)));
  }

  const updateData: Record<string, unknown> = { updatedAt: now };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.provider !== undefined) updateData.provider = data.provider;
  if (data.bucketName !== undefined) updateData.bucketName = data.bucketName;
  if (data.endpoint !== undefined) updateData.endpoint = data.endpoint || null;
  if (data.region !== undefined) updateData.region = data.region || null;
  if (data.accessKeyId !== undefined) updateData.accessKeyId = await encryptSecret(data.accessKeyId, encKey);
  if (data.secretAccessKey !== undefined)
    updateData.secretAccessKey = await encryptSecret(data.secretAccessKey, encKey);
  if (data.pathStyle !== undefined) updateData.pathStyle = data.pathStyle;
  if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
  if (data.notes !== undefined) updateData.notes = data.notes || null;
  if (data.storageQuota !== undefined) updateData.storageQuota = data.storageQuota ?? null;

  await db.update(storageBuckets).set(updateData).where(eq(storageBuckets.id, id));

  const updated = await db.select().from(storageBuckets).where(eq(storageBuckets.id, id)).get();
  return updated ? sanitize(updated) : null;
}

export async function setDefaultBucket(db: ReturnType<typeof getDb>, userId: string, id: string) {
  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return { success: false, error: '存储桶不存在' };
  }

  const now = new Date().toISOString();

  await db.update(storageBuckets).set({ isDefault: false, updatedAt: now }).where(eq(storageBuckets.userId, userId));

  await db.update(storageBuckets).set({ isDefault: true, updatedAt: now }).where(eq(storageBuckets.id, id));

  return { success: true };
}

export async function toggleBucket(db: ReturnType<typeof getDb>, userId: string, id: string) {
  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return { success: false, error: '存储桶不存在' };
  }

  const now = new Date().toISOString();
  const newIsActive = !bucket.isActive;
  await db.update(storageBuckets).set({ isActive: newIsActive, updatedAt: now }).where(eq(storageBuckets.id, id));

  return { success: true, isActive: newIsActive };
}

export async function testBucketConnection(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  id: string
) {
  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return { success: false, error: '存储桶不存在' };
  }

  if (bucket.provider === 'telegram') {
    try {
      const { tgTestConnection } = await import('../lib/telegramClient');
      const botToken = await decryptSecret(bucket.accessKeyId, encKey);
      const tgResult = await tgTestConnection({
        botToken,
        chatId: bucket.bucketName,
        apiBase: bucket.endpoint || undefined,
      });
      return {
        success: tgResult.connected,
        data: {
          connected: tgResult.connected,
          message: tgResult.message,
          statusCode: tgResult.connected ? 200 : 400,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Telegram 连接失败' };
    }
  }

  try {
    const cfg = await makeBucketConfigAsync(bucket, encKey, db);
    const testResult = await testS3Connection(cfg);
    return { success: true, data: testResult };
  } catch (err: any) {
    return { success: false, error: err.message || '连接失败' };
  }
}

export async function deleteBucket(db: ReturnType<typeof getDb>, userId: string, id: string) {
  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return { success: false, error: '存储桶不存在' };
  }

  if (bucket.isDefault) {
    const remaining = await db
      .select()
      .from(storageBuckets)
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true)))
      .all();
    const next = remaining.filter((b) => b.id !== id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (next) {
      const now = new Date().toISOString();
      await db.update(storageBuckets).set({ isDefault: true, updatedAt: now }).where(eq(storageBuckets.id, next.id));
    }
  }

  await db.delete(storageBuckets).where(eq(storageBuckets.id, id));

  return { success: true };
}

export { sanitize };
