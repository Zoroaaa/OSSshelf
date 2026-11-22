/**
 * AppDialog.tsx
 * 统一弹窗基类（审查报告 A-03 / A-15 / A-17 / A-18 的基础设施）
 *
 * 基于项目已安装但此前零使用的 @radix-ui/react-dialog，集中实现：
 * - Portal（避免父级层叠上下文陷阱）
 * - Overlay 与 Content 统一层级（z-overlay=50）
 * - 焦点陷阱、关闭后焦点归还
 * - Escape 关闭、点遮罩关闭
 * - aria-modal / aria-labelledby 语义
 * - 注册到全局弹窗栈（供 FAB 隐藏 + 滚动锁引用计数）
 *
 * 用法：
 *   <AppDialog open={open} onClose={() => setOpen(false)} title="编辑">
 *     ...内容...
 *   </AppDialog>
 */

import { useEffect, useId } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/utils';
import { dialogStack } from '@/lib/dialogStack';

export interface AppDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** 唯一 id，用于弹窗栈注册；不传则自动生成 */
  stackId?: string;
  /** 内容区额外样式 */
  className?: string;
  /** 内容区最大宽度类，默认 max-w-md */
  widthClass?: string;
  /** 是否显示右上角关闭按钮 */
  showClose?: boolean;
  /** 是否允许点遮罩/Escape 关闭，默认 true */
  dismissible?: boolean;
}

const autoId = (() => {
  let n = 0;
  return () => `app-dialog-${++n}`;
})();

export function AppDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  stackId,
  className,
  widthClass = 'max-w-md',
  showClose = true,
  dismissible = true,
}: AppDialogProps) {
  const reactId = useId();
  const id = stackId ?? reactId ?? autoId();
  const titleId = `dialog-title-${id}`;
  const descId = `dialog-desc-${id}`;

  useEffect(() => {
    if (!open) return;
    dialogStack.push(id);
    return () => dialogStack.pop(id);
  }, [open, id]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && dismissible && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          className={cn(
            'fixed left-1/2 top-1/2 z-overlay -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100%-2rem)] rounded-xl border bg-card text-card-foreground shadow-overlay',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            widthClass,
            className
          )}
        >
          {(title || showClose) && (
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div className="min-w-0">
                {title && (
                  <Dialog.Title id={titleId} className="text-base font-semibold">
                    {title}
                  </Dialog.Title>
                )}
                {description && (
                  <Dialog.Description id={descId} className="mt-1 text-sm text-muted-foreground">
                    {description}
                  </Dialog.Description>
                )}
              </div>
              {showClose && (
                <Dialog.Close
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground touch-target-sm flex items-center justify-center"
                  aria-label="关闭对话框"
                >
                  <X className="h-4 w-4" />
                </Dialog.Close>
              )}
            </div>
          )}
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t px-5 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
