/**
 * planRuntime.ts
 * 任务编排状态机（PlanRuntime）
 *
 * 解决的问题：
 * - update_plan 以前只渲染不落库，模型中断后无法知道做到哪一步
 * - 审批/断线/DO 回收后状态散在 DO 消息、D1 镜像、客户端乐观消息三处
 *
 * 设计：
 * - ai_task_runs / ai_task_steps 是任务事实源，ai_task_events 是事件流
 * - 模型只通过 update_plan 上报「目标 + 步骤状态」，编排器负责状态推导与落库
 * - 续跑时不重放工具，只把已完成步骤注入上下文，由模型从当前步骤继续
 * - 失败重试上限、死信阈值来自 ai.task.* 配置，不在代码里写死
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb, aiTaskRuns, aiTaskSteps, aiTaskEvents } from '../../db';
import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';
import {
  AI_AGENT_DEFAULTS,
  AI_TASK_DEFAULTS,
  getAiConfigNumber,
} from './aiConfigService';

export type TaskRunStatus = 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';
export type TaskStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'awaiting_approval';

const ACTIVE_RUN_STATUSES: TaskRunStatus[] = ['running', 'awaiting_approval'];
const TERMINAL_STEP_STATUSES: TaskStepStatus[] = ['done', 'skipped', 'failed'];

export interface PlanStepInput {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  toolName?: string;
  toolHint?: string;
  idempotencyKey?: string;
}

export interface TaskRunView {
  run: typeof aiTaskRuns.$inferSelect;
  steps: Array<typeof aiTaskSteps.$inferSelect>;
}

function normalizeStepStatus(value: unknown): TaskStepStatus {
  const raw = typeof value === 'string' ? value : '';
  switch (raw) {
    case 'running':
    case 'in_progress':
      return 'running';
    case 'done':
    case 'completed':
    case 'succeeded':
      return 'done';
    case 'failed':
    case 'error':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'awaiting_approval':
    case 'waiting_approval':
      return 'awaiting_approval';
    default:
      return 'pending';
  }
}

function deriveRunStatus(steps: Array<{ status: string }>): TaskRunStatus {
  if (steps.some((step) => step.status === 'awaiting_approval')) return 'awaiting_approval';
  if (steps.some((step) => step.status === 'running')) return 'running';
  if (steps.every((step) => TERMINAL_STEP_STATUSES.includes(step.status as TaskStepStatus))) {
    return steps.some((step) => step.status === 'failed') ? 'failed' : 'succeeded';
  }
  return 'running';
}

function pickCurrentStep(
  steps: Array<{ id: string; status: string }>
): string | null {
  const running = steps.find((step) => step.status === 'running');
  if (running) return running.id;
  const awaiting = steps.find((step) => step.status === 'awaiting_approval');
  if (awaiting) return awaiting.id;
  const pending = steps.find((step) => step.status === 'pending');
  return pending?.id ?? null;
}

async function appendEvent(
  env: Env,
  input: { runId: string; stepId?: string | null; type: string; payload?: unknown }
): Promise<void> {
  try {
    await getDb(env.DB)
      .insert(aiTaskEvents)
      .values({
        id: crypto.randomUUID(),
        runId: input.runId,
        stepId: input.stepId ?? null,
        type: input.type,
        payload: input.payload === undefined ? null : JSON.stringify(input.payload).slice(0, 8_000),
        createdAt: new Date().toISOString(),
      });
  } catch (error) {
    // 事件是审计流，写失败不阻塞任务推进
    logger.warn('PlanRuntime', 'Failed to append task event', { runId: input.runId, type: input.type }, error);
  }
}

async function getRetryPolicy(env: Env): Promise<{ maxRetries: number; deadLetterAfter: number }> {
  const [maxRetries, deadLetterAfter] = await Promise.all([
    getAiConfigNumber(env, 'ai.task.max_retries', AI_TASK_DEFAULTS.maxRetries),
    getAiConfigNumber(env, 'ai.task.dead_letter_after', AI_TASK_DEFAULTS.deadLetterAfter),
  ]);
  return { maxRetries: Math.max(0, maxRetries), deadLetterAfter: Math.max(1, deadLetterAfter) };
}

async function findActiveRunRow(env: Env, userId: string, sessionId: string) {
  return getDb(env.DB)
    .select()
    .from(aiTaskRuns)
    .where(and(eq(aiTaskRuns.userId, userId), eq(aiTaskRuns.sessionId, sessionId)))
    .orderBy(desc(aiTaskRuns.createdAt))
    .limit(10)
    .all()
    .then((rows) => rows.find((row) => ACTIVE_RUN_STATUSES.includes(row.status as TaskRunStatus)) ?? null);
}

export async function getRunView(
  env: Env,
  userId: string,
  runId: string
): Promise<TaskRunView | null> {
  const db = getDb(env.DB);
  const run = await db
    .select()
    .from(aiTaskRuns)
    .where(and(eq(aiTaskRuns.id, runId), eq(aiTaskRuns.userId, userId)))
    .get();
  if (!run) return null;

  const steps = await db
    .select()
    .from(aiTaskSteps)
    .where(eq(aiTaskSteps.runId, runId))
    .orderBy(asc(aiTaskSteps.stepIndex))
    .all();

  return { run, steps };
}

/** 会话进行中的任务：前端计划条与续跑入口都读它 */
export async function getActiveRun(env: Env, userId: string, sessionId: string): Promise<TaskRunView | null> {
  const run = await findActiveRunRow(env, userId, sessionId);
  if (!run) return null;
  return getRunView(env, userId, run.id);
}

