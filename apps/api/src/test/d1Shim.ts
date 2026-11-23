/**
 * d1Shim.ts
 * 测试用 D1 垫片：把 migrations/*.sql 真实执行到内存 SQLite（node:sqlite），
 * 再包成 drizzle-orm/d1 能使用的最小 D1Database 接口。
 * 这样 dedup / 记账 / 权限这类依赖真实 SQL 与触发器的逻辑，可以做集成测试而不是 mock。
 *
 * 限制：raw() 通过 Object.values 实现，联表出现同名列时会被合并——测试查询请避免该写法。
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export function createMigratedSqlite(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(migrationsDir)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  return db;
}

type Row = Record<string, unknown>;

class Stmt {
  private params: unknown[] = [];
  constructor(
    private db: DatabaseSync,
    private sql: string
  ) {}
  bind(...p: unknown[]) {
    this.params = p.map((v) => (v === undefined ? null : v));
    return this;
  }
  private run_(): { rows: Row[]; changes: number } {
    const st = this.db.prepare(this.sql) as unknown as {
      all(...p: unknown[]): Row[];
      run(...p: unknown[]): { changes: number | bigint };
    };
    if (/^\s*(select|with|pragma)/i.test(this.sql) || /\breturning\b/i.test(this.sql)) {
      return { rows: st.all(...this.params), changes: 0 };
    }
    return { rows: [], changes: Number(st.run(...this.params).changes) };
  }
  async all() {
    const { rows, changes } = this.run_();
    return { results: rows, success: true, meta: { changes } };
  }
  async run() {
    const { rows, changes } = this.run_();
    return { results: rows, success: true, meta: { changes } };
  }
  async raw() {
    return this.run_().rows.map((r) => Object.values(r));
  }
  async first() {
    return this.run_().rows[0] ?? null;
  }
}

export function createD1Shim(sqlite: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new Stmt(sqlite, sql),
    batch: async (stmts: Stmt[]) => Promise.all(stmts.map((s) => s.all())),
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
}
