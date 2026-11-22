/**
 * DraftPreview.tsx
 * 草稿预览组件
 *
 * 功能:
 * - 根据 fileName 扩展名选择渲染方式
 * - .md → Markdown 渲染
 * - .py/.js/.ts/.json 等 → 代码高亮
 * - 其他 → 纯文本预览
 */

import { useState } from 'react';
import { File, Code } from 'lucide-react';
import { cn } from '@/utils';
import { SafeMarkdown } from '@/components/ui/SafeMarkdown';

interface DraftPreviewProps {
  content: string;
  fileName: string;
}

const CODE_EXTENSIONS = [
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.sql',
  '.sh',
  '.bash',
  '.html',
  '.css',
];
const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

export function DraftPreview({ content, fileName }: DraftPreviewProps) {
  const [expanded, setExpanded] = useState(false);

  const ext = '.' + fileName.split('.').pop()?.toLowerCase();
  const isCode = CODE_EXTENSIONS.includes(ext);
  const isMarkdown = MARKDOWN_EXTENSIONS.includes(ext);

  return (
    <div className="max-h-64 overflow-y-auto rounded-xl border bg-muted/30 p-3 space-y-2">
      {/* 文件名 Badge */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground pb-2 border-b">
        {isMarkdown ? (
          <File className="h-3.5 w-3.5" />
        ) : isCode ? (
          <Code className="h-3.5 w-3.5" />
        ) : (
          <File className="h-3.5 w-3.5" />
        )}
        <span className="font-medium">{fileName}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {isMarkdown ? 'Markdown' : isCode ? '代码' : '文本'}
        </span>
      </div>

      {/* 内容区域 */}
      <div className={cn('relative', !expanded && 'line-clamp-6')}>
        {isMarkdown ? (
          <SafeMarkdown content={content} className="text-sm leading-relaxed" />
        ) : isCode ? (
          <pre className="bg-background rounded-lg p-3 text-xs font-mono leading-relaxed overflow-x-auto">
            <code>{content}</code>
          </pre>
        ) : (
          <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono">{content}</pre>
        )}
      </div>

      {/* 展开/收起按钮 */}
      {content.length > 500 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary hover:text-primary/80 transition-colors"
        >
          {expanded ? '收起 ↑' : `展开全部 (${content.length} 字符) ↓`}
        </button>
      )}
    </div>
  );
}
