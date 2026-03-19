/**
 * ActionBtn.tsx
 * 文件操作按钮组件
 *
 * 功能:
 * - 统一的操作按钮样式
 * - 支持普通/危险/浅色模式
 */

import { cn } from '@/utils';

interface ActionBtnProps {
  title: string;
  onClick: () => void;
  danger?: boolean;
  light?: boolean;
  children: React.ReactNode;
}

export function ActionBtn({ title, onClick, danger, light, children }: ActionBtnProps) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
        light
          ? danger
            ? 'bg-white/10 hover:bg-red-500/80 text-white'
            : 'bg-white/10 hover:bg-white/25 text-white'
          : danger
            ? 'hover:bg-red-500/10 hover:text-red-500 text-muted-foreground'
            : 'hover:bg-accent text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}
