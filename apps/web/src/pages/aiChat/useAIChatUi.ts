/**
 * pages/aiChat/useAIChatUi.ts
 * AI 对话页的单一 UI 状态源（useReducer）。
 *
 * 收敛前：19 个 useState 散落在 AIChat.tsx，切换会话/重连/审批时容易出现
 * 「一半状态更新、一半没更新」；这里把状态集中到一个 reducer，
 * 组件通过 useUiField 拿到与 useState 同签名的 setter，避免大范围改写调用点。
 */

import { useCallback, useReducer } from 'react';
import type { SetStateAction } from 'react';
import type { FileItem } from '@osshelf/shared';
import type { Message } from '@/components/ai/types';

export const MODEL_STORAGE_KEY = 'osshelf:chat-model';

export interface MentionFile {
  id: string;
  name: string;
}

export interface QuotedMessage {
  content: string;
  role: 'user' | 'assistant';
}

export interface ContextMenuState {
  x: number;
  y: number;
  message: Message;
}

export interface PendingAgentSend {
  text: string;
  body: Record<string, unknown>;
  files: MentionFile[];
}

export interface AIChatUiState {
  input: string;
  currentSessionId: string | null;
  showSidebar: boolean;
  copiedId: string | null;
  renamingId: string | null;
  renameValue: string;
  previewFile: FileItem | null;
  showToolInfo: boolean;
  quotedMessage: QuotedMessage | null;
  contextMenu: ContextMenuState | null;
  sendError: string | null;
  dismissedError: boolean;
  exporting: boolean;
  showScrollDown: boolean;
  resumingRun: boolean;
  uploading: boolean;
  mentionedFiles: MentionFile[];
  modelId: string;
  pendingAgentSend: PendingAgentSend | null;
}

export function createInitialAIChatUiState(): AIChatUiState {
  return {
    input: '',
    currentSessionId: null,
    showSidebar: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
    copiedId: null,
    renamingId: null,
    renameValue: '',
    previewFile: null,
    showToolInfo: false,
    quotedMessage: null,
    contextMenu: null,
    sendError: null,
    dismissedError: false,
    exporting: false,
    showScrollDown: false,
    resumingRun: false,
    uploading: false,
    mentionedFiles: [],
    modelId: typeof window !== 'undefined' ? (localStorage.getItem(MODEL_STORAGE_KEY) ?? '') : '',
    pendingAgentSend: null,
  };
}

type Action =
  | { type: 'set'; key: keyof AIChatUiState; value: unknown }
  | { type: 'update'; key: keyof AIChatUiState; updater: (prev: unknown) => unknown };

function reducer(state: AIChatUiState, action: Action): AIChatUiState {
  if (action.type === 'update') {
    return { ...state, [action.key]: action.updater(state[action.key]) };
  }
  return { ...state, [action.key]: action.value };
}

export function useAIChatUiState(initialSessionId: string | null = null): {
  state: AIChatUiState;
  dispatch: React.Dispatch<Action>;
} {
  const [state, dispatch] = useReducer(reducer, initialSessionId, (sessionId) => ({
    ...createInitialAIChatUiState(),
    currentSessionId: sessionId,
  }));
  return { state, dispatch };
}

/**
 * 与 useState 同签名的字段 setter。
 * 函数式更新交给 reducer 在最新 state 上执行，避免同一事件里连续更新拿到旧值。
 */
export function useUiField<K extends keyof AIChatUiState>(
  state: AIChatUiState,
  dispatch: React.Dispatch<Action>,
  key: K
): [AIChatUiState[K], (value: SetStateAction<AIChatUiState[K]>) => void] {
  const setValue = useCallback(
    (value: SetStateAction<AIChatUiState[K]>) => {
      if (typeof value === 'function') {
        dispatch({ type: 'update', key, updater: value as (prev: unknown) => unknown });
        return;
      }
      dispatch({ type: 'set', key, value });
    },
    [dispatch, key]
  );

  return [state[key], setValue];
}
