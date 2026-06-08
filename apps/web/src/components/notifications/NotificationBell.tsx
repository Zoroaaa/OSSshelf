/**
 * NotificationBell.tsx
 * 通知铃铛组件
 *
 * 功能:
 * - 显示未读通知数量
 * - 点击打开通知列表弹窗
 * - 使用SSE实时推送通知
 */

import { useState, useEffect, useRef } from 'react';
import { Bell, BellOff, WifiOff } from 'lucide-react';
import { notificationsApi } from '../../services/api';
import { NotificationList } from './NotificationList';
import { cn } from '../../utils';

interface NotificationBellProps {
  className?: string;
  align?: 'left' | 'right' | 'center';
  direction?: 'up' | 'down';
}

export function NotificationBell({ className, align = 'right', direction = 'down' }: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let fallbackInterval: NodeJS.Timeout | null = null;
    let controller: AbortController | null = null;

    const connectSSE = async () => {
      try {
        controller = new AbortController();

        const response = await notificationsApi.stream({ signal: controller.signal });

        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        setIsConnected(true);
        if (fallbackInterval) {
          clearInterval(fallbackInterval);
          fallbackInterval = null;
        }

        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = new TextDecoder().decode(value);
          buffer += chunk;

          const lines = buffer.split('\n');
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i];
            if (line) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith('data:')) {
                const data = trimmedLine.substring(5).trim();
                try {
                  const parsed = JSON.parse(data);
                  if (typeof parsed.unreadCount === 'number') {
                    setUnreadCount(parsed.unreadCount);
                  }
                } catch {
                  // silent fail
                }
              }
            }
          }

          buffer = lines[lines.length - 1] || '';
        }

        reader.releaseLock();
      } catch (error) {
        setIsConnected(false);
        // 5秒后重连
        setTimeout(connectSSE, 5000);
      }
    };

    connectSSE();

    return () => {
      if (controller) {
        controller.abort();
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, []);

  const fetchUnreadCount = async () => {
    try {
      const res = await notificationsApi.getUnreadCount();
      if (res.data.success) {
        setUnreadCount(res.data.data?.count ?? 0);
      }
    } catch {
      // silent fail
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      fetchUnreadCount();
    }
  };

  const handleNotificationClick = () => {
    setIsOpen(false);
    fetchUnreadCount();
  };

  const alignClass = {
    left: 'left-0',
    right: 'right-0',
    center: 'left-1/2 -translate-x-1/2',
  }[align];

  const directionClass = direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={cn(
          'relative p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors',
          className
        )}
        title={isConnected ? '通知 (实时连接)' : '通知 (离线)'}
      >
        {unreadCount > 0 ? (
          <>
            <Bell className={cn('h-5 w-5', isConnected ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400')} />
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-bold text-white bg-red-500 rounded-full">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
            {!isConnected && <WifiOff className="absolute -bottom-0.5 -left-0.5 h-3 w-3 text-amber-500" />}
          </>
        ) : (
          <>
            <BellOff className={cn('h-5 w-5', isConnected ? 'text-gray-400' : 'text-gray-300')} />
            {!isConnected && <WifiOff className="absolute -bottom-0.5 -left-0.5 h-3 w-3 text-amber-500" />}
          </>
        )}
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          className={cn('absolute w-80 sm:w-96 z-50 animate-in fade-in-0 zoom-in-95', alignClass, directionClass)}
        >
          <NotificationList
            onClose={() => setIsOpen(false)}
            onNotificationClick={handleNotificationClick}
            className="shadow-xl border border-gray-200 dark:border-gray-700"
          />
        </div>
      )}
    </div>
  );
}
