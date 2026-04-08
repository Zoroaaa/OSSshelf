/**
 * AssistantContent.tsx
 * AI助手回复内容渲染组件
 *
 * 功能:
 * - Markdown渲染
 * - [FILE:id:name] / [FOLDER:id:name] 文件引用解析为可点击元素
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { FolderOpen, FileText, ExternalLink } from 'lucide-react';

interface AssistantContentProps {
  content: string;
  onFileClick: (id: string, isFolder: boolean) => void;
}

function parseFileRefs(text: string, onFileClick: (id: string, isFolder: boolean) => void): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\[(FILE|FOLDER):([^:]+):([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const isFolder = match[1] === 'FOLDER';
    const id = match[2] ?? '';
    const name = match[3] ?? '';
    parts.push(
      <button
        key={`${id}-${match.index}`}
        onClick={() => onFileClick(id, isFolder)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-0.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium transition-all group"
      >
        {isFolder ? (
          <FolderOpen className="h-3 w-3 text-amber-500" />
        ) : (
          <FileText className="h-3 w-3 text-violet-500" />
        )}
        <span>{name}</span>
        <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function AssistantContent({ content, onFileClick }: AssistantContentProps) {
  const cleanedContent = content.replace(/```tool_call\s*[\s\S]*?```/g, '').trim();
  const hasRefs = /\[(FILE|FOLDER):[^\]]+\]/.test(cleanedContent);

  if (!hasRefs) {
    return (
      <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:mt-3 prose-pre:bg-slate-950 prose-code:text-violet-600 dark:prose-code:text-violet-400">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {cleanedContent}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap">{parseFileRefs(cleanedContent, onFileClick)}</div>
  );
}
