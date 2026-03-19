/**
 * Downloads.tsx
 * 离线下载任务管理页面
 *
 * 功能:
 * - 创建离线下载任务
 * - 查看下载任务状态
 * - 管理下载任务
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { downloadsApi } from '@/services/api';
import type { DownloadTask } from '@osshelf/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { formatBytes, formatDate } from '@/utils';
import { cn } from '@/utils';
import {
  Download,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RotateCw,
  Link,
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: '等待中', color: 'text-amber-500', icon: Clock },
  downloading: { label: '下载中', color: 'text-blue-500', icon: Loader2 },
  paused: { label: '已暂停', color: 'text-orange-500', icon: AlertTriangle },
  completed: { label: '已完成', color: 'text-emerald-500', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-red-500', icon: XCircle },
};

const DEFAULT_STATUS: { label: string; color: string; icon: typeof Clock } = {
  label: '未知',
  color: 'text-muted-foreground',
  icon: Clock,
};

export default function Downloads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newUrl, setNewUrl] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const {
    data: result,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['downloads'],
    queryFn: () => downloadsApi.list().then((r) => r.data.data),
    refetchInterval: 5000,
  });

  const tasks = result?.items ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      downloadsApi.create({
        url: newUrl,
        fileName: newFileName || undefined,
      }),
    onSuccess: () => {
      toast({ title: '下载任务已创建' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
      setNewUrl('');
      setNewFileName('');
      setShowCreateForm(false);
    },
    onError: (e: any) =>
      toast({
        title: '创建失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => downloadsApi.retry(taskId),
    onSuccess: () => {
      toast({ title: '任务已重试' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
    onError: (e: any) =>
      toast({
        title: '重试失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => downloadsApi.delete(taskId),
    onSuccess: () => {
      toast({ title: '任务已删除' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
    onError: (e: any) =>
      toast({
        title: '删除失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const clearCompletedMutation = useMutation({
    mutationFn: () => downloadsApi.clearCompleted(),
    onSuccess: (res) => {
      toast({ title: `已清理 ${res.data.data?.count || 0} 个已完成任务` });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });

  const clearFailedMutation = useMutation({
    mutationFn: () => downloadsApi.clearFailed(),
    onSuccess: (res) => {
      toast({ title: `已清理 ${res.data.data?.count || 0} 个失败任务` });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (taskId: string) => downloadsApi.pause(taskId),
    onSuccess: () => {
      toast({ title: '任务已暂停' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
    onError: (e: any) =>
      toast({
        title: '暂停失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const resumeMutation = useMutation({
    mutationFn: (taskId: string) => downloadsApi.resume(taskId),
    onSuccess: () => {
      toast({ title: '任务已恢复' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
    onError: (e: any) =>
      toast({
        title: '恢复失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const activeTasks = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'downloading' || t.status === 'paused'
  );
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">离线下载</h1>
          <p className="text-muted-foreground text-sm mt-0.5">创建和管理离线下载任务</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            刷新
          </Button>
          <Button size="sm" onClick={() => setShowCreateForm(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            新建下载
          </Button>
        </div>
      </div>

      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <p className="font-medium text-blue-600 dark:text-blue-400">使用说明</p>
              <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                <li>
                  输入<strong>公开可访问的文件下载链接</strong>（直链）
                </li>
                <li>
                  支持的链接示例：
                  <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-xs">https://example.com/file.zip</code>
                </li>
                <li>GitHub Release、软件官网直链、网盘公开分享链接等均可使用</li>
                <li>不支持需要登录认证的链接或加密链接</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {showCreateForm && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">新建离线下载</CardTitle>
            <CardDescription>输入文件 URL 创建下载任务</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">文件 URL</label>
              <Input
                placeholder="https://example.com/file.zip"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">保存文件名（可选）</label>
              <Input
                placeholder="留空则使用原文件名"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => createMutation.mutate()} disabled={!newUrl.trim() || createMutation.isPending}>
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                创建任务
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewUrl('');
                  setNewFileName('');
                }}
              >
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {activeTasks.length > 0 && (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Download className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">进行中的任务</CardTitle>
                    <CardDescription>{activeTasks.length} 个任务正在处理</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {activeTasks.map((task) => (
                    <DownloadTaskItem
                      key={task.id}
                      task={task}
                      onDelete={() => deleteMutation.mutate(task.id)}
                      onPause={() => pauseMutation.mutate(task.id)}
                      onResume={() => resumeMutation.mutate(task.id)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {failedTasks.length > 0 && (
            <Card className="border-red-500/20">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    </div>
                    <div>
                      <CardTitle className="text-base">失败的任务</CardTitle>
                      <CardDescription>{failedTasks.length} 个任务失败</CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clearFailedMutation.mutate()}
                    disabled={clearFailedMutation.isPending}
                  >
                    清空失败
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {failedTasks.map((task) => (
                    <DownloadTaskItem
                      key={task.id}
                      task={task}
                      onRetry={() => retryMutation.mutate(task.id)}
                      onDelete={() => deleteMutation.mutate(task.id)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">已完成的任务</CardTitle>
                    <CardDescription>{completedTasks.length} 个任务已完成</CardDescription>
                  </div>
                </div>
                {completedTasks.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clearCompletedMutation.mutate()}
                    disabled={clearCompletedMutation.isPending}
                  >
                    清空已完成
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {completedTasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">暂无已完成的下载任务</div>
              ) : (
                <div className="space-y-3">
                  {completedTasks.map((task) => (
                    <DownloadTaskItem key={task.id} task={task} onDelete={() => deleteMutation.mutate(task.id)} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {tasks.length === 0 && !showCreateForm && (
            <div className="text-center py-16 text-muted-foreground">
              <Download className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">暂无下载任务</p>
              <p className="text-sm mt-1">点击"新建下载"创建离线下载任务</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DownloadTaskItem({
  task,
  onRetry,
  onDelete,
  onPause,
  onResume,
}: {
  task: DownloadTask;
  onRetry?: () => void;
  onDelete: () => void;
  onPause?: () => void;
  onResume?: () => void;
}) {
  const status = STATUS_CONFIG[task.status] ?? DEFAULT_STATUS;
  const progress = task.fileSize && task.fileSize > 0 ? Math.round(task.progress || 0) : 0;
  const StatusIcon = status.icon;

  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border bg-muted/30">
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          task.status === 'downloading' ? 'bg-blue-500/10' : task.status === 'paused' ? 'bg-orange-500/10' : 'bg-muted'
        )}
      >
        <StatusIcon
          className={cn(
            'h-5 w-5',
            task.status === 'downloading'
              ? 'text-blue-500 animate-spin'
              : task.status === 'paused'
                ? 'text-orange-500'
                : 'text-muted-foreground'
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{task.fileName}</span>
          <span className={cn('flex items-center gap-1 text-xs', status.color)}>
            <StatusIcon className={cn('h-3 w-3', task.status === 'downloading' && 'animate-spin')} />
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <Link className="h-3 w-3" />
          <span className="truncate max-w-[300px]">{task.url}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          {task.fileSize && <span>{formatBytes(task.fileSize)}</span>}
          {(task.status === 'downloading' || task.status === 'paused') && task.fileSize && <span>{progress}%</span>}
          <span>{formatDate(task.createdAt)}</span>
        </div>
        {(task.status === 'downloading' || task.status === 'paused') && task.fileSize && task.fileSize > 0 && (
          <div className="mt-2">
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn('h-full transition-all', task.status === 'paused' ? 'bg-orange-500' : 'bg-primary')}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{progress}%</p>
          </div>
        )}
        {task.errorMessage && <p className="text-xs text-red-500 mt-1">{task.errorMessage}</p>}
      </div>

      <div className="flex items-center gap-1">
        {task.status === 'downloading' && onPause && (
          <Button variant="outline" size="sm" onClick={onPause}>
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            暂停
          </Button>
        )}
        {task.status === 'paused' && onResume && (
          <Button variant="outline" size="sm" onClick={onResume}>
            <RotateCw className="h-3.5 w-3.5 mr-1" />
            恢复
          </Button>
        )}
        {task.status === 'pending' && onPause && (
          <Button variant="outline" size="sm" onClick={onPause}>
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            暂停
          </Button>
        )}
        {task.status === 'failed' && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw className="h-3.5 w-3.5 mr-1" />
            重试
          </Button>
        )}
        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
