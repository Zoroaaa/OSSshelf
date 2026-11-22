/**
 * dialogStack.ts
 * 全局弹窗栈（审查报告 A-02 / A-03 / A-16 / P0-01 的基础设施）
 *
 * 设计目标：
 * - 统一管理"当前是否有弹窗打开"，供 AI 悬浮按钮(FAB)、PWA 提示等浮层订阅，
 *   从而替代 AIChatWidget 里脆弱的 MutationObserver + preview-fullscreen 单一信号。
 * - 统一管理 body 滚动锁（引用计数），解决多个弹窗叠加时"关闭任一层即解锁"的缺陷。
 * - 提供语义化层级常量，禁止散落 z-[100]/z-[9999] 魔数。
 *
 * 使用方式：
 *   const { push, pop } = useDialogStack();           // 组件内订阅 hasOpenDialog
 *   useEffect(() => push(id), [id]); return () => pop(id);
 * 或者命令式：
 *   dialogStack.push(id); dialogStack.pop(id);         // 非 React 环境
 */

import { useEffect, useSyncExternalStore } from 'react';

export const Z_INDEX = {
  base: 0,
  raised: 10,
  dropdown: 25,
  assistant: 30,
  sticky: 40,
  overlay: 50,
  popover: 60,
  toast: 70,
  system: 80,
} as const;

type Listener = () => void;

class DialogStack {
  /** 当前打开的弹窗 id 集合（用 Set 避免重复 push） */
  private stack: string[] = [];
  private listeners = new Set<Listener>();
  /** body 原始 overflow 值，用于精确恢复 */
  private originalOverflow: string | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** 弹窗打开时调用 */
  push = (id: string) => {
    if (this.stack.includes(id)) return;
    const wasEmpty = this.stack.length === 0;
    this.stack.push(id);
    if (wasEmpty) this.lockScroll();
    this.emit();
  };

  /** 弹窗关闭时调用 */
  pop = (id: string) => {
    const idx = this.stack.indexOf(id);
    if (idx === -1) return;
    this.stack.splice(idx, 1);
    if (this.stack.length === 0) this.unlockScroll();
    this.emit();
  };

  hasOpen = (): boolean => this.stack.length > 0;

  /** 是否存在指定弹窗 */
  has = (id: string): boolean => this.stack.includes(id);

  /** 当前栈大小（调试用） */
  size = (): number => this.stack.length;

  private lockScroll() {
    if (this.originalOverflow === null) {
      this.originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  }

  private unlockScroll() {
    if (this.originalOverflow !== null) {
      document.body.style.overflow = this.originalOverflow;
      this.originalOverflow = null;
    }
  }
}

/** 单例：整个应用共享一个弹窗栈 */
export const dialogStack = new DialogStack();

/** React Hook：订阅全局弹窗栈，弹窗开关时触发重渲染 */
export function useDialogStack() {
  const hasOpenDialog = useSyncExternalStore(
    dialogStack.subscribe,
    dialogStack.hasOpen,
    () => false // SSR 快照
  );
  return {
    hasOpenDialog,
    push: dialogStack.push,
    pop: dialogStack.pop,
  };
}

/**
 * 便捷 Hook：在弹窗组件中调用，自动注册/注销到全局栈（含卸载清理）。
 * 解决"弹窗在打开状态下随路由跳转被卸载时滚动锁永不释放"的缺陷（A-16）。
 *
 * @param open 弹窗是否打开
 * @param id   弹窗唯一标识（建议用组件名 + 业务 id）
 */
export function useDialogRegistration(open: boolean, id: string) {
  useEffect(() => {
    if (!open) return;
    dialogStack.push(id);
    return () => dialogStack.pop(id);
  }, [open, id]);
}
