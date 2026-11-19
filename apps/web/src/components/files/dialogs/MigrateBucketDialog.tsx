/**
 * MigrateBucketDialog.tsx
 * 存储桶迁移对话框
 *
 * 功能:
 * - 支持全桶迁移和单文件/文件夹粒度迁移
 * - 单文件模式：自动推断来源桶，展示文件信息
 * - 文件夹模式：显示递归迁移提示
 * - 服务端按批次推进，前端循环调用 /run 直到终态并实时展示进度
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bucketsApi, migrateApi, filesApi, type StorageBucket, type MigrationStatus } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { formatBytes, decodeFileName } from '@/utils';
import {
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRightLeft,
  X,
  Folder,
  FileText,
} from 'lucide-react';
import type { FileItem } from '@osshelf/shared';

interface Props {
  /** 单个文件/文件夹换桶时传入（Phase 5 增强） */
  file?: FileItem;
  /** 预填的来源存储桶 ID（可选） */
  defaultSourceId?: string;
  /** 可选：仅迁移指定文件 ID */
  fileIds?: string[];
  onClose: () => void;
}

export function MigrateBucketDialog({ file, defaultSourceId, fileIds: _fileIds, onClose }: Props) {
  const [sourceId, setSourceId] = useState(defaultSourceId ?? '');
  const [targetId, setTargetId] = useState('');
  const [deleteSource, setDeleteSource] = useState(true);
  const [migrationId, setMigrationId] = useState<string | null>(null);
  const [migStatus, setMigStatus] = useState<MigrationStatus | undefined>();
  const [driveError, setDriveError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // ── 单文件模式：自动推断来源桶 ──────────────────────────────
  useEffect(() => {
    if (file && !defaultSourceId) {
      const bucketId = (file as any).bucketId;
      if (bucketId) {
        setSourceId(bucketId);
      }
    }
  }, [file, defaultSourceId]);

  // 构建实际的 fileIds
  const fileIds = file ? [file.id] : _fileIds;

  // 获取文件夹详情（用于显示递归统计）
  const { data: folderDetail } = useQuery({
    queryKey: ['file-detail', file?.id],
    queryFn: () => filesApi.getFileDetail(file!.id),
    enabled: !!file?.isFolder,
  });

  const { data: bucketsData } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => bucketsApi.list().then((r) => r.data.data ?? []),
  });
  const buckets: StorageBucket[] = bucketsData ?? [];

  // 过滤掉当前源桶
  const targetBuckets = buckets.filter((b) => b.id !== sourceId);

  // 服务端按批次推进，前端循环驱动直到终态
  useEffect(() => {
    if (!migrationId) return;
    let stopped = false;
    migrateApi
      .runToCompletion(
        migrationId,
        (status) => {
          if (!stopped) setMigStatus(status);
        },
        () => stopped
      )
      .then((status) => {
        if (stopped) return;
        setMigStatus(status);
        queryClient.invalidateQueries({ queryKey: ['files'] });
        queryClient.invalidateQueries({ queryKey: ['buckets'] });
      })
      .catch((error) => {
        if (!stopped) setDriveError(error instanceof Error ? error.message : '迁移执行失败');
      });
    return () => {
      stopped = true;
    };
  }, [migrationId, queryClient]);

  const startMutation = useMutation({
    mutationFn: () =>
      migrateApi
        .start({
          sourceBucketId: sourceId || '',
          targetBucketId: targetId,
          deleteSource,
          fileIds,
        })
        .then((r) => r.data),
    onSuccess: (res) => {
      setMigrationId(res.data?.migrationId ?? null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => migrateApi.cancel(migrationId!),
  });

  const canStart = sourceId && targetId && sourceId !== targetId && !migrationId;
  const isRunning =
    !!migrationId &&
    migStatus?.status !== 'completed' &&
    migStatus?.status !== 'failed' &&
    migStatus?.status !== 'cancelled';
  const isDone =
    migStatus?.status === 'completed' || migStatus?.status === 'failed' || migStatus?.status === 'cancelled';

  const pct = (() => {
    if (!migStatus) return 0;
    if (migStatus.phase === 'cleaning' && migStatus.cleanupKeys?.length) {
      return Math.round(((migStatus.cleanupDone ?? 0) / migStatus.cleanupKeys.length) * 100);
    }
    if (migStatus.phase === 'moving' && migStatus.moveIds.length) {
      return Math.round(((migStatus.moveDone ?? 0) / migStatus.moveIds.length) * 100);
    }
    if (migStatus.phase === 'completed') return 100;
    return Math.round(((migStatus.done + migStatus.failed) / Math.max(1, migStatus.total)) * 100);
  })();

  const phaseLabel = (() => {
    if (!migStatus) return '';
    if (migStatus.phase === 'cleaning') {
      return `清理来源桶 ${migStatus.cleanupDone ?? 0} / ${migStatus.cleanupKeys?.length ?? 0}`;
    }
    if (migStatus.phase === 'moving') {
      return `移动到目标目录 ${migStatus.moveDone ?? 0} / ${migStatus.moveIds.length}`;
    }
    if (migStatus.status === 'running') return '拷贝文件中...';
    if (migStatus.status === 'completed') return '迁移完成';
    if (migStatus.status === 'cancelled') return '已取消';
    return '迁移失败';
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">{file ? '换桶' : '存储桶迁移'}</h2>
          </div>
          {!isRunning && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 单文件信息卡片 */}
        {file && (
          <div className="bg-muted/30 rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm">
              {file.isFolder ? (
                <Folder className="h-4 w-4 text-amber-500" />
              ) : (
                <FileText className="h-4 w-4 text-blue-500" />
              )}
              <span className="font-medium truncate">{decodeFileName(file.name)}</span>
            </div>
            {file.isFolder && folderDetail?.data && folderDetail.data.totalFileCount > 0 && (
              <p className="text-xs text-muted-foreground pl-6">
                将递归迁移所有子文件（共 {folderDetail.data.totalFileCount} 个， 总大小{' '}
                {formatBytes(folderDetail.data.totalSize)})
              </p>
            )}
          </div>
        )}

        {/* Bucket selectors */}
        {!migrationId && (
          <div className="space-y-3">
            {!file && fileIds?.length && (
              <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
                仅迁移已选中的 <span className="font-medium">{fileIds.length}</span> 个文件
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">来源存储桶</label>
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                disabled={!!file} // 单文件模式下锁定
              >
                <option value="">请选择来源存储桶</option>
                {buckets.map((b) => (
                  <option key={b.id} value={b.id} disabled={b.id === targetId}>
                    {b.name} ({b.provider}) — {formatBytes(b.storageUsed)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-center">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">目标存储桶</label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">请选择目标存储桶</option>
                {targetBuckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.provider}) — {formatBytes(b.storageUsed)}
                  </option>
                ))}
              </select>
              {targetBuckets.length === 0 && sourceId && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">没有可用的目标存储桶</p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteSource}
                onChange={(e) => setDeleteSource(e.target.checked)}
                className="rounded"
              />
              <span>迁移后清理来源桶中的对象（移动模式）</span>
            </label>

            {deleteSource && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                仅在该文件拷贝并切换成功后才清理来源对象；失败的文件会保留在来源桶
              </p>
            )}

          </div>
        )}

        {driveError && (
          <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{driveError}</p>
        )}

        {migrationId && !migStatus && !driveError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在启动迁移...
          </div>
        )}

        {/* Progress */}
        {migStatus && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{phaseLabel}</span>
              <span className="font-medium tabular-nums">
                {migStatus.phase === 'copying' || migStatus.phase === 'completed'
                  ? `${migStatus.done + migStatus.failed} / ${migStatus.total}`
                  : `${pct}%`}
              </span>
            </div>

            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  migStatus.status === 'failed'
                    ? 'bg-red-500'
                    : migStatus.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-primary'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {migStatus.done > 0 && (
                <span className="flex items-center gap-1 text-emerald-500">
                  <CheckCircle2 className="h-3 w-3" /> {migStatus.done} 成功
                </span>
              )}
              {migStatus.failed > 0 && (
                <span className="flex items-center gap-1 text-red-500">
                  <XCircle className="h-3 w-3" /> {migStatus.failed} 失败
                </span>
              )}
            </div>

            {/* Failed file list */}
            {migStatus.failed > 0 && (
              <div className="max-h-28 overflow-y-auto space-y-1 bg-red-500/5 rounded-lg p-2">
                {migStatus.results
                  .filter((r) => r.status === 'failed')
                  .map((r) => (
                    <p key={r.fileId} className="text-xs text-red-500 truncate">
                      {r.fileName}: {r.error}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          {!migrationId && (
            <>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button onClick={() => startMutation.mutate()} disabled={!canStart || startMutation.isPending}>
                {startMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> 启动中...
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="h-4 w-4 mr-2" /> 开始迁移
                  </>
                )}
              </Button>
            </>
          )}

          {migrationId && isRunning && (
            <Button variant="outline" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '取消迁移'}
            </Button>
          )}

          {migrationId && isDone && <Button onClick={onClose}>关闭</Button>}
        </div>
      </div>
    </div>
  );
}
