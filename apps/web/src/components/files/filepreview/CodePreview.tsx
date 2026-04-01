/**
 * CodePreview.tsx
 * 代码预览组件
 */

import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/utils';
import { AISummaryCard } from '@/components/ai';
import { highlightCode } from './previewUtils';

interface CodePreviewProps {
  textContent: string | null;
  zoomLevel: number;
  detectedLanguage: string;
  showAIInfo: boolean;
  onToggleAIInfo: () => void;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  onGenerateSummary: () => void;
  isGeneratingSummary: boolean;
}

export function CodePreview({
  textContent,
  zoomLevel,
  detectedLanguage,
  showAIInfo,
  onToggleAIInfo,
  aiSummary,
  aiSummaryAt,
  onGenerateSummary,
  isGeneratingSummary,
}: CodePreviewProps) {
  const highlightedCode = useMemo(() => {
    if (!textContent) return null;
    return highlightCode(textContent, detectedLanguage);
  }, [textContent, detectedLanguage]);

  return (
    <div className="relative w-full h-full">
      <div
        className="w-full h-full overflow-auto bg-gray-50 dark:bg-gray-900"
        style={{ fontSize: `${zoomLevel}%` }}
      >
        {textContent !== null ? (
          <pre className="p-4 m-0 leading-relaxed">
            <code
              className={`language-${detectedLanguage} hljs text-gray-800 dark:text-gray-200`}
              dangerouslySetInnerHTML={{ __html: highlightedCode || textContent }}
            />
          </pre>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
          </div>
        )}
      </div>
      <button
        className="absolute bottom-4 right-4 p-2 rounded-full bg-background/80 backdrop-blur border shadow-sm hover:bg-background transition-colors"
        onClick={onToggleAIInfo}
        title={showAIInfo ? '隐藏 AI 信息' : '显示 AI 信息'}
      >
        <Sparkles className={cn('h-4 w-4', showAIInfo ? 'text-primary' : 'text-muted-foreground')} />
      </button>
      {showAIInfo && (
        <div className="absolute bottom-4 right-16 w-80">
          <AISummaryCard
            summary={aiSummary}
            summaryAt={aiSummaryAt}
            onGenerate={onGenerateSummary}
            isGenerating={isGeneratingSummary}
            showGenerateButton
          />
        </div>
      )}
    </div>
  );
}
