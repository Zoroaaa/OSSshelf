/**
 * bucketResolver.ts
 * 存储桶解析器
 * 
 * 功能:
 * - 根据文件/文件夹解析存储桶配置
 * - 支持层级继承（文件->父文件夹->用户默认）
 * - 存储桶配额检查
 * - 存储桶统计更新
 * 
 * 优先级:
 * 1. 文件自身的bucketId
 * 2. 向上查找父文件夹的bucketId
 * 3. 用户默认存储桶
 * 4. 兼容模式：环境变量FILES绑定
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, storageBuckets, files } from '../db';
import { makeBucketConfig, type S3BucketConfig } from './s3client';
import type { Env } from '../types/env';

type DbType = ReturnType<typeof getDb>;

/**
 * Resolve the storage bucket config for a given bucketId (may be null).
 * Falls back through parent chain then default bucket.
 *
 * @param db - Drizzle DB instance
 * @param userId - current user's ID (for default bucket lookup)
 * @param bucketId - explicit bucketId on the file, or null
 * @param parentId - parent folder id to walk up
 * @param encKey - JWT secret used for credential deobfuscation
 */
export async function resolveBucketConfig(
  db: DbType,
  userId: string,
  encKey: string,
  bucketId: string | null | undefined,
  parentId?: string | null,
): Promise<S3BucketConfig | null> {
  // 1. Direct bucket assignment
  if (bucketId) {
    const row = await db.select().from(storageBuckets)
      .where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true)))
      .get();
    if (row) return makeBucketConfig(row, encKey);
  }

  // 2. Walk parent chain
  if (parentId) {
    let currentId: string | null = parentId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const folder = await db.select().from(files)
        .where(and(eq(files.id, currentId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get();
      if (!folder) break;
      if (folder.bucketId) {
        const row = await db.select().from(storageBuckets)
          .where(and(eq(storageBuckets.id, folder.bucketId), eq(storageBuckets.isActive, true)))
          .get();
        if (row) return makeBucketConfig(row, encKey);
      }
      currentId = folder.parentId ?? null;
    }
  }

  // 3. Default bucket for user
  const defaultBucket = await db.select().from(storageBuckets)
    .where(and(
      eq(storageBuckets.userId, userId),
      eq(storageBuckets.isDefault, true),
      eq(storageBuckets.isActive, true),
    ))
    .get();
  if (defaultBucket) return makeBucketConfig(defaultBucket, encKey);

  // 4. Any active bucket
  const anyBucket = await db.select().from(storageBuckets)
    .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true)))
    .get();
  if (anyBucket) return makeBucketConfig(anyBucket, encKey);

  return null; // Fall through to legacy c.env.FILES
}

/**
 * Update per-bucket storage stats after an upload or delete.
 */
export async function updateBucketStats(
  db: DbType,
  bucketId: string,
  sizeDelta: number,   // positive = upload, negative = delete
  fileDelta: number,   // +1 or -1
): Promise<void> {
  const now = new Date().toISOString();
  const row = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();
  if (!row) return;
  await db.update(storageBuckets).set({
    storageUsed: Math.max(0, (row.storageUsed ?? 0) + sizeDelta),
    fileCount: Math.max(0, (row.fileCount ?? 0) + fileDelta),
    updatedAt: now,
  }).where(eq(storageBuckets.id, bucketId));
}

/**
 * Check if a bucket has quota space for `bytes` more data.
 * Returns null if ok, or an error message string.
 */
export async function checkBucketQuota(
  db: DbType,
  bucketId: string,
  bytes: number,
): Promise<string | null> {
  const row = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();
  if (!row) return null;
  if (row.storageQuota == null) return null; // unlimited
  if ((row.storageUsed ?? 0) + bytes > row.storageQuota) {
    const used = formatBytes(row.storageUsed ?? 0);
    const quota = formatBytes(row.storageQuota);
    return `存储桶「${row.name}」空间不足（已用 ${used} / 限额 ${quota}）`;
  }
  return null;
}

function formatBytes(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`;
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}
