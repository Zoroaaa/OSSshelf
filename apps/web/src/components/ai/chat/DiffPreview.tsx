/**
 * DiffPreview.tsx
 * 文件编辑 Diff 预览组件
 *
 * 功能:
 * - 展示编辑前后的文本对比
 * - 高亮变更行（新增绿色、删除红色）
 * - 显示变更统计
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Diff } from 'lucide-react';
import type { PreviewDiff } from '../types';

interface DiffPreviewProps {
  diff: PreviewDiff;
}

export function DiffPreview({ diff }: DiffPreviewProps) {
  const [expanded, setExpanded] = useState(false);

  const beforeLines = diff.before.split('\n');
  const afterLines = diff.after.split('\n');

  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const displayLines = expanded ? maxLines : Math.min(maxLines, 8);

  return (
    <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <Diff className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">变更预览</span>
          <span className="text-xs text-violet-600 dark:text-violet-400 font-medium">{diff.totalChanges} 处改动</span>
        </div>
        {maxLines > 8 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            {expanded ? (
              <>
                收起 <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                展开 <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-700 text-xs font-mono">
        {/* 原始内容 */}
        <div className="bg-white dark:bg-slate-900">
          <div className="px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-sans font-medium border-b border-slate-100 dark:border-slate-800">
            原始内容
          </div>
          {beforeLines.slice(0, displayLines).map((line, i) => (
            <div
              key={`before-${i}`}
              className="px-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50 truncate text-slate-600 dark:text-slate-400"
              title={line}
            >
              {line || <span className="text-slate-300 dark:text-slate-600">&nbsp;</span>}
            </div>
          ))}
          {!expanded && maxLines > 8 && (
            <div className="px-2 py-1 text-center text-slate-400 dark:text-slate-600 text-xs italic">
              ... 还有 {maxLines - 8} 行
            </div>
          )}
        </div>

        {/* 修改后内容 */}
        <div className="bg-white dark:bg-slate-900">
          <div className="px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-xs font-sans font-medium border-b border-slate-100 dark:border-slate-800">
            修改后
          </div>
          {afterLines.slice(0, displayLines).map((line, i) => (
            <div
              key={`after-${i}`}
              className="px-2 py-0.5 border-b border-slate-50 dark:border-slate-800/50 truncate text-slate-600 dark:text-slate-400"
              title={line}
            >
              {line || <span className="text-slate-300 dark:text-slate-600">&nbsp;</span>}
            </div>
          ))}
          {!expanded && maxLines > 8 && (
            <div className="px-2 py-1 text-center text-slate-400 dark:text-slate-600 text-xs italic">
              ... 还有 {maxLines - 8} 行
            </div>
          )}
        </div>
      </div>

      {(diff.before.length > 500 || diff.after.length > 500) && (
        <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-400 text-center">
          仅展示前 500 字符预览，完整内容将在确认后生效
        </div>
      )}
    </div>
  );
}
