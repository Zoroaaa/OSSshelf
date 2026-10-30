/**
 * AIChat.tsx - AI 文件管理智能体对话页面
 *
 * 职责：
 * - 组合会话列表 / 头部 / 消息区 / 输入区
 * - 会话生命周期（新建、切换、重命名、删除、导出、自动标题）
 * - 乐观消息、上下文文件、引用消息、错误与连接状态
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Copy, Loader2, Reply } from 'lucide-react';
import { aiApi, filesApi } from '@/services/api';
import { FilePreview } from '@/components/files/FilePreview';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/components/ui/useToast';
import type { FileItem } from '@osshelf/shared';
import {
  ChatHeader,
  ChatSidebar,
  Composer,
  ErrorBanner,
  MessageBubble,
  StatusStrip,
  ToolInfoModal,
  WelcomeScreen,
} from '@/components/ai/chat';
import { TOOL_META } from '@/components/ai/chat/toolMeta';
import type { Message } from '@/components/ai/types';
import { useOssShelfChat, agentMessagesKey } from '@/hooks/useOssShelfChat';
import { mapUIMessages } from '@/utils/agentMessages';

const PENDING_MESSAGE_ID = 'pending-user-message';
const MAX_QUERY_LENGTH = 15000;
const MODEL_STORAGE_KEY = 'osshelf:chat-model';
const PENDING_CONNECT_TIMEOUT_MS = 10_000;

const SUGGESTED = [
  '帮我找最近上传的文件',
  '查看我的存储统计',
  '有哪些带有"项目"标签的文件？',
  '列出根目录的内容',
  '我收藏了哪些文件？',
  '帮我创建一个备忘录文件，内容是明天要去开会',
  '帮我把这段代码保存到代码文件夹',
  '查看我分享了哪些文件',
];

interface QuotedMessage {
  content: string;
  role: 'user' | 'assistant';
}

interface ContextMenuState {
  x: number;
  y: number;
  message: Message;
}

export function AIChat() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const contextFolderId = searchParams.get('folderId') || undefined;
  const queryClient = useQueryClient();
  const { token, user } = useAuthStore();
  const { toast } = useToast();

  const [input, setInput] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(urlSessionId ?? null);
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 1024);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [showToolInfo, setShowToolInfo] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState<QuotedMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const [mentionedFiles, setMentionedFiles] = useState<Array<{ id: string; name: string }>>([]);
  const mentionedFilesRef = useRef<Array<{ id: string; name: string }>>([]);

  const [modelId, setModelId] = useState<string>(() => localStorage.getItem(MODEL_STORAGE_KEY) ?? '');

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const prevSessionIdRef = useRef<string | null>(null);
  const wasStreamingRef = useRef(false);
  const titleGeneratedRef = useRef<Set<string>>(new Set());

  const agent = useOssShelfChat({
    userId: user?.id,
    sessionId: currentSessionId,
    enabled: true,
  });

  const [pendingAgentSend, setPendingAgentSend] = useState<{
    text: string;
    body: Record<string, unknown>;
    files: Array<{ id: string; name: string }>;
  } | null>(null);

  // ═══ 展示层消息：历史 + 乐观消息 ═══
  const displayMessages = useMemo<Message[]>(() => {
    const mapped = mapUIMessages(agent.messages, { streaming: agent.isStreaming });
    if (!pendingAgentSend) return mapped;
    return [
      ...mapped,
      {
        id: PENDING_MESSAGE_ID,
        role: 'user' as const,
        content: pendingAgentSend.text,
        timestamp: new Date(),
        isLoading: true,
        pending: true,
        mentionedFiles: pendingAgentSend.files.length > 0 ? pendingAgentSend.files : undefined,
      },
    ];
  }, [agent.messages, agent.isStreaming, pendingAgentSend]);

  const sessionLoading =
    Boolean(currentSessionId) && displayMessages.length === 0 && (agent.isHydrating || !agent.ready);

  const isLoading = Boolean(
    pendingAgentSend ||
    agent.isStreaming ||
    agent.isRecovering ||
    agent.status === 'submitted' ||
    agent.status === 'streaming'
  );

  // ═══ 会话数据 ═══
  const { data: sessions = [] } = useQuery({
    queryKey: ['ai-chat-sessions'],
    queryFn: () => aiApi.chatSession.getSessions().then((r) => r.data.data ?? []),
    staleTime: 30_000,
  });

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId),
    [sessions, currentSessionId]
  );

  const { data: models = [] } = useQuery({
    queryKey: ['ai-chat-models'],
    queryFn: () => aiApi.config.getModels('chat').then((r) => r.data.data ?? []),
    staleTime: 60_000,
  });

  const modelOptions = useMemo(
    () => models.filter((model) => model.isActive !== false).map((model) => ({ id: model.id, name: model.name })),
    [models]
  );

  const effectiveModelId = useMemo(() => {
    if (modelId && modelOptions.some((model) => model.id === modelId)) return modelId;
    const preferred = currentSession?.modelId;
    if (preferred && modelOptions.some((model) => model.id === preferred)) return preferred;
    return modelOptions[0]?.id ?? '';
  }, [modelId, modelOptions, currentSession?.modelId]);

  const { data: contextFolder } = useQuery({
    queryKey: ['context-folder', contextFolderId],
    queryFn: () => {
      if (!contextFolderId) throw new Error('缺少文件夹上下文');
      return filesApi.get(contextFolderId).then((r) => r.data.data);
    },
    enabled: Boolean(contextFolderId),
    staleTime: 60_000,
  });

  // ═══ 发送：连接就绪后把乐观消息交给 Agent ═══
  const agentConnected = agent.connected;
  const agentSendMessage = agent.sendMessage;
  useEffect(() => {
    if (!agentConnected || !pendingAgentSend || !currentSessionId) return;
    const payload = pendingAgentSend;
    setPendingAgentSend(null);
    void agentSendMessage({ text: payload.text }, { body: payload.body });
  }, [agentConnected, agentSendMessage, pendingAgentSend, currentSessionId]);

  // 连接超时：避免乐观消息永远停在"正在连接"
  useEffect(() => {
    if (!pendingAgentSend || !currentSessionId) return;
    const timer = window.setTimeout(() => {
      setPendingAgentSend(null);
      setSendError('会话连接超时，请检查网络后重新发送');
    }, PENDING_CONNECT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pendingAgentSend, currentSessionId]);

  // 流结束：刷新会话列表 + 首次对话自动生成标题
  useEffect(() => {
    if (agent.isStreaming) {
      wasStreamingRef.current = true;
      return;
    }
    if (!wasStreamingRef.current) return;
    wasStreamingRef.current = false;

    queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });

    if (!currentSessionId || titleGeneratedRef.current.has(currentSessionId)) return;
    if (displayMessages.length > 3) return;

    titleGeneratedRef.current.add(currentSessionId);
    aiApi.chatSession
      .generateTitle(currentSessionId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] }))
      .catch(() => {
        // 标题生成失败保留原会话标题
      });
  }, [agent.isStreaming, queryClient, currentSessionId, displayMessages.length]);

  // ═══ 滚动：只有贴近底部时才自动跟随 ═══
  useEffect(() => {
    if (!autoScrollRef.current) {
      setShowScrollDown(true);
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: agent.isStreaming ? 'auto' : 'smooth' });
    setShowScrollDown(false);
  }, [displayMessages, agent.isStreaming]);

  useEffect(() => {
    if (prevSessionIdRef.current && prevSessionIdRef.current !== currentSessionId) {
      const container = messagesContainerRef.current;
      if (container) scrollPositionsRef.current.set(prevSessionIdRef.current, container.scrollTop);
    }
    prevSessionIdRef.current = currentSessionId;

    const container = messagesContainerRef.current;
    const saved = currentSessionId ? scrollPositionsRef.current.get(currentSessionId) : undefined;
    if (container && saved !== undefined) {
      requestAnimationFrame(() => {
        container.scrollTop = saved;
      });
    }
    autoScrollRef.current = true;
    setShowScrollDown(false);
  }, [currentSessionId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (urlSessionId && urlSessionId !== currentSessionId) setCurrentSessionId(urlSessionId);
  }, [urlSessionId, currentSessionId]);

  // ═══ 文件预览 ═══
  const handleFileClick = useCallback(
    async (fileId: string, isFolder: boolean) => {
      if (isFolder) {
        navigate(`/files/${fileId}`);
        return;
      }
      try {
        const res = await filesApi.get(fileId);
        if (res.data?.data) setPreviewFile(res.data.data);
      } catch {
        navigate(`/files?preview=${fileId}`);
      }
    },
    [navigate]
  );

  // ═══ 引用 / 右键菜单 ═══
  const handleContextMenu = useCallback((event: React.MouseEvent, message: Message) => {
    event.preventDefault();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 110),
      message,
    });
  }, []);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, []);

  const handleQuote = useCallback((message: Message | QuotedMessage) => {
    setQuotedMessage({ content: message.content, role: message.role });
    setContextMenu(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // ═══ 发送 ═══
  const sendMessage = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query || isLoading || sessionLoading) return;

      if (query.length > MAX_QUERY_LENGTH) {
        toast({
          title: '输入过长',
          description: `消息长度不能超过 ${MAX_QUERY_LENGTH} 字符，当前 ${query.length} 字符`,
          variant: 'destructive',
        });
        return;
      }

      const finalQuery = quotedMessage
        ? `[引用 · ${quotedMessage.role === 'assistant' ? '助手' : '你'}]: ${quotedMessage.content}\n\n${query}`
        : query;

      const currentMentions = [...mentionedFilesRef.current];
      const body: Record<string, unknown> = {
        contextFolderId: contextFolderId ?? null,
        contextFileIds: currentMentions.length > 0 ? currentMentions.map((file) => file.id) : undefined,
        modelId: effectiveModelId || undefined,
      };

      setInput('');
      setMentionedFiles([]);
      mentionedFilesRef.current = [];
      setQuotedMessage(null);
      setSendError(null);
      setDismissedError(false);
      if (inputRef.current) inputRef.current.style.height = 'auto';
      setPendingAgentSend({ text: finalQuery, body, files: currentMentions });

      if (currentSessionId) return;

      try {
        const sessionId = crypto.randomUUID();
        await aiApi.chatSession.createSession({
          id: sessionId,
          title: finalQuery.slice(0, 50),
          modelId: effectiveModelId || undefined,
        });
        queryClient.setQueryData(agentMessagesKey(user?.id, sessionId), []);
        setCurrentSessionId(sessionId);
        if (!urlSessionId) navigate(`/ai-chat/${sessionId}`, { replace: true });
        queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
      } catch (error) {
        setPendingAgentSend(null);
        setSendError(error instanceof Error ? error.message : '无法创建会话');
      }
    },
    [
      isLoading,
      sessionLoading,
      currentSessionId,
      urlSessionId,
      navigate,
      queryClient,
      user?.id,
      contextFolderId,
      quotedMessage,
      toast,
      effectiveModelId,
    ]
  );

  const handleConfirm = useCallback(
    (confirmId: string) => {
      agent.addToolApprovalResponse({ id: confirmId, approved: true });
    },
    [agent]
  );

  const handleCancelConfirm = useCallback(
    (confirmId?: string) => {
      if (!confirmId) return;
      agent.addToolApprovalResponse({ id: confirmId, approved: false });
    },
    [agent]
  );

  const handleRegenerate = () => {
    agent.regenerate();
  };

  const handleNewChat = () => {
    setPendingAgentSend(null);
    setCurrentSessionId(null);
    agent.clearMessages();
    if (urlSessionId) navigate('/ai-chat');
  };

  const handleSelectSession = (id: string) => {
    if (id === currentSessionId) return;
    setPendingAgentSend(null);
    setCurrentSessionId(id);
    navigate(`/ai-chat/${id}`);
    if (window.innerWidth < 1024) setShowSidebar(false);
  };

  const handleClearAllSessions = async () => {
    try {
      const response = await aiApi.chatSession.deleteAllSessions();
      for (const session of sessions) {
        queryClient.removeQueries({ queryKey: agentMessagesKey(user?.id, session.id) });
      }
      agent.clearMessages();
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
      handleNewChat();
      toast({ title: '已清空', description: `共删除 ${response.data.data?.deleted ?? 0} 个对话` });
    } catch (error) {
      toast({
        title: '清空失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteSession = async (_event: React.MouseEvent, id: string) => {
    try {
      await aiApi.chatSession.deleteSession(id);
      queryClient.removeQueries({ queryKey: agentMessagesKey(user?.id, id) });
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
      if (currentSessionId === id) handleNewChat();
      toast({ title: '删除成功', description: '会话已删除' });
    } catch (error) {
      toast({
        title: '删除失败',
        description: error instanceof Error ? error.message : '无法删除会话',
        variant: 'destructive',
      });
    }
  };

  const handleConfirmRename = async (id: string) => {
    const value = renameValue.trim();
    if (value) {
      try {
        await aiApi.chatSession.updateSession(id, { title: value });
        queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
      } catch {
        toast({ title: '重命名失败', variant: 'destructive' });
      }
    }
    setRenamingId(null);
  };

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExport = async () => {
    if (!currentSessionId || exporting) return;
    setExporting(true);
    try {
      const response = await aiApi.chatSession.exportMarkdown(currentSessionId);
      const blob = new Blob([response.data], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(currentSession?.title || '对话记录').replace(/[\\/:*?"<>|]/g, '_')}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: '导出失败',
        description: error instanceof Error ? error.message : '无法导出会话',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleModelChange = (value: string) => {
    setModelId(value);
    localStorage.setItem(MODEL_STORAGE_KEY, value);
  };

  const handleAddMention = useCallback((file: { id: string; name: string }) => {
    setMentionedFiles((prev) => {
      if (prev.some((item) => item.id === file.id)) return prev;
      const next = [...prev, file];
      mentionedFilesRef.current = next;
      return next;
    });
  }, []);

  const handleRemoveMention = useCallback((id: string) => {
    setMentionedFiles((prev) => {
      const next = prev.filter((file) => file.id !== id);
      mentionedFilesRef.current = next;
      return next;
    });
  }, []);

  const lastAssistantIndex = displayMessages.reduce(
    (last, message, index) => (message.role === 'assistant' ? index : last),
    -1
  );

  const errorMessage = sendError || agent.error?.message || agent.connectionError?.message;

  // 新的错误内容出现时重新展示提示条（用户此前手动关闭过的旧提示保持关闭）
  useEffect(() => {
    if (errorMessage) setDismissedError(false);
  }, [errorMessage]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <ChatSidebar
        showSidebar={showSidebar}
        sessions={sessions}
        currentSessionId={currentSessionId}
        renamingId={renamingId}
        renameValue={renameValue}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onClearAllSessions={handleClearAllSessions}
        onStartRename={(session) => {
          setRenamingId(session.id);
          setRenameValue(session.title);
        }}
        onConfirmRename={handleConfirmRename}
        onCancelRename={() => setRenamingId(null)}
        onRenameValueChange={setRenameValue}
        onCloseMobile={() => setShowSidebar(false)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader
          title={currentSession?.title}
          toolCount={Object.keys(TOOL_META).length}
          onShowToolInfo={() => setShowToolInfo(true)}
          showSidebar={showSidebar}
          onToggleSidebar={() => setShowSidebar((value) => !value)}
          models={modelOptions}
          modelId={effectiveModelId}
          onModelChange={handleModelChange}
          onExport={currentSessionId ? handleExport : undefined}
          exporting={exporting}
          connected={agent.connected}
        />

        {errorMessage && !dismissedError && (
          <ErrorBanner
            message={errorMessage}
            onRetry={() => {
              agent.retryConnection();
            }}
            onDismiss={() => setDismissedError(true)}
          />
        )}

        <StatusStrip
          connected={agent.connected}
          ready={agent.ready}
          isRecovering={agent.isRecovering}
          contextFolderName={contextFolder ? contextFolder.name : contextFolderId ? '已选定文件夹' : undefined}
          mentionCount={mentionedFiles.length}
          onClearContext={contextFolderId ? () => navigate('/ai-chat', { replace: true }) : undefined}
        />

        <div
          ref={messagesContainerRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={() => {
            const container = messagesContainerRef.current;
            if (!container) return;
            const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
            autoScrollRef.current = nearBottom;
            setShowScrollDown(!nearBottom);
          }}
        >
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
            {sessionLoading && (
              <div className="space-y-5 animate-pulse py-2">
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在载入会话…
                </div>
                <div className="flex justify-end gap-3">
                  <div className="h-10 w-2/3 rounded-xl bg-muted" />
                  <div className="h-8 w-8 rounded-lg bg-muted" />
                </div>
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-lg bg-muted" />
                  <div className="h-16 w-3/5 rounded-xl bg-muted" />
                </div>
              </div>
            )}

            {displayMessages.length === 0 && isLoading && !sessionLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在处理…
              </div>
            )}

            {displayMessages.length === 0 && !isLoading && !sessionLoading && (
              <WelcomeScreen suggestedQuestions={SUGGESTED} onSelectQuestion={setInput} />
            )}

            {displayMessages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                canRegenerate={index === lastAssistantIndex && !isLoading}
                copied={copiedId === message.id}
                onCopy={handleCopy}
                onRegenerate={handleRegenerate}
                onFileClick={handleFileClick}
                onConfirmAction={handleConfirm}
                onCancelConfirm={handleCancelConfirm}
                onQuote={handleQuote}
                onContextMenu={handleContextMenu}
              />
            ))}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {showScrollDown && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                autoScrollRef.current = true;
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                setShowScrollDown(false);
              }}
              className="absolute -top-12 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              回到最新
            </button>
          </div>
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => sendMessage(input)}
          onStop={() => agent.stop()}
          busy={Boolean(isLoading)}
          canSend={!sessionLoading}
          quotedMessage={quotedMessage}
          onClearQuote={() => setQuotedMessage(null)}
          mentions={mentionedFiles}
          onAddMention={handleAddMention}
          onRemoveMention={handleRemoveMention}
          inputRef={inputRef}
          maxLength={MAX_QUERY_LENGTH}
        />
      </div>

      {contextMenu && (
        <div
          className="fixed z-[110] min-w-[168px] rounded-xl border border-border bg-popover py-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => handleQuote(contextMenu.message)}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Reply className="h-3.5 w-3.5" />
            引用此消息
          </button>
          <button
            type="button"
            onClick={() => {
              handleCopy(contextMenu.message.id, contextMenu.message.content);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
            复制内容
          </button>
        </div>
      )}

      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
            <FilePreview
              file={previewFile}
              token={token || ''}
              onClose={() => setPreviewFile(null)}
              onDownload={(file) => {
                const anchor = document.createElement('a');
                anchor.href = `/api/files/${file.id}/download`;
                anchor.download = file.name;
                anchor.click();
              }}
              onShare={(id) => {
                setPreviewFile(null);
                navigate(`/files?id=${id}&tab=share`);
              }}
            />
          </div>
        </div>
      )}

      <ToolInfoModal open={showToolInfo} onClose={() => setShowToolInfo(false)} />
    </div>
  );
}
