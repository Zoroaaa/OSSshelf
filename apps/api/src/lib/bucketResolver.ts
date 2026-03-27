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
 * 2. 向上查找父文件夹的bucketId（递归 CTE 单次查询，消除 N+1）
 * 3. 用户默认存储桶
 * 4. 兼容模式：环境变量FILES绑定
 *
 * 并发安全：
 * - updateBucketStats / updateUserStorage 使用 SQL 表达式原子更新，
 *   消除 read-then-write 竞态
 * - checkBucketQuota 仅作乐观检查，不提供严格的事务隔离保证
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb, storageBuckets, files, users } from '../db';
import { makeBucketConfigAsync, type S3BucketConfig } from './s3client';

type DbType = ReturnType<typeof getDb>;

/**
 * Resolve the storage bucket config for a given bucketId (may be null).
 * Falls back through parent chain (single recursive CTE) then default bucket.
 *
 * @param db - Drizzle DB instance
 * @param userId - current user's ID (for default bucket lookup)
 * @param encKey - JWT secret used for credential decryption
 * @param bucketId - explicit bucketId on the file, or null
 * @param parentId - parent folder id to walk up
 */
export async function resolveBucketConfig(
  db: DbType,
  userId: string,
  encKey: string,
  bucketId: string | null | undefined,
  parentId?: string | null
): Promise<S3BucketConfig | null> {
  // 1. 文件自身已指定 bucketId
  if (bucketId) {
    const row = await db
      .select()
      .from(storageBuckets)
      .where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true)))
      .get();
    if (row) return makeBucketConfigAsync(row, encKey, db);
  }

  // 2. 向上遍历父文件夹链，用递归 CTE 单次查询代替逐层 await
  if (parentId) {
    // SQLite 递归 CTE：从 parentId 出发，向上收集所有祖先的 bucketId
    // 取第一个非 null 的 bucketId（最近的祖先优先，ORDER BY depth ASC）
    const ancestorBucketId = await db
      .run(
        sql`
      WITH RECURSIVE ancestors(id, bucket_id, parent_id, depth) AS (
        SELECT id, bucket_id, parent_id, 0
        FROM files
        WHERE id = ${parentId}
          AND user_id = ${userId}
          AND deleted_at IS NULL
        UNION ALL
        SELECT f.id, f.bucket_id, f.parent_id, a.depth + 1
        FROM files f
        INNER JOIN ancestors a ON f.id = a.parent_id
        WHERE f.user_id = ${userId}
          AND f.deleted_at IS NULL
          AND a.depth < 20
      )
      SELECT bucket_id FROM ancestors
      WHERE bucket_id IS NOT NULL
      ORDER BY depth ASC
      LIMIT 1
    `
      )
      .then((r) => {
        const rows = r.results as Array<{ bucket_id: string }>;
        return rows[0]?.bucket_id ?? null;
      });

    if (ancestorBucketId) {
      const row = await db
        .select()
        .from(storageBuckets)
        .where(and(eq(storageBuckets.id, ancestorBucketId), eq(storageBuckets.isActive, true)))
        .get();
      if (row) return makeBucketConfigAsync(row, encKey, db);
    }
  }

  // 3. 用户默认存储桶
  const defaultBucket = await db
    .select()
    .from(storageBuckets)
    .where(
      and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true), eq(storageBuckets.isActive, true))
    )
    .get();
  if (defaultBucket) return makeBucketConfigAsync(defaultBucket, encKey, db);

  // 4. 任意活跃存储桶兜底
  const anyBucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true)))
    .get();
  if (anyBucket) return makeBucketConfigAsync(anyBucket, encKey, db);

  return null;
}

/**
 * 原子更新 bucket 统计（storageUsed / fileCount）。
 * 使用 SQL 表达式避免 read-then-write 竞态，同时用 MAX(0,...) 防止下溢。
 */
export async function updateBucketStats(
  db: DbType,
  bucketId: string,
  sizeDelta: number,
  fileDelta: number
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(storageBuckets)
    .set({
      storageUsed: sql`MAX(0, COALESCE(${storageBuckets.storageUsed}, 0) + ${sizeDelta})`,
      fileCount: sql`MAX(0, COALESCE(${storageBuckets.fileCount}, 0) + ${fileDelta})`,
      updatedAt: now,
    })
    .where(eq(storageBuckets.id, bucketId));
}

/**
 * 原子更新用户 storageUsed。
 * 使用 SQL 表达式替代 read-then-write，避免并发上传时的计数竞态。
 * sizeDelta 为正（上传）或负（删除）。
 */
export async function updateUserStorage(db: DbType, userId: string, sizeDelta: number): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(users)
    .set({
      storageUsed: sql`MAX(0, COALESCE(${users.storageUsed}, 0) + ${sizeDelta})`,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}

/**
 * Check if a bucket has quota space for `bytes` more data.
 * Returns null if ok, or an error message string.
 * 注意：此函数为乐观检查（非事务），高并发下存在极小概率超配。
 */
export async function checkBucketQuota(db: DbType, bucketId: string, bytes: number): Promise<string | null> {
  const row = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();
  if (!row) return null;
  if (row.storageQuota == null) return null;
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
