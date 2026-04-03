/**
 * ChatMessageBubble.tsx
 * 聊天消息气泡组件
 *
 * 功能:
 * - Markdown 渲染
 * - 复制功能
 * - 来源引用展示
 * - 用户/AI 消息区分
 */

import { useState } from 'react';
import { FileText, Image, File, ExternalLink, Copy, Check, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { formatDate, cn } from '@/utils';

interface MessageSource {
  id: string;
  name: string;
  mimeType: string | null;
  score: number;
}

interface ChatMessageBubbleProps {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: MessageSource[];
  isLoading?: boolean;
  onCopy?: (messageId: string, content: string) => void;
  copiedMessageId?: string | null;
  onFileClick?: (fileId: string) => void;
}

export function ChatMessageBubble({
  id,
  role,
  content,
  timestamp,
  sources,
  isLoading,
  onCopy,
  copiedMessageId,
  onFileClick,
}: ChatMessageBubbleProps) {
  const getFileIcon = (mimeType: string | null) => {
    if (!mimeType) return <File className="h-4 w-4" />;
    if (mimeType.startsWith('image/')) return <Image className="h-4 w-4" />;
    if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) {
      return <FileText className="h-4 w-4" />;
    }
    return <File className="h-4 w-4" />;
  };

  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-5 py-4',
          role === 'user'
            ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-br-md'
            : 'bg-white dark:bg-slate-800 border rounded-bl-md shadow-sm'
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            {role === 'assistant' && (
              <div className="p-1 bg-gradient-to-br from-purple-500 to-pink-500 rounded">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
            )}
            <span
              className={cn(
                'text-xs font-medium',
                role === 'user' ? 'text-white/80' : 'text-muted-foreground'
              )}
            >
              {role === 'user' ? '你' : 'AI 助手'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {role === 'assistant' && content && !isLoading && onCopy && (
              <button
                onClick={() => onCopy(id, content)}
                className="p-1 hover:bg-accent rounded transition-colors"
                title="复制内容"
              >
                {copiedMessageId === id ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            )}
          </div>
        </div>

        <div
          className={cn(
            'prose prose-sm max-w-none',
            role === 'user' ? 'prose-invert' : '',
            'dark:prose-invert'
          )}
        >
          {role === 'assistant' && content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {content}
            </ReactMarkdown>
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 mt-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm text-muted-foreground">正在思考...</span>
            </div>
          )}
        </div>

        {sources && sources.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <FileText className="h-3 w-3" />
              参考文件：
            </p>
            <div className="space-y-1">
              {sources.map((source, idx) => (
                <button
                  key={idx}
                  onClick={() => onFileClick?.(source.id)}
                  className={cn(
                    'flex items-center gap-2 w-full p-2 rounded-lg transition-colors text-left',
                    'hover:bg-slate-100 dark:hover:bg-slate-700'
                  )}
                >
                  <div className="text-muted-foreground">{getFileIcon(source.mimeType)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{source.name}</p>
                    <p className="text-xs text-muted-foreground">
                      相关度: {(source.score * 100).toFixed(0)}%
                    </p>
                  </div>
                  <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          className={cn(
            'text-xs mt-2',
            role === 'user' ? 'text-white/70' : 'text-muted-foreground'
          )}
        >
          {formatDate(timestamp.toISOString())}
        </div>
      </div>
    </div>
  );
}
