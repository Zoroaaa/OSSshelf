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
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Send,
  FileText,
  Sparkles,
  StopCircle,
  Copy,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  Tag,
  Download,
  Zap,
  Code,
  Loader2,
  FolderOpen,
  X,
  AlertTriangle,
  Clock,
  Lightbulb,
  FilePlus,
  AtSign,
  Reply,
} from 'lucide-react';
import { aiApi, filesApi, type AiChatMessage } from '@/services/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatBytes } from '@/utils';
import { FilePreview } from '@/components/files/FilePreview';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/components/ui/useToast';
import type { FileItem } from '@osshelf/shared';
import {
  ToolCallCard,
  ReasoningSection,
  AssistantContent,
  ToolInfoModal,
  ChatSidebar,
  ChatHeader,
  WelcomeScreen,
  PlanProgressBar,
} from '@/components/ai/chat';
import type { Message, ToolCallEvent, SseChunk, PendingConfirm, ExecutionPlan } from '@/components/ai/types';

// ────────────────────────────────────────────────────────────
// Tool name → label + icon
// ────────────────────────────────────────────────────────────

const TOOL_META: Record<string, { label: string; icon: React.ReactNode; category: string }> = {
  // 搜索发现
  search_files: { label: '搜索文件', icon: <Search className="h-3 w-3" />, category: '搜索发现' },
  filter_files: { label: '筛选文件', icon: <Filter className="h-3 w-3" />, category: '搜索发现' },
  search_by_tag: { label: '标签搜索', icon: <Tag className="h-3 w-3" />, category: '搜索发现' },
  search_duplicates: { label: '查找重复文件', icon: <Copy className="h-3 w-3" />, category: '搜索发现' },
  smart_search: { label: '智能搜索', icon: <Sparkles className="h-3 w-3" />, category: '搜索发现' },
  get_similar_files: { label: '相似文件', icon: <Copy className="h-3 w-3" />, category: '搜索发现' },
  get_file_details: { label: '文件详情', icon: <FileText className="h-3 w-3" />, category: '搜索发现' },
  get_recent_files: { label: '最近文件', icon: <RefreshCw className="h-3 w-3" />, category: '搜索发现' },
  get_starred_files: { label: '收藏文件', icon: <Sparkles className="h-3 w-3" />, category: '搜索发现' },

  // 内容理解
  read_file_text: { label: '读取文件内容', icon: <FileText className="h-3 w-3" />, category: '内容理解' },
  analyze_image: { label: '分析图片', icon: <Zap className="h-3 w-3" />, category: '内容理解' },
  compare_files: { label: '对比文件', icon: <FileText className="h-3 w-3" />, category: '内容理解' },
  extract_metadata: { label: '提取元数据', icon: <Download className="h-3 w-3" />, category: '内容理解' },
  generate_summary: { label: '生成摘要', icon: <Sparkles className="h-3 w-3" />, category: '内容理解' },
  generate_tags: { label: '生成标签', icon: <Tag className="h-3 w-3" />, category: '内容理解' },
  content_preview: { label: '内容预览', icon: <Code className="h-3 w-3" />, category: '内容理解' },
  smart_organize_suggest: { label: '智能整理建议', icon: <Lightbulb className="h-3 w-3" />, category: 'AI增强' },
  analyze_file_collection: { label: '文件集合分析', icon: <Sparkles className="h-3 w-3" />, category: 'AI增强' },

  // 目录导航
  list_folder: { label: '浏览文件夹', icon: <FileText className="h-3 w-3" />, category: '目录导航' },
  get_folder_tree: { label: '查看目录树', icon: <FileText className="h-3 w-3" />, category: '目录导航' },
  navigate_path: { label: '路径导航', icon: <Tag className="h-3 w-3" />, category: '目录导航' },
  get_storage_overview: { label: '存储概览', icon: <Download className="h-3 w-3" />, category: '目录导航' },
  get_parent_chain: { label: '父级链路', icon: <FileText className="h-3 w-3" />, category: '目录导航' },

  // 统计分析
  get_storage_stats: { label: '存储统计', icon: <Search className="h-3 w-3" />, category: '统计分析' },
  get_activity_stats: { label: '活动趋势', icon: <Search className="h-3 w-3" />, category: '统计分析' },
  get_user_quota_info: { label: '配额信息', icon: <Search className="h-3 w-3" />, category: '统计分析' },
  get_file_type_distribution: { label: '文件类型分布', icon: <Search className="h-3 w-3" />, category: '统计分析' },
  get_sharing_stats: { label: '分享统计', icon: <Copy className="h-3 w-3" />, category: '统计分析' },

  // 文件操作
  create_text_file: { label: '创建文本文件', icon: <FileText className="h-3 w-3" />, category: '文件操作' },
  create_code_file: { label: '创建代码文件', icon: <Code className="h-3 w-3" />, category: '文件操作' },
  create_file_from_template: { label: '从模板创建', icon: <FileText className="h-3 w-3" />, category: '文件操作' },
  edit_file_content: { label: '编辑文件', icon: <Code className="h-3 w-3" />, category: '文件操作' },
  append_to_file: { label: '追加内容', icon: <FileText className="h-3 w-3" />, category: '文件操作' },
  find_and_replace: { label: '查找替换', icon: <Code className="h-3 w-3" />, category: '文件操作' },
  rename_file: { label: '重命名', icon: <Code className="h-3 w-3" />, category: '文件操作' },
  move_file: { label: '移动文件', icon: <FileText className="h-3 w-3" />, category: '文件操作' },
  copy_file: { label: '复制文件', icon: <Copy className="h-3 w-3" />, category: '文件操作' },
  delete_file: { label: '删除文件', icon: <FileText className="h-3 w-3" />, category: '文件操作' },
  restore_file: { label: '恢复文件', icon: <RefreshCw className="h-3 w-3" />, category: '文件操作' },
  create_folder: { label: '创建文件夹', icon: <FileText className="h-3 w-3" />, category: '文件操作' },
  draft_and_create_file: { label: '草稿创建文件', icon: <FilePlus className="h-3 w-3" />, category: '文件操作' },
  batch_rename: { label: '批量重命名', icon: <Code className="h-3 w-3" />, category: '文件操作' },
  star_file: { label: '收藏文件', icon: <Sparkles className="h-3 w-3" />, category: '文件操作' },
  unstar_file: { label: '取消收藏', icon: <Sparkles className="h-3 w-3" />, category: '文件操作' },

  // 标签管理
  add_tag: { label: '添加标签', icon: <Tag className="h-3 w-3" />, category: '标签管理' },
  remove_tag: { label: '移除标签', icon: <Tag className="h-3 w-3" />, category: '标签管理' },
  get_file_tags: { label: '文件标签', icon: <Tag className="h-3 w-3" />, category: '标签管理' },
  list_all_tags_for_management: { label: '标签管理列表', icon: <Tag className="h-3 w-3" />, category: '标签管理' },
  merge_tags: { label: '合并标签', icon: <Code className="h-3 w-3" />, category: '标签管理' },
  auto_tag_files: { label: '自动打标签', icon: <Zap className="h-3 w-3" />, category: '标签管理' },
  tag_folder: { label: '文件夹打标', icon: <Tag className="h-3 w-3" />, category: '标签管理' },

  // 分享链接
  create_share_link: { label: '创建分享链接', icon: <Copy className="h-3 w-3" />, category: '分享链接' },
  list_shares: { label: '列出分享', icon: <Copy className="h-3 w-3" />, category: '分享链接' },
  update_share_settings: { label: '更新分享设置', icon: <Code className="h-3 w-3" />, category: '分享链接' },
  revoke_share: { label: '撤销分享', icon: <Copy className="h-3 w-3" />, category: '分享链接' },
  get_share_stats: { label: '分享统计', icon: <Copy className="h-3 w-3" />, category: '分享链接' },
  create_direct_link: { label: '创建直链', icon: <Code className="h-3 w-3" />, category: '分享链接' },
  revoke_direct_link: { label: '撤销直链', icon: <Code className="h-3 w-3" />, category: '分享链接' },
  create_upload_link_for_folder: {
    label: '创建上传链接',
    icon: <Download className="h-3 w-3" />,
    category: '分享链接',
  },

  // 版本管理
  get_file_versions: { label: '版本历史', icon: <RefreshCw className="h-3 w-3" />, category: '版本管理' },
  restore_version: { label: '恢复版本', icon: <RefreshCw className="h-3 w-3" />, category: '版本管理' },
  compare_versions: { label: '对比版本', icon: <Code className="h-3 w-3" />, category: '版本管理' },
  set_version_retention: { label: '版本保留策略', icon: <Code className="h-3 w-3" />, category: '版本管理' },

  // 笔记备注
  add_note: { label: '添加备注', icon: <FileText className="h-3 w-3" />, category: '笔记备注' },
  get_notes: { label: '获取备注列表', icon: <FileText className="h-3 w-3" />, category: '笔记备注' },
  update_note: { label: '更新备注', icon: <Code className="h-3 w-3" />, category: '笔记备注' },
  delete_note: { label: '删除备注', icon: <FileText className="h-3 w-3" />, category: '笔记备注' },
  search_notes: { label: '搜索备注', icon: <Search className="h-3 w-3" />, category: '笔记备注' },

  // 权限管理
  get_file_permissions: { label: '查看权限', icon: <Code className="h-3 w-3" />, category: '权限管理' },
  grant_permission: { label: '授权访问', icon: <Code className="h-3 w-3" />, category: '权限管理' },
  revoke_permission: { label: '撤销权限', icon: <Code className="h-3 w-3" />, category: '权限管理' },
  set_folder_access_level: { label: '设置访问级别', icon: <Code className="h-3 w-3" />, category: '权限管理' },
  list_user_groups: { label: '用户组列表', icon: <Code className="h-3 w-3" />, category: '权限管理' },
  manage_group_members: { label: '管理组成员', icon: <Code className="h-3 w-3" />, category: '权限管理' },
  list_expired_permissions: { label: '过期权限列表', icon: <Clock className="h-3 w-3" />, category: '权限管理' },

  // 存储管理
  list_buckets: { label: '列出存储桶', icon: <Download className="h-3 w-3" />, category: '存储管理' },
  get_bucket_info: { label: '存储桶详情', icon: <Download className="h-3 w-3" />, category: '存储管理' },
  set_default_bucket: { label: '设默认桶', icon: <Download className="h-3 w-3" />, category: '存储管理' },
  migrate_file_to_bucket: { label: '迁移文件', icon: <Download className="h-3 w-3" />, category: '存储管理' },
  get_storage_usage: { label: '存储使用量', icon: <Download className="h-3 w-3" />, category: '存储管理' },
  get_large_files: { label: '大文件列表', icon: <FileText className="h-3 w-3" />, category: '存储管理' },
  get_folder_sizes: { label: '文件夹大小', icon: <FileText className="h-3 w-3" />, category: '存储管理' },
  get_cleanup_suggestions: { label: '清理建议', icon: <RefreshCw className="h-3 w-3" />, category: '存储管理' },

  // 系统管理
  get_system_status: { label: '系统状态', icon: <Zap className="h-3 w-3" />, category: '系统管理' },
  get_help: { label: '帮助信息', icon: <FileText className="h-3 w-3" />, category: '系统管理' },
  get_version_info: { label: '版本信息', icon: <RefreshCw className="h-3 w-3" />, category: '系统管理' },
  get_faq: { label: '常见问题', icon: <FileText className="h-3 w-3" />, category: '系统管理' },
  get_user_profile: { label: '用户画像', icon: <Code className="h-3 w-3" />, category: '系统管理' },
  list_api_keys: { label: 'API密钥列表', icon: <Code className="h-3 w-3" />, category: '系统管理' },
  create_api_key: { label: '创建API密钥', icon: <Code className="h-3 w-3" />, category: '系统管理' },
  revoke_api_key: { label: '撤销API密钥', icon: <Code className="h-3 w-3" />, category: '系统管理' },
  list_webhooks: { label: 'Webhook列表', icon: <Code className="h-3 w-3" />, category: '系统管理' },
  create_webhook: { label: '创建Webhook', icon: <Code className="h-3 w-3" />, category: '系统管理' },
  get_audit_logs: { label: '审计日志', icon: <FileText className="h-3 w-3" />, category: '系统管理' },

  // AI增强
  trigger_ai_summary: { label: 'AI摘要', icon: <Sparkles className="h-3 w-3" />, category: 'AI增强' },
  trigger_ai_tags: { label: 'AI标签', icon: <Zap className="h-3 w-3" />, category: 'AI增强' },
  rebuild_vector_index: { label: '重建向量索引', icon: <RefreshCw className="h-3 w-3" />, category: 'AI增强' },
  ask_rag_question: { label: 'RAG问答', icon: <FileText className="h-3 w-3" />, category: 'AI增强' },
  smart_rename_suggest: { label: '智能重命名', icon: <Sparkles className="h-3 w-3" />, category: 'AI增强' },
};

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

