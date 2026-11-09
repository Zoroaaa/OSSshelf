/**
 * ShareTargetInbox.tsx
 * 接收系统分享面板内容后的确认对话框
 *
 * 功能:
 * - 展示系统分享传入的文件清单
 * - 用户确认后上传到当前目录，或取消并丢弃
 */

import { MobileDialog, MobileDialogFooter, MobileDialogAction } from '@/components/ui/MobileDialog';
import { formatBytes } from '@/utils';
import type { SharedFile } from '@/utils/shareTarget';

interface ShareTargetInboxProps {
  open: boolean;
  files: Pick<SharedFile, 'name' | 'size'>[];
  uploading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ShareTargetInbox({ open, files, uploading, onConfirm, onCancel }: ShareTargetInboxProps) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <MobileDialog
      open={open}
      onClose={() => {
        if (!uploading) onCancel();
      }}
      title="接收系统分享"
      mode="sheet"
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          收到 {files.length} 个文件（共 {formatBytes(totalSize)}），是否上传到当前目录？
        </p>

        <ul className="max-h-48 overflow-y-auto rounded-lg border divide-y">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate">{file.name}</span>
              <span className="flex-shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
            </li>
          ))}
        </ul>

        <MobileDialogFooter>
          <MobileDialogAction onClick={onCancel} disabled={uploading}>
            取消
          </MobileDialogAction>
          <MobileDialogAction onClick={onConfirm} variant="primary" loading={uploading}>
            上传到当前目录
          </MobileDialogAction>
        </MobileDialogFooter>
      </div>
    </MobileDialog>
  );
}
