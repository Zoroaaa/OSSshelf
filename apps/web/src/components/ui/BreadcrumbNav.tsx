/**
 * BreadcrumbNav.tsx
 * 面包屑导航组件
 *
 * 功能:
 * - 显示当前路径
 * - 支持点击跳转
 * - 响应式布局
 */

import { useNavigate } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { cn, decodeFileName } from '@/utils';

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function BreadcrumbNav({ items, className }: BreadcrumbNavProps) {
  const navigate = useNavigate();

  const handleClick = (item: BreadcrumbItem) => {
    if (item.id === null) {
      navigate('/files');
    } else {
      navigate(`/files/${item.id}`);
    }
  };

  return (
    <nav className={cn('flex items-center gap-1 text-sm', className)}>
      <button
        onClick={() => navigate('/files')}
        className={cn(
          'flex items-center gap-1 transition-colors',
          items.length === 0 ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Home className="h-3.5 w-3.5" />
        <span>根目录</span>
      </button>

      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={item.id ?? 'root'} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
            <button
              onClick={() => !isLast && handleClick(item)}
              className={cn(
                'max-w-[160px] truncate transition-colors',
                isLast
                  ? 'text-foreground font-medium cursor-default'
                  : 'text-muted-foreground hover:text-foreground cursor-pointer'
              )}
              title={decodeFileName(item.name)}
            >
              {decodeFileName(item.name)}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