export function AIChat() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const contextFolderId = searchParams.get('folderId') || undefined;
  const queryClient = useQueryClient();
  const { token } = useAuthStore();
  const { toast } = useToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 1024);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [showToolInfo, setShowToolInfo] = useState(false);
  const [executionPlans, setExecutionPlans] = useState<Map<string, ExecutionPlan>>(new Map());

  // ═══ @文件引用功能状态 ═══
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionedFiles, setMentionedFiles] = useState<Array<{ id: string; name: string }>>([]);
  const mentionedFilesRef = useRef<Array<{ id: string; name: string }>>([]);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);

  const [isDragOver, setIsDragOver] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState<{ id: string; content: string; role: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    messageId: string;
    content: string;
    role: string;
  } | null>(null);

  // ═══ @文件引用搜索查询 ═══
  const { data: mentionSearchResults = [] } = useQuery({
    queryKey: ['mention-files', mentionQuery],
    queryFn: () => aiApi.search(mentionQuery, { limit: 8 }).then((r) => r.data?.data ?? []),
    enabled: showMentionDropdown,
    staleTime: 5000,
  });

  // 检测 @ 符号触发搜索
  const detectMention = useCallback((value: string, cursorPos: number) => {
    const textBeforeCursor = value.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (
      atIndex !== -1 &&
      (atIndex === 0 || textBeforeCursor[atIndex - 1] === ' ' || textBeforeCursor[atIndex - 1] === '\n')
    ) {
      const query = textBeforeCursor.substring(atIndex + 1);
      if (!query.includes(' ') && !query.includes('@')) {
        setMentionQuery(query);
        setShowMentionDropdown(true);
        setMentionCursorPos(atIndex);
        return;
      }
    }
    setShowMentionDropdown(false);
    setMentionQuery('');
  }, []);

  // 选择文件到引用列表
  const selectMentionedFile = useCallback(
    (fileId: string, fileName: string) => {
      if (!mentionedFiles.find((f) => f.id === fileId)) {
        setMentionedFiles((prev) => {
          const next = [...prev, { id: fileId, name: fileName }];
          mentionedFilesRef.current = next;
          return next;
        });
      }
      // 移除输入框中的 @xxx 文本
      const currentInput = input;
      const beforeMention = currentInput.substring(0, mentionCursorPos);
      const afterCursor = currentInput.substring(mentionCursorPos + 1 + mentionQuery.length);
      setInput(beforeMention + afterCursor);
      setShowMentionDropdown(false);
      setMentionQuery('');
      inputRef.current?.focus();
    },
    [input, mentionedFiles, mentionCursorPos, mentionQuery]
  );

  // 移除已引用的文件
  const removeMentionedFile = useCallback((fileId: string) => {
    setMentionedFiles((prev) => {
      const next = prev.filter((f) => f.id !== fileId);
      mentionedFilesRef.current = next;
      return next;
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/osshelf-file-ids')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const fileIdsData = e.dataTransfer.getData('application/osshelf-file-ids');
      if (fileIdsData) {
        try {
          const droppedIds: Array<{ id: string; name: string }> = JSON.parse(fileIdsData);
          setMentionedFiles((prev) => {
            const newFiles = droppedIds.filter((df) => !prev.find((pf) => pf.id === df.id));
            const next = [...prev, ...newFiles];
            mentionedFilesRef.current = next;
            return next;
          });
        } catch {
          // ignore parse errors
        }
        return;
      }

      if (e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        files.forEach((file) => {
          const fileId = file.name.replace(/\.[^.]+$/, '');
          if (!mentionedFilesRef.current.find((f) => f.id === fileId)) {
            setMentionedFiles((prev) => {
              const next = [...prev, { id: fileId, name: file.name }];
              mentionedFilesRef.current = next;
              return next;
            });
          }
        });
      }
    },
    [mentionedFiles]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, messageId: string, content: string, role: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, messageId, content, role });
  }, []);

  const handleQuoteMessage = useCallback((content: string) => {
    setQuotedMessage({ id: `quote_${Date.now()}`, content, role: 'user' });
    setContextMenu(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mentionDropdownRef.current && !mentionDropdownRef.current.contains(e.target as Node)) {
        setShowMentionDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
          res.data.data.messages.map((m: AiChatMessage) => {
            const isInterrupted = m.role === 'assistant' && !m.content && !m.aborted;
            return {
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              sources: m.sources,
              toolCalls: m.toolCalls || [],
              reasoning: m.reasoning || undefined,
              aborted: m.aborted || isInterrupted,
              mentionedFiles: m.mentionedFiles,
              timestamp: new Date(m.createdAt),
            };
          })
        );
      } else {
        toast({
          title: '加载失败',
          description: '无法加载会话内容',
          variant: 'destructive',
        });
      }
    } catch (e) {
      console.error(e);
      toast({
        title: '加载会话出错',
        description: e instanceof Error ? e.message : '网络错误，请重试',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const MAX_QUERY_LENGTH = 15000;

  const sendMessage = useCallback(
    async (query: string, regenerateFromId?: string) => {
      if (!query.trim() || isLoading) return;

      if (query.length > MAX_QUERY_LENGTH) {
        toast({
          title: '输入过长',
          description: `消息长度不能超过 ${MAX_QUERY_LENGTH} 字符，当前 ${query.length} 字符`,
          variant: 'destructive',
        });
        return;
      }

      const finalQuery = quotedMessage ? `[引用]: ${quotedMessage.content}\n\n${query}` : query;

      let contextFileIdsForApi: string[] | undefined;

      if (regenerateFromId) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === regenerateFromId);
          return idx >= 0 ? prev.slice(0, idx) : prev;
        });
      } else {
        const currentMentionedFiles = [...mentionedFilesRef.current];
        contextFileIdsForApi = currentMentionedFiles.length > 0 ? currentMentionedFiles.map((f) => f.id) : undefined;
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: finalQuery,
            mentionedFiles: currentMentionedFiles.length > 0 ? currentMentionedFiles : undefined,
            timestamp: new Date(),
          },
        ]);
        setInput('');
        setMentionedFiles([]);
        mentionedFilesRef.current = [];
        if (inputRef.current) inputRef.current.style.height = 'auto';
        setQuotedMessage(null);
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
        await aiApi.chatSession.chatStream(finalQuery, {
          sessionId: currentSessionId || undefined,
          maxFiles: 8,
          includeFileContent: false,
          contextFolderId,
          contextFileIds: contextFileIdsForApi,
          onChunk: (raw: SseChunk) => {
            if (raw.type === 'plan' && raw.plan) {
              setExecutionPlans((prev) => new Map(prev).set(assistantId, raw.plan!));
              return;
            }

            if (raw.type === 'plan_step_update' && raw.stepId && raw.status) {
              setExecutionPlans((prev) => {
                const currentPlan = prev.get(assistantId);
                if (!currentPlan) return prev;
                const updatedPlan = {
                  ...currentPlan,
                  steps: currentPlan.steps.map((s) =>
                    s.id === raw.stepId ? { ...s, status: raw.status as ExecutionPlan['steps'][number]['status'] } : s
                  ),
                };
                const newMap = new Map(prev);
                newMap.set(assistantId, updatedPlan);
                return newMap;
              });
              return;
            }

            // 处理 reset 信号：清空当前 assistant 消息的已渲染内容
            if (raw.type === 'reset') {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: '', reasoning: '' } : m)));
              return;
            }

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
              const resultObj =
                raw.result && typeof raw.result === 'object' ? (raw.result as Record<string, unknown>) : null;
              const isPendingConfirm = resultObj?.status === 'pending_confirm';
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: (m.toolCalls || []).map((tc) =>
                          tc.id === raw.toolCallId
                            ? {
                                ...tc,
                                result: raw.result,
                                status: 'done' as const,
                                ...(isPendingConfirm ? { confirmStatus: 'pending' as const } : {}),
                              }
                            : tc
                        ),
                      }
                    : m
                )
              );
              return;
            }

            if (raw.reasoning && raw.content) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, reasoning: (m.reasoning || '') + raw.content! } : m))
              );
              return;
            }

            if (raw.content) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content || '') + raw.content! } : m))
              );
            }

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
                  prev.map((m) => (m.id === assistantId ? { ...m, isLoading: false, pendingConfirm } : m))
                );
              } else {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, isLoading: false, sources: raw.sources || [] } : m))
                );
              }
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
        if (name === 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    isLoading: false,
                    aborted: true,
                    content: m.content || '',
                  }
                : m
            )
          );
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: '抱歉，遇到了问题，请稍后再试。', isLoading: false } : m
            )
          );
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, currentSessionId, urlSessionId, navigate, queryClient]
  );

  const handleConfirm = useCallback(async (msgId: string, confirmId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, isLoading: true } : m)));
    try {
      const res = await aiApi.chatSession.confirmAction(confirmId);
      if (res.data.success && res.data.data) {
        const resultData = res.data.data;
        const resultStr =
          typeof resultData.result === 'object'
            ? JSON.stringify(resultData.result, null, 2)
            : String(resultData.result ?? '操作已完成');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  isLoading: false,
                  pendingConfirm: undefined,
                  content: (m.content || '') + `\n\n✅ 操作执行成功:\n${resultStr}`,
                  toolCalls: (m.toolCalls || []).map((tc) => {
                    const resultObj =
                      tc.result && typeof tc.result === 'object' ? (tc.result as Record<string, unknown>) : null;
                    const wasPendingConfirm =
                      tc.confirmStatus === 'pending' || (resultObj?.status === 'pending_confirm' && !tc.confirmStatus);
                    if (wasPendingConfirm) {
                      return { ...tc, result: resultData.result, confirmStatus: 'confirmed' as const };
                    }
                    return tc;
                  }),
                }
              : m
          )
        );
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, isLoading: false, content: (m.content || '') + '\n\n❌ 操作执行失败' } : m
        )
      );
    }
  }, []);

  const handleCancelConfirm = useCallback(
    async (msgId: string, confirmId?: string) => {
      const message = messages.find((m) => m.id === msgId);
      const tc = message?.toolCalls?.find(
        (t) =>
          t.confirmStatus === 'pending' ||
          (t.result &&
            typeof t.result === 'object' &&
            (t.result as Record<string, unknown>).status === 'pending_confirm' &&
            !t.confirmStatus)
      );
      const actualConfirmId =
        confirmId ||
        (tc?.result && typeof tc.result === 'object'
          ? ((tc.result as Record<string, unknown>).confirmId as string | undefined)
          : undefined);

      if (actualConfirmId) {
        try {
          await aiApi.chatSession.cancelAction(actualConfirmId);
        } catch (e) {
          console.error('Failed to cancel action:', e);
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                pendingConfirm: undefined,
                content: (m.content || '') + '\n\n⛔ 用户已取消操作',
                toolCalls: (m.toolCalls || []).map((tc) => {
                  const resultObj =
                    tc.result && typeof tc.result === 'object' ? (tc.result as Record<string, unknown>) : null;
                  const wasPendingConfirm =
                    tc.confirmStatus === 'pending' || (resultObj?.status === 'pending_confirm' && !tc.confirmStatus);
                  if (wasPendingConfirm) {
                    return { ...tc, confirmStatus: 'cancelled' as const };
                  }
                  return tc;
                }),
              }
            : m
        )
      );
    },
    [messages]
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
    try {
      await aiApi.chatSession.deleteSession(id);
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
      if (currentSessionId === id) handleNewChat();
      toast({
        title: '删除成功',
        description: '会话已删除',
      });
    } catch (error) {
      toast({
        title: '删除失败',
        description: error instanceof Error ? error.message : '无法删除会话',
        variant: 'destructive',
      });
    }
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
      <ChatSidebar
        showSidebar={showSidebar}
        sessions={sessions}
        currentSessionId={currentSessionId}
        renamingId={renamingId}
        renameValue={renameValue}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onStartRename={(session) => {
          setRenamingId(session.id);
          setRenameValue(session.title);
        }}
        onConfirmRename={handleConfirmRename}
        onCancelRename={() => setRenamingId(null)}
        onRenameValueChange={setRenameValue}
        onCloseMobile={() => setShowSidebar(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <ChatHeader
          toolCount={Object.keys(TOOL_META).length}
          onShowToolInfo={() => setShowToolInfo(true)}
          showSidebar={showSidebar}
          onToggleSidebar={() => setShowSidebar(!showSidebar)}
        />

        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
            {contextFolderId && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                <FolderOpen className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">当前上下文：已选定文件夹，AI 将优先在此目录内操作</span>
                <button
                  onClick={() => navigate('/ai-chat', { replace: true })}
                  className="ml-auto flex-shrink-0 text-blue-500 hover:text-blue-700 dark:hover:text-blue-200"
                  title="清除上下文"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {messages.length === 0 && !isLoading && (
              <WelcomeScreen suggestedQuestions={SUGGESTED} onSelectQuestion={setInput} />
            )}

            {messages.map((msg, index) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group/message animate-in slide-in-from-bottom-2 duration-300`}
                onContextMenu={(e) => {
                  if (msg.content) handleContextMenu(e, msg.id, msg.content, msg.role);
                }}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25 ring-2 ring-white dark:ring-slate-800">
                      <Sparkles className="h-4 w-4 text-white" />
                    </div>
                  </div>
                )}

                <div className="max-w-[85%] min-w-0 space-y-2.5">
                  {msg.role === 'assistant' && executionPlans.has(msg.id) && (
                    <PlanProgressBar plan={executionPlans.get(msg.id)!} />
                  )}

                  {msg.role === 'assistant' && msg.reasoning && <ReasoningSection content={msg.reasoning} />}

                  {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="space-y-2">
                      {msg.toolCalls.map((tc) => (
                        <ToolCallCard
                          key={tc.id}
                          tc={tc}
                          msgId={msg.id}
                          onFileClick={handleToolFileClick}
                          onConfirmAction={handleConfirm}
                          onCancelConfirm={handleCancelConfirm}
                          toolMeta={TOOL_META}
                        />
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.pendingConfirm && (
                    <div className="my-2 rounded-xl border border-amber-300/70 dark:border-amber-700/70 bg-gradient-to-r from-amber-50 via-yellow-50 to-transparent dark:from-amber-950/30 dark:via-yellow-950/20 p-4 shadow-sm">
                      <div className="flex items-start gap-2.5">
                        <div className="flex-shrink-0 mt-0.5">
                          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-100 to-yellow-100 dark:from-amber-900/40 dark:to-yellow-900/30 flex items-center justify-center shadow-sm">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-amber-900 dark:text-amber-100 mb-1.5 text-[13px]">
                            待确认操作
                          </div>
                          <div className="text-amber-800 dark:text-amber-200 break-words text-[13px] leading-relaxed">
                            {msg.pendingConfirm.summary}
                          </div>
                          <div className="text-[11px] text-amber-600/70 dark:text-amber-400/70 mt-2 font-mono bg-amber-100/30 dark:bg-amber-900/20 px-2 py-1 rounded-md inline-block">
                            {msg.pendingConfirm.toolName}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2.5 mt-3 justify-end">
                        <button
                          onClick={() => handleCancelConfirm(msg.id, msg.pendingConfirm?.confirmId)}
                          disabled={msg.isLoading}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 transition-all duration-200 border border-slate-200 dark:border-slate-600 disabled:opacity-50 active:scale-95"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => handleConfirm(msg.id, msg.pendingConfirm!.confirmId)}
                          disabled={msg.isLoading}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white transition-all duration-200 shadow-md shadow-amber-500/25 disabled:opacity-50 flex items-center gap-1.5 active:scale-95"
                        >
                          {msg.isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                          确认执行
                        </button>
                      </div>
                    </div>
                  )}

                  <div
                    className={`relative ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 text-white rounded-2xl rounded-tr-md shadow-xl shadow-violet-500/25'
                        : 'bg-white dark:bg-slate-800/95 border border-slate-200/80 dark:border-slate-700/60 text-slate-800 dark:text-slate-200 rounded-2xl rounded-tl-md shadow-lg shadow-slate-900/5'
                    } px-4 py-3.5 text-[14px] leading-relaxed`}
                  >
                    {msg.role === 'assistant' && msg.content ? (
                      <AssistantContent content={msg.content} onFileClick={handleFileClick} />
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}

                    {msg.role === 'user' && msg.mentionedFiles && msg.mentionedFiles.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/20 flex flex-wrap gap-1.5">
                        {msg.mentionedFiles.map((file) => (
                          <span
                            key={file.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 text-white/90 text-xs font-medium"
                          >
                            <AtSign className="h-3 w-3" />
                            <span className="max-w-[120px] truncate">{file.name}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {msg.aborted && msg.role === 'assistant' && (
                      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs">
                          <StopCircle className="h-3.5 w-3.5" />
                          <span>输出已中断</span>
                        </div>
                      </div>
                    )}

                    {msg.isLoading && !msg.content && (
                      <div className="flex items-center gap-2 py-1">
                        <div className="flex gap-1.5">
                          {[0, 150, 300].map((d) => (
                            <span
                              key={d}
                              className={`h-2 w-2 rounded-full animate-bounce ${msg.role === 'user' ? 'bg-violet-300' : 'bg-violet-400'}`}
                              style={{ animationDelay: `${d}ms` }}
                            />
                          ))}
                        </div>
                        <span
                          className={`text-xs ml-1 ${msg.role === 'user' ? 'text-violet-200' : 'text-slate-500'} font-medium`}
                        >
                          {msg.toolCalls && msg.toolCalls.some((t) => t.status === 'running')
                            ? '正在查询…'
                            : '正在思考…'}
                        </span>
                      </div>
                    )}
                  </div>

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {msg.sources.map((src, i) => (
                        <button
                          key={i}
                          onClick={() => handleFileClick(src.id, false)}
                          className="group/src inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-violet-50 dark:hover:bg-violet-900/25 border border-slate-200/70 dark:border-slate-700/60 hover:border-violet-300 dark:hover:border-violet-600 transition-all duration-200 text-[12px] text-slate-600 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300 shadow-sm hover:shadow-md"
                          title={src.name}
                        >
                          <FileText className="h-3.5 w-3.5 text-slate-400 group-hover/src:text-violet-500 transition-colors" />
                          <span className="max-w-[120px] truncate font-medium">{src.name}</span>
                          <ExternalLinkIconSmall />
                        </button>
                      ))}
                    </div>
                  )}

                  {!msg.isLoading && (
                    <div
                      className={`flex items-center gap-2 pt-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} opacity-0 group-hover/message:opacity-100 transition-opacity duration-200`}
                    >
                      <span className="text-[11px] text-slate-400 font-medium">
                        {formatDate(msg.timestamp.toISOString())}
                      </span>
                      {msg.role === 'assistant' && (msg.content || msg.aborted) && (
                        <>
                          <button
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-all duration-200"
                            title="复制"
                          >
                            {copiedId === msg.id ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {(index === lastAssistantIdx || msg.aborted) && !isLoading && (
                            <button
                              onClick={() => handleRegenerate(msg.id)}
                              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-all duration-200"
                              title="重新生成"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="flex-shrink-0">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center shadow-md ring-2 ring-white dark:ring-slate-900">
                      <span className="text-[13px] font-bold text-slate-600 dark:text-slate-300">你</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />

            {contextMenu && (
              <div
                className="fixed z-[100] min-w-[160px] bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 py-1.5 animate-in fade-in zoom-in-95 duration-150"
                style={{
                  left: Math.min(contextMenu.x, window.innerWidth - 180),
                  top: Math.min(contextMenu.y, window.innerHeight - 120),
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => handleQuoteMessage(contextMenu.content)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                >
                  <Reply className="h-3.5 w-3.5" />
                  引用此消息
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(contextMenu.content);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制内容
                </button>
              </div>
            )}
          </div>
        </div>

        <div
          className={`flex-shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 relative transition-colors duration-200 ${isDragOver ? 'border-violet-400 bg-violet-50/50 dark:bg-violet-950/20' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="max-w-3xl mx-auto relative">
            <div className="flex items-end gap-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 focus-within:border-violet-400 dark:focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-400/20 transition-all px-3 py-2">
              {quotedMessage && (
                <div className="w-full mb-1 flex items-start gap-2 px-2 py-1.5 rounded-lg bg-violet-100/80 dark:bg-violet-900/30 text-sm">
                  <Reply className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
                  <span className="flex-1 text-violet-700 dark:text-violet-300 line-clamp-2 italic">
                    {quotedMessage.content.length > 120
                      ? quotedMessage.content.slice(0, 120) + '...'
                      : quotedMessage.content}
                  </span>
                  <button
                    onClick={() => setQuotedMessage(null)}
                    className="flex-shrink-0 p-0.5 rounded hover:bg-violet-200 dark:hover:bg-violet-800 text-violet-500 hover:text-red-500 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize(e.target);
                  detectMention(e.target.value, e.target.selectionStart);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                  // @mention 下拉框键盘导航
                  if (showMentionDropdown && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
                    e.preventDefault();
                  }
                }}
                placeholder="问我任何关于你的文件的问题… (@ 引用文件)"
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
                    className="h-8 w-8 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shadow-sm"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 已引用的文件 Chips */}
            {mentionedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-w-3xl mx-auto mt-1.5">
                {mentionedFiles.map((file) => (
                  <span
                    key={file.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium"
                  >
                    <AtSign className="h-3 w-3" />
                    <span className="max-w-[120px] truncate">{file.name}</span>
                    <button
                      onClick={() => removeMentionedFile(file.id)}
                      className="ml-0.5 hover:text-red-500 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {isDragOver && (
              <div className="max-w-3xl mx-auto mt-1.5 py-3 border-2 border-dashed border-violet-400 dark:border-violet-500 rounded-xl bg-violet-50/80 dark:bg-violet-950/30 flex items-center justify-center gap-2 text-sm text-violet-600 dark:text-violet-400 animate-pulse">
                <Download className="h-4 w-4" />
                <span>释放以添加文件到对话上下文</span>
              </div>
            )}

            {/* @mention 文件搜索下拉框 */}
            {showMentionDropdown && (
              <div
                ref={mentionDropdownRef}
                className="absolute bottom-full left-4 right-4 mb-1 max-w-3xl mx-auto bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50"
              >
                <div className="p-2">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground mb-1">
                    <AtSign className="h-3 w-3" />
                    <span>搜索文件（{mentionQuery || '全部'}）</span>
                  </div>
                  {mentionSearchResults.length === 0 ? (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">未找到匹配的文件</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      {mentionSearchResults.map((file: FileItem) => (
                        <button
                          key={file.id}
                          onClick={() => selectMentionedFile(file.id, file.name)}
                          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-left transition-colors"
                        >
                          <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{formatBytes(file.size)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

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

      <ToolInfoModal open={showToolInfo} onClose={() => setShowToolInfo(false)} toolMeta={TOOL_META} />
    </div>
  );
}

function ExternalLinkIconSmall() {
  return (
    <svg
      className="h-3 w-3 text-slate-400 opacity-0 group-hover/src:opacity-100 transition-all duration-200 translate-x-1 group-hover/src:translate-x-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}
