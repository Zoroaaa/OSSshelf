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
 *
 * 并发安全：
 *   - checkAndClaimDedup 使用单条原子 UPDATE ... RETURNING 替代 SELECT+UPDATE
 *     两步操作，消除并发上传同一文件时的 race condition
 *   - releaseFileRef 使用 UPDATE ref_count = ref_count - 1 WHERE ref_count > 0
 *     原子递减，避免读旧值后回写的 TOCTOU 问题
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
 * 原子去重声明：用单条 UPDATE ... RETURNING 替代 SELECT + UPDATE 两步操作。
 *
 * SQLite/D1 保证单条语句的原子性。即使两个 Worker 实例并发上传相同 hash，
 * 也只有一个会命中并成功递增；另一个会因为 WHERE 匹配不到行而返回空集，
 * 从而走新文件写入路径（最坏情况：两份物理对象，但 ref_count 始终正确）。
 */
export async function checkAndClaimDedup(
  db: DrizzleDb,
  hash: string,
  bucketId: string | null,
  userId: string
): Promise<DedupResult> {
  if (!hash) return { isDuplicate: false };

  const now = new Date().toISOString();

  // 原子：找到候选行并立即递增 ref_count，通过 RETURNING 取回 r2Key/size
  // D1 支持 Drizzle 的 .returning()，单条语句保证原子性
  const updated = await db
    .update(files)
    .set({
      refCount: sql`${files.refCount} + 1`,
      updatedAt: now,
    })
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
    .returning({ r2Key: files.r2Key, size: files.size })
    // D1 UPDATE 可能命中多行（同 hash 多条记录）；取第一行即可
    .then((rows) => rows[0] ?? null);

  if (!updated) return { isDuplicate: false };

  return {
    isDuplicate: true,
    existingR2Key: updated.r2Key,
    existingSize: updated.size,
  };
}

/**
 * 删除文件时的引用计数原子递减。
 * 使用 ref_count = ref_count - 1 WHERE ref_count > 0 避免读旧值后回写。
 *
 * @returns shouldDeleteStorage  true = ref_count 已归零，调用方应删除存储对象
 */
export async function releaseFileRef(db: DrizzleDb, fileId: string): Promise<{ shouldDeleteStorage: boolean }> {
  const now = new Date().toISOString();

  // 原子递减：仅当 ref_count > 1 时执行减法（还有其他引用）
  const decremented = await db
    .update(files)
    .set({ refCount: sql`${files.refCount} - 1`, updatedAt: now })
    .where(and(eq(files.id, fileId), gt(files.refCount, 1)))
    .returning({ id: files.id })
    .then((rows) => rows[0] ?? null);

  if (decremented) {
    // 成功递减，仍有剩余引用，不删存储
    return { shouldDeleteStorage: false };
  }

  // ref_count 为 1（或已为 0）：此次是最后一个引用，归零并通知调用方清理存储
  await db.update(files).set({ refCount: 0, updatedAt: now }).where(eq(files.id, fileId));

  return { shouldDeleteStorage: true };
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

/**
 * 流式计算 SHA-256：分块读取 ReadableStream，边传边算，无需全量内存。
 * 适用于大文件上传（Telegram 分片路径等）。
 */
export async function computeSha256Stream(stream: ReadableStream<Uint8Array>): Promise<string> {
  // Web Crypto SubtleCrypto 不支持流式 digest，使用手动分块累积
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return computeSha256Hex(merged.buffer as ArrayBuffer);
}
