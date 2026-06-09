/**
 * Trash.tsx
 * 回收站页面
 *
 * 功能:
 * - 查看已删除文件（支持分页）
 * - 恢复文件
 * - 永久删除文件
 * - 清空回收站
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { FileIcon } from '@/components/files/FileIcon';
import { MobileDialog, MobileDialogFooter, MobileDialogAction } from '@/components/ui/MobileDialog';
import { useToast } from '@/components/ui/useToast';
import { formatBytes, formatDate, decodeFileName } from '@/utils';
import { Trash2, RotateCcw, AlertTriangle, PackageOpen } from 'lucide-react';
import type { FileItem } from '@osshelf/shared';

const TRASH_PAGE_SIZE = 50;

export default function Trash() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data: items = [], isLoading } = useQuery<FileItem[]>({
    queryKey: ['trash', page],
    queryFn: () => filesApi.listTrash({ page, limit: TRASH_PAGE_SIZE }).then((r) => r.data.data ?? []),
  });

  // 确认对话框状态
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    action: () => void;
    danger?: boolean;
  }>({ open: false, title: '', message: '', action: () => {} });

  const askConfirm = useCallback((title: string, message: string, action: () => void, danger = true) => {
    setConfirmState({ open: true, title, message, action, danger });
  }, []);

  const restoreMutation = useMutation({
    mutationFn: (id: string) => filesApi.restoreTrash(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({ title: '已恢复文件' });
    },
    onError: () => toast({ title: '恢复失败', variant: 'destructive' }),
  });

  const deleteOneMutation = useMutation({
    mutationFn: (id: string) => filesApi.deleteTrash(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      toast({ title: '已永久删除' });
    },
    onError: () => toast({ title: '删除失败', variant: 'destructive' }),
  });

  const emptyMutation = useMutation({
    mutationFn: () => filesApi.emptyTrash(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({ title: res.data.data?.message ?? '已清空回收站' });
    },
    onError: () => toast({ title: '清空失败', variant: 'destructive' }),
  });

  const handleEmpty = () => {
    askConfirm('清空回收站', `确定要永久删除回收站中所有文件吗？此操作不可撤销。`, () => emptyMutation.mutate());
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold">回收站</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {items.length > 0 ? `${items.length} 个文件等待清理` : '回收站是空的'}
        </p>
      </div>

      {/* Actions */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="destructive" size="sm" onClick={handleEmpty} disabled={emptyMutation.isPending}>
            <Trash2 className="h-4 w-4 mr-1.5" />
            清空回收站
          </Button>
        </div>
      )}

      {/* Warning banner */}
      {items.length > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>回收站中的文件不占用您的存储配额，但在永久删除前仍保留在服务器上。</span>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">加载中...</div>
      ) : items.length === 0 && page === 1 ? (
        <div className="text-center py-16 text-muted-foreground space-y-3">
          <PackageOpen className="h-14 w-14 mx-auto opacity-20" />
          <p className="font-medium">回收站是空的</p>
          <p className="text-sm">删除的文件会出现在这里</p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden divide-y">
          {items.map((file: FileItem) => (
            <TrashItem
              key={file.id}
              file={file}
              onRestore={() => restoreMutation.mutate(file.id)}
              onDelete={() =>
                askConfirm('永久删除', `永久删除 "${decodeFileName(file.name)}"？此操作不可撤销。`, () =>
                  deleteOneMutation.mutate(file.id)
                )
              }
              restorePending={restoreMutation.isPending}
              deletePending={deleteOneMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {items.length > 0 && items.length >= TRASH_PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">第 {page} 页</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      )}

      {/* Confirm Dialog */}
      <MobileDialog
        open={confirmState.open}
        onClose={() => setConfirmState((s) => ({ ...s, open: false }))}
        title={confirmState.title}
      >
        <p className="text-sm text-muted-foreground">{confirmState.message}</p>
        <MobileDialogFooter>
          <MobileDialogAction onClick={() => setConfirmState((s) => ({ ...s, open: false }))}>取消</MobileDialogAction>
          <MobileDialogAction
            variant={confirmState.danger ? 'danger' : 'primary'}
            onClick={() => {
              setConfirmState((s) => ({ ...s, open: false }));
              confirmState.action();
            }}
          >
            确定
          </MobileDialogAction>
        </MobileDialogFooter>
      </MobileDialog>
    </div>
  );
}

interface TrashItemProps {
  file: FileItem;
  onRestore: () => void;
  onDelete: () => void;
  restorePending?: boolean;
  deletePending?: boolean;
}

function TrashItem({ file, onRestore, onDelete, restorePending, deletePending }: TrashItemProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors group">
      <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="md" className="flex-shrink-0 opacity-60" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-muted-foreground">{decodeFileName(file.name)}</p>
        <p className="text-xs text-muted-foreground/70">
          {file.isFolder ? '文件夹' : formatBytes(file.size)}
          {(file as any).deletedAt && <span className="ml-2">· 删除于 {formatDate((file as any).deletedAt)}</span>}
        </p>
      </div>
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 touch-visible">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRestore} disabled={restorePending}>
          <RotateCcw className="h-3 w-3 mr-1" />
          恢复
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-red-500/10 hover:text-red-500"
          onClick={onDelete}
          disabled={deletePending}
          title="永久删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
