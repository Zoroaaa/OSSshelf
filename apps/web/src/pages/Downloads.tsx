/**
 * Downloads.tsx - 离线下载任务管理页面
 * 支持：单条URL创建、批量URL导入、目标文件夹选择、存储桶选择
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { downloadsApi, bucketsApi } from '@/services/api';
import type { DownloadTask } from '@osshelf/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { useToast } from '@/components/ui/useToast';
import { MoveFolderPicker } from '@/components/files/dialogs';

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
  FolderOpen,
  ListPlus,
  X,
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: '等待中', color: 'text-amber-500', icon: Clock },
  downloading: { label: '下载中', color: 'text-blue-500', icon: Loader2 },
  paused: { label: '已暂停', color: 'text-orange-500', icon: AlertTriangle },
  completed: { label: '已完成', color: 'text-emerald-500', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-red-500', icon: XCircle },
};
const DEFAULT_STATUS = { label: '未知', color: 'text-muted-foreground', icon: Clock };

// ── 文件夹选择字段 ─────────────────────────────────────────────────────────────
function FolderSelectField({
  parentId,
  parentName,
  onChange,
}: {
  parentId: string | null;
  parentName: string;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">保存到文件夹（可选）</label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md border text-sm w-full text-left hover:bg-accent transition-colors',
            parentId ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <FolderOpen className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{parentName}</span>
        </button>
        {parentId && (
          <Button type="button" variant="ghost" size="icon" className="flex-shrink-0" onClick={() => onChange(null)}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {open && (
        <div className="border rounded-lg p-3 bg-background shadow-sm">
          <MoveFolderPicker
            excludeIds={[]}
            onConfirm={(id) => {
              onChange(id);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── 任务卡片 ───────────────────────────────────────────────────────────────────
function TaskItem({
  task,
  onDelete,
  onPause,
  onResume,
  onRetry,
}: {
  task: DownloadTask;
  onDelete: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
}) {
  const status = STATUS_CONFIG[task.status] ?? DEFAULT_STATUS;
  const progress = task.fileSize && task.fileSize > 0 ? Math.round(task.progress || 0) : 0;
  const StatusIcon = status.icon;
  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border bg-muted/30">
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
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
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{task.fileName}</span>
          <span className={cn('flex items-center gap-1 text-xs', status.color)}>
            <StatusIcon className={cn('h-3 w-3', task.status === 'downloading' && 'animate-spin')} />
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <Link className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{task.url}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          {task.fileSize ? <span>{formatBytes(task.fileSize)}</span> : null}
          {(task.status === 'downloading' || task.status === 'paused') && task.fileSize ? (
            <span>{progress}%</span>
          ) : null}
          <span>{formatDate(task.createdAt)}</span>
        </div>
        {(task.status === 'downloading' || task.status === 'paused') && task.fileSize && task.fileSize > 0 && (
          <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn('h-full transition-all', task.status === 'paused' ? 'bg-orange-500' : 'bg-primary')}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {task.errorMessage && <p className="text-xs text-red-500 mt-1 truncate">{task.errorMessage}</p>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {(task.status === 'downloading' || task.status === 'pending') && onPause && (
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

// ── 主页面 ─────────────────────────────────────────────────────────────────────
export default function Downloads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [showForm, setShowForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [parentName, setParentName] = useState('根目录');
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [batchText, setBatchText] = useState('');

  const { data: bucketsRes } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => bucketsApi.list().then((r) => r.data.data),
  });
  const buckets = bucketsRes ?? [];

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

  const resetForm = () => {
    setNewUrl('');
    setNewFileName('');
    setParentId(null);
    setParentName('根目录');
    setBucketId(null);
    setBatchText('');
    setShowForm(false);
  };

  const handleFolderChange = (id: string | null) => {
    setParentId(id);
    setParentName(id === null ? '根目录' : '已选文件夹');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      downloadsApi.create({ url: newUrl.trim(), fileName: newFileName.trim() || undefined, parentId, bucketId }),
    onSuccess: () => {
      toast({ title: '下载任务已创建' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
      resetForm();
    },
    onError: (e: any) =>
      toast({ title: '创建失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const batchMutation = useMutation({
    mutationFn: () => {
      const urls = batchText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      return downloadsApi.batch({ urls, parentId, bucketId });
    },
    onSuccess: (res) => {
      const d = res.data.data;
      toast({ title: `批量导入完成：${d?.created ?? 0} 成功，${d?.failed ?? 0} 失败` });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
      resetForm();
    },
    onError: (e: any) =>
      toast({ title: '批量导入失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => downloadsApi.delete(id),
    onSuccess: () => {
      toast({ title: '任务已删除' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
  const retryMutation = useMutation({
    mutationFn: (id: string) => downloadsApi.retry(id),
    onSuccess: () => {
      toast({ title: '任务已重试' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
  const pauseMutation = useMutation({
    mutationFn: (id: string) => downloadsApi.pause(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['downloads'] }),
  });
  const resumeMutation = useMutation({
    mutationFn: (id: string) => downloadsApi.resume(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['downloads'] }),
  });
  const clearCompletedMutation = useMutation({
    mutationFn: () => downloadsApi.clearCompleted(),
    onSuccess: (r) => {
      toast({ title: `已清理 ${r.data.data?.count || 0} 个已完成任务` });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
  const clearFailedMutation = useMutation({
    mutationFn: () => downloadsApi.clearFailed(),
    onSuccess: (r) => {
      toast({ title: `已清理 ${r.data.data?.count || 0} 个失败任务` });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });

  const activeTasks = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'downloading' || t.status === 'paused'
  );
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');
  const batchCount = batchText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0).length;

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold">离线下载</h1>
        <p className="text-muted-foreground text-sm mt-0.5">创建和管理离线下载任务</p>
      </div>

      {/* 按钮区域 */}
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          刷新
        </Button>
        {!showForm && (
          <>
            <Button
              size="sm"
              onClick={() => {
                setMode('single');
                setShowForm(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              新建下载
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMode('batch');
                setShowForm(true);
              }}
            >
              <ListPlus className="h-4 w-4 mr-1.5" />
              批量导入
            </Button>
          </>
        )}
      </div>

      {/* 创建/导入表单 */}
      {showForm && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">{mode === 'single' ? '新建离线下载' : '批量 URL 导入'}</CardTitle>
                <CardDescription>
                  {mode === 'single'
                    ? '输入文件 URL 创建下载任务'
                    : `每行一条 URL，最多 50 条（当前 ${batchCount} 条）`}
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button variant={mode === 'single' ? 'default' : 'outline'} size="sm" onClick={() => setMode('single')}>
                  单条
                </Button>
                <Button variant={mode === 'batch' ? 'default' : 'outline'} size="sm" onClick={() => setMode('batch')}>
                  批量
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode === 'single' ? (
              <>
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
              </>
            ) : (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">URL 列表（每行一条）</label>
                <textarea
                  className="w-full min-h-[140px] rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  placeholder={'https://example.com/file1.zip\nhttps://example.com/file2.zip'}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                />
              </div>
            )}

            <FolderSelectField parentId={parentId} parentName={parentName} onChange={handleFolderChange} />

            {buckets.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">存储桶（可选）</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={bucketId ?? ''}
                  onChange={(e) => setBucketId(e.target.value || null)}
                >
                  <option value="">默认存储桶</option>
                  {buckets.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-2">
              {mode === 'single' ? (
                <Button onClick={() => createMutation.mutate()} disabled={!newUrl.trim() || createMutation.isPending}>
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  创建任务
                </Button>
              ) : (
                <Button
                  onClick={() => batchMutation.mutate()}
                  disabled={batchCount === 0 || batchCount > 50 || batchMutation.isPending}
                >
                  {batchMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ListPlus className="h-4 w-4 mr-2" />
                  )}
                  导入 {batchCount > 0 ? `${batchCount} 条` : ''}
                </Button>
              )}
              <Button variant="outline" onClick={resetForm}>
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
                    <TaskItem
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
                    <TaskItem
                      key={task.id}
                      task={task}
                      onDelete={() => deleteMutation.mutate(task.id)}
                      onRetry={() => retryMutation.mutate(task.id)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {completedTasks.length > 0 && (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </div>
                    <div>
                      <CardTitle className="text-base">已完成</CardTitle>
                      <CardDescription>{completedTasks.length} 个任务已完成</CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clearCompletedMutation.mutate()}
                    disabled={clearCompletedMutation.isPending}
                  >
                    清空已完成
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {completedTasks.map((task) => (
                    <TaskItem key={task.id} task={task} onDelete={() => deleteMutation.mutate(task.id)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {tasks.length === 0 && !showForm && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Download className="h-10 w-10 opacity-30" />
              <p className="text-sm">暂无下载任务</p>
              <Button
                size="sm"
                onClick={() => {
                  setMode('single');
                  setShowForm(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                新建下载
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
