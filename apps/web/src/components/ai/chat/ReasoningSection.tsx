/**
 * ReasoningSection.tsx
 * 思考过程折叠组件
 *
 * 功能:
 * - 展示AI推理/思考内容
 * - 可展开/收起
 */

import { useState } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';

interface ReasoningSectionProps {
  content: string;
}

export function ReasoningSection({ content }: ReasoningSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content.trim()) return null;

  return (
    <div className="mb-2 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors text-left"
      >
        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 flex-shrink-0">
          <Sparkles className="h-3 w-3" />
        </span>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">思考过程</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ml-auto ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 pt-0 border-t border-slate-100 dark:border-slate-700/50">
          <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}
