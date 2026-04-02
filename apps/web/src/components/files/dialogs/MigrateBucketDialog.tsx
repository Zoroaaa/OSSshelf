/**
 * MigrateBucketDialog.tsx
 * 存储桶迁移对话框
 *
 * 允许用户在两个存储桶之间迁移文件，支持：
 * - 选择来源和目标存储桶
 * - 可选"移动"模式（迁移后删除来源）
 * - 实时进度轮询（每 2s 刷新）
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { bucketsApi, migrateApi, type StorageBucket, type MigrationStatus } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { formatBytes } from '@/utils';
import { ArrowRight, Loader2, CheckCircle2, XCircle, AlertCircle, ArrowRightLeft, X } from 'lucide-react';

interface Props {
  /** 预填的来源存储桶 ID（可选） */
  defaultSourceId?: string;
  /** 可选：仅迁移指定文件 ID */
  fileIds?: string[];
  onClose: () => void;
}

export function MigrateBucketDialog({ defaultSourceId, fileIds, onClose }: Props) {
  const [sourceId, setSourceId] = useState(defaultSourceId ?? '');
  const [targetId, setTargetId] = useState('');
  const [deleteSource, setDeleteSource] = useState(false);
  const [migrationId, setMigrationId] = useState<string | null>(null);

  const { data: bucketsData } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => bucketsApi.list().then((r) => r.data.data ?? []),
  });
  const buckets: StorageBucket[] = bucketsData ?? [];

  // Poll migration status every 2s while running
  const { data: statusData } = useQuery({
    queryKey: ['migration', migrationId],
    queryFn: () => migrateApi.get(migrationId!).then((r) => r.data.data),
    enabled: !!migrationId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' ? 2000 : false;
    },
  });
  const migStatus: MigrationStatus | undefined = statusData;

  const startMutation = useMutation({
    mutationFn: () =>
      migrateApi
        .start({ sourceBucketId: sourceId, targetBucketId: targetId, deleteSource, fileIds })
        .then((r) => r.data),
    onSuccess: (res) => {
      setMigrationId(res.data?.migrationId ?? null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => migrateApi.cancel(migrationId!),
  });

  const canStart = sourceId && targetId && sourceId !== targetId && !migrationId;
  const isRunning = migStatus?.status === 'running';
  const isDone =
    migStatus?.status === 'completed' || migStatus?.status === 'failed' || migStatus?.status === 'cancelled';

  const pct = migStatus ? Math.round(((migStatus.done + migStatus.failed) / Math.max(1, migStatus.total)) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">存储桶迁移</h2>
          </div>
          {!isRunning && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Bucket selectors */}
        {!migrationId && (
          <div className="space-y-3">
            {fileIds?.length && (
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
                {buckets.map((b) => (
                  <option key={b.id} value={b.id} disabled={b.id === sourceId}>
                    {b.name} ({b.provider}) — {formatBytes(b.storageUsed)}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteSource}
                onChange={(e) => setDeleteSource(e.target.checked)}
                className="rounded"
              />
              <span>迁移后删除来源文件（移动模式）</span>
            </label>

            {deleteSource && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                移动模式将在迁移成功后删除来源文件，此操作不可逆
              </p>
            )}
          </div>
        )}

        {/* Progress */}
        {migStatus && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {isRunning
                  ? '迁移中...'
                  : migStatus.status === 'completed'
                    ? '迁移完成'
                    : migStatus.status === 'cancelled'
                      ? '已取消'
                      : '迁移失败'}
              </span>
              <span className="font-medium tabular-nums">
                {migStatus.done + migStatus.failed} / {migStatus.total}
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
