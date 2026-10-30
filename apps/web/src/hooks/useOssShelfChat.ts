/**
 * hooks/useOssShelfChat.ts
 * Agents SDK WebSocket 聊天连接
 *
 * 连接策略:
 * - 先通过 REST 换票（2h 有效期，按会话缓存复用），再以固定 query 对象连接
 * - 初始消息由本层自行拉取（getInitialMessages: null + messages 注入），
 *   避免 SDK 内部 use(promise) 在切换会话时触发整页 Suspense 空白
 * - 未就绪（无用户/会话或被禁用）时不建立连接
 * - 换票失败/连接未建立时向上暴露错误，并提供手动重连入口
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  /** 已连接且身份与当前会话一致，可安全发送消息 */
  connected: boolean;
  ready: boolean;
  /** 当前会话历史仍在首次加载中（无缓存可先展示） */
  isHydrating: boolean;
  messages: UIMessage[];
  status: string;
  isStreaming: boolean;
  isServerStreaming: boolean;
  isRecovering: boolean;
  isToolContinuation: boolean;
  /** 模型/流错误 */
  error: Error | undefined;
  /** 连接或换票错误 */
  connectionError: Error | null;
  sendMessage: (message: { text: string }, options?: { body?: object }) => Promise<void> | void;
  regenerate: (options?: { body?: object }) => Promise<void> | void;
  stop: () => void;
  addToolApprovalResponse: (options: { id: string; approved: boolean }) => void;
  /** 仅清空本地消息视图（服务端记录不受影响） */
  clearMessages: () => void;
  /** 清空服务端会话历史（慎用） */
  clearHistory: () => void;
  /** 重新换票并重连 */
  retryConnection: () => void;
}

const EMPTY_MESSAGES: UIMessage[] = [];
const TICKET_REFRESH_MARGIN_MS = 2 * 60_000;
// 票据本身 2h 有效，但本地只缓存 10 分钟：既省掉切换会话的换票往返，又能在密钥轮换后自愈
const TICKET_CACHE_MAX_AGE_MS = 10 * 60_000;
const DEFAULT_TICKET_TTL_MS = 2 * 60 * 60_000;
const TICKET_RETRY_DELAYS_MS = [600, 1500];
const CONNECT_TIMEOUT_MS = 9_000;

const ticketCache = new Map<string, { ticket: string; expiresAt: number }>();

