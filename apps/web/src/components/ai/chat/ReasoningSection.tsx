import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

interface ReasoningSectionProps {
  content: string;
  isStreaming?: boolean;
}

export function ReasoningSection({ content, isStreaming = false }: ReasoningSectionProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (isStreaming) {
      if (!userToggledRef.current) setExpanded(true);
      if (content.length !== prevLengthRef.current && contentRef.current) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }
    prevLengthRef.current = content.length;
  }, [content, isStreaming]);

  // 生成结束后自动收起长思考内容；用户手动展开过则尊重用户选择
  useEffect(() => {
    if (isStreaming) return;
    if (content.length > 500 && !userToggledRef.current) {
      const timer = window.setTimeout(() => setExpanded(false), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isStreaming, content.length]);

  if (!content.trim()) return null;

  const wordCount = content.replace(/\s/g, '').length;
  const title = isStreaming ? `思考中…（${wordCount} 字）` : `思考过程（${wordCount} 字）`;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setExpanded((value) => !value);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
      >
        <Sparkles className={`h-3.5 w-3.5 flex-shrink-0 text-primary ${isStreaming ? 'animate-pulse' : ''}`} />
        <span className="flex-1 text-[12px] font-medium text-foreground">{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expanded && (
        <div
          ref={contentRef}
          className="max-h-60 overflow-y-auto border-t border-border/70 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {content}
        </div>
      )}
    </div>
  );
}
