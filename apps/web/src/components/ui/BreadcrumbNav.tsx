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
    // C-11 修复：窄屏允许横向滚动，避免深层路径把布局撑破
    <nav
      aria-label="面包屑"
      className={cn('flex flex-nowrap items-center gap-1 overflow-x-auto whitespace-nowrap text-sm', className)}
    >
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
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            {isLast ? (
              // C-11 修复：末项不可点击，用 span + aria-current 表达当前位置，避免产生无效 Tab 焦点
              <span
                aria-current="page"
                className="max-w-[160px] truncate text-foreground font-medium"
                title={decodeFileName(item.name)}
              >
                {decodeFileName(item.name)}
              </span>
            ) : (
              <button
                onClick={() => handleClick(item)}
                className="max-w-[160px] truncate text-muted-foreground transition-colors hover:text-foreground"
                title={decodeFileName(item.name)}
              >
                {decodeFileName(item.name)}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
