/**
 * TaskRunBanner.tsx
 * 服务端任务状态条：仅在任务需要用户介入时出现（失败 / 等待审批）。
 *
 * 为什么不做完整计划条：
 * - 模型每轮 update_plan 已由消息里的 PlanProgressBar 渲染，再画一份会重复；
 * - 服务端 run 的价值是「中断后可恢复」，所以这里只呈现可操作状态与续跑入口。
 */

import { CheckCircle2, Loader2, PauseCircle, Play, XCircle } from 'lucide-react';
import type { AiTaskRunView } from '@/services/ai';

interface TaskRunBannerProps {
  runView: AiTaskRunView;
  resuming: boolean;
  onResume: () => void;
}

export function TaskRunBanner({ runView, resuming, onResume }: TaskRunBannerProps) {
  const { run, steps } = runView;
  if (run.status !== 'failed' && run.status !== 'awaiting_approval') return null;

  const failedStep = steps.find((step) => step.status === 'failed');
  const awaitingStep = steps.find((step) => step.status === 'awaiting_approval');
  const percent = run.totalSteps > 0 ? Math.round((run.completedSteps / run.totalSteps) * 100) : 0;
  const isFailed = run.status === 'failed';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3">
      <div
        className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
          isFailed ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/40'
        }`}
      >
        <span className="mt-0.5 flex-shrink-0">
          {isFailed ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <PauseCircle className="h-4 w-4 text-muted-foreground" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[13px] font-medium text-foreground">{run.goal}</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {run.completedSteps}/{run.totalSteps} · {percent}%
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {isFailed
              ? failedStep
                ? `失败步骤：${failedStep.title}${failedStep.error ? `（${failedStep.error}）` : ''}`
                : '任务已中断，可从当前步骤继续'
              : awaitingStep
                ? `等待确认：${awaitingStep.title}；若已拒绝或确认卡片已消失，可点右侧重试`
                : '等待确认后继续'}
          </p>
        </div>

        <button
          type="button"
          onClick={onResume}
          disabled={resuming}
          className="flex h-7 flex-shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          继续执行
        </button>
      </div>

      {run.status === 'failed' && run.completedSteps > 0 && (
        <p className="mt-1 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          已完成的 {run.completedSteps} 个步骤不会重复执行
        </p>
      )}
    </div>
  );
}
