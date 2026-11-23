/**
 * dialogStack.test.ts — 全局弹窗栈行为守卫
 * 该模块是弹窗滚动锁与浮层显隐的基础设施（A-02/A-16），滚动锁的引用计数
 * 一旦退化成"任一弹窗关闭即解锁"，多弹窗叠加场景会复现线上缺陷，故锁行为必测。
 * dialogStack 是模块级单例：测试共享同一实例，用例需用固定 id 并在 afterEach 清理。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { dialogStack, Z_INDEX, useDialogRegistration, useDialogStack } from './dialogStack';

/** 测试用固定 id；pop 不存在的 id 是 no-op，afterEach 全量清理是安全的 */
const ID_A = 'test-dialog-a';
const ID_B = 'test-dialog-b';

afterEach(() => {
  dialogStack.pop(ID_A);
  dialogStack.pop(ID_B);
});

describe('Z_INDEX 语义层级（AGENTS.md 第 5 节 token 契约）', () => {
  it('层级值与文档约定一致，防止散落魔数', () => {
    expect(Z_INDEX).toEqual({
      base: 0,
      raised: 10,
      dropdown: 25,
      assistant: 30,
      sticky: 40,
      overlay: 50,
      popover: 60,
      toast: 70,
      system: 80,
    });
  });
});

describe('dialogStack 命令式 API', () => {
  it('push 后 hasOpen/has/size 状态正确，pop 后恢复', () => {
    expect(dialogStack.hasOpen()).toBe(false);

    dialogStack.push(ID_A);
    expect(dialogStack.hasOpen()).toBe(true);
    expect(dialogStack.has(ID_A)).toBe(true);
    expect(dialogStack.size()).toBe(1);

    dialogStack.pop(ID_A);
    expect(dialogStack.hasOpen()).toBe(false);
    expect(dialogStack.has(ID_A)).toBe(false);
    expect(dialogStack.size()).toBe(0);
  });

  it('重复 push 同一 id 不入栈两次', () => {
    dialogStack.push(ID_A);
    dialogStack.push(ID_A);
    expect(dialogStack.size()).toBe(1);

    // 一次 pop 即应彻底移除（去重保证）
    dialogStack.pop(ID_A);
    expect(dialogStack.hasOpen()).toBe(false);
  });

  it('pop 不存在的 id 不报错、不影响现有栈', () => {
    dialogStack.push(ID_A);
    dialogStack.pop('never-pushed');
    expect(dialogStack.size()).toBe(1);
    expect(dialogStack.has(ID_A)).toBe(true);
  });

  it('滚动锁按引用计数：关一层不解锁，全关才解锁', () => {
    dialogStack.push(ID_A);
    dialogStack.push(ID_B);
    expect(document.body.style.overflow).toBe('hidden');

    // 只关一层，仍有弹窗在栈内 → 不得解锁
    dialogStack.pop(ID_A);
    expect(document.body.style.overflow).toBe('hidden');

    // 关掉最后一层 → 解锁并恢复原值
    dialogStack.pop(ID_B);
    expect(document.body.style.overflow).toBe('');
  });

  it('滚动锁恢复 push 前的 body overflow 原值', () => {
    document.body.style.overflow = 'scroll';
    dialogStack.push(ID_A);
    expect(document.body.style.overflow).toBe('hidden');
    dialogStack.pop(ID_A);
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
});

describe('useDialogRegistration（React Hook）', () => {
  it('open=true 注册进栈，卸载时自动注销', () => {
    const { unmount } = renderHook(() => useDialogRegistration(true, ID_A));
    expect(dialogStack.has(ID_A)).toBe(true);

    unmount();
    expect(dialogStack.has(ID_A)).toBe(false);
    expect(dialogStack.hasOpen()).toBe(false);
  });

  it('open 切换时同步入栈/出栈', () => {
    const { rerender, unmount } = renderHook(({ open }) => useDialogRegistration(open, ID_A), {
      initialProps: { open: true },
    });
    expect(dialogStack.has(ID_A)).toBe(true);

    rerender({ open: false });
    expect(dialogStack.has(ID_A)).toBe(false);

    rerender({ open: true });
    expect(dialogStack.has(ID_A)).toBe(true);
    unmount();
    expect(dialogStack.has(ID_A)).toBe(false);
  });
});

describe('useDialogStack（订阅）', () => {
  it('hasOpenDialog 随 push/pop 触发重渲染', () => {
    const { result, unmount } = renderHook(() => useDialogStack());
    expect(result.current.hasOpenDialog).toBe(false);

    act(() => result.current.push(ID_A));
    expect(result.current.hasOpenDialog).toBe(true);

    act(() => result.current.pop(ID_A));
    expect(result.current.hasOpenDialog).toBe(false);
    unmount();
  });
});
