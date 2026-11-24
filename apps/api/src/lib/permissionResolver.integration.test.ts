import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, type DrizzleDb } from '../db';
import type { Env } from '../types/env';
import { createD1Shim, createMigratedSqlite } from '../test/d1Shim';
import { resolveEffectivePermission } from './permissionResolver';

let db: DrizzleDb;
let sqlite: ReturnType<typeof createMigratedSqlite>;
const NOW = '2026-11-23T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const env = {} as Env;

const run = (sql: string, ...p: unknown[]) => sqlite.prepare(sql).run(...p);

function user(id: string) {
  run(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, 'x', '${NOW}', '${NOW}')`,
    id,
    `${id}@t.dev`
  );
}
function file(id: string, owner: string, o: { parent?: string; teamId?: string; folder?: boolean } = {}) {
  run(
    `INSERT INTO files (id, user_id, parent_id, name, path, type, size, r2_key, ref_count, is_folder, team_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'x', 1, ?, 1, ?, ?, '${NOW}', '${NOW}')`,
    id,
    owner,
    o.parent ?? null,
    id,
    `/${id}`,
    `k-${id}`,
    o.folder ? 1 : 0,
    o.teamId ?? null
  );
}
function grant(
  fileId: string,
  o: { user?: string; group?: string; team?: string; perm: string; expires?: string | null; inherit?: boolean }
) {
  const subject = o.user ? 'user' : o.group ? 'group' : 'team';
  run(
    `INSERT INTO file_permissions (id, file_id, user_id, group_id, team_id, subject_type, permission, granted_by, expires_at, inherit_to_children, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', ?, ?, '${NOW}', '${NOW}')`,
    `p-${Math.random()}`,
    fileId,
    o.user ?? null,
    o.group ?? null,
    o.team ?? null,
    subject,
    o.perm,
    o.expires ?? null,
    o.inherit ? 1 : 0
  );
}
function group(id: string, members: string[]) {
  run(
    `INSERT INTO user_groups (id, owner_id, name, created_at, updated_at) VALUES (?, 'owner', ?, '${NOW}', '${NOW}')`,
    id,
    id
  );
  for (const m of members)
    run(
      `INSERT INTO group_members (id, group_id, user_id, created_at) VALUES (?, ?, ?, '${NOW}')`,
      `gm-${id}-${m}`,
      id,
      m
    );
}
function team(id: string, members: Record<string, string>) {
  run(
    `INSERT INTO teams (id, owner_id, name, created_at, updated_at) VALUES (?, 'owner', ?, '${NOW}', '${NOW}')`,
    id,
    id
  );
  for (const [u, role] of Object.entries(members))
    run(
      `INSERT INTO team_members (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, ?, '${NOW}')`,
      `tm-${id}-${u}`,
      id,
      u,
      role
    );
}

const check = (fileId: string, userId: string, level: 'read' | 'write' | 'admin') =>
  resolveEffectivePermission(db, env, fileId, userId, level);

beforeEach(() => {
  sqlite = createMigratedSqlite();
  db = getDb(createD1Shim(sqlite));
  for (const u of ['owner', 'alice', 'bob']) user(u);
});

