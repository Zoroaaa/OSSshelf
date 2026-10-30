/**
 * ChatSidebar.tsx
 * 会话历史：搜索、按日期分组、重命名、删除（二次确认）、移动端抽屉。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, MessageSquare, PanelLeftClose, Pencil, Plus, Search, Trash2, X } from 'lucide-react';

export interface SessionItem {
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
  onDeleteSession: (event: React.MouseEvent, id: string) => void;
  onClearAllSessions: () => void;
  /** 桌面端折叠侧栏（折叠后在页面左边缘显示还原入口） */
  onToggleSidebar: () => void;
  onStartRename: (session: SessionItem) => void;
  onConfirmRename: (id: string) => void;
  onCancelRename: () => void;
  onRenameValueChange: (value: string) => void;
  onCloseMobile: () => void;
}

function dayKey(value: string): 'today' | 'yesterday' | 'older' {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'older';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const time = date.getTime();
  if (time >= startOfToday) return 'today';
  if (time >= startOfYesterday) return 'yesterday';
  return 'older';
}

const GROUP_LABEL: Record<'today' | 'yesterday' | 'older', string> = {
  today: '今天',
  yesterday: '昨天',
  older: '更早',
};

function compactTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
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
  onClearAllSessions,
  onToggleSidebar,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onRenameValueChange,
  onCloseMobile,
}: ChatSidebarProps) {
  const renameRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);

  useEffect(() => {
    if (renamingId) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renamingId]);

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? sessions.filter((session) => session.title.toLowerCase().includes(normalized))
      : sessions;
    const buckets: Record<'today' | 'yesterday' | 'older', SessionItem[]> = { today: [], yesterday: [], older: [] };
    for (const session of filtered) buckets[dayKey(session.updatedAt)].push(session);
    return (['today', 'yesterday', 'older'] as const)
      .map((key) => ({ key, label: GROUP_LABEL[key], items: buckets[key] }))
      .filter((group) => group.items.length > 0);
  }, [sessions, query]);

  return (
    <>
      {showSidebar && (
        <div className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm lg:hidden" onClick={onCloseMobile} />
      )}

      <aside
        className={`flex flex-shrink-0 flex-col overflow-hidden border-r border-border bg-background pb-[env(safe-area-inset-bottom)] transition-all duration-300 ${
          showSidebar ? 'w-72' : 'w-0 border-r-0'
        } fixed inset-y-0 left-0 z-30 lg:relative lg:z-auto`}
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">对话历史</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onNewChat}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="新建对话"
              aria-label="新建对话"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClearAll(true)}
              disabled={sessions.length === 0}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
              title="清空全部对话"
              aria-label="清空全部对话"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleSidebar}
              className="hidden h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
              title="隐藏对话历史"
              aria-label="隐藏对话历史"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onCloseMobile}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
              title="关闭"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {confirmingClearAll && (
          <div className="mx-3 mt-2 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5">
            <span className="text-xs text-destructive">清空全部对话？不可恢复</span>
            <span className="flex flex-shrink-0 gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmingClearAll(false);
                  onClearAllSessions();
                }}
                className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground"
              >
                清空
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClearAll(false)}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground"
              >
                取消
              </button>
            </span>
          </div>
        )}

        <div className="flex-shrink-0 px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索会话"
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-muted-foreground hover:text-foreground"
                aria-label="清空搜索"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <MessageSquare className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">{query ? '没有匹配的会话' : '暂无对话记录'}</p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="mb-2">
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((session) => {
                    const active = session.id === currentSessionId;
                    const renaming = renamingId === session.id;
                    const confirmingDelete = pendingDeleteId === session.id;

                    return (
                      <div
                        key={session.id}
                        onClick={() => {
                          if (renaming || confirmingDelete) return;
                          onSelectSession(session.id);
                        }}
                        className={`group relative rounded-lg px-2.5 py-2 transition-colors ${
                          active ? 'bg-primary/10' : 'cursor-pointer hover:bg-accent/60'
                        }`}
                      >
                        {renaming ? (
                          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                            <input
                              ref={renameRef}
                              value={renameValue}
                              onChange={(event) => onRenameValueChange(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') onConfirmRename(session.id);
                                if (event.key === 'Escape') onCancelRename();
                              }}
                              className="min-w-0 flex-1 rounded border border-primary/50 bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                            />
                            <button
                              type="button"
                              onClick={() => onConfirmRename(session.id)}
                              className="rounded p-1 text-emerald-600 hover:bg-emerald-500/10"
                              aria-label="确认重命名"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={onCancelRename}
                              className="rounded p-1 text-muted-foreground hover:bg-accent"
                              aria-label="取消重命名"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : confirmingDelete ? (
                          <div
                            className="flex items-center justify-between gap-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className="truncate text-xs text-destructive">删除该会话？</span>
                            <span className="flex flex-shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={(event) => {
                                  setPendingDeleteId(null);
                                  onDeleteSession(event, session.id);
                                }}
                                className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground"
                              >
                                删除
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteId(null)}
                                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground"
                              >
                                取消
                              </button>
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <span
                                className={`min-w-0 flex-1 truncate text-xs leading-snug ${
                                  active ? 'font-medium text-foreground' : 'text-muted-foreground'
                                }`}
                              >
                                {session.title}
                              </span>
                              <span className="flex flex-shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onStartRename(session);
                                  }}
                                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  aria-label="重命名会话"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setPendingDeleteId(session.id);
                                  }}
                                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  aria-label="删除会话"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </span>
                            </div>
                            {(session.totalTokensUsed ?? 0) > 0 && (
                              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                {compactTokens(session.totalTokensUsed ?? 0)}
                                {session.lastToolCallCount ? ` · ${session.lastToolCallCount} 次调用` : ''}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
