/**
 * AIChat.tsx - AI 文件管理智能体对话页面
 *
 * 职责：
 * - 组合会话列表 / 头部 / 消息区 / 输入区
 * - 会话生命周期（新建、切换、重命名、删除、导出、自动标题）
 * - 乐观消息、上下文文件、引用消息、错误与连接状态
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Copy, Loader2, PanelLeft, Reply } from 'lucide-react';
import { aiApi, filesApi } from '@/services/api';
import { presignUpload } from '@/services/presignUpload';
import { FilePreview } from '@/components/files/FilePreview';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/components/ui/useToast';
import {
  ChatHeader,
  ChatSidebar,
  Composer,
  ErrorBanner,
  MessageBubble,
  StatusStrip,
  TaskRunBanner,
  ToolInfoModal,
  WelcomeScreen,
} from '@/components/ai/chat';
import { useToolCatalog } from '@/components/ai/chat/toolMeta';
import type { Message } from '@/components/ai/types';
import { useOssShelfChat, agentMessagesKey } from '@/hooks/useOssShelfChat';
import { mapUIMessages } from '@/utils/agentMessages';
import {
  MODEL_STORAGE_KEY,
  useAIChatUiState,
  useUiField,
  type QuotedMessage,
} from './aiChat/useAIChatUi';

const PENDING_MESSAGE_ID = 'pending-user-message';
/** 配置未加载时的兜底值；实际值来自 GET /api/ai-config/effective */
const FALLBACK_MAX_QUERY_LENGTH = 15_000;
const FALLBACK_CONNECT_TIMEOUT_MS = 10_000;

const FALLBACK_SUGGESTED = [
  '帮我找最近上传的文件',
  '查看我的存储统计',
  '有哪些带有"项目"标签的文件？',
  '列出根目录的内容',
  '我收藏了哪些文件？',
  '帮我创建一个备忘录文件，内容是明天要去开会',
  '帮我把这段代码保存到代码文件夹',
  '查看我分享了哪些文件',
];

