/**
 * ToolCallCard.tsx
 * 工具调用卡片组件（优化版）
 *
 * 功能:
 * - 展示工具调用状态（运行中/完成/待确认）
 * - 展开/收起参数和结果
 * - 结果文件可点击跳转
 * - 危险操作需用户确认
 * - 优化的视觉层次和动画效果
 */

import { useState } from 'react';
import {
  Sparkles,
  ChevronDown,
  Loader2,
  File,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Zap,
  X,
  Search,
  Move,
  Trash2,
  List,
  FolderOpen,
  Tag,
  Copy,
  FileText,
  Download,
  Code,
  RefreshCw,
  Shield,
  Users,
  Key,
  Webhook,
  Database,
  BarChart3,
  Eye,
  Edit3,
  GitBranch,
  Archive,
  Upload,
  Link2,
  StickyNote,
  MessageSquare,
  Lightbulb,
  Brain,
  Settings,
  HelpCircle,
  Info,
  FilePlus,
} from 'lucide-react';
import type { ToolCallEvent, AgentFile, PreviewDiff } from '../types';
import { DiffPreview } from './DiffPreview';
import { DraftPreview } from './DraftPreview';

const TOOL_SUMMARIES: Record<string, (args: Record<string, unknown>) => string> = {
  // ═══ 搜索发现 (7) ═══
  search_files: (a) => `搜索「${String(a.query || '').slice(0, 40)}」`,
  smart_search: (a) => `智能搜索「${String(a.query || '').slice(0, 30)}」`,
  filter_files: (a) => {
    const parts: string[] = [];
    if (a.mimeTypePrefix) parts.push(`类型: ${String(a.mimeTypePrefix).split('/')[0]}`);
    if (a.minSize) parts.push(`最小: ${formatFileSize(Number(a.minSize))}`);
    if (a.dateFrom) parts.push(`起始: ${String(a.dateFrom).slice(0, 10)}`);
    return `筛选文件${parts.length > 0 ? `（${parts.join('、')}）` : ''}`;
  },
  search_by_tag: (a) =>
    `按标签搜索「${Array.isArray(a.tagNames) ? (a.tagNames as string[]).join('、') : String(a.tagNames || '')}」`,
  search_duplicates: () => '查找重复文件',
  get_similar_files: () => '查找相似文件',
  get_file_details: () => '获取文件详情',

  // ═══ 导航浏览 (7) ═══
  navigate_path: (a) => `导航到 ${a.path || a.folderId || '目标位置'}`,
  list_folder: (a) => (a.folderId ? '浏览文件夹' : '浏览根目录'),
  get_recent_files: (a) => `查看最近 ${a.days ? `${a.days}天` : ''}文件`,
  get_starred_files: () => '获取收藏文件',
  get_parent_chain: () => '查看文件路径',
  get_folder_tree: (a) => `查看目录树${a.depth ? `（深度${a.depth}）` : ''}`,
  get_storage_overview: () => '存储概览',

  // ═══ 内容理解 (8) ═══
  read_file_text: () => '读取文件内容',
  analyze_image: (a) => (a.question ? `分析图片：${String(a.question).slice(0, 30)}` : 'AI 分析图片'),
  compare_files: () => '对比两个文件',
  extract_metadata: () => '提取元数据',
  generate_summary: (a) => (a.forceRegenerate ? '重新生成摘要' : '生成 AI 摘要'),
  generate_tags: (a) => `生成标签（最多 ${a.maxTags || 5} 个）`,
  content_preview: (a) => `预览前 ${a.lines || 50} 行`,
  analyze_file_collection: (a) => `${a.scope === 'folder' ? '文件夹' : '文件集合'}分析`,

  // ═══ 文件操作 (16) ═══
  create_text_file: (a) => `创建「${String(a.fileName || '').slice(0, 30)}」`,
  create_code_file: (a) => `创建代码「${String(a.fileName || '').slice(0, 30)}」`,
  create_file_from_template: (a) => `用模板创建「${a.templateName}」`,
  edit_file_content: () => '编辑文件内容',
  append_to_file: () => '追加内容到文件',
  find_and_replace: (a) => `替换「${String(a.find || '').slice(0, 20)}」`,
  move_file: (a) => `移动到 ${a.targetFolderPath || a.targetFolderId || '目标文件夹'}`,
  rename_file: (a) => `重命名为「${String(a.newName || '').slice(0, 30)}」`,
  copy_file: (a) => `复制到 ${a.targetFolderId || '目标位置'}`,
  delete_file: () => '删除文件',
  restore_file: () => '恢复文件',
  create_folder: (a) => `创建文件夹「${String(a.folderName || '').slice(0, 30)}」`,
  batch_rename: (a) => `批量重命名（${Array.isArray(a.fileIds) ? a.fileIds.length : '?'}个文件）`,
  batch_move: (a) => `批量移动（${Array.isArray(a.fileIds) ? a.fileIds.length : '?'}个文件）`,
  batch_delete: (a) => `批量删除（${Array.isArray(a.fileIds) ? a.fileIds.length : '?'}个文件）`,
  star_file: () => '添加收藏',
  unstar_file: () => '取消收藏',
  draft_and_create_file: (a) => `创建「${String(a.fileName || '').slice(0, 30)}」`,

  // ═══ 标签管理 (7) ═══
  add_tag: (a) => `添加标签：${Array.isArray(a.tags) ? (a.tags as string[]).join('、') : ''}`,
  remove_tag: (a) => `移除标签：${Array.isArray(a.tagNames) ? (a.tagNames as string[]).join('、') : ''}`,
  get_file_tags: () => '获取文件标签',
  list_all_tags_for_management: () => '标签库管理',
  merge_tags: (a) => `合并标签：${a.sourceTag} → ${a.targetTag}`,
  tag_folder: (a) => `文件夹打标签${a.recursive ? '（递归）' : ''}`,
  auto_tag_files: (a) => `智能打标签（${Array.isArray(a.fileIds) ? a.fileIds.length : '?'}个文件）`,

  // ═══ 分享管理 (8) ═══
  create_share_link: (a) => `创建分享链接${a.password ? '（密码保护）' : ''}${a.permission ? `(${a.permission})` : ''}`,
  list_shares: () => '查看分享列表',
  revoke_share: () => '撤销分享',
  update_share_settings: () => '更新分享设置',
  get_share_stats: () => '分享统计',
  create_direct_link: (a) => `创建直链（${a.expiresInHours || 168}h有效）`,
  revoke_direct_link: () => '撤销直链',
  create_upload_link_for_folder: (a) => `创建上传链接到文件夹`,

  // ═══ 版本管理 (4) ═══
  get_file_versions: () => '查看版本历史',
  restore_version: () => '恢复到指定版本',
  compare_versions: (a) => `对比版本 ${a.versionA} vs ${a.versionB}`,
  set_version_retention: (a) => `版本保留策略（${a.maxVersions || 10}版/${a.retentionDays || 30}天）`,

  // ═══ 笔记管理 (5) ═══
  add_note: () => '添加笔记',
  get_notes: () => '查看笔记',
  update_note: () => '编辑笔记',
  delete_note: () => '删除笔记',
  search_notes: (a) => `搜索笔记「${a.query || ''}」`,

  // ═══ 权限管理 (7) ═══
  get_file_permissions: () => '查看权限',
  grant_permission: (a) => `授权${a.permissionLevel || ''}权限`,
  revoke_permission: () => '撤销权限',
  set_folder_access_level: (a) => `访问级别：${a.accessLevel || ''}`,
  list_user_groups: () => '用户组列表',
  manage_group_members: (a) => `${a.action === 'add' ? '添加' : '移除'}组成员`,
  list_expired_permissions: () => '查询过期授权',

  // ═══ 存储管理 (9) ═══
  get_storage_usage: () => '获取存储用量',
  get_large_files: (a) => `大文件列表（Top ${a.limit || 20}）`,
  get_folder_sizes: (a) => `文件夹占用（Top ${a.topN || 10}）`,
  get_cleanup_suggestions: () => '清理建议',
  list_buckets: () => '存储桶列表',
  get_bucket_info: () => '存储桶详情',
  set_default_bucket: () => '设置默认存储桶',
  migrate_file_to_bucket: () => '迁移文件到存储桶',

  // ═══ 系统工具 (11) ═══
  get_system_status: () => '系统状态',
  get_help: (a) => `帮助：${a.topic || '总览'}`,
  get_version_info: () => '版本信息',
  get_faq: (a) => `FAQ：${a.category || '全部'}`,
  get_user_profile: () => '用户信息',
  list_api_keys: () => 'API 密钥列表',
  create_api_key: (a) => `创建密钥「${a.name || ''}」`,
  revoke_api_key: () => '撤销 API 密钥',
  list_webhooks: () => 'Webhook 列表',
  create_webhook: () => '创建 Webhook',
  get_audit_logs: (a) => `审计日志${a.action ? `(${a.action})` : ''}`,

  // ═══ AI 增强 (6) ═══
  trigger_ai_summary: (a) => (a.forceRegenerate ? '重新生成 AI 摘要' : '触发 AI 摘要生成'),
  trigger_ai_tags: (a) => `触发 AI 标签生成（${a.maxTags || 5}个）`,
  rebuild_vector_index: (a) => (a.fileId ? '重建单文件索引' : a.forceAll ? '强制重建全部索引' : '重建索引'),
  ask_rag_question: (a) => `RAG 问答：「${String(a.question || '').slice(0, 40)}」`,
  smart_rename_suggest: (a) => `AI 重命名建议（${a.style || 'descriptive'}）`,
  smart_organize_suggest: (a) => `智能整理建议（${a.scope || 'all'}）`,

  // ═══ 统计分析 (5) ═══
  get_storage_stats: (a) => `存储统计（按 ${a.dimension || 'mimetype'}）`,
  get_activity_stats: (a) => `活动趋势（${a.period || 'day'}）`,
  get_user_quota_info: () => '配额信息',
  get_file_type_distribution: (a) => `文件类型分布（${a.groupBy || 'category'}）`,
  get_sharing_stats: (a) => (a.includeExpired ? '分享统计（含过期）' : '活跃分享统计'),
};

