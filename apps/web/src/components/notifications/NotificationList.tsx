/**
 * NotificationList.tsx
 * 通知列表组件
 *
 * 功能:
 * - 显示通知列表
 * - 标记已读
 * - 删除通知
 */

import { useState, useEffect } from 'react';
import { Bell, Check, CheckCheck, Trash2, Loader2, X } from 'lucide-react';
import { notificationsApi } from '../../services/api';
import { cn } from '../../utils';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationListProps {
  onClose?: () => void;
  onNotificationClick?: (notification: Notification) => void;
  className?: string;
}

const TYPE_ICONS: Record<string, string> = {
  share_received: '📁',
  mention: '@',
  permission_granted: '🔐',
  quota_warning: '⚠️',
  ai_complete: '🤖',
  system: '🔔',
};

export function NotificationList({ onClose, onNotificationClick, className }: NotificationListProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await notificationsApi.list();
      if (res.data.success && res.data.data?.items) {
        setNotifications(res.data.data.items);
      }
    } catch (err) {
      setError('加载通知失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await notificationsApi.delete(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('text-center py-8 text-red-500', className)}>
        {error}
        <button onClick={fetchNotifications} className="ml-2 text-blue-500 hover:underline">
          重试
        </button>
      </div>
    );
  }

  return (
    <div className={cn('bg-white dark:bg-gray-800 rounded-lg shadow-lg', className)}>
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold flex items-center gap-2">
          <Bell className="h-5 w-5" />
          通知
        </h3>
        <div className="flex items-center gap-2">
          {notifications.some((n) => !n.isRead) && (
            <button
              onClick={handleMarkAllRead}
              className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
            >
              <CheckCheck className="h-4 w-4" />
              全部已读
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Bell className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p>暂无通知</p>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={cn(
                'p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer',
                !notification.isRead && 'bg-blue-50/50 dark:bg-blue-900/20'
              )}
              onClick={() => onNotificationClick?.(notification)}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0">{TYPE_ICONS[notification.type] || '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('font-medium', !notification.isRead && 'text-blue-600')}>
                      {notification.title}
                    </span>
                    {!notification.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />}
                  </div>
                  {notification.body && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">{notification.body}</p>
                  )}
                  <span className="text-xs text-gray-400 mt-1 block">{formatTime(notification.createdAt)}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!notification.isRead && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkRead(notification.id);
                      }}
                      className="p-1.5 text-gray-400 hover:text-blue-500 rounded transition-colors"
                      title="标记已读"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(notification.id);
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
