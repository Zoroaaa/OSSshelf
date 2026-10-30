/**
 * AssistantContent.tsx
 * AI 助手回复内容渲染
 *
 * - Markdown（GFM + 代码高亮）
 * - [FILE:id:name] / [FOLDER:id:name] 引用解析为可点击卡片
 * - 独立成行的引用升级为卡片，行内引用保持内联
 */

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy, ExternalLink, FileText, FolderOpen } from 'lucide-react';

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

/** 递归提取 ReactNode 的纯文本：高亮后的 code children 是元素，直接 toString 会得到 [object Object] */
function extractText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
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
      type="button"
      onClick={() => onClick(id, isFolder)}
      className="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[12px] font-medium text-foreground align-middle transition-colors hover:border-primary/50 hover:bg-accent"
    >
      {isFolder ? (
        <FolderOpen className="h-3 w-3 flex-shrink-0 text-amber-500" />
      ) : (
        <FileText className="h-3 w-3 flex-shrink-0 text-primary" />
      )}
      <span className="max-w-[220px] truncate">{name}</span>
      <ExternalLink className="h-2.5 w-2.5 flex-shrink-0 opacity-40" />
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
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => onClick(id, isFolder)}
        className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-accent"
      >
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-muted">
          {isFolder ? <FolderOpen className="h-3 w-3 text-amber-500" /> : <FileText className="h-3 w-3 text-primary" />}
        </span>
        <span className="max-w-[260px] truncate">{name}</span>
        <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-40" />
      </button>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md bg-slate-700/80 p-1.5 text-slate-300 transition-colors hover:bg-slate-600"
      aria-label="复制代码"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
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
      return children.map((child) =>
        typeof child === 'string' ? replacePlaceholders(child, refMap, onFileClick) : resolveRefs(child)
      );
    }
    return children;
  };

  return {
    p: (props: { children?: React.ReactNode }) => (
      <p className="mb-3 leading-relaxed last:mb-0">{resolveRefs(props.children)}</p>
    ),
    h1: (props: { children?: React.ReactNode }) => (
      <h1 className="mb-4 mt-6 border-b border-border pb-2 text-xl font-bold text-foreground first:mt-0">
        {resolveRefs(props.children)}
      </h1>
    ),
    h2: (props: { children?: React.ReactNode }) => (
      <h2 className="mb-3 mt-5 text-lg font-bold text-foreground first:mt-0">{resolveRefs(props.children)}</h2>
    ),
    h3: (props: { children?: React.ReactNode }) => (
      <h3 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{resolveRefs(props.children)}</h3>
    ),
    ul: (props: { children?: React.ReactNode }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 [&>li]:marker:text-primary">{resolveRefs(props.children)}</ul>
    ),
    ol: (props: { children?: React.ReactNode }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 [&>li]:marker:font-semibold [&>li]:marker:text-primary">
        {resolveRefs(props.children)}
      </ol>
    ),
    li: (props: { children?: React.ReactNode }) => (
      <li className="pl-1 leading-relaxed text-foreground">{resolveRefs(props.children)}</li>
    ),
    code: (props: { className?: string; children?: React.ReactNode }) => {
      if (!props.className) {
        return (
          <code className="mx-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
            {props.children}
          </code>
        );
      }
      return <code className={props.className}>{props.children}</code>;
    },
    pre: (props: { children?: React.ReactNode }) => (
      <div className="group/code relative my-3">
        <pre className="overflow-x-auto rounded-lg border border-slate-700/60 bg-slate-900 p-4 text-[13px] leading-relaxed text-slate-100">
          {props.children}
        </pre>
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/code:opacity-100">
          <CopyButton text={extractText(props.children)} />
        </div>
      </div>
    ),
    blockquote: (props: { children?: React.ReactNode }) => (
      <blockquote className="my-3 rounded-r-lg border-l-4 border-primary/40 bg-muted/40 py-2 pl-4 italic text-muted-foreground">
        {props.children}
      </blockquote>
    ),
    table: (props: { children?: React.ReactNode }) => (
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">{props.children}</table>
      </div>
    ),
    thead: (props: { children?: React.ReactNode }) => (
      <thead className="border-b border-border bg-muted/60">{props.children}</thead>
    ),
    th: (props: { children?: React.ReactNode }) => (
      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground">
        {resolveRefs(props.children)}
      </th>
    ),
    td: (props: { children?: React.ReactNode }) => (
      <td className="border-t border-border px-3 py-2 text-muted-foreground">{resolveRefs(props.children)}</td>
    ),
    a: (props: { href?: string; children?: React.ReactNode }) => (
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      >
        {props.children}
      </a>
    ),
    strong: (props: { children?: React.ReactNode }) => (
      <strong className="font-bold text-foreground">{resolveRefs(props.children)}</strong>
    ),
    em: (props: { children?: React.ReactNode }) => <em className="italic text-foreground">{props.children}</em>,
    hr: () => <hr className="my-6 border-t border-border" />,
    img: (props: { src?: string; alt?: string }) => (
      <img
        src={props.src}
        alt={props.alt || ''}
        className="my-4 max-w-full rounded-lg border border-border"
        loading="lazy"
      />
    ),
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
    if (match.index > lastIndex) result.push(text.slice(lastIndex, match.index));
    const idx = parseInt(match[1] ?? '0', 10);
    const info = refMap.get(idx);
    if (info) {
      result.push(
        info.isStandalone ? (
          <StandaloneFileRefCard
            key={`ref-${idx}`}
            type={info.type}
            id={info.id}
            name={info.name}
            onClick={onFileClick}
          />
        ) : (
          <FileRefCard key={`ref-${idx}`} type={info.type} id={info.id} name={info.name} onClick={onFileClick} />
        )
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) result.push(text.slice(lastIndex));
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
    <div className="max-w-none text-[14px] leading-relaxed text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