const TOOL_ICONS: Record<string, React.ReactNode> = {
  // 搜索发现
  search_files: <Search className="h-3 w-3" />,
  smart_search: <Search className="h-3 w-3" />,
  filter_files: <List className="h-3 w-3" />,
  search_by_tag: <Tag className="h-3 w-3" />,
  search_duplicates: <Copy className="h-3 w-3" />,
  get_similar_files: <Copy className="h-3 w-3" />,
  get_file_details: <FileText className="h-3 w-3" />,

  // 导航浏览
  navigate_path: <FolderOpen className="h-3 w-3" />,
  list_folder: <FolderOpen className="h-3 w-3" />,
  get_recent_files: <RefreshCw className="h-3 w-3" />,
  get_starred_files: <Sparkles className="h-3 w-3" />,
  get_parent_chain: <FolderOpen className="h-3 w-3" />,
  get_folder_tree: <FolderOpen className="h-3 w-3" />,
  get_storage_overview: <Database className="h-3 w-3" />,

  // 内容理解
  read_file_text: <FileText className="h-3 w-3" />,
  analyze_image: <Eye className="h-3 w-3" />,
  compare_files: <GitBranch className="h-3 w-3" />,
  extract_metadata: <Info className="h-3 w-3" />,
  generate_summary: <Brain className="h-3 w-3" />,
  generate_tags: <Tag className="h-3 w-3" />,
  content_preview: <Eye className="h-3 w-3" />,
  analyze_file_collection: <BarChart3 className="h-3 w-3" />,

  // 文件操作
  create_text_file: <FilePlus className="h-3 w-3" />,
  create_code_file: <Code className="h-3 w-3" />,
  create_file_from_template: <FileText className="h-3 w-3" />,
  edit_file_content: <Edit3 className="h-3 w-3" />,
  append_to_file: <Edit3 className="h-3 w-3" />,
  find_and_replace: <Edit3 className="h-3 w-3" />,
  move_file: <Move className="h-3 w-3" />,
  rename_file: <Edit3 className="h-3 w-3" />,
  copy_file: <Copy className="h-3 w-3" />,
  delete_file: <Trash2 className="h-3 w-3" />,
  restore_file: <Archive className="h-3 w-3" />,
  create_folder: <FolderOpen className="h-3 w-3" />,
  batch_rename: <Edit3 className="h-3 w-3" />,
  batch_move: <Move className="h-3 w-3" />,
  batch_delete: <Trash2 className="h-3 w-3" />,
  star_file: <Sparkles className="h-3 w-3" />,
  unstar_file: <X className="h-3 w-3" />,
  draft_and_create_file: <FilePlus className="h-3 w-3" />,

  // 标签管理
  add_tag: <Tag className="h-3 w-3" />,
  remove_tag: <X className="h-3 w-3" />,
  get_file_tags: <Tag className="h-3 w-3" />,
  list_all_tags_for_management: <List className="h-3 w-3" />,
  merge_tags: <GitBranch className="h-3 w-3" />,
  tag_folder: <Tag className="h-3 w-3" />,
  auto_tag_files: <Brain className="h-3 w-3" />,

  // 分享管理
  create_share_link: <Link2 className="h-3 w-3" />,
  list_shares: <Link2 className="h-3 w-3" />,
  revoke_share: <X className="h-3 w-3" />,
  update_share_settings: <Settings className="h-3 w-3" />,
  get_share_stats: <BarChart3 className="h-3 w-3" />,
  create_direct_link: <Link2 className="h-3 w-3" />,
  revoke_direct_link: <X className="h-3 w-3" />,
  create_upload_link_for_folder: <Upload className="h-3 w-3" />,

  // 版本管理
  get_file_versions: <GitBranch className="h-3 w-3" />,
  restore_version: <Archive className="h-3 w-3" />,
  compare_versions: <GitBranch className="h-3 w-3" />,
  set_version_retention: <Settings className="h-3 w-3" />,

  // 笔记管理
  add_note: <StickyNote className="h-3 w-3" />,
  get_notes: <StickyNote className="h-3 w-3" />,
  update_note: <Edit3 className="h-3 w-3" />,
  delete_note: <Trash2 className="h-3 w-3" />,
  search_notes: <Search className="h-3 w-3" />,

  // 权限管理
  get_file_permissions: <Shield className="h-3 w-3" />,
  grant_permission: <Shield className="h-3 w-3" />,
  revoke_permission: <X className="h-3 w-3" />,
  set_folder_access_level: <Shield className="h-3 w-3" />,
  list_user_groups: <Users className="h-3 w-3" />,
  manage_group_members: <Users className="h-3 w-3" />,
  list_expired_permissions: <AlertTriangle className="h-3 w-3" />,

  // 存储管理
  get_storage_usage: <Database className="h-3 w-3" />,
  get_large_files: <Database className="h-3 w-3" />,
  get_folder_sizes: <Database className="h-3 w-3" />,
  get_cleanup_suggestions: <Trash2 className="h-3 w-3" />,
  list_buckets: <Database className="h-3 w-3" />,
  get_bucket_info: <Database className="h-3 w-3" />,
  set_default_bucket: <Settings className="h-3 w-3" />,
  migrate_file_to_bucket: <Move className="h-3 w-3" />,

  // 系统工具
  get_system_status: <Info className="h-3 w-3" />,
  get_help: <HelpCircle className="h-3 w-3" />,
  get_version_info: <Info className="h-3 w-3" />,
  get_faq: <HelpCircle className="h-3 w-3" />,
  get_user_profile: <Users className="h-3 w-3" />,
  list_api_keys: <Key className="h-3 w-3" />,
  create_api_key: <Key className="h-3 w-3" />,
  revoke_api_key: <X className="h-3 w-3" />,
  list_webhooks: <Webhook className="h-3 w-3" />,
  create_webhook: <Webhook className="h-3 w-3" />,
  get_audit_logs: <List className="h-3 w-3" />,

  // AI 增强
  trigger_ai_summary: <Brain className="h-3 w-3" />,
  trigger_ai_tags: <Brain className="h-3 w-3" />,
  rebuild_vector_index: <RefreshCw className="h-3 w-3" />,
  ask_rag_question: <MessageSquare className="h-3 w-3" />,
  smart_rename_suggest: <Lightbulb className="h-3 w-3" />,
  smart_organize_suggest: <Lightbulb className="h-3 w-3" />,

  // 统计分析
  get_storage_stats: <BarChart3 className="h-3 w-3" />,
  get_activity_stats: <BarChart3 className="h-3 w-3" />,
  get_user_quota_info: <Database className="h-3 w-3" />,
  get_file_type_distribution: <BarChart3 className="h-3 w-3" />,
  get_sharing_stats: <Link2 className="h-3 w-3" />,
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

interface ToolCallCardProps {
  tc: ToolCallEvent;
  onFileClick: (id: string) => void;
  onConfirm?: (toolName: string, args: Record<string, unknown>) => void;
  onConfirmAction?: (msgId: string, confirmId: string) => void;
  onCancelConfirm?: (msgId: string, confirmId?: string) => void;
  msgId?: string;
  toolMeta?: Record<string, { label: string; icon: React.ReactNode }>;
}

export function ToolCallCard({
  tc,
  onFileClick,
  onConfirm,
  onConfirmAction,
  onCancelConfirm,
  msgId,
  toolMeta = {},
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const meta = toolMeta[tc.toolName] || {
    label: tc.toolName.replace(/_/g, ' '),
    icon: TOOL_ICONS[tc.toolName] || <Sparkles className="h-3 w-3" />,
  };

  const summaryFn = tc.args ? TOOL_SUMMARIES[tc.toolName] : undefined;
  const humanSummary = summaryFn ? summaryFn(tc.args) : null;

  const resultObj = tc.result && typeof tc.result === 'object' ? (tc.result as Record<string, unknown>) : null;
  const isPendingConfirm =
    tc.confirmStatus === 'pending' || (resultObj?.status === 'pending_confirm' && !tc.confirmStatus);
  const isCancelled = tc.confirmStatus === 'cancelled';
  const isConfirmed = tc.confirmStatus === 'confirmed';
  const confirmMessage = resultObj?.message as string | undefined;
  const confirmId = resultObj?.confirmId as string | undefined;
  const previewDiff = resultObj?.previewDiff as PreviewDiff | undefined;

  const resultFiles: AgentFile[] = (() => {
    if (!tc.result || typeof tc.result !== 'object') return [];
    const r = tc.result as Record<string, unknown>;

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
      }));
    }

    if (r.id && r.name && typeof r.id === 'string' && typeof r.name === 'string') {
      return [
        {
          id: r.id as string,
          name: r.name as string,
          path: (r.path as string) || '',
          isFolder: (r.isFolder as boolean) || false,
          size: (r.size as number) || 0,
          createdAt: (r.createdAt as string) || '',
          mimeType: (r.mimeType as string | null) ?? null,
        },
      ];
    }

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
      }));
    }

    return [];
  })();

  const argsSummary = tc.args
    ? Object.entries(tc.args)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v).slice(0, 30)}`)
        .join(' · ')
    : '';

  const isRunning = tc.status === 'running';
  const isDone = tc.status === 'done';
  const hasArgs = Boolean(tc.args && Object.keys(tc.args).length > 0);
  const showResult = isDone && Boolean(tc.result);

  const getStatusConfig = () => {
    if (isPendingConfirm) {
      return {
        bg: 'bg-gradient-to-r from-amber-50 via-yellow-50 to-transparent dark:from-amber-950/30 dark:via-yellow-950/20',
        border: 'border-amber-300 dark:border-amber-700',
        iconBg: 'bg-amber-100 dark:bg-amber-900/40',
        iconColor: 'text-amber-600 dark:text-amber-400',
        icon: <AlertTriangle className="h-3 w-3" />,
        statusText: '待确认',
        statusColor: 'text-amber-600 dark:text-amber-400',
      };
    }
    if (isCancelled) {
      return {
        bg: 'bg-gradient-to-r from-slate-50 via-gray-50 to-transparent dark:from-slate-950/30 dark:via-gray-950/20',
        border: 'border-slate-300 dark:border-slate-700',
        iconBg: 'bg-slate-100 dark:bg-slate-800/40',
        iconColor: 'text-slate-500 dark:text-slate-400',
        icon: <X className="h-3 w-3" />,
        statusText: '已取消',
        statusColor: 'text-slate-500 dark:text-slate-400',
      };
    }
    if (isRunning) {
      return {
        bg: 'bg-gradient-to-r from-blue-50 via-indigo-50 to-transparent dark:from-blue-950/20 dark:via-indigo-950/10',
        border: 'border-blue-200 dark:border-blue-800',
        iconBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 animate-pulse',
        iconColor: 'text-blue-600 dark:text-blue-400',
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        statusText: '执行中…',
        statusColor: 'text-blue-600 dark:text-blue-400',
      };
    }
    return {
      bg: 'bg-white dark:bg-slate-800/90',
      border: 'border-slate-200 dark:border-slate-700',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      icon: <CheckCircle2 className="h-3 w-3" />,
      statusText: '已完成',
      statusColor: 'text-emerald-600 dark:text-emerald-400',
    };
  };

  const statusConfig = getStatusConfig();

  return (
    <div
      className={`my-2 rounded-xl overflow-hidden border transition-all duration-300 ${statusConfig.border} ${statusConfig.bg} shadow-sm hover:shadow-md`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-all duration-200 text-left group"
      >
        <span
          className={`flex items-center justify-center h-8 w-8 rounded-xl flex-shrink-0 shadow-sm ${statusConfig.iconBg} ${statusConfig.iconColor} transition-all duration-300 group-hover:scale-110`}
        >
          {statusConfig.icon}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{meta.label}</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${statusConfig.iconBg} ${statusConfig.statusColor}`}
            >
              {isRunning && <Clock className="h-2.5 w-2.5 mr-1" />}
              {!isRunning && !isPendingConfirm && !isCancelled && <Zap className="h-2.5 w-2.5 mr-1" />}
              {isPendingConfirm && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
              {isCancelled && <X className="h-2.5 w-2.5 mr-1" />}
              {statusConfig.statusText}
            </span>
          </div>
          {!expanded && (humanSummary || argsSummary) && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
              {humanSummary || argsSummary}
            </p>
          )}
        </div>

        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-all duration-300 ${expanded ? 'rotate-180' : ''} flex-shrink-0 group-hover:text-slate-600 dark:group-hover:text-slate-300`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-slate-100/80 dark:border-slate-700/50 space-y-3 animate-in slide-in-from-top-2 duration-200">
          {hasArgs && (
            <div className="pt-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-1 w-1 rounded-full bg-violet-400" />
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">参数</p>
              </div>
              <pre className="text-[12px] text-slate-700 dark:text-slate-300 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950 dark:to-slate-900/50 rounded-lg p-3 overflow-auto font-mono max-h-32 border border-slate-200/60 dark:border-slate-700/40 shadow-inner leading-relaxed">
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}

          {showResult && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="h-1 w-1 rounded-full bg-emerald-400" />
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">结果</p>
              </div>
              {resultFiles.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {resultFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => onFileClick(f.id)}
                      className="group/file flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-850 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50/50 dark:hover:bg-violet-900/20 transition-all duration-200 text-left hover:shadow-md hover:shadow-violet-500/5"
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center group-hover/file:from-violet-100 group-hover/file:to-purple-100 dark:group-hover/file:from-violet-900/40 dark:group-hover/file:to-purple-900/30 transition-all duration-200">
                        <File className="h-4 w-4 text-slate-500 group-hover/file:text-violet-600 dark:group-hover/file:text-violet-400 transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate group-hover/file:text-violet-700 dark:group-hover/file:text-violet-300 transition-colors">
                          {f.name}
                        </p>
                      </div>
                      <ExternalLinkIcon />
                    </button>
                  ))}
                </div>
              ) : (
                <pre className="text-[12px] text-slate-700 dark:text-slate-300 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950 dark:to-slate-900/50 rounded-lg p-3 overflow-auto font-mono max-h-40 border border-slate-200/60 dark:border-slate-700/40 shadow-inner leading-relaxed">
                  {typeof tc.result === 'object' && tc.result !== null
                    ? JSON.stringify(tc.result, null, 2)
                    : String(tc.result ?? '')}
                </pre>
              )}
            </div>
          )}

          {isRunning && !tc.result && (
            <div className="pt-2 flex items-center gap-2.5 text-[12px] text-blue-600 dark:text-blue-400">
              <div className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
              <span className="font-medium">正在处理，请稍候…</span>
            </div>
          )}

          {isPendingConfirm && (
            <div className="pt-3 space-y-3">
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 border border-amber-200/70 dark:border-amber-700/50 shadow-sm">
                <div className="flex-shrink-0 mt-0.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <p className="text-[13px] text-amber-800 dark:text-amber-200 flex-1 leading-relaxed font-medium">
                  {confirmMessage || '此操作需要您的确认才能执行'}
                </p>
              </div>

              {previewDiff && <DiffPreview diff={previewDiff} />}

              {/* Phase 7: 草稿预览 */}
              {resultObj && (resultObj.previewType as string) === 'draft' && resultObj.draftContent != null && (
                <DraftPreview
                  content={String(resultObj.draftContent)}
                  fileName={String(resultObj.fileName || 'untitled')}
                />
              )}

              <div className="flex gap-2.5 pt-1">
                <button
                  onClick={() => {
                    if (onConfirmAction && msgId && confirmId) {
                      onConfirmAction(msgId, confirmId);
                    } else if (onConfirm) {
                      onConfirm(tc.toolName, tc.args);
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white text-[13px] font-semibold transition-all duration-200 shadow-md shadow-violet-500/25 hover:shadow-lg hover:shadow-violet-500/30 active:scale-[0.98]"
                >
                  确认执行
                </button>
                <button
                  onClick={() => {
                    if (onCancelConfirm && msgId) {
                      onCancelConfirm(msgId, confirmId);
                    }
                    setExpanded(false);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-[13px] font-semibold transition-all duration-200 active:scale-[0.98]"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-slate-400 opacity-0 group-hover/file:opacity-100 transition-all duration-200 translate-x-1 group-hover/file:translate-x-0"
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
