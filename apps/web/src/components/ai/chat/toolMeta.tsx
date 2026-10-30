/**
 * components/ai/chat/toolMeta.ts
 * AI 工具元数据单一来源（label / category / icon / 摘要）
 *
 * 之前 label、图标、摘要、分类分散在 AIChat.tsx、ToolCallCard.tsx、
 * ToolInfoModal.tsx 三处，数量与名称都会漂移。这里统一，所有 UI 只从这里取。
 */

import type { ReactNode } from 'react';
import {
  BarChart3,
  Brain,
  Database,
  FilePlus,
  FileText,
  FolderOpen,
  GitBranch,
  Link2,
  ListTodo,
  Search,
  Settings,
  Shield,
  Sparkles,
  StickyNote,
  Tag,
} from 'lucide-react';

export interface ToolMetaEntry {
  label: string;
  category: string;
  summary?: (args: Record<string, unknown>) => string;
}

const CATEGORY_ICONS: Record<string, ReactNode> = {
  搜索发现: <Search className="h-3 w-3" />,
  内容理解: <FileText className="h-3 w-3" />,
  目录导航: <FolderOpen className="h-3 w-3" />,
  统计分析: <BarChart3 className="h-3 w-3" />,
  文件操作: <FilePlus className="h-3 w-3" />,
  标签管理: <Tag className="h-3 w-3" />,
  分享链接: <Link2 className="h-3 w-3" />,
  版本管理: <GitBranch className="h-3 w-3" />,
  笔记备注: <StickyNote className="h-3 w-3" />,
  权限管理: <Shield className="h-3 w-3" />,
  存储管理: <Database className="h-3 w-3" />,
  系统管理: <Settings className="h-3 w-3" />,
  AI增强: <Brain className="h-3 w-3" />,
  任务规划: <ListTodo className="h-3 w-3" />,
};

function str(value: unknown, max = 40): string {
  return String(value ?? '').slice(0, max);
}

