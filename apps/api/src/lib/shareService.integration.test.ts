import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '../types/env';
import { createD1Shim, createMigratedSqlite } from '../test/d1Shim';
import { createShareLink, revokeShare, updateShare, createUploadLink } from './shareService';

let sqlite: ReturnType<typeof createMigratedSqlite>;
let env: Env;
const NOW = '2026-11-23T00:00:00.000Z';
const run = (sql: string, ...p: unknown[]) => sqlite.prepare(sql).run(...p);
const rows = <T>(sql: string, ...p: unknown[]) =>
  (sqlite.prepare(sql) as unknown as { all(...a: unknown[]): T[] }).all(...p);
const share = (id: string) => rows<Record<string, unknown>>(`SELECT * FROM shares WHERE id=?`, id)[0];

function fakeKV() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  };
}
function user(id: string) {
  run(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, 'x', '${NOW}', '${NOW}')`,
    id,
    `${id}@t.dev`
  );
}
function file(id: string, owner: string, o: { folder?: boolean; deleted?: boolean } = {}) {
  run(
    `INSERT INTO files (id, user_id, name, path, type, size, r2_key, ref_count, is_folder, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'x', 1, ?, 1, ?, ?, '${NOW}', '${NOW}')`,
    id,
    owner,
    id,
    `/${id}`,
    `k-${id}`,
    o.folder ? 1 : 0,
    o.deleted ? NOW : null
  );
}

beforeEach(() => {
  sqlite = createMigratedSqlite();
  env = { DB: createD1Shim(sqlite), KV: fakeKV() } as unknown as Env;
  user('owner');
  user('mallory');
  file('f1', 'owner');
  file('dir', 'owner', { folder: true });
});

describe('createShareLink', () => {
  it('所有者创建：落库，密码只存哈希，maxUses→downloadLimit，expiresAt 规范化为 ISO', async () => {
    const r = await createShareLink(env, 'owner', {
      fileId: 'f1',
      password: 'secret-pw',
      maxUses: 5,
      expiresAt: '2099-01-01T00:00:00Z',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const row = share(r.shareId)!;
    expect(row.password).toBeTruthy();
    expect(row.password).not.toBe('secret-pw');
    expect(row.download_limit).toBe(5);
    expect(row.expires_at).toBe('2099-01-01T00:00:00.000Z');
    expect(row.is_upload_link).toBe(0);
    expect(r.share.hasPassword).toBe(true);
  });

  it('越权：非所有者无权分享，且不产生任何记录', async () => {
    const r = await createShareLink(env, 'mallory', { fileId: 'f1' });
    expect(r).toEqual({ success: false, error: '无权分享此文件' });
    expect(rows(`SELECT id FROM shares`)).toHaveLength(0);
  });

  it('文件不存在：拒绝', async () => {
    expect((await createShareLink(env, 'owner', { fileId: 'nope' })).success).toBe(false);
  });

  it('无密码/无限制：对应列为 NULL', async () => {
    const r = await createShareLink(env, 'owner', { fileId: 'f1' });
    if (!r.success) throw new Error('should succeed');
    expect(share(r.shareId)).toMatchObject({ password: null, download_limit: null, expires_at: null });
  });
});

describe('revokeShare', () => {
  async function mk() {
    const r = await createShareLink(env, 'owner', { fileId: 'f1' });
    if (!r.success) throw new Error('setup failed');
    return r.shareId;
  }

  it('所有者撤销：expires_at 置为当前时间（立即失效）', async () => {
    const id = await mk();
    const before = Date.now();
    expect((await revokeShare(env, 'owner', id)).success).toBe(true);
    expect(new Date(share(id)!.expires_at as string).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('越权：他人不能撤销；不存在的分享报不存在', async () => {
    const id = await mk();
    expect(await revokeShare(env, 'mallory', id)).toEqual({ success: false, error: '无权撤销此分享' });
    expect(share(id)!.expires_at).toBeNull();
    expect(await revokeShare(env, 'owner', 'nope')).toEqual({ success: false, error: '分享链接不存在' });
  });
});

describe('updateShare', () => {
  async function mk() {
    const r = await createShareLink(env, 'owner', { fileId: 'f1', password: 'pw', maxUses: 3 });
    if (!r.success) throw new Error('setup failed');
    return r.shareId;
  }

  it('password=null 清除密码；maxUses=0 清除限制；只报告被修改的字段', async () => {
    const id = await mk();
    const r = await updateShare(env, 'owner', id, { password: null, maxUses: 0 });
    expect(r).toMatchObject({ success: true, changes: ['password', 'downloadLimit'] });
    expect(share(id)).toMatchObject({ password: null, download_limit: null });
  });

  it('什么都不传：无变更且不动数据', async () => {
    const id = await mk();
    const before = share(id);
    expect(await updateShare(env, 'owner', id, {})).toMatchObject({ success: true, changes: [] });
    expect(share(id)).toEqual(before);
  });

  it('越权：非所有者按“不存在”处理，数据不变', async () => {
    const id = await mk();
    const before = share(id);
    expect(await updateShare(env, 'mallory', id, { password: null })).toEqual({
      success: false,
      error: '分享链接不存在',
    });
    expect(share(id)).toEqual(before);
  });
});

describe('createUploadLink', () => {
  it('为自己的文件夹创建：token 40 位、url 含 token、MIME 列表落库', async () => {
    const r = await createUploadLink(env, 'owner', {
      folderId: 'dir',
      allowedMimeTypes: ['image/png', 'image/jpeg'],
      maxUploads: 10,
      maxSizeBytes: 1024,
    });
    if (!r.success) throw new Error('should succeed');
    const row = share(r.uploadLinkId)!;
    expect(row.is_upload_link).toBe(1);
    expect((row.upload_token as string).length).toBe(40);
    expect(r.url).toBe(`/upload/${row.upload_token}`);
    expect(row).toMatchObject({
      upload_allowed_mime_types: 'image/png,image/jpeg',
      max_upload_count: 10,
      max_upload_size: 1024,
    });
  });

  it('有效期上限 720 小时（即使传入更大值）', async () => {
    const r = await createUploadLink(env, 'owner', { folderId: 'dir', expiresInHours: 99999 });
    if (!r.success) throw new Error('should succeed');
    const ms = new Date(share(r.uploadLinkId)!.expires_at as string).getTime() - Date.now();
    expect(ms).toBeLessThanOrEqual(720 * 3600 * 1000 + 5000);
  });

  it('拒绝：普通文件、他人的文件夹、已删除的文件夹', async () => {
    file('gone', 'owner', { folder: true, deleted: true });
    expect((await createUploadLink(env, 'owner', { folderId: 'f1' })).success).toBe(false);
    expect((await createUploadLink(env, 'mallory', { folderId: 'dir' })).success).toBe(false);
    expect((await createUploadLink(env, 'owner', { folderId: 'gone' })).success).toBe(false);
    expect(rows(`SELECT id FROM shares`)).toHaveLength(0);
  });

  it('两次创建的 token 不同', async () => {
    const a = await createUploadLink(env, 'owner', { folderId: 'dir' });
    const b = await createUploadLink(env, 'owner', { folderId: 'dir' });
    if (!a.success || !b.success) throw new Error('should succeed');
    expect(a.url).not.toBe(b.url);
  });
});
