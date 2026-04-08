/**
 * ToolCallCard.tsx
 * 工具调用卡片组件
 *
 * 功能:
 * - 展示工具调用状态（运行中/完成/待确认）
 * - 展开/收起参数和结果
 * - 结果文件可点击跳转
 * - 危险操作需用户确认
 */

import { useState } from 'react';
import { Sparkles, ChevronDown, Loader2, File } from 'lucide-react';
import type { ToolCallEvent, AgentFile } from '../types';

interface ToolCallCardProps {
  tc: ToolCallEvent;
  onFileClick: (id: string) => void;
  onConfirm?: (toolName: string, args: Record<string, unknown>) => void;
  toolMeta?: Record<string, { label: string; icon: React.ReactNode }>;
}

export function ToolCallCard({ tc, onFileClick, onConfirm, toolMeta = {} }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const meta = toolMeta[tc.toolName] || {
    label: tc.toolName.replace(/_/g, ' '),
    icon: <Sparkles className="h-3 w-3" />,
  };

  const resultObj = tc.result && typeof tc.result === 'object' ? (tc.result as Record<string, unknown>) : null;
  const isPendingConfirm = resultObj?.status === 'pending_confirm';
  const confirmMessage = resultObj?.message as string | undefined;

  const resultFiles: AgentFile[] = (() => {
    if (!tc.result || typeof tc.result !== 'object') return [];
    const r = tc.result as Record<string, unknown>;

    const filesArray = r.files as Array<{ id: string; name: string; mimeType?: string | null }> | undefined;
    if (filesArray?.length) {
      return filesArray.slice(0, 6).map((f) => ({
        id: f.id,
        name: f.name,
        path: '',
        isFolder: false,
        size: 0,
        createdAt: '',
        mimeType: f.mimeType ?? null,
      }));
    }

    if (r.id && r.name && typeof r.id === 'string' && typeof r.name === 'string') {
      return [
        {
          id: r.id as string,
          name: r.name as string,
          path: (r.path as string) || '',
          isFolder: (r.isFolder as boolean) || false,
          size: (r.size as number) || 0,
          createdAt: (r.createdAt as string) || '',
          mimeType: (r.mimeType as string | null) ?? null,
        },
      ];
    }

    const fileA = r.fileA as { id: string; name: string; mimeType?: string | null } | undefined;
    const fileB = r.fileB as { id: string; name: string; mimeType?: string | null } | undefined;
    if (fileA?.id && fileB?.id) {
      return [fileA, fileB].map((f) => ({
        id: f.id,
        name: f.name,
        path: '',
        isFolder: false,
        size: 0,
        createdAt: '',
        mimeType: f.mimeType ?? null,
      }));
    }

    return [];
  })();

  const argsSummary = tc.args
    ? Object.entries(tc.args)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v).slice(0, 30)}`)
        .join(' | ')
    : '';

  const isRunning = tc.status === 'running';
  const isDone = tc.status === 'done';
  const hasArgs = Boolean(tc.args && Object.keys(tc.args).length > 0);
  const showResult = isDone && Boolean(tc.result);

  return (
    <div
      className={`my-1.5 rounded-xl overflow-hidden border ${
        isPendingConfirm
          ? 'border-amber-300 dark:border-amber-700 bg-gradient-to-r from-amber-50/80 to-transparent dark:from-amber-900/20'
          : isRunning
            ? 'border-amber-200 dark:border-amber-800 bg-gradient-to-r from-amber-50/50 to-transparent dark:from-amber-900/10'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80'
      }`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors text-left"
      >
        <span
          className={`flex items-center justify-center h-5 w-5 rounded-full flex-shrink-0 ${
            isRunning
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 animate-pulse'
              : 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
          }`}
        >
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : meta.icon}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{meta.label}</span>
            {isRunning && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">正在执行…</span>}
            {isDone && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">已完成</span>}
          </div>
          {!expanded && argsSummary && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{argsSummary}</p>}
        </div>

        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''} flex-shrink-0`}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 pt-0 border-t border-slate-100 dark:border-slate-700/50 space-y-2">
          {hasArgs && (
            <div className="pt-2">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">参数</p>
              <pre className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 rounded-md p-2 overflow-auto font-mono max-h-24">
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}

          {showResult && (
            <div>
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">结果</p>
              {resultFiles.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {resultFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onFileClick(f.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all text-left"
                    >
                      <File className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-700 dark:text-slate-300 truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <pre className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 rounded-md p-2 overflow-auto font-mono max-h-32">
                  {JSON.stringify(tc.result, null, 2)}
                </pre>
              )}
            </div>
          )}

          {isRunning && !tc.result && (
            <div className="pt-1 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <div className="flex gap-0.5">
                {[0, 100, 200].map((d) => (
                  <span
                    key={d}
                    className="h-1 w-1 rounded-full bg-amber-400 animate-bounce"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
              等待工具返回结果…
            </div>
          )}

          {isPendingConfirm && (
            <div className="pt-2 space-y-2">
              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-100/50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700">
                <span className="text-amber-600 dark:text-amber-400 text-xs">⚠️</span>
                <p className="text-xs text-amber-800 dark:text-amber-200 flex-1">
                  {confirmMessage || '此操作需要您的确认才能执行'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onConfirm?.(tc.toolName, tc.args)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors"
                >
                  确认执行
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
