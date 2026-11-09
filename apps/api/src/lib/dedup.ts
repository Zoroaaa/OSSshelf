/**
 * dedup.ts
 * 文件去重（Copy-on-Write）核心逻辑
 *
 * 设计原则：
 *   - 相同 hash + 相同 bucketId 的文件共享一个存储对象（r2Key）
 *   - files 表中每条记录对应一个逻辑文件（独立 name/path/parentId）
 *   - 物理对象在同一 r2Key 的所有 files 记录之间共享
 *       新文件上传 → 写入新对象
 *       命中去重   → 复用 existing r2Key，不写存储
 *       删除文件   → 仅当再无其它记录引用该 r2Key 时才删除物理对象
 *
 * 约束：
 *   - hash 为 null 的文件不参与去重（流式上传/未知 hash 场景）
 *   - 跨存储桶不去重（R2 和 Telegram 对象不互通）
 *   - 已软删除的文件不作为去重目标
 *
 * 引用计数语义：
 *   - 物理对象的存活由 files 表中同一 r2_key 的记录数决定（含回收站中的记录，
 *     因为软删除不删除物理对象）
 *   - files.ref_count 仅作为兼容字段保留，不再作为删除判断依据，
 *     避免"逐行计数"与"对象级计数"混用导致误删共享对象
 *
 * 并发安全：
 *   - checkAndClaimDedup 通过 LIMIT 1 精确定位单个候选对象，不会误改其他行
 *   - releaseFileRef 通过 r2_key 聚合判断是否还有其它引用，删除前不会误删共享对象
 */

import { and, eq, isNull, gt, ne } from 'drizzle-orm';
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
 * 查找可复用的物理对象。
 *
 * 只做 SELECT（LIMIT 1），不修改任何行的 ref_count：
 * 引用关系由 files.r2_key 本身表达，删除时按 r2_key 聚合判断，
 * 因此无需在插入前"抢占"计数，也就不会出现原实现中
 * "所有同 hash 行都被 +1、但只有一行被返回"的数据错乱。
 *
 * 并发上传同一内容时，双方都可能各自写入一份物理对象（最坏情况），
 * 但引用关系始终正确，不会误删仍在使用的对象。
 */
export async function checkAndClaimDedup(
  db: DrizzleDb,
  hash: string,
  bucketId: string | null,
  userId: string
): Promise<DedupResult> {
  if (!hash) return { isDuplicate: false };

  const existing = await db
    .select({ r2Key: files.r2Key, size: files.size })
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.hash, hash),
        isNull(files.deletedAt),
        eq(files.isFolder, false),
        gt(files.refCount, 0),
        bucketId ? eq(files.bucketId, bucketId) : isNull(files.bucketId)
      )
    )
    .limit(1)
    .get();

  if (!existing) return { isDuplicate: false };

  return {
    isDuplicate: true,
    existingR2Key: existing.r2Key,
    existingSize: existing.size,
  };
}

/**
 * 删除文件时判断是否可以清理物理对象。
 *
 * 判断依据：files 表中是否还有其它记录引用同一个 r2_key。
 * 这里必须把回收站中的记录也计算在内——软删除只释放配额，
 * 并不会删除物理对象，因此它仍然持有一个引用。
 *
 * @returns shouldDeleteStorage  true = 没有其它引用，调用方应删除存储对象
 */
export async function releaseFileRef(db: DrizzleDb, fileId: string): Promise<{ shouldDeleteStorage: boolean }> {
  const now = new Date().toISOString();

  const file = await db.select({ r2Key: files.r2Key }).from(files).where(eq(files.id, fileId)).get();
  if (!file) return { shouldDeleteStorage: true };

  const otherRef = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.r2Key, file.r2Key), ne(files.id, fileId)))
    .limit(1)
    .get();

  // 兼容字段归零，便于排查；真正的删除判断看上面的聚合结果
  await db.update(files).set({ refCount: 0, updatedAt: now }).where(eq(files.id, fileId));

  return { shouldDeleteStorage: !otherRef };
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
