/**
 * tools.test.ts
 * 工具目录契约测试
 *
 * 防止再次出现 WRITE_TOOLS 里的名称与实际工具定义不一致，
 * 从而导致写操作（分享/笔记等）绕过审批。
 */

import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from './index';
import { WRITE_TOOLS } from './types';

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((definition) => definition.function.name));

/** 约定为写操作的命名前缀（update_plan 是只读计划工具，显式排除） */
const WRITE_PREFIXES = [
  'create_',
  'update_',
  'delete_',
  'remove_',
  'revoke_',
  'restore_',
  'rename_',
  'move_',
  'batch_',
  'set_',
  'add_',
  'merge_',
  'grant_',
  'migrate_',
  'tag_',
  'auto_tag_',
  'edit_',
  'append_',
  'draft_',
  'star_',
  'unstar_',
  'manage_',
];
const WRITE_EXACT = ['find_and_replace'];
const READ_ONLY_EXCEPTIONS = new Set(['update_plan']);

describe('工具目录契约', () => {
  it('WRITE_TOOLS 中的每个名称都必须存在于工具定义', () => {
    const unknown = [...WRITE_TOOLS].filter((name) => !TOOL_NAMES.has(name));
    expect(unknown).toEqual([]);
  });

  it('所有写语义工具都必须登记在 WRITE_TOOLS', () => {
    const missing = [...TOOL_NAMES].filter((name) => {
      if (READ_ONLY_EXCEPTIONS.has(name)) return false;
      const isWrite = WRITE_PREFIXES.some((prefix) => name.startsWith(prefix)) || WRITE_EXACT.includes(name);
      return isWrite && !WRITE_TOOLS.has(name);
    });
    expect(missing).toEqual([]);
  });

  it('只读工具不应登记为写操作（update_plan 等）', () => {
    const wronglyMarked = [...READ_ONLY_EXCEPTIONS].filter((name) => WRITE_TOOLS.has(name));
    expect(wronglyMarked).toEqual([]);
  });
});
