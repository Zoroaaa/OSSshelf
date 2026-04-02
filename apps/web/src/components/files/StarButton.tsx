/**
 * StarButton.tsx
 * 收藏按钮组件
 *
 * 功能:
 * - 收藏/取消收藏文件
 * - 显示收藏状态
 */

import { useState } from 'react';
import { Star } from 'lucide-react';
import { filesApi } from '../../services/api';
import { cn } from '../../utils';

interface StarButtonProps {
  fileId: string;
  isStarred: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'icon' | 'button';
  onToggle?: (isStarred: boolean) => void;
  className?: string;
}

export function StarButton({
  fileId,
  isStarred: initialIsStarred,
  size = 'md',
  variant = 'icon',
  onToggle,
  className,
}: StarButtonProps) {
  const [isStarred, setIsStarred] = useState(initialIsStarred);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (isStarred) {
        await filesApi.unstar(fileId);
        setIsStarred(false);
        onToggle?.(false);
      } else {
        await filesApi.star(fileId);
        setIsStarred(true);
        onToggle?.(true);
      }
    } catch (error) {
      console.error('Failed to toggle star:', error);
    } finally {
      setLoading(false);
    }
  };

  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  };

  if (variant === 'button') {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          isStarred
            ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400',
          loading && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        <Star className={cn(sizeClasses[size], isStarred && 'fill-current')} />
        {isStarred ? '已收藏' : '收藏'}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={cn(
        'p-1 rounded transition-colors',
        isStarred ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-400 hover:text-yellow-500',
        loading && 'opacity-50 cursor-not-allowed',
        className
      )}
      title={isStarred ? '取消收藏' : '收藏'}
    >
      <Star className={cn(sizeClasses[size], isStarred && 'fill-current')} />
    </button>
  );
}
