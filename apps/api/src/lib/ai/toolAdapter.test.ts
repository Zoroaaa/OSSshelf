/**
 * toolAdapter.test.ts
 * 工具选择契约：条件注入 + 上限裁剪不能把多步任务需要的写工具裁掉。
 */

import { describe, expect, it } from 'vitest';
import { AI_TOOL_CONDITIONAL_GROUPS_DEFAULT, AI_TOOL_DEFAULTS } from './aiConfigService';
import { __testSelectToolDefinitions } from './toolAdapter';

const config = {
  groups: AI_TOOL_CONDITIONAL_GROUPS_DEFAULT.groups.map((group) => ({ ...group })),
  alwaysOnSystemTools: [...AI_TOOL_CONDITIONAL_GROUPS_DEFAULT.alwaysOnSystemTools],
};

const select = (query: string, max: number = AI_TOOL_DEFAULTS.maxToolDefinitions) =>
  __testSelectToolDefinitions(query, config, max);

describe('工具条件注入', () => {
  it('默认上限内保留搜索、读取、创建、编辑、删除与计划工具', () => {
    const names = select('帮我整理一下文件');
    expect(names.length).toBeLessThanOrEqual(AI_TOOL_DEFAULTS.maxToolDefinitions);
    for (const required of [
      'update_plan',
      'search_files',
      'read_file_text',
      'list_folder',
      'create_text_file',
      'edit_file_content',
      'delete_file',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('无关键词时不注入分享/权限/存储组', () => {
    const names = select('最近上传了什么');
    expect(names).not.toContain('create_share_link');
    expect(names).not.toContain('grant_permission');
    expect(names).not.toContain('migrate_file_to_bucket');
  });

  it('命中关键词才注入对应组', () => {
    expect(select('帮我生成一个分享链接')).toContain('create_share_link');
    expect(select('给这个文件夹授权给同事')).toContain('grant_permission');
    expect(select('看看存储桶的用量')).toContain('get_storage_usage');
  });

  it('极小上限下仍保留常驻与只读核心工具', () => {
    const names = select('任意问题', 10);
    expect(names.length).toBeLessThanOrEqual(10);
    expect(names).toContain('update_plan');
    expect(names).toContain('search_files');
  });

  it('与问题相关的工具优先进入裁剪后的集合', () => {
    const names = select('把这份文档的版本恢复一下', 40);
    expect(names).toContain('get_file_versions');
    expect(names).toContain('restore_version');
  });
});