describe('resolveEffectivePermission', () => {
  it('文件不存在：无权限', async () => {
    expect((await check('nope', 'alice', 'read')).hasAccess).toBe(false);
  });

  it('所有者：admin，来源 owner', async () => {
    file('f', 'owner');
    expect(await check('f', 'owner', 'admin')).toMatchObject({ hasAccess: true, permission: 'admin', source: 'owner' });
  });

  it('无任何授权：拒绝', async () => {
    file('f', 'owner');
    expect(await check('f', 'alice', 'read')).toMatchObject({ hasAccess: false, permission: null });
  });

  it('显式 read：满足 read、不满足 write，且返回真实权限级别', async () => {
    file('f', 'owner');
    grant('f', { user: 'alice', perm: 'read' });
    expect((await check('f', 'alice', 'read')).hasAccess).toBe(true);
    expect(await check('f', 'alice', 'write')).toMatchObject({
      hasAccess: false,
      permission: 'read',
      source: 'explicit',
    });
  });

  it('授权对其他用户不生效', async () => {
    file('f', 'owner');
    grant('f', { user: 'alice', perm: 'admin' });
    expect((await check('f', 'bob', 'read')).hasAccess).toBe(false);
  });

  it('过期授权失效，未过期授权有效', async () => {
    file('f', 'owner');
    file('g', 'owner');
    grant('f', { user: 'alice', perm: 'write', expires: PAST });
    grant('g', { user: 'alice', perm: 'write', expires: FUTURE });
    expect((await check('f', 'alice', 'read')).hasAccess).toBe(false);
    expect((await check('g', 'alice', 'write')).hasAccess).toBe(true);
  });

  it('用户组授权：取所在多个组中的最高权限', async () => {
    file('f', 'owner');
    group('g1', ['alice']);
    group('g2', ['alice']);
    grant('f', { group: 'g1', perm: 'read' });
    grant('f', { group: 'g2', perm: 'admin' });
    expect(await check('f', 'alice', 'admin')).toMatchObject({
      hasAccess: true,
      permission: 'admin',
      subjectType: 'group',
    });
  });

  it('非组成员不享有组授权', async () => {
    file('f', 'owner');
    group('g1', ['alice']);
    grant('f', { group: 'g1', perm: 'admin' });
    expect((await check('f', 'bob', 'read')).hasAccess).toBe(false);
  });
});

describe('继承（祖先目录）', () => {
  beforeEach(() => {
    file('root', 'owner', { folder: true });
    file('mid', 'owner', { folder: true, parent: 'root' });
    file('leaf', 'owner', { parent: 'mid' });
  });

  it('inherit_to_children=1：多级子孙继承，来源为授权的祖先', async () => {
    grant('root', { user: 'alice', perm: 'write', inherit: true });
    expect(await check('leaf', 'alice', 'write')).toMatchObject({
      hasAccess: true,
      source: 'inherited',
      sourceFileId: 'root',
    });
  });

  it('inherit_to_children=0：不向下继承', async () => {
    grant('root', { user: 'alice', perm: 'admin', inherit: false });
    expect((await check('leaf', 'alice', 'read')).hasAccess).toBe(false);
  });

  it('继承的授权同样会过期', async () => {
    grant('root', { user: 'alice', perm: 'admin', inherit: true, expires: PAST });
    expect((await check('leaf', 'alice', 'read')).hasAccess).toBe(false);
  });

  it('显式授权优先于继承（子文件显式 read 不被父目录 admin 抬高）', async () => {
    grant('root', { user: 'alice', perm: 'admin', inherit: true });
    grant('leaf', { user: 'alice', perm: 'read' });
    expect(await check('leaf', 'alice', 'write')).toMatchObject({
      hasAccess: false,
      permission: 'read',
      source: 'explicit',
    });
  });
});

describe('团队', () => {
  it('团队显式授权受角色上限约束：viewer 即使被授 admin 也只有 read', async () => {
    file('f', 'owner');
    team('t1', { alice: 'viewer' });
    grant('f', { team: 't1', perm: 'admin' });
    expect(await check('f', 'alice', 'write')).toMatchObject({
      hasAccess: false,
      permission: 'read',
      subjectType: 'team',
    });
  });

  it('团队自有资源且无独立授权：按团队角色判定（member 可写，viewer 只读）', async () => {
    file('f', 'owner', { teamId: 't1' });
    team('t1', { alice: 'member', bob: 'viewer' });
    expect(await check('f', 'alice', 'write')).toMatchObject({ hasAccess: true, source: 'team_role' });
    expect(await check('f', 'bob', 'write')).toMatchObject({
      hasAccess: false,
      permission: 'read',
      source: 'team_role',
    });
  });

  it('非团队成员无法通过团队资源获得权限', async () => {
    file('f', 'owner', { teamId: 't1' });
    team('t1', { alice: 'admin' });
    expect((await check('f', 'bob', 'read')).hasAccess).toBe(false);
  });
});
