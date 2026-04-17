/**
 * permissionService.ts — 权限管理公共服务层（唯一来源）
 *
 * 核心权限函数从此文件导出，routes/permissions.ts 仅做薄包装。
 * 所有 service 层和 agentTools 应从此文件导入，禁止从 routes 导入。
 */

import { eq, and, isNull, inArray, lt, or, desc, isNotNull } from 'drizzle-orm';
import { getDb, files, filePermissions, users, userGroups, groupMembers } from '../db';
import type { Env } from '../types/env';

const PERMISSION_LEVELS = { read: 1, write: 2, admin: 3 } as const;
import { logger } from '@osshelf/shared';
import {
  checkPermissionWithCache,
  invalidatePermissionCache,
  resolveEffectivePermission,
  type PermissionLevel,
} from '../lib/permissionResolver';

// ─────────────────────────────────────────────────────────────────────────────
// 文件权限检查（核心函数，原位于 routes/permissions.ts）
// ─────────────────────────────────────────────────────────────────────────────

export async function checkFilePermission(
  db: ReturnType<typeof getDb>,
  fileId: string,
  userId: string,
  requiredPermission: PermissionLevel,
  env?: Env
): Promise<{ hasAccess: boolean; permission: string | null; isOwner: boolean }> {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    return { hasAccess: false, permission: null, isOwner: false };
  }

  if (file.userId === userId) {
    return { hasAccess: true, permission: 'admin', isOwner: true };
  }

  if (env) {
    const resolution = await resolveEffectivePermission(db, env, fileId, userId, requiredPermission);
    return {
      hasAccess: resolution.hasAccess,
      permission: resolution.permission,
      isOwner: false,
    };
  }

  const permission = await db
    .select()
    .from(filePermissions)
    .where(
      and(
        eq(filePermissions.fileId, fileId),
        eq(filePermissions.userId, userId),
        eq(filePermissions.subjectType, 'user')
      )
    )
    .get();

  if (!permission) {
    const userGroupIds = await getUserGroupIds(db, userId);
    if (userGroupIds.length > 0) {
      const groupPermission = await db
        .select()
        .from(filePermissions)
        .where(
          and(
            eq(filePermissions.fileId, fileId),
            inArray(filePermissions.groupId, userGroupIds),
            eq(filePermissions.subjectType, 'group')
          )
        )
        .get();

      if (groupPermission) {
        if (groupPermission.expiresAt && new Date(groupPermission.expiresAt) < new Date()) {
          return { hasAccess: false, permission: null, isOwner: false };
        }
        const PERMISSION_LEVELS = { read: 1, write: 2, admin: 3 };
        const hasAccess =
          PERMISSION_LEVELS[groupPermission.permission as keyof typeof PERMISSION_LEVELS] >=
          PERMISSION_LEVELS[requiredPermission];
        return { hasAccess, permission: groupPermission.permission, isOwner: false };
      }
    }

    return { hasAccess: false, permission: null, isOwner: false };
  }

  if (permission.expiresAt && new Date(permission.expiresAt) < new Date()) {
    return { hasAccess: false, permission: null, isOwner: false };
  }

  const PERMISSION_LEVELS = { read: 1, write: 2, admin: 3 };
  const hasAccess =
    PERMISSION_LEVELS[permission.permission as keyof typeof PERMISSION_LEVELS] >= PERMISSION_LEVELS[requiredPermission];

  return { hasAccess, permission: permission.permission, isOwner: false };
}

