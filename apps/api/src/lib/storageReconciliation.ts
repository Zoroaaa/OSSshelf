/**
 * storageReconciliation.ts
 * 存储记账每日对账（只报告，不自动修复）
 *
 * 对比口径（与 114_storage_accounting.sql 的触发器保持一致）：
 *   - 用户：users.storage_used vs 未软删除普通文件 size 之和
 *   - 存储桶：storage_buckets.storage_used/file_count vs 显式 bucket_id 指向该桶的活跃文件
 *   - 未归属：bucket_id 为空且需按祖先/默认桶继承解析的活跃文件
 *   - 去重：同一 r2_key 被多条记录共享的情况；跨桶共享属于高危异常
 *   - 路径：files.path 与 parentId 链推导结果不一致，或无法从根到达（孤儿/环）
 *
 * 设计上只读，不修改任何业务数据；差异通过 cron 告警/管理接口输出。
 */

import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { getDb, files, users, storageBuckets } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';

const MAX_DIFF_SAMPLES = 50;

export interface StorageDiffItem {
  id: string;
  name?: string;
  recorded: number;
  actual: number;
  diff: number;
}

export interface ReconciliationReport {
  generatedAt: string;
  users: {
    checked: number;
    withDiff: number;
    totalDiffBytes: number;
    samples: StorageDiffItem[];
  };
  buckets: {
    checked: number;
    withDiff: number;
    totalDiffBytes: number;
    totalDiffCount: number;
    samples: StorageDiffItem[];
  };
  unassigned: {
    files: number;
    bytes: number;
  };
  dedup: {
    sharedGroups: number;
    crossBucketGroups: number;
  };
  path: {
    mismatch: number;
    unreachable: number;
  };
}

/** 纯函数：按 id 对比记录值与实际值，供单元测试与对账复用 */
export function diffStorageMaps(
  recorded: Map<string, number>,
  actual: Map<string, number>
): { withDiff: number; totalDiff: number; samples: StorageDiffItem[] } {
  const ids = new Set<string>([...recorded.keys(), ...actual.keys()]);
  const diffs: StorageDiffItem[] = [];
  let totalDiff = 0;

  for (const id of ids) {
    const recordedValue = recorded.get(id) ?? 0;
    const actualValue = actual.get(id) ?? 0;
    const diff = recordedValue - actualValue;
    if (diff === 0) continue;
    totalDiff += diff;
    diffs.push({ id, recorded: recordedValue, actual: actualValue, diff });
  }

  diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { withDiff: diffs.length, totalDiff, samples: diffs.slice(0, MAX_DIFF_SAMPLES) };
}

