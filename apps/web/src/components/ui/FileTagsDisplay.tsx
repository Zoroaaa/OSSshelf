/**
 * FileTagsDisplay.tsx
 * 轻量级标签显示组件
 * 
 * 功能:
 * - 紧凑显示文件标签
 * - 支持点击标签触发搜索
 * - 最大显示数量限制
 */

import { memo } from 'react';
import type { FileTag } from '@osshelf/shared';
import { cn } from '@/utils';

interface FileTagsDisplayProps {
  tags: FileTag[];
  maxDisplay?: number;
  onTagClick?: (tagName: string) => void;
  className?: string;
  size?: 'xs' | 'sm';
}

export const FileTagsDisplay = memo(function FileTagsDisplay({
  tags,
  maxDisplay = 3,
  onTagClick,
  className,
  size = 'xs',
}: FileTagsDisplayProps) {
  if (!tags || tags.length === 0) return null;

  const displayTags = tags.slice(0, maxDisplay);
  const remainingCount = tags.length - maxDisplay;

  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-[10px] gap-0.5',
    sm: 'px-2 py-0.5 text-xs gap-1',
  };

  const dotSizeClasses = {
    xs: 'w-1 h-1',
    sm: 'w-1.5 h-1.5',
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {displayTags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTagClick?.(tag.name);
          }}
          className={cn(
            'inline-flex items-center rounded-full font-medium transition-all',
            sizeClasses[size],
            onTagClick && 'cursor-pointer hover:opacity-80 hover:scale-105'
          )}
          style={{
            backgroundColor: tag.color + '20',
            color: tag.color,
          }}
          title={tag.name}
        >
          <span
            className={cn('rounded-full flex-shrink-0', dotSizeClasses[size])}
            style={{ backgroundColor: tag.color }}
          />
          <span className="truncate max-w-[60px]">{tag.name}</span>
        </button>
      ))}
      {remainingCount > 0 && (
        <span
          className={cn(
            'inline-flex items-center rounded-full bg-muted text-muted-foreground font-medium',
            sizeClasses[size]
          )}
          title={`${remainingCount} 个更多标签`}
        >
          +{remainingCount}
        </span>
      )}
    </div>
  );
});
