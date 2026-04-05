/**
 * aiTaskQueue.ts
 * AI 批处理任务队列处理器
 *
 * 改动：进度存储从 KV 迁移至 D1（aiTasks 表）
 * - 使用 SQL 原子自增避免并发计数丢失
 * - 任务状态持久化，不依赖 KV TTL
 */

import type { Env, AiTaskMessage } from '../types/env';
import { getDb, aiTasks } from '../db';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '@osshelf/shared';
import { indexFileVector, buildFileTextForVector } from './vectorIndex';
import { generateFileSummary, generateImageTags } from './ai/features';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskProgress {
  id: string;
  userId: string;
  type: string;
  status: TaskStatus;
  total: number;
  processed: number;
  failed: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
  error?: string | null;
}

// ─── 读取任务 ──────────────────────────────────────────────────────────────

export async function getTaskRecord(env: Env, taskId: string): Promise<TaskProgress | null> {
  const db = getDb(env.DB);
  const row = await db.select().from(aiTasks).where(eq(aiTasks.id, taskId)).get();
  if (!row) return null;
  return row as TaskProgress;
}

export async function getLatestTaskByUserType(env: Env, userId: string, type: string): Promise<TaskProgress | null> {
  const db = getDb(env.DB);
  const normalizedType = type === 'summary' ? 'summarize' : type;
  const row = await db
    .select()
    .from(aiTasks)
    .where(and(eq(aiTasks.userId, userId), eq(aiTasks.type, normalizedType)))
    .orderBy(sql`${aiTasks.startedAt} DESC`)
    .limit(1)
    .get();
  if (!row) return null;
  return row as TaskProgress;
}

// ─── 创建任务 ──────────────────────────────────────────────────────────────

export async function createTaskRecord(
  env: Env,
  type: 'index' | 'summary' | 'tags',
  userId: string,
  total: number
): Promise<TaskProgress> {
  const db = getDb(env.DB);
  const normalizedType = type === 'summary' ? 'summarize' : type;
  const now = new Date().toISOString();

  const task: TaskProgress = {
    id: crypto.randomUUID(),
    userId,
    type: normalizedType,
    status: 'running',
    total,
    processed: 0,
    failed: 0,
    startedAt: now,
    updatedAt: now,
  };

  await db.insert(aiTasks).values(task);
  return task;
}

// ─── 取消任务 ──────────────────────────────────────────────────────────────

export async function cancelTask(env: Env, userId: string, type: string): Promise<TaskProgress | null> {
  const db = getDb(env.DB);
  const normalizedType = type === 'summary' ? 'summarize' : type;
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(aiTasks)
    .where(and(eq(aiTasks.userId, userId), eq(aiTasks.type, normalizedType), eq(aiTasks.status, 'running')))
    .orderBy(sql`${aiTasks.startedAt} DESC`)
    .limit(1)
    .get();

  if (!existing) return null;

  await db
    .update(aiTasks)
    .set({ status: 'cancelled', completedAt: now, updatedAt: now, error: '用户手动取消' })
    .where(eq(aiTasks.id, existing.id));

  return { ...existing, status: 'cancelled', completedAt: now, updatedAt: now, error: '用户手动取消' };
}

// ─── 原子自增进度（关键：避免并发计数丢失）─────────────────────────────────

async function incrementProcessed(env: Env, taskId: string): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  await db.run(sql`UPDATE ai_tasks SET processed = processed + 1, updated_at = ${now} WHERE id = ${taskId}`);
  await checkAndCompleteTask(env, taskId);
}

async function incrementFailed(env: Env, taskId: string): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  await db.run(sql`UPDATE ai_tasks SET failed = failed + 1, updated_at = ${now} WHERE id = ${taskId}`);
  await checkAndCompleteTask(env, taskId);
}

export async function checkAndCompleteTask(env: Env, taskId: string): Promise<boolean> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();

  // 原子：只有当 processed + failed >= total 时才更新为 completed
  const result = await db.run(
    sql`UPDATE ai_tasks
        SET status = 'completed', completed_at = ${now}, updated_at = ${now}
        WHERE id = ${taskId}
          AND status = 'running'
          AND (processed + failed) >= total`
  );

  if ((result as any).meta?.changes > 0) {
    logger.info('AI_QUEUE', 'Task auto-completed', { taskId });
    return true;
  }
  return false;
}

