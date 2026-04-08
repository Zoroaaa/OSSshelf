/**
 * TasksCenter.tsx
 * 任务监控中心组件
 *
 * 功能:
 * - 索引/摘要/标签三个任务状态卡片
 * - 总览统计
 */

import { Database, FileText, BarChart3, ImageIcon } from 'lucide-react';
import type { AIIndexTask, AISummarizeTask, AITagsTask, AIIndexStats } from '@/services/api';
import { TaskProgress } from './TaskProgress';

interface TasksCenterProps {
  task: AIIndexTask | null;
  summarizeTask: AISummarizeTask | null;
  tagsTask: AITagsTask | null;
  stats: AIIndexStats | null;
  onCancelTask: (taskType: 'index' | 'summarize' | 'tags') => void;
}

const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'running':
      return '运行中';
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

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'running':
      return 'text-blue-600';
    case 'completed':
      return 'text-green-600';
    case 'failed':
      return 'text-red-600';
    case 'cancelled':
      return 'text-amber-600';
    default:
      return '';
  }
};

export function TasksCenter({ task, summarizeTask, tagsTask, stats, onCancelTask }: TasksCenterProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg sm:text-xl font-semibold">任务监控中心</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-500" />
            <h3 className="font-medium">索引任务</h3>
          </div>
          {task && task.status !== 'idle' ? (
            <>
              <div className="text-sm text-muted-foreground">
                状态：
                <span className={`font-medium ${getStatusColor(task.status)}`}>{getStatusLabel(task.status)}</span>
              </div>
              <TaskProgress task={task} onCancel={() => onCancelTask('index')} />
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">当前无索引任务</div>
          )}
        </div>

        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-purple-500" />
            <h3 className="font-medium">摘要生成任务</h3>
          </div>
          {summarizeTask && summarizeTask.status !== 'idle' ? (
            <>
              <div className="text-sm text-muted-foreground">
                状态：
                <span className={`font-medium ${getStatusColor(summarizeTask.status)}`}>
                  {getStatusLabel(summarizeTask.status)}
                </span>
              </div>
              <TaskProgress task={summarizeTask} onCancel={() => onCancelTask('summarize')} />
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">当前无摘要任务</div>
          )}
        </div>

        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-green-500" />
            <h3 className="font-medium">标签生成任务</h3>
          </div>
          {tagsTask && tagsTask.status !== 'idle' ? (
            <>
              <div className="text-sm text-muted-foreground">
                状态：
                <span className={`font-medium ${getStatusColor(tagsTask.status)}`}>
                  {getStatusLabel(tagsTask.status)}
                </span>
              </div>
              <TaskProgress task={tagsTask} onCancel={() => onCancelTask('tags')} />
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">当前无标签任务</div>
          )}
        </div>
      </div>

      {stats && (
        <div className="border rounded-lg p-4 sm:p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            文件处理总览
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-muted/40 rounded-lg">
              <p className="text-2xl sm:text-3xl font-bold text-blue-600">
                {(stats.editable.total || 0) + (stats.image.total || 0) + (stats.other.total || 0)}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">总文件数</p>
            </div>
            <div className="text-center p-3 bg-muted/40 rounded-lg">
              <p className="text-2xl sm:text-3xl font-bold text-green-600">
                {stats.editable.noSummary + stats.image.noTags}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">待处理</p>
            </div>
            <div className="text-center p-3 bg-muted/40 rounded-lg">
              <p className="text-2xl sm:text-3xl font-bold text-amber-600">
                {stats.editable.notIndexed + stats.image.notIndexed + stats.other.notIndexed}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">待索引</p>
            </div>
            <div className="text-center p-3 bg-muted/40 rounded-lg">
              <p className="text-2xl sm:text-3xl font-bold text-purple-600">
                {Math.round(
                  ((stats.editable.total -
                    stats.editable.notIndexed +
                    stats.image.total -
                    stats.image.notIndexed +
                    stats.other.total -
                    stats.other.notIndexed) /
                    (stats.editable.total + stats.image.total + stats.other.total || 1)) *
                    100
                )}
                %
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">完成率</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
