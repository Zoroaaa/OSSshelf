/**
 * ingestAssets.ts — 上传资产解析登记（IngestPolicy）
 *
 * 一次登记、按步骤（向量索引/摘要/标签）各自排队，失败步骤可单独重试。
 * 状态不靠队列回调维护：每次读取按 ai_tasks 的实际状态重算并回写，
 * 这样 Worker 回收、队列积压或手动取消后不会永远停在 processing。
 *
 * 已知边界：OCR 与页码锚点尚未实现，policy.ocr 只作为声明记录，响应里明确 ocrSupported=false。
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Env } from '../../types/env';
import { getDb } from '../../db';
import { aiIngestAssets, aiTasks, files } from '../../db/schema';
import { throwAppError } from '../../middleware/error';
import { logger } from '@osshelf/shared';
import { AI_INGEST_DEFAULTS, getAiConfigNumber } from './aiConfigService';
import { createTaskRecord, enqueueAiTasks } from './aiTaskQueue';

export type IngestStep = 'index' | 'summary' | 'tags';
export type IngestStatus = 'pending' | 'processing' | 'ready' | 'partial' | 'failed';

export interface IngestPolicy {
  steps: IngestStep[];
  /** 需要 OCR 的调用方先记录意图；当前实现不提供 OCR，响应里会标注 ocrSupported=false */
  ocr: boolean;
}

export interface IngestAssetStep {
  step: IngestStep;
  taskId: string;
  status: string;
  error?: string | null;
}

export interface IngestAssetView {
  fileId: string;
  status: IngestStatus;
  policy: IngestPolicy;
  steps: IngestAssetStep[];
  attempts: number;
  ocrSupported: false;
  error?: string | null;
  updatedAt: string;
}

const VALID_STEPS: readonly IngestStep[] = ['index', 'summary', 'tags'];
const DEFAULT_INGEST_STEP: IngestStep = 'index';
const STEP_TASK_TYPE: Record<IngestStep, 'index' | 'summary' | 'tags'> = {
  index: 'index',
  summary: 'summary',
  tags: 'tags',
};

interface StoredStep {
  step: IngestStep;
  taskId: string;
}

export function normalizeIngestPolicy(raw: unknown): IngestPolicy {
  const source = (raw ?? {}) as { steps?: unknown; ocr?: unknown };
  const requested = Array.isArray(source.steps)
    ? source.steps.filter((step): step is IngestStep => VALID_STEPS.includes(step as IngestStep))
    : [];
  const steps: IngestStep[] =
    requested.length > 0 ? Array.from(new Set<IngestStep>(requested)) : [DEFAULT_INGEST_STEP];
  return { steps, ocr: source.ocr === true };
}

function parseStoredSteps(raw: string | null): StoredStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredStep =>
        typeof item === 'object' &&
        item !== null &&
        VALID_STEPS.includes((item as StoredStep).step) &&
        typeof (item as StoredStep).taskId === 'string'
    );
  } catch {
    return [];
  }
}

function deriveStatus(steps: IngestAssetStep[]): IngestStatus {
  if (steps.length === 0) return 'pending';
  if (steps.some((step) => step.status === 'running' || step.status === 'pending')) return 'processing';
  const completed = steps.filter((step) => step.status === 'completed').length;
  if (completed === steps.length) return 'ready';
  if (completed > 0) return 'partial';
  return 'failed';
}

async function assertOwnedFile(env: Env, userId: string, fileId: string) {
  const db = getDb(env.DB);
  const file = await db
    .select({ id: files.id, name: files.name, size: files.size, isFolder: files.isFolder })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND', '文件不存在');
  if (file.isFolder) throwAppError('AI_NOT_SUPPORTED_FOR_FILE', '文件夹不支持解析');
  return file;
}

async function enqueueSteps(env: Env, userId: string, fileId: string, steps: IngestStep[]): Promise<StoredStep[]> {
  if (!env.AI_TASKS_QUEUE) {
    throwAppError('AI_SERVICE_UNAVAILABLE', 'AI 任务队列未配置，无法解析文件');
  }
  const stored: StoredStep[] = [];
  for (const step of steps) {
    const task = await createTaskRecord(env, STEP_TASK_TYPE[step], userId, 1);
    await enqueueAiTasks(env, STEP_TASK_TYPE[step], [fileId], userId, task.id);
    stored.push({ step, taskId: task.id });
  }
  return stored;
}

async function buildView(env: Env, assetRow: typeof aiIngestAssets.$inferSelect): Promise<IngestAssetView> {
  const db = getDb(env.DB);
  const stored = parseStoredSteps(assetRow.taskIds);
  const policy = normalizeIngestPolicy(JSON.parse(assetRow.policy || '{}'));

  let steps: IngestAssetStep[] = stored.map((item) => ({ step: item.step, taskId: item.taskId, status: 'pending' }));
  if (stored.length > 0) {
    const rows = await db
      .select({ id: aiTasks.id, status: aiTasks.status, error: aiTasks.error })
      .from(aiTasks)
      .where(inArray(aiTasks.id, stored.map((item) => item.taskId)))
      .all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    steps = stored.map((item) => {
      const row = byId.get(item.taskId);
      return {
        step: item.step,
        taskId: item.taskId,
        status: row?.status ?? 'pending',
        error: row?.error ?? null,
      };
    });
  }

  const status = deriveStatus(steps);
  if (status !== assetRow.status) {
    await db
      .update(aiIngestAssets)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(aiIngestAssets.id, assetRow.id));
  }

  return {
    fileId: assetRow.fileId,
    status,
    policy,
    steps,
    attempts: assetRow.attempts,
    ocrSupported: false,
    error: assetRow.error,
    updatedAt: assetRow.updatedAt,
  };
}