export function AIChat() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const contextFolderId = searchParams.get('folderId') || undefined;
  const queryClient = useQueryClient();
  const { token, user } = useAuthStore();
  const { toast } = useToast();

  const { state: ui, dispatch: uiDispatch } = useAIChatUiState(urlSessionId ?? null);

  const [input, setInput] = useUiField(ui, uiDispatch, 'input');
  const [currentSessionId, setCurrentSessionId] = useUiField(ui, uiDispatch, 'currentSessionId');
  const [showSidebar, setShowSidebar] = useUiField(ui, uiDispatch, 'showSidebar');
  const [copiedId, setCopiedId] = useUiField(ui, uiDispatch, 'copiedId');
  const [renamingId, setRenamingId] = useUiField(ui, uiDispatch, 'renamingId');
  const [renameValue, setRenameValue] = useUiField(ui, uiDispatch, 'renameValue');
  const [previewFile, setPreviewFile] = useUiField(ui, uiDispatch, 'previewFile');
  const [showToolInfo, setShowToolInfo] = useUiField(ui, uiDispatch, 'showToolInfo');
  const [quotedMessage, setQuotedMessage] = useUiField(ui, uiDispatch, 'quotedMessage');
  const [contextMenu, setContextMenu] = useUiField(ui, uiDispatch, 'contextMenu');
  const [sendError, setSendError] = useUiField(ui, uiDispatch, 'sendError');
  const [dismissedError, setDismissedError] = useUiField(ui, uiDispatch, 'dismissedError');
  const [exporting, setExporting] = useUiField(ui, uiDispatch, 'exporting');
  const [showScrollDown, setShowScrollDown] = useUiField(ui, uiDispatch, 'showScrollDown');
  const [resumingRun, setResumingRun] = useUiField(ui, uiDispatch, 'resumingRun');
  const [uploading, setUploading] = useUiField(ui, uiDispatch, 'uploading');
  const [mentionedFiles, setMentionedFiles] = useUiField(ui, uiDispatch, 'mentionedFiles');
  const [modelId, setModelId] = useUiField(ui, uiDispatch, 'modelId');
  const [pendingAgentSend, setPendingAgentSend] = useUiField(ui, uiDispatch, 'pendingAgentSend');

  const mentionedFilesRef = useRef<Array<{ id: string; name: string }>>([]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const prevSessionIdRef = useRef<string | null>(null);
  const wasStreamingRef = useRef(false);
  const titleGeneratedRef = useRef<Set<string>>(new Set());

  const { catalog: toolCatalog } = useToolCatalog();

  const { data: effectiveConfig } = useQuery({
    queryKey: ['ai-effective-config'],
    queryFn: () => aiApi.config.getEffective().then((r) => r.data.data),
    staleTime: 5 * 60_000,
  });

  const maxQueryLength = effectiveConfig?.ui.maxQueryLength ?? FALLBACK_MAX_QUERY_LENGTH;
  const pendingConnectTimeoutMs = effectiveConfig?.ui.connectTimeoutMs ?? FALLBACK_CONNECT_TIMEOUT_MS;
  const suggestedQuestions = effectiveConfig?.ui.suggestions?.length
    ? effectiveConfig.ui.suggestions
    : FALLBACK_SUGGESTED;

  const agent = useOssShelfChat({
    userId: user?.id,
    sessionId: currentSessionId,
    enabled: true,
    identityWaitMs: effectiveConfig?.ui.identityWaitMs,
  });



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

  // 服务端任务事实源：仅在失败/等待审批时用于呈现可恢复入口
  const { data: activeRun, refetch: refetchActiveRun } = useQuery({
    queryKey: ['ai-chat-run', currentSessionId],
    queryFn: () => {
      if (!currentSessionId) throw new Error('缺少会话上下文');
      return aiApi.chatSession.getActiveRun(currentSessionId).then((r) => r.data.data);
    },
    enabled: Boolean(currentSessionId),
    staleTime: 5_000,
    refetchInterval: agent.isStreaming ? 3_000 : false,
    retry: 1,
  });

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
  }, [agentConnected, agentSendMessage, pendingAgentSend, currentSessionId, setPendingAgentSend]);

  // 连接超时：避免乐观消息永远停在"正在连接"
  useEffect(() => {
    if (!pendingAgentSend || !currentSessionId) return;
    const timer = window.setTimeout(() => {
      setPendingAgentSend(null);
      setSendError('会话连接超时，请检查网络后重新发送');
    }, pendingConnectTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [pendingAgentSend, currentSessionId, pendingConnectTimeoutMs, setPendingAgentSend, setSendError]);

  // 流结束：刷新会话列表 + 首次对话自动生成标题
  useEffect(() => {
    if (agent.isStreaming) {
      wasStreamingRef.current = true;
      return;
    }
    if (!wasStreamingRef.current) return;
    wasStreamingRef.current = false;

    queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    void refetchActiveRun();

    if (!currentSessionId || titleGeneratedRef.current.has(currentSessionId)) return;
    if (displayMessages.length > 3) return;

    titleGeneratedRef.current.add(currentSessionId);
    aiApi.chatSession
      .generateTitle(currentSessionId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] }))
      .catch(() => {
        // 标题生成失败保留原会话标题
      });
  }, [agent.isStreaming, queryClient, currentSessionId, displayMessages.length, refetchActiveRun]);

  // ═══ 滚动：只有贴近底部时才自动跟随 ═══
  useEffect(() => {
    if (!autoScrollRef.current) {
      setShowScrollDown(true);
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: agent.isStreaming ? 'auto' : 'smooth' });
    setShowScrollDown(false);
  }, [displayMessages, agent.isStreaming, setShowScrollDown]);

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
  }, [currentSessionId, setShowScrollDown]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (urlSessionId && urlSessionId !== currentSessionId) setCurrentSessionId(urlSessionId);
  }, [urlSessionId, currentSessionId, setCurrentSessionId]);

  // ═══ 文件预览 ═══
  const handleFileClick = useCallback(
    async (fileId: string, isFolderHint: boolean) => {
      try {
        const res = await filesApi.get(fileId);
        const data = res.data?.data;
        if (data) {
          // 以接口返回的真实类型为准，避免引用标记错误时把文件夹当文件预览
          if (data.isFolder) {
            navigate(`/files/${fileId}`);
          } else {
            setPreviewFile(data);
          }
          return;
        }
      } catch {
        // 元数据读取失败时退回引用标记
      }
      if (isFolderHint) {
        navigate(`/files/${fileId}`);
        return;
      }
      navigate(`/files?preview=${fileId}`);
    },
    [navigate, setPreviewFile]
  );

  // ═══ 引用 / 右键菜单 ═══
  const handleContextMenu = useCallback((event: React.MouseEvent, message: Message) => {
    event.preventDefault();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 110),
      message,
    });
  }, [setContextMenu]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [setContextMenu]);

  const handleQuote = useCallback((message: Message | QuotedMessage) => {
    setQuotedMessage({ content: message.content, role: message.role });
    setContextMenu(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setContextMenu, setQuotedMessage]);

  // ═══ 发送 ═══
  const sendMessage = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query || isLoading || sessionLoading) return;

      if (query.length > maxQueryLength) {
        toast({
          title: '输入过长',
          description: `消息长度不能超过 ${maxQueryLength} 字符，当前 ${query.length} 字符`,
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
      setCurrentSessionId,
      setDismissedError,
      setInput,
      setMentionedFiles,
      setPendingAgentSend,
      setQuotedMessage,
      setSendError,
      contextFolderId,
      quotedMessage,
      toast,
      effectiveModelId,
      maxQueryLength,
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

  const handleResumeRun = useCallback(async () => {
    const runId = activeRun?.run.id;
    if (!runId || resumingRun) return;
    setResumingRun(true);
    try {
      const response = await aiApi.chatSession.resumeRun(runId);
      const resumeMessage = response.data.data?.resumeMessage ?? '继续执行未完成的任务，从当前步骤接着做。';
      await agent.sendMessage(
        { text: resumeMessage },
        {
          body: {
            contextFolderId: contextFolderId ?? null,
            modelId: effectiveModelId || undefined,
          },
        }
      );
      queryClient.invalidateQueries({ queryKey: ['ai-chat-run', currentSessionId] });
    } catch (error) {
      toast({
        title: '无法继续任务',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    } finally {
      setResumingRun(false);
    }
  }, [
    activeRun?.run.id,
    resumingRun,
    agent,
    contextFolderId,
    effectiveModelId,
    queryClient,
    currentSessionId,
    toast,
    setResumingRun,
  ]);

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
  }, [setMentionedFiles]);

  const handleRemoveMention = useCallback((id: string) => {
    setMentionedFiles((prev) => {
      const next = prev.filter((file) => file.id !== id);
      mentionedFilesRef.current = next;
      return next;
    });
  }, [setMentionedFiles]);

  /**
   * 对话内上传：复用文件系统的预签名/代理上传（配额、去重、Telegram 分片、权限都在原链路），
   * 上传成功后直接加入 @ 引用，文件随即进入自动 AI 处理（摘要/标签/索引）。
   * 不在聊天通道里另造一套上传逻辑，否则安全与配额校验会分叉。
   */
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (uploading) return;
      const maxFiles = effectiveConfig?.agent.maxContextFiles ?? 5;
      const remaining = Math.max(0, maxFiles - mentionedFilesRef.current.length);
      if (remaining === 0) {
        toast({
          title: '引用文件已达上限',
          description: `单轮对话最多引用 ${maxFiles} 个文件，请先移除部分引用`,
          variant: 'destructive',
        });
        return;
      }

      setUploading(true);
      let added = 0;
      for (const file of files.slice(0, remaining)) {
        try {
          const uploaded = await presignUpload({ file, parentId: contextFolderId ?? null });
          handleAddMention({ id: uploaded.id, name: uploaded.name });
          added++;
        } catch (error) {
          toast({
            title: `上传失败：${file.name}`,
            description: error instanceof Error ? error.message : '请稍后重试',
            variant: 'destructive',
          });
        }
      }
      setUploading(false);
      if (added > 0) {
        toast({
          title: '已加入上下文',
          description: `${added} 个文件上传完成，可直接提问；解析完成前提问会先读到文件元信息`,
        });
      }
    },
    [uploading, effectiveConfig?.agent.maxContextFiles, contextFolderId, handleAddMention, toast, setUploading]
  );

  const lastAssistantIndex = displayMessages.reduce(
    (last, message, index) => (message.role === 'assistant' ? index : last),
    -1
  );

  const errorMessage = sendError || agent.error?.message || agent.connectionError?.message;

  // 新的错误内容出现时重新展示提示条（用户此前手动关闭过的旧提示保持关闭）
  useEffect(() => {
    if (errorMessage) setDismissedError(false);
  }, [errorMessage, setDismissedError]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      {!showSidebar && (
        <button
          type="button"
          onClick={() => setShowSidebar(true)}
          className="fixed left-0 top-1/2 z-dropdown hidden h-12 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground lg:flex"
          title="显示对话历史"
          aria-label="显示对话历史"
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </button>
      )}

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
        onToggleSidebar={() => setShowSidebar(false)}
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
          toolCount={toolCatalog?.tools.length ?? 0}
          onShowToolInfo={() => setShowToolInfo(true)}
          models={modelOptions}
          modelId={effectiveModelId}
          onModelChange={handleModelChange}
          onExport={currentSessionId ? handleExport : undefined}
          exporting={exporting}
          onToggleSidebar={() => setShowSidebar((visible) => !visible)}
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

        {activeRun && (
          <TaskRunBanner
            runView={activeRun}
            resuming={resumingRun}
            onResume={handleResumeRun}
          />
        )}

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
              <WelcomeScreen
                suggestedQuestions={suggestedQuestions}
                capabilityTags={effectiveConfig?.ui.capabilityTags}
                onSelectQuestion={setInput}
              />
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
          maxLength={maxQueryLength}
          onUploadFiles={handleUploadFiles}
          uploading={uploading}
        />
      </div>

      {contextMenu && (
        <div
          className="fixed z-dropdown min-w-[168px] rounded-xl border border-border bg-popover py-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-150"
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
