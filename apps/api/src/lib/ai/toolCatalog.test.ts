/**
 * toolCatalog.test.ts
 * 工具目录契约：覆盖全部定义、分类与 label 可用、无重复。
 */

import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from './agentTools';
import { buildToolCatalog } from './toolCatalog';

describe('buildToolCatalog', () => {
  const catalog = buildToolCatalog();

  it('覆盖全部工具定义且不重复', () => {
    expect(catalog.tools).toHaveLength(TOOL_DEFINITIONS.length);
    const names = catalog.tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('update_plan');
    expect(names).toContain('search_files');
  });

  it('每个工具都有非空 label 与 category', () => {
    for (const tool of catalog.tools) {
      expect(tool.label.trim().length).toBeGreaterThan(0);
      expect(tool.category.trim().length).toBeGreaterThan(0);
      expect(tool.label).not.toContain('undefined');
    }
  });

  it('分类从后端分类表反查', () => {
    const byName = new Map(catalog.tools.map((tool) => [tool.name, tool]));
    expect(byName.get('search_files')?.category).toBe('搜索与发现');
    expect(byName.get('create_share_link')?.category).toBe('分享链接');
    expect(byName.get('restore_version')?.category).toBe('版本管理');
    expect(byName.get('update_plan')?.category).toBe('任务规划');
  });

  it('分类计数与工具数一致', () => {
    const total = catalog.categories.reduce((sum, category) => sum + category.count, 0);
    expect(total).toBe(catalog.tools.length);
  });

  it('label 优先取描述前缀【】', () => {
    const byName = new Map(catalog.tools.map((tool) => [tool.name, tool]));
    expect(byName.get('get_file_versions')?.label).toBe('获取版本历史');
  });
});
