/**
 * ToolCallCard.tsx
 * 工具调用卡片组件（优化版）
 *
 * 功能:
 * - 展示工具调用状态（运行中/完成/待确认）
 * - 展开/收起参数和结果
 * - 结果文件可点击跳转
 * - 危险操作需用户确认
 * - 优化的视觉层次和动画效果
 */

import { useState } from 'react';
import { Sparkles, ChevronDown, Loader2, File, CheckCircle2, AlertTriangle, Clock, Zap } from 'lucide-react';
import type { ToolCallEvent, AgentFile, PreviewDiff } from '../types';
import { DiffPreview } from './DiffPreview';
import { DraftPreview } from './DraftPreview'; // Phase 7 草稿预览

interface ToolCallCardProps {
  tc: ToolCallEvent;
  onFileClick: (id: string) => void;
  onConfirm?: (toolName: string, args: Record<string, unknown>) => void;
  onConfirmAction?: (msgId: string, confirmId: string) => void;
  onCancelConfirm?: (msgId: string) => void;
  msgId?: string;
  toolMeta?: Record<string, { label: string; icon: React.ReactNode }>;
}

export function ToolCallCard({
  tc,
  onFileClick,
  onConfirm,
  onConfirmAction,
  onCancelConfirm,
  msgId,
  toolMeta = {},
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const meta = toolMeta[tc.toolName] || {
    label: tc.toolName.replace(/_/g, ' '),
    icon: <Sparkles className="h-3 w-3" />,
  };

  const resultObj = tc.result && typeof tc.result === 'object' ? (tc.result as Record<string, unknown>) : null;
  const isPendingConfirm = resultObj?.status === 'pending_confirm';
  const confirmMessage = resultObj?.message as string | undefined;
  const confirmId = resultObj?.confirmId as string | undefined;
  const previewDiff = resultObj?.previewDiff as PreviewDiff | undefined;

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
        .join(' · ')
    : '';

  const isRunning = tc.status === 'running';
  const isDone = tc.status === 'done';
  const hasArgs = Boolean(tc.args && Object.keys(tc.args).length > 0);
  const showResult = isDone && Boolean(tc.result);

  const getStatusConfig = () => {
    if (isPendingConfirm) {
      return {
        bg: 'bg-gradient-to-r from-amber-50 via-yellow-50 to-transparent dark:from-amber-950/30 dark:via-yellow-950/20',
        border: 'border-amber-300 dark:border-amber-700',
        iconBg: 'bg-amber-100 dark:bg-amber-900/40',
        iconColor: 'text-amber-600 dark:text-amber-400',
        icon: <AlertTriangle className="h-3 w-3" />,
        statusText: '待确认',
        statusColor: 'text-amber-600 dark:text-amber-400',
      };
    }
    if (isRunning) {
      return {
        bg: 'bg-gradient-to-r from-blue-50 via-indigo-50 to-transparent dark:from-blue-950/20 dark:via-indigo-950/10',
        border: 'border-blue-200 dark:border-blue-800',
        iconBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 animate-pulse',
        iconColor: 'text-blue-600 dark:text-blue-400',
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        statusText: '执行中…',
        statusColor: 'text-blue-600 dark:text-blue-400',
      };
    }
    return {
      bg: 'bg-white dark:bg-slate-800/90',
      border: 'border-slate-200 dark:border-slate-700',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      icon: <CheckCircle2 className="h-3 w-3" />,
      statusText: '已完成',
      statusColor: 'text-emerald-600 dark:text-emerald-400',
    };
  };

  const statusConfig = getStatusConfig();

  return (
    <div
      className={`my-2 rounded-xl overflow-hidden border transition-all duration-300 ${statusConfig.border} ${statusConfig.bg} shadow-sm hover:shadow-md`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-all duration-200 text-left group"
      >
        <span
          className={`flex items-center justify-center h-8 w-8 rounded-xl flex-shrink-0 shadow-sm ${statusConfig.iconBg} ${statusConfig.iconColor} transition-all duration-300 group-hover:scale-110`}
        >
          {statusConfig.icon}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{meta.label}</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${statusConfig.iconBg} ${statusConfig.statusColor}`}
            >
              {isRunning && <Clock className="h-2.5 w-2.5 mr-1" />}
              {!isRunning && !isPendingConfirm && <Zap className="h-2.5 w-2.5 mr-1" />}
              {isPendingConfirm && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
              {statusConfig.statusText}
            </span>
          </div>
          {!expanded && argsSummary && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">{argsSummary}</p>
          )}
        </div>

        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-all duration-300 ${expanded ? 'rotate-180' : ''} flex-shrink-0 group-hover:text-slate-600 dark:group-hover:text-slate-300`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-slate-100/80 dark:border-slate-700/50 space-y-3 animate-in slide-in-from-top-2 duration-200">
          {hasArgs && (
            <div className="pt-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-1 w-1 rounded-full bg-violet-400" />
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">参数</p>
              </div>
              <pre className="text-[12px] text-slate-700 dark:text-slate-300 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950 dark:to-slate-900/50 rounded-lg p-3 overflow-auto font-mono max-h-32 border border-slate-200/60 dark:border-slate-700/40 shadow-inner leading-relaxed">
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}

          {showResult && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="h-1 w-1 rounded-full bg-emerald-400" />
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">结果</p>
              </div>
              {resultFiles.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {resultFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onFileClick(f.id)}
                      className="group/file flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-850 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50/50 dark:hover:bg-violet-900/20 transition-all duration-200 text-left hover:shadow-md hover:shadow-violet-500/5"
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center group-hover/file:from-violet-100 group-hover/file:to-purple-100 dark:group-hover/file:from-violet-900/40 dark:group-hover/file:to-purple-900/30 transition-all duration-200">
                        <File className="h-4 w-4 text-slate-500 group-hover/file:text-violet-600 dark:group-hover/file:text-violet-400 transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate group-hover/file:text-violet-700 dark:group-hover/file:text-violet-300 transition-colors">
                          {f.name}
                        </p>
                      </div>
                      <ExternalLinkIcon />
                    </button>
                  ))}
                </div>
              ) : (
                <pre className="text-[12px] text-slate-700 dark:text-slate-300 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950 dark:to-slate-900/50 rounded-lg p-3 overflow-auto font-mono max-h-40 border border-slate-200/60 dark:border-slate-700/40 shadow-inner leading-relaxed">
                  {typeof tc.result === 'object' && tc.result !== null
                    ? JSON.stringify(tc.result, null, 2)
                    : String(tc.result ?? '')}
                </pre>
              )}
            </div>
          )}

          {isRunning && !tc.result && (
            <div className="pt-2 flex items-center gap-2.5 text-[12px] text-blue-600 dark:text-blue-400">
              <div className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
              <span className="font-medium">正在处理，请稍候…</span>
            </div>
          )}

          {isPendingConfirm && (
            <div className="pt-3 space-y-3">
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 border border-amber-200/70 dark:border-amber-700/50 shadow-sm">
                <div className="flex-shrink-0 mt-0.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <p className="text-[13px] text-amber-800 dark:text-amber-200 flex-1 leading-relaxed font-medium">
                  {confirmMessage || '此操作需要您的确认才能执行'}
                </p>
              </div>

              {previewDiff && <DiffPreview diff={previewDiff} />}

              {/* Phase 7: 草稿预览 */}
              {(resultObj?.previewType as string) === 'draft' && resultObj.draftContent != null && (
                <DraftPreview
                  content={String(resultObj.draftContent)}
                  fileName={String(resultObj.fileName || 'untitled')}
                />
              )}

              <div className="flex gap-2.5 pt-1">
                <button
                  onClick={() => {
                    if (onConfirmAction && msgId && confirmId) {
                      onConfirmAction(msgId, confirmId);
                    } else if (onConfirm) {
                      onConfirm(tc.toolName, tc.args);
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white text-[13px] font-semibold transition-all duration-200 shadow-md shadow-violet-500/25 hover:shadow-lg hover:shadow-violet-500/30 active:scale-[0.98]"
                >
                  确认执行
                </button>
                <button
                  onClick={() => {
                    if (onCancelConfirm && msgId) {
                      onCancelConfirm(msgId);
                    }
                    setExpanded(false);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-[13px] font-semibold transition-all duration-200 active:scale-[0.98]"
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

function ExternalLinkIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover/file:opacity-100 transition-all duration-200 translate-x-1 group-hover/file:translate-x-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}