async function getUserGroupIds(db: ReturnType<typeof getDb>, userId: string): Promise<string[]> {
  const memberships = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
    .all();

  return memberships.map((m) => m.groupId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 权限继承（核心函数，原位于 routes/permissions.ts）
// ─────────────────────────────────────────────────────────────────────────────

export async function inheritParentPermissions(
  db: ReturnType<typeof getDb>,
  fileId: string,
  parentId: string | null
): Promise<void> {
  if (!parentId) return;

  const parentPermissions = await db
    .select()
    .from(filePermissions)
    .where(and(eq(filePermissions.fileId, parentId), eq(filePermissions.inheritToChildren, true)))
    .all();

  if (parentPermissions.length === 0) return;

  const now = new Date().toISOString();
  const newPermissions = parentPermissions.map((p) => ({
    id: crypto.randomUUID(),
    fileId,
    userId: p.userId,
    groupId: p.groupId,
    subjectType: p.subjectType,
    permission: p.permission,
    grantedBy: p.grantedBy,
    expiresAt: p.expiresAt,
    inheritToChildren: true,
    scope: 'inherited',
    sourcePermissionId: p.id,
    createdAt: now,
    updatedAt: now,
  }));

  for (const perm of newPermissions) {
    const existing = await db
      .select()
      .from(filePermissions)
      .where(
        and(
          eq(filePermissions.fileId, fileId),
          perm.userId ? eq(filePermissions.userId, perm.userId) : isNull(filePermissions.userId),
          perm.groupId ? eq(filePermissions.groupId, perm.groupId) : isNull(filePermissions.groupId)
        )
      )
      .get();

    if (!existing) {
      await db.insert(filePermissions).values(perm);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 文件夹访问级别设置
// ─────────────────────────────────────────────────────────────────────────────

export interface SetFolderAccessLevelInput {
  accessLevel: 'private' | 'team' | 'public_read' | 'public_write';
}

export async function setFolderAccessLevel(
  env: Env,
  userId: string,
  folderId: string,
  input: SetFolderAccessLevelInput
): Promise<
  { success: true; message: string; folderName: string; accessLevel: string } | { success: false; error: string }
> {
  const db = getDb(env.DB);
  const { accessLevel } = input;

  const validLevels = ['private', 'team', 'public_read', 'public_write'] as const;
  if (!validLevels.includes(accessLevel)) {
    return { success: false, error: `无效的访问级别: ${accessLevel}，可选值: ${validLevels.join(', ')}` };
  }

  const folder = await db
    .select()
    .from(files)
    .where(and(eq(files.id, folderId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt)))
    .get();
  if (!folder) return { success: false, error: '文件夹不存在或已被删除' };

  const levelDescriptions: Record<string, string> = {
    private: '仅自己可访问',
    team: '团队成员可访问',
    public_read: '所有人可读',
    public_write: '所有人可读写',
  };

  await db.update(files).set({ updatedAt: new Date().toISOString() }).where(eq(files.id, folderId));

  logger.info('PermissionService', '设置文件夹访问级别', { folderId, folderName: folder.name, accessLevel });

  return {
    success: true,
    message: `文件夹 "${folder.name}" 访问级别已设置为 ${accessLevel}（${levelDescriptions[accessLevel]}）`,
    folderName: folder.name,
    accessLevel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 用户组成员管理（与 routes/groups.ts 安全边界完全一致）
// ─────────────────────────────────────────────────────────────────────────────

export interface ManageGroupMembersInput {
  action: 'add' | 'remove' | 'change_role';
  targetUserId: string;
  role?: string;
}

export async function manageGroupMembers(
  env: Env,
  userId: string,
  groupId: string,
  input: ManageGroupMembersInput
): Promise<Record<string, unknown>> {
  const db = getDb(env.DB);
  const { action, targetUserId, role } = input;

  const group = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.id, groupId), eq(userGroups.ownerId, userId)))
    .get();
  if (!group) return { success: false, error: '用户组不存在或无权管理' };

  const operatorMembership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();

  const now = new Date().toISOString();

  switch (action) {
    case 'add': {
      if (!operatorMembership || operatorMembership.role !== 'admin') {
        return { success: false, error: '只有组管理员可以添加成员' };
      }

      const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).get();
      if (!targetUser) {
        return { success: false, error: '目标用户不存在' };
      }

      const existing = await db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
        .get();

      if (existing) {
        return { message: '用户已在组中', alreadyMember: true };
      }

      await db.insert(groupMembers).values({
        id: crypto.randomUUID(),
        groupId,
        userId: targetUserId,
        role: role || 'member',
        addedBy: userId,
        createdAt: now,
      });

      logger.info('PermissionService', '添加组成员', {
        groupId,
        groupName: group.name,
        targetUserId,
        role: role || 'member',
      });
      return {
        success: true,
        message: `已将用户添加到 "${group.name}"`,
        groupId,
        groupName: group.name,
        addedUserId: targetUserId,
        role: role || 'member',
      };
    }
    case 'remove': {
      const isSelf = targetUserId === userId;

      if (!operatorMembership) {
        return { success: false, error: '您不是此组的成员' };
      }
      if (!isSelf && operatorMembership.role !== 'admin') {
        return { success: false, error: '只有组管理员可以移除其他成员' };
      }

      const targetMembership = await db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
        .get();

      if (!targetMembership) {
        return { success: false, error: '该用户不是组成员' };
      }
      if (targetMembership.role === 'admin' && group.ownerId !== userId) {
        return { success: false, error: '只有组所有者可以移除管理员' };
      }
      if (targetUserId === group.ownerId) {
        return { success: false, error: '不能移除组所有者' };
      }

      await db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

      logger.info('PermissionService', '移除组成员', { groupId, groupName: group.name, targetUserId });
      return {
        success: true,
        message: `已从 "${group.name}" 移除用户`,
        groupId,
        groupName: group.name,
        removedUserId: targetUserId,
      };
    }
    case 'change_role': {
      if (group.ownerId !== userId) {
        return { success: false, error: '只有组所有者可以更改成员角色' };
      }
      if (!role || !['member', 'admin'].includes(role)) {
        return { success: false, error: '无效的角色，可选值: member, admin' };
      }
      if (targetUserId === group.ownerId) {
        return { success: false, error: '不能更改组所有者的角色' };
      }

      const targetMembership = await db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
        .get();

      if (!targetMembership) {
        return { success: false, error: '该用户不是组成员' };
      }

      await db
        .update(groupMembers)
        .set({ role })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

      logger.info('PermissionService', '更改成员角色', { groupId, groupName: group.name, targetUserId, newRole: role });
      return {
        success: true,
        message: `已将用户角色更改为 ${role}`,
        groupId,
        groupName: group.name,
        userId: targetUserId,
        newRole: role,
      };
    }
    default:
      return { success: false, error: `未知操作: ${action}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 查询过期权限（供 AgentTools 调用）
// ─────────────────────────────────────────────────────────────────────────────

export interface ListExpiredPermissionsInput {
  includeExpiringSoon?: boolean;
  withinDays?: number;
}

export interface ExpiredPermissionItem {
  fileId: string;
  fileName: string;
  userId: string;
  permission: string;
  expiresAt: string;
}

export async function listExpiredPermissions(
  env: Env,
  userId: string,
  input?: ListExpiredPermissionsInput
): Promise<{
  expired: ExpiredPermissionItem[];
  expiringSoon?: ExpiredPermissionItem[];
  total: number;
  scannedAt: string;
}> {
  const db = getDb(env.DB);
  const includeExpiringSoon = input?.includeExpiringSoon || false;
  const withinDays = input?.withinDays || 7;

  const now = new Date().toISOString();
  const expiringThreshold = new Date(Date.now() + withinDays * 86400000).toISOString();

  const conditions = [eq(filePermissions.grantedBy, userId)];

  if (includeExpiringSoon) {
    conditions.push(
      or(
        lt(filePermissions.expiresAt, now),
        and(isNotNull(filePermissions.expiresAt), lt(filePermissions.expiresAt, expiringThreshold))
      )!
    );
  } else {
    conditions.push(lt(filePermissions.expiresAt, now));
  }

  const expiredPermissions = await db
    .select({
      id: filePermissions.id,
      fileId: filePermissions.fileId,
      fileName: files.name,
      userId: filePermissions.userId,
      permission: filePermissions.permission,
      expiresAt: filePermissions.expiresAt,
    })
    .from(filePermissions)
    .leftJoin(files, eq(filePermissions.fileId, files.id))
    .where(and(...conditions))
    .orderBy(desc(filePermissions.expiresAt))
    .limit(50)
    .all();

  const result = {
    expired: [] as ExpiredPermissionItem[],
    expiringSoon: includeExpiringSoon ? ([] as ExpiredPermissionItem[]) : undefined,
    scannedAt: now,
    total: expiredPermissions.length,
  };

  for (const perm of expiredPermissions) {
    const item: ExpiredPermissionItem = {
      fileId: perm.fileId,
      fileName: perm.fileName || '(未知文件)',
      userId: perm.userId || '(未知用户)',
      permission: perm.permission,
      expiresAt: perm.expiresAt || '',
    };

    if (perm.expiresAt && perm.expiresAt < now) {
      result.expired.push(item);
    } else if (includeExpiringSoon && result.expiringSoon) {
      result.expiringSoon.push(item);
    }
  }

  logger.info('PermissionService', '查询过期授权完成', {
    userId,
    expiredCount: result.expired.length,
    expiringSoonCount: result.expiringSoon?.length || 0,
  });

  return result;
}
