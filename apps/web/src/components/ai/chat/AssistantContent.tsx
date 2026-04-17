/**
 * AssistantContent.tsx
 * AI助手回复内容渲染组件
 *
 * 功能:
 * - Markdown渲染（增强版）
 * - [FILE:id:name] / [FOLDER:id:name] 文件引用解析为可点击元素
 * - 所有引用默认以内联方式嵌入原格式中，零破坏
 * - 独立成行的引用自动升级为卡片样式突出显示
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

const FILE_REF_REGEX = /\[(FILE|FOLDER):([^:\]]+):([^\]]+)\]/g;

const REF_PLACEHOLDER = '\u200B\u200CFREF_';
const REF_PLACEHOLDER_SUFFIX = '\u200C\u200B';

interface FileRefInfo {
  type: 'FILE' | 'FOLDER';
  id: string;
  name: string;
  isStandalone: boolean;
}

function isStandaloneLine(content: string, matchIndex: number, matchLength: number): boolean {
  const beforeStart = content.lastIndexOf('\n', matchIndex);
  const afterEnd = content.indexOf('\n', matchIndex + matchLength);
  const lineBefore = beforeStart === -1 ? content.slice(0, matchIndex) : content.slice(beforeStart + 1, matchIndex);
  const lineAfter =
    afterEnd === -1 ? content.slice(matchIndex + matchLength) : content.slice(matchIndex + matchLength, afterEnd);
  return lineBefore.trim() === '' && lineAfter.trim() === '';
}

function FileRefCard({
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
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/40 dark:to-purple-950/30 border border-violet-200/60 dark:border-violet-700/50 hover:border-violet-400 dark:hover:border-violet-500 text-violet-700 dark:text-violet-300 text-[12px] font-medium transition-all duration-200 hover:shadow-sm active:scale-[0.97] align-middle cursor-pointer"
    >
      {isFolder ? (
        <FolderOpen className="h-3 w-3 text-amber-500 flex-shrink-0" />
      ) : (
        <FileText className="h-3 w-3 text-violet-500 flex-shrink-0" />
      )}
      <span className="truncate max-w-[200px]" title={name}>
        {name}
      </span>
      <ExternalLink className="h-2.5 w-2 opacity-40 flex-shrink-0" />
    </button>
  );
}

function StandaloneFileRefCard({
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
    <div className="my-1.5 inline-flex">
      <button
        onClick={() => onClick(id, isFolder)}
        className="group inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/40 dark:to-purple-950/30 border border-violet-200/60 dark:border-violet-700/50 hover:border-violet-400 dark:hover:border-violet-500 hover:from-violet-100 hover:to-purple-100 dark:hover:from-violet-900/50 dark:hover:to-purple-900/40 text-violet-700 dark:text-violet-300 text-[12px] font-medium transition-all duration-200 shadow-sm hover:shadow-md hover:shadow-violet-500/10 active:scale-[0.97]"
      >
        <span className="flex-shrink-0 flex items-center justify-center w-4.5 h-4.5 rounded-md bg-white dark:bg-slate-800 shadow-sm">
          {isFolder ? (
            <FolderOpen className="h-3 w-3 text-amber-500" />
          ) : (
            <FileText className="h-3 w-3 text-violet-500" />
          )}
        </span>
        <span className="font-semibold truncate max-w-[240px]">{name}</span>
        <ExternalLink className="flex-shrink-0 h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity duration-200" />
      </button>
    </div>
  );
}

function getMarkdownComponents(
  refMap?: Map<number, FileRefInfo>,
  onFileClick?: (id: string, isFolder: boolean) => void
) {
  const resolveRefs = (children: React.ReactNode): React.ReactNode => {
    if (!refMap || refMap.size === 0 || !onFileClick) return children;
    if (typeof children === 'string') {
      return replacePlaceholders(children, refMap, onFileClick);
    }
    if (Array.isArray(children)) {
      return children.map((child, i) =>
        typeof child === 'string' ? replacePlaceholders(child, refMap, onFileClick) : resolveRefs(child)
      );
    }
    return children;
  };

  return {
    p: (props: any) => <p className="mb-3 last:mb-0 leading-relaxed">{resolveRefs(props.children)}</p>,
    h1: (props: any) => (
      <h1 className="text-xl font-bold mb-4 mt-6 first:mt-0 text-slate-900 dark:text-slate-100 pb-2 border-b border-slate-200 dark:border-slate-700">
        {resolveRefs(props.children)}
      </h1>
    ),
    h2: (props: any) => (
      <h2 className="text-lg font-bold mb-3 mt-5 first:mt-0 text-slate-800 dark:text-slate-200">
        {resolveRefs(props.children)}
      </h2>
    ),
    h3: (props: any) => (
      <h3 className="text-base font-semibold mb-2 mt-4 first:mt-0 text-slate-800 dark:text-slate-200">
        {resolveRefs(props.children)}
      </h3>
    ),
    ul: (props: any) => (
      <ul className="my-2 pl-5 space-y-1 list-disc [&>li]:marker:text-violet-400 dark:[&>li]:marker:text-violet-500">
        {resolveRefs(props.children)}
      </ul>
    ),
    ol: (props: any) => (
      <ol className="my-2 pl-5 space-y-1 list-decimal [&>li]:marker:text-violet-500 dark:[&>li]:marker:text-violet-400 [&>li]:marker:font-semibold">
        {resolveRefs(props.children)}
      </ol>
    ),
    li: (props: any) => (
      <li className="pl-1 leading-relaxed text-slate-700 dark:text-slate-300">{resolveRefs(props.children)}</li>
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
        {resolveRefs(props.children)}
      </th>
    ),
    td: (props: any) => (
      <td className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400">
        {resolveRefs(props.children)}
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
      <strong className="font-bold text-slate-900 dark:text-slate-100">{resolveRefs(props.children)}</strong>
    ),
    em: (props: any) => <em className="italic text-slate-700 dark:text-slate-300">{resolveRefs(props.children)}</em>,
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

function replacePlaceholders(
  text: string,
  refMap: Map<number, FileRefInfo>,
  onFileClick: (id: string, isFolder: boolean) => void
): React.ReactNode[] {
  const pattern = new RegExp(
    `${REF_PLACEHOLDER}(\\d+)${REF_PLACEHOLDER_SUFFIX.replace(/[\\^$.*+?()|[\]{}]/g, '\\$&')}`,
    'g'
  );
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    const idx = parseInt(match[1] ?? '0', 10);
    const info = refMap.get(idx);
    if (info) {
      if (info.isStandalone) {
        result.push(
          <StandaloneFileRefCard
            key={`ref-${idx}`}
            type={info.type}
            id={info.id}
            name={info.name}
            onClick={onFileClick}
          />
        );
      } else {
        result.push(
          <FileRefCard key={`ref-${idx}`} type={info.type} id={info.id} name={info.name} onClick={onFileClick} />
        );
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}

export function AssistantContent({ content, onFileClick }: AssistantContentProps) {
  const cleanedContent = content.replace(/```tool_call\s*[\s\S]*?```/g, '').trim();

  const refMap = new Map<number, FileRefInfo>();
  let processedContent = cleanedContent;
  let offset = 0;
  let refIndex = 0;

  FILE_REF_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FILE_REF_REGEX.exec(cleanedContent)) !== null) {
    const type = match[1] as 'FILE' | 'FOLDER';
    const id = match[2] ?? '';
    const name = match[3] ?? '';
    const standalone = isStandaloneLine(cleanedContent, match.index, match[0].length);

    const placeholder = `${REF_PLACEHOLDER}${refIndex}${REF_PLACEHOLDER_SUFFIX}`;

    processedContent =
      processedContent.slice(0, match.index + offset) +
      placeholder +
      processedContent.slice(match.index + match[0].length + offset);

    offset += placeholder.length - match[0].length;

    refMap.set(refIndex, { type, id, name, isStandalone: standalone });
    refIndex++;
  }

  const components = getMarkdownComponents(refMap.size > 0 ? refMap : undefined, onFileClick);

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
