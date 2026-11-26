/**
 * useAIChatUi.test.tsx
 * 单 reducer 状态契约：初始值、直接更新、同一事件内连续函数式更新不丢失。
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MODEL_STORAGE_KEY, useAIChatUiState, useUiField } from './useAIChatUi';

describe('useAIChatUiState', () => {
  it('初始会话 ID 来自 URL', () => {
    const { result } = renderHook(() => useAIChatUiState('session-1'));
    expect(result.current.state.currentSessionId).toBe('session-1');
    expect(result.current.state.input).toBe('');
  });

  it('modelId 从 localStorage 恢复', () => {
    localStorage.setItem(MODEL_STORAGE_KEY, 'model-x');
    const { result } = renderHook(() => useAIChatUiState());
    expect(result.current.state.modelId).toBe('model-x');
    localStorage.removeItem(MODEL_STORAGE_KEY);
  });

  it('字段 setter 支持直接赋值', () => {
    const { result } = renderHook(() => {
      const { state, dispatch } = useAIChatUiState();
      const [input, setInput] = useUiField(state, dispatch, 'input');
      return { input, setInput };
    });

    act(() => result.current.setInput('你好'));
    expect(result.current.input).toBe('你好');
  });

  it('同一事件内连续函数式更新全部生效', () => {
    const { result } = renderHook(() => {
      const { state, dispatch } = useAIChatUiState();
      const [mentions, setMentions] = useUiField(state, dispatch, 'mentionedFiles');
      return { mentions, setMentions };
    });

    act(() => {
      result.current.setMentions((prev) => [...prev, { id: '1', name: 'a' }]);
      result.current.setMentions((prev) => [...prev, { id: '2', name: 'b' }]);
    });

    expect(result.current.mentions.map((file) => file.id)).toEqual(['1', '2']);
  });
});