function readCachedTicket(name: string): string | null {
  const entry = ticketCache.get(name);
  if (!entry) return null;
  if (entry.expiresAt - Date.now() <= TICKET_REFRESH_MARGIN_MS) {
    ticketCache.delete(name);
    return null;
  }
  return entry.ticket;
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

/** 会话消息缓存键（新建会话时用于预置空消息，避免多余的历史请求） */
export function agentMessagesKey(userId: string | null | undefined, sessionId: string | null | undefined) {
  return ['agent-messages', userId ?? null, sessionId ?? null] as const;
}

/** 复用 Agent 自身 URL（含正确的命名空间与票据），拼出 get-messages 地址 */
async function fetchAgentMessages(agentHttpUrl: string, ticket: string): Promise<UIMessage[]> {
  const url = new URL(agentHttpUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/get-messages`;
  if (!url.searchParams.get('ticket')) url.searchParams.set('ticket', ticket);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`加载会话消息失败（HTTP ${res.status}）`);

  const text = await res.text();
  if (!text.trim()) return EMPTY_MESSAGES;

  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed as UIMessage[]) : EMPTY_MESSAGES;
}

function toError(value: unknown): Error | undefined {
  if (!value) return undefined;
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  const message = (value as { message?: unknown }).message;
  return new Error(typeof message === 'string' ? message : '会话连接异常');
}

export function useOssShelfChat({ userId, sessionId, enabled }: UseOssShelfChatOptions): OssShelfChatHandle {
  const active = Boolean(enabled && userId && sessionId);
  const agentName = active ? `${userId}:${sessionId}` : null;
  const host = useMemo(resolveWsHost, []);
  const queryClient = useQueryClient();

  const [retryNonce, setRetryNonce] = useState(0);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const retryConnection = useCallback(() => {
    if (agentName) ticketCache.delete(agentName);
    setTicketError(null);
    setRetryNonce((value) => value + 1);
  }, [agentName]);

  // 票据与会话绑定：切换会话时绝不复用上一个会话的票据
  const [ticketState, setTicketState] = useState<{ name: string; ticket: string } | null>(null);
  const ticket =
    (agentName ? readCachedTicket(agentName) : null) ?? (ticketState?.name === agentName ? ticketState.ticket : null);

  useEffect(() => {
    if (!agentName || !sessionId) {
      setTicketError(null);
      return;
    }
    if (readCachedTicket(agentName)) {
      setTicketError(null);
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let timer: number | undefined;

    const load = async () => {
      try {
        const result = await aiApi.chatSession.wsTicket(sessionId);
        if (cancelled) return;
        if (!result?.ticket) throw new Error('无法获取会话连接票据');

        const ticketTtl =
          typeof result.expiresIn === 'number' && result.expiresIn > 0
            ? result.expiresIn * 1000
            : DEFAULT_TICKET_TTL_MS;
        const expiresAt = Date.now() + Math.min(ticketTtl, TICKET_CACHE_MAX_AGE_MS);
        ticketCache.set(agentName, { ticket: result.ticket, expiresAt });
        setTicketState({ name: agentName, ticket: result.ticket });
        setTicketError(null);
      } catch (error) {
        if (cancelled) return;
        if (attempt < TICKET_RETRY_DELAYS_MS.length) {
          timer = window.setTimeout(() => void load(), TICKET_RETRY_DELAYS_MS[attempt]);
          attempt++;
          return;
        }
        setTicketError(error instanceof Error ? error.message : '连接会话失败');
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [agentName, sessionId, retryNonce]);

  const query = useMemo(() => (ticket ? { ticket } : undefined), [ticket]);

  const agent = useAgent({
    agent: 'OSSShelfAgent',
    name: agentName ?? undefined,
    host,
    enabled: Boolean(agentName && ticket),
    query,
  });

  // 历史消息自行拉取（与 WS 连接并行）：命中缓存时立即展示，后台再刷新
  const agentHttpUrl = agentName && ticket ? agent.getHttpUrl() : '';
  const messagesQuery = useQuery<UIMessage[]>({
    queryKey: agentMessagesKey(userId, sessionId),
    queryFn: () => {
      if (!agentHttpUrl || !ticket) throw new Error('会话尚未就绪');
      return fetchAgentMessages(agentHttpUrl, ticket);
    },
    enabled: Boolean(agentName && ticket && agentHttpUrl),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // getInitialMessages: null —— 禁用 SDK 内部的初始消息 fetch，改为注入 messages，
  // 否则每次连接/切换会话都会 use(promise) 挂起，整页被 Suspense 置空
  const chat = useAgentChat({
    agent,
    messages: messagesQuery.data ?? EMPTY_MESSAGES,
    getInitialMessages: null,
    syncMessagesToServer: false,
    experimental_throttle: 50,
  });

  const setChatMessages = chat.setMessages;

  // 历史消息晚于 Chat 实例到达时补入：只补缺失消息，绝不覆盖正在流式的内容
  useEffect(() => {
    if (!agentName || !messagesQuery.data) return;
    const hydrated = messagesQuery.data;
    const current = chat.messages;
    if (current.length === 0) {
      setChatMessages(hydrated);
      return;
    }
    const knownIds = new Set(current.map((message) => message.id));
    const missing = hydrated.filter((message) => !knownIds.has(message.id));
    if (missing.length === 0) return;
    setChatMessages([...missing, ...current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName, messagesQuery.data, setChatMessages]);

  // 一轮对话结束后把完整消息写回缓存，切回该会话时可立即显示
  useEffect(() => {
    if (!agentName || !sessionId || !messagesQuery.data) return;
    if (!agent.identified || agent.name !== agentName) return;
    if (chat.isStreaming || chat.isRecovering) return;
    if (chat.messages.length === 0) return;
    const key = agentMessagesKey(userId, sessionId);
    if (queryClient.getQueryData(key) === chat.messages) return;
    queryClient.setQueryData(key, chat.messages);
  }, [
    agentName,
    sessionId,
    userId,
    messagesQuery.data,
    agent.identified,
    agent.name,
    chat.isStreaming,
    chat.isRecovering,
    chat.messages,
    queryClient,
  ]);

  // 连接超时自愈：票据有效但 9s 内未完成身份识别，自动重新换票一次
  const autoRetriedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!agentName || !ticket) return;
    if (agent.identified) {
      autoRetriedRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => {
      if (!agent.identified && autoRetriedRef.current !== agentName) {
        autoRetriedRef.current = agentName;
        retryConnection();
      }
    }, CONNECT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [agentName, ticket, agent.identified, retryConnection]);

  const connectionError = useMemo(() => {
    const sdkError = toError(chat.connectionError);
    if (sdkError) return sdkError;
    if (ticketError) return new Error(ticketError);
    if (messagesQuery.error) return toError(messagesQuery.error) ?? null;
    return null;
  }, [chat.connectionError, ticketError, messagesQuery.error]);

  return {
    identified: agent.identified,
    connected: Boolean(agentName && agent.identified && agent.name === agentName),
    ready: Boolean(ticket),
    isHydrating: Boolean(agentName && ticket) && messagesQuery.isPending,
    messages: chat.messages,
    status: chat.status,
    isStreaming: Boolean(chat.isStreaming || chat.isServerStreaming),
    isServerStreaming: Boolean(chat.isServerStreaming),
    isRecovering: chat.isRecovering,
    isToolContinuation: chat.isToolContinuation,
    error: toError(chat.error),
    connectionError,
    sendMessage: chat.sendMessage,
    regenerate: chat.regenerate,
    stop: chat.stop,
    addToolApprovalResponse: chat.addToolApprovalResponse,
    clearMessages: () => chat.setMessages([]),
    clearHistory: () => chat.clearHistory(),
    retryConnection,
  };
}
