/**
 * Shares.tsx
 * 分享管理页面
 * 
 * 功能:
 * - 查看分享列表
 * - 创建分享链接
 * - 删除分享
 * - 分享状态管理
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shareApi } from '@/services/api';
import { formatBytes, formatDate } from '@/utils';
import { Button } from '@/components/ui/button';
import { FileIcon } from '@/components/ui/FileIcon';
import { useToast } from '@/components/ui/use-toast';
import { Link2, Trash2, Lock, Clock, Download, AlertCircle, CheckCircle2, Ban, ExternalLink } from 'lucide-react';
import { cn } from '@/utils';

export default function Shares() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: shares = [], isLoading } = useQuery({
    queryKey: ['shares'],
    queryFn: () => shareApi.list().then((res) => res.data.data ?? []),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => shareApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      toast({ title: '已删除分享链接' });
    },
    onError: () => toast({ title: '删除失败', variant: 'destructive' }),
  });

  const handleCopyLink = (shareId: string) => {
    const url = `${window.location.origin}/share/${shareId}`;
    navigator.clipboard.writeText(url).then(() => toast({ title: '链接已复制到剪贴板' }));
  };

  const getShareStatus = (share: any): 'active' | 'expired' | 'exhausted' => {
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) return 'expired';
    if (share.downloadLimit && share.downloadCount >= share.downloadLimit) return 'exhausted';
    return 'active';
  };

  const activeShares = shares.filter((s: any) => getShareStatus(s) === 'active');
  const inactiveShares = shares.filter((s: any) => getShareStatus(s) !== 'active');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">分享管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {shares.length > 0
              ? `${activeShares.length} 个有效 · ${inactiveShares.length} 个已失效`
              : '管理您的文件分享链接'}
          </p>
        </div>
        {inactiveShares.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!confirm(`删除所有 ${inactiveShares.length} 个失效的分享链接？`)) return;
              inactiveShares.forEach((s: any) => deleteMutation.mutate(s.id));
            }}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            清理失效链接
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">加载中...</div>
      ) : shares.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground space-y-3">
          <Link2 className="h-14 w-14 mx-auto opacity-20" />
          <p className="font-medium">暂无分享链接</p>
          <p className="text-sm">在文件管理页面右键文件即可创建分享</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Active shares */}
          {activeShares.length > 0 && (
            <section className="space-y-1.5">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                有效分享
              </h2>
              <div className="bg-card border rounded-xl overflow-hidden divide-y">
                {activeShares.map((share: any) => (
                  <ShareItem
                    key={share.id}
                    share={share}
                    status="active"
                    onCopy={handleCopyLink}
                    onDelete={(id) => {
                      if (confirm('确定要删除这个分享链接吗？')) deleteMutation.mutate(id);
                    }}
                    isPending={deleteMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Inactive shares */}
          {inactiveShares.length > 0 && (
            <section className="space-y-1.5">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                已失效
              </h2>
              <div className="bg-card border rounded-xl overflow-hidden divide-y opacity-60">
                {inactiveShares.map((share: any) => (
                  <ShareItem
                    key={share.id}
                    share={share}
                    status={getShareStatus(share)}
                    onCopy={handleCopyLink}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    isPending={deleteMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

interface ShareItemProps {
  share: any;
  status: 'active' | 'expired' | 'exhausted';
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  isPending?: boolean;
}

function ShareItem({ share, status, onCopy, onDelete, isPending }: ShareItemProps) {
  const statusConfig = {
    active: { icon: CheckCircle2, label: '有效', color: 'text-emerald-500' },
    expired: { icon: AlertCircle, label: '已过期', color: 'text-amber-500' },
    exhausted: { icon: Ban, label: '次数已满', color: 'text-red-500' },
  };
  const { icon: StatusIcon, label, color } = statusConfig[status];

  const publicUrl = `${window.location.origin}/share/${share.id}`;

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 group hover:bg-accent/30 transition-colors">
      {/* File icon */}
      <div className="flex-shrink-0">
        <FileIcon mimeType={share.file?.mimeType} isFolder={share.file?.isFolder} size="md" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{share.file?.name ?? '未知文件'}</p>
          <span className={cn('flex items-center gap-0.5 text-xs flex-shrink-0', color)}>
            <StatusIcon className="h-3 w-3" />
            {label}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
          <span>创建 {formatDate(share.createdAt)}</span>
          {share.file && <span>{formatBytes(share.file.size)}</span>}
          {share.expiresAt && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {status === 'expired' ? '已过期于' : '过期'} {formatDate(share.expiresAt)}
            </span>
          )}
          {share.password && (
            <span className="flex items-center gap-0.5">
              <Lock className="h-3 w-3" />
              有密码
            </span>
          )}
          {share.downloadLimit != null && (
            <span className="flex items-center gap-0.5">
              <Download className="h-3 w-3" />
              {share.downloadCount} / {share.downloadLimit} 次
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {status === 'active' && (
          <>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onCopy(share.id)}>
              <Link2 className="h-3 w-3" />
              复制链接
            </Button>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-7 w-7" title="在新标签页打开">
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-red-500/10 hover:text-red-500"
          onClick={() => onDelete(share.id)}
          disabled={isPending}
          title="删除分享"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
