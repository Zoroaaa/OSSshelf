/**
 * Downloads.tsx - 离线下载任务管理页面
 * 支持：单条URL创建、批量URL导入、目标文件夹选择、存储桶选择
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { downloadsApi, bucketsApi } from '@/services/api';
import type { DownloadTask } from '@osshelf/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { useToast } from '@/components/ui/useToast';
import { FolderPickerDialog, type FolderSelection } from '@/components/files/dialogs';

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
  PauseCircle,
  ChevronDown,
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: '等待中', color: 'text-amber-500', icon: Clock },
  downloading: { label: '下载中', color: 'text-blue-500', icon: Loader2 },
  paused: { label: '已暂停', color: 'text-orange-500', icon: PauseCircle },
  completed: { label: '已完成', color: 'text-emerald-500', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-red-500', icon: XCircle },
};
const DEFAULT_STATUS = { label: '未知', color: 'text-muted-foreground', icon: Clock };

const ROOT_DESTINATION: FolderSelection = { id: null, name: '根目录', path: '/' };
const MAX_BATCH = 50;

type BatchResult = {
  created: number;
  failed: number;
  failedItems: Array<{ url: string; error: string }>;
};

/** 返回错误文案，合法时返回 null */
function validateHttpUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return '请输入文件 URL';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'URL 格式不正确';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '仅支持 http/https 链接';
  }
  return null;
}

function getApiErrorMessage(error: unknown): string | undefined {
  const err = error as { response?: { data?: { error?: { message?: string } } } };
  return err.response?.data?.error?.message;
}

function validateFileName(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value === '.' || value === '..') return '文件名不能为 . 或 ..';
  if (value.includes('/') || value.includes('\\')) return '文件名不能包含 / 或 \\';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return '文件名包含非法控制字符';
  }
  if (value.length > 255) return '文件名不能超过 255 个字符';
  return null;
}

