/**
 * StorageAuditTab.tsx
 * 存储桶与数据库文件一致性审计面板
 *
 * 功能:
 * - 健康评分总览仪表盘
 - 分存储桶详情对比（自动过滤Telegram存储桶）
 * - 孤儿文件/丢失文件/大小不一致列表
 * - 整改建议与操作入口
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  adminApi,
  type StorageAuditReport,
  type BucketAuditResult,
  type MissingFileDetailResponse,
} from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { useToast } from '@/components/ui/useToast';
import { formatBytes, formatDate } from '@/utils';
import { cn } from '@/utils';
import {
  HardDrive,
  Database,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
  Trash2,
  ArrowRight,
  Clock,
  Zap,
  Activity,
  FileWarning,
  Ghost,
  SearchX,
  Scale,
  Lightbulb,
  Loader2,
  ExternalLink,
  Ban,
  WifiOff,
  Info,
  FolderTree,
  Eraser,
  FolderOpen,
} from 'lucide-react';

export function StorageAuditTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [showMissingDetails, setShowMissingDetails] = useState<string | null>(null);
  const [cleaningBucketId, setCleaningBucketId] = useState<string | null>(null);

  const {
    data: report,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['admin', 'storage-audit'],
    queryFn: () => adminApi.storageAudit().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const forceAuditMutation = useMutation({
    mutationFn: () => adminApi.storageAuditForce().then((r) => r.data.data),
    onSuccess: () => {
      toast({ title: '审计已完成', description: '已重新扫描所有S3兼容存储桶' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'storage-audit'] });
    },
    onError: (e: any) =>
      toast({ title: '审计失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const cleanupOrphansMutation = useMutation({
    mutationFn: (bucketId: string) => adminApi.cleanupOrphans({ bucketId, mode: 'all' }).then((r) => r.data),
    onMutate: (bucketId) => {
      setCleaningBucketId(bucketId);
    },
    onSuccess: (data, bucketId) => {
      const d = data?.data;
      if (!d) return;
      const hasFailures = (d.failedKeys?.length ?? 0) > 0;
      toast({
        title: '清理完成',
        description: `成功删除 ${d.deletedCount ?? 0} 个孤儿文件${hasFailures ? `，${d.failedKeys.length} 个失败` : ''}`,
        variant: hasFailures ? 'destructive' : undefined,
      });
      setCleaningBucketId(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'storage-audit'] });
    },
    onError: (e: any, bucketId) => {
      setCleaningBucketId(null);
      toast({ title: '清理失败', description: e.response?.data?.error?.message, variant: 'destructive' });
    },
  });

  const missingFilesQuery = useQuery({
    queryKey: ['admin', 'storage-audit-missing', showMissingDetails],
    queryFn: () => (showMissingDetails ? adminApi.getMissingFiles(showMissingDetails).then((r) => r.data.data) : null),
    enabled: !!showMissingDetails,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading && !report) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">正在扫描所有S3兼容存储桶...</p>
          <p className="text-xs text-muted-foreground/60">R2使用V2 API / B2使用V1 API</p>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const summary = report.summary;
  const statusConfig = getStatusConfig(summary.status);

  return (
    <div className="space-y-6">
      {/* ── 头部：健康评分 + 操作栏 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 健康评分卡片 */}
        <Card className={cn('lg:col-span-4 relative overflow-hidden', statusConfig.borderClass)}>
          <div className={cn('absolute inset-0 opacity-[0.03]', statusConfig.bgPattern)} />
          <CardContent className="pt-6 pb-6 relative">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">系统健康度</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className={cn('text-5xl font-black tabular-nums', statusConfig.scoreColor)}>
                    {summary.healthScore}
                  </span>
                  <span className="text-lg text-muted-foreground">/100</span>
                </div>
              </div>
              <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center', statusConfig.iconBg)}>
                {statusConfig.icon}
              </div>
            </div>

            {/* 状态标签 + 一致性率 */}
            <div className="flex items-center gap-2 mb-4">
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold',
                  statusConfig.badgeClass
                )}
              >
                {statusConfig.label}
              </span>
              <span className="text-xs text-muted-foreground">一致性 {report.overallConsistencyRate.toFixed(1)}%</span>
            </div>

            {/* 进度条 */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>数据一致性</span>
                <span>{report.overallConsistencyRate.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-1000 ease-out', statusConfig.barColor)}
                  style={{ width: `${Math.min(100, report.overallConsistencyRate)}%` }}
                />
              </div>
            </div>

            {/* 审计元信息 */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border/50 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                耗时 {(report.durationMs / 1000).toFixed(1)}s
              </span>
              {report.cacheInfo?.cached && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Zap className="h-3 w-3" />
                  缓存 ({report.cacheInfo.ageMinutes}分钟前)
                </span>
              )}
              <span className="font-mono text-[10px] opacity-50 ml-auto">{report.auditId.slice(-8)}</span>
            </div>
          </CardContent>
        </Card>

        {/* 统计指标卡片组 */}
        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            icon={<Database className="h-4 w-4" />}
            label="S3/R2/B2 对象"
            value={report.totalS3Objects}
            sub={`${formatBytes(report.totalS3SizeBytes)}`}
            color="blue"
          />
          <MetricCard
            icon={<HardDrive className="h-4 w-4" />}
            label="DB 文件记录"
            value={report.totalDbFiles}
            sub={`${formatBytes(report.totalDbSizeBytes)}`}
            color="emerald"
          />
          <MetricCard
            icon={<Ghost className="h-4 w-4" />}
            label="孤儿文件"
            value={report.totalOrphanFiles}
            sub={formatBytes(report.totalOrphanSizeBytes)}
            color={report.totalOrphanFiles > 0 ? 'amber' : 'slate'}
            highlight={report.totalOrphanFiles > 0}
          />
          <MetricCard
            icon={<SearchX className="h-4 w-4" />}
            label="丢失文件"
            value={report.totalMissingFiles}
            sub={formatBytes(report.totalMissingSizeBytes)}
            color={report.totalMissingFiles > 0 ? 'red' : 'slate'}
            highlight={report.totalMissingFiles > 0}
          />
        </div>
      </div>

      {/* ── 操作栏 ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Activity className="h-4 w-4" />
            扫描了 {report.auditedBuckets}/{report.totalBuckets - report.skippedBuckets} 个S3存储桶
          </span>
          {report.failedBuckets > 0 && (
            <span className="flex items-center gap-1 text-red-500">
              <WifiOff className="h-4 w-4" />
              {report.failedBuckets} 个连接失败
            </span>
          )}
          {report.skippedBuckets > 0 && (
            <span className="flex items-center gap-1 text-violet-500">
              <Ban className="h-4 w-4" />
              {report.skippedBuckets} 个TG存储桶已跳过
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant={isFetching ? 'outline' : 'default'}
          onClick={() => forceAuditMutation.mutate()}
          disabled={forceAuditMutation.isPending || isFetching}
        >
          {forceAuditMutation.isPending || isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1.5" />
          )}
          {forceAuditMutation.isPending ? '扫描中...' : isFetching ? '刷新中...' : '强制重新审计'}
        </Button>
      </div>

      {/* ── Top Issues 快速提示 ── */}
      {summary.topIssues.length > 0 && summary.topIssues[0] !== '所有S3兼容存储桶数据一致' && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 dark:border-amber-800/30 dark:bg-amber-950/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">发现以下问题</p>
              <ul className="space-y-0.5">
                {summary.topIssues.map((issue, i) => (
                  <li key={i} className="text-xs text-amber-700/80 dark:text-amber-300/70 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── 分桶详情 ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">存储桶详情</h3>
          <span className="text-xs text-muted-foreground">{report.buckets.length} 个桶</span>
        </div>

        {report.buckets.map((bucket) => (
          <BucketDetailCard
            key={bucket.bucketId}
            bucket={bucket}
            isExpanded={expandedBucket === bucket.bucketId}
            onToggle={() => setExpandedBucket(expandedBucket === bucket.bucketId ? null : bucket.bucketId)}
            onCleanupOrphans={(bid) => cleanupOrphansMutation.mutate(bid)}
            onShowMissingDetails={(bid) => setShowMissingDetails(bid)}
            isCleaning={cleaningBucketId === bucket.bucketId && cleanupOrphansMutation.isPending}
          />
        ))}
      </div>

      {/* ── 丢失文件路径穿透面板 ── */}
      {showMissingDetails && missingFilesQuery.data && (
        <Card className="border-red-200/50 bg-red-50/20 dark:border-red-800/30 dark:bg-red-950/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <FolderTree className="h-4 w-4 text-red-500" />
                </div>
                <div>
                  <CardTitle className="text-base">丢失文件 — 文件夹路径穿透</CardTitle>
                  <CardDescription>
                    {missingFilesQuery.data.bucketName} ({missingFilesQuery.data.provider}) — 共{' '}
                    {missingFilesQuery.data.missingCount} 个丢失文件
                  </CardDescription>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowMissingDetails(null)}>
                <XCircle className="h-4 w-4 mr-1" />
                关闭
              </Button>
            </div>
          </CardHeader>

          <CardContent className="pt-0 space-y-2">
            {missingFilesQuery.isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                <span className="text-sm text-muted-foreground">正在解析文件夹路径...</span>
              </div>
            ) : (
              <div className="rounded-lg border border-red-200/40 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-red-100/50 dark:bg-red-900/10 border-b border-border">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[35%]">文件名</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[40%]">所属文件夹路径</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground w-[12%]">大小</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground w-[13%]">创建时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {missingFilesQuery.data.files.map((f) => (
                      <tr key={f.fileId} className="hover:bg-background/50 transition-colors">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <FileWarning className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                            <code className="font-mono truncate max-w-[200px]">{f.name}</code>
                          </div>
                          <code className="font-mono text-[10px] text-muted-foreground ml-5.5 block truncate max-w-[220px] mt-0.5">
                            {f.r2Key}
                          </code>
                        </td>
                        <td className="px-3 py-2">
                          {f.folderPath ? (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
                              <span className="truncate">{f.folderPath}</span>
                            </div>
                          ) : f.path ? (
                            <span className="text-muted-foreground italic">根目录</span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatBytes(f.size)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                          {formatDate(f.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 整改建议 ── */}
      {report.recommendations.length > 0 && (
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setShowRecommendations(!showRecommendations)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                  <Lightbulb className="h-4 w-4 text-violet-500" />
                </div>
                <div>
                  <CardTitle className="text-base">整改建议</CardTitle>
                  <CardDescription>{report.recommendations.length} 条可执行建议</CardDescription>
                </div>
              </div>
              {showRecommendations ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>

          {showRecommendations && (
            <CardContent className="space-y-3 pt-0">
              {report.recommendations.map((rec) => (
                <RecommendationCard key={rec.id} recommendation={rec} />
              ))}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 子组件
// ══════════════════════════════════════════════════════════════

function MetricCard({
  icon,
  label,
  value,
  sub,
  color,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  color: 'blue' | 'emerald' | 'amber' | 'red' | 'slate';
  highlight?: boolean;
}) {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
    red: 'bg-red-500/10 text-red-500',
    slate: 'bg-slate-500/10 text-slate-400',
  };

  const valueColorMap = {
    blue: 'text-blue-600 dark:text-blue-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: highlight ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400',
    red: highlight ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-400',
    slate: 'text-slate-600 dark:text-slate-400',
  };

  return (
    <div className="bg-card border rounded-xl p-4 space-y-2">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', colorMap[color])}>{icon}</div>
      <p className={cn('text-2xl font-bold tabular-nums leading-none', valueColorMap[color])}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className="text-[11px] text-muted-foreground/70 tabular-nums">{sub}</p>
    </div>
  );
}

function BucketDetailCard({
  bucket,
  isExpanded,
  onToggle,
  onCleanupOrphans,
  onShowMissingDetails,
  isCleaning,
}: {
  bucket: BucketAuditResult;
  isExpanded: boolean;
  onToggle: () => void;
  onCleanupOrphans: (bucketId: string) => void;
  onShowMissingDetails: (bucketId: string) => void;
  isCleaning: boolean;
}) {
  // Telegram 跳过的桶
  if (bucket.skipped) {
    return (
      <div className="rounded-xl border border-violet-200/40 bg-violet-50/20 dark:border-violet-800/20 dark:bg-violet-950/5 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center flex-shrink-0">
            <Ban className="h-5 w-5 text-violet-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate">{bucket.bucketName}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 uppercase">
                {bucket.provider}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                已跳过
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{bucket.skipReason}</p>
          </div>
        </div>
      </div>
    );
  }

  // 连接失败的桶
  if (!bucket.connected) {
    return (
      <div className="rounded-xl border border-red-200/50 bg-red-50/30 dark:border-red-800/30 dark:bg-red-950/10 p-4">
        <button onClick={onToggle} className="w-full text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <WifiOff className="h-5 w-5 text-red-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{bucket.bucketName}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground uppercase flex-shrink-0">
                    {bucket.provider}
                  </span>
                </div>
                <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-0.5 truncate max-w-md">
                  {bucket.errorMessage || '连接失败，无法读取存储内容'}
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
          </div>
        </button>
      </div>
    );
  }

  // 正常的 S3 兼容桶
  const hasIssues =
    bucket.orphanFiles.length > 0 || bucket.missingFiles.length > 0 || bucket.sizeMismatchFiles.length > 0;

  const statusColor = hasIssues
    ? 'border-amber-200/40 bg-amber-50/20 dark:border-amber-800/20 dark:bg-amber-950/5'
    : '';

  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-200 hover:shadow-sm',
        statusColor,
        isExpanded && 'shadow-md'
      )}
    >
      <button onClick={onToggle} className="w-full p-4 text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                hasIssues ? 'bg-amber-500/10' : 'bg-emerald-500/10'
              )}
            >
              {hasIssues ? (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{bucket.bucketName}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground flex-shrink-0 uppercase">
                  {bucket.provider}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <Database className="h-3 w-3" /> S3: {bucket.s3ObjectCount} 个
                </span>
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" /> DB: {bucket.dbFileCount} 个
                </span>
                <span
                  className={cn(
                    'font-medium',
                    bucket.consistencyRate >= 95
                      ? 'text-emerald-500'
                      : bucket.consistencyRate >= 80
                        ? 'text-amber-500'
                        : 'text-red-500'
                  )}
                >
                  {bucket.consistencyRate.toFixed(1)}% 一致
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            {hasIssues && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs">
                {bucket.orphanFiles.length > 0 && (
                  <>
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      {bucket.orphanFiles.length} 孤儿
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCleanupOrphans(bucket.bucketId);
                      }}
                      disabled={isCleaning}
                    >
                      {isCleaning ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Eraser className="h-3 w-3 mr-1" />
                      )}
                      清理
                    </Button>
                  </>
                )}
                {bucket.missingFiles.length > 0 && (
                  <>
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                      {bucket.missingFiles.length} 丢失
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowMissingDetails(bucket.bucketId);
                      }}
                    >
                      <FolderTree className="h-3 w-3 mr-1" />
                      路径
                    </Button>
                  </>
                )}
                {bucket.sizeMismatchFiles.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                    {bucket.sizeMismatchFiles.length} 不一致
                  </span>
                )}
              </div>
            )}

            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/50 pt-4">
          {/* 容量对比条 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">S3 存储</span>
                <span className="font-medium tabular-nums">{formatBytes(bucket.s3TotalSizeBytes)}</span>
              </div>
              <div className="h-1.5 bg-blue-100 dark:bg-blue-900/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      Math.min(
                        100,
                        (bucket.s3TotalSizeBytes / Math.max(bucket.s3TotalSizeBytes, bucket.dbTotalSizeBytes)) * 100
                      ) || 0
                    }%`,
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">DB 记录</span>
                <span className="font-medium tabular-nums">{formatBytes(bucket.dbTotalSizeBytes)}</span>
              </div>
              <div className="h-1.5 bg-emerald-100 dark:bg-emerald-900/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      Math.min(
                        100,
                        (bucket.dbTotalSizeBytes / Math.max(bucket.s3TotalSizeBytes, bucket.dbTotalSizeBytes)) * 100
                      ) || 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* 匹配统计 */}
          <div className="flex items-center gap-4 py-2 px-3 bg-muted/30 rounded-lg text-xs flex-wrap">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {bucket.matchedFiles} 匹配
            </span>
            {bucket.orphanFiles.length > 0 && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Ghost className="h-3.5 w-3.5" />
                {bucket.orphanFiles.length} 孤儿
              </span>
            )}
            {bucket.missingFiles.length > 0 && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <SearchX className="h-3.5 w-3.5" />
                {bucket.missingFiles.length} 丢失
              </span>
            )}
            {bucket.sizeMismatchFiles.length > 0 && (
              <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                <Scale className="h-3.5 w-3.5" />
                {bucket.sizeMismatchFiles.length} 大小异常
              </span>
            )}
          </div>

          {/* 孤儿文件列表 */}
          {bucket.orphanFiles.length > 0 && (
            <FileIssueList
              title={`孤儿文件 (${bucket.orphanFiles.length})`}
              subtitle="存储桶中存在但数据库无记录的文件"
              items={bucket.orphanFiles.slice(0, 15).map((f) => ({
                key: f.r2Key,
                size: f.s3Size ?? 0,
                meta: f.dbFileName,
              }))}
              icon={<Ghost className="h-4 w-4 text-amber-500" />}
              color="amber"
              total={bucket.orphanFiles.length}
            />
          )}

          {/* 丢失文件列表 */}
          {bucket.missingFiles.length > 0 && (
            <FileIssueList
              title={`丢失文件 (${bucket.missingFiles.length})`}
              subtitle="数据库有记录但存储桶中不存在的文件"
              items={bucket.missingFiles.slice(0, 15).map((f) => ({
                key: f.r2Key,
                size: f.dbFileSize ?? 0,
                meta: f.dbFileName,
              }))}
              icon={<SearchX className="h-4 w-4 text-red-500" />}
              color="red"
              total={bucket.missingFiles.length}
            />
          )}

          {/* 大小不一致列表 */}
          {bucket.sizeMismatchFiles.length > 0 && (
            <FileIssueList
              title={`大小不一致 (${bucket.sizeMismatchFiles.length})`}
              subtitle="数据库记录大小与实际存储大小不符"
              items={bucket.sizeMismatchFiles.slice(0, 15).map((f) => ({
                key: f.r2Key,
                size: f.s3Size ?? 0,
                meta: `DB:${formatBytes(f.dbSize)} → 实际:${formatBytes(f.s3Size)} (差${formatBytes(f.diffBytes)})`,
              }))}
              icon={<Scale className="h-4 w-4 text-orange-500" />}
              color="orange"
              total={bucket.sizeMismatchFiles.length}
            />
          )}

          {/* 数据为空提示 */}
          {bucket.s3ObjectCount === 0 && bucket.dbFileCount === 0 && (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <Info className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
              <p className="text-xs text-muted-foreground">该存储桶当前为空，无文件数据</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileIssueList({
  title,
  subtitle,
  items,
  icon,
  color,
  total,
}: {
  title: string;
  subtitle: string;
  items: Array<{ key: string; size: number; meta?: string }>;
  icon: React.ReactNode;
  color: 'amber' | 'red' | 'orange';
  total: number;
}) {
  const colorClasses = {
    amber: 'border-amber-200/50 bg-amber-50/30 dark:border-amber-800/20 dark:bg-amber-950/5',
    red: 'border-red-200/50 bg-red-50/30 dark:border-red-800/20 dark:bg-red-950/5',
    orange: 'border-orange-200/50 bg-orange-50/30 dark:border-orange-800/20 dark:bg-orange-950/5',
  };

  return (
    <div className={cn('rounded-lg border p-3 space-y-2', colorClasses[color])}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold">{title}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{subtitle}</span>
      </div>
      <div className="space-y-1 max-h-56 overflow-y-auto">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded bg-background/50 group">
            <FileWarning className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <code className="font-mono flex-1 truncate text-[11px]">{item.key}</code>
            <span className="tabular-nums text-muted-foreground flex-shrink-0">{formatBytes(item.size)}</span>
            {item.meta && (
              <span className="text-[10px] text-muted-foreground hidden sm:inline max-w-[220px] truncate">
                {item.meta}
              </span>
            )}
          </div>
        ))}
        {total > 15 && (
          <div className="text-center text-xs text-muted-foreground py-1">还有 {total - 15} 项未显示...</div>
        )}
      </div>
    </div>
  );
}

function RecommendationCard({
  recommendation: rec,
}: {
  recommendation: Extract<StorageAuditReport['recommendations'][number], { id: string }>;
}) {
  const severityConfig = {
    critical: {
      badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800',
      dot: 'bg-red-500',
      label: '严重',
    },
    high: {
      badge:
        'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800',
      dot: 'bg-orange-500',
      label: '高',
    },
    medium: {
      badge:
        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      dot: 'bg-amber-500',
      label: '中',
    },
    low: {
      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800',
      dot: 'bg-blue-500',
      label: '低',
    },
    info: {
      badge:
        'bg-slate-100 text-slate-600 dark:bg-slate-800/30 dark:text-slate-400 border-slate-200 dark:border-slate-700',
      dot: 'bg-slate-400',
      label: '信息',
    },
  };

  const riskConfig = {
    safe: { label: '低风险', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' },
    caution: { label: '需谨慎', color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' },
    dangerous: { label: '高风险', color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20' },
  };

  const cfg = severityConfig[rec.severity];
  const risk = riskConfig[rec.riskLevel];

  return (
    <div className="rounded-xl border p-4 space-y-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', cfg.dot)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold">{rec.title}</h4>
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium border', cfg.badge)}>{cfg.label}</span>
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', risk.color)}>{risk.label}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.description}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 pl-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <ArrowRight className="h-3 w-3" />
          {rec.action.slice(0, 60)}
          {rec.action.length > 60 ? '...' : ''}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Clock className="h-3 w-3" />
          预计 {rec.estimatedTime}
        </span>
        {rec.affectedCount > 0 && <span>影响 {rec.affectedCount} 项</span>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════

function getStatusConfig(status: 'healthy' | 'warning' | 'critical' | 'error') {
  switch (status) {
    case 'healthy':
      return {
        label: '状态良好',
        scoreColor: 'text-emerald-500',
        barColor: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
        badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        iconBg: 'bg-emerald-500/10',
        icon: <Shield className="h-7 w-7 text-emerald-500" />,
        borderClass: 'border-emerald-200/40',
        bgPattern: '',
      };
    case 'warning':
      return {
        label: '需要关注',
        scoreColor: 'text-amber-500',
        barColor: 'bg-gradient-to-r from-amber-400 to-amber-500',
        badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        iconBg: 'bg-amber-500/10',
        icon: <AlertTriangle className="h-7 w-7 text-amber-500" />,
        borderClass: 'border-amber-200/40',
        bgPattern: '',
      };
    case 'critical':
      return {
        label: '严重问题',
        scoreColor: 'text-orange-500',
        barColor: 'bg-gradient-to-r from-orange-400 to-orange-500',
        badgeClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
        iconBg: 'bg-orange-500/10',
        icon: <AlertTriangle className="h-7 w-7 text-orange-500" />,
        borderClass: 'border-orange-200/40',
        bgPattern: '',
      };
    case 'error':
      return {
        label: '系统异常',
        scoreColor: 'text-red-500',
        barColor: 'bg-gradient-to-r from-red-400 to-red-500',
        badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        iconBg: 'bg-red-500/10',
        icon: <XCircle className="h-7 w-7 text-red-500" />,
        borderClass: 'border-red-200/40',
        bgPattern: '',
      };
  }
}

export default StorageAuditTab;
