/**
 * TaskProgress.tsx
 * 任务进度条组件
 *
 * 功能:
 * - 展示任务进度
 * - 支持取消操作
 */

import { RefreshCw, CheckCircle, XCircle, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AIIndexTask, AISummarizeTask, AITagsTask } from '@/services/api';

type TaskType = AIIndexTask | AISummarizeTask | AITagsTask;

interface TaskProgressProps {
  task: TaskType;
  onCancel?: () => void;
}

export function TaskProgress({ task, onCancel }: TaskProgressProps) {
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

  const canCancel = task.status === 'running' || task.status === 'cancelled';

  return (
    <div className="space-y-2 mt-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="text-sm font-medium">{getStatusText()}</span>
        </div>
        {onCancel && canCancel && (
          <Button variant="outline" size="sm" onClick={onCancel} className="text-xs">
            {task.status === 'running' ? '取消' : '清除'}
          </Button>
        )}
      </div>

      {/* 进度条 */}
      <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
        <div className="bg-primary h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          进度: {task.processed} / {task.total}
        </span>
        {task.failed > 0 && <span className="text-red-500">失败: {task.failed}</span>}
      </div>
    </div>
  );
}
