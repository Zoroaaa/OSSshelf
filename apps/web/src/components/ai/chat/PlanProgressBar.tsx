import { useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, ListTodo, Loader2 } from 'lucide-react';
import type { ExecutionPlan, ExecutionPlanStep } from '../types';

interface PlanProgressBarProps {
  plan: ExecutionPlan;
}

export function PlanProgressBar({ plan }: PlanProgressBarProps) {
  const [expanded, setExpanded] = useState(false);
  const total = plan.steps.length;
  const completed = plan.steps.filter((step) => step.status === 'done').length;
  const running = plan.steps.find((step) => step.status === 'running');
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const stepIcon = (step: ExecutionPlanStep) => {
    switch (step.status) {
      case 'done':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'running':
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
      case 'skipped':
        return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />;
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/40"
      >
        <ListTodo className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">{plan.goal}</span>
          {!expanded && running && (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">当前：{running.description}</span>
          )}
        </span>
        <span className="flex flex-shrink-0 items-center gap-1.5">
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {completed}/{total}
          </span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="space-y-1.5 border-t border-border/70 px-3 py-2.5">
          {plan.steps.map((step) => (
            <div key={step.id} className="flex items-center gap-2.5 text-[12px]">
              <span className="flex-shrink-0">{stepIcon(step)}</span>
              <span
                className={`flex-1 leading-relaxed ${
                  step.status === 'done'
                    ? 'text-muted-foreground line-through'
                    : step.status === 'running'
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                }`}
              >
                {step.description}
              </span>
              {step.toolHint && (
                <span className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {step.toolHint}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
