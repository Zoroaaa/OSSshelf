/**
 * tags.integration.test.ts
 * 标签路由集成测试：在真实迁移 + 外键校验（与线上 D1 一致）的内存 SQLite 上直跑 /tags/* 处理器。
 *
 * 回归点：「还没挂到任何文件上」的标签定义行必须能创建、能在 /tags/user 里被选到，
 * 且不计入 /tags/stats 的文件数。此前定义行用 file_id='' 占位，外键校验下插入必然失败
 * （接口 500），标签库里只剩已经挂在文件上的标签，新建标签永远失败。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import app from './permissions';
import { installErrorHandler } from '../middleware/error';
import { signJWT } from '../lib/crypto';
import { createD1Shim, createMigratedSqlite } from '../test/d1Shim';
import type { Env } from '../types/env';

// 子应用默认不带统一错误处理（线上由 index.ts 安装），这里补上才能断言业务状态码
installErrorHandler(app);

const SECRET = 'tag-integration-secret';
const NOW = '2026-11-26T00:00:00.000Z';

interface TagBody {
  id: string;
  fileId: string | null;
  name: string;
  color: string;
  createdAt: string;
}

let sqlite: ReturnType<typeof createMigratedSqlite>;
let env: Env;
let token: string;
const sessions = new Map<string, string>();

const run = (sql: string, ...params: unknown[]) => sqlite.prepare(sql).run(...params);

async function call(path: string, init: RequestInit = {}) {
  const res = await app.request(
    path,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    },
    env
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const createTag = (name: string, color?: string) =>
  call('/tags/create', { method: 'POST', body: JSON.stringify({ name, color }) });
const userTags = async () => ((await call('/tags/user')).body.data ?? []) as TagBody[];
const tagStats = async () => ((await call('/tags/stats')).body.data ?? []) as Array<{ name: string; count: number }>;

beforeEach(async () => {
  sessions.clear();
  sqlite = createMigratedSqlite();
  env = {
    DB: createD1Shim(sqlite),
    JWT_SECRET: SECRET,
    ENVIRONMENT: 'test',
    KV: {
      get: async (key: string) => sessions.get(key) ?? null,
      put: async (key: string, value: string) => void sessions.set(key, value),
      delete: async (key: string) => void sessions.delete(key),
    },
  } as unknown as Env;

  run(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','u1@t.dev','x','${NOW}','${NOW}')`
  );
  token = await signJWT({ userId: 'u1', email: 'u1@t.dev', role: 'user' }, SECRET);
  sessions.set(`session:${token}`, '{}');
});

function addFile(id: string) {
  run(
    `INSERT INTO files (id, user_id, name, path, r2_key, created_at, updated_at)
     VALUES ('${id}', 'u1', '${id}.txt', '/${id}.txt', 'k-${id}', '${NOW}', '${NOW}')`
  );
}

describe('标签定义（未被文件引用）', () => {
  it('可以创建，并出现在 /tags/user 里（此前定义行违反 files 外键，创建必然失败）', async () => {
    const created = await createTag('待用标签', '#ff0000');
    expect(created.status).toBe(200);

    const tags = await userTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ name: '待用标签', color: '#ff0000', fileId: null });
  });

  it('未引用的标签不计入 /tags/stats 的文件数', async () => {
    await createTag('待用标签');
    expect(await tagStats()).toEqual([]);
  });

  it('同名标签重复创建返回 TAG_EXISTS', async () => {
    await createTag('重要');
    const again = await createTag('重要');
    expect(again.status).toBe(409);
    expect(again.body.error.name).toBe('TAG_EXISTS');
  });
});

describe('标签挂载与移除', () => {
  it('挂到文件后计入统计；从文件移除后标签仍在标签库里可选', async () => {
    addFile('f1');
    await createTag('待用标签');

    const added = await call('/tags/add', {
      method: 'POST',
      body: JSON.stringify({ fileId: 'f1', name: '待用标签' }),
    });
    expect(added.status).toBe(200);

    const fileTags = ((await call('/tags/file/f1')).body.data ?? []) as TagBody[];
    expect(fileTags.map((t) => t.name)).toEqual(['待用标签']);
    expect(await tagStats()).toEqual([{ name: '待用标签', count: 1 }]);

    const removed = await call('/tags/remove', {
      method: 'POST',
      body: JSON.stringify({ fileId: 'f1', tagName: '待用标签' }),
    });
    expect(removed.status).toBe(200);

    // 关键：移除关联只删关联行，标签定义还在，用户仍能选到
    expect((await userTags()).map((t) => t.name)).toEqual(['待用标签']);
    expect(await tagStats()).toEqual([]);
  });

  it('删除文件时级联清掉关联行，保留标签定义', async () => {
    addFile('f1');
    await createTag('待用标签');
    await call('/tags/add', { method: 'POST', body: JSON.stringify({ fileId: 'f1', name: '待用标签' }) });

    run(`DELETE FROM files WHERE id='f1'`);

    const rows = sqlite.prepare(`SELECT file_id FROM file_tags`).all() as Array<{ file_id: string | null }>;
    expect(rows).toEqual([{ file_id: null }]);
  });
});

describe('标签重命名与删除', () => {
  it('重命名定义行后 /tags/user 显示新名字', async () => {
    await createTag('旧名');
    const renamed = await call('/tags/rename', {
      method: 'PUT',
      body: JSON.stringify({ oldName: '旧名', newName: '新名' }),
    });
    expect(renamed.status).toBe(200);
    expect((await userTags()).map((t) => t.name)).toEqual(['新名']);
  });

  it('删除标签同时清掉定义行', async () => {
    addFile('f1');
    await createTag('待删');
    await call('/tags/add', { method: 'POST', body: JSON.stringify({ fileId: 'f1', name: '待删' }) });

    const deleted = await call(`/tags/${encodeURIComponent('待删')}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await userTags()).toEqual([]);
    expect(sqlite.prepare(`SELECT id FROM file_tags`).all()).toEqual([]);
  });
});