export async function runStorageReconciliation(env: Env): Promise<ReconciliationReport> {
  const db = getDb(env.DB);
  const generatedAt = new Date().toISOString();

  // ── 用户口径 ──────────────────────────────────────────────────────────
  const actualUserRows = await db
    .select({
      id: files.userId,
      bytes: sql<number>`COALESCE(SUM(${files.size}), 0)`,
    })
    .from(files)
    .where(and(isNull(files.deletedAt), eq(files.isFolder, false)))
    .groupBy(files.userId)
    .all();

  const userRows = await db.select({ id: users.id, storageUsed: users.storageUsed }).from(users).all();

  const recordedUsers = new Map(userRows.map((row) => [row.id, Number(row.storageUsed ?? 0)]));
  const actualUsers = new Map(actualUserRows.map((row) => [row.id, Number(row.bytes ?? 0)]));
  const userDiff = diffStorageMaps(recordedUsers, actualUsers);

  // ── 存储桶口径 ────────────────────────────────────────────────────────
  const actualBucketRows = await db
    .select({
      id: files.bucketId,
      bytes: sql<number>`COALESCE(SUM(${files.size}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(files)
    .where(and(isNull(files.deletedAt), eq(files.isFolder, false), isNotNull(files.bucketId)))
    .groupBy(files.bucketId)
    .all();

  const bucketRows = await db
    .select({
      id: storageBuckets.id,
      name: storageBuckets.name,
      storageUsed: storageBuckets.storageUsed,
      fileCount: storageBuckets.fileCount,
    })
    .from(storageBuckets)
    .all();

  const recordedBuckets = new Map(bucketRows.map((row) => [row.id, Number(row.storageUsed ?? 0)]));
  const actualBuckets = new Map(
    actualBucketRows.filter((row) => row.id !== null).map((row) => [row.id as string, Number(row.bytes ?? 0)])
  );
  const bucketDiff = diffStorageMaps(recordedBuckets, actualBuckets);

  const recordedCounts = new Map(bucketRows.map((row) => [row.id, Number(row.fileCount ?? 0)]));
  const actualCounts = new Map(
    actualBucketRows.filter((row) => row.id !== null).map((row) => [row.id as string, Number(row.count ?? 0)])
  );
  const bucketCountDiff = diffStorageMaps(recordedCounts, actualCounts);

  const bucketNames = new Map(bucketRows.map((row) => [row.id, row.name]));
  for (const sample of bucketDiff.samples) {
    sample.name = bucketNames.get(sample.id);
  }

  // ── 未显式归属存储桶的活跃文件（走继承/默认桶解析）────────────────────
  const unassigned = await db
    .select({
      count: sql<number>`COUNT(*)`,
      bytes: sql<number>`COALESCE(SUM(${files.size}), 0)`,
    })
    .from(files)
    .where(and(isNull(files.deletedAt), eq(files.isFolder, false), isNull(files.bucketId)))
    .get();

  // ── 去重共享对象 ──────────────────────────────────────────────────────
  const sharedRows = await db
    .select({
      r2Key: files.r2Key,
      records: sql<number>`COUNT(*)`,
      buckets: sql<number>`COUNT(DISTINCT COALESCE(${files.bucketId}, ''))`,
    })
    .from(files)
    .where(and(isNotNull(files.r2Key), eq(files.isFolder, false)))
    .groupBy(files.r2Key)
    .having(sql`COUNT(*) > 1`)
    .all();

  // ── 路径一致性（与 117 迁移同一推导规则）──────────────────────────────
  const pathStat = await db.run(sql`
    WITH RECURSIVE tree(id, computed_path, depth) AS (
      SELECT id,
        CASE
          WHEN team_id IS NOT NULL THEN '/teams/' || team_id || '/' || name
          ELSE '/' || name
        END,
        0
      FROM files WHERE parent_id IS NULL
      UNION ALL
      SELECT f.id, tree.computed_path || '/' || f.name, tree.depth + 1
      FROM files f
      JOIN tree ON f.parent_id = tree.id
      WHERE tree.depth < 64
    )
    SELECT
      COALESCE(SUM(CASE WHEN t.id IS NOT NULL AND f.path != t.computed_path THEN 1 ELSE 0 END), 0) AS mismatch,
      COALESCE(SUM(CASE WHEN t.id IS NULL THEN 1 ELSE 0 END), 0) AS unreachable
    FROM files f
    LEFT JOIN tree t ON t.id = f.id
  `);
  const pathRow = (pathStat.results as Array<{ mismatch: number; unreachable: number }>)[0];

  const report: ReconciliationReport = {
    generatedAt,
    users: {
      checked: userRows.length,
      withDiff: userDiff.withDiff,
      totalDiffBytes: userDiff.totalDiff,
      samples: userDiff.samples,
    },
    buckets: {
      checked: bucketRows.length,
      withDiff: bucketDiff.withDiff,
      totalDiffBytes: bucketDiff.totalDiff,
      totalDiffCount: bucketCountDiff.totalDiff,
      samples: bucketDiff.samples,
    },
    unassigned: {
      files: Number(unassigned?.count ?? 0),
      bytes: Number(unassigned?.bytes ?? 0),
    },
    dedup: {
      sharedGroups: sharedRows.length,
      crossBucketGroups: sharedRows.filter((row) => Number(row.buckets) > 1).length,
    },
    path: {
      mismatch: Number(pathRow?.mismatch ?? 0),
      unreachable: Number(pathRow?.unreachable ?? 0),
    },
  };

  logger.info('RECONCILE', '存储对账完成', {
    usersWithDiff: report.users.withDiff,
    bucketsWithDiff: report.buckets.withDiff,
    pathMismatch: report.path.mismatch,
    pathUnreachable: report.path.unreachable,
    sharedObjectGroups: report.dedup.sharedGroups,
  });

  return report;
}
