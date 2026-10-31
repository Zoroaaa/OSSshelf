/**
 * aiTaskQueue.ts
 * AI 批处理任务队列处理器
 *
 * 改动：进度存储从 KV 迁移至 D1（aiTasks 表）
 * - 使用 SQL 原子自增避免并发计数丢失
 * - 任务状态持久化，不依赖 KV TTL
 */

import type { Env, AiTaskMessage } from '../../types/env';
import { getDb, aiTasks, aiTaskItems, files } from '../../db';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '@osshelf/shared';
import { indexFileVector, buildFileTextForVector } from './vectorIndex';
import { generateFileSummary, generateImageTags } from './features';
import { syncFileFts } from './retrieval/fts';
import { moveFile, softDeleteFile, renameFile } from '../fileService';
import { dispatchWebhook } from '../webhook';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

// 背压控制：并发由 wrangler [[queues.consumers]] max_concurrency 统一控制，
// 不再使用 KV 读改写锁（非原子、会产生竞态）。

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
  type: 'index' | 'summary' | 'tags' | 'agent_batch',
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

// ─── 原子进度重算（关键：以任务项状态为准，避免重试重复计数）───────────────

const STALE_TASK_MS = 30 * 60_000;

/**
 * 用 ai_task_items 的真实状态回写任务进度。
 *
 * 早期实现是"每处理一条 +1"，但队列失败会 message.retry()，同一文件重试时
 * 计数会重复增长，导致任务提前完成或失败数超过总数。改为每次收尾后重算，
 * 让 processed/failed 恒等于任务项的真实分布。
 */
export async function recomputeTaskProgress(env: Env, taskId: string): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  await db.run(sql`
    UPDATE ai_tasks
    SET processed = (SELECT count(*) FROM ai_task_items WHERE task_id = ${taskId} AND status = 'completed'),
        failed = (SELECT count(*) FROM ai_task_items WHERE task_id = ${taskId} AND status = 'failed'),
        updated_at = ${now}
    WHERE id = ${taskId}
  `);
  await checkAndCompleteTask(env, taskId);
}

/** 入队失败 / 不可恢复时把任务落为 failed，避免永久占位 */
export async function markTaskFailed(env: Env, taskId: string, error: string): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  await db
    .update(aiTasks)
    .set({ status: 'failed', error, completedAt: now, updatedAt: now })
    .where(and(eq(aiTasks.id, taskId), eq(aiTasks.status, 'running')));
}

/**
 * 回收停滞任务：running 且 30 分钟未更新。
 * 典型场景：队列消费者未部署、消息被丢弃、Worker 异常退出。
 */
export async function recoverStaleTasks(env: Env, userId: string): Promise<number> {
  const db = getDb(env.DB);
  const cutoff = new Date(Date.now() - STALE_TASK_MS).toISOString();
  const now = new Date().toISOString();

  const result = await db.run(sql`
    UPDATE ai_tasks
    SET status = 'failed',
        completed_at = ${now},
        updated_at = ${now},
        error = '任务停滞超过30分钟，已自动回收，可重新启动'
    WHERE user_id = ${userId} AND status = 'running' AND updated_at < ${cutoff}
  `);

  const changes = Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  if (changes > 0) {
    logger.warn('AI_QUEUE', 'Recovered stale tasks', { userId, count: changes });
  }
  return changes;
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
      return { success: false, error: '文件内容为空' };
    }

    await indexFileVector(env, fileId, text);
    await syncFileFts(env, fileId);

    try {
      const db = getDb(env.DB);
      const file = await db.select().from(files).where(eq(files.id, fileId)).get();
      if (file) {
        await dispatchWebhook(env, userId, 'ai.index_complete', {
          fileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType,
        });
      }
    } catch (webhookError) {
      logger.warn('AI_QUEUE', 'Failed to dispatch index webhook', { fileId }, webhookError);
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('AI_QUEUE', 'Index task failed', { fileId, taskId }, error);
    return { success: false, error: errorMsg };
  }
}

async function handleSummaryTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    await generateFileSummary(env, fileId, undefined, userId);
    await syncFileFts(env, fileId);

    try {
      const db = getDb(env.DB);
      const file = await db.select().from(files).where(eq(files.id, fileId)).get();
      if (file) {
        await dispatchWebhook(env, userId, 'ai.summary_complete', {
          fileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType,
          summary: file.aiSummary || null,
        });
      }
    } catch (webhookError) {
      logger.warn('AI_QUEUE', 'Failed to dispatch summary webhook', { fileId }, webhookError);
    }

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
    return { success: false, error: errorMsg };
  }
}

