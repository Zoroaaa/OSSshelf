/**
 * MarkdownPreview.tsx
 * Markdown预览组件
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
}

export function MarkdownPreview({
  textContent,
  zoomLevel,
  showAIInfo,
  onToggleAIInfo,
  aiSummary,
  aiSummaryAt,
  onGenerateSummary,
  isGeneratingSummary,
}: MarkdownPreviewProps) {
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
