/**
 * AsyncState.tsx
 * 统一异步状态呈现（审查报告 E-08 / C-12）
 *
 * 提供 loading（骨架）/ empty（引导）/ error（重试）三态，
 * 修复"失败伪装成空数据"、"无重试入口"、"永久加载中"等问题，
 * 遵循"请求失败优雅降级、空数据仍显示页面不阻塞整页"的约定。
 */

import { AlertCircle, Inbox, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from '@/components/ui/Button';

/** 全站统一 Spinner（E-11）：替换散落各处的 border-blue-500 / border-primary 副本 */
export function LoadingSpinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div
      className={cn('flex min-h-[200px] flex-col items-center justify-center gap-3', className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}

interface LoadingStateProps {
  className?: string;
  label?: string;
  /** 骨架行数 */
  rows?: number;
}

export function LoadingState({ className, label = '加载中...', rows = 0 }: LoadingStateProps) {
  if (rows > 0) {
    return (
      <div className={cn('space-y-2', className)} role="status" aria-live="polite" aria-label={label}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }
  return (
    <div
      className={cn('flex min-h-[160px] flex-col items-center justify-center gap-3 text-muted-foreground', className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title = '暂无数据', description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex min-h-[200px] flex-col items-center justify-center gap-3 p-6 text-center', className)}>
      <div className="rounded-full bg-muted p-4">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title = '加载失败', message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      className={cn('flex min-h-[200px] flex-col items-center justify-center gap-3 p-6 text-center', className)}
      role="alert"
    >
      <div className="rounded-full bg-destructive/10 p-4">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-destructive">{title}</p>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="mr-2 h-4 w-4" />
          重试
        </Button>
      )}
    </div>
  );
}