export const TOOL_META: Record<string, ToolMetaEntry> = {
  // ── 搜索发现 ──
  search_files: { label: '搜索文件', category: '搜索发现', summary: (a) => `搜索「${str(a.query)}」` },
  search_content: { label: '全文检索', category: '搜索发现', summary: (a) => `检索内容「${str(a.query)}」` },
  smart_search: { label: '智能搜索', category: '搜索发现', summary: (a) => `智能搜索「${str(a.query, 30)}」` },
  filter_files: {
    label: '筛选文件',
    category: '搜索发现',
    summary: (a) => {
      const parts: string[] = [];
      if (a.mimeTypePrefix) parts.push(`类型 ${String(a.mimeTypePrefix).split('/')[0]}`);
      if (a.minSize) parts.push(`≥${a.minSize}B`);
      if (a.dateFrom) parts.push(`从 ${String(a.dateFrom).slice(0, 10)}`);
      return parts.length ? `筛选文件（${parts.join('、')}）` : '筛选文件';
    },
  },
  search_by_tag: {
    label: '标签搜索',
    category: '搜索发现',
    summary: (a) =>
      `按标签搜索「${Array.isArray(a.tagNames) ? (a.tagNames as string[]).join('、') : str(a.tagNames)}」`,
  },
  search_duplicates: { label: '查找重复文件', category: '搜索发现' },
  get_similar_files: { label: '相似文件', category: '搜索发现' },
  get_file_details: { label: '文件详情', category: '搜索发现' },
  get_starred_files: { label: '收藏文件', category: '搜索发现' },

  // ── 内容理解 ──
  read_file_text: { label: '读取文件内容', category: '内容理解' },
  analyze_image: {
    label: '分析图片',
    category: '内容理解',
    summary: (a) => (a.question ? `分析图片：${str(a.question, 30)}` : 'AI 分析图片'),
  },
  compare_files: { label: '对比文件', category: '内容理解' },
  extract_metadata: { label: '提取元数据', category: '内容理解' },
  generate_summary: {
    label: '生成摘要',
    category: '内容理解',
    summary: (a) => (a.forceRegenerate ? '重新生成摘要' : '生成 AI 摘要'),
  },
  generate_tags: {
    label: '生成标签',
    category: '内容理解',
    summary: (a) => `生成标签（最多 ${a.maxTags ?? 5} 个）`,
  },
  content_preview: {
    label: '内容预览',
    category: '内容理解',
    summary: (a) => `预览前 ${a.lines ?? 50} 行`,
  },

  // ── 目录导航 ──
  navigate_path: { label: '路径导航', category: '目录导航', summary: (a) => `导航到 ${str(a.path ?? a.folderId)}` },
  list_folder: {
    label: '浏览文件夹',
    category: '目录导航',
    summary: (a) => (a.folderId ? '浏览文件夹' : '浏览根目录'),
  },
  get_recent_files: {
    label: '最近文件',
    category: '目录导航',
    summary: (a) => `最近${a.days ? ` ${a.days} 天` : ''}文件`,
  },
  get_parent_chain: { label: '父级链路', category: '目录导航' },
  get_folder_tree: {
    label: '查看目录树',
    category: '目录导航',
    summary: (a) => `目录树${a.depth ? `（深度 ${a.depth}）` : ''}`,
  },
  get_storage_overview: { label: '存储概览', category: '目录导航' },

  // ── 统计分析 ──
  get_storage_stats: {
    label: '存储统计',
    category: '统计分析',
    summary: (a) => `按 ${a.dimension ?? 'mimetype'} 统计`,
  },
  get_activity_stats: { label: '活动趋势', category: '统计分析', summary: (a) => `周期 ${a.period ?? 'day'}` },
  get_user_quota_info: { label: '配额信息', category: '统计分析' },
  get_file_type_distribution: {
    label: '文件类型分布',
    category: '统计分析',
    summary: (a) => `按 ${a.groupBy ?? 'category'} 分组`,
  },
  get_sharing_stats: { label: '分享统计', category: '统计分析' },

  // ── 文件操作 ──
  create_text_file: { label: '创建文本文件', category: '文件操作', summary: (a) => `创建「${str(a.fileName, 30)}」` },
  create_code_file: { label: '创建代码文件', category: '文件操作', summary: (a) => `创建「${str(a.fileName, 30)}」` },
  create_file_from_template: {
    label: '从模板创建',
    category: '文件操作',
    summary: (a) => `模板「${str(a.templateName, 20)}」`,
  },
  edit_file_content: { label: '编辑文件', category: '文件操作', summary: (a) => `编辑 ${a.editCount ?? ''} 处内容` },
  append_to_file: { label: '追加内容', category: '文件操作' },
  find_and_replace: {
    label: '查找替换',
    category: '文件操作',
    summary: (a) => `替换「${str(a.find, 20)}」`,
  },
  rename_file: { label: '重命名', category: '文件操作', summary: (a) => `重命名为「${str(a.newName, 30)}」` },
  move_file: {
    label: '移动文件',
    category: '文件操作',
    summary: (a) => `移动到 ${str(a.targetFolderPath ?? a.targetFolderId)}`,
  },
  delete_file: { label: '删除文件', category: '文件操作' },
  restore_file: { label: '恢复文件', category: '文件操作' },
  create_folder: { label: '创建文件夹', category: '文件操作', summary: (a) => `创建「${str(a.folderName, 30)}」` },
  draft_and_create_file: {
    label: '草稿创建文件',
    category: '文件操作',
    summary: (a) => `创建「${str(a.fileName, 30)}」`,
  },
  batch_rename: {
    label: '批量重命名',
    category: '文件操作',
    summary: (a) => `批量重命名（${Array.isArray(a.fileIds) ? a.fileIds.length : '?'} 个）`,
  },
  batch_move: {
    label: '批量移动',
    category: '文件操作',
    summary: (a) => `批量移动（${Array.isArray(a.fileIds) ? a.fileIds.length : '?'} 个）`,
  },
  batch_delete: {
    label: '批量删除',
    category: '文件操作',
    summary: (a) => `批量删除（${Array.isArray(a.fileIds) ? a.fileIds.length : '?'} 个）`,
  },
  star_file: { label: '收藏文件', category: '文件操作' },
  unstar_file: { label: '取消收藏', category: '文件操作' },

  // ── 标签管理 ──
  add_tag: {
    label: '添加标签',
    category: '标签管理',
    summary: (a) => `添加「${Array.isArray(a.tags) ? (a.tags as string[]).join('、') : str(a.tags)}」`,
  },
  remove_tag: {
    label: '移除标签',
    category: '标签管理',
    summary: (a) => `移除「${Array.isArray(a.tagNames) ? (a.tagNames as string[]).join('、') : str(a.tagNames)}」`,
  },
  get_file_tags: { label: '文件标签', category: '标签管理' },
  list_all_tags_for_management: { label: '标签库', category: '标签管理' },
  merge_tags: { label: '合并标签', category: '标签管理', summary: (a) => `${str(a.sourceTag)} → ${str(a.targetTag)}` },
  auto_tag_files: {
    label: '智能打标签',
    category: '标签管理',
    summary: (a) => `处理 ${Array.isArray(a.fileIds) ? a.fileIds.length : '?'} 个文件`,
  },
  tag_folder: { label: '文件夹打标', category: '标签管理', summary: (a) => (a.recursive ? '递归打标' : '文件夹打标') },

  // ── 分享链接 ──
  create_share_link: {
    label: '创建分享链接',
    category: '分享链接',
    summary: (a) => `创建分享${a.password ? '（有密码）' : ''}`,
  },
  list_shares: { label: '分享列表', category: '分享链接' },
  update_share_settings: { label: '更新分享设置', category: '分享链接' },
  revoke_share: { label: '撤销分享', category: '分享链接' },
  get_share_stats: { label: '分享统计', category: '分享链接' },
  create_direct_link: {
    label: '创建直链',
    category: '分享链接',
    summary: (a) => `直链（${a.expiresInHours ?? 168}h）`,
  },
  revoke_direct_link: { label: '撤销直链', category: '分享链接' },
  create_upload_link_for_folder: { label: '创建上传链接', category: '分享链接' },

  // ── 版本管理 ──
  get_file_versions: { label: '版本历史', category: '版本管理' },
  restore_version: { label: '恢复版本', category: '版本管理' },
  compare_versions: { label: '对比版本', category: '版本管理', summary: (a) => `${a.versionA} vs ${a.versionB}` },
  set_version_retention: {
    label: '版本保留策略',
    category: '版本管理',
    summary: (a) => `${a.maxVersions ?? 10} 版 / ${a.retentionDays ?? 30} 天`,
  },

  // ── 笔记备注 ──
  add_note: { label: '添加备注', category: '笔记备注' },
  get_notes: { label: '备注列表', category: '笔记备注' },
  update_note: { label: '更新备注', category: '笔记备注' },
  delete_note: { label: '删除备注', category: '笔记备注' },
  search_notes: { label: '搜索备注', category: '笔记备注', summary: (a) => `「${str(a.query, 30)}」` },

  // ── 权限管理 ──
  get_file_permissions: { label: '查看权限', category: '权限管理' },
  grant_permission: { label: '授权访问', category: '权限管理', summary: (a) => `${a.permissionLevel ?? ''} 权限` },
  revoke_permission: { label: '撤销权限', category: '权限管理' },
  set_folder_access_level: { label: '设置访问级别', category: '权限管理', summary: (a) => `${a.accessLevel ?? ''}` },
  list_user_groups: { label: '用户组列表', category: '权限管理' },
  manage_group_members: {
    label: '管理组成员',
    category: '权限管理',
    summary: (a) => `${a.action === 'add' ? '添加' : '移除'}成员`,
  },
  list_expired_permissions: { label: '过期权限', category: '权限管理' },

  // ── 存储管理 ──
  list_buckets: { label: '存储桶列表', category: '存储管理' },
  get_bucket_info: { label: '存储桶详情', category: '存储管理' },
  set_default_bucket: { label: '设默认桶', category: '存储管理' },
  migrate_file_to_bucket: { label: '迁移文件', category: '存储管理' },
  get_storage_usage: { label: '存储用量', category: '存储管理' },
  get_large_files: { label: '大文件列表', category: '存储管理', summary: (a) => `Top ${a.limit ?? 20}` },
  get_folder_sizes: { label: '文件夹大小', category: '存储管理', summary: (a) => `Top ${a.topN ?? 10}` },
  get_cleanup_suggestions: { label: '清理建议', category: '存储管理' },

  // ── 系统管理 ──
  get_system_status: { label: '系统状态', category: '系统管理' },
  get_help: { label: '帮助信息', category: '系统管理', summary: (a) => `${a.topic ?? '总览'}` },
  get_version_info: { label: '版本信息', category: '系统管理' },
  get_faq: { label: '常见问题', category: '系统管理', summary: (a) => `${a.category ?? '全部'}` },
  get_user_profile: { label: '用户信息', category: '系统管理' },
  list_api_keys: { label: 'API 密钥列表', category: '系统管理' },
  create_api_key: { label: '创建 API 密钥', category: '系统管理', summary: (a) => `「${str(a.name, 20)}」` },
  revoke_api_key: { label: '撤销 API 密钥', category: '系统管理' },
  list_webhooks: { label: 'Webhook 列表', category: '系统管理' },
  create_webhook: { label: '创建 Webhook', category: '系统管理' },
  get_audit_logs: { label: '审计日志', category: '系统管理', summary: (a) => `${a.action ?? ''}` },

  // ── AI 增强 ──
  trigger_ai_summary: { label: 'AI 摘要', category: 'AI增强' },
  trigger_ai_tags: { label: 'AI 标签', category: 'AI增强', summary: (a) => `${a.maxTags ?? 5} 个` },
  rebuild_vector_index: {
    label: '重建向量索引',
    category: 'AI增强',
    summary: (a) => (a.fileId ? '单文件' : a.forceAll ? '全量强制' : '增量'),
  },
  ask_rag_question: { label: 'RAG 问答', category: 'AI增强', summary: (a) => `「${str(a.question)}」` },
  smart_rename_suggest: { label: '智能重命名', category: 'AI增强', summary: (a) => `${a.style ?? 'descriptive'}` },
  smart_organize_suggest: { label: '整理建议', category: 'AI增强', summary: (a) => `${a.scope ?? 'all'}` },
  analyze_file_collection: {
    label: '文件集合分析',
    category: 'AI增强',
    summary: (a) => `${a.scope === 'folder' ? '文件夹' : '文件集合'}分析`,
  },

  // ── 任务规划 ──
  update_plan: { label: '更新执行计划', category: '任务规划', summary: (a) => `${str(a.goal, 30)}` },
};

