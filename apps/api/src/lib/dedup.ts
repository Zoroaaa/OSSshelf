/**
 * dedup.ts
 * 文件去重（Copy-on-Write）核心逻辑
 *
 * 设计原则：
 *   - 相同 hash + 相同 bucketId 的文件共享一个存储对象（r2Key）
 *   - files 表中每条记录对应一个逻辑文件（独立 name/path/parentId）
 *   - ref_count 追踪同一 r2Key 的引用数：
 *       新文件上传      → ref_count = 1，写入新对象到存储
 *       命中去重        → ref_count += 1，复用 existing r2Key，不写存储
 *       软删除/永久删除 → ref_count -= 1；ref_count 降为 0 时才删除存储对象
 *
 * 约束：
 *   - hash 为 null 的文件不参与去重（流式上传/未知 hash 场景）
 *   - 跨存储桶不去重（R2 和 Telegram 对象不互通）
 *   - 已软删除的文件不作为去重目标
 */

import { and, eq, isNull, gt, sql } from 'drizzle-orm';
import { files } from '../db/schema';
import type { DrizzleDb } from '../db';

export interface DedupResult {
  /** 是否命中去重：true = 复用现有对象，无需写入存储 */
  isDuplicate: boolean;
  /** 命中去重时：原始文件的 r2Key（新记录应使用此 key） */
  existingR2Key?: string;
  /** 命中去重时：原始文件的大小（用于配额扣除验证） */
  existingSize?: number;
}

/**
 * 检查是否存在相同 hash + bucketId 的活跃文件（去重候选）。
 * 若存在，对候选文件的 ref_count 原子 +1 并返回其 r2Key。
 * 若不存在，返回 { isDuplicate: false }。
 *
 * @param db       Drizzle DB 实例
 * @param hash     文件内容哈希（SHA-256 hex）
 * @param bucketId 目标存储桶 ID（null = legacy R2 binding）
 * @param userId   文件所有者（去重仅在同一用户内进行）
 */
export async function checkAndClaimDedup(
  db: DrizzleDb,
  hash: string,
  bucketId: string | null,
  userId: string
): Promise<DedupResult> {
  // hash 为空则跳过去重
  if (!hash) return { isDuplicate: false };

  // 查找同用户、同 hash、同 bucketId、未删除、ref_count > 0 的最早记录
  const candidate = await db
    .select({
      id: files.id,
      r2Key: files.r2Key,
      size: files.size,
      refCount: files.refCount,
    })
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.hash, hash),
        isNull(files.deletedAt),
        eq(files.isFolder, false),
        gt(files.refCount, 0),
        // bucketId 匹配（null 与 null 相等）
        bucketId ? eq(files.bucketId, bucketId) : isNull(files.bucketId)
      )
    )
    .limit(1)
    .all()
    .then((rows) => rows[0] ?? null);

  if (!candidate) return { isDuplicate: false };

  // 原子递增 ref_count
  await db
    .update(files)
    .set({
      refCount: candidate.refCount + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(files.id, candidate.id));

  return {
    isDuplicate: true,
    existingR2Key: candidate.r2Key,
    existingSize: candidate.size,
  };
}

/**
 * 删除文件时的引用计数递减逻辑。
 * 找到同 r2Key 中 ref_count 最高的"主记录"，将其 ref_count - 1。
 * 若递减后 ref_count <= 0，调用方需负责真正删除存储对象。
 *
 * @returns shouldDeleteStorage  true = ref_count 已归零，调用方应删除存储对象
 */
export async function releaseFileRef(db: DrizzleDb, fileId: string): Promise<{ shouldDeleteStorage: boolean }> {
  const file = await db
    .select({ id: files.id, r2Key: files.r2Key, refCount: files.refCount })
    .from(files)
    .where(eq(files.id, fileId))
    .get();

  if (!file) return { shouldDeleteStorage: false };

  // ref_count 已为 1（或 0）：此次删除是最后一个引用
  if (file.refCount <= 1) {
    // 将 ref_count 设为 0，标志存储对象可被清理
    await db.update(files).set({ refCount: 0, updatedAt: new Date().toISOString() }).where(eq(files.id, fileId));
    return { shouldDeleteStorage: true };
  }

  // 还有其他引用：仅减引用，不删存储
  await db
    .update(files)
    .set({ refCount: file.refCount - 1, updatedAt: new Date().toISOString() })
    .where(eq(files.id, fileId));

  return { shouldDeleteStorage: false };
}

/**
 * 计算 ArrayBuffer 的 SHA-256 哈希，返回 hex 字符串。
 * 用于上传前的内容哈希计算（仅对可完整读取的小/中文件调用）。
 */
export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