const RESUMABLE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 最近 24h 内失败的任务：用户可能直接说"继续"而不是点按钮，
 * 这种情况下也要把失败任务注入 L1，否则模型不知道从哪继续。
 */
export async function getResumableRun(env: Env, userId: string, sessionId: string): Promise<TaskRunView | null> {
  const rows = await getDb(env.DB)
    .select()
    .from(aiTaskRuns)
    .where(and(eq(aiTaskRuns.userId, userId), eq(aiTaskRuns.sessionId, sessionId)))
    .orderBy(desc(aiTaskRuns.updatedAt))
    .limit(5)
    .all();

  const cutoff = Date.now() - RESUMABLE_WINDOW_MS;
  const run = rows.find(
    (row) => row.status === 'failed' && new Date(row.updatedAt).getTime() >= cutoff
  );
  if (!run) return null;
  return getRunView(env, userId, run.id);
}

/**
 * 创建或更新计划。
 * 同一会话同一目标复用同一个 run（update_plan 每步都会调用一次）；
 * 目标变化视为新任务，旧任务标 cancelled，避免两个计划并行推进。
 */
export async function upsertPlan(
  env: Env,
  input: { userId: string; sessionId: string; goal: string; steps: PlanStepInput[] }
): Promise<TaskRunView> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const goal = input.goal.trim().slice(0, 500);
  if (!goal) throw new Error('计划缺少 goal');
  const steps = input.steps.slice(0, 30);
  if (steps.length === 0) throw new Error('计划缺少 steps');

  let run = await findActiveRunRow(env, input.userId, input.sessionId);
  if (run && run.goal !== goal) {
    await db
      .update(aiTaskRuns)
      .set({ status: 'cancelled', updatedAt: now, completedAt: now })
      .where(eq(aiTaskRuns.id, run.id));
    await appendEvent(env, { runId: run.id, type: 'run_cancelled', payload: { reason: 'goal_changed', goal } });
    run = null;
  }

  if (!run) {
    const runId = crypto.randomUUID();
    const runRow = {
      id: runId,
      sessionId: input.sessionId,
      userId: input.userId,
      goal,
      status: 'running' as const,
      currentStepId: null as string | null,
      totalSteps: steps.length,
      completedSteps: 0,
      budgetUsed: 0,
      checkpoint: null as string | null,
      error: null as string | null,
      createdAt: now,
      updatedAt: now,
      completedAt: null as string | null,
    };
    await db.insert(aiTaskRuns).values(runRow);
    run = runRow;
    await appendEvent(env, { runId, type: 'run_created', payload: { goal, totalSteps: steps.length } });
  }

  const existingSteps = await db.select().from(aiTaskSteps).where(eq(aiTaskSteps.runId, run.id)).all();
  const existingByIndex = new Map(existingSteps.map((step) => [step.stepIndex, step]));
  const policy = await getRetryPolicy(env);

  for (let index = 0; index < steps.length; index++) {
    const incoming = steps[index];
    if (!incoming) continue;
    const title = (incoming.title ?? incoming.description ?? '').trim().slice(0, 300);
    if (!title) continue;

    const status = normalizeStepStatus(incoming.status);
    const toolName = (incoming.toolName ?? incoming.toolHint ?? '').trim() || null;
    const existing = existingByIndex.get(index);

    if (!existing) {
      const stepId = `${run.id}:${index}`;
      const startedAt = status === 'running' ? now : null;
      const completedAt = TERMINAL_STEP_STATUSES.includes(status) ? now : null;
      await db.insert(aiTaskSteps).values({
        id: stepId,
        runId: run.id,
        stepIndex: index,
        title,
        toolName,
        status,
        input: null,
        output: null,
        error: null,
        attempts: 0,
        idempotencyKey: incoming.idempotencyKey ?? null,
        startedAt,
        completedAt,
        updatedAt: now,
      });
      await appendEvent(env, { runId: run.id, stepId, type: `step_${status}`, payload: { title } });
      continue;
    }

    if (existing.status === status && existing.title === title && existing.toolName === toolName) continue;

    // 失败步骤按配置重试：未超过上限回到 pending，超过则落 failed（死信）
    let nextStatus: TaskStepStatus = status;
    let attempts = existing.attempts;
    if (status === 'failed' && existing.status !== 'failed') {
      attempts += 1;
      const canRetry = attempts <= policy.maxRetries && attempts < policy.deadLetterAfter;
      nextStatus = canRetry ? 'pending' : 'failed';
      await appendEvent(env, {
        runId: run.id,
        stepId: existing.id,
        type: canRetry ? 'step_retry' : 'step_dead_letter',
        payload: { attempts, toolName, error: null },
      });
    } else if (status !== existing.status) {
      await appendEvent(env, {
        runId: run.id,
        stepId: existing.id,
        type: `step_${status}`,
        payload: { title },
      });
    }

    const startedAt =
      nextStatus === 'running' && !existing.startedAt ? now : existing.startedAt;
    const completedAt = TERMINAL_STEP_STATUSES.includes(nextStatus) ? now : null;

    await db
      .update(aiTaskSteps)
      .set({
        title,
        toolName,
        status: nextStatus,
        attempts,
        startedAt,
        completedAt,
        updatedAt: now,
      })
      .where(eq(aiTaskSteps.id, existing.id));
  }

  const refreshed = await db
    .select()
    .from(aiTaskSteps)
    .where(eq(aiTaskSteps.runId, run.id))
    .orderBy(asc(aiTaskSteps.stepIndex))
    .all();

  const runStatus = deriveRunStatus(refreshed);
  const currentStepId = pickCurrentStep(refreshed);
  const completedSteps = refreshed.filter((step) => step.status === 'done' || step.status === 'skipped').length;
  const terminal = runStatus === 'succeeded' || runStatus === 'failed';

  await db
    .update(aiTaskRuns)
    .set({
      goal,
      status: runStatus,
      currentStepId,
      totalSteps: refreshed.length,
      completedSteps,
      updatedAt: now,
      completedAt: terminal ? now : null,
      error: runStatus === 'failed' ? refreshed.find((step) => step.status === 'failed')?.title ?? null : null,
    })
    .where(eq(aiTaskRuns.id, run.id));

  if (terminal) {
    await appendEvent(env, {
      runId: run.id,
      type: runStatus === 'succeeded' ? 'run_succeeded' : 'run_failed',
      payload: { completedSteps, totalSteps: refreshed.length },
    });
  }

  const view = await getRunView(env, input.userId, run.id);
  if (!view) throw new Error('任务读取失败');
  return view;
}

