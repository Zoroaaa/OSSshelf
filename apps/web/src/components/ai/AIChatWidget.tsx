/**
 * AIChatWidget.tsx
 * 全局 AI 对话悬浮组件
 *
 * 功能:
 * - 右下角悬浮按钮 (FAB)，带脉冲动画
 * - 点击弹出右侧抽屉式对话面板
 * - 固定尺寸避免大屏幕变形
 * - 支持会话切换、新建对话等完整功能
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Send,
  FileText,
  Sparkles,
  FolderOpen,
  Plus,
  Trash2,
  ExternalLink,
  X,
  Settings,
  StopCircle,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Search,
  BarChart3,
  Star,
  Share2,
  Clock,
  Tag,
  PanelRightClose,
  ChevronDown,
  Filter,
} from 'lucide-react';
import { aiApi, type AiChatMessage } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/utils';

interface ToolCallEvent {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

interface PendingConfirm {
  confirmId: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
  toolCalls?: ToolCallEvent[];
  pendingConfirm?: PendingConfirm;
  timestamp: Date;
  isLoading?: boolean;
}

interface SseChunk {
  content?: string;
  done?: boolean;
  sessionId?: string;
  sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
  error?: string;
  toolStart?: boolean;
  toolResult?: boolean;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  confirmRequest?: boolean;
  confirmId?: string;
  summary?: string;
}

const TOOL_META: Record<string, { label: string; icon: React.ReactNode }> = {
  search_files: { label: '搜索文件', icon: <Search className="h-3 w-3" /> },
  filter_files: { label: '筛选文件', icon: <Filter className="h-3 w-3" /> },
  search_by_tag: { label: '标签搜索', icon: <Tag className="h-3 w-3" /> },
  search_duplicates: { label: '查找重复文件', icon: <Copy className="h-3 w-3" /> },
  read_file_text: { label: '读取文件内容', icon: <FileText className="h-3 w-3" /> },
  analyze_image: { label: '分析图片', icon: <FileText className="h-3 w-3" /> },
  get_file_detail: { label: '获取文件详情', icon: <FileText className="h-3 w-3" /> },
  get_file_versions: { label: '查看版本历史', icon: <Clock className="h-3 w-3" /> },
  get_file_notes: { label: '查看备注', icon: <FileText className="h-3 w-3" /> },
  list_folder: { label: '浏览文件夹', icon: <FolderOpen className="h-3 w-3" /> },
  get_folder_tree: { label: '查看目录树', icon: <FolderOpen className="h-3 w-3" /> },
  list_recent: { label: '最近文件', icon: <Clock className="h-3 w-3" /> },
  list_starred: { label: '查看收藏', icon: <Star className="h-3 w-3" /> },
  list_shares: { label: '查看共享', icon: <Share2 className="h-3 w-3" /> },
  get_storage_stats: { label: '查询存储统计', icon: <BarChart3 className="h-3 w-3" /> },
  get_activity_stats: { label: '查看活动统计', icon: <BarChart3 className="h-3 w-3" /> },
  compare_files: { label: '对比文件', icon: <FileText className="h-3 w-3" /> },
};

const SUGGESTED = ['帮我找最近上传的文件', '查看我的存储统计', '有哪些带有"项目"标签的文件？'];

function parseFileRefs(text: string, onFileClick: (id: string, isFolder: boolean) => void): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\[(FILE|FOLDER):([^:]+):([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const isFolder = match[1] === 'FOLDER';
    const id = match[2];
    const name = match[3];
    parts.push(
      <button
        key={`${id}-${match.index}`}
        onClick={() => onFileClick(id!, isFolder)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[11px] font-medium transition-all group"
      >
        {isFolder ? (
          <FolderOpen className="h-2.5 w-2.5 text-amber-500" />
        ) : (
          <FileText className="h-2.5 w-2.5 text-violet-500" />
        )}
        <span className="max-w-[80px] truncate">{name}</span>
        <ExternalLink className="h-2 w-2 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function ToolCallCard({ tc }: { tc: ToolCallEvent }) {
  const meta = TOOL_META[tc.toolName] || { label: tc.toolName, icon: <Sparkles className="h-3 w-3" /> };
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-hidden text-[11px]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
      >
        <span
          className={`flex items-center justify-center h-4 w-4 rounded-full ${tc.status === 'running' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600'}`}
        >
          {tc.status === 'running' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : meta.icon}
        </span>
        <span className="text-slate-600 dark:text-slate-400 font-medium">{meta.label}</span>
        {tc.status === 'running' && <span className="text-amber-500 animate-pulse ml-1 text-[10px]">进行中…</span>}
        <span className="ml-auto text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && Boolean(tc.result) && (
        <div className="px-2.5 pb-2 pt-1 border-t border-slate-200 dark:border-slate-700">
          <pre className="text-[9px] text-slate-500 dark:text-slate-400 overflow-auto max-h-32 whitespace-pre-wrap">
            {JSON.stringify(tc.result, null, 2) as React.ReactNode}
          </pre>
        </div>
      )}
    </div>
  );
}

function ConfirmCard({
  confirm,
  onConfirm,
  onCancel,
  isLoading,
}: {
  confirm: PendingConfirm;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="my-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-[11px]">
      <div className="flex items-start gap-2">
        <div className="flex items-center justify-center h-5 w-5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 flex-shrink-0 mt-0.5">
          <Sparkles className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-amber-800 dark:text-amber-200 mb-1">待确认操作</div>
          <div className="text-amber-700 dark:text-amber-300 break-words">{confirm.summary}</div>
          <div className="text-[9px] text-amber-500/70 mt-1 font-mono">{confirm.toolName}</div>
        </div>
      </div>
      <div className="flex gap-2 mt-2.5 justify-end">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={isLoading}
          className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {isLoading && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          确认执行
        </button>
      </div>
    </div>
  );
}

function AssistantContent({
  content,
  onFileClick,
}: {
  content: string;
  onFileClick: (id: string, isFolder: boolean) => void;
}) {
  const cleanedContent = content.replace(/```tool(?:_call)?\s*[\s\S]*?```/g, '').trim();
  const hasRefs = /\[(FILE|FOLDER):[^\]]+\]/.test(cleanedContent);

  if (!hasRefs) {
    return (
      <div className="prose prose-xs max-w-none dark:prose-invert prose-p:my-0.5 prose-headings:mt-2 prose-pre:bg-slate-950 prose-pre:p-2 prose-pre:rounded-lg prose-code:text-violet-600 dark:prose-code:text-violet-400 prose-pre:text-xs">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {cleanedContent}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="text-xs leading-relaxed whitespace-pre-wrap">{parseFileRefs(cleanedContent, onFileClick)}</div>
  );
}

export function AIChatWidget() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);

  const { data: sessions = [] } = useQuery({
    queryKey: ['ai-chat-sessions'],
    queryFn: () => aiApi.chatSession.getSessions().then((r) => r.data.data ?? []),
    staleTime: 30000,
    enabled: isOpen,
  });

  useEffect(() => {
    if (messagesEndRef.current && isOpen) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!showSessionMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(e.target as Node)) {
        setShowSessionMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSessionMenu]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleFileClick = useCallback(
    (fileId: string, isFolder: boolean) => {
      if (isFolder) {
        navigate(`/files/${fileId}`);
      } else {
        navigate(`/files?preview=${fileId}`);
      }
    },
    [navigate]
  );

  const loadSession = async (sessionId: string) => {
    try {
      setIsLoading(true);
      const res = await aiApi.chatSession.getSession(sessionId);
      if (res.data.success && res.data.data) {
        setCurrentSessionId(sessionId);
        setMessages(
          res.data.data.messages.map((m: AiChatMessage) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            sources: m.sources,
            timestamp: new Date(m.createdAt),
          }))
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
      setShowSessionMenu(false);
    }
  };

  const sendMessage = useCallback(
    async (query: string, regenerateFromId?: string) => {
      if (!query.trim() || isLoading) return;

      if (regenerateFromId) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === regenerateFromId);
          return idx >= 0 ? prev.slice(0, idx) : prev;
        });
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: query,
            timestamp: new Date(),
          },
        ]);
        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';
      }

      setIsLoading(true);
      const assistantId = crypto.randomUUID();
      const toolCallsMap = new Map<string, ToolCallEvent>();

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          toolCalls: [],
          timestamp: new Date(),
          isLoading: true,
        },
      ]);

      abortRef.current = new AbortController();

      try {
        await aiApi.chatSession.chatStream(query, {
          sessionId: currentSessionId || undefined,
          maxFiles: 8,
          includeFileContent: false,
          onChunk: (raw: SseChunk) => {
            if (raw.toolStart && raw.toolCallId && raw.toolName) {
              const tc: ToolCallEvent = {
                id: raw.toolCallId,
                toolName: raw.toolName,
                args: raw.args || {},
                status: 'running',
              };
              toolCallsMap.set(raw.toolCallId, tc);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, toolCalls: [...(m.toolCalls || []), tc] } : m))
              );
              return;
            }

            if (raw.toolResult && raw.toolCallId) {
              const existing = toolCallsMap.get(raw.toolCallId);
              if (existing) {
                existing.result = raw.result;
                existing.status = 'done';
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: (m.toolCalls || []).map((tc) =>
                          tc.id === raw.toolCallId ? { ...tc, result: raw.result, status: 'done' as const } : tc
                        ),
                      }
                    : m
                )
              );
              return;
            }

            if (raw.content) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content || '') + raw.content! } : m))
              );
            }

            // Error from SSE stream
            if (raw.error && !raw.done) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: (m.content || '') + `\n\n❌ 错误: ${raw.error}`, isLoading: false }
                    : m
                )
              );
              return;
            }

            if (raw.done) {
              if (raw.confirmRequest && raw.confirmId && raw.summary) {
                const pendingConfirm: PendingConfirm = {
                  confirmId: raw.confirmId,
                  toolName: raw.toolName || '',
                  summary: raw.summary,
                  args: raw.args || {},
                };
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, isLoading: false, pendingConfirm } : m
                  )
                );
              } else {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, isLoading: false, sources: raw.sources || [] } : m))
                );
              }
              if (raw.sessionId) {
                setCurrentSessionId(raw.sessionId);
                queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
              }
            }
          },
          signal: abortRef.current.signal,
        });
      } catch (e) {
        const name = (e as Error).name;
        if (name !== 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: '抱歉，遇到了问题，请稍后再试。', isLoading: false } : m
            )
          );
        } else {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, isLoading: false } : m)));
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, currentSessionId, queryClient]
  );

  const handleRegenerate = (msgId: string) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx <= 0) return;
    const userMsg = messages[idx - 1];
    if (userMsg?.role !== 'user') return;
    sendMessage(userMsg.content, msgId);
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setInput('');
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await aiApi.chatSession.deleteSession(id);
    queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    if (currentSessionId === id) handleNewChat();
  };

  const handleCopy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleConfirm = async (msgId: string, confirmId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, isLoading: true } : m))
    );
    try {
      const res = await aiApi.chatSession.confirmAction(confirmId);
      if (res.data.success && res.data.data) {
        const resultStr =
          typeof res.data.data.result === 'object'
            ? JSON.stringify(res.data.data.result, null, 2)
            : String(res.data.data.result ?? '操作已完成');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  isLoading: false,
                  pendingConfirm: undefined,
                  // 把所有 running 状态的工具卡片标为 done（兜底，防止服务端未发 tool_result）
                  toolCalls: (m.toolCalls || []).map((tc) =>
                    tc.status === 'running' ? { ...tc, status: 'done' as const } : tc
                  ),
                  content: (m.content || '') + `\n\n✅ 操作执行成功:\n${resultStr}`,
                }
              : m
          )
        );
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, isLoading: false, content: (m.content || '') + '\n\n❌ 操作执行失败' }
            : m
        )
      );
    }
  };

  const handleCancelConfirm = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, pendingConfirm: undefined, content: (m.content || '') + '\n\n⛔ 用户已取消操作' }
          : m
      )
    );
  };

  const lastAssistantIdx = messages.reduce((last, m, i) => (m.role === 'assistant' ? i : last), -1);
  const currentSessionTitle = sessions.find((s: any) => s.id === currentSessionId)?.title ?? 'AI 助手';

  return (
    <>
      {/* FAB 悬浮按钮 - 抽屉打开时隐藏，移动端抬高避开底部导航 */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="group fixed bottom-20 right-6 lg:bottom-6 z-[100] flex items-center justify-center
            w-14 h-14 rounded-2xl
            bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500
            shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40
            transition-all duration-300 ease-out
            hover:scale-110 active:scale-95
            focus:outline-none focus-visible:ring-4 focus-visible:ring-purple-400/50"
          aria-label="打开 AI 对话"
        >
          {/* 脉冲环 */}
          <span
            className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500
            animate-ping opacity-20"
            style={{ animationDuration: '2.5s' }}
          />

          {/* 图标 */}
          <MessageSquare className="h-6 w-6 text-white relative z-10 group-hover:rotate-12 transition-transform duration-300" />

          {/* 未读提示点 */}
          {messages.length === 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white dark:border-slate-900" />
            </span>
          )}
        </button>
      )}

      {/* 抽屉遮罩 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[110] bg-black/30 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* 抽屉面板 */}
      <div
        className={`fixed top-0 right-0 z-[120] h-full w-full sm:w-[420px] lg:w-[460px]
          bg-white dark:bg-slate-900 shadow-2xl shadow-black/20
          flex flex-col transform transition-transform ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'} pointer-events-none`}
        style={{ pointerEvents: isOpen ? 'auto' : 'none', transitionDuration: '350ms' }}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm flex-shrink-0">
              <Sparkles className="h-4 w-4 text-white" />
            </div>

            {/* 会话切换器 */}
            <div className="relative" ref={sessionMenuRef}>
              <button
                onClick={() => setShowSessionMenu((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors max-w-[180px]"
              >
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {currentSessionTitle}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
              </button>

              {showSessionMenu && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50">
                  <div className="p-2 max-h-60 overflow-y-auto">
                    <button
                      onClick={handleNewChat}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                    >
                      <Plus className="h-4 w-4" /> 新建对话
                    </button>
                    <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                    {sessions.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-3">暂无历史对话</p>
                    ) : (
                      sessions.map((session: any) => (
                        <div
                          key={session.id}
                          onClick={() => loadSession(session.id)}
                          className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-left ${
                            session.id === currentSessionId
                              ? 'bg-violet-50 dark:bg-violet-900/20'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                          }`}
                        >
                          <span className="text-xs font-medium truncate flex-1 text-slate-700 dark:text-slate-300">
                            {session.title}
                          </span>
                          <button
                            onClick={(e) => handleDeleteSession(e, session.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 transition-all"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/ai-settings');
              }}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="AI 设置"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/ai-chat');
              }}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="打开完整页面"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="关闭"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-4 py-4 space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg shadow-violet-500/20">
                  <MessageSquare className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">文件管理助手</h3>
                <p className="text-xs text-slate-400 mb-4 max-w-[220px]">可以搜索文件、查看统计、浏览文件夹</p>
                <div className="grid grid-cols-1 gap-1.5 w-full max-w-[260px]">
                  {SUGGESTED.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(q)}
                      className="text-left p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-all text-xs text-slate-600 dark:text-slate-400 group"
                    >
                      <Sparkles className="h-3 w-3 text-violet-500 mb-1 group-hover:scale-110 transition-transform inline-block mr-1" />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, index) => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Sparkles className="h-3 w-3 text-white" />
                  </div>
                )}

                <div className="max-w-[88%] min-w-0">
                  {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mb-1.5 space-y-1">
                      {msg.toolCalls.map((tc) => (
                        <ToolCallCard key={tc.id} tc={tc} />
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.pendingConfirm && (
                    <ConfirmCard
                      confirm={msg.pendingConfirm!}
                      isLoading={msg.isLoading || false}
                      onConfirm={() => handleConfirm(msg.id, msg.pendingConfirm!.confirmId)}
                      onCancel={() => handleCancelConfirm(msg.id)}
                    />
                  )}

                  <div
                    className={`rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-violet-600 to-purple-600 text-white rounded-tr-md'
                        : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-md'
                    }`}
                  >
                    {msg.role === 'assistant' && msg.content ? (
                      <AssistantContent content={msg.content} onFileClick={handleFileClick} />
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}

                    {msg.isLoading && !msg.content && (
                      <div className="flex items-center gap-1">
                        {[0, 150, 300].map((d) => (
                          <span
                            key={d}
                            className="h-1 w-1 rounded-full bg-violet-400 animate-bounce"
                            style={{ animationDelay: `${d}ms` }}
                          />
                        ))}
                        <span className="text-[10px] text-slate-400 ml-1">
                          {msg.toolCalls && msg.toolCalls.some((t) => t.status === 'running')
                            ? '正在查询…'
                            : '正在思考…'}
                        </span>
                      </div>
                    )}
                  </div>

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {msg.sources.map((src, i) => (
                        <button
                          key={i}
                          onClick={() => handleFileClick(src.id, false)}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-violet-50 dark:hover:bg-violet-900/30 border border-slate-200 dark:border-slate-700 hover:border-violet-300 transition-all text-[10px] text-slate-500 hover:text-violet-700 dark:hover:text-violet-300 group"
                        >
                          <FileText className="h-2.5 w-2.5 text-slate-400 group-hover:text-violet-500" />
                          <span className="max-w-[70px] truncate">{src.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {!msg.isLoading && (
                    <div className={`flex items-center gap-1 mt-0.5 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      <span className="text-[9px] text-slate-400">{formatDate(msg.timestamp.toISOString())}</span>
                      {msg.role === 'assistant' && msg.content && (
                        <button
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {copiedId === msg.id ? (
                            <Check className="h-2.5 w-2.5 text-green-500" />
                          ) : (
                            <Copy className="h-2.5 w-2.5" />
                          )}
                        </button>
                      )}
                      {msg.role === 'assistant' && index === lastAssistantIdx && !isLoading && (
                        <button
                          onClick={() => handleRegenerate(msg.id)}
                          className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-violet-600 transition-colors"
                        >
                          <RefreshCw className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="h-6 w-6 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                    你
                  </div>
                )}
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区域 */}
        <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 safe-bottom">
          <div className="flex items-end gap-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 focus-within:border-violet-400 dark:focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-400/20 transition-all px-3 py-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoResize(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="问我任何关于你的文件的问题…"
              className="flex-1 resize-none bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none min-h-[32px] max-h-[120px] py-0.5"
              rows={1}
              disabled={isLoading}
            />
            <div className="flex items-center pb-0.5 flex-shrink-0">
              {isLoading ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 text-[11px] font-medium transition-colors border border-red-200 dark:border-red-800"
                >
                  <StopCircle className="h-3 w-3" />
                  <span>停止</span>
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="h-7 w-7 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white disabled:text-slate-400 flex items-center justify-center transition-colors shadow-sm"
                >
                  <Send className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
