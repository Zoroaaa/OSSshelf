/**
 * AIChatWidget.tsx
 * 全局 AI 对话悬浮按钮组件
 *
 * 功能:
 * - 右下角悬浮按钮 (FAB)，带脉冲动画
 * - 点击跳转到 AI 对话页面
 * - 任意弹窗打开或文件预览全屏时自动隐藏（审查报告 P0-01 修复）
 *
 * 层级说明（P0-01）：
 *   修复前 z-[100] 高于全部业务弹窗 z-50，且仅靠 preview-fullscreen 单一信号隐藏，
 *   导致打开文件/保存确认框时被遮挡。修复后：
 *   1) 层级降为 z-assistant(30)，结构上永远低于 z-overlay(50) 弹窗；
 *   2) 订阅全局弹窗栈，任一弹窗打开即隐藏（含平板与编辑器/笔记/分享等场景）；
 *   3) 保留 preview-fullscreen 信号作为额外兜底（订阅 body class 变化）。
 */

import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { useDialogStack } from '@/lib/dialogStack';

/** 订阅 document.body 的 class 变化，判断是否处于预览全屏（保留兜底信号） */
function subscribeBodyClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
function getPreviewFullscreen() {
  return document.body.classList.contains('preview-fullscreen');
}

export function AIChatWidget() {
  const navigate = useNavigate();
  const { hasOpenDialog } = useDialogStack();
  const isPreviewFullscreen = useSyncExternalStore(subscribeBodyClass, getPreviewFullscreen, () => false);

  // 任意弹窗打开或预览全屏时隐藏，彻底消除遮挡（含平板 768–1023px）
  if (hasOpenDialog || isPreviewFullscreen) return null;

  return (
    <button
      onClick={() => navigate('/ai-chat')}
      className="group fixed right-6 z-assistant flex items-center justify-center
        bottom-[calc(5rem+var(--safe-area-inset-bottom))] lg:bottom-6
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
