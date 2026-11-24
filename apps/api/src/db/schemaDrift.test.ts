/**
 * schemaDrift.test.ts
 * schema 漂移守卫：把 migrations/*.sql 按序真实执行到内存 SQLite，
 * 再与 schema.ts 声明的「表 / 列」做双向对账。
 *
 * 背景：迁移是表结构唯一事实源，schema.ts 只负责类型推导；
 * 一旦两边漂移，轻则查询在运行时报 "no such column"，重则有人
 * 误用 `drizzle-kit generate` 覆盖迁移。此测试在 CI 里把这类问题挡在合并前。
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

function applyMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    try {
      db.exec(readFileSync(path.join(migrationsDir, f), 'utf8'));
    } catch (e) {
      throw new Error(`迁移 ${f} 执行失败：${(e as Error).message}`);
    }
  }
  return db;
}

function migratedColumns(db: DatabaseSync): Map<string, Set<string>> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {
    name: string;
  }[];
  const result = new Map<string, Set<string>>();
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[];
    result.set(name, new Set(cols.map((c) => c.name)));
  }
  return result;
}

function declaredColumns(): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (is(value, SQLiteTable)) {
      const cfg = getTableConfig(value);
      result.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
    }
  }
  return result;
}

/**
 * 已知且已文档化的漂移（只许减少，不许新增）。
 * - ai_config.user_id / value：生产库历史上被手工重建，缺这两列；schema.ts 已刻意不声明（见 schema.ts 注释）。
 */
const KNOWN_DRIFT_IN_SCHEMA_ONLY = new Set<string>([]);
const KNOWN_DRIFT_IN_MIGRATIONS_ONLY = new Set(['ai_config.user_id', 'ai_config.value']);

describe('schema.ts 与 migrations 不漂移', () => {
  const db = applyMigrations();
  const migrated = migratedColumns(db);
  const declared = declaredColumns();

  it('schema.ts 声明的每张表都存在于迁移结果中', () => {
    const missing = [...declared.keys()].filter((t) => !migrated.has(t));
    expect(missing, `schema.ts 声明了迁移里不存在的表：${missing.join(', ')}`).toEqual([]);
  });

  it('schema.ts 声明的每一列都存在于迁移后的真实表中', () => {
    const problems: string[] = [];
    for (const [table, cols] of declared) {
      const real = migrated.get(table);
      if (!real) continue;
      for (const c of cols)
        if (!real.has(c) && !KNOWN_DRIFT_IN_SCHEMA_ONLY.has(`${table}.${c}`)) problems.push(`${table}.${c}`);
    }
    expect(problems, `schema.ts 有迁移里不存在的列（运行时会 no such column）：${problems.join(', ')}`).toEqual([]);
  });

  it('迁移里的每一列都在 schema.ts 中声明（防止漏写导致类型缺字段）', () => {
    const problems: string[] = [];
    for (const [table, cols] of migrated) {
      const decl = declared.get(table);
      if (!decl) continue; // 纯迁移侧的表（如内部/FTS 表）不强制声明
      for (const c of cols)
        if (!decl.has(c) && !KNOWN_DRIFT_IN_MIGRATIONS_ONLY.has(`${table}.${c}`)) problems.push(`${table}.${c}`);
    }
    expect(problems, `迁移里有 schema.ts 未声明的列：${problems.join(', ')}`).toEqual([]);
  });
});

describe('已知漂移白名单不会过期', () => {
  const migrated = migratedColumns(applyMigrations());
  const declared = declaredColumns();

  it('白名单里的条目仍然真实存在（修复后必须从白名单删除）', () => {
    for (const key of KNOWN_DRIFT_IN_SCHEMA_ONLY) {
      const [t, c] = key.split('.');
      expect(declared.get(t!)?.has(c!) && !migrated.get(t!)?.has(c!), `${key} 已不再漂移，请从白名单删除`).toBe(true);
    }
    for (const key of KNOWN_DRIFT_IN_MIGRATIONS_ONLY) {
      const [t, c] = key.split('.');
      expect(migrated.get(t!)?.has(c!) && !declared.get(t!)?.has(c!), `${key} 已不再漂移，请从白名单删除`).toBe(true);
    }
  });
});
