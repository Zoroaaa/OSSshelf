/**
 * hooks/useOssShelfChat.ts
 * Agents SDK WebSocket 聊天连接
 *
 * 连接策略:
 * - 先通过 REST 换票（2h 有效期），再以固定 query 对象连接，避免 useAgent 因异步 query 反复 suspend
 * - 初始消息交给 useAgentChat 内置逻辑：它在拿到真实 agent URL 后才拉取，并按地址缓存
 * - 未就绪（无用户/会话或被禁用）时不建立连接
 */

import { useEffect, useMemo, useState } from 'react';
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
  ready: boolean;
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
  const [ticket, setTicket] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTicket(null);
    if (!active || !sessionId) return;

    aiApi.chatSession.wsTicket(sessionId).then((result) => {
      if (!cancelled) setTicket(result?.ticket ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [active, sessionId]);

  const query = useMemo(() => (ticket ? { ticket } : undefined), [ticket]);

  const agent = useAgent({
    agent: 'OSSShelfAgent',
    name: active ? `${userId}:${sessionId}` : undefined,
    host,
    enabled: active && Boolean(ticket),
    query,
  });

  // 50ms 批量刷新：流式 token 不再逐块触发整页重渲染
  const chat = useAgentChat({ agent, experimental_throttle: 50 });

  return {
    identified: agent.identified,
    ready: Boolean(ticket),
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