/** 工具执行结果回写到对应步骤：按 toolName 匹配当前未完成步骤 */
export async function recordToolExecution(
  env: Env,
  input: { userId: string; sessionId: string; toolName: string; ok: boolean; error?: string; idempotencyKey?: string }
): Promise<void> {
  try {
    const run = await findActiveRunRow(env, input.userId, input.sessionId);
    if (!run) return;

    const db = getDb(env.DB);
    const steps = await db
      .select()
      .from(aiTaskSteps)
      .where(eq(aiTaskSteps.runId, run.id))
      .orderBy(asc(aiTaskSteps.stepIndex))
      .all();

    const target =
      steps.find((step) => step.toolName === input.toolName && step.status === 'running') ??
      steps.find((step) => step.toolName === input.toolName && step.status !== 'done' && step.status !== 'skipped');

    if (!target) return;

    const now = new Date().toISOString();
    // 工具失败与模型上报失败走同一套重试策略：未超上限回到 pending，
    // 让模型在下一步看到错误并重试；超过上限才落 failed，避免一步失败就整单失败。
    let attempts = target.attempts;
    let nextStatus: TaskStepStatus = input.ok ? 'done' : 'failed';
    if (!input.ok) {
      const policy = await getRetryPolicy(env);
      attempts += 1;
      const canRetry = attempts <= policy.maxRetries && attempts < policy.deadLetterAfter;
      nextStatus = canRetry ? 'pending' : 'failed';
    }

    await db
      .update(aiTaskSteps)
      .set({
        status: nextStatus,
        attempts,
        error: input.ok ? null : (input.error ?? '工具执行失败').slice(0, 1_000),
        completedAt: nextStatus === 'done' || nextStatus === 'failed' ? now : null,
        updatedAt: now,
      })
      .where(eq(aiTaskSteps.id, target.id));

    await appendEvent(env, {
      runId: run.id,
      stepId: target.id,
      type: input.ok ? 'tool_succeeded' : 'tool_failed',
      payload: { toolName: input.toolName, error: input.error?.slice(0, 500), attempts, nextStatus },
    });

    const refreshed = await db
      .select()
      .from(aiTaskSteps)
      .where(eq(aiTaskSteps.runId, run.id))
      .orderBy(asc(aiTaskSteps.stepIndex))
      .all();
    const runStatus = deriveRunStatus(refreshed);
    const completedSteps = refreshed.filter((step) => step.status === 'done' || step.status === 'skipped').length;
    await db
      .update(aiTaskRuns)
      .set({
        status: runStatus,
        currentStepId: pickCurrentStep(refreshed),
        completedSteps,
        updatedAt: now,
        completedAt: runStatus === 'succeeded' || runStatus === 'failed' ? now : null,
      })
      .where(eq(aiTaskRuns.id, run.id));
  } catch (error) {
    logger.warn('PlanRuntime', 'Failed to record tool execution', { toolName: input.toolName }, error);
  }
}

