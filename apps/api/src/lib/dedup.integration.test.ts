import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, type DrizzleDb } from '../db';
import { createD1Shim, createMigratedSqlite } from '../test/d1Shim';
import { checkAndClaimDedup, releaseFileRef, isR2KeyReferencedByOtherFile } from './dedup';

let db: DrizzleDb;
let sqlite: ReturnType<typeof createMigratedSqlite>;
const NOW = '2026-11-23T00:00:00.000Z';

function seedUser(id: string) {
  sqlite
    .prepare(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, 'x', '${NOW}', '${NOW}')`
    )
    .run(id, `${id}@t.dev`);
}
function seedFile(o: {
  id: string;
  user: string;
  r2Key: string;
  hash?: string | null;
  bucket?: string | null;
  deleted?: boolean;
  name?: string;
}) {
  sqlite
    .prepare(
      `INSERT INTO files (id, user_id, name, path, type, size, r2_key, hash, bucket_id, ref_count, is_folder, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'application/octet-stream', 10, ?, ?, ?, 1, 0, ?, '${NOW}', '${NOW}')`
    )
    .run(
      o.id,
      o.user,
      o.name ?? o.id,
      `/${o.name ?? o.id}`,
      o.r2Key,
      o.hash ?? null,
      o.bucket ?? null,
      o.deleted ? NOW : null
    );
}
function seedVersion(fileId: string, version: number, r2Key: string) {
  sqlite
    .prepare(
      `INSERT INTO file_versions (id, file_id, version, r2_key, size, ref_count, created_at) VALUES (?, ?, ?, ?, 10, 1, '${NOW}')`
    )
    .run(`${fileId}-v${version}`, fileId, version, r2Key);
}

beforeEach(() => {
  sqlite = createMigratedSqlite();
  db = getDb(createD1Shim(sqlite));
  seedUser('u1');
  seedUser('u2');
});

describe('checkAndClaimDedup', () => {
  it('同用户同桶同 hash 命中并复用 r2Key', async () => {
    seedFile({ id: 'f1', user: 'u1', r2Key: 'k1', hash: 'h' });
    const r = await checkAndClaimDedup(db, 'h', null, 'u1');
    expect(r).toMatchObject({ isDuplicate: true, existingR2Key: 'k1' });
  });

  it('边界：其他用户 / 回收站中的文件不作为去重目标', async () => {
    seedFile({ id: 'f1', user: 'u2', r2Key: 'k1', hash: 'h' });
    seedFile({ id: 'f2', user: 'u1', r2Key: 'k2', hash: 'h', deleted: true });
    expect((await checkAndClaimDedup(db, 'h', null, 'u1')).isDuplicate).toBe(false);
  });
});

describe('releaseFileRef（删除链）', () => {
  it('唯一引用：应删除物理对象', async () => {
    seedFile({ id: 'f1', user: 'u1', r2Key: 'k1' });
    expect((await releaseFileRef(db, 'f1')).shouldDeleteStorage).toBe(true);
  });

  it('共享对象：另一条记录（含回收站）仍引用时不得删除', async () => {
    seedFile({ id: 'f1', user: 'u1', r2Key: 'k1', hash: 'h' });
    seedFile({ id: 'f2', user: 'u1', r2Key: 'k1', hash: 'h', deleted: true });
    expect((await releaseFileRef(db, 'f1')).shouldDeleteStorage).toBe(false);
  });

  it('D3：对象仍被其他文件的历史版本引用时不得删除', async () => {
    seedFile({ id: 'f1', user: 'u1', r2Key: 'shared' });
    seedFile({ id: 'f2', user: 'u1', r2Key: 'other' });
    seedVersion('f2', 1, 'shared');
    expect((await releaseFileRef(db, 'f1')).shouldDeleteStorage).toBe(false);
  });

  it('D3：删除带 3 个版本的文件——版本对象各自独立时，本文件自身的对象应可删除', async () => {
    seedFile({ id: 'f1', user: 'u1', r2Key: 'cur' });
    seedVersion('f1', 1, 'v1');
    seedVersion('f1', 2, 'v2');
    seedVersion('f1', 3, 'cur');
    expect((await releaseFileRef(db, 'f1')).shouldDeleteStorage).toBe(true);
  });
});

describe('isR2KeyReferencedByOtherFile（版本清理侧）', () => {
  it('CoW 副本仍以该 key 为当前对象时，原文件删除旧版本不得删对象', async () => {
    seedFile({ id: 'a', user: 'u1', r2Key: 'k2' });
    seedVersion('a', 1, 'k1');
    seedFile({ id: 'b', user: 'u1', r2Key: 'k1' });
    expect(await isR2KeyReferencedByOtherFile(db, 'k1', 'a')).toBe(true);
  });

  it('另一文件的历史版本引用同一 key 时同样视为被引用', async () => {
    seedFile({ id: 'a', user: 'u1', r2Key: 'ka' });
    seedFile({ id: 'b', user: 'u1', r2Key: 'kb' });
    seedVersion('b', 1, 'ka');
    expect(await isR2KeyReferencedByOtherFile(db, 'ka', 'a')).toBe(true);
  });

  it('无任何其他引用时返回 false', async () => {
    seedFile({ id: 'a', user: 'u1', r2Key: 'ka' });
    seedVersion('a', 1, 'ka');
    expect(await isR2KeyReferencedByOtherFile(db, 'ka', 'a')).toBe(false);
  });
});
