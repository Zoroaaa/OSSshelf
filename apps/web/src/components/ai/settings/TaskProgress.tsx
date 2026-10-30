/**
 * TaskProgress.tsx
 * 任务进度条组件
 *
 * 功能:
 * - 展示任务进度与任务级错误
 * - 支持取消操作
 * - 失败时按文件展开错误明细，便于前端排查
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, CheckCircle, RefreshCw, Square, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { aiApi } from '@/services/api';
import type { AIIndexTask, AISummarizeTask, AITagsTask } from '@/services/api';

type TaskType = AIIndexTask | AISummarizeTask | AITagsTask;

interface TaskProgressProps {
  task: TaskType;
  onCancel?: () => void;
}

export function TaskProgress({ task, onCancel }: TaskProgressProps) {
  const [showFailures, setShowFailures] = useState(false);
  const taskId = task?.id ?? '';
  const failedCount = task?.failed ?? 0;
  const failedQuery = useQuery({
    queryKey: ['ai-task-failed-items', taskId],
    queryFn: () => aiApi.getFailedTaskItems(taskId, 50).then((res) => res.data.data),
    enabled: showFailures && Boolean(taskId) && failedCount > 0,
    staleTime: 15_000,
  });

  if (!task || task.status === 'idle') return null;

  const progress = task.total > 0 ? (task.processed / task.total) * 100 : 0;

  const getStatusIcon = () => {
    switch (task.status) {
      case 'running':
        return <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'cancelled':
        return <Square className="h-4 w-4 text-amber-500" />;
      default:
        return null;
    }
  };

  const getStatusText = () => {
    switch (task.status) {
      case 'running':
        return '运行中...';
      case 'completed':
        return '已完成';
      case 'failed':
        return '失败';
      case 'cancelled':
        return '已取消';
      default:
        return '';
    }
  };

  const canCancel = task.status === 'running';
  const failureItems = failedQuery.data?.items ?? [];
  const failureTaskError = failedQuery.data?.taskError ?? task.error ?? null;

  return (
    <div className="space-y-2 mt-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="text-sm font-medium">{getStatusText()}</span>
        </div>
        <div className="flex items-center gap-2">
          {failedCount > 0 && Boolean(taskId) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFailures((value) => !value)}
              className="text-xs gap-1"
            >
              <AlertTriangle className="h-3 w-3 text-red-500" />
              失败明细 ({failedCount})
              <ChevronDown className={`h-3 w-3 transition-transform ${showFailures ? 'rotate-180' : ''}`} />
            </Button>
          )}
          {onCancel && canCancel && (
            <Button variant="outline" size="sm" onClick={onCancel} className="text-xs">
              取消
            </Button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
        <div className="bg-primary h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          进度: {task.processed} / {task.total}
        </span>
        {failedCount > 0 && <span className="text-red-500">失败: {failedCount}</span>}
      </div>

      {task.error && !showFailures && <p className="text-xs text-red-500 break-all">任务错误：{task.error}</p>}

      {showFailures && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20 p-2.5 space-y-1.5">
          {failureTaskError && <p className="text-xs text-red-600 break-all">任务错误：{failureTaskError}</p>}
          {failedQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">加载失败明细…</p>
          ) : failedQuery.isError ? (
            <p className="text-xs text-red-500">失败明细读取失败，请查看 Worker 日志</p>
          ) : failureItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无失败明细</p>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {failureItems.map((item) => (
                <div key={item.fileId} className="text-xs flex gap-2">
                  <span className="font-medium truncate max-w-[45%]" title={item.fileName}>
                    {item.fileName}
                  </span>
                  <span className="text-red-600 break-all flex-1">{item.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
