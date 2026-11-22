/**
 * SafeMarkdown.tsx
 * 统一安全 Markdown 渲染器（审查报告 E-01 / E-02 修复）
 *
 * 以 react-markdown 为唯一实现，默认不渲染原始 HTML（自动转义），
 * 彻底消除手写正则渲染器 + dangerouslySetInnerHTML 带来的 XSS 风险。
 * 同时支持 GFM 表格/删除线、代码高亮、数学公式，与 AI 回复/文件预览保持一致。
 *
 * 用法：
 *   <SafeMarkdown content={text} className="prose prose-sm dark:prose-invert" />
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/utils';
import 'katex/dist/katex.min.css';

interface SafeMarkdownProps {
  content: string;
  className?: string;
}

export function SafeMarkdown({ content, className }: SafeMarkdownProps) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
