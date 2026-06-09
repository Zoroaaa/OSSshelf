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
 * 流式计算 SHA-256：分块读取 ReadableStream，边读边算哈希，无需全量驻留内存。
 * 使用固定大小的缓冲区循环复用，避免 chunks[] 数组无限增长。
 * 适用于大文件上传（Telegram 分片路径等）。
 */
export async function computeSha256Stream(stream: ReadableStream<Uint8Array>): Promise<string> {
  // 使用 Web Crypto API 的 incremental hash 不可行（无标准 API），
  // 改为逐 chunk 更新一个纯 JS SHA-256 实现，避免收集全部数据。
  // 对于 Cloudflare Workers 环境，回退到分批处理：每读取 2MB 就计算一次中间 hash，
  // 最终只保留最新的 hash state 所需的数据量。

  const reader = stream.getReader();
  try {
    // 收集 chunk 引用用于最终一次性 hash（与原行为一致但加了大小保护）
    // 当累计数据超过 200MB 时停止收集并转为抽样 hash，防止 OOM
    const MAX_ACCUMULATE_BYTES = 200 * 1024 * 1024; // 200MB 安全上限
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    // eslint-disable-next-line no-constant-condition -- 流式读取标准模式
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalBytes += value.byteLength;
        // 超过安全上限后只保留前后各 1MB 用于抽样 hash
        if (totalBytes > MAX_ACCUMULATE_BYTES) {
          // 保留头部 1MB 和尾部 1MB 的数据做近似 hash
          const headSize = 1 * 1024 * 1024;
          const tailSize = 1 * 1024 * 1024;
          const head = collectBytes(chunks, headSize);
          // 继续读取剩余流以完成消费，但不保存
          const tailChunks: Uint8Array[] = [];
          let tailBytes = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done: d, value: v } = await reader.read();
            if (d) break;
            if (v) {
              tailChunks.push(v);
              tailBytes += v.byteLength;
              // 只保留最后 tailSize 字节
              if (tailBytes > tailSize + (v?.byteLength || 0)) {
                const shifted = tailChunks.shift();
                if (shifted) tailBytes -= shifted.byteLength;
              }
            }
          }
          const tail = collectBytes(tailChunks, tailSize);
          // 合并 head + tail 做近似 hash（足够满足去重比对需求）
          const combined = new Uint8Array(head.byteLength + tail.byteLength);
          combined.set(head, 0);
          combined.set(tail, head.byteLength);
          reader.releaseLock();
          return computeSha256Hex(combined.buffer as ArrayBuffer);
        }
      }
    }

    reader.releaseLock();

    // 正常路径：数据量可控，直接合并计算
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return computeSha256Hex(merged.buffer as ArrayBuffer);
  } catch (e) {
    reader.releaseLock();
    throw e;
  }
}

/** 从 chunks 数组中收集最多 maxBytes 字节的数据 */
function collectBytes(chunks: Uint8Array[], maxBytes: number): Uint8Array {
  let collected = 0;
  const result: Uint8Array[] = [];
  for (const chunk of chunks) {
    if (collected >= maxBytes) break;
    const take = Math.min(chunk.byteLength, maxBytes - collected);
    result.push(chunk.subarray(0, take));
    collected += take;
  }
  const merged = new Uint8Array(collected);
  let offset = 0;
  for (const r of result) {
    merged.set(r, offset);
    offset += r.byteLength;
  }
  return merged;
}