/** 写操作进入审批：把匹配步骤置为 awaiting_approval，并记事件 */
export async function recordApprovalRequested(
  env: Env,
  input: { userId: string; sessionId: string; toolName: string }
): Promise<void> {
  try {
    const run = await findActiveRunRow(env, input.userId, input.sessionId);
    if (!run) return;
    const db = getDb(env.DB);
    const steps = await db
      .select()
      .from(aiTaskSteps)
      .where(eq(aiTaskSteps.runId, run.id))
      .orderBy(asc(aiTaskSteps.stepIndex))
      .all();
    const target =
      steps.find((step) => step.toolName === input.toolName && step.status === 'running') ??
      steps.find((step) => step.toolName === input.toolName && step.status === 'pending');
    if (!target) return;

    const now = new Date().toISOString();
    await db
      .update(aiTaskSteps)
      .set({ status: 'awaiting_approval', updatedAt: now })
      .where(eq(aiTaskSteps.id, target.id));
    await db
      .update(aiTaskRuns)
      .set({ status: 'awaiting_approval', currentStepId: target.id, updatedAt: now })
      .where(eq(aiTaskRuns.id, run.id));
    await appendEvent(env, {
      runId: run.id,
      stepId: target.id,
      type: 'approval_requested',
      payload: { toolName: input.toolName },
    });
  } catch (error) {
    logger.warn('PlanRuntime', 'Failed to record approval request', { toolName: input.toolName }, error);
  }
}

