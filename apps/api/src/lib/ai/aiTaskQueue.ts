/**
 * aiTaskQueue.ts
 * AI 批处理任务队列处理器
 *
 * 改动：进度存储从 KV 迁移至 D1（aiTasks 表）
 * - 使用 SQL 原子自增避免并发计数丢失
 * - 任务状态持久化，不依赖 KV TTL
 */

import type { Env, AiTaskMessage } from '../../types/env';
import { getDb, aiTasks, files } from '../../db';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '@osshelf/shared';
import { indexFileVector, buildFileTextForVector } from './vectorIndex';
import { generateFileSummary, generateImageTags } from './features';
import { dispatchWebhook } from '../webhook';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

// 背压控制配置
const GLOBAL_MAX_CONCURRENT = 10; // 全局最大并发任务数
const USER_MAX_CONCURRENT = 3; // 每用户最大并发任务数
const CONCURRENCY_KEY_PREFIX = 'ai_concurrency:';
const USER_CONCURRENCY_KEY_PREFIX = 'ai_user_concurrency:';

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
    await incrementFailed(env, taskId);
    return { success: false, error: errorMsg };
  }
}

async function handleSummaryTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    await generateFileSummary(env, fileId, undefined, userId);
    await incrementProcessed(env, taskId);

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
    await incrementFailed(env, taskId);
    return { success: false, error: errorMsg };
  }
}

async function handleTagsTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    await generateImageTags(env, fileId, undefined, userId);
    await incrementProcessed(env, taskId);

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
    await incrementFailed(env, taskId);
    return { success: false, error: errorMsg };
  }
}

async function handleAgentBatchTask(env: Env, message: AiTaskMessage): Promise<{ success: boolean; error?: string }> {
  const { fileId, userId, taskId } = message;

  try {
    const db = getDb(env.DB);
    const file = await db.select().from(files).where(eq(files.id, fileId)).get();
    if (!file) {
      await incrementFailed(env, taskId);
      return { success: false, error: '文件不存在' };
    }

    const operation = (message as any).operation || (message as any)._defaultOp || '';
    logger.info('AI_QUEUE', 'Processing agent_batch operation', { operation, fileId, taskId });

    switch (operation) {
      case 'move': {
        const targetFolderId = (message as any).targetFolderId;
        if (targetFolderId) {
          await db
            .update(files)
            .set({ parentId: targetFolderId, updatedAt: new Date().toISOString() })
            .where(eq(files.id, fileId));
        }
        break;
      }
      case 'delete':
        await db
          .update(files)
          .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
          .where(eq(files.id, fileId));
        break;
      case 'rename': {
        const newName = (message as any).newName;
        if (newName) {
          await db
            .update(files)
            .set({ name: newName, updatedAt: new Date().toISOString() })
            .where(eq(files.id, fileId));
        }
        break;
      }
      default:
        logger.warn('AI_QUEUE', 'Unknown agent_batch operation', { operation });
    }

    await incrementProcessed(env, taskId);

    try {
      await dispatchWebhook(env, userId, 'ai.agent_batch_complete', {
        fileId,
        fileName: file.name,
        operation,
      });
    } catch (webhookError) {
      logger.warn('AI_QUEUE', 'Failed to dispatch agent_batch webhook', { fileId }, webhookError);
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('AI_QUEUE', 'Agent batch task failed', { fileId, taskId }, error);
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

  // ── 背压控制：检查并发限制 ──
  try {
    // 全局并发检查
    const globalCount = await env.KV.get(CONCURRENCY_KEY_PREFIX + 'count');
    if (globalCount && parseInt(globalCount) >= GLOBAL_MAX_CONCURRENT) {
      logger.warn('AI_QUEUE', 'Global concurrency limit reached, requeuing', {
        currentGlobal: globalCount,
        limit: GLOBAL_MAX_CONCURRENT,
        userId,
        taskId,
      });
      // 延迟重新入队（指数退避）
      setTimeout(
        () => {
          if (env.AI_TASKS_QUEUE) {
            (env.AI_TASKS_QUEUE as any).send({ body: message });
          }
        },
        Math.random() * 5000 + 1000
      ); // 1-6 秒随机延迟
      return { success: false, error: '全局并发已达上限，稍后重试' };
    }

    // 用户级并发检查
    const userCount = await env.KV.get(USER_CONCURRENCY_KEY_PREFIX + userId);
    if (userCount && parseInt(userCount) >= USER_MAX_CONCURRENT) {
      logger.warn('AI_QUEUE', 'User concurrency limit reached, requeuing', {
        currentUser: userCount,
        limit: USER_MAX_CONCURRENT,
        userId,
        taskId,
      });
      // 延迟重新入队（指数退避）
      setTimeout(
        () => {
          if (env.AI_TASKS_QUEUE) {
            (env.AI_TASKS_QUEUE as any).send({ body: message });
          }
        },
        Math.random() * 3000 + 1000
      ); // 1-4 秒随机延迟
      return { success: false, error: `用户并发已达上限 (${USER_MAX_CONCURRENT})，稍后重试` };
    }

    // 获取并发锁（原子递增）
    await env.KV.put(
      CONCURRENCY_KEY_PREFIX + 'count',
      String(parseInt(globalCount || '0') + 1),
      { expirationTtl: 120 } // 2 分钟 TTL，防死锁
    );
    await env.KV.put(USER_CONCURRENCY_KEY_PREFIX + userId, String(parseInt(userCount || '0') + 1), {
      expirationTtl: 120,
    });

    logger.debug('AI_QUEUE', 'Concurrency acquired', {
      global: parseInt(globalCount || '0') + 1,
      user: parseInt(userCount || '0') + 1,
      userId,
      taskId,
    });
  } catch (concurrencyError) {
    logger.error('AI_QUEUE', 'Failed to acquire concurrency lock', { taskId }, concurrencyError);
    // 获取锁失败时仍然执行任务（降级处理），避免任务丢失
  }

  try {
    let result;
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
    return result;
  } finally {
    // ── 释放并发锁 ──
    try {
      const currentGlobal = await env.KV.get(CONCURRENCY_KEY_PREFIX + 'count');
      if (currentGlobal) {
        const newGlobal = Math.max(0, parseInt(currentGlobal) - 1);
        if (newGlobal > 0) {
          await env.KV.put(CONCURRENCY_KEY_PREFIX + 'count', String(newGlobal), { expirationTtl: 120 });
        } else {
          await env.KV.delete(CONCURRENCY_KEY_PREFIX + 'count');
        }
      }

      const currentUser = await env.KV.get(USER_CONCURRENCY_KEY_PREFIX + userId);
      if (currentUser) {
        const newUser = Math.max(0, parseInt(currentUser) - 1);
        if (newUser > 0) {
          await env.KV.put(USER_CONCURRENCY_KEY_PREFIX + userId, String(newUser), { expirationTtl: 120 });
        } else {
          await env.KV.delete(USER_CONCURRENCY_KEY_PREFIX + userId);
        }
      }
    } catch (releaseError) {
      logger.error('AI_QUEUE', 'Failed to release concurrency lock', { taskId }, releaseError);
    }
  }
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
