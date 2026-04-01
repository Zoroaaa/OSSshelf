/**
 * NoteCard.tsx
 * 单条笔记卡片组件
 */

import React, { useState } from 'react';
import type { FileNote } from '@/services/api';

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
  const [showReplies, setShowReplies] = useState(true);
  const [showActions, setShowActions] = useState(false);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const displayName = note.user?.name || note.user?.email?.split('@')[0] || '未知用户';

  return (
    <div
      className={`bg-gray-50 dark:bg-gray-800 rounded-lg p-3 ${
        note.isPinned ? 'ring-2 ring-yellow-400 dark:ring-yellow-600' : ''
      }`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{displayName}</span>
              {note.isPinned && (
                <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L10 6.477V16h2a1 1 0 110 2H8a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
                </svg>
              )}
            </div>
            <span className="text-xs text-gray-500">{formatDate(note.createdAt)}</span>
          </div>
        </div>

        {showActions && (
          <div className="flex items-center gap-1">
            <button
              onClick={onReply}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
              title="回复"
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
              className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
                note.isPinned ? 'text-yellow-500' : 'text-gray-500'
              }`}
              title={note.isPinned ? '取消置顶' : '置顶'}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L10 6.477V16h2a1 1 0 110 2H8a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
              </svg>
            </button>
            <button
              onClick={onEdit}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
              title="编辑"
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
              onClick={onDelete}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500"
              title="删除"
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
        )}
      </div>

      <div
        className="mt-2 text-sm text-gray-700 dark:text-gray-300 prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: note.contentHtml || note.content }}
      />

      {note.version > 1 && <div className="mt-2 text-xs text-gray-400">已编辑 · 版本 {note.version}</div>}

      {replies && replies.length > 0 && (
        <div className="mt-3 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
          <button onClick={() => setShowReplies(!showReplies)} className="text-xs text-blue-500 hover:underline mb-2">
            {showReplies ? '隐藏' : '显示'} {replies.length} 条回复
          </button>
          {showReplies && (
            <div className="space-y-2">
              {replies.map((reply) => {
                const canDeleteReply =
                  onDeleteReply && (currentUserId === reply.userId || currentUserId === note.userId);
                return (
                  <div key={reply.id} className="bg-gray-100 dark:bg-gray-700 rounded p-2 group relative">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs">
                          {reply.user?.name || reply.user?.email?.split('@')[0] || '未知用户'}
                        </span>
                        <span className="text-xs text-gray-500">{formatDate(reply.createdAt)}</span>
                      </div>
                      {canDeleteReply && (
                        <button
                          onClick={() => {
                            if (confirm('确定要删除这条回复吗？')) {
                              onDeleteReply(reply.id);
                            }
                          }}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="删除回复"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                    <div
                      className="mt-1 text-xs text-gray-600 dark:text-gray-400"
                      dangerouslySetInnerHTML={{ __html: reply.contentHtml || reply.content }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NoteCard;
