/**
 * MessageBubble.tsx
 * 单条消息渲染：计划 / 思考 / 工具活动 / 正文 / 来源 / 中断 / 操作按钮。
 */

import { useRef } from 'react';
import { CheckCircle2, Copy, FolderOpen, RefreshCw, Reply, Sparkles, StopCircle } from 'lucide-react';
import type { Message } from '../types';
import { AssistantContent } from './AssistantContent';
import { PlanProgressBar } from './PlanProgressBar';
import { ReasoningSection } from './ReasoningSection';
import { ToolCallCard } from './ToolCallCard';

interface MessageBubbleProps {
  message: Message;
  canRegenerate: boolean;
  copied: boolean;
  onCopy: (id: string, content: string) => void;
  onRegenerate: () => void;
  onFileClick: (id: string, isFolder: boolean) => void;
  onConfirmAction: (confirmId: string) => void;
  onCancelConfirm: (confirmId?: string) => void;
  onQuote: (message: Message) => void;
  onContextMenu: (event: React.MouseEvent, message: Message) => void;
}

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD_PX = 10;

export function MessageBubble({
  message,
  canRegenerate,
  copied,
  onCopy,
  onRegenerate,
  onFileClick,
  onConfirmAction,
  onCancelConfirm,
  onQuote,
  onContextMenu,
}: MessageBubbleProps) {
  const pressTimer = useRef<number | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);

  const clearPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    startPoint.current = null;
  };

  // 移动端长按等价于右键菜单
  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    startPoint.current = { x: event.clientX, y: event.clientY };
    pressTimer.current = window.setTimeout(() => {
      if (!message.content) return;
      onContextMenu(event as unknown as React.MouseEvent, message);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!startPoint.current) return;
    const dx = Math.abs(event.clientX - startPoint.current.x);
    const dy = Math.abs(event.clientY - startPoint.current.y);
    if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) clearPress();
  };

  const isUser = message.role === 'user';
  const showActions = !message.isLoading;

  return (
    <div
      className={`group/message flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
      onContextMenu={(event) => {
        if (!message.content) return;
        event.preventDefault();
        onContextMenu(event, message);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
      )}

      <div className={`min-w-0 space-y-1.5 ${isUser ? 'max-w-[85%] items-end' : 'max-w-[92%] flex-1'}`}>
        {!isUser && message.plan && <PlanProgressBar plan={message.plan} />}

        {!isUser && message.reasoning && (
          <ReasoningSection content={message.reasoning} isStreaming={message.isLoading} />
        )}

        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-1.5">
            {message.toolCalls.map((toolCall) => (
              <ToolCallCard
                key={toolCall.id}
                tc={toolCall}
                onFileClick={onFileClick}
                onConfirmAction={onConfirmAction}
                onCancelConfirm={onCancelConfirm}
              />
            ))}
          </div>
        )}

        <div
          className={
            isUser
              ? 'rounded-2xl rounded-tr-md bg-muted px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground'
              : 'text-[14px] leading-relaxed text-foreground'
          }
        >
          {isUser ? (
            <span className="whitespace-pre-wrap break-words">{message.content}</span>
          ) : message.content ? (
            <AssistantContent content={message.content} onFileClick={onFileClick} />
          ) : null}

          {isUser && message.mentionedFiles && message.mentionedFiles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
              {message.mentionedFiles.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <span className="max-w-[140px] truncate">{file.name}</span>
                </span>
              ))}
            </div>
          )}

          {message.pending && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1 w-1 animate-pulse rounded-full bg-primary" />
              正在连接会话…
            </div>
          )}

          {message.aborted && (
            <div className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2 text-[12px] text-amber-600 dark:text-amber-400">
              <StopCircle className="h-3.5 w-3.5" />
              输出已中断
              {canRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-primary hover:bg-accent"
                >
                  <RefreshCw className="h-3 w-3" />
                  重新生成
                </button>
              )}
            </div>
          )}

          {message.isLoading && !message.content && (
            <div className="flex items-center gap-2 py-1">
              <span className="flex gap-1">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {message.toolCalls?.some((tool) => tool.status === 'running') ? '正在执行工具…' : '正在思考…'}
              </span>
            </div>
          )}
        </div>

        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <span className="text-[11px] text-muted-foreground">参考文件：</span>
            {message.sources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => onFileClick(source.id, source.isFolder)}
                className="inline-flex max-w-[180px] items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary/50 hover:bg-accent"
                title={source.name}
              >
                {source.isFolder && <FolderOpen className="h-2.5 w-2.5 flex-shrink-0 text-amber-500" />}
                <span className="truncate">{source.name}</span>
              </button>
            ))}
          </div>
        )}

        {showActions && (
          <div
            className={`flex items-center gap-1.5 pt-0.5 ${isUser ? 'justify-end' : 'justify-start'} text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100`}
          >
            <span className="text-[11px] tabular-nums">{formatTime(message.timestamp)}</span>
            <button
              type="button"
              onClick={() => onCopy(message.id, message.content)}
              className="rounded p-1 transition-colors hover:bg-accent hover:text-foreground"
              title="复制"
            >
              {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {!isUser && canRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="rounded p-1 transition-colors hover:bg-accent hover:text-foreground"
                title="重新生成"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onQuote(message)}
              className="rounded p-1 transition-colors hover:bg-accent hover:text-foreground"
              title="引用此消息"
            >
              <Reply className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {isUser && (
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-[12px] font-semibold text-muted-foreground">
          你
        </div>
      )}
    </div>
  );
}
