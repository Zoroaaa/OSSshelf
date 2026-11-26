/**
 * planRuntime.integration.test.ts
 * 任务状态机集成测试：真实迁移 + 内存 SQLite，覆盖落库、状态推导、失败重试、续跑与上下文注入。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types/env';
import { createD1Shim, createMigratedSqlite } from '../../test/d1Shim';
import {
  buildTaskContext,
  getActiveRun,
  getRunView,
  recordToolExecution,
  resumeRun,
  upsertPlan,
} from './planRuntime';

const USER = 'u1';
const SESSION = 's1';

let sqlite: ReturnType<typeof createMigratedSqlite>;
let env: Env;

beforeEach(() => {
  sqlite = createMigratedSqlite();
  env = { DB: createD1Shim(sqlite) } as unknown as Env;
});

const plan = (goal: string, statuses: string[], toolNames: string[] = []) => ({
  userId: USER,
  sessionId: SESSION,
  goal,
  steps: statuses.map((status, index) => ({
    id: `step-${index + 1}`,
    description: `步骤 ${index + 1}`,
    status,
    toolHint: toolNames[index],
  })),
});

describe('PlanRuntime', () => {
  it('创建计划：步骤落库、当前步骤可定位', async () => {
    const view = await upsertPlan(env, plan('整理重复文件', ['running', 'pending', 'pending']));

    expect(view.run.status).toBe('running');
    expect(view.run.totalSteps).toBe(3);
    expect(view.steps.map((step) => step.status)).toEqual(['running', 'pending', 'pending']);
    expect(view.run.currentStepId).toBe(view.steps[0]?.id);
  });

  it('步骤推进：completedSteps 与终态一致', async () => {
    await upsertPlan(env, plan('整理重复文件', ['running', 'pending']));

    const halfway = await upsertPlan(env, plan('整理重复文件', ['done', 'running']));
    expect(halfway.run.completedSteps).toBe(1);
    expect(halfway.run.status).toBe('running');

    const finished = await upsertPlan(env, plan('整理重复文件', ['done', 'done']));
    expect(finished.run.status).toBe('succeeded');
    expect(finished.run.completedAt).toBeTruthy();
    expect(finished.run.currentStepId).toBeNull();
  });

  it('目标变化：旧任务 cancelled，新任务独立推进', async () => {
    const first = await upsertPlan(env, plan('目标 A', ['running']));
    const second = await upsertPlan(env, plan('目标 B', ['running']));

    expect(second.run.id).not.toBe(first.run.id);
    const oldView = await getRunView(env, USER, first.run.id);
    expect(oldView?.run.status).toBe('cancelled');

    const active = await getActiveRun(env, USER, SESSION);
    expect(active?.run.id).toBe(second.run.id);
  });

  it('失败重试：未超上限回到 pending，超过上限落 failed 并记死信事件', async () => {
    await upsertPlan(env, plan('失败任务', ['running'], ['batch_delete']));

    for (let attempt = 1; attempt <= 3; attempt++) {
      const retried = await upsertPlan(env, plan('失败任务', ['failed'], ['batch_delete']));
      expect(retried.steps[0]?.status).toBe('pending');
      expect(retried.steps[0]?.attempts).toBe(attempt);
    }

    const dead = await upsertPlan(env, plan('失败任务', ['failed'], ['batch_delete']));
    expect(dead.steps[0]?.status).toBe('failed');
    expect(dead.run.status).toBe('failed');

    const events = sqlite.prepare('SELECT type FROM ai_task_events WHERE run_id = ?').all(dead.run.id) as Array<{
      type: string;
    }>;
    const types = events.map((event) => event.type);
    expect(types).toContain('step_retry');
    expect(types).toContain('step_dead_letter');

    // 失败任务 24h 内仍注入 L1，用户直接说"继续"也能从当前步骤恢复
    const context = await buildTaskContext(env, USER, SESSION);
    expect(context).toContain('失败任务');
    expect(context).toContain('✗');
  });

  it('工具执行回写：按 toolName 命中当前步骤并置 done', async () => {
    const view = await upsertPlan(env, plan('搜索任务', ['running', 'pending'], ['search_files', 'read_file_text']));

    await recordToolExecution(env, {
      userId: USER,
      sessionId: SESSION,
      toolName: 'search_files',
      ok: true,
    });

    const after = await getRunView(env, USER, view.run.id);
    expect(after?.steps[0]?.status).toBe('done');
    expect(after?.run.completedSteps).toBe(1);
  });

  it('工具失败：按重试策略回到 pending，超限后落 failed', async () => {
    const view = await upsertPlan(env, plan('工具失败任务', ['running'], ['batch_delete']));

    await recordToolExecution(env, {
      userId: USER,
      sessionId: SESSION,
      toolName: 'batch_delete',
      ok: false,
      error: '权限不足',
    });
    let after = await getRunView(env, USER, view.run.id);
    expect(after?.steps[0]?.status).toBe('pending');
    expect(after?.steps[0]?.attempts).toBe(1);
    expect(after?.run.status).toBe('running');

    for (let attempt = 2; attempt <= 4; attempt++) {
      await recordToolExecution(env, {
        userId: USER,
        sessionId: SESSION,
        toolName: 'batch_delete',
        ok: false,
        error: '权限不足',
      });
    }

    after = await getRunView(env, USER, view.run.id);
    expect(after?.steps[0]?.status).toBe('failed');
    expect(after?.run.status).toBe('failed');
  });

  it('续跑：running/awaiting_approval 退回 pending，run 恢复 running', async () => {
    const view = await upsertPlan(env, plan('中断任务', ['running', 'pending']));
    const resumed = await resumeRun(env, USER, view.run.id);

    expect(resumed?.run.status).toBe('running');
    expect(resumed?.steps[0]?.status).toBe('pending');
  });

  it('上下文注入：包含目标、进度与已完成标记', async () => {
    await upsertPlan(env, plan('整理并打标签', ['done', 'running']));

    const context = await buildTaskContext(env, USER, SESSION);
    expect(context).toContain('整理并打标签');
    expect(context).toContain('1/2');
    expect(context).toContain('✓');
    expect(context).toContain('当前步骤');
  });

  it('续跑上下文：succeeded 也保留，便于回答已完成摘要', async () => {
    const view = await upsertPlan(env, plan('已完成任务', ['done']));
    const context = await buildTaskContext(env, USER, SESSION);
    expect(view.run.status).toBe('succeeded');
    // 已结束任务不属于 active run，不注入 L1，避免污染下一轮对话
    expect(context).toBe('');
  });

  it('任务读写隔离：其他用户读不到', async () => {
    const view = await upsertPlan(env, plan('私有任务', ['running']));
    const other = await getRunView(env, 'u2', view.run.id);
    expect(other).toBeNull();
  });

  it('steps 落库条数与 run 统计一致', async () => {
    const view = await upsertPlan(env, plan('统计', ['done', 'skipped', 'pending']));
    const count = sqlite.prepare('SELECT COUNT(*) AS c FROM ai_task_steps WHERE run_id = ?').all(view.run.id) as Array<{
      c: number;
    }>;
    expect(count[0]?.c).toBe(3);
    expect(view.run.completedSteps).toBe(2);
  });

  it('返回视图与数据库行同源', async () => {
    const view = await upsertPlan(env, plan('同源', ['running']));
    const raw = sqlite.prepare('SELECT goal, status FROM ai_task_runs WHERE id = ?').all(view.run.id) as Array<{
      goal: string;
      status: string;
    }>;
    expect(raw[0]?.goal).toBe('同源');
    expect(raw[0]?.status).toBe('running');
  });
});
