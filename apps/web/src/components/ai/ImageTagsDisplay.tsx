/**
 * ImageTagsDisplay.tsx
 * 图片标签显示组件
 */

import { Tag, RefreshCw } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from '@/components/ui/Button';

interface ImageTagsDisplayProps {
  tags?: string[];
  onGenerate?: () => void;
  isGenerating?: boolean;
  showGenerateButton?: boolean;
}

export function ImageTagsDisplay({ tags, onGenerate, isGenerating, showGenerateButton }: ImageTagsDisplayProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI 标签</span>
        </div>
        {showGenerateButton && (
          <Button variant="ghost" size="sm" onClick={onGenerate} disabled={isGenerating} className="h-7 px-2">
            <RefreshCw className={cn('h-3.5 w-3.5', isGenerating && 'animate-spin')} />
            {tags && tags.length > 0 ? '重新生成' : '生成'}
          </Button>
        )}
      </div>

      {tags && tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded-full">
              {tag}
            </span>
          ))}
        </div>
      ) : showGenerateButton ? (
        <p className="text-sm text-muted-foreground">暂无标签，点击生成</p>
      ) : null}
    </div>
  );
}