async function handleTagsTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    await generateImageTags(env, fileId, undefined, userId);
    await syncFileFts(env, fileId);

    try {
      const db = getDb(env.DB);
      const file = await db.select().from(files).where(eq(files.id, fileId)).get();
      if (file && file.aiTags) {
        let tagsData;
        try {
          tagsData = JSON.parse(file.aiTags);
        } catch {
          tagsData = [];
        }
        await dispatchWebhook(env, userId, 'ai.tags_generated', {
          fileId: file.id,
          fileName: file.name,
          tags: Array.isArray(tagsData) ? tagsData.map((t: any) => t.tag || t) : [],
        });
      }
    } catch (webhookError) {
      logger.warn('AI_QUEUE', 'Failed to dispatch tags webhook', { fileId }, webhookError);
    }

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
    return { success: false, error: errorMsg };
  }
}

async function handleAgentBatchTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    const operation = (message as any).operation || '';
    logger.info('AI_QUEUE', 'Processing agent_batch operation', { operation, fileId, taskId });

    let result: { success: boolean; error?: string };
    switch (operation) {
      case 'move':
        result = await moveFile(env, userId, fileId, {
          targetParentId: ((message as any).targetFolderId as string | null) ?? null,
        });
        break;
      case 'delete':
        result = await softDeleteFile(env, userId, fileId);
        break;
      case 'rename': {
        const newName = (message as any).newName;
        result = newName
          ? await renameFile(env, userId, fileId, { name: newName })
          : { success: false, error: '缺少新名称' };
        break;
      }
      default:
        result = { success: false, error: `未知操作: ${operation}` };
    }

    if (!result.success) {
      return { success: false, error: result.error };
    }

    try {
      await dispatchWebhook(env, userId, 'ai.agent_batch_complete', {
        fileId,
        operation,
      });
    } catch (webhookError) {
      logger.warn('AI_QUEUE', 'Failed to dispatch agent_batch webhook', { fileId }, webhookError);
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('AI_QUEUE', 'Agent batch task failed', { fileId, taskId }, error);
    return { success: false, error: errorMsg };
  }
}

// ─── 任务项（幂等 / 真续跑）───────────────────────────────────────────────

export async function getTaskItem(
  env: Env,
  taskId: string,
  fileId: string
): Promise<typeof aiTaskItems.$inferSelect | null> {
  const db = getDb(env.DB);
  return (
    (await db
      .select()
      .from(aiTaskItems)
      .where(and(eq(aiTaskItems.taskId, taskId), eq(aiTaskItems.fileId, fileId)))
      .get()) ?? null
  );
}

async function ensureTaskItems(env: Env, taskId: string, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  const now = new Date().toISOString();
  const db = getDb(env.DB);

  const rows = fileIds.map((fileId) => ({
    id: crypto.randomUUID(),
    taskId,
    fileId,
    status: 'pending',
    attempts: 0,
    updatedAt: now,
  }));

  // D1 单条 SQL 绑定参数上限 100：ai_task_items 每行 6 个参数，必须分批插入
  const maxRowsPerInsert = Math.floor(100 / Object.keys(rows[0]).length);
  for (let i = 0; i < rows.length; i += maxRowsPerInsert) {
    await db
      .insert(aiTaskItems)
      .values(rows.slice(i, i + maxRowsPerInsert))
      .onConflictDoNothing();
  }
}

