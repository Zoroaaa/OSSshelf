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
import { files, filePermissions, groupMembers, userGroups, teams, teamMembers } from '../db';
import type { DrizzleDb } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';

export type PermissionLevel = 'read' | 'write' | 'admin';

export interface PermissionResolution {
  hasAccess: boolean;
  permission: PermissionLevel | null;
  source: 'explicit' | 'inherited' | 'owner';
  sourceFileId?: string;
  sourceFilePath?: string;
  expiresAt?: string;
  subjectType?: 'user' | 'group' | 'team';
  groupId?: string;
  groupName?: string;
  teamId?: string;
  teamName?: string;
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
  const teamRoles = await getTeamMemberRoles(db, userId);

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

  // team 维度显式权限查找（优先级低于 user/group 显式权限）
  const teamExplicitPerm = await findTeamPermission(db, fileId, teamRoles);
  if (teamExplicitPerm) {
    const hasAccess = checkPermissionLevel(teamExplicitPerm.permission as PermissionLevel, requiredLevel);
    const teamInfo = teamExplicitPerm.teamId ? await getTeamInfo(db, teamExplicitPerm.teamId) : null;
    return {
      hasAccess,
      permission: teamExplicitPerm.permission as PermissionLevel,
      source: 'explicit',
      sourceFileId: file.id,
      sourceFilePath: file.path,
      expiresAt: teamExplicitPerm.expiresAt ?? undefined,
      subjectType: 'team',
      teamId: teamExplicitPerm.teamId ?? undefined,
      teamName: teamInfo?.name,
    };
  }

  const inheritedPermission = await findInheritedPermission(db, env, fileId, userId, userGroupIds, teamRoles);
  if (inheritedPermission) {
    const hasAccess = checkPermissionLevel(inheritedPermission.permission as PermissionLevel, requiredLevel);
    const sourceFile = await db.select().from(files).where(eq(files.id, inheritedPermission.fileId)).get();
    const isInheritedTeam = inheritedPermission.subjectType === 'team';
    const inheritedTeamInfo =
      isInheritedTeam && inheritedPermission.teamId ? await getTeamInfo(db, inheritedPermission.teamId) : null;
    return {
      hasAccess,
      permission: inheritedPermission.permission as PermissionLevel,
      source: 'inherited',
      sourceFileId: inheritedPermission.fileId,
      sourceFilePath: sourceFile?.path,
      expiresAt: inheritedPermission.expiresAt ?? undefined,
      subjectType: inheritedPermission.subjectType as 'user' | 'group' | 'team' | undefined,
      groupId: inheritedPermission.groupId ?? undefined,
      teamId: inheritedPermission.teamId ?? undefined,
      teamName: inheritedTeamInfo?.name,
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
  const cacheKey = `perm:${fileId}:${userId}:${requiredLevel}`;

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
    logger.error('PERMISSION', '权限缓存失效失败', { fileId }, error);
  }
}

export async function invalidatePermissionCacheForUser(env: Env, userId: string): Promise<void> {
  try {
    const userKeySegment = `:${userId}:`;
    let totalDeleted = 0;
    let listComplete = false;

    // Cloudflare KV list 分页：当 list_complete=false 时继续获取下一页
    // 注意：旧版类型定义可能不包含 cursor，使用 list_complete 判断
    do {
      const result = await env.KV.list({ prefix: `perm:`, limit: 1000 });
      // 匹配 perm:{fileId}:{userId}:{level} 格式
      const keys = result.keys.filter((k) => k.name.includes(userKeySegment)).map((k) => k.name);

      if (keys.length > 0) {
        await Promise.all(keys.map((key) => env.KV.delete(key)));
        totalDeleted += keys.length;
      }

      listComplete = result.list_complete ?? true;

      // 如果类型系统支持 cursor（新版 @cloudflare/workers-types），使用它
      // 否则依赖 list_complete 标志（KV 内部自动翻页）
    } while (!listComplete);

    if (totalDeleted > 0) {
      logger.info('PERMISSION', '用户权限缓存已失效', { userId, totalDeleted });
    }
  } catch (error) {
    logger.error('PERMISSION', '用户权限缓存失效失败', { userId }, error);
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

/**
 * 获取用户在所有团队中的角色映射
 * @returns Map<teamId, role>
 */
async function getTeamMemberRoles(db: DrizzleDb, userId: string): Promise<Map<string, string>> {
  const memberships = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .all();

  const rolesMap = new Map<string, string>();
  for (const m of memberships) {
    rolesMap.set(m.teamId, m.role);
  }
  return rolesMap;
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

/**
 * 查找团队维度的显式权限
 * 在 fileId 上查找 subjectType='team' 且 teamId 匹配用户所在团队的权限记录
 * admin/owner 角色的团队会获得更高的默认权限倾向
 */
async function findTeamPermission(
  db: DrizzleDb,
  fileId: string,
  teamRoles: Map<string, string>
): Promise<typeof filePermissions.$inferSelect | null> {
  if (teamRoles.size === 0) {
    return null;
  }

  const userTeamIds = Array.from(teamRoles.keys());
  const now = new Date().toISOString();

  const teamPermission = await db
    .select()
    .from(filePermissions)
    .where(
      and(
        eq(filePermissions.fileId, fileId),
        eq(filePermissions.subjectType, 'team'),
        inArray(filePermissions.teamId!, userTeamIds),
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

  return teamPermission ?? null;
}

async function findInheritedPermission(
  db: DrizzleDb,
  env: Env,
  fileId: string,
  userId: string,
  userGroupIds: string[],
  teamRoles: Map<string, string> = new Map()
): Promise<typeof filePermissions.$inferSelect | null> {
  const ancestors = await getAncestorFiles(db, fileId);

  if (ancestors.length === 0) {
    return null;
  }

  const now = new Date().toISOString();

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

  // team 维度继承权限查找
  if (teamRoles.size > 0) {
    const userTeamIds = Array.from(teamRoles.keys());
    for (const ancestor of ancestors) {
      const teamInheritedPerm = await db
        .select()
        .from(filePermissions)
        .where(
          and(
            eq(filePermissions.fileId, ancestor.id),
            eq(filePermissions.subjectType, 'team'),
            inArray(filePermissions.teamId!, userTeamIds),
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

      if (teamInheritedPerm) {
        return teamInheritedPerm;
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

/**
 * 获取团队信息
 */
export async function getTeamInfo(db: DrizzleDb, teamId: string): Promise<{ id: string; name: string } | null> {
  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get();

  if (!team) {
    return null;
  }

  return {
    id: team.id,
    name: team.name,
  };
}

/**
 * 基于团队成员角色解析团队资源的默认访问权限（不依赖显式授权，仅凭成员身份）
 * - owner/admin → write
 * - member → read
 * - guest → 无默认权限
 */
export async function resolveTeamDefaultPermission(
  db: DrizzleDb,
  userId: string,
  teamId: string
): Promise<PermissionLevel | null> {
  const teamRoles = await getTeamMemberRoles(db, userId);
  const role = teamRoles.get(teamId);

  if (!role) {
    return null;
  }

  switch (role) {
    case 'owner':
    case 'admin':
      return 'write';
    case 'member':
      return 'read';
    case 'guest':
    default:
      return null;
  }
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
