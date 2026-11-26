/**
 * components/ai/chat/toolMeta.ts
 * 工具展示元数据：label / category 来自后端工具目录（GET /api/ai-chat/tools），
 * 前端只保留图标与分类说明，不再手写 100+ 工具映射。
 *
 * 为什么这样改：手写映射与后端 TOOL_DEFINITIONS 双份维护，新增/改名必然漂移；
 * 后端从描述前缀【】解析 label、从分类表反查 category，天然同源。
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { aiApi } from '@/services/ai';
import type { AiToolCatalog } from '@/services/ai';

export interface ToolMetaEntry {
  label: string;
  category: string;
}

const CATEGORY_ICONS: Record<string, ReactNode> = {
  搜索与发现: <Search className="h-3 w-3" />,
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

let toolMap = new Map<string, ToolMetaEntry>();

function applyCatalog(catalog: AiToolCatalog): void {
  toolMap = new Map(catalog.tools.map((tool) => [tool.name, { label: tool.label, category: tool.category }]));
}

/** 工具目录加载：AIChat / ToolInfoModal 共用同一 query，只请求一次 */
export function useToolCatalog() {
  const query = useQuery({
    queryKey: ['ai-tool-catalog'],
    queryFn: () => aiApi.chatSession.getTools().then((response) => response.data.data),
    staleTime: 30 * 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (query.data) applyCatalog(query.data);
  }, [query.data]);

  return { catalog: query.data, isLoading: query.isLoading };
}

export function getToolMeta(toolName: string): ToolMetaEntry {
  return (
    toolMap.get(toolName) ?? {
      label: toolName.replace(/_/g, ' '),
      category: '其他',
    }
  );
}

export function getToolIcon(toolName: string): ReactNode {
  const meta = getToolMeta(toolName);
  return CATEGORY_ICONS[meta.category] ?? <Sparkles className="h-3 w-3" />;
}

function truncate(value: unknown, max = 30): string {
  return String(value ?? '').slice(0, max);
}

/** 通用参数摘要：取最有信息量的一个字段，不再为每个工具写函数 */
export function summarizeToolCall(toolName: string, args?: Record<string, unknown>): string {
  const meta = getToolMeta(toolName);
  if (!args) return meta.label;

  for (const key of ['query', 'question', 'goal', 'fileName', 'folderName', 'newName', 'path', 'find', 'name']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return `${meta.label}「${truncate(value)}」`;
    }
  }

  for (const key of ['fileIds', 'ids']) {
    const value = args[key];
    if (Array.isArray(value) && value.length > 0) {
      return `${meta.label}（${value.length} 个文件）`;
    }
  }

  for (const key of ['tags', 'tagNames']) {
    const value = args[key];
    if (Array.isArray(value) && value.length > 0) {
      return `${meta.label}（${value.slice(0, 3).join('、')}）`;
    }
  }

  return meta.label;
}

export const CATEGORY_DESC: Record<string, string> = {
  搜索与发现: '关键词搜索、全文检索、标签筛选、重复检测',
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
  其他: '未归类的辅助工具',
};