async function markTaskItemRunning(env: Env, taskId: string, fileId: string): Promise<void> {
  const db = getDb(env.DB);
  await db
    .update(aiTaskItems)
    .set({
      status: 'running',
      attempts: sql`attempts + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(aiTaskItems.taskId, taskId), eq(aiTaskItems.fileId, fileId)));
}

async function finalizeTaskItem(
  env: Env,
  taskId: string,
  fileId: string,
  status: 'completed' | 'failed',
  error?: string
): Promise<void> {
  const db = getDb(env.DB);
  await db
    .update(aiTaskItems)
    .set({ status, error: error ?? null, updatedAt: new Date().toISOString() })
    .where(and(eq(aiTaskItems.taskId, taskId), eq(aiTaskItems.fileId, fileId)));
}

export async function processAiTaskMessage(
  message: AiTaskMessage,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  const { type, fileId, taskId } = message;

  logger.info('AI_QUEUE', 'Processing task', { type, fileId, taskId });

  // 检查任务是否存在且未被取消
  const task = await getTaskRecord(env, taskId);

  if (!task) {
    logger.warn('AI_QUEUE', 'Task not found in DB, skipping', { type, taskId });
    return { success: false, error: '任务不存在' };
  }

  // 已取消的任务直接 ack：返回 success 让队列不再重试，避免占住队列与重试额度
  if (task.status === 'cancelled') {
    logger.info('AI_QUEUE', 'Task cancelled, skipping', { type, taskId });
    return { success: true };
  }

  // ── 幂等：同一任务下同一文件已成功处理则直接确认 ──
  const item = await getTaskItem(env, taskId, fileId);
  if (item?.status === 'completed') {
    logger.info('AI_QUEUE', 'Task item already completed, skipping', { taskId, fileId });
    return { success: true };
  }

  // 兜底：自动处理等路径可能没走 enqueueAiTasks，缺少任务项时补建，保证进度可回写
  if (!item) {
    await ensureTaskItems(env, taskId, [fileId]);
  }

  await markTaskItemRunning(env, taskId, fileId);

  let result: { success: boolean; error?: string };
  switch (type) {
    case 'index':
      result = await handleIndexTask(env, message);
      break;
    case 'summary':
      result = await handleSummaryTask(env, message);
      break;
    case 'tags':
      result = await handleTagsTask(env, message);
      break;
    case 'agent_batch':
      result = await handleAgentBatchTask(env, message);
      break;
    default:
      result = { success: false, error: `未知任务类型: ${type}` };
  }

  await finalizeTaskItem(env, taskId, fileId, result.success ? 'completed' : 'failed', result.error);
  await recomputeTaskProgress(env, taskId);
  return result;
}

// ─── 入队 ─────────────────────────────────────────────────────────────────

export async function enqueueAiTasks(
  env: Env,
  type: 'index' | 'summary' | 'tags' | 'agent_batch',
  fileIds: string[],
  userId: string,
  taskId: string,
  resumeFrom?: string,
  operation?: string,
  operationArgs?: Record<string, unknown>
): Promise<void> {
  if (!env.AI_TASKS_QUEUE) {
    throw new Error('AI 任务队列未配置');
  }

  const BATCH_SIZE = 50;

  // ── 断点续传：检查是否有未完成的历史任务 ──
  if (resumeFrom) {
    // 从指定的历史任务恢复
    const previousTask = await getTaskRecord(env, resumeFrom);
    if (previousTask && (previousTask.status === 'running' || previousTask.status === 'failed')) {
      logger.info('AI_QUEUE', 'Resuming from previous task', {
        resumeTaskId: resumeFrom,
        processed: previousTask.processed,
        failed: previousTask.failed,
      });

      // 查询该任务已处理的文件（通过审计日志或任务记录推断）
      // 这里简化处理：标记新任务为恢复模式，前端可以显示进度
      await updateTaskResumeInfo(env, taskId, resumeFrom, previousTask.processed);
    }
  } else {
    // 检查同用户同类型的 running/failed 任务，自动续传
    const existingTask = await getLatestTaskByUserType(env, userId, type);
    if (existingTask && (existingTask.status === 'running' || existingTask.status === 'failed')) {
      if (existingTask.processed > 0) {
        logger.info('AI_QUEUE', 'Found incomplete task, will skip processed files', {
          existingTaskId: existingTask.id,
          processed: existingTask.processed,
          total: existingTask.total,
        });
        // 标记为续传模式
        await updateTaskResumeInfo(env, taskId, existingTask.id, existingTask.processed);

        // 注意：实际跳过已处理文件的逻辑需要在 handleXxxTask 中实现
        // 这里先记录元数据，避免重复索引
      }
    }
  }

  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE).map((fileId) => {
      const baseMessage: any = { type, fileId, userId, taskId, isResumable: true };
      if (type === 'agent_batch' && operation) {
        baseMessage.operation = operation;
        if (operationArgs) Object.assign(baseMessage, operationArgs);
      }
      return { body: baseMessage as AiTaskMessage };
    });

    await ensureTaskItems(
      env,
      taskId,
      batch.map((message) => message.body.fileId)
    );

    try {
      await env.AI_TASKS_QUEUE.sendBatch(batch);
    } catch (error) {
      // 入队失败：任务不能停留在 running，否则会永久封锁后续批量任务
      const message = error instanceof Error ? error.message : String(error);
      await markTaskFailed(env, taskId, `任务入队失败：${message}`);
      throw error;
    }
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

/**
 * 更新任务的断点续传信息
 */
async function updateTaskResumeInfo(
  env: Env,
  newTaskId: string,
  previousTaskId: string,
  alreadyProcessed: number
): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();

  // 在任务记录中存储续传元数据（使用 error 字段或扩展字段）
  try {
    await db.run(sql`
      UPDATE ai_tasks
      SET error = ${JSON.stringify({ resumedFrom: previousTaskId, alreadyProcessed })},
          updated_at = ${now}
      WHERE id = ${newTaskId}
    `);
    logger.info('AI_QUEUE', 'Updated resume info for task', { newTaskId, previousTaskId, alreadyProcessed });
  } catch (error) {
    logger.error('AI_QUEUE', 'Failed to update resume info', { newTaskId }, error);
  }
}

export async function enqueueAgentBatchOperation(
  env: Env,
  operation: 'move' | 'delete' | 'rename',
  fileIds: string[],
  userId: string,
  operationArgs?: Record<string, unknown>
): Promise<{ taskId: string; total: number; estimatedMinutes: number }> {
  const task = await createTaskRecord(env, 'agent_batch', userId, fileIds.length);

  await enqueueAiTasks(env, 'agent_batch', fileIds, userId, task.id, undefined, operation, operationArgs);

  const estimatedMinutes = Math.ceil(fileIds.length / 30);

  logger.info('AI_QUEUE', 'Agent batch task created', {
    taskId: task.id,
    operation,
    totalFiles: fileIds.length,
    estimatedMinutes,
  });

  return {
    taskId: task.id,
    total: fileIds.length,
    estimatedMinutes,
  };
}