// ── 文件夹选择字段 ─────────────────────────────────────────────────────────────
function FolderSelectField({
  selection,
  onOpen,
  onClear,
}: {
  selection: FolderSelection;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        保存到文件夹 <span className="font-normal text-muted-foreground">（可选）</span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className={cn(
            'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
            selection.id ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <FolderOpen className="h-4 w-4 flex-shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{selection.name}</span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{selection.path}</span>
          </span>
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        </button>
        {selection.id && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="flex-shrink-0"
            aria-label="清除目标文件夹"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── 清空确认 ───────────────────────────────────────────────────────────────────
function ConfirmClearDialog({
  title,
  description,
  isPending,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-downloads-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b px-5 py-4">
          <h2 id="clear-downloads-title" className="text-base font-semibold">
            {title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            确认清空
          </Button>
        </div>
      </div>
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
  onOpenFolder,
  actionPending,
}: {
  task: DownloadTask;
  onDelete: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  onOpenFolder?: () => void;
  actionPending?: boolean;
}) {
  const status = STATUS_CONFIG[task.status] ?? DEFAULT_STATUS;
  const hasSize = typeof task.fileSize === 'number' && task.fileSize > 0;
  const progress = hasSize ? Math.round(task.progress || 0) : 0;
  const isDownloading = task.status === 'downloading';
  const StatusIcon = status.icon;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-start">
      <div
        className={cn(
          'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
          isDownloading ? 'bg-blue-500/10' : task.status === 'paused' ? 'bg-orange-500/10' : 'bg-muted'
        )}
      >
        <StatusIcon
          className={cn(
            'h-5 w-5',
            isDownloading
              ? 'animate-spin text-blue-500'
              : task.status === 'paused'
                ? 'text-orange-500'
                : 'text-muted-foreground'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{task.fileName}</span>
          <span className={cn('inline-flex items-center gap-1 text-xs', status.color)}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {status.label}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Link className="h-3 w-3 flex-shrink-0" />
          <span className="truncate" title={task.url}>
            {task.url}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          {hasSize ? <span>{formatBytes(task.fileSize ?? 0)}</span> : null}
          {(isDownloading || task.status === 'paused') && hasSize ? <span>{progress}%</span> : null}
          <span>{formatDate(task.createdAt)}</span>
        </div>
        {isDownloading && !hasSize && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
        {(isDownloading || task.status === 'paused') && hasSize && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn('h-full transition-all', task.status === 'paused' ? 'bg-orange-500' : 'bg-primary')}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {task.errorMessage && (
          <p className="mt-1 whitespace-pre-wrap break-all text-xs text-red-500" title={task.errorMessage}>
            {task.errorMessage}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 sm:flex-shrink-0">
        {(isDownloading || task.status === 'pending') && onPause && (
          <Button variant="outline" size="sm" disabled={actionPending} onClick={onPause}>
            <PauseCircle className="mr-1 h-3.5 w-3.5" />
            暂停
          </Button>
        )}
        {task.status === 'paused' && onResume && (
          <Button variant="outline" size="sm" disabled={actionPending} onClick={onResume}>
            <RotateCw className="mr-1 h-3.5 w-3.5" />
            恢复
          </Button>
        )}
        {task.status === 'failed' && onRetry && (
          <Button variant="outline" size="sm" disabled={actionPending} onClick={onRetry}>
            <RotateCw className="mr-1 h-3.5 w-3.5" />
            重试
          </Button>
        )}
        {task.status === 'completed' && onOpenFolder && (
          <Button variant="ghost" size="sm" onClick={onOpenFolder}>
            <FolderOpen className="mr-1 h-3.5 w-3.5" />
            打开所在文件夹
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="text-red-500 hover:text-red-600"
          aria-label="删除任务"
          title={isDownloading ? '请先暂停后再删除' : '删除任务'}
          disabled={isDownloading || actionPending}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── 主页面 ─────────────────────────────────────────────────────────────────────
export default function Downloads() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [showForm, setShowForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [destination, setDestination] = useState<FolderSelection>(ROOT_DESTINATION);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [batchText, setBatchText] = useState('');
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [confirmClear, setConfirmClear] = useState<'completed' | 'failed' | null>(null);

  const { data: bucketsRes } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => bucketsApi.list().then((r) => r.data.data),
  });
  const buckets = bucketsRes ?? [];

  const {
    data: result,
    isLoading,
    isFetching,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['downloads'],
    queryFn: () => downloadsApi.list().then((r) => r.data.data),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((t) => t.status === 'pending' || t.status === 'downloading') ? 5000 : false;
    },
  });
  const tasks = result?.items ?? [];
  const bucketLocked = destination.id !== null;

  const urlError = newUrl.trim() ? validateHttpUrl(newUrl) : null;
  const fileNameError = validateFileName(newFileName);

  const batchInfo = useMemo(() => {
    const lines = batchText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const unique = Array.from(new Set(lines));
    const invalid = unique.filter((url) => validateHttpUrl(url) !== null);
    return {
      total: lines.length,
      unique,
      invalid,
      duplicates: lines.length - unique.length,
      validCount: unique.length - invalid.length,
      overLimit: unique.length > MAX_BATCH,
    };
  }, [batchText]);

  const resetForm = () => {
    setNewUrl('');
    setNewFileName('');
    setDestination(ROOT_DESTINATION);
    setBucketId(null);
    setBatchText('');
    setFolderPickerOpen(false);
    setShowForm(false);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      downloadsApi.create({
        url: newUrl.trim(),
        fileName: newFileName.trim() || undefined,
        parentId: destination.id,
        bucketId: destination.id ? null : bucketId,
      }),
    onSuccess: () => {
      toast({ title: '下载任务已创建' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
      resetForm();
    },
    onError: (e: unknown) => toast({ title: '创建失败', description: getApiErrorMessage(e), variant: 'destructive' }),
  });

  const batchMutation = useMutation({
    mutationFn: (urls: string[]) =>
      downloadsApi.batch({ urls, parentId: destination.id, bucketId: destination.id ? null : bucketId }),
    onSuccess: (res) => {
      const data = res.data.data;
      if (data) setBatchResult(data);
      toast({
        title: `批量导入完成：${data?.created ?? 0} 成功，${data?.failed ?? 0} 失败`,
      });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
      resetForm();
    },
    onError: (e: unknown) =>
      toast({ title: '批量导入失败', description: getApiErrorMessage(e), variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => downloadsApi.delete(id),
    onSuccess: () => {
      toast({ title: '任务已删除' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
    onError: (e: unknown) => toast({ title: '删除失败', description: getApiErrorMessage(e), variant: 'destructive' }),
  });
  const retryMutation = useMutation({
    mutationFn: (id: string) => downloadsApi.retry(id),
    onSuccess: () => {
      toast({ title: '任务已重试' });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
    onError: (e: unknown) => toast({ title: '重试失败', description: getApiErrorMessage(e), variant: 'destructive' }),
  });
  const pauseMutation = useMutation({
    mutationFn: (id: string) => downloadsApi.pause(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['downloads'] }),
    onError: (e: unknown) => toast({ title: '暂停失败', description: getApiErrorMessage(e), variant: 'destructive' }),
  });
  const resumeMutation = useMutation({
    mutationFn: (id: string) => downloadsApi.resume(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['downloads'] }),
    onError: (e: unknown) => toast({ title: '恢复失败', description: getApiErrorMessage(e), variant: 'destructive' }),
  });
  const clearCompletedMutation = useMutation({
    mutationFn: () => downloadsApi.clearCompleted(),
    onSuccess: (r) => {
      toast({ title: `已清理 ${r.data.data?.count || 0} 个已完成任务` });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
      setConfirmClear(null);
    },
    onError: (e: unknown) => {
      toast({ title: '清空失败', description: getApiErrorMessage(e), variant: 'destructive' });
      setConfirmClear(null);
    },
  });
  const clearFailedMutation = useMutation({
    mutationFn: () => downloadsApi.clearFailed(),
    onSuccess: (r) => {
      toast({ title: `已清理 ${r.data.data?.count || 0} 个失败任务` });
      queryClient.invalidateQueries({ queryKey: ['downloads'] });
      setConfirmClear(null);
    },
    onError: (e: unknown) => {
      toast({ title: '清空失败', description: getApiErrorMessage(e), variant: 'destructive' });
      setConfirmClear(null);
    },
  });

  const activeTasks = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'downloading' || t.status === 'paused'
  );
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');
  const lastUpdated =
    dataUpdatedAt > 0
      ? new Date(dataUpdatedAt).toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : null;

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div>
        <h1 className="text-xl font-bold lg:text-2xl">离线下载</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">创建和管理离线下载任务</p>
      </div>

      {/* 按钮区域 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {lastUpdated && <span className="text-xs text-muted-foreground">更新于 {lastUpdated}</span>}
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')} />
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
              <Plus className="mr-1.5 h-4 w-4" />
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
              <ListPlus className="mr-1.5 h-4 w-4" />
              批量导入
            </Button>
          </>
        )}
      </div>

      {/* 上次批量导入结果 */}
      {batchResult && (
        <Card className={batchResult.failed > 0 ? 'border-amber-500/30' : undefined}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">上次批量导入结果</CardTitle>
                <CardDescription>
                  成功 {batchResult.created} 条 · 失败 {batchResult.failed} 条
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setBatchResult(null)}>
                <X className="mr-1 h-3.5 w-3.5" />
                关闭
              </Button>
            </div>
          </CardHeader>
          {batchResult.failedItems.length > 0 && (
            <CardContent className="space-y-2">
              {batchResult.failedItems.map((item, index) => (
                <div
                  key={`${item.url}-${index}`}
                  className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2"
                >
                  <p className="truncate font-mono text-xs text-muted-foreground" title={item.url}>
                    {item.url}
                  </p>
                  <p className="mt-0.5 text-xs text-red-500">{item.error}</p>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

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
                    : `每行一条 URL，最多 ${MAX_BATCH} 条（当前 ${batchInfo.total} 条）`}
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
                  <label htmlFor="download-url" className="text-sm font-medium">
                    文件 URL <span className="text-red-500">*</span>
                  </label>
                  <Input
                    id="download-url"
                    placeholder="https://example.com/file.zip"
                    value={newUrl}
                    aria-invalid={!!urlError}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                  {urlError && <p className="text-xs text-red-500">{urlError}</p>}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="download-file-name" className="text-sm font-medium">
                    保存文件名 <span className="font-normal text-muted-foreground">（可选）</span>
                  </label>
                  <Input
                    id="download-file-name"
                    placeholder="留空则使用原文件名"
                    value={newFileName}
                    aria-invalid={!!fileNameError}
                    onChange={(e) => setNewFileName(e.target.value)}
                  />
                  {fileNameError && <p className="text-xs text-red-500">{fileNameError}</p>}
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="download-batch-urls" className="text-sm font-medium">
                  URL 列表 <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="download-batch-urls"
                  className="min-h-[140px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={'https://example.com/file1.zip\nhttps://example.com/file2.zip'}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">有效 {batchInfo.validCount} 条</span>
                  {batchInfo.duplicates > 0 && (
                    <span className="text-amber-600">已自动去重 {batchInfo.duplicates} 条</span>
                  )}
                  {batchInfo.invalid.length > 0 && (
                    <span className="text-red-500">{batchInfo.invalid.length} 条 URL 格式不正确</span>
                  )}
                  {batchInfo.overLimit && <span className="text-red-500">最多 {MAX_BATCH} 条</span>}
                </div>
              </div>
            )}

            <FolderSelectField
              selection={destination}
              onOpen={() => setFolderPickerOpen(true)}
              onClear={() => setDestination(ROOT_DESTINATION)}
            />

            {buckets.length > 1 && (
              <div className="space-y-1.5">
                <label htmlFor="download-bucket" className="text-sm font-medium">
                  存储桶 {!bucketLocked && <span className="font-normal text-muted-foreground">（可选）</span>}
                </label>
                <select
                  id="download-bucket"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  value={bucketId ?? ''}
                  disabled={bucketLocked}
                  onChange={(e) => setBucketId(e.target.value || null)}
                >
                  <option value="">默认存储桶</option>
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {bucketLocked && (
                  <p className="text-xs text-muted-foreground">已选择目标文件夹，存储桶将由文件夹所在位置决定</p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              {mode === 'single' ? (
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!newUrl.trim() || !!urlError || !!fileNameError || createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  创建任务
                </Button>
              ) : (
                <Button
                  onClick={() => batchMutation.mutate(batchInfo.unique)}
                  disabled={
                    batchInfo.unique.length === 0 ||
                    batchInfo.invalid.length > 0 ||
                    batchInfo.overLimit ||
                    batchMutation.isPending
                  }
                >
                  {batchMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ListPlus className="mr-2 h-4 w-4" />
                  )}
                  导入 {batchInfo.validCount > 0 ? `${batchInfo.validCount} 条` : ''}
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
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
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
                      actionPending={
                        (pauseMutation.isPending && pauseMutation.variables === task.id) ||
                        (resumeMutation.isPending && resumeMutation.variables === task.id) ||
                        (deleteMutation.isPending && deleteMutation.variables === task.id)
                      }
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
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10">
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
                    onClick={() => setConfirmClear('failed')}
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
                      actionPending={
                        (retryMutation.isPending && retryMutation.variables === task.id) ||
                        (deleteMutation.isPending && deleteMutation.variables === task.id)
                      }
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
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
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
                    onClick={() => setConfirmClear('completed')}
                    disabled={clearCompletedMutation.isPending}
                  >
                    清空已完成
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {completedTasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      actionPending={deleteMutation.isPending && deleteMutation.variables === task.id}
                      onDelete={() => deleteMutation.mutate(task.id)}
                      onOpenFolder={() => navigate(task.parentId ? `/files/${task.parentId}` : '/files')}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {tasks.length === 0 && !showForm && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Download className="h-10 w-10 opacity-30" />
              <p className="text-sm">暂无下载任务</p>
              <Button
                size="sm"
                onClick={() => {
                  setMode('single');
                  setShowForm(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                新建下载
              </Button>
            </div>
          )}
        </>
      )}

      {folderPickerOpen && (
        <FolderPickerDialog
          mode="save"
          initialSelection={destination}
          onConfirm={(selection) => {
            setDestination(selection);
            setFolderPickerOpen(false);
            if (selection.id !== null) setBucketId(null);
          }}
          onCancel={() => setFolderPickerOpen(false)}
        />
      )}

      {confirmClear && (
        <ConfirmClearDialog
          title={confirmClear === 'completed' ? '清空已完成任务？' : '清空失败任务？'}
          description="仅删除任务记录，不会删除已下载的文件。"
          isPending={confirmClear === 'completed' ? clearCompletedMutation.isPending : clearFailedMutation.isPending}
          onConfirm={() => {
            if (confirmClear === 'completed') clearCompletedMutation.mutate();
            else clearFailedMutation.mutate();
          }}
          onCancel={() => setConfirmClear(null)}
        />
      )}
    </div>
  );
}
