/**
 * AssistantContent.tsx
 * AI助手回复内容渲染组件
 *
 * 功能:
 * - Markdown渲染
 * - [FILE:id:name] / [FOLDER:id:name] 文件引用解析为可点击元素
 * - 同时支持Markdown格式和文件引用
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { FolderOpen, FileText, ExternalLink } from 'lucide-react';

interface AssistantContentProps {
  content: string;
  onFileClick: (id: string, isFolder: boolean) => void;
}

const FILE_REF_REGEX = /\[(FILE|FOLDER):([^:]+):([^\]]+)\]/g;

function FileRefButton({
  type,
  id,
  name,
  onClick,
}: {
  type: 'FILE' | 'FOLDER';
  id: string;
  name: string;
  onClick: (id: string, isFolder: boolean) => void;
}) {
  const isFolder = type === 'FOLDER';
  return (
    <button
      onClick={() => onClick(id, isFolder)}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-0.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium transition-all group"
    >
      {isFolder ? <FolderOpen className="h-3 w-3 text-amber-500" /> : <FileText className="h-3 w-3 text-violet-500" />}
      <span>{name}</span>
      <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

export function AssistantContent({ content, onFileClick }: AssistantContentProps) {
  const cleanedContent = content.replace(/```tool_call\s*[\s\S]*?```/g, '').trim();

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  FILE_REF_REGEX.lastIndex = 0;

  while ((match = FILE_REF_REGEX.exec(cleanedContent)) !== null) {
    if (match.index > lastIndex) {
      const textPart = cleanedContent.slice(lastIndex, match.index);
      parts.push(
        <ReactMarkdown
          key={`md-${keyIndex++}`}
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            p: ({ children }) => <span className="inline">{children}</span>,
          }}
        >
          {textPart}
        </ReactMarkdown>
      );
    }

    const type = match[1] as 'FILE' | 'FOLDER';
    const id = match[2] ?? '';
    const name = match[3] ?? '';
    parts.push(<FileRefButton key={`ref-${keyIndex++}`} type={type} id={id} name={name} onClick={onFileClick} />);

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleanedContent.length) {
    const textPart = cleanedContent.slice(lastIndex);
    parts.push(
      <ReactMarkdown
        key={`md-${keyIndex++}`}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => <span className="inline">{children}</span>,
        }}
      >
        {textPart}
      </ReactMarkdown>
    );
  }

  if (parts.length === 0) {
    return (
      <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:mt-3 prose-pre:bg-slate-950 prose-code:text-violet-600 dark:prose-code:text-violet-400">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {cleanedContent}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:mt-3 prose-pre:bg-slate-950 prose-code:text-violet-600 dark:prose-code:text-violet-400">
      {parts}
    </div>
  );
}
