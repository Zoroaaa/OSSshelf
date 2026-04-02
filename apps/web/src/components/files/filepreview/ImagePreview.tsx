/**
 * ImagePreview.tsx
 * 图片预览组件
 */

import { Sparkles } from 'lucide-react';
import { cn } from '@/utils';
import { decodeFileName } from '@/utils';
import { AISummaryCard, ImageTagsDisplay } from '@/components/ai';

interface ImagePreviewProps {
  resolvedUrl: string;
  fileName: string;
  zoomLevel: number;
  onLoadError: () => void;
  showAIInfo: boolean;
  onToggleAIInfo: () => void;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  aiTags: string[];
  onGenerateSummary: () => void;
  onGenerateTags: () => void;
  isGeneratingSummary: boolean;
  isGeneratingTags: boolean;
}

export function ImagePreview({
  resolvedUrl,
  fileName,
  zoomLevel,
  onLoadError,
  showAIInfo,
  onToggleAIInfo,
  aiSummary,
  aiSummaryAt,
  aiTags,
  onGenerateSummary,
  onGenerateTags,
  isGeneratingSummary,
  isGeneratingTags,
}: ImagePreviewProps) {
  return (
    <div className="relative flex items-center justify-center h-full overflow-auto p-4">
      <img
        src={resolvedUrl}
        alt={decodeFileName(fileName)}
        className="max-w-full max-h-full object-contain"
        style={{ transform: `scale(${zoomLevel / 100})` }}
        onError={onLoadError}
      />
      <button
        className="absolute bottom-4 right-4 p-2 rounded-full bg-background/80 backdrop-blur border shadow-sm hover:bg-background transition-colors"
        onClick={onToggleAIInfo}
        title={showAIInfo ? '隐藏 AI 信息' : '显示 AI 信息'}
      >
        <Sparkles className={cn('h-4 w-4', showAIInfo ? 'text-primary' : 'text-muted-foreground')} />
      </button>
      {showAIInfo && (
        <div className="absolute bottom-4 left-4 right-16 max-w-md">
          <div className="bg-background/95 backdrop-blur border rounded-lg p-3 space-y-2 shadow-lg">
            <AISummaryCard
              summary={aiSummary}
              summaryAt={aiSummaryAt}
              title="AI 描述"
              emptyText="暂无描述，点击下方生成标签"
              showGenerateButton={false}
            />
            <ImageTagsDisplay
              tags={aiTags}
              onGenerate={onGenerateTags}
              isGenerating={isGeneratingTags}
              showGenerateButton
            />
          </div>
        </div>
      )}
    </div>
  );
}
