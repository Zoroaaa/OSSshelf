/**
 * MarkdownPreview.tsx
 * Markdown预览组件
 */

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ErrorState } from '@/components/ui/AsyncState';
import rehypeHighlight from 'rehype-highlight';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Sparkles } from 'lucide-react';
import { cn } from '@/utils';
import { AISummaryCard } from '@/components/ai';

import 'katex/dist/katex.min.css';

interface MarkdownPreviewProps {
  textContent: string | null;
  zoomLevel: number;
  showAIInfo: boolean;
  onToggleAIInfo: () => void;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  onGenerateSummary: () => void;
  isGeneratingSummary: boolean;
  /** 可选：内容加载失败时的外部重试入口 */
  onRetry?: () => void;
}

// E-08：textContent 长时间为空即视为加载失败，避免永久停留在「加载中...」
const LOAD_TIMEOUT_MS = 15000;

export function MarkdownPreview({
  textContent,
  zoomLevel,
  showAIInfo,
  onToggleAIInfo,
  aiSummary,
  aiSummaryAt,
  onGenerateSummary,
  isGeneratingSummary,
  onRetry,
}: MarkdownPreviewProps) {
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // E-08：加载超时兜底；内容到达即清除错误态，重试则重新计时
  useEffect(() => {
    if (textContent !== null) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [textContent, attempt]);

  const handleRetry = () => {
    setTimedOut(false);
    setAttempt((value) => value + 1);
    onRetry?.();
  };

  return (
    <div className="relative w-full h-full">
      <div
        className="w-full h-full overflow-auto p-6 prose dark:prose-invert max-w-none prose-table:border-collapse prose-th:border prose-th:border-border prose-th:bg-muted prose-th:p-2 prose-td:border prose-td:border-border prose-td:p-2 prose-tr:even:bg-muted/30"
        style={{ fontSize: `${zoomLevel}%` }}
      >
        {textContent !== null ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { strict: false }], rehypeHighlight]}
            components={{
              pre: ({ children, ...props }) => {
                return (
                  <pre
                    {...props}
                    className="overflow-x-auto bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                  >
                    {children}
                  </pre>
                );
              },
              code: ({ className, children, ...props }) => {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className?.includes('hljs');
                if (isInline) {
                  return (
                    <code
                      className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm font-mono"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={`${className || ''} text-gray-800 dark:text-gray-200`} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {textContent}
          </ReactMarkdown>
        ) : timedOut ? (
          // E-08：超时后显示错误态与重试入口，不再永久停留在加载中
          <ErrorState
            title="内容加载失败"
            message="文件内容长时间未能加载，请重试"
            onRetry={handleRetry}
          />
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
