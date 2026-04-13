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
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(content) }}
          />
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

/** 简单的 Markdown 渲染（不依赖外部库） */
function renderSimpleMarkdown(markdown: string): string {
  let html = markdown;

  // 标题
  html = html.replace(/^### (.*$)/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2 class="text-lg font-semibold mt-4 mb-2">$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1 class="text-xl font-bold mt-4 mb-2">$1</h1>');

  // 粗体和斜体
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // 行内代码
  html = html.replace(/`(.*?)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-sm">$1</code>');

  // 代码块
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```\w*\n?/g, '').replace(/```$/g, '');
    return `<pre class="bg-background rounded-lg p-3 my-2 text-xs font-mono overflow-x-auto"><code>${code}</code></pre>`;
  });

  // 列表
  html = html.replace(/^[-*] (.*$)/gm, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(/^\d+\. (.*$)/gm, '<li class="ml-4 list-decimal">$1</li>');

  // 链接
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-primary underline" target="_blank" rel="noopener">$1</a>'
  );

  // 段落
  html = html.replace(/\n\n/g, '</p><p class="my-2">');
  html = `<p class="my-1">${html}</p>`;

  // 清理空段落
  html = html.replace(/<p class="my-1"><\/p>/g, '');

  return html;
}
