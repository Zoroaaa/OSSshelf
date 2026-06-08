import { useState, useEffect, useRef } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';

interface ReasoningSectionProps {
  content: string;
  isStreaming?: boolean;
}

export function ReasoningSection({ content, isStreaming = false }: ReasoningSectionProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevContentLengthRef = useRef(0);
  const userManuallyToggledRef = useRef(false);
  const hasAutoCollapsedRef = useRef(false);

  // ═══ Effect 1: Streaming 开始时自动展开 + 实时滚动 ═══
  useEffect(() => {
    if (isStreaming && !expanded) {
      setExpanded(true);
      userManuallyToggledRef.current = false;
    }

    if (isStreaming && content.length !== prevContentLengthRef.current && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
    prevContentLengthRef.current = content.length;
  }, [content, isStreaming]);

  // ═══ Effect 2: Streaming 结束时自动折叠（仅执行一次）═══
  useEffect(() => {
    if (!isStreaming && !hasAutoCollapsedRef.current) {
      if (content.length > 500 && !userManuallyToggledRef.current) {
        const timer = setTimeout(() => {
          setExpanded(false);
          hasAutoCollapsedRef.current = true;
        }, 800);
        return () => clearTimeout(timer);
      }
      hasAutoCollapsedRef.current = true;
    }
    return undefined;
  }, [isStreaming]);

  // ═══ 手动切换时标记用户操作 ═══
  const handleToggle = () => {
    userManuallyToggledRef.current = true;
    setExpanded((v) => !v);
  };

  if (!content.trim()) return null;

  const wordCount = content.replace(/\s/g, '').length;
  const displayTitle = isStreaming ? `思考中… (${wordCount} 字)` : `思考了 ${wordCount} 字`;

  return (
    <div className="my-2 rounded-xl overflow-hidden border-l-2 border-violet-400 dark:border-violet-500 bg-gradient-to-r from-violet-50/80 via-purple-50/40 to-transparent dark:from-violet-950/20 dark:via-purple-950/10 shadow-sm">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2.5 w-full px-3.5 py-2.5 hover:bg-violet-100/30 dark:hover:bg-violet-900/20 transition-all duration-200 text-left group"
      >
        <span
          className={`flex items-center justify-center h-5 w-5 rounded-full flex-shrink-0 transition-all duration-300 ${isStreaming ? 'bg-violet-200 dark:bg-violet-800/60 animate-pulse' : 'bg-violet-100 dark:bg-violet-900/40'} ${!expanded ? 'group-hover:bg-violet-200 dark:group-hover:bg-violet-800/60' : ''}`}
        >
          <Sparkles
            className={`h-3 w-3 text-violet-600 dark:text-violet-400 ${isStreaming ? 'animate-spin-slow' : ''}`}
          />
        </span>
        <span className="text-[12px] font-semibold text-violet-700 dark:text-violet-300">{displayTitle}</span>
        {!isStreaming && wordCount > 0 && (
          <span className="text-[10px] font-mono text-violet-400 dark:text-violet-500 ml-auto mr-1 tabular-nums">
            {Math.ceil(wordCount / 100)}s
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 text-violet-400 dark:text-violet-500 transition-transform duration-300 flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="px-3.5 pb-3 pt-1 border-t border-violet-100/60 dark:border-violet-900/30">
          <div
            ref={contentRef}
            className="text-[12px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-violet-300 dark:scrollbar-thumb-violet-700 scrollbar-track-transparent"
          >
            {content}
          </div>
        </div>
      )}
    </div>
  );
}
