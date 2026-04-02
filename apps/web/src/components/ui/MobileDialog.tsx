/**
 * MobileDialog.tsx
 * 通用移动端对话框组件
 *
 * 功能:
 * - 桌面端: 居中弹窗
 * - 移动端: 底部弹出面板或全屏模式
 * - 手势关闭支持
 */

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils';
import { X } from 'lucide-react';
import { useResponsive } from '@/hooks/useResponsive';

export type MobileDialogMode = 'sheet' | 'fullscreen';

interface MobileDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  mode?: MobileDialogMode;
  showCloseButton?: boolean;
  className?: string;
  contentClassName?: string;
}

export function MobileDialog({
  open,
  onClose,
  title,
  children,
  mode = 'sheet',
  showCloseButton = true,
  className,
  contentClassName,
}: MobileDialogProps) {
  const { isMobile } = useResponsive();
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const startYRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setIsVisible(true);
      requestAnimationFrame(() => setIsAnimating(true));
      document.body.style.overflow = 'hidden';
      return () => {};
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => {
        setIsVisible(false);
        document.body.style.overflow = '';
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || mode !== 'sheet') return;
    const touch = e.touches[0];
    if (touch) startYRef.current = touch.clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isMobile || mode !== 'sheet') return;
    const touch = e.touches[0];
    if (!touch) return;
    const deltaY = touch.clientY - startYRef.current;
    if (deltaY > 0 && contentRef.current) {
      contentRef.current.style.transform = `translateY(${deltaY}px)`;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile || mode !== 'sheet') return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaY = touch.clientY - startYRef.current;
    if (contentRef.current) {
      contentRef.current.style.transform = '';
    }
    if (deltaY > 100) {
      onClose();
    }
  };

  if (!isVisible) return null;

  const content = isMobile ? (
    mode === 'sheet' ? (
      <div className="fixed inset-0 z-50">
        <div
          className={cn(
            'fixed inset-0 bg-black/50 transition-opacity duration-300',
            isAnimating ? 'opacity-100' : 'opacity-0'
          )}
          onClick={onClose}
        />
        <div
          ref={contentRef}
          className={cn(
            'mobile-sheet',
            'transition-transform duration-300 ease-out',
            isAnimating ? 'translate-y-0' : 'translate-y-full',
            className
          )}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="flex items-center justify-center py-2">
            <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
          </div>
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between px-4 pb-3 border-b">
              {title && <h2 className="text-lg font-semibold">{title}</h2>}
              {showCloseButton && (
                <button
                  onClick={onClose}
                  className="p-2 -mr-2 rounded-full hover:bg-accent touch-target-sm flex items-center justify-center"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          )}
          <div className={cn('p-4', contentClassName)}>{children}</div>
        </div>
      </div>
    ) : (
      <div className="mobile-dialog">
        <div className="flex items-center justify-between px-4 py-3 border-b safe-top">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {showCloseButton && (
            <button
              onClick={onClose}
              className="p-2 -mr-2 rounded-full hover:bg-accent touch-target-sm flex items-center justify-center"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className={cn('flex-1 overflow-y-auto', contentClassName)}>{children}</div>
      </div>
    )
  ) : (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={cn(
          'bg-card border rounded-xl shadow-2xl w-full max-w-md',
          'transition-all duration-300',
          isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
          className
        )}
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-6 py-4 border-b">
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {showCloseButton && (
              <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg hover:bg-accent transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <div className={cn('p-6', contentClassName)}>{children}</div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

interface MobileDialogFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function MobileDialogFooter({ children, className }: MobileDialogFooterProps) {
  const { isMobile } = useResponsive();

  return (
    <div className={cn('flex gap-2', isMobile ? 'flex-col-reverse safe-bottom pt-2' : 'justify-end pt-4', className)}>
      {children}
    </div>
  );
}

interface MobileDialogActionProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function MobileDialogAction({
  children,
  onClick,
  variant = 'default',
  disabled,
  loading,
  className,
}: MobileDialogActionProps) {
  const { isMobile } = useResponsive();

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'font-medium rounded-xl transition-colors',
        isMobile ? 'w-full py-3 text-center' : 'px-4 py-2',
        variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'danger' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        variant === 'default' && 'bg-muted hover:bg-muted/80',
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {loading ? '处理中...' : children}
    </button>
  );
}
