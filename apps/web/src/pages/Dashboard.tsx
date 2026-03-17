/**
 * Dashboard.tsx
 * 仪表盘页面
 * 
 * 功能:
 * - 存储空间统计
 * - 最近文件列表
 * - 快捷操作入口
 * - 系统状态概览
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { FileIcon } from '@/components/ui/FileIcon';
import { StorageBar } from '@/components/ui/StorageBar';
import { formatBytes, formatDate } from '@/utils';
import { PROVIDER_META } from '@/services/api';
import { cn } from '@/utils';
import {
  Files as FilesIcon, FolderOpen, Trash2, Clock, TrendingUp,
  Image, Video, Music, FileText, File, ChevronRight,
  Database, FileSpreadsheet, Presentation, Archive, FileCode,
} from 'lucide-react';
import type { DashboardStats } from '@/services/api';

const CATEGORY_META = {
  image: { label: '图片', icon: Image, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  video: { label: '视频', icon: Video, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  audio: { label: '音频', icon: Music, color: 'text-pink-500', bg: 'bg-pink-500/10' },
  pdf: { label: 'PDF', icon: FileText, color: 'text-red-500', bg: 'bg-red-500/10' },
  document: { label: '文档', icon: FileText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  spreadsheet: { label: '表格', icon: FileSpreadsheet, color: 'text-green-500', bg: 'bg-green-500/10' },
  presentation: { label: '演示', icon: Presentation, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  archive: { label: '压缩包', icon: Archive, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  code: { label: '代码', icon: FileCode, color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
  text: { label: '文本', icon: FileText, color: 'text-slate-500', bg: 'bg-slate-500/10' },
  other: { label: '其他', icon: File, color: 'text-muted-foreground', bg: 'bg-muted/60' },
} as const;

type CategoryMeta = typeof CATEGORY_META[keyof typeof CATEGORY_META];

const getCategoryMeta = (type: string): CategoryMeta => {
  const meta = CATEGORY_META[type as keyof typeof CATEGORY_META];
  return meta ?? CATEGORY_META.other;
};

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const { data: statsRes, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => authApi.stats(),
    staleTime: 30000,
  });

  const stats: DashboardStats | undefined = statsRes?.data?.data;

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 12) return '早上好';
    if (h < 18) return '下午好';
    return '晚上好';
  };

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">
          {greeting()}，{user?.name || user?.email?.split('@')[0]} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">这是您的文件存储概览</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl border bg-card animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* ── Stat cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="文件总数"
              value={stats?.fileCount ?? 0}
              icon={FilesIcon}
              color="text-blue-500"
              bg="bg-blue-500/10"
              onClick={() => navigate('/files')}
            />
            <StatCard
              label="文件夹"
              value={stats?.folderCount ?? 0}
              icon={FolderOpen}
              color="text-amber-500"
              bg="bg-amber-500/10"
              onClick={() => navigate('/files')}
            />
            <StatCard
              label="回收站"
              value={stats?.trashCount ?? 0}
              icon={Trash2}
              color="text-red-500"
              bg="bg-red-500/10"
              onClick={() => navigate('/trash')}
            />
            <StatCard
              label="已用空间"
              value={formatBytes(stats?.storageUsed ?? 0)}
              icon={TrendingUp}
              color="text-emerald-500"
              bg="bg-emerald-500/10"
              onClick={() => navigate('/settings')}
              isString
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ── Recent files ── */}
            <div className="lg:col-span-2 bg-card border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-semibold text-sm">最近上传</h2>
                </div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
                  onClick={() => navigate('/files')}
                >
                  查看全部 <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {stats?.recentFiles?.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <FilesIcon className="h-10 w-10 mx-auto mb-2 opacity-20" />
                  还没有上传任何文件
                </div>
              ) : (
                <div className="divide-y">
                  {(stats?.recentFiles ?? []).map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-accent/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/files${file.parentId ? `/${file.parentId}` : ''}`)}
                    >
                      <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="sm" className="flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{formatDate(file.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Right column ── */}
            <div className="space-y-4">
              {/* Storage — multi-bucket */}
              <div className="bg-card border rounded-xl p-5 space-y-4">
                <h2 className="font-semibold text-sm">存储空间</h2>
                <StorageBar
                  used={stats?.storageUsed ?? 0}
                  quota={stats?.storageQuota ?? 10737418240}
                />
                {stats?.bucketBreakdown && stats.bucketBreakdown.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs text-muted-foreground font-medium">各存储桶用量</p>
                    {stats.bucketBreakdown.map((b) => {
                      const meta = PROVIDER_META[b.provider as keyof typeof PROVIDER_META];
                      const pct = b.storageQuota ? Math.min(100, (b.storageUsed / b.storageQuota) * 100) : null;
                      return (
                        <div key={b.id} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span>{meta?.icon ?? '📦'}</span>
                              <span className="truncate max-w-[120px]">{b.name}</span>
                              {b.isDefault && <span className="px-1 py-0.5 rounded text-[9px] bg-primary/10 text-primary">默认</span>}
                            </span>
                            <span className="text-muted-foreground">
                              {formatBytes(b.storageUsed)}
                              {b.storageQuota && <span className="opacity-50"> / {formatBytes(b.storageQuota)}</span>}
                            </span>
                          </div>
                          {pct !== null && (
                            <div className="h-1 bg-secondary rounded-full overflow-hidden">
                              <div
                                className={pct > 90 ? 'h-full rounded-full bg-red-500' : pct > 70 ? 'h-full rounded-full bg-amber-500' : 'h-full rounded-full bg-primary/60'}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Type breakdown */}
              <div className="bg-card border rounded-xl p-5">
                <h2 className="font-semibold text-sm mb-4">文件类型分布</h2>
                {stats && Object.keys(stats.typeBreakdown).length > 0 ? (
                  <div className="space-y-2.5">
                    {Object.entries(stats.typeBreakdown)
                      .sort(([, a], [, b]) => b - a)
                      .map(([type, bytes]) => {
                        const meta = getCategoryMeta(type);
                        const total = Object.values(stats.typeBreakdown).reduce((a, b) => a + b, 0);
                        const pct = total > 0 ? (bytes / total) * 100 : 0;
                        const Icon = meta.icon;
                        return (
                          <div key={type} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className={cn('flex items-center gap-1.5', meta.color)}>
                                <Icon className="h-3.5 w-3.5" />
                                {meta.label}
                              </span>
                              <span className="text-muted-foreground">{formatBytes(bytes)}</span>
                            </div>
                            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', meta.bg.replace('/10', '/80'))}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">暂无数据</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  bg: string;
  onClick?: () => void;
  isString?: boolean;
}

function StatCard({ label, value, icon: Icon, color, bg, onClick }: StatCardProps) {
  return (
    <button
      className="bg-card border rounded-xl p-5 text-left hover:shadow-md hover:-translate-y-0.5 transition-all w-full group"
      onClick={onClick}
    >
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', bg)}>
        <Icon className={cn('h-5 w-5', color)} />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5 group-hover:text-foreground transition-colors">{label}</p>
    </button>
  );
}
