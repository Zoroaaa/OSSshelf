/**
 * AISettings.tsx
 * AI 功能设置页面
 */

import { useState, useEffect } from 'react';
import { Sparkles, Database, RefreshCw, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { aiApi } from '@/services/api';
import type { AIIndexTask } from '@/services/api';
import { formatDate } from '@/utils';

export function AISettings() {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [task, setTask] = useState<AIIndexTask | null>(null);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; features: Record<string, boolean> } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchTaskStatus();
    const interval = setInterval(fetchTaskStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const response = await aiApi.getStatus();
      if (response.data.success && response.data.data) {
        setAiStatus(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch AI status:', error);
    }
  };

  const fetchTaskStatus = async () => {
    try {
      const response = await aiApi.getIndexStatus();
      if (response.data.success && response.data.data) {
        setTask(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch task status:', error);
    }
  };

  const handleStartIndex = async () => {
    setIsStarting(true);
    try {
      const response = await aiApi.indexAll();
      if (response.data.success && response.data.data) {
        setTask(response.data.data.task);
        setShowConfirmDialog(false);
      }
    } catch (e: any) {
      console.error('Failed to start index:', e);
    } finally {
      setIsStarting(false);
    }
  };

  const renderTaskStatus = () => {
    if (!task || task.status === 'idle') {
      return (
        <p className="text-sm text-muted-foreground">
          当前没有正在运行的索引任务
        </p>
      );
    }

    const progress = task.total > 0 ? (task.processed / task.total) * 100 : 0;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {task.status === 'running' && (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm font-medium">正在索引...</span>
            </>
          )}
          {task.status === 'completed' && (
            <>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">索引完成</span>
            </>
          )}
          {task.status === 'failed' && (
            <>
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium">索引失败</span>
            </>
          )}
        </div>

        <div className="w-full bg-secondary rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>已处理: {task.processed} / {task.total}</span>
          {task.failed > 0 && <span className="text-red-500">失败: {task.failed}</span>}
        </div>

        {task.startedAt && (
          <p className="text-xs text-muted-foreground">
            开始时间: {formatDate(task.startedAt)}
          </p>
        )}
        {task.completedAt && (
          <p className="text-xs text-muted-foreground">
            完成时间: {formatDate(task.completedAt)}
          </p>
        )}
        {task.error && (
          <p className="text-xs text-red-500">{task.error}</p>
        )}
      </div>
    );
  };

  const isAIAvailable = aiStatus?.configured;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI 功能
        </h3>
        <p className="text-sm text-muted-foreground">
          配置 Cloudflare Workers AI 功能
        </p>
      </div>

      {!isAIAvailable && (
        <div className="border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            AI 功能未配置
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            请在 Cloudflare Dashboard 中配置 AI 和 Vectorize 绑定
          </p>
        </div>
      )}

      {isAIAvailable && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium">语义搜索索引</p>
              <p className="text-sm text-muted-foreground">
                为文件建立向量索引以支持语义搜索
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(true)}
              disabled={task?.status === 'running'}
            >
              <Database className="h-4 w-4 mr-2" />
              一键生成索引
            </Button>
          </div>

          {renderTaskStatus()}
        </div>
      )}

      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowConfirmDialog(false)} />
          <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-lg mx-4 p-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <h4 className="font-semibold">确认生成全量索引</h4>
            </div>

            <div className="space-y-3 text-sm">
              <p>
                此操作将为所有未建立索引的文件生成向量索引，用于语义搜索功能。
              </p>
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-2">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  ⚠️ 重要提示：
                </p>
                <ul className="text-amber-700 dark:text-amber-300 space-y-1 list-disc list-inside">
                  <li>此操作将处理您的所有文件数据</li>
                  <li>任务将在后台异步执行，可能需要较长时间</li>
                  <li>大量文件可能消耗 AI API 配额</li>
                  <li>索引期间可随时查看进度</li>
                </ul>
              </div>
              <p className="text-muted-foreground">
                确认后，系统将在后台自动处理所有文件，您可以继续使用其他功能。
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
                取消
              </Button>
              <Button onClick={handleStartIndex} disabled={isStarting}>
                {isStarting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                确认开始
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
