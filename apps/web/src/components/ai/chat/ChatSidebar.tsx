/**
 * ChatSidebar.tsx
 * 聊天会话历史侧边栏组件
 *
 * 功能:
 * - 展示会话列表
 * - 新建对话
 * - 重命名/删除会话
 * - 移动端遮罩
 */

import { Plus, Trash2, Pencil, X, Check, Zap, Coins } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatDate } from '@/utils';

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

interface SessionItem {
  id: string;
  title: string;
  updatedAt: string;
  lastToolCallCount?: number;
  totalTokensUsed?: number;
  modelId?: string;
}

interface ChatSidebarProps {
  showSidebar: boolean;
  sessions: SessionItem[];
  currentSessionId: string | null;
  renamingId: string | null;
  renameValue: string;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (e: React.MouseEvent, id: string) => void;
  onStartRename: (session: SessionItem) => void;
  onConfirmRename: (id: string) => void;
  onCancelRename: () => void;
  onRenameValueChange: (value: string) => void;
  onCloseMobile: () => void;
}

export function ChatSidebar({
  showSidebar,
  sessions,
  currentSessionId,
  renamingId,
  renameValue,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onRenameValueChange,
  onCloseMobile,
}: ChatSidebarProps) {
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renamingId]);

  return (
    <>
      {showSidebar && (
        <div className="lg:hidden fixed inset-0 z-20 bg-black/40 backdrop-blur-sm" onClick={onCloseMobile} />
      )}

      <aside
        className={`flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex-shrink-0 ${
          showSidebar ? 'w-64' : 'w-0'
        } fixed inset-y-0 left-0 z-30 lg:relative lg:z-auto overflow-hidden`}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            对话历史
          </span>
          <button
            onClick={onNewChat}
            className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-violet-600 transition-colors"
            title="新建对话"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-0.5">
          {sessions.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-10">暂无对话记录</p>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`relative group rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                  session.id === currentSessionId
                    ? 'bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                {renamingId === session.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={renameRef}
                      value={renameValue}
                      onChange={(e) => onRenameValueChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onConfirmRename(session.id);
                        if (e.key === 'Escape') onCancelRename();
                      }}
                      className="flex-1 text-xs bg-white dark:bg-slate-700 border border-violet-300 dark:border-violet-600 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                    <button
                      onClick={() => onConfirmRename(session.id)}
                      className="p-1 rounded text-green-600 hover:bg-green-100"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button onClick={onCancelRename} className="p-1 rounded text-slate-400 hover:bg-slate-100">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-1">
                      <span
                        className={`text-xs font-medium truncate flex-1 leading-snug ${
                          session.id === currentSessionId
                            ? 'text-violet-700 dark:text-violet-300'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {session.title}
                      </span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartRename(session);
                          }}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400"
                          title="重命名"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                        <button
                          onClick={(e) => onDeleteSession(e, session.id)}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500"
                          title="删除"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] text-slate-400">{formatDate(session.updatedAt)}</p>
                      {(session.lastToolCallCount ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                          <Zap className="h-2.5 w-2.5" />
                          {session.lastToolCallCount}
                        </span>
                      )}
                      {(session.totalTokensUsed ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 dark:text-blue-400">
                          <Coins className="h-2.5 w-2.5" />
                          {formatTokenCount(session.totalTokensUsed!)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
