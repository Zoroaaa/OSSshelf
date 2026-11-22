/**
 * NoteCard.tsx
 * 单条笔记卡片组件
 *
 * 审查修复：
 * - E-02：dangerouslySetInnerHTML 改为 SafeMarkdown，消除 XSS。
 * - E-05：操作按钮由 onMouseEnter/Leave 改为 group-hover + touch-visible，
 *         触屏设备上常显，解决移动端操作不可见。
 * - A-20：删除确认改用全局 confirmAction。
 */

import React from 'react';
import type { FileNote } from '@/services/api';
import { SafeMarkdown } from '@/components/ui/SafeMarkdown';
import { confirmAction } from '@/components/ui/useConfirm';

interface NoteCardProps {
  note: FileNote;
  replies?: FileNote[];
  onEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  onTogglePin: () => void;
  onDeleteReply?: (replyId: string) => void;
  currentUserId?: string;
}

const NoteCard: React.FC<NoteCardProps> = ({
  note,
  replies,
  onEdit,
  onDelete,
  onReply,
  onTogglePin,
  onDeleteReply,
  currentUserId,
}) => {
  const formatDate = (value: string) => {
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const displayName = note.user?.name || note.user?.email?.split('@')[0] || '未知用户';

  const handleDelete = async () => {
    const ok = await confirmAction({
      title: '删除笔记',
      description: '确定要删除这条笔记吗？此操作不可恢复。',
      level: 'danger',
      confirmText: '删除',
    });
    if (ok) onDelete();
  };

  const handleDeleteReply = async (replyId: string) => {
    const ok = await confirmAction({
      title: '删除回复',
      description: '确定要删除这条回复吗？',
      level: 'danger',
      confirmText: '删除',
    });
    if (ok) onDeleteReply?.(replyId);
  };

  return (
    <div
      className={`group bg-muted/60 rounded-lg p-3 ${
        note.isPinned ? 'ring-2 ring-yellow-400 dark:ring-yellow-600' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{displayName}</span>
              {note.isPinned && (
                <svg className="w-4 h-4 text-yellow-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L10 6.477V16h2a1 1 0 110 2H8a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
                </svg>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{formatDate(note.createdAt)}</span>
          </div>
        </div>

        {/* E-05：触屏常显（touch-visible），桌面 hover 显示 */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity touch-visible">
          <button
            onClick={onReply}
            className="p-2 rounded hover:bg-accent text-muted-foreground touch-target-sm flex items-center justify-center"
            title="回复"
            aria-label="回复"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
          </button>
          <button
            onClick={onTogglePin}
            className={`p-2 rounded hover:bg-accent touch-target-sm flex items-center justify-center ${note.isPinned ? 'text-yellow-500' : 'text-muted-foreground'}`}
            title={note.isPinned ? '取消置顶' : '置顶'}
            aria-label={note.isPinned ? '取消置顶' : '置顶'}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L10 6.477V16h2a1 1 0 110 2H8a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
            </svg>
          </button>
          <button
            onClick={onEdit}
            className="p-2 rounded hover:bg-accent text-muted-foreground touch-target-sm flex items-center justify-center"
            title="编辑"
            aria-label="编辑"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className="p-2 rounded hover:bg-destructive/10 text-destructive touch-target-sm flex items-center justify-center"
            title="删除"
            aria-label="删除"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* E-02：安全 Markdown 渲染，替代 dangerouslySetInnerHTML */}
      <SafeMarkdown content={note.content || ''} className="mt-2 text-sm" />

      {note.version > 1 && <div className="mt-2 text-xs text-muted-foreground">已编辑 · 版本 {note.version}</div>}

      {replies && replies.length > 0 && (
        <div className="mt-3 pl-4 border-l-2 border-border">
          <div className="space-y-2">
            {replies.map((reply) => {
              const canDeleteReply = onDeleteReply && (currentUserId === reply.userId || currentUserId === note.userId);
              return (
                <div
                  key={reply.id}
                  className="group/reply bg-muted rounded p-2 relative flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs">
                        {reply.user?.name || reply.user?.email?.split('@')[0] || '未知用户'}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(reply.createdAt)}</span>
                    </div>
                    <SafeMarkdown content={reply.content || ''} className="mt-1 text-xs" />
                  </div>
                  {canDeleteReply && (
                    <button
                      onClick={() => handleDeleteReply(reply.id)}
                      className="shrink-0 p-2 rounded hover:bg-destructive/10 text-destructive opacity-0 group-hover/reply:opacity-100 focus-within:opacity-100 transition-opacity touch-visible touch-target-sm flex items-center justify-center"
                      title="删除回复"
                      aria-label="删除回复"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default NoteCard;