/** 登记（或复用）某个文件的解析资产；已 ready 且步骤未变时直接返回，不重复烧额度 */
export async function registerIngestAsset(
  env: Env,
  userId: string,
  fileId: string,
  rawPolicy: unknown
): Promise<IngestAssetView> {
  const policy = normalizeIngestPolicy(rawPolicy);
  const file = await assertOwnedFile(env, userId, fileId);

  const maxFileBytes = await getAiConfigNumber(env, 'ai.ingest.max_file_bytes', AI_INGEST_DEFAULTS.maxFileBytes);
  if (file.size > maxFileBytes) {
    throwAppError('AI_FILE_TOO_LARGE', `文件超过解析上限（${Math.round(maxFileBytes / 1024 / 1024)}MB）`);
  }

  const db = getDb(env.DB);
  const existing = await db.select().from(aiIngestAssets).where(eq(aiIngestAssets.fileId, fileId)).get();
  const now = new Date().toISOString();

  if (existing) {
    const existingSteps = parseStoredSteps(existing.taskIds);
    const covered = new Set(existingSteps.map((item) => item.step));
    const missing = policy.steps.filter((step) => !covered.has(step));
    if (missing.length === 0) {
      return buildView(env, existing);
    }
    const added = await enqueueSteps(env, userId, fileId, missing);
    await db
      .update(aiIngestAssets)
      .set({
        policy: JSON.stringify(policy),
        taskIds: JSON.stringify([...existingSteps, ...added]),
        status: 'processing',
        updatedAt: now,
      })
      .where(eq(aiIngestAssets.id, existing.id));
    const updated = { ...existing, taskIds: JSON.stringify([...existingSteps, ...added]), status: 'processing' };
    return buildView(env, updated);
  }

  const stored = await enqueueSteps(env, userId, fileId, policy.steps);
  const row = {
    id: crypto.randomUUID(),
    fileId,
    userId,
    policy: JSON.stringify(policy),
    status: 'processing' as const,
    taskIds: JSON.stringify(stored),
    error: null,
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(aiIngestAssets).values(row);
  logger.info('AI', '已登记上传资产解析', { fileId, userId, steps: policy.steps });
  return buildView(env, row as typeof aiIngestAssets.$inferSelect);
}

/** 读取资产状态（会按队列实际状态重算并回写） */
export async function getIngestAsset(env: Env, userId: string, fileId: string): Promise<IngestAssetView> {
  await assertOwnedFile(env, userId, fileId);
  const db = getDb(env.DB);
  const row = await db.select().from(aiIngestAssets).where(eq(aiIngestAssets.fileId, fileId)).get();
  if (!row) throwAppError('FILE_NOT_FOUND', '该文件尚未登记解析');
  return buildView(env, row);
}

/** 仅重试失败/取消的步骤；成功步骤不重复排队 */
export async function retryIngestAsset(env: Env, userId: string, fileId: string): Promise<IngestAssetView> {
  await assertOwnedFile(env, userId, fileId);
  const db = getDb(env.DB);
  const row = await db.select().from(aiIngestAssets).where(eq(aiIngestAssets.fileId, fileId)).get();
  if (!row) throwAppError('FILE_NOT_FOUND', '该文件尚未登记解析');

  const maxAttempts = await getAiConfigNumber(env, 'ai.ingest.max_attempts', AI_INGEST_DEFAULTS.maxAttempts);
  if (row.attempts >= maxAttempts) {
    throwAppError('AI_SERVICE_UNAVAILABLE', `解析重试次数已达上限（${maxAttempts} 次）`);
  }

  const view = await buildView(env, row);
  const retryable = view.steps.filter((step) => step.status === 'failed' || step.status === 'cancelled');
  if (retryable.length === 0) return view;

  const stored = parseStoredSteps(row.taskIds);
  const kept = stored.filter((item) => !retryable.some((step) => step.step === item.step));
  const added = await enqueueSteps(
    env,
    userId,
    fileId,
    retryable.map((step) => step.step)
  );
  const now = new Date().toISOString();
  const taskIds = JSON.stringify([...kept, ...added]);

  await db
    .update(aiIngestAssets)
    .set({ taskIds, status: 'processing', error: null, attempts: row.attempts + 1, updatedAt: now })
    .where(eq(aiIngestAssets.id, row.id));

  logger.info('AI', '已重试上传资产解析', { fileId, userId, steps: retryable.map((step) => step.step) });
  return buildView(env, { ...row, taskIds, status: 'processing', attempts: row.attempts + 1, error: null, updatedAt: now });
}
