/**
 * Shares.tsx — Phase 6 更新
 * 新增：上传链接标签页 + 创建上传链接功能
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shareApi } from '@/services/api';
import { formatBytes, formatDate } from '@/utils';
import { Button } from '@/components/ui/Button';
import { FileIcon } from '@/components/files/FileIcon';
import { UploadLinkDialog } from '@/components/files/dialogs';
import { FolderPickerDialog } from '@/components/files/dialogs';
import { useToast } from '@/components/ui/useToast';
import {
  Link2,
  Trash2,
  Lock,
  Clock,
  Download,
  AlertCircle,
  CheckCircle2,
  Ban,
  ExternalLink,
  Upload,
  Copy,
} from 'lucide-react';
import { cn } from '@/utils';

type Tab = 'download' | 'upload';

export default function Shares() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('download');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [uploadFolderMeta, setUploadFolderMeta] = useState<{ id: string; name: string } | null>(null);

  const { data: shares = [], isLoading } = useQuery({
    queryKey: ['shares'],
    queryFn: () => shareApi.list().then((res) => res.data.data ?? []),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => shareApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      toast({ title: '已删除' });
    },
    onError: () => toast({ title: '删除失败', variant: 'destructive' }),
  });

  const createUploadLinkMutation = useMutation({
    mutationFn: (params: Parameters<typeof shareApi.createUploadLink>[0]) => shareApi.createUploadLink(params),
    onSuccess: (res) => {
      const d = res.data.data;
      if (d?.uploadToken) {
        const url = `${window.location.origin}/upload/${d.uploadToken}`;
        navigator.clipboard.writeText(url).then(() => toast({ title: '上传链接已复制', description: url }));
      }
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      setShowFolderPicker(false);
      setUploadFolderMeta(null);
    },
    onError: () => toast({ title: '创建失败', variant: 'destructive' }),
  });

  const handleCopyLink = (shareId: string, isUploadLink = false, uploadToken?: string) => {
    const url =
      isUploadLink && uploadToken
        ? `${window.location.origin}/upload/${uploadToken}`
        : `${window.location.origin}/share/${shareId}`;
    navigator.clipboard.writeText(url).then(() => toast({ title: '链接已复制到剪贴板' }));
  };

  const getStatus = (share: any): 'active' | 'expired' | 'exhausted' => {
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) return 'expired';
    if (!share.isUploadLink && share.downloadLimit && share.downloadCount >= share.downloadLimit) return 'exhausted';
    if (share.isUploadLink && share.maxUploadCount != null && share.uploadCount >= share.maxUploadCount)
      return 'exhausted';
    return 'active';
  };

  const downloadShares = shares.filter((s: any) => !s.isUploadLink);
  const uploadShares = shares.filter((s: any) => s.isUploadLink);
  const activeDownload = downloadShares.filter((s: any) => getStatus(s) === 'active');
  const activeUpload = uploadShares.filter((s: any) => getStatus(s) === 'active');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">分享管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeDownload.length} 个有效下载分享 · {activeUpload.length} 个有效上传链接
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(
          [
            { key: 'download' as Tab, label: '下载分享', count: downloadShares.length, icon: Link2 },
            { key: 'upload' as Tab, label: '上传链接', count: uploadShares.length, icon: Upload },
          ] as const
        ).map(({ key, label, count, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {count > 0 && (
              <span className="text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 leading-none">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Download shares tab */}
      {tab === 'download' && (
        <ShareList
          shares={downloadShares}
          isLoading={isLoading}
          emptyText="暂无下载分享"
          emptyHint="在文件管理页面右键文件即可创建"
          getStatus={getStatus}
          onCopy={(id) => handleCopyLink(id)}
          onDelete={(id) => {
            if (confirm('确定要删除这个分享链接吗？')) deleteMutation.mutate(id);
          }}
          onBulkDelete={(ids) => {
            if (confirm(`删除 ${ids.length} 个失效链接？`)) ids.forEach((id) => deleteMutation.mutate(id));
          }}
          isPending={deleteMutation.isPending}
        />
      )}

      {/* Upload links tab */}
      {tab === 'upload' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowFolderPicker(true)}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> 创建上传链接
            </Button>
          </div>
          <ShareList
            shares={uploadShares}
            isLoading={isLoading}
            emptyText="暂无上传链接"
            emptyHint="创建上传链接后，任何人无需登录即可上传文件到指定文件夹"
            getStatus={getStatus}
            isUploadTab
            onCopy={(id, share) => handleCopyLink(id, true, share?.uploadToken)}
            onDelete={(id) => {
              if (confirm('确定要删除这个上传链接吗？')) deleteMutation.mutate(id);
            }}
            onBulkDelete={(ids) => {
              if (confirm(`删除 ${ids.length} 个失效链接？`)) ids.forEach((id) => deleteMutation.mutate(id));
            }}
            isPending={deleteMutation.isPending}
          />
        </div>
      )}

      {/* Step 1: Pick a folder */}
      {showFolderPicker && (
        <FolderPickerDialog
          title="选择目标文件夹"
          confirmLabel="下一步：设置链接"
          onConfirm={(id, name) => {
            setUploadFolderMeta({ id, name });
            setShowFolderPicker(false);
          }}
          onCancel={() => setShowFolderPicker(false)}
        />
      )}

      {/* Step 2: Configure upload link */}
      {!showFolderPicker && uploadFolderMeta && (
        <UploadLinkDialog
          folderId={uploadFolderMeta.id}
          folderName={uploadFolderMeta.name}
          isPending={createUploadLinkMutation.isPending}
          onConfirm={(params) => createUploadLinkMutation.mutate({ folderId: uploadFolderMeta.id, ...params })}
          onCancel={() => setUploadFolderMeta(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ShareList
// ─────────────────────────────────────────────────────────────────────────────
interface ShareListProps {
  shares: any[];
  isLoading: boolean;
  emptyText: string;
  emptyHint: string;
  getStatus: (s: any) => 'active' | 'expired' | 'exhausted';
  isUploadTab?: boolean;
  onCopy: (id: string, share?: any) => void;
  onDelete: (id: string) => void;
  onBulkDelete: (ids: string[]) => void;
  isPending: boolean;
}

function ShareList({
  shares,
  isLoading,
  emptyText,
  emptyHint,
  getStatus,
  isUploadTab,
  onCopy,
  onDelete,
  onBulkDelete,
  isPending,
}: ShareListProps) {
  const activeShares = shares.filter((s) => getStatus(s) === 'active');
  const inactiveShares = shares.filter((s) => getStatus(s) !== 'active');

  if (isLoading) return <div className="text-center py-16 text-muted-foreground">加载中...</div>;

  if (shares.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground space-y-3">
        {isUploadTab ? (
          <Upload className="h-14 w-14 mx-auto opacity-20" />
        ) : (
          <Link2 className="h-14 w-14 mx-auto opacity-20" />
        )}
        <p className="font-medium">{emptyText}</p>
        <p className="text-sm">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activeShares.length > 0 && (
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">有效</h2>
          <div className="bg-card border rounded-xl overflow-hidden divide-y">
            {activeShares.map((share) => (
              <ShareItem
                key={share.id}
                share={share}
                status="active"
                isUploadTab={isUploadTab}
                onCopy={onCopy}
                onDelete={onDelete}
                isPending={isPending}
              />
            ))}
          </div>
        </section>
      )}
      {inactiveShares.length > 0 && (
        <section className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">已失效</h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-red-500"
              onClick={() => onBulkDelete(inactiveShares.map((s) => s.id))}
            >
              <Trash2 className="h-3 w-3 mr-1" /> 清理失效
            </Button>
          </div>
          <div className="bg-card border rounded-xl overflow-hidden divide-y opacity-60">
            {inactiveShares.map((share) => (
              <ShareItem
                key={share.id}
                share={share}
                status={getStatus(share)}
                isUploadTab={isUploadTab}
                onCopy={onCopy}
                onDelete={onDelete}
                isPending={isPending}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ShareItem
// ─────────────────────────────────────────────────────────────────────────────
interface ShareItemProps {
  share: any;
  status: 'active' | 'expired' | 'exhausted';
  isUploadTab?: boolean;
  onCopy: (id: string, share?: any) => void;
  onDelete: (id: string) => void;
  isPending?: boolean;
}

function ShareItem({ share, status, isUploadTab, onCopy, onDelete, isPending }: ShareItemProps) {
  const statusConfig = {
    active: { icon: CheckCircle2, label: '有效', color: 'text-emerald-500' },
    expired: { icon: AlertCircle, label: '已过期', color: 'text-amber-500' },
    exhausted: { icon: Ban, label: '次数已满', color: 'text-red-500' },
  };
  const { icon: StatusIcon, label, color } = statusConfig[status];

  const publicUrl =
    isUploadTab && share.uploadToken
      ? `${window.location.origin}/upload/${share.uploadToken}`
      : `${window.location.origin}/share/${share.id}`;

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 group hover:bg-accent/30 transition-colors">
      <div className="flex-shrink-0">
        <FileIcon mimeType={share.file?.mimeType} isFolder={share.file?.isFolder} size="md" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm truncate">{share.file?.name ?? '未知文件夹'}</p>
          <span className={cn('flex items-center gap-0.5 text-xs flex-shrink-0', color)}>
            <StatusIcon className="h-3 w-3" /> {label}
          </span>
          {isUploadTab && (
            <span className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded px-1.5 py-0.5">
              上传链接
            </span>
          )}
          {share.file?.isFolder && !isUploadTab && (
            <span className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded px-1.5 py-0.5">
              文件夹
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
          <span>创建 {formatDate(share.createdAt)}</span>
          {share.file && !share.file.isFolder && <span>{formatBytes(share.file.size)}</span>}
          {share.expiresAt && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {status === 'expired' ? '已过期于' : '过期'} {formatDate(share.expiresAt)}
            </span>
          )}
          {share.password && (
            <span className="flex items-center gap-0.5">
              <Lock className="h-3 w-3" /> 有密码
            </span>
          )}
          {!isUploadTab && share.downloadLimit != null && (
            <span className="flex items-center gap-0.5">
              <Download className="h-3 w-3" />
              {share.downloadCount} / {share.downloadLimit} 次
            </span>
          )}
          {isUploadTab && share.maxUploadCount != null && (
            <span className="flex items-center gap-0.5">
              <Upload className="h-3 w-3" />
              {share.uploadCount} / {share.maxUploadCount} 次
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity touch-visible">
        {status === 'active' && (
          <>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onCopy(share.id, share)}>
              <Copy className="h-3 w-3" /> 复制链接
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
          title="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
