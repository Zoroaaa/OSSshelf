/**
 * CatalogSnapshotCard.tsx
 * models.dev 运行时快照：拉取、恢复内置、状态展示
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { aiApi } from '@/services/api';

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

export function CatalogSnapshotCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const statusQuery = useQuery({
    queryKey: ['ai-catalog-status'],
    queryFn: () => aiApi.config.getCatalogStatus().then((res) => res.data.data),
    staleTime: 30_000,
  });

  const status = statusQuery.data;

  const syncMutation = useMutation({
    mutationFn: () => aiApi.config.syncCatalog(),
    onSuccess: (response) => {
      const next = response.data.data;
      queryClient.invalidateQueries({ queryKey: ['ai-catalog-status'] });
      toast({
        title: '快照已更新',
        description: next ? `${next.providerCount} 个供应商 · ${next.modelCount} 个模型` : undefined,
      });
    },
    onError: (error) => {
      toast({
        title: '拉取失败',
        description: error instanceof Error ? error.message : '请检查网络后重试',
        variant: 'destructive',
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => aiApi.config.resetCatalog(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-catalog-status'] });
      toast({ title: '已恢复内置快照' });
    },
    onError: (error) => {
      toast({
        title: '恢复失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    },
  });

  const isRuntime = status?.source === 'runtime';

  return (
    <div className="p-3.5 rounded-xl border bg-card">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <Database className="h-4.5 w-4.5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-sm">模型元数据目录</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  isRuntime
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isRuntime ? '运行时快照' : '内置快照'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              用于供应商模型列表和新建模型的上下文、价格、能力。拉取只影响之后导入的模型。
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
              <span>{status ? `${status.providerCount} 个供应商` : '—'}</span>
              <span>{status ? `${status.modelCount} 个模型` : '—'}</span>
              <span>拉取：{formatTime(status?.fetchedAt ?? null)}</span>
              {!isRuntime && <span>内置生成：{formatTime(status?.generatedAt ?? null)}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isRuntime && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetMutation.mutate()}
              disabled={syncMutation.isPending || resetMutation.isPending}
              className="gap-1.5"
            >
              {resetMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              恢复内置
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || resetMutation.isPending}
            className="gap-1.5"
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {syncMutation.isPending ? '拉取中…' : '拉取 models.dev 快照'}
          </Button>
        </div>
      </div>

      {statusQuery.isError && (
        <p className="mt-2 text-[11px] text-red-500">
          目录状态读取失败：{statusQuery.error instanceof Error ? statusQuery.error.message : '请稍后重试'}
        </p>
      )}
    </div>
  );
}
