/**
 * ImageTagsDisplay.tsx
 * 图片标签显示组件
 */

import { useState } from 'react';
import { Tag, RefreshCw, Loader2 } from 'lucide-react';
import { aiApi } from '@/services/api';

interface ImageTagsDisplayProps {
  fileId: string;
  tags?: string[];
  tagsAt?: string | null;
  onTagsGenerated?: (tags: string[]) => void;
  onTagClick?: (tag: string) => void;
}

export function ImageTagsDisplay({
  fileId,
  tags: initialTags,
  tagsAt,
  onTagsGenerated,
  onTagClick,
}: ImageTagsDisplayProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [localTags, setLocalTags] = useState<string[]>(initialTags || []);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await aiApi.generateTags(fileId);
      if (response.data.success && response.data.data) {
        setLocalTags(response.data.data.tags);
        onTagsGenerated?.(response.data.data.tags);
      }
    } catch (e: any) {
      setError(e.response?.data?.error?.message || '生成标签失败');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI 标签</span>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="p-2 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
          title="生成标签"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {localTags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {localTags.map((tag) => (
            <span
              key={tag}
              onClick={() => onTagClick?.(tag)}
              className="px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded-full cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          点击刷新按钮生成 AI 标签
        </p>
      )}
    </div>
  );
}
