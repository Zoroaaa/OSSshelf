/**
 * PermissionRequestButton.tsx
 * 权限申请触发按钮
 *
 * 功能:
 * - 在文件列表项旁边显示"申请访问"入口
 * - 已有权限时显示为灰色不可用状态
 * - 点击打开申请对话框
 */

import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import { PermissionRequestDialog } from './PermissionRequestDialog';

interface PermissionRequestButtonProps {
  fileId: string;
  fileName: string;
  hasAccess: boolean;
}

export const PermissionRequestButton: React.FC<PermissionRequestButtonProps> = ({
  fileId,
  fileName,
  hasAccess,
}) => {
  const [open, setOpen] = useState(false);

  if (hasAccess) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground">
        <Send className="h-3 w-3" />
        已有权限
      </span>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn('gap-1 text-xs h-7')}
      >
        <Send className="h-3 w-3" />
        申请访问
      </Button>

      {open && (
        <PermissionRequestDialog
          fileId={fileId}
          fileName={fileName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
