/**
 * ai/toolCatalog.ts
 * 工具目录的唯一来源：从 TOOL_DEFINITIONS + 分类表派生前端展示元数据。
 *
 * 之前前端 toolMeta.tsx 手写 100+ 条 label/category，与后端定义双份维护，
 * 新增工具必然漂移（前端显示 "unknown tool" 或错误分类）。
 * 现在前端只拿这份目录，label 从描述前缀【】解析，分类从 getToolsByCategory 反查。
 */

import { TOOL_DEFINITIONS, getToolsByCategory } from './agentTools';

export interface ToolCatalogEntry {
  name: string;
  label: string;
  category: string;
  description: string;
}

export interface ToolCatalog {
  tools: ToolCatalogEntry[];
  categories: Array<{ name: string; count: number }>;
}

const CATEGORY_ORDER = [
  '搜索与发现',
  '内容理解',
  '目录导航',
  '统计分析',
  '文件操作',
  '标签管理',
  '分享链接',
  '版本管理',
  '笔记备注',
  '权限管理',
  '存储管理',
  '系统管理',
  'AI增强',
  '任务规划',
  '其他',
];

/** 分类键形如 "🔍 搜索与发现"，去掉前面的图标与空白 */
function normalizeCategory(key: string): string {
  return key.replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '').trim() || key;
}

function parseLabel(name: string, description: string): string {
  const bracket = /^【([^】]{2,24})】/.exec(description.trim());
  if (bracket?.[1]) return bracket[1];
  return name.replace(/_/g, ' ');
}

function parseDescription(description: string): string {
  const trimmed = description.trim();
  const withoutLabel = trimmed.replace(/^【[^】]*】\s*/, '');
  return withoutLabel.slice(0, 200);
}

export function buildToolCatalog(): ToolCatalog {
  const categoryMap = getToolsByCategory();
  const toolCategory = new Map<string, string>();
  for (const [rawCategory, names] of Object.entries(categoryMap)) {
    const category = normalizeCategory(rawCategory);
    for (const name of names) toolCategory.set(name, category);
  }
  // 计划工具不在业务分类表里，单独归属
  toolCategory.set('update_plan', '任务规划');

  const tools: ToolCatalogEntry[] = TOOL_DEFINITIONS.map((definition) => {
    const name = definition.function.name;
    return {
      name,
      label: parseLabel(name, definition.function.description),
      category: toolCategory.get(name) ?? '其他',
      description: parseDescription(definition.function.description),
    };
  });

  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);

  const categories = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.name);
      const bi = CATEGORY_ORDER.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

  tools.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    const categoryDiff = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return categoryDiff || a.name.localeCompare(b.name);
  });

  return { tools, categories };
}
