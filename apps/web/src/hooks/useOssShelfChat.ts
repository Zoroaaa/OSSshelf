/**
 * hooks/useOssShelfChat.ts
 * Agents SDK WebSocket 聊天连接
 *
 * - 通过 /api/ai-chat/ws-ticket 换取 60s 票据
 * - useAgent 负责连接与自动重连；useAgentChat 负责消息、流式、审批
 * - 未开启 Agent 运行时（enabled=false）时不建立连接
 */

import { useMemo } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import type { UIMessage } from 'ai';
import { aiApi } from '@/services/ai';

interface UseOssShelfChatOptions {
  userId?: string | null;
  sessionId?: string | null;
  enabled: boolean;
}

interface OssShelfChatHandle {
  identified: boolean;
  messages: UIMessage[];
  status: string;
  isStreaming: boolean;
  isRecovering: boolean;
  error: Error | undefined;
  sendMessage: (message: { text: string }, options?: { body?: object }) => Promise<void> | void;
  regenerate: (options?: { body?: object }) => Promise<void> | void;
  stop: () => void;
  addToolApprovalResponse: (options: { id: string; approved: boolean }) => void;
}

function toHost(value: string): string {
  return value
    .replace(/^wss?:\/\//, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

function resolveWsHost(): string {
  const configuredWs = import.meta.env.VITE_WS_URL;
  if (typeof configuredWs === 'string' && configuredWs.length > 0) {
    return toHost(configuredWs);
  }

  // 前后端分离部署时必须使用 API 域名，否则 /agents/* 会落到前端 Pages 的 SPA 回退
  const apiUrl = import.meta.env.VITE_API_URL;
  if (typeof apiUrl === 'string' && apiUrl.length > 0) {
    return toHost(apiUrl);
  }

  return window.location.host;
}

export function useOssShelfChat({ userId, sessionId, enabled }: UseOssShelfChatOptions): OssShelfChatHandle {
  const active = Boolean(enabled && userId && sessionId);
  const host = useMemo(resolveWsHost, []);

  const agent = useAgent({
    agent: 'OSSShelfAgent',
    name: active ? `${userId}:${sessionId}` : undefined,
    host,
    enabled: active,
    query: async () => {
      if (!sessionId) return { ticket: '' };
      const ticket = await aiApi.chatSession.wsTicket(sessionId);
      return { ticket: ticket?.ticket ?? '' };
    },
    queryDeps: [sessionId],
    cacheTtl: 50_000,
  });

  const chat = useAgentChat({ agent });

  return {
    identified: agent.identified,
    messages: chat.messages,
    status: chat.status,
    isStreaming: chat.isStreaming,
    isRecovering: chat.isRecovering,
    error: chat.error,
    sendMessage: chat.sendMessage,
    regenerate: chat.regenerate,
    stop: chat.stop,
    addToolApprovalResponse: chat.addToolApprovalResponse,
  };
}
