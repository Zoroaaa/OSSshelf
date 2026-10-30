/**
 * Composer.tsx
 * 输入区：@文件引用、引用消息、文件拖拽、发送/停止、移动端安全区。
 *
 * 交互约定：
 * - 流式生成时输入框仍可编辑，不会禁用（避免用户丢失草稿）
 * - 本地文件拖入不做隐式上传（聊天页不承担上传链路），给出明确提示
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AtSign, Download, FileText, Loader2, Reply, Send, StopCircle, X } from 'lucide-react';
import { aiApi } from '@/services/ai';
import { useToast } from '@/components/ui/useToast';
import { formatBytes } from '@/utils';
import type { FileItem } from '@osshelf/shared';

interface MentionFile {
  id: string;
  name: string;
}

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  canSend: boolean;
  quotedMessage: { content: string; role: string } | null;
  onClearQuote: () => void;
  mentions: MentionFile[];
  onAddMention: (file: MentionFile) => void;
  onRemoveMention: (id: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  maxLength?: number;
}

const MENTION_DEBOUNCE_MS = 300;

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  canSend,
  quotedMessage,
  onClearQuote,
  mentions,
  onAddMention,
  onRemoveMention,
  inputRef,
  maxLength = 15000,
}: ComposerProps) {
  const { toast } = useToast();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  // 防抖：避免每个按键都打搜索接口
  useEffect(() => {
    if (!mentionOpen) return;
    const timer = window.setTimeout(() => setDebouncedQuery(mentionQuery), MENTION_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [mentionQuery, mentionOpen]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['mention-files', debouncedQuery],
    queryFn: () => aiApi.search(debouncedQuery, { limit: 8 }).then((r) => r.data?.data ?? []),
    enabled: mentionOpen && debouncedQuery.trim().length > 0,
    staleTime: 5000,
  });

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, mentionOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMentionOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const detectMention = useCallback((text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const atIndex = before.lastIndexOf('@');
    const isValidTrigger =
      atIndex !== -1 && (atIndex === 0 || before[atIndex - 1] === ' ' || before[atIndex - 1] === '\n');
    const query = isValidTrigger ? before.slice(atIndex + 1) : '';

    if (isValidTrigger && !query.includes(' ') && !query.includes('@')) {
      setMentionOpen(true);
      setMentionQuery(query);
      setMentionStart(atIndex);
      return;
    }
    setMentionOpen(false);
    setMentionQuery('');
  }, []);

  const selectMention = useCallback(
    (file: FileItem) => {
      onAddMention({ id: file.id, name: file.name });
      // 移除输入框中的 @query 文本，光标位置保持不变
      const cursor = inputRef.current?.selectionStart ?? value.length;
      const before = value.slice(0, mentionStart);
      const after = value.slice(cursor);
      onChange(before + after);
      setMentionOpen(false);
      setMentionQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [inputRef, mentionStart, onChange, onAddMention, value]
  );

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const file = results[activeIndex];
        if (file) selectMention(file);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    const idsData = event.dataTransfer.getData('application/osshelf-file-ids');
    if (idsData) {
      try {
        const dropped: Array<{ id: string; name: string }> = JSON.parse(idsData);
        for (const file of dropped) {
          if (file?.id && file?.name) onAddMention({ id: file.id, name: file.name });
        }
      } catch {
        // 忽略非法拖拽数据
      }
      return;
    }

    if (event.dataTransfer.files.length > 0) {
      toast({
        title: '暂不支持直接发送本地文件',
        description: '请先在文件管理页上传，再用 @ 引用该文件。',
      });
    }
  };

  const quotedPreview = useMemo(() => {
    if (!quotedMessage) return '';
    return quotedMessage.content.length > 120 ? `${quotedMessage.content.slice(0, 120)}...` : quotedMessage.content;
  }, [quotedMessage]);

  return (
    <div
      className={`relative flex-shrink-0 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 transition-colors ${
        isDragOver ? 'bg-primary/5' : ''
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes('application/osshelf-file-ids')) setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-xl border border-border bg-card transition-colors focus-within:border-primary/60">
          {quotedMessage && (
            <div className="flex items-start gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <Reply className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="line-clamp-2 flex-1 italic">
                [引用 · {quotedMessage.role === 'assistant' ? '助手' : '你'}] {quotedPreview}
              </span>
              <button
                type="button"
                onClick={onClearQuote}
                className="flex-shrink-0 rounded p-0.5 transition-colors hover:bg-accent hover:text-foreground"
                aria-label="取消引用"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 px-3 py-2">
            <textarea
              ref={inputRef}
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
                autoResize(event.target);
                detectMention(event.target.value, event.target.selectionStart);
              }}
              onKeyDown={handleKeyDown}
              placeholder="问我任何关于你的文件的问题…（@ 引用文件，Enter 发送，Shift+Enter 换行）"
              className="min-h-[36px] max-h-44 flex-1 resize-none bg-transparent py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              rows={1}
            />

            <div className="flex flex-shrink-0 items-center pb-0.5">
              {busy ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <StopCircle className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">停止</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!value.trim() || !canSend}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="发送"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {mentions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {mentions.map((file) => (
              <span
                key={file.id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
              >
                <AtSign className="h-3 w-3" />
                <span className="max-w-[140px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveMention(file.id)}
                  className="ml-0.5 transition-colors hover:text-destructive"
                  aria-label={`移除 ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {isDragOver && (
          <div className="mt-1.5 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 py-3 text-sm text-primary">
            <Download className="h-4 w-4" />
            <span>释放以引用该文件</span>
          </div>
        )}

        {mentionOpen && (
          <div
            ref={dropdownRef}
            className="absolute bottom-full left-4 right-4 z-50 mx-auto mb-1 max-w-3xl overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
          >
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <AtSign className="h-3 w-3" />
              <span>引用文件{debouncedQuery ? `：${debouncedQuery}` : ''}</span>
              {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>

            {!debouncedQuery.trim() ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">继续输入关键词搜索文件</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {isFetching ? '搜索中…' : '未找到匹配的文件'}
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto p-1">
                {results.map((file: FileItem, index: number) => (
                  <button
                    key={file.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectMention(file)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      index === activeIndex ? 'bg-accent' : 'hover:bg-accent/60'
                    }`}
                  >
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {value.length > 0 && (
          <p
            className={`mt-1 text-right text-[10px] ${
              value.length > maxLength ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {value.length} / {maxLength}
          </p>
        )}
      </div>
    </div>
  );
}
