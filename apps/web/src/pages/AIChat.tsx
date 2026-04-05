/**
 * AIChat.tsx - AI 文件管理智能体对话页面
 *
 * 新特性：
 * - 工具调用过程实时显示（"正在搜索文件…"）
 * - 工具结果渲染为可点击文件卡片
 * - [FILE:id:name] / [FOLDER:id:name] 标记自动转为可点击元素
 * - 点击文件跳转到文件管理页面并高亮该文件
 * - 侧边栏默认展开（桌面端）+ session 重命名 + 重新生成
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  MessageSquare,
  Send,
  FileText,
  Image,
  File,
  Sparkles,
  FolderOpen,
  Plus,
  Trash2,
  ExternalLink,
  PanelLeftClose,
  Settings,
  StopCircle,
  Copy,
  Check,
  RefreshCw,
  Pencil,
  X,
  Loader2,
  Search,
  BarChart3,
  Star,
  Share2,
  Clock,
  Tag,
  Download,
  ChevronDown,
  Filter,
} from 'lucide-react';
import { aiApi, filesApi, type AiChatMessage } from '@/services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/utils';
import { FilePreview } from '@/components/files/FilePreview';
import { useAuthStore } from '@/stores/auth';
import type { FileItem } from '@osshelf/shared';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface AgentFile {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  mimeType: string | null;
  size: number;
  createdAt: string;
}

interface ToolCallEvent {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
  toolCalls?: ToolCallEvent[];
  timestamp: Date;
  isLoading?: boolean;
}

// ────────────────────────────────────────────────────────────
// Tool name → label + icon
// ────────────────────────────────────────────────────────────

const TOOL_META: Record<string, { label: string; icon: React.ReactNode }> = {
  search_files: { label: '搜索文件', icon: <Search className="h-3 w-3" /> },
  filter_files: { label: '筛选文件', icon: <Filter className="h-3 w-3" /> },
  search_by_tag: { label: '标签搜索', icon: <Tag className="h-3 w-3" /> },
  search_duplicates: { label: '查找重复文件', icon: <Copy className="h-3 w-3" /> },
  read_file_text: { label: '读取文件内容', icon: <FileText className="h-3 w-3" /> },
  analyze_image: { label: '分析图片', icon: <Image className="h-3 w-3" /> },
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

// ────────────────────────────────────────────────────────────
// SSE Chunk type (mirrors backend AgentChunk)
// ────────────────────────────────────────────────────────────

interface SseChunk {
  content?: string;
  done?: boolean;
  sessionId?: string;
  sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  reasoning?: boolean;
  // Tool events
  toolStart?: boolean;
  toolResult?: boolean;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

const SUGGESTED = [
  '帮我找最近上传的文件',
  '查看我的存储统计',
  '有哪些带有"项目"标签的文件？',
  '列出根目录的内容',
  '我收藏了哪些文件？',
  '查看我分享了哪些文件',
];

// ────────────────────────────────────────────────────────────
// File ref parser: [FILE:id:name] → clickable element
// ────────────────────────────────────────────────────────────

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
        className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-0.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium transition-all group"
      >
        {isFolder ? (
          <FolderOpen className="h-3 w-3 text-amber-500" />
        ) : (
          <FileText className="h-3 w-3 text-violet-500" />
        )}
        <span>{name}</span>
        <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function ToolCallCard({ tc, onFileClick }: { tc: ToolCallEvent; onFileClick: (id: string) => void }) {
  const meta = TOOL_META[tc.toolName] || {
    label: tc.toolName.replace(/_/g, ' '),
    icon: <Sparkles className="h-3 w-3" />,
  };
  const [expanded, setExpanded] = useState(false);

  const resultFiles: AgentFile[] = (() => {
    if (!tc.result || typeof tc.result !== 'object') return [];
    const r = tc.result as Record<string, unknown>;

    // 处理 files 数组格式（搜索类工具）
    const filesArray = r.files as Array<{ id: string; name: string; mimeType?: string | null }> | undefined;
    if (filesArray?.length) {
      return filesArray.slice(0, 6).map((f) => ({
        id: f.id,
        name: f.name,
        path: '',
        isFolder: false,
        size: 0,
        createdAt: '',
        mimeType: f.mimeType ?? null,
        parentId: null,
        aiSummary: null,
        aiTags: null,
        isStarred: false,
        description: null,
      }));
    }

    // 处理单文件对象格式（get_file_detail 等）
    if (r.id && r.name && typeof r.id === 'string' && typeof r.name === 'string') {
      return [{
        id: r.id as string,
        name: r.name as string,
        path: (r.path as string) || '',
        isFolder: (r.isFolder as boolean) || false,
        size: (r.size as number) || 0,
        createdAt: (r.createdAt as string) || '',
        mimeType: (r.mimeType as string | null) ?? null,
        parentId: null,
        aiSummary: null,
        aiTags: null,
        isStarred: false,
        description: null,
      }];
    }

    // 处理 compare_files 的 fileA/fileB
    const fileA = r.fileA as { id: string; name: string; mimeType?: string | null } | undefined;
    const fileB = r.fileB as { id: string; name: string; mimeType?: string | null } | undefined;
    if (fileA?.id && fileB?.id) {
      return [fileA, fileB].map((f) => ({
        id: f.id,
        name: f.name,
        path: '',
        isFolder: false,
        size: 0,
        createdAt: '',
        mimeType: f.mimeType ?? null,
        parentId: null,
        aiSummary: null,
        aiTags: null,
        isStarred: false,
        description: null,
      }));
    }

    return [];
  })();

  const argsSummary = tc.args
    ? Object.entries(tc.args)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v).slice(0, 30)}`)
        .join(' | ')
    : '';

  const isRunning = tc.status === 'running';
  const isDone = tc.status === 'done';
  const hasArgs = Boolean(tc.args && Object.keys(tc.args).length > 0);
  const showResult = isDone && Boolean(tc.result);

  return (
    <div
      className={`my-1.5 rounded-xl overflow-hidden border ${
        isRunning
          ? 'border-amber-200 dark:border-amber-800 bg-gradient-to-r from-amber-50/50 to-transparent dark:from-amber-900/10'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80'
      }`}
    >
      {/* Header bar — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors text-left"
      >
        {/* Status icon */}
        <span
          className={`flex items-center justify-center h-5 w-5 rounded-full flex-shrink-0 ${
            isRunning
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 animate-pulse'
              : 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
          }`}
        >
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : meta.icon}
        </span>

        {/* Tool name + status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{meta.label}</span>
            {isRunning && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">正在执行…</span>}
            {isDone && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">已完成</span>}
          </div>
          {/* Args preview when not expanded */}
          {!expanded && argsSummary && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{argsSummary}</p>}
        </div>

        {/* Expand toggle */}
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''} flex-shrink-0`}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-2.5 pt-0 border-t border-slate-100 dark:border-slate-700/50 space-y-2">
          {/* Args detail */}
          {hasArgs && (
            <div className="pt-2">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">参数</p>
              <pre className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 rounded-md p-2 overflow-auto font-mono max-h-24">
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {showResult && (
            <div>
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">结果</p>
              {resultFiles.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {resultFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onFileClick(f.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all text-left"
                    >
                      <File className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-700 dark:text-slate-300 truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <pre
                  className={`text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 rounded-md p-2 overflow-auto font-mono max-h-32`}
                >
                  {(() => {
                    const resultStr = JSON.stringify(tc.result, null, 2);
                    return resultStr.length > 500 ? resultStr.slice(0, 500) + '\n... (已截断)' : resultStr;
                  })()}
                </pre>
              )}
            </div>
          )}

          {/* Running state placeholder */}
          {isRunning && !tc.result && (
            <div className="pt-1 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <div className="flex gap-0.5">
                {[0, 100, 200].map((d) => (
                  <span
                    key={d}
                    className="h-1 w-1 rounded-full bg-amber-400 animate-bounce"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
              等待工具返回结果…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileChip({ file, onClick }: { file: AgentFile; onClick: () => void }) {
  const getIcon = (mime: string | null) => {
    if (file.isFolder) return <FolderOpen className="h-3.5 w-3.5 text-amber-500" />;
    if (!mime) return <File className="h-3.5 w-3.5" />;
    if (mime.startsWith('image/')) return <Image className="h-3.5 w-3.5 text-blue-500" />;
    if (mime.includes('pdf')) return <FileText className="h-3.5 w-3.5 text-red-500" />;
    if (mime.startsWith('text/') || mime.includes('document'))
      return <FileText className="h-3.5 w-3.5 text-slate-500" />;
    return <File className="h-3.5 w-3.5 text-slate-400" />;
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  };

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all text-left group w-full sm:w-auto min-w-0"
    >
      {getIcon(file.mimeType)}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{file.name}</p>
        {file.size > 0 && <p className="text-[10px] text-slate-400">{formatSize(file.size)}</p>}
      </div>
      <ExternalLink className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </button>
  );
}

function ReasoningSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!content.trim()) return null;

  return (
    <div className="mb-2 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors text-left"
      >
        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 flex-shrink-0">
          <Sparkles className="h-3 w-3" />
        </span>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">思考过程</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ml-auto ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 pt-0 border-t border-slate-100 dark:border-slate-700/50">
          <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

// Renders assistant message content with [FILE:...] refs converted to buttons
function AssistantContent({
  content,
  onFileClick,
}: {
  content: string;
  onFileClick: (id: string, isFolder: boolean) => void;
}) {
  const cleanedContent = content.replace(/```tool_call\s*[\s\S]*?```/g, '').trim();
  const hasRefs = /\[(FILE|FOLDER):[^\]]+\]/.test(cleanedContent);

  if (!hasRefs) {
    return (
      <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:mt-3 prose-pre:bg-slate-950 prose-code:text-violet-600 dark:prose-code:text-violet-400">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {cleanedContent}
        </ReactMarkdown>
      </div>
    );
  }

  // Has refs — render inline
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap">{parseFileRefs(cleanedContent, onFileClick)}</div>
  );
}

// ────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────

export function AIChat() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const queryClient = useQueryClient();
  const { token } = useAuthStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(urlSessionId || null);
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 1024);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const prevSessionIdRef = useRef<string | null>(null);

  const { data: sessions = [] } = useQuery({
    queryKey: ['ai-chat-sessions'],
    queryFn: () => aiApi.chatSession.getSessions().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  useEffect(() => {
    if (prevSessionIdRef.current && prevSessionIdRef.current !== currentSessionId) {
      const container = messagesContainerRef.current;
      if (container) scrollPositionsRef.current.set(prevSessionIdRef.current, container.scrollTop);
    }
    prevSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      const container = messagesContainerRef.current;
      const saved = scrollPositionsRef.current.get(currentSessionId);
      if (container && saved !== undefined && saved > 0) {
        requestAnimationFrame(() => {
          container.scrollTop = saved;
        });
      }
    }
  }, [messages, currentSessionId]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (urlSessionId && urlSessionId !== currentSessionId) loadSession(urlSessionId);
  }, [urlSessionId]);
  useEffect(() => {
    if (renamingId) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renamingId]);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

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

  const handleToolFileClick = useCallback(
    (id: string) => {
      handleFileClick(id, false);
    },
    [handleFileClick]
  );

  const closePreview = useCallback(() => setPreviewFile(null), []);

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
            // Tool start event
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

            // Tool result event
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

            // Reasoning content (思考过程)
            if (raw.reasoning && raw.content) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, reasoning: (m.reasoning || '') + raw.content! } : m))
              );
              return;
            }

            // Text content
            if (raw.content) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content || '') + raw.content! } : m))
              );
            }

            // Error from SSE stream
            if (raw.error && !raw.done) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content || '') + `\n\n❌ 错误: ${raw.error}`, isLoading: false } : m))
              );
              return;
            }

            // Done
            if (raw.done) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, isLoading: false, sources: raw.sources || [] } : m))
              );
              if (raw.sessionId) {
                setCurrentSessionId(raw.sessionId);
                if (!urlSessionId) navigate(`/ai-chat/${raw.sessionId}`, { replace: true });
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
    [isLoading, currentSessionId, urlSessionId, navigate, queryClient]
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
    navigate('/ai-chat');
  };

  const handleSelectSession = (id: string) => {
    if (id === currentSessionId) return;
    navigate(`/ai-chat/${id}`);
    if (window.innerWidth < 1024) setShowSidebar(false);
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await aiApi.chatSession.deleteSession(id);
    queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    if (currentSessionId === id) handleNewChat();
  };

  const handleConfirmRename = async (id: string) => {
    const v = renameValue.trim();
    if (v) {
      await aiApi.chatSession.updateSession(id, { title: v });
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    }
    setRenamingId(null);
  };

  const handleCopy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const lastAssistantIdx = messages.reduce((last, m, i) => (m.role === 'assistant' ? i : last), -1);

  return (
    <div className="flex bg-slate-50 dark:bg-slate-950 overflow-hidden h-screen">
      {/* Mobile overlay */}
      {showSidebar && (
        <div
          className="lg:hidden fixed inset-0 z-20 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex-shrink-0 ${showSidebar ? 'w-64' : 'w-0'} fixed inset-y-0 left-0 z-30 lg:relative lg:z-auto overflow-hidden`}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            对话历史
          </span>
          <button
            onClick={handleNewChat}
            className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-violet-600 transition-colors"
            title="新建对话"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-0.5">
          {sessions.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-10">暂无对话记录</p>
          ) : (
            sessions.map((session: any) => (
              <div
                key={session.id}
                onClick={() => handleSelectSession(session.id)}
                className={`relative group rounded-lg px-3 py-2 cursor-pointer transition-colors ${session.id === currentSessionId ? 'bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
              >
                {renamingId === session.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={renameRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirmRename(session.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="flex-1 text-xs bg-white dark:bg-slate-700 border border-violet-300 dark:border-violet-600 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                    <button
                      onClick={() => handleConfirmRename(session.id)}
                      className="p-1 rounded text-green-600 hover:bg-green-100"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setRenamingId(null)}
                      className="p-1 rounded text-slate-400 hover:bg-slate-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-1">
                      <span
                        className={`text-xs font-medium truncate flex-1 leading-snug ${session.id === currentSessionId ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-slate-300'}`}
                      >
                        {session.title}
                      </span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(session.id);
                            setRenameValue(session.title);
                          }}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400"
                          title="重命名"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteSession(e, session.id)}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500"
                          title="删除"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(session.updatedAt)}</p>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => navigate('/files')}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="返回文件管理"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">文件管理助手</span>
                <span className="hidden md:inline text-xs text-slate-400 ml-2">· 可直接查询您的文件</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/ai-settings')}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="AI 设置"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/20">
                  <MessageSquare className="h-7 w-7 text-white" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-1.5">文件管理智能助手</h2>
                <p className="text-sm text-slate-400 mb-2 max-w-sm">
                  可以搜索文件、查看统计、浏览文件夹，结果可直接点击跳转
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center mb-6 max-w-sm">
                  {['搜索', '统计', '浏览', '收藏', '共享', '标签'].map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs border border-violet-200 dark:border-violet-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {SUGGESTED.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(q)}
                      className="text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all text-xs text-slate-600 dark:text-slate-400 group"
                    >
                      <Sparkles className="h-3 w-3 text-violet-500 mb-1.5 group-hover:scale-110 transition-transform" />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, index) => (
              <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                    <Sparkles className="h-3 w-3 text-white" />
                  </div>
                )}

                <div className="max-w-[85%] min-w-0">
                  {/* Reasoning section (思考过程) */}
                  {msg.role === 'assistant' && msg.reasoning && <ReasoningSection content={msg.reasoning} />}

                  {/* Tool calls (above bubble, assistant only) */}
                  {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {msg.toolCalls.map((tc) => (
                        <ToolCallCard key={tc.id} tc={tc} onFileClick={handleToolFileClick} />
                      ))}
                    </div>
                  )}

                  {/* Message bubble */}
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-violet-600 to-purple-600 text-white rounded-tr-sm shadow-md shadow-violet-500/15'
                        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm'
                    }`}
                  >
                    {msg.role === 'assistant' && msg.content ? (
                      <AssistantContent content={msg.content} onFileClick={handleFileClick} />
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}

                    {msg.isLoading && !msg.content && (
                      <div className="flex items-center gap-1.5">
                        {[0, 150, 300].map((d) => (
                          <span
                            key={d}
                            className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce"
                            style={{ animationDelay: `${d}ms` }}
                          />
                        ))}
                        <span className="text-xs text-slate-400 ml-1">
                          {msg.toolCalls && msg.toolCalls.some((t) => t.status === 'running')
                            ? '正在查询…'
                            : '正在思考…'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Source chips */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.sources.map((src, i) => (
                        <button
                          key={i}
                          onClick={() => handleFileClick(src.id, false)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 hover:bg-violet-50 dark:hover:bg-violet-900/30 border border-slate-200 dark:border-slate-700 hover:border-violet-300 transition-all text-[11px] text-slate-500 hover:text-violet-700 dark:hover:text-violet-300 group"
                          title={src.name}
                        >
                          <FileText className="h-3 w-3 text-slate-400 group-hover:text-violet-500" />
                          <span className="max-w-[100px] truncate">{src.name}</span>
                          <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Action row */}
                  {!msg.isLoading && (
                    <div className={`flex items-center gap-1 mt-1 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      <span className="text-[10px] text-slate-400">{formatDate(msg.timestamp.toISOString())}</span>
                      {msg.role === 'assistant' && msg.content && (
                        <button
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors"
                          title="复制"
                        >
                          {copiedId === msg.id ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      )}
                      {msg.role === 'assistant' && index === lastAssistantIdx && !isLoading && (
                        <button
                          onClick={() => handleRegenerate(msg.id)}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-violet-600 transition-colors"
                          title="重新生成"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="h-7 w-7 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    你
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
          <div className="max-w-3xl mx-auto">
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
                placeholder="问我任何关于你的文件的问题… (Enter 发送)"
                className="flex-1 resize-none bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none min-h-[36px] max-h-40 py-0.5"
                rows={1}
                disabled={isLoading}
              />
              <div className="flex items-center pb-0.5 flex-shrink-0">
                {isLoading ? (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 text-xs font-medium transition-colors border border-red-200 dark:border-red-800"
                  >
                    <StopCircle className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">停止</span>
                  </button>
                ) : (
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim()}
                    className="h-8 w-8 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white disabled:text-slate-400 flex items-center justify-center transition-colors shadow-sm"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            {input.length > 0 && <p className="text-[10px] text-slate-400 mt-1 text-right">{input.length} 字</p>}
          </div>
        </div>
      </div>

      {previewFile && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-5xl h-[85vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <FilePreview
              file={previewFile}
              token={token || ''}
              onClose={closePreview}
              onDownload={(f) => {
                const a = document.createElement('a');
                a.href = `/api/files/${f.id}/download`;
                a.download = f.name;
                a.click();
              }}
              onShare={(id) => {
                closePreview();
                navigate(`/files?id=${id}&tab=share`);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
