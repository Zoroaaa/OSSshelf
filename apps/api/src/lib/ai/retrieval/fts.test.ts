/**
 * retrieval/fts.test.ts
 * FTS5 契约测试：表结构（122 迁移）+ 中文前缀匹配 + 表达式清洗。
 *
 * 背景：070/110 两次定义 files_fts 造成列名漂移，运行时永久回退 LIKE；
 * 且 unicode61 把连续中文当一个 token，不加前缀星号时中文关键词检索形同虚设。
 */

import { describe, expect, it } from 'vitest';
import { createMigratedSqlite } from '../../../test/d1Shim';
import { buildFtsMatchQuery } from './fts';

function seed(sqlite: ReturnType<typeof createMigratedSqlite>) {
  const stmt = sqlite.prepare(
    'INSERT INTO files_fts_v2 (file_id, name, description, ai_summary, ai_tags) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run('f1', '季度报告2026', '财务', '全年预算', '项目 重要');
  stmt.run('f2', '产品需求文档', '需求说明', '登录改版', '项目');
  stmt.run('f3', 'notes.md', 'meeting notes', 'quarterly budget', 'project');
}

describe('FTS v2', () => {
  it('迁移后的表列名统一为 file_id', () => {
    const sqlite = createMigratedSqlite();
    const columns = sqlite.prepare("SELECT name FROM pragma_table_info('files_fts_v2')").all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toEqual(['file_id', 'name', 'description', 'ai_summary', 'ai_tags']);
  });

  it('中文两字关键词可命中（前缀查询）', () => {
    const sqlite = createMigratedSqlite();
    seed(sqlite);
    const match = buildFtsMatchQuery('季度', 8);
    expect(match).toBe('"季度"*');

    const rows = sqlite.prepare('SELECT file_id FROM files_fts_v2 WHERE files_fts_v2 MATCH ?').all(match) as Array<{
      file_id: string;
    }>;
    expect(rows.map((row) => row.file_id)).toEqual(['f1']);
  });

  it('标签列可检索', () => {
    const sqlite = createMigratedSqlite();
    seed(sqlite);
    const rows = sqlite
      .prepare('SELECT file_id FROM files_fts_v2 WHERE files_fts_v2 MATCH ?')
      .all(buildFtsMatchQuery('重要', 8)) as Array<{ file_id: string }>;
    expect(rows.map((row) => row.file_id)).toEqual(['f1']);
  });

  it('英文前缀与多 token OR', () => {
    const sqlite = createMigratedSqlite();
    seed(sqlite);
    const match = buildFtsMatchQuery('budget meet', 8);
    expect(match).toBe('"budget"* OR "meet"*');
    const rows = sqlite.prepare('SELECT file_id FROM files_fts_v2 WHERE files_fts_v2 MATCH ?').all(match) as Array<{
      file_id: string;
    }>;
    expect(rows.map((row) => row.file_id)).toContain('f3');
  });

  it('清洗 FTS 操作符并限制 token 数', () => {
    const cleaned = buildFtsMatchQuery('a"b*c(d)e', 8);
    expect(cleaned).toBe('"a"* OR "b"* OR "c"* OR "d"* OR "e"*');
    expect(cleaned).not.toMatch(/[()]/);
    expect(buildFtsMatchQuery('a b c d', 2)).toBe('"a"* OR "b"*');
    expect(buildFtsMatchQuery('   ', 8)).toBe('');
  });
});
