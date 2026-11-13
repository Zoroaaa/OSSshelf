import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { purgeUser, USER_REF_CLEANUP } from './accountDeletion';
import type { Env } from '../types/env';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

interface UserRef {
  key: string;
  onDelete: string;
  notNull: boolean;
}

/**
 * 从 migrations 的 DDL 文本里抽取所有引用 users(id) 的列。
 * 同时支持列级 `col ... REFERENCES users(id) ...` 与表级
 * `FOREIGN KEY (col) REFERENCES users(id) ...` 两种写法。
 */
function collectUserRefs(): UserRef[] {
  const refs = new Map<string, UserRef>();
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    const blockRe = /CREATE TABLE (?:IF NOT EXISTS )?["`]?(\w+)["`]?\s*\(([\s\S]*?)\n\);/g;
    let block: RegExpExecArray | null;
    while ((block = blockRe.exec(sql))) {
      scanBody(block[1], block[2], refs);
    }

    const alterRe =
      /ALTER TABLE ["`]?(\w+)["`]?\s+ADD COLUMN\s+["`]?(\w+)["`]?[^;]*?REFERENCES\s+users\s*\(\s*id\s*\)([^;]*);/g;
    let alter: RegExpExecArray | null;
    while ((alter = alterRe.exec(sql))) {
      const [, table, column, def] = alter;
      refs.set(`${table}.${column}`, {
        key: `${table}.${column}`,
        onDelete: onDeleteOf(def),
        notNull: /NOT NULL/i.test(def),
      });
    }
  }

  return Array.from(refs.values());
}

function scanBody(table: string, body: string, refs: Map<string, UserRef>) {
  const lines = body.split('\n').map((l) => l.trim());

  // 列级引用
  for (const line of lines) {
    if (!/REFERENCES\s+users/i.test(line) || /^FOREIGN KEY/i.test(line)) continue;
    const column = /^["`]?(\w+)["`]?\s/.exec(line)?.[1];
    if (!column) continue;
    const beforeRef = line.split(/REFERENCES/i)[0];
    refs.set(`${table}.${column}`, {
      key: `${table}.${column}`,
      onDelete: onDeleteOf(line),
      notNull: /NOT NULL/i.test(beforeRef),
    });
  }

  // 表级外键：用列定义行判断 NOT NULL
  const tableLevelRe = /FOREIGN KEY\s*\(\s*["`]?(\w+)["`]?\s*\)\s*REFERENCES\s+users\s*\(\s*id\s*\)([^,\n]*)/i;
  for (const line of lines) {
    const m = tableLevelRe.exec(line);
    if (!m) continue;
    const column = m[1];
    const columnDef = lines.find((l) => new RegExp('^["`]?' + column + '["`]?\\s').test(l)) ?? '';
    refs.set(`${table}.${column}`, {
      key: `${table}.${column}`,
      onDelete: onDeleteOf(m[2]),
      notNull: /NOT NULL/i.test(columnDef),
    });
  }
}

function onDeleteOf(tail: string): string {
  const m = /ON DELETE (CASCADE|SET NULL|NO ACTION|RESTRICT)/i.exec(tail);
  return m ? m[1].toUpperCase() : 'NO ACTION';
}

describe('账户注销的引用清理清单', () => {
  const refs = collectUserRefs();
  const cleanupKeys = new Set(USER_REF_CLEANUP.map((r) => `${r.table}.${r.column}`));

  it('迁移里能枚举到引用 users(id) 的列', () => {
    expect(refs.length).toBeGreaterThan(20);
  });

  it('所有不会随 users 级联的引用列都已登记清理动作', () => {
    // NO ACTION 一律阻塞；SET NULL 在 NOT NULL 列上同样会失败
    const blocking = refs.filter((r) => r.onDelete === 'NO ACTION' || (r.onDelete === 'SET NULL' && r.notNull));
    const missing = blocking.map((r) => r.key).filter((key) => !cleanupKeys.has(key));

    expect(missing, `缺少清理动作: ${missing.join(', ')}`).toEqual([]);
  });

  it('清单中没有多余或不存在的列', () => {
    const known = new Set(refs.map((r) => r.key));
    const stale = Array.from(cleanupKeys).filter((key) => !known.has(key));
    expect(stale, `清单包含迁移里不存在的引用: ${stale.join(', ')}`).toEqual([]);
  });

  it('数据库可自动处理的 CASCADE / 可空 SET NULL 列不重复登记', () => {
    const autoHandled = refs
      .filter((r) => r.onDelete === 'CASCADE' || (r.onDelete === 'SET NULL' && !r.notNull))
      .map((r) => r.key);
    const duplicated = autoHandled.filter((key) => cleanupKeys.has(key));
    expect(duplicated).toEqual([]);
  });
});

describe('purgeUser 执行顺序', () => {
  function createFakeEnv(ownedTeams: Array<{ id: string; name: string }> = []) {
    const statements: string[] = [];
    const run = async () => ({ success: true, results: [], meta: {} });
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind: () => ({
            run,
            all: async () => ({
              success: true,
              results: sql.includes('FROM teams') ? ownedTeams : [],
              meta: {},
            }),
          }),
        };
      },
      batch: async () => [],
    } as unknown as Env['DB'];

    return { env: { DB: db } as unknown as Env, statements };
  }

  it('先清理引用，最后才删除 users 行', async () => {
    const { env, statements } = createFakeEnv();
    await purgeUser(env, 'u1');

    expect(statements.length).toBeGreaterThan(USER_REF_CLEANUP.length);
    expect(statements[statements.length - 1]).toBe('DELETE FROM users WHERE id = ?');

    for (const ref of USER_REF_CLEANUP) {
      const sql =
        ref.action === 'set-null'
          ? `UPDATE "${ref.table}" SET "${ref.column}" = NULL WHERE "${ref.column}" = ?`
          : `DELETE FROM "${ref.table}" WHERE "${ref.column}" = ?`;
      expect(statements).toContain(sql);
      expect(statements.indexOf(sql)).toBeLessThan(statements.length - 1);
    }
  });

  it('无文件时不产生存储删除队列写入', async () => {
    const { env, statements } = createFakeEnv();
    await purgeUser(env, 'u1');
    expect(statements.some((s) => s.includes('INSERT INTO storage_deletion_queue'))).toBe(false);
  });

  it('仍是团队 owner 时拒绝注销，并带出未转移团队清单', async () => {
    const { env, statements } = createFakeEnv([
      { id: 't1', name: '研发团队' },
      { id: 't2', name: '设计团队' },
    ]);

    await expect(purgeUser(env, 'u1')).rejects.toMatchObject({
      errorCode: 'TEAM_OWNERSHIP_TRANSFER_REQUIRED',
      details: {
        teams: [
          { id: 't1', name: '研发团队' },
          { id: 't2', name: '设计团队' },
        ],
      },
    });
    // 未发生任何写操作，用户仍存续
    expect(statements.some((s) => s.startsWith('DELETE') || s.startsWith('UPDATE'))).toBe(false);
  });

  it('转移后（无 owner 团队）可正常注销', async () => {
    const { env, statements } = createFakeEnv([]);
    await purgeUser(env, 'u1');
    expect(statements[statements.length - 1]).toBe('DELETE FROM users WHERE id = ?');
  });
});
