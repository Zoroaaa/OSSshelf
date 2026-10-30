/**
 * ErrorBanner.tsx
 * 会话错误提示条：连接、换票、模型、工具等错误统一在此展示，并提供重试入口。
 */

import { AlertTriangle, RefreshCw, X } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  title?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  retrying?: boolean;
}

export function ErrorBanner({ message, title = '会话出现问题', onRetry, onDismiss, retrying }: ErrorBannerProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3">
      <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} />
            重试
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="flex-shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="关闭错误提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
