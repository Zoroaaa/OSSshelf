/**
 * storageGC.ts
 * 对象存储删除补偿队列。
 *
 * 背景：S3/R2 删除是删除链路最后一步，失败时数据库记录已经删除，
 * 对象会永久残留（或更糟：调用方误以为删除成功）。这里统一为：
 *   1. 先尽力删除对象
 *   2. 失败则写入 storage_deletion_queue，由定时任务按指数退避重试
 *
 * 安全性：重试前确认没有任何 files 记录仍引用该 r2Key，
 * 避免“对象被新记录复用后被误删”。
 */

import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { getDb, files, storageDeletionQueue, telegramFileRefs } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { getEncryptionKey } from './crypto';
import { resolveBucketConfig } from './bucketResolver';
import { s3Delete } from './s3client';
import { tgDeleteChunked, isChunkedFileId } from './telegramChunked';

export interface DeletionTarget {
  userId: string;
  /** 为空表示默认 R2 桶 */
  bucketId: string | null;
  parentId: string | null;
  r2Key: string;
  reason?: string;
}

const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(attempts, 1) * 60_000, MAX_BACKOFF_MS);
}

async function enqueueDeletion(
  db: ReturnType<typeof getDb>,
  target: DeletionTarget,
  errorMessage: string
): Promise<void> {
  const existing = await db
    .select({ id: storageDeletionQueue.id })
    .from(storageDeletionQueue)
    .where(
      and(
        eq(storageDeletionQueue.objectKey, target.r2Key),
        target.bucketId
          ? eq(storageDeletionQueue.bucketId, target.bucketId)
          : isNull(storageDeletionQueue.bucketId),
        isNull(storageDeletionQueue.resolvedAt)
      )
    )
    .get();

  if (existing) {
    await db
      .update(storageDeletionQueue)
      .set({ attempts: sql`${storageDeletionQueue.attempts} + 1`, lastError: errorMessage, nextRetryAt: new Date(Date.now() + backoffMs(1)).toISOString() })
      .where(eq(storageDeletionQueue.id, existing.id));
    return;
  }

  const now = new Date();
  await db.insert(storageDeletionQueue).values({
    id: crypto.randomUUID(),
    userId: target.userId,
    bucketId: target.bucketId,
    objectKey: target.r2Key,
    reason: target.reason ?? null,
    attempts: 0,
    lastError: errorMessage,
    nextRetryAt: new Date(now.getTime() + backoffMs(1)).toISOString(),
    createdAt: now.toISOString(),
    resolvedAt: null,
  });
}

async function deleteObjectNow(env: Env, db: ReturnType<typeof getDb>, target: DeletionTarget): Promise<void> {
  if (target.bucketId) {
    const config = await resolveBucketConfig(db, target.userId, getEncryptionKey(env), target.bucketId, target.parentId);
    if (!config) throw new Error('存储桶配置不可用');

    // Telegram 桶：物理文件在 Telegram 服务器，只能清理分片与 DB 引用
    if (config.provider === 'telegram') {
      const ref = await db
        .select()
        .from(telegramFileRefs)
        .where(eq(telegramFileRefs.r2Key, target.r2Key))
        .get();
      if (ref) {
        if (isChunkedFileId(ref.tgFileId)) {
          await tgDeleteChunked(db, ref.tgFileId);
        }
        await db.delete(telegramFileRefs).where(eq(telegramFileRefs.r2Key, target.r2Key));
      }
      return;
    }

    await s3Delete(config, target.r2Key);
    return;
  }

  if (!env.FILES) throw new Error('默认对象存储未配置');
  await env.FILES.delete(target.r2Key);
}

/**
 * 删除对象；失败自动入补偿队列。
 * 返回 true 表示已确认删除（或已入队等待重试）。
 */
export async function deleteObjectSafely(
  env: Env,
  db: ReturnType<typeof getDb>,
  target: DeletionTarget
): Promise<boolean> {
  try {
    await deleteObjectNow(env, db, target);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('STORAGE_GC', '对象删除失败，已加入补偿队列', { r2Key: target.r2Key, bucketId: target.bucketId }, error);
    try {
      await enqueueDeletion(db, target, message);
    } catch (queueError) {
      logger.error('STORAGE_GC', '写入删除补偿队列失败', { r2Key: target.r2Key }, queueError);
    }
    return true;
  }
}

export interface DeletionQueueResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/** 由定时任务调用：重试到期的删除任务 */
export async function processDeletionQueue(env: Env, limit = 50): Promise<DeletionQueueResult> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const result: DeletionQueueResult = { processed: 0, succeeded: 0, failed: 0 };

  const pending = await db
    .select()
    .from(storageDeletionQueue)
    .where(and(isNull(storageDeletionQueue.resolvedAt), lte(storageDeletionQueue.nextRetryAt, now)))
    .limit(limit)
    .all();

  for (const item of pending) {
    result.processed++;

    // 安全护栏：对象仍被任何文件记录引用时不得删除
    const referenced = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.r2Key, item.objectKey))
      .limit(1)
      .get();

    if (referenced) {
      await db
        .update(storageDeletionQueue)
        .set({ resolvedAt: now, lastError: '对象仍被文件记录引用，跳过删除' })
        .where(eq(storageDeletionQueue.id, item.id));
      result.succeeded++;
      continue;
    }

    try {
      await deleteObjectNow(env, db, {
        userId: item.userId,
        bucketId: item.bucketId ?? null,
        parentId: null,
        r2Key: item.objectKey,
      });
      await db.update(storageDeletionQueue).set({ resolvedAt: now }).where(eq(storageDeletionQueue.id, item.id));
      result.succeeded++;
    } catch (error) {
      const attempts = item.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(storageDeletionQueue)
        .set({
          attempts,
          lastError: message,
          nextRetryAt: new Date(Date.now() + (attempts >= MAX_ATTEMPTS ? 7 * 24 * 60 * 60 * 1000 : backoffMs(attempts))).toISOString(),
        })
        .where(eq(storageDeletionQueue.id, item.id));
      result.failed++;
      logger.error('STORAGE_GC', '补偿删除重试失败', { r2Key: item.objectKey, attempts }, error);
    }
  }

  return result;
}
