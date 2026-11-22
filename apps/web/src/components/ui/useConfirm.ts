/**
 * useConfirm.ts
 * 全局确认服务（审查报告 A-19 / A-20 / D-02 / D-27 的基础设施）
 *
 * 用命令式 Promise 替代散落全站的原生 window.confirm / alert：
 *   const ok = await confirmAction({ title: '删除文件？', level: 'danger' });
 *   if (!ok) return;
 *
 * 风险分级：
 *   info     普通提示
 *   warn     需二次确认（默认）
 *   danger   危险操作，确认按钮为红色
 *   critical 灾难性操作（清空向量库/群发邮件等），需输入指定文本才可确认，并展示影响摘要
 *
 * <GlobalConfirmDialog /> 需挂载在应用根节点（App.tsx）。
 */

import { create } from 'zustand';

export type ConfirmLevel = 'info' | 'warn' | 'danger' | 'critical';

export interface ConfirmOptions {
  /** 标题 */
  title: string;
  /** 说明正文 */
  description?: string;
  /** 影响范围摘要（critical 级必填，如"将删除 120 个文件，不可恢复"） */
  impact?: string;
  /** 确认按钮文案 */
  confirmText?: string;
  /** 取消按钮文案 */
  cancelText?: string;
  /** 风险级别，默认 warn */
  level?: ConfirmLevel;
  /** critical 级要求用户输入的确认文本 */
  requireInput?: string;
}

interface ConfirmState {
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
  open: (options: ConfirmOptions) => Promise<boolean>;
  close: (value: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  options: null,
  resolve: null,
  open: (options) =>
    new Promise<boolean>((resolve) => {
      set({ options, resolve });
    }),
  close: (value) => {
    const { resolve } = get();
    set({ options: null, resolve: null });
    resolve?.(value);
  },
}));

/** 命令式调用入口：await confirmAction({...}) */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().open(options);
}

/** 兼容旧代码习惯的别名 */
export const confirmDialog = confirmAction;