/** 续跑：把中断遗留的 running/awaiting_approval 步骤退回 pending，run 恢复 running */
export async function resumeRun(env: Env, userId: string, runId: string): Promise<TaskRunView | null> {
  const view = await getRunView(env, userId, runId);
  if (!view) return null;
  if (view.run.status === 'succeeded') return view;

  const db = getDb(env.DB);
  const now = new Date().toISOString();
  await db
    .update(aiTaskSteps)
    .set({ status: 'pending', updatedAt: now })
    .where(and(eq(aiTaskSteps.runId, runId), inArray(aiTaskSteps.status, ['running', 'awaiting_approval'])));
  await db
    .update(aiTaskRuns)
    .set({
      status: 'running',
      updatedAt: now,
      completedAt: null,
      error: null,
      currentStepId: view.steps.find((step) => step.status === 'pending')?.id ?? view.run.currentStepId,
    })
    .where(eq(aiTaskRuns.id, runId));
  await appendEvent(env, { runId, type: 'run_resumed' });

  return getRunView(env, userId, runId);
}

/**
 * L1 任务状态层：注入 system prompt。
 * 只描述状态与下一步，不重放工具结果，避免上下文膨胀。
 */
export async function buildTaskContext(env: Env, userId: string, sessionId: string): Promise<string> {
  try {
    const view = (await getActiveRun(env, userId, sessionId)) ?? (await getResumableRun(env, userId, sessionId));
    if (!view) return '';

    const { run, steps } = view;
    const lines = ['## 当前任务状态（任务事实源，跨轮持久化）', `目标：${run.goal}`];
    const done = steps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
    lines.push(`进度：${done}/${steps.length} 步骤完成，任务状态：${run.status}`);
    if (run.error) lines.push(`最近错误：${run.error}`);

    lines.push('步骤：');
    for (const step of steps) {
      const marker =
        step.status === 'done'
          ? '✓'
          : step.status === 'failed'
            ? '✗'
            : step.status === 'running'
              ? '▶'
              : step.status === 'awaiting_approval'
                ? '⏸'
                : '·';
      const tool = step.toolName ? `（${step.toolName}）` : '';
      lines.push(`${marker} ${step.stepIndex + 1}. ${step.title}${tool}`);
    }

    const current = steps.find((step) => step.id === run.currentStepId);
    if (current) {
      lines.push(`当前步骤：${current.title}`);
    }
    lines.push(
      '约束：已完成步骤不要重复执行；中断恢复时从当前步骤继续；改写计划必须再次调用 update_plan 并说明原因。'
    );
    return lines.join('\n');
  } catch (error) {
    logger.warn('PlanRuntime', 'Failed to build task context', { sessionId }, error);
    return '';
  }
}

export async function listRunEvents(
  env: Env,
  userId: string,
  runId: string,
  limit = 100
): Promise<Array<typeof aiTaskEvents.$inferSelect>> {
  const view = await getRunView(env, userId, runId);
  if (!view) return [];
  return getDb(env.DB)
    .select()
    .from(aiTaskEvents)
    .where(eq(aiTaskEvents.runId, runId))
    .orderBy(asc(aiTaskEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500))
    .all();
}

/** 上下文预算辅助：L1 层默认不裁剪，这里只提供上限保护 */
export function taskContextMaxTokens(maxContextTokens: number, ratio: number): number {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : AI_AGENT_DEFAULTS.taskStateRatio;
  return Math.max(200, Math.floor(maxContextTokens * safeRatio));
}
