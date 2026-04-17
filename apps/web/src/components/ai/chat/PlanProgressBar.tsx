import { CheckCircle2, Circle, Loader2, ListTodo } from 'lucide-react';
import type { ExecutionPlan, ExecutionPlanStep } from '../types';

interface PlanProgressBarProps {
  plan: ExecutionPlan;
  _onStepUpdate?: (stepId: string, status: string) => void;
}

export function PlanProgressBar({ plan }: PlanProgressBarProps) {
  const completedCount = plan.steps.filter((s) => s.status === 'done').length;
  const progressPercent = Math.round((completedCount / plan.steps.length) * 100);

  const getStepIcon = (step: ExecutionPlanStep) => {
    switch (step.status) {
      case 'done':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'running':
        return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
      case 'skipped':
        return <Circle className="h-3.5 w-3.5 text-slate-400" />;
      default:
        return <Circle className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />;
    }
  };

  const getStepStyle = (step: ExecutionPlanStep): string => {
    switch (step.status) {
      case 'done':
        return 'text-emerald-700 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/40';
      case 'running':
        return 'text-blue-700 dark:text-blue-300 bg-blue-50/80 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-800/40 ring-1 ring-blue-300/40';
      case 'skipped':
        return 'text-slate-400 dark:text-slate-500 bg-slate-50/50 dark:bg-slate-900/20 border-slate-200/40 dark:border-slate-800/30 line-through';
      default:
        return 'text-slate-600 dark:text-slate-400 bg-white/60 dark:bg-slate-800/30 border-slate-200/60 dark:border-slate-700/40';
    }
  };

  return (
    <div className="my-3 rounded-xl border border-violet-200/70 dark:border-violet-800/50 bg-gradient-to-br from-violet-50/80 via-purple-50/40 to-transparent dark:from-violet-950/20 dark:via-purple-950/10 overflow-hidden">
      <div className="px-4 py-3 border-b border-violet-100/60 dark:border-violet-900/30 flex items-center gap-2.5">
        <ListTodo className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        <span className="text-[13px] font-semibold text-violet-800 dark:text-violet-200">执行计划</span>
        <span className="text-[11px] text-violet-500 dark:text-violet-400 font-medium">{plan.goal}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-24 h-1.5 rounded-full bg-violet-100 dark:bg-violet-900/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-violet-600 dark:text-violet-400 tabular-nums">
            {completedCount}/{plan.steps.length}
          </span>
        </div>
      </div>

      <div className="px-4 py-2.5 space-y-1.5">
        {plan.steps.map((step) => (
          <div
            key={step.id}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-300 ${getStepStyle(step)}`}
          >
            <span className="flex-shrink-0">{getStepIcon(step)}</span>
            <span className="text-[12px] leading-relaxed flex-1">{step.description}</span>
            {step.toolHint && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100/80 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-mono flex-shrink-0">
                {step.toolHint}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
