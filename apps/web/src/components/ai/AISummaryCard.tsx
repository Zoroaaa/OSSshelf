/**
 * AISummaryCard.tsx
 * AI 摘要卡片组件
 */

import { useState } from 'react';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { aiApi } from '@/services/api';
import { formatDate } from '@/utils';

interface AISummaryCardProps {
  fileId: string;
  summary?: string | null;
  summaryAt?: string | null;
  onSummaryGenerated?: (summary: string) => void;
}

export function AISummaryCard({
  fileId,
  summary,
  summaryAt,
  onSummaryGenerated,
}: AISummaryCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [localSummary, setLocalSummary] = useState(summary);
  // 内部维护 summaryAt，生成后立即更新，不依赖父组件重渲染
  const [localSummaryAt, setLocalSummaryAt] = useState(summaryAt);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await aiApi.summarize(fileId);
      if (response.data.success && response.data.data) {
        const newSummary = response.data.data.summary;
        setLocalSummary(newSummary);
        setLocalSummaryAt(new Date().toISOString());
        onSummaryGenerated?.(newSummary);
      }
    } catch (e: any) {
      setError(e.response?.data?.error?.message || '生成摘要失败');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium">AI 摘要</span>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="p-2 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
          title={localSummary ? '重新生成摘要' : '生成 AI 摘要'}
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

      {localSummary ? (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{localSummary}</p>
          {localSummaryAt && (
            <p className="text-xs text-muted-foreground/60">
              生成于 {formatDate(localSummaryAt)}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          点击刷新按钮生成 AI 摘要
        </p>
      )}
    </div>
  );
}
