/**
 * permissionResolver.ts
 * 权限解析器模块
 *
 * 功能:
 * - 解析有效权限（递归 CTE 方案）
 * - 带缓存的权限检查
 * - 权限缓存失效
 * - 支持用户和组的权限继承
 */

import { eq, and, sql, inArray, isNull } from 'drizzle-orm';
import { getDb, files, filePermissions, groupMembers, userGroups } from '../db';
import type { DrizzleDb } from '../db';
import type { Env } from '../types/env';

export type PermissionLevel = 'read' | 'write' | 'admin';

export interface PermissionResolution {
  hasAccess: boolean;
  permission: PermissionLevel | null;
  source: 'explicit' | 'inherited' | 'owner';
  sourceFileId?: string;
  sourceFilePath?: string;
  expiresAt?: string;
  subjectType?: 'user' | 'group';
  groupId?: string;
  groupName?: string;
}

const PERMISSION_LEVELS: Record<PermissionLevel, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

const CACHE_TTL = 300;

export async function resolveEffectivePermission(
  db: DrizzleDb,
  env: Env,
  fileId: string,
  userId: string,
  requiredLevel: PermissionLevel
): Promise<PermissionResolution> {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file) {
    return {
      hasAccess: false,
      permission: null,
      source: 'explicit',
    };
  }

  if (file.userId === userId) {
    return {
      hasAccess: true,
      permission: 'admin',
      source: 'owner',
      sourceFileId: file.id,
      sourceFilePath: file.path,
    };
  }

  const userGroupIds = await getUserGroupIds(db, userId);

  const explicitPermission = await findExplicitPermission(db, fileId, userId, userGroupIds);
  if (explicitPermission) {
    const hasAccess = checkPermissionLevel(explicitPermission.permission as PermissionLevel, requiredLevel);
    return {
      hasAccess,
      permission: explicitPermission.permission as PermissionLevel,
      source: 'explicit',
      sourceFileId: file.id,
      sourceFilePath: file.path,
      expiresAt: explicitPermission.expiresAt ?? undefined,
      subjectType: explicitPermission.subjectType as 'user' | 'group' | undefined,
      groupId: explicitPermission.groupId ?? undefined,
    };
  }

  const inheritedPermission = await findInheritedPermission(db, env, fileId, userId, userGroupIds);
  if (inheritedPermission) {
    const hasAccess = checkPermissionLevel(inheritedPermission.permission as PermissionLevel, requiredLevel);
    const sourceFile = await db.select().from(files).where(eq(files.id, inheritedPermission.fileId)).get();
    return {
      hasAccess,
      permission: inheritedPermission.permission as PermissionLevel,
      source: 'inherited',
      sourceFileId: inheritedPermission.fileId,
      sourceFilePath: sourceFile?.path,
      expiresAt: inheritedPermission.expiresAt ?? undefined,
      subjectType: inheritedPermission.subjectType as 'user' | 'group' | undefined,
      groupId: inheritedPermission.groupId ?? undefined,
    };
  }

  return {
    hasAccess: false,
    permission: null,
    source: 'explicit',
  };
}

export async function checkPermissionWithCache(
  db: DrizzleDb,
  env: Env,
  fileId: string,
  userId: string,
  requiredLevel: PermissionLevel
): Promise<PermissionResolution> {
  const cacheKey = `perm:${fileId}:${userId}`;

  try {
    const cached = await env.KV.get(cacheKey);
    if (cached) {
      const result = JSON.parse(cached) as PermissionResolution;
      if (result.expiresAt) {
        const expiresAt = new Date(result.expiresAt);
        if (expiresAt < new Date()) {
          await env.KV.delete(cacheKey);
        } else {
          return result;
        }
      } else {
        return result;
      }
    }
  } catch {
    // 缓存读取失败，继续解析
  }

  const result = await resolveEffectivePermission(db, env, fileId, userId, requiredLevel);

  try {
    await env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
  } catch {
    // 缓存写入失败，忽略
  }

  return result;
}

export async function invalidatePermissionCache(env: Env, fileId: string): Promise<void> {
  try {
    const list = await env.KV.list({ prefix: `perm:${fileId}:` });
    const keys = list.keys.map((k) => k.name);

    if (keys.length > 0) {
      await Promise.all(keys.map((key) => env.KV.delete(key)));
    }
  } catch (error) {
    console.error('Failed to invalidate permission cache:', error);
  }
}

export async function invalidatePermissionCacheForUser(env: Env, userId: string): Promise<void> {
  try {
    const list = await env.KV.list({ prefix: `perm:` });
    const keys = list.keys.filter((k) => k.name.endsWith(`:${userId}`)).map((k) => k.name);

    if (keys.length > 0) {
      await Promise.all(keys.map((key) => env.KV.delete(key)));
    }
  } catch (error) {
    console.error('Failed to invalidate user permission cache:', error);
  }
}

