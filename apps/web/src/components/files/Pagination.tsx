import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/utils';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
// C-15 修复：pageSize 放宽为 number，支持业务页自定义每页条数（如 Tags 页 10 条）。
type PageSize = number;

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  if (totalPages <= 1 && totalItems <= pageSize) return null;

  const getPageNumbers = () => {
    const pages: (number | '...')[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
      return pages;
    }

    pages.push(1);

    if (currentPage > 3) {
      pages.push('...');
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push('...');
    }

    pages.push(totalPages);

    return pages;
  };

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    // C-16 修复：容器可换行，窄屏不再横向溢出
    <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          共 <span className="font-medium text-foreground">{totalItems}</span> 条
        </span>
        <div className="flex items-center gap-1.5">
          <span>每页</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            className="h-9 w-16 touch-target-sm rounded border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>条</span>
        </div>
        {totalItems > 0 && (
          <span className="hidden sm:inline">
            第 {startItem}-{endItem} 条
          </span>
        )}
      </div>

      {/* C-16 修复：分页区可换行；移动端隐藏首页/末页以精简页码数量 */}
      <nav className="flex flex-wrap items-center gap-1" aria-label="分页导航">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className={cn(
            // C-16 修复：触控目标提升到 36px（touch-target-sm），窄屏隐藏
            'inline-flex h-9 w-9 touch-target-sm items-center justify-center rounded border transition-colors max-sm:hidden',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
          aria-label="首页"
          title="首页"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={cn(
            // C-16 修复：触控目标提升到 36px（touch-target-sm）
            'inline-flex h-9 w-9 touch-target-sm items-center justify-center rounded border transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
          aria-label="上一页"
          title="上一页"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {/* C-16 修复：页码区可换行，按钮触控目标提升到 36px */}
        <div className="flex flex-wrap items-center gap-0.5">
          {getPageNumbers().map((page, idx) =>
            page === '...' ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground">
                ...
              </span>
            ) : (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={cn(
                  'inline-flex h-9 min-w-9 touch-target-sm items-center justify-center rounded border px-2 text-xs transition-colors',
                  page === currentPage
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {page}
              </button>
            )
          )}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={cn(
            // C-16 修复：触控目标提升到 36px（touch-target-sm）
            'inline-flex h-9 w-9 touch-target-sm items-center justify-center rounded border transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
          aria-label="下一页"
          title="下一页"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className={cn(
            // C-16 修复：触控目标提升到 36px（touch-target-sm），窄屏隐藏
            'inline-flex h-9 w-9 touch-target-sm items-center justify-center rounded border transition-colors max-sm:hidden',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:pointer-events-none disabled:opacity-40'
          )}
          aria-label="末页"
          title="末页"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </nav>
    </div>
  );
}
