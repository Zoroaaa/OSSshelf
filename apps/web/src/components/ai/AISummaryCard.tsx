/**
 * AISummaryCard.tsx
 * AI 摘要/描述卡片组件
 */

import { Sparkles, RefreshCw } from 'lucide-react';
import { formatDate, cn } from '@/utils';
import { Button } from '@/components/ui/Button';

interface AISummaryCardProps {
  summary?: string | null;
  summaryAt?: string | null;
  onGenerate?: () => void;
  isGenerating?: boolean;
  showGenerateButton?: boolean;
  title?: string;
  emptyText?: string;
}

export function AISummaryCard({
  summary,
  summaryAt,
  onGenerate,
  isGenerating,
  showGenerateButton,
  title = 'AI 摘要',
  emptyText = '暂无摘要，点击生成',
}: AISummaryCardProps) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{title}</span>
        </div>
        {showGenerateButton && (
          <Button variant="ghost" size="sm" onClick={onGenerate} disabled={isGenerating} className="h-7 px-2">
            <RefreshCw className={cn('h-3.5 w-3.5', isGenerating && 'animate-spin')} />
            {summary ? '重新生成' : '生成'}
          </Button>
        )}
      </div>
      {summary ? (
        <>
          <p className="text-sm text-muted-foreground">{summary}</p>
          {summaryAt && <p className="text-xs text-muted-foreground">生成于 {formatDate(summaryAt)}</p>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}
