/**
 * 存储记账（触发器是唯一记账源）集成测试：
 * 在真实迁移后的 SQLite 上验证 114 迁移定义的 6 类触发器，以及 checkBucketQuota。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, type DrizzleDb } from '../db';
import { createD1Shim, createMigratedSqlite } from '../test/d1Shim';
import { checkBucketQuota } from './bucketResolver';

let db: DrizzleDb;
let sqlite: ReturnType<typeof createMigratedSqlite>;
const NOW = '2026-11-23T00:00:00.000Z';
const run = (sql: string, ...p: unknown[]) => sqlite.prepare(sql).run(...p);
const get = <T>(sql: string, ...p: unknown[]) =>
  (sqlite.prepare(sql) as unknown as { all(...a: unknown[]): T[] }).all(...p)[0] as T;

const userUsed = () => get<{ storage_used: number }>(`SELECT storage_used FROM users WHERE id='u1'`).storage_used;
const bucket = (id: string) =>
  get<{ storage_used: number; file_count: number }>(
    `SELECT storage_used, file_count FROM storage_buckets WHERE id=?`,
    id
  );

function addBucket(id: string, quota: number | null = null) {
  run(
    `INSERT INTO storage_buckets (id, user_id, name, provider, bucket_name, access_key_id, secret_access_key, storage_used, file_count, storage_quota, created_at, updated_at)
     VALUES (?, 'u1', ?, 's3', 'b', 'a', 's', 0, 0, ?, '${NOW}', '${NOW}')`,
    id,
    id,
    quota
  );
}
function addFile(id: string, size: number, o: { bucket?: string; folder?: boolean } = {}) {
  run(
    `INSERT INTO files (id, user_id, bucket_id, name, path, type, size, r2_key, ref_count, is_folder, created_at, updated_at)
     VALUES (?, 'u1', ?, ?, ?, 'x', ?, ?, 1, ?, '${NOW}', '${NOW}')`,
    id,
    o.bucket ?? 'b1',
    id,
    `/${id}`,
    size,
    `k-${id}`,
    o.folder ? 1 : 0
  );
}

beforeEach(() => {
  sqlite = createMigratedSqlite();
  db = getDb(createD1Shim(sqlite));
  run(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','u1@t.dev','x','${NOW}','${NOW}')`
  );
  addBucket('b1');
  addBucket('b2');
});

describe('存储记账触发器', () => {
  it('插入活跃文件：用户与桶同时 +size，桶文件数 +1（且只记一次）', () => {
    addFile('f1', 100);
    expect(userUsed()).toBe(100);
    expect(bucket('b1')).toEqual({ storage_used: 100, file_count: 1 });
  });

  it('文件夹不记账', () => {
    addFile('d', 999, { folder: true });
    expect(userUsed()).toBe(0);
    expect(bucket('b1')).toEqual({ storage_used: 0, file_count: 0 });
  });

  it('软删除扣减、恢复加回', () => {
    addFile('f1', 100);
    run(`UPDATE files SET deleted_at='${NOW}' WHERE id='f1'`);
    expect(userUsed()).toBe(0);
    expect(bucket('b1')).toEqual({ storage_used: 0, file_count: 0 });
    run(`UPDATE files SET deleted_at=NULL WHERE id='f1'`);
    expect(userUsed()).toBe(100);
    expect(bucket('b1')).toEqual({ storage_used: 100, file_count: 1 });
  });

  it('活跃文件大小变化：按差值调整', () => {
    addFile('f1', 100);
    run(`UPDATE files SET size=250 WHERE id='f1'`);
    expect(userUsed()).toBe(250);
    expect(bucket('b1').storage_used).toBe(250);
  });

  it('换桶：旧桶扣减、新桶增加，用户总量不变', () => {
    addFile('f1', 100);
    run(`UPDATE files SET bucket_id='b2' WHERE id='f1'`);
    expect(bucket('b1')).toEqual({ storage_used: 0, file_count: 0 });
    expect(bucket('b2')).toEqual({ storage_used: 100, file_count: 1 });
    expect(userUsed()).toBe(100);
  });

  it('硬删除活跃文件（如 WebDAV DELETE）：扣减一次', () => {
    addFile('f1', 100);
    run(`DELETE FROM files WHERE id='f1'`);
    expect(userUsed()).toBe(0);
    expect(bucket('b1')).toEqual({ storage_used: 0, file_count: 0 });
  });

  it('已软删除的记录再硬删除：不得二次扣减（防负数/多扣）', () => {
    addFile('f1', 100);
    addFile('f2', 40);
    run(`UPDATE files SET deleted_at='${NOW}' WHERE id='f1'`);
    run(`DELETE FROM files WHERE id='f1'`);
    expect(userUsed()).toBe(40);
    expect(bucket('b1')).toEqual({ storage_used: 40, file_count: 1 });
  });

  it('多文件累计后清空，不出现负数', () => {
    for (let i = 0; i < 5; i++) addFile(`f${i}`, 10);
    run(`DELETE FROM files`);
    expect(userUsed()).toBe(0);
    expect(bucket('b1')).toEqual({ storage_used: 0, file_count: 0 });
  });
});

describe('checkBucketQuota', () => {
  it('桶不存在 / 未设配额：放行', async () => {
    expect(await checkBucketQuota(db, 'nope', 10)).toBeNull();
    expect(await checkBucketQuota(db, 'b1', 10 ** 12)).toBeNull();
  });

  it('恰好用满放行，超出 1 字节拒绝并给出文案', async () => {
    addBucket('q', 1000);
    run(`UPDATE storage_buckets SET storage_used=900 WHERE id='q'`);
    expect(await checkBucketQuota(db, 'q', 100)).toBeNull();
    expect(await checkBucketQuota(db, 'q', 101)).toContain('空间不足');
  });
});
