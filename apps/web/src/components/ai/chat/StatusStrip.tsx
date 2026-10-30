/**
 * StatusStrip.tsx
 * 会话状态条：连接状态 / 恢复中 / 当前上下文（文件夹、引用文件数）。
 * 只在需要提示时出现，避免常驻噪音。
 */

import { FolderOpen, Loader2, WifiOff } from 'lucide-react';

interface StatusStripProps {
  connected: boolean;
  ready: boolean;
  isRecovering: boolean;
  contextFolderName?: string;
  mentionCount: number;
  onClearContext?: () => void;
}

export function StatusStrip({
  connected,
  ready,
  isRecovering,
  contextFolderName,
  mentionCount,
  onClearContext,
}: StatusStripProps) {
  const showDisconnected = ready && !connected;
  const showRecovering = isRecovering;
  const showContext = Boolean(contextFolderName) || mentionCount > 0;

  if (!showDisconnected && !showRecovering && !showContext) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-muted/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        {showDisconnected && (
          <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <WifiOff className="h-3 w-3" />
            正在重连会话…
          </span>
        )}
        {showRecovering && (
          <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            正在恢复上次生成…
          </span>
        )}
        {showContext && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <FolderOpen className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              {contextFolderName ? `上下文：${contextFolderName}` : '上下文'}
              {mentionCount > 0 ? ` · 引用 ${mentionCount} 个文件` : ''}
            </span>
            {onClearContext && (
              <button
                type="button"
                onClick={onClearContext}
                className="rounded px-1 text-[10px] underline-offset-2 hover:underline"
              >
                清除
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
