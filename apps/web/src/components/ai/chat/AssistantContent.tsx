/**
 * AssistantContent.tsx
 * AI助手回复内容渲染组件
 *
 * 功能:
 * - Markdown渲染（增强版）
 * - [FILE:id:name] / [FOLDER:id:name] 文件引用解析为可点击元素
 * - 优化的代码块、列表、表格样式
 * - 美观的文件引用按钮设计
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
      className="group inline-flex items-center gap-2 px-3 py-1.5 my-0.5 rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/40 dark:to-purple-950/30 border border-violet-200/60 dark:border-violet-700/50 hover:border-violet-400 dark:hover:border-violet-500 hover:from-violet-100 hover:to-purple-100 dark:hover:from-violet-900/50 dark:hover:to-purple-900/40 text-violet-700 dark:text-violet-300 text-[13px] font-medium transition-all duration-200 shadow-sm hover:shadow-md hover:shadow-violet-500/10 active:scale-95 max-w-full"
    >
      <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
        {isFolder ? (
          <FolderOpen className="h-3 w-3 text-amber-500" />
        ) : (
          <FileText className="h-3 w-3 text-violet-500" />
        )}
      </span>

      <span className="font-semibold truncate">{name}</span>

      <ExternalLink className="flex-shrink-0 h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity duration-200" />
    </button>
  );
}


function getMarkdownComponents() {
  return {
    p: (props: any) => <p className="mb-3 last:mb-0 leading-relaxed">{props.children}</p>,
    h1: (props: any) => (
      <h1 className="text-xl font-bold mb-4 mt-6 first:mt-0 text-slate-900 dark:text-slate-100 pb-2 border-b border-slate-200 dark:border-slate-700">
        {props.children}
      </h1>
    ),
    h2: (props: any) => (
      <h2 className="text-lg font-bold mb-3 mt-5 first:mt-0 text-slate-800 dark:text-slate-200">
        {props.children}
      </h2>
    ),
    h3: (props: any) => (
      <h3 className="text-base font-semibold mb-2 mt-4 first:mt-0 text-slate-800 dark:text-slate-200">
        {props.children}
      </h3>
    ),
    ul: (props: any) => (
      <ul className="my-2 pl-5 space-y-1.5 list-disc [&>li]:marker:text-violet-400 dark:[&>li]:marker:text-violet-500">
        {props.children}
      </ul>
    ),
    ol: (props: any) => (
      <ol className="my-2 pl-5 space-y-1.5 list-decimal [&>li]:marker:text-violet-500 dark:[&>li]:marker:text-violet-400 [&>li]:marker:font-semibold">
        {props.children}
      </ol>
    ),
    li: (props: any) => (
      <li className="pl-1 leading-relaxed text-slate-700 dark:text-slate-300">
        {props.children}
      </li>
    ),
    code: (props: any) => {
      const isInline = !props.className;
      if (isInline) {
        return (
          <code
            className="px-1.5 py-0.5 mx-0.5 rounded-md bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 text-violet-600 dark:text-violet-400 text-[13px] font-mono font-medium border border-slate-200/60 dark:border-slate-700/50"
            {...props}
          >
            {props.children}
          </code>
        );
      }
      return (
        <code className={props.className} {...props}>
          {props.children}
        </code>
      );
    },
    pre: (props: any) => (
      <div className="relative group/my-3 mb-4 last:mb-0">
        <pre className="relative overflow-x-auto rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-4 text-[13px] leading-relaxed border border-slate-700/50 shadow-lg shadow-slate-900/20">
          {props.children}
        </pre>
        <div className="absolute top-2 right-2 opacity-0 group-hover/my:opacity-100 transition-opacity">
          <button
            onClick={() => navigator.clipboard.writeText(props.children?.toString() || '')}
            className="p-1.5 rounded-lg bg-slate-700/80 hover:bg-slate-600 text-slate-300 text-xs transition-colors"
          >
            复制
          </button>
        </div>
      </div>
    ),
    blockquote: (props: any) => (
      <blockquote className="border-l-4 border-violet-400 dark:border-violet-500 pl-4 py-2 my-3 bg-gradient-to-r from-violet-50/50 to-transparent dark:from-violet-950/20 rounded-r-lg italic text-slate-600 dark:text-slate-400">
        {props.children}
      </blockquote>
    ),
    table: (props: any) => (
      <div className="overflow-x-auto my-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <table className="w-full text-sm">{props.children}</table>
      </div>
    ),
    thead: (props: any) => (
      <thead className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-b border-slate-200 dark:border-slate-700">
        {props.children}
      </thead>
    ),
    th: (props: any) => (
      <th className="px-4 py-2.5 text-left font-semibold text-slate-700 dark:text-slate-300 text-xs uppercase tracking-wider">
        {props.children}
      </th>
    ),
    td: (props: any) => (
      <td className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400">
        {props.children}
      </td>
    ),
    a: (props: any) => {
      const { href, children } = props;
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-600 dark:text-violet-400 underline decoration-violet-300 dark:decoration-violet-600 underline-offset-2 hover:decoration-violet-500 dark:hover:decoration-violet-400 transition-colors font-medium"
        >
          {children}
        </a>
      );
    },
    strong: (props: any) => (
      <strong className="font-bold text-slate-900 dark:text-slate-100">{props.children}</strong>
    ),
    em: (props: any) => (
      <em className="italic text-slate-700 dark:text-slate-300">{props.children}</em>
    ),
    hr: () => <hr className="my-6 border-t-2 border-slate-200 dark:border-slate-700" />,
    img: (props: any) => {
      const { src, alt } = props;
      return (
        <img
          src={src}
          alt={alt || ''}
          className="rounded-xl border border-slate-200 dark:border-slate-700 shadow-md max-w-full my-4"
          loading="lazy"
        />
      );
    },
  };
}

export function AssistantContent({ content, onFileClick }: AssistantContentProps) {
  const cleanedContent = content.replace(/```tool_call\s*[\s\S]*?```/g, '').trim();

  const components = getMarkdownComponents();

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
          components={components}
        >
          {textPart}
        </ReactMarkdown>
      );
    }

    const type = match[1] as 'FILE' | 'FOLDER';
    const id = match[2] ?? '';
    const name = match[3] ?? '';
    // 文件引用渲染为独立行，避免与文本混排错位
    parts.push(
      <div key={`ref-${keyIndex++}`} className="my-1">
        <FileRefButton type={type} id={id} name={name} onClick={onFileClick} />
      </div>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleanedContent.length) {
    const textPart = cleanedContent.slice(lastIndex);
    parts.push(
      <ReactMarkdown
        key={`md-${keyIndex++}`}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {textPart}
      </ReactMarkdown>
    );
  }

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      {parts.length > 0 ? parts : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={components}
        >
          {cleanedContent}
        </ReactMarkdown>
      )}
    </div>
  );
}
