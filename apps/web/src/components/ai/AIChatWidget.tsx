/**
 * AIChatWidget.tsx
 * 全局 AI 对话悬浮按钮组件
 *
 * 功能:
 * - 右下角悬浮按钮 (FAB)，带脉冲动画
 * - 点击跳转到 AI 对话页面
 * - 文件预览全屏时自动隐藏
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';

export function AIChatWidget() {
  const navigate = useNavigate();
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsPreviewFullscreen(document.body.classList.contains('preview-fullscreen'));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    setIsPreviewFullscreen(document.body.classList.contains('preview-fullscreen'));
    return () => observer.disconnect();
  }, []);

  if (isPreviewFullscreen) return null;

  return (
    <button
      onClick={() => navigate('/ai-chat')}
      className="group fixed bottom-20 right-6 lg:bottom-6 z-[100] flex items-center justify-center
        w-14 h-14 rounded-2xl
        bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500
        shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40
        transition-all duration-300 ease-out
        hover:scale-110 active:scale-95
        focus:outline-none focus-visible:ring-4 focus-visible:ring-purple-400/50"
      aria-label="打开 AI 对话"
    >
      <span
        className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500
        animate-ping opacity-20"
        style={{ animationDuration: '2.5s' }}
      />

      <MessageSquare className="h-6 w-6 text-white relative z-10 group-hover:rotate-12 transition-transform duration-300" />

      <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white dark:border-slate-900" />
      </span>
    </button>
  );
}
