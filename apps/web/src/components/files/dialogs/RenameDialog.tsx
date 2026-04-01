/**
 * RenameDialog.tsx
 * 重命名对话框组件
 *
 * 功能:
 * - 文件/文件夹重命名
 * - 移动端底部弹出面板
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { MobileDialog, MobileDialogFooter, MobileDialogAction } from '@/components/ui/MobileDialog';
import { decodeFileName } from '@/utils';

interface RenameDialogProps {
  open: boolean;
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function RenameDialog({ open, currentName, onConfirm, onCancel, isPending }: RenameDialogProps) {
  const decodedName = decodeFileName(currentName);
  const [name, setName] = useState(decodedName);

  useEffect(() => {
    if (open) {
      setName(decodedName);
    }
  }, [decodedName, open]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== decodedName) {
      onConfirm(trimmed);
    } else if (trimmed === decodedName) {
      onCancel();
    }
  };

  return (
    <MobileDialog open={open} onClose={onCancel} title="重命名" mode="sheet">
      <div className="space-y-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          autoFocus
        />
        <MobileDialogFooter>
          <MobileDialogAction onClick={onCancel} disabled={isPending}>
            取消
          </MobileDialogAction>
          <MobileDialogAction
            onClick={handleSubmit}
            variant="primary"
            disabled={isPending || !name.trim()}
            loading={isPending}
          >
            确认
          </MobileDialogAction>
        </MobileDialogFooter>
      </div>
    </MobileDialog>
  );
}
