/**
 * ToolCallCard.tsx
 * 工具调用卡片（降噪版）
 *
 * 设计目标：
 * - 默认单行：图标 + 中文名称 + 摘要 + 状态点，避免一大堆积木式卡片
 * - 审批中自动展开并高亮，确保用户不会错过确认
 * - 展开后展示参数、结果、diff/草稿预览
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, File, FolderOpen, Loader2, X } from 'lucide-react';
import type { ToolCallEvent } from '../types';
import { getToolIcon, getToolMeta, summarizeToolCall } from './toolMeta';
import { DiffPreview } from './DiffPreview';
import { DraftPreview } from './DraftPreview';
import { useEditPreview } from './useEditPreview';

interface ToolCallCardProps {
  tc: ToolCallEvent;
  onFileClick: (id: string, isFolder: boolean) => void;
  onConfirmAction?: (confirmId: string) => void;
  onCancelConfirm?: (confirmId?: string) => void;
}

interface ResultFile {
  id: string;
  name: string;
  isFolder: boolean;
}

const FILE_LIMIT = 8;

function isResultFile(value: unknown): value is { id: string; name: string; isFolder?: unknown } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function collectTreeNodes(nodes: unknown[], output: unknown[]): void {
  for (const node of nodes) {
    output.push(node);
    const children = (node as { children?: unknown }).children;
    if (Array.isArray(children)) collectTreeNodes(children, output);
  }
}

function extractResultFiles(result: unknown): ResultFile[] {
  if (!result || typeof result !== 'object') return [];
  const data = result as Record<string, unknown>;

  const candidates: unknown[] = [];
  if (Array.isArray(data.files)) candidates.push(...data.files);
  if (Array.isArray(data.children)) candidates.push(...data.children);
  if (Array.isArray(data.chain)) candidates.push(...data.chain);
  if (Array.isArray(data.tree)) collectTreeNodes(data.tree, candidates);
  candidates.push(data.file, data.folder, data.id && data.name ? data : undefined, data.fileA, data.fileB);

  const seen = new Set<string>();
  const files: ResultFile[] = [];
  for (const candidate of candidates) {
    if (!isResultFile(candidate) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    files.push({ id: candidate.id, name: candidate.name, isFolder: candidate.isFolder === true });
    if (files.length >= FILE_LIMIT) break;
  }
  return files;
}

export function ToolCallCard({ tc, onFileClick, onConfirmAction, onCancelConfirm }: ToolCallCardProps) {
  const meta = getToolMeta(tc.toolName);
  const summary = summarizeToolCall(tc.toolName, tc.args);

  const isPending = tc.confirmStatus === 'pending' || tc.status === 'pending_confirm';
  const isCancelled = tc.confirmStatus === 'cancelled';
  const isRunning = tc.status === 'running' && !isPending;
  const isError = tc.status === 'error';

  // 审批必须露出按钮，因此默认展开
  const [expanded, setExpanded] = useState(isPending);
  useEffect(() => {
    if (isPending) setExpanded(true);
  }, [isPending]);
  const previewDiff = useEditPreview(tc.toolName, tc.args, isPending);
  const draftContent = typeof tc.args?.draftContent === 'string' ? tc.args.draftContent : '';
  const draftFileName = typeof tc.args?.fileName === 'string' ? tc.args.fileName : '';

  const resultFiles = extractResultFiles(tc.result);
  const hasArgs = Boolean(tc.args && Object.keys(tc.args).length > 0);

  const statusLabel = isPending ? '待确认' : isCancelled ? '已取消' : isError ? '失败' : isRunning ? '执行中' : '完成';

  const statusColor = isPending
    ? 'text-amber-600 dark:text-amber-400'
    : isCancelled
      ? 'text-muted-foreground'
      : isError
        ? 'text-destructive'
        : isRunning
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div
      className={`overflow-hidden rounded-lg border transition-colors ${
        isPending
          ? 'border-amber-300/80 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/20'
          : 'border-border bg-card'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/40"
      >
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : getToolIcon(tc.toolName)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{meta.label}</span>
            <span className={`inline-flex flex-shrink-0 items-center gap-1 text-[10px] font-medium ${statusColor}`}>
              {isPending && <AlertTriangle className="h-2.5 w-2.5" />}
              {!isPending && !isRunning && !isError && !isCancelled && <CheckCircle2 className="h-2.5 w-2.5" />}
              {isError && <AlertTriangle className="h-2.5 w-2.5" />}
              {isCancelled && <X className="h-2.5 w-2.5" />}
              {statusLabel}
            </span>
          </span>
          {!expanded && (
            <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{summary}</span>
          )}
        </span>

        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/70 px-3 py-3">
          {hasArgs && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">参数</p>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted/70 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}

          {tc.status === 'done' && tc.result !== undefined && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">结果</p>
              {resultFiles.length > 0 ? (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {resultFiles.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => onFileClick(file.id, file.isFolder)}
                      className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                    >
                      {file.isFolder ? (
                        <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                      ) : (
                        <File className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-xs text-foreground">{file.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <pre className="max-h-48 overflow-auto rounded-md bg-muted/70 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                  {typeof tc.result === 'object' ? JSON.stringify(tc.result, null, 2) : String(tc.result)}
                </pre>
              )}
            </div>
          )}

          {isError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {typeof tc.result === 'object' && tc.result && 'error' in tc.result
                ? String((tc.result as { error?: unknown }).error)
                : '工具执行失败'}
            </p>
          )}

          {previewDiff && <DiffPreview diff={previewDiff} />}

          {isPending && draftContent && <DraftPreview content={draftContent} fileName={draftFileName || 'untitled'} />}

          {isPending && (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => tc.approvalId && onConfirmAction?.(tc.approvalId)}
                disabled={!tc.approvalId}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                确认执行
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onCancelConfirm) onCancelConfirm(tc.approvalId);
                  setExpanded(false);
                }}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
              >
                取消
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
