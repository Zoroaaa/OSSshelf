/**
 * NewFolderDialog.tsx
 * 新建文件夹对话框组件
 *
 * 功能:
 * - 文件夹名称输入
 * - 根目录时可选择绑定存储桶
 * - 移动端底部弹出面板
 */

import { useQuery } from '@tanstack/react-query';
import { bucketsApi, PROVIDER_META, type StorageBucket } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MobileDialog, MobileDialogFooter, MobileDialogAction } from '@/components/ui/MobileDialog';
import { cn } from '@/utils';
import { Database } from 'lucide-react';

interface NewFolderDialogProps {
  open: boolean;
  isRoot: boolean;
  name: string;
  bucketId: string | null;
  onNameChange: (v: string) => void;
  onBucketChange: (v: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function NewFolderDialog({
  open,
  isRoot,
  name,
  bucketId,
  onNameChange,
  onBucketChange,
  onConfirm,
  onCancel,
  loading,
}: NewFolderDialogProps) {
  const { data: buckets = [] } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => bucketsApi.list().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  const selected = (buckets as StorageBucket[]).find((b) => b.id === bucketId);
  const defaultBucket = (buckets as StorageBucket[]).find((b) => b.isDefault);

  return (
    <MobileDialog open={open} onClose={onCancel} title="新建文件夹" mode="sheet">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">文件夹名称</label>
          <Input
            placeholder="输入文件夹名称"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onConfirm()}
            autoFocus
          />
        </div>

        {isRoot && (buckets as StorageBucket[]).length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              绑定存储桶
            </label>
            <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border divide-y">
              <button
                type="button"
                onClick={() => onBucketChange(null)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors',
                  !bucketId ? 'bg-primary/5 text-primary font-medium' : 'hover:bg-muted/50 text-muted-foreground'
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                    !bucketId ? 'border-primary' : 'border-muted-foreground/30'
                  )}
                >
                  {!bucketId && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <span className="flex-1">使用默认桶{defaultBucket ? `（${defaultBucket.name}）` : ''}</span>
              </button>
              {(buckets as StorageBucket[])
                .filter((b) => b.isActive)
                .map((b) => {
                  const meta = PROVIDER_META[b.provider];
                  const isSelected = bucketId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onBucketChange(b.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors',
                        isSelected ? 'bg-primary/5 text-primary font-medium' : 'hover:bg-muted/50'
                      )}
                    >
                      <div
                        className={cn(
                          'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                          isSelected ? 'border-primary' : 'border-muted-foreground/30'
                        )}
                      >
                        {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                      <span className="text-base">{meta.icon}</span>
                      <span className="flex-1 truncate">{b.name}</span>
                      {b.isDefault && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">默认</span>
                      )}
                    </button>
                  );
                })}
            </div>
            {selected && (
              <p className="text-xs text-muted-foreground">此文件夹及其中的文件将存储到「{selected.name}」</p>
            )}
            {!bucketId && <p className="text-xs text-muted-foreground">未指定时使用默认存储桶</p>}
          </div>
        )}

        <MobileDialogFooter>
          <MobileDialogAction onClick={onCancel} disabled={loading}>
            取消
          </MobileDialogAction>
          <MobileDialogAction
            onClick={onConfirm}
            variant="primary"
            disabled={loading || !name.trim()}
            loading={loading}
          >
            创建
          </MobileDialogAction>
        </MobileDialogFooter>
      </div>
    </MobileDialog>
  );
}