export function getToolMeta(toolName: string): ToolMetaEntry {
  return (
    TOOL_META[toolName] ?? {
      label: toolName.replace(/_/g, ' '),
      category: '其他',
    }
  );
}

export function getToolIcon(toolName: string): ReactNode {
  const meta = getToolMeta(toolName);
  return CATEGORY_ICONS[meta.category] ?? <Sparkles className="h-3 w-3" />;
}

/** 生成人类可读摘要；无摘要函数时退回工具名 */
export function summarizeToolCall(toolName: string, args?: Record<string, unknown>): string {
  const meta = getToolMeta(toolName);
  if (!args || !meta.summary) return meta.label;
  try {
    return meta.summary(args);
  } catch {
    return meta.label;
  }
}

/** 按分类聚合，供工具说明弹窗使用 */
export function groupedToolMeta(): Array<{ category: string; tools: Array<{ name: string; label: string }> }> {
  const groups = new Map<string, Array<{ name: string; label: string }>>();
  for (const [name, meta] of Object.entries(TOOL_META)) {
    const list = groups.get(meta.category) ?? [];
    list.push({ name, label: meta.label });
    groups.set(meta.category, list);
  }
  return Array.from(groups.entries()).map(([category, tools]) => ({ category, tools }));
}

export const CATEGORY_DESC: Record<string, string> = {
  搜索发现: '关键词搜索、全文检索、标签筛选、重复检测',
  内容理解: '读取文本、分析图片、提取元数据、AI 摘要/标签',
  目录导航: '浏览目录、路径导航、目录树、最近文件',
  统计分析: '存储统计、活动趋势、配额、类型分布、分享统计',
  文件操作: '创建/编辑/移动/重命名/删除/批量操作/收藏',
  标签管理: '增删标签、合并标签、文件夹打标、自动打标',
  分享链接: '分享链接、直链、上传链接、权限与有效期',
  版本管理: '版本历史、回滚、版本对比、保留策略',
  笔记备注: '文件备注的增删改查与搜索',
  权限管理: '授权、撤销、访问级别、用户组、过期授权',
  存储管理: '存储桶与用量、大文件、文件夹占用、清理建议',
  系统管理: '系统状态、帮助、API Key、Webhook、审计日志',
  AI增强: '摘要/标签触发、向量索引、RAG、重命名与整理建议',
  任务规划: '多步任务的执行计划与进度',
};
