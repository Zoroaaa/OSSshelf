/**
 * ai/orphanCleanup.ts
 * AI 相关孤儿数据清理（Cron 每日执行）
 *
 * 为什么需要：
 * - file_chunks / ai_task_items / ai_task_* / ai_memories 都没有外键（D1 无法级联），
 *   删会话、硬删文件后必然留下孤儿；长期累积会膨胀 D1 并让向量检索命中已删除文件。
 * - 请求链路只做单条删除，全表反连接扫描必须放 Cron，且要分批避免超时/参数上限。
 */

import { inArray } from 'drizzle-orm';
import type { Env } from '../../types/env';
import { getDb, fileChunks } from '../../db';
import { logger } from '@osshelf/shared';
import { deleteFileVectors } from './vectorIndex';

export interface AiOrphanCleanupResult {
  orphanChunkFiles: number;
  orphanChunkRows: number;
  orphanTaskItems: number;
  orphanTaskSteps: number;
  orphanTaskEvents: number;
  orphanTaskRuns: number;
  orphanMemories: number;
}

/** 每次 Cron 每个类别最多处理的批次数，避免单次执行超时 */
const MAX_BATCHES = 10;
const BATCH_SIZE = 100;

async function runDelete(env: Env, sql: string): Promise<number> {
  const result = await env.DB.prepare(sql).run();
  return Number(result.meta?.changes ?? 0);
}

async function drain(
  env: Env,
  sql: string,
  onDeleted?: (changes: number) => void
): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const changes = await runDelete(env, sql);
    if (changes === 0) break;
    total += changes;
    onDeleted?.(changes);
  }
  return total;
}

async function cleanupOrphanChunks(env: Env, result: AiOrphanCleanupResult): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT file_id FROM file_chunks
     WHERE NOT EXISTS (SELECT 1 FROM files WHERE files.id = file_chunks.file_id)
     LIMIT ?`
  )
    .bind(BATCH_SIZE)
    .all<{ file_id: string }>();

  const ids = (rows.results ?? []).map((row) => row.file_id);
  if (ids.length === 0) return;

  result.orphanChunkFiles += ids.length;

  // 先尽力删向量（无 VECTORIZE 绑定时内部直接返回），再由 SQL 兜底删分块行
  try {
    await deleteFileVectors(env, ids);
  } catch (error) {
    logger.warn('AI_ORPHAN', 'Failed to delete orphan vectors', { count: ids.length }, error);
  }

  // deleteFileVectors 在无 Vectorize 时不会删 chunk，这里统一兜底
  await getDb(env.DB).delete(fileChunks).where(inArray(fileChunks.fileId, ids));
  result.orphanChunkRows += ids.length;
}

export async function runAiOrphanCleanup(env: Env): Promise<AiOrphanCleanupResult> {
  const result: AiOrphanCleanupResult = {
    orphanChunkFiles: 0,
    orphanChunkRows: 0,
    orphanTaskItems: 0,
    orphanTaskSteps: 0,
    orphanTaskEvents: 0,
    orphanTaskRuns: 0,
    orphanMemories: 0,
  };

  try {
    await cleanupOrphanChunks(env, result);
  } catch (error) {
    logger.error('AI_ORPHAN', 'Chunk cleanup failed', {}, error);
  }

  try {
    result.orphanTaskItems = await drain(
      env,
      `DELETE FROM ai_task_items
       WHERE id IN (
         SELECT ti.id FROM ai_task_items ti
         WHERE NOT EXISTS (SELECT 1 FROM ai_tasks t WHERE t.id = ti.task_id)
         LIMIT ${BATCH_SIZE}
       )`
    );
  } catch (error) {
    logger.error('AI_ORPHAN', 'Task item cleanup failed', {}, error);
  }

  try {
    result.orphanTaskSteps = await drain(
      env,
      `DELETE FROM ai_task_steps
       WHERE id IN (
         SELECT s.id FROM ai_task_steps s
         WHERE NOT EXISTS (SELECT 1 FROM ai_task_runs r WHERE r.id = s.run_id)
            OR s.run_id IN (
              SELECT orphan.id FROM ai_task_runs orphan
              LEFT JOIN ai_chat_sessions cs ON cs.id = orphan.session_id
              WHERE cs.id IS NULL
            )
         LIMIT ${BATCH_SIZE}
       )`
    );
    result.orphanTaskEvents = await drain(
      env,
      `DELETE FROM ai_task_events
       WHERE id IN (
         SELECT e.id FROM ai_task_events e
         WHERE NOT EXISTS (SELECT 1 FROM ai_task_runs r WHERE r.id = e.run_id)
            OR e.run_id IN (
              SELECT orphan.id FROM ai_task_runs orphan
              LEFT JOIN ai_chat_sessions cs ON cs.id = orphan.session_id
              WHERE cs.id IS NULL
            )
         LIMIT ${BATCH_SIZE}
       )`
    );
  } catch (error) {
    logger.error('AI_ORPHAN', 'Task step/event cleanup failed', {}, error);
  }

  try {
    result.orphanTaskRuns = await drain(
      env,
      `DELETE FROM ai_task_runs
       WHERE id IN (
         SELECT r.id FROM ai_task_runs r
         WHERE NOT EXISTS (SELECT 1 FROM ai_chat_sessions s WHERE s.id = r.session_id)
         LIMIT ${BATCH_SIZE}
       )`
    );
  } catch (error) {
    logger.error('AI_ORPHAN', 'Task run cleanup failed', {}, error);
  }

  try {
    result.orphanMemories = await drain(
      env,
      `DELETE FROM ai_memories
       WHERE id IN (
         SELECT m.id FROM ai_memories m
         WHERE NOT EXISTS (SELECT 1 FROM ai_chat_sessions s WHERE s.id = m.session_id)
         LIMIT ${BATCH_SIZE}
       )`
    );
  } catch (error) {
    logger.error('AI_ORPHAN', 'Memory cleanup failed', {}, error);
  }

  return result;
}