// ─── 任务处理器 ────────────────────────────────────────────────────────────

async function handleIndexTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    const text = await buildFileTextForVector(env, fileId);
    if (!text || text.trim().length === 0) {
      await incrementFailed(env, taskId);
      return { success: false, error: '文件内容为空' };
    }

    await indexFileVector(env, fileId, text);
    await incrementProcessed(env, taskId);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('AI_QUEUE', 'Index task failed', { fileId, taskId }, error);
    await incrementFailed(env, taskId);
    return { success: false, error: errorMsg };
  }
}

async function handleSummaryTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    await generateFileSummary(env, fileId, undefined, userId);
    await incrementProcessed(env, taskId);

    // 上传自动处理：summary 完成后触发向量索引（确保 aiSummary 已写入）
    if (message.triggerIndexOnComplete && env.VECTORIZE) {
      try {
        const text = await buildFileTextForVector(env, fileId);
        if (text && text.trim().length > 0) {
          await indexFileVector(env, fileId, text);
          logger.info('AI_QUEUE', 'Auto index after summary', { fileId });
        }
      } catch (indexErr) {
        logger.error('AI_QUEUE', 'Auto index after summary failed', { fileId }, indexErr);
      }
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('AI_QUEUE', 'Summary task failed', { fileId, taskId }, error);
    await incrementFailed(env, taskId);
    return { success: false, error: errorMsg };
  }
}

async function handleTagsTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    await generateImageTags(env, fileId, undefined, userId);
    await incrementProcessed(env, taskId);

    // 上传自动处理：tags 完成后触发向量索引（确保 aiSummary/caption 已写入）
    if (message.triggerIndexOnComplete && env.VECTORIZE) {
      try {
        const text = await buildFileTextForVector(env, fileId);
        if (text && text.trim().length > 0) {
          await indexFileVector(env, fileId, text);
          logger.info('AI_QUEUE', 'Auto index after tags', { fileId });
        }
      } catch (indexErr) {
        logger.error('AI_QUEUE', 'Auto index after tags failed', { fileId }, indexErr);
      }
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('AI_QUEUE', 'Tags task failed', { fileId, taskId }, error);
    await incrementFailed(env, taskId);
    return { success: false, error: errorMsg };
  }
}

export async function processAiTaskMessage(
  message: AiTaskMessage,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  const { type, fileId, userId, taskId } = message;

  logger.info('AI_QUEUE', 'Processing task', { type, fileId, taskId });

  // 检查任务是否存在且未被取消
  const task = await getTaskRecord(env, taskId);

  if (!task) {
    logger.warn('AI_QUEUE', 'Task not found in DB, skipping', { type, taskId });
    return { success: false, error: '任务不存在' };
  }

  if (task.status === 'cancelled') {
    logger.info('AI_QUEUE', 'Task cancelled, skipping', { type, taskId });
    return { success: false, error: '任务已取消' };
  }

  switch (type) {
    case 'index':
      return handleIndexTask(env, message);
    case 'summary':
      return handleSummaryTask(env, message);
    case 'tags':
      return handleTagsTask(env, message);
    default:
      return { success: false, error: `未知任务类型: ${type}` };
  }
}

// ─── 入队 ─────────────────────────────────────────────────────────────────

export async function enqueueAiTasks(
  env: Env,
  type: 'index' | 'summary' | 'tags',
  fileIds: string[],
  userId: string,
  taskId: string
): Promise<void> {
  if (!env.AI_TASKS_QUEUE) {
    throw new Error('AI 任务队列未配置');
  }

  const BATCH_SIZE = 50;

  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE).map((fileId) => ({
      body: { type, fileId, userId, taskId } as AiTaskMessage,
    }));

    await env.AI_TASKS_QUEUE.sendBatch(batch);
    logger.info('AI_QUEUE', 'Enqueued batch', {
      type,
      batch: Math.floor(i / BATCH_SIZE) + 1,
      totalBatches: Math.ceil(fileIds.length / BATCH_SIZE),
      batchSize: batch.length,
      taskId,
    });
  }

  logger.info('AI_QUEUE', 'All tasks enqueued', { type, totalFiles: fileIds.length, taskId });
}