async function getUserGroupIds(db: DrizzleDb, userId: string): Promise<string[]> {
  const memberships = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
    .all();

  return memberships.map((m) => m.groupId);
}

async function findExplicitPermission(
  db: DrizzleDb,
  fileId: string,
  userId: string,
  userGroupIds: string[]
): Promise<typeof filePermissions.$inferSelect | null> {
  const now = new Date().toISOString();

  const userPermission = await db
    .select()
    .from(filePermissions)
    .where(
      and(
        eq(filePermissions.fileId, fileId),
        eq(filePermissions.userId, userId),
        eq(filePermissions.subjectType, 'user'),
        sql`(${filePermissions.expiresAt} IS NULL OR ${filePermissions.expiresAt} > ${now})`
      )
    )
    .get();

  if (userPermission) {
    return userPermission;
  }

  if (userGroupIds.length > 0) {
    const groupPermission = await db
      .select()
      .from(filePermissions)
      .where(
        and(
          eq(filePermissions.fileId, fileId),
          inArray(filePermissions.groupId, userGroupIds),
          eq(filePermissions.subjectType, 'group'),
          sql`(${filePermissions.expiresAt} IS NULL OR ${filePermissions.expiresAt} > ${now})`
        )
      )
      .orderBy(
        sql`
        CASE ${filePermissions.permission}
          WHEN 'admin' THEN 3
          WHEN 'write' THEN 2
          ELSE 1
        END DESC
      `
      )
      .get();

    if (groupPermission) {
      return groupPermission;
    }
  }

  return null;
}

async function findInheritedPermission(
  db: DrizzleDb,
  env: Env,
  fileId: string,
  userId: string,
  userGroupIds: string[]
): Promise<typeof filePermissions.$inferSelect | null> {
  const ancestors = await getAncestorFiles(db, fileId);

  if (ancestors.length === 0) {
    return null;
  }

  const now = new Date().toISOString();
  const ancestorIds = ancestors.map((a) => a.id);

  for (const ancestor of ancestors) {
    const userPermission = await db
      .select()
      .from(filePermissions)
      .where(
        and(
          eq(filePermissions.fileId, ancestor.id),
          eq(filePermissions.userId, userId),
          eq(filePermissions.subjectType, 'user'),
          eq(filePermissions.inheritToChildren, true),
          sql`(${filePermissions.expiresAt} IS NULL OR ${filePermissions.expiresAt} > ${now})`
        )
      )
      .get();

    if (userPermission) {
      return userPermission;
    }
  }

  if (userGroupIds.length > 0) {
    for (const ancestor of ancestors) {
      const groupPermission = await db
        .select()
        .from(filePermissions)
        .where(
          and(
            eq(filePermissions.fileId, ancestor.id),
            inArray(filePermissions.groupId, userGroupIds),
            eq(filePermissions.subjectType, 'group'),
            eq(filePermissions.inheritToChildren, true),
            sql`(${filePermissions.expiresAt} IS NULL OR ${filePermissions.expiresAt} > ${now})`
          )
        )
        .orderBy(
          sql`
          CASE ${filePermissions.permission}
            WHEN 'admin' THEN 3
            WHEN 'write' THEN 2
            ELSE 1
          END DESC
        `
        )
        .get();

      if (groupPermission) {
        return groupPermission;
      }
    }
  }

  return null;
}

async function getAncestorFiles(db: DrizzleDb, fileId: string): Promise<(typeof files.$inferSelect)[]> {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file || !file.parentId) {
    return [];
  }

  const ancestors: (typeof files.$inferSelect)[] = [];
  let currentParentId: string | null = file.parentId;
  let depth = 0;
  const maxDepth = 20;

  while (currentParentId && depth < maxDepth) {
    const parent = await db
      .select()
      .from(files)
      .where(and(eq(files.id, currentParentId), isNull(files.deletedAt)))
      .get();

    if (!parent) {
      break;
    }

    ancestors.push(parent);
    currentParentId = parent.parentId;
    depth++;
  }

  return ancestors;
}

function checkPermissionLevel(actual: PermissionLevel, required: PermissionLevel): boolean {
  return PERMISSION_LEVELS[actual] >= PERMISSION_LEVELS[required];
}

export async function getGroupInfo(db: DrizzleDb, groupId: string): Promise<{ id: string; name: string } | null> {
  const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).get();

  if (!group) {
    return null;
  }

  return {
    id: group.id,
    name: group.name,
  };
}

export async function batchResolvePermissions(
  db: DrizzleDb,
  env: Env,
  fileIds: string[],
  userId: string,
  requiredLevel: PermissionLevel
): Promise<Map<string, PermissionResolution>> {
  const results = new Map<string, PermissionResolution>();

  await Promise.all(
    fileIds.map(async (fileId) => {
      const resolution = await checkPermissionWithCache(db, env, fileId, userId, requiredLevel);
      results.set(fileId, resolution);
    })
  );

  return results;
}
