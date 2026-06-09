/**
 * permissionService.ts — 权限管理公共服务层（唯一来源）
 *
 * 核心权限函数从此文件导出，routes/permissions.ts 仅做薄包装。
 * 所有 service 层和 agentTools 应从此文件导入，禁止从 routes 导入。
 */

import { eq, and, isNull, inArray, lt, or, desc, isNotNull, count } from 'drizzle-orm';
import {
  getDb,
  files,
  filePermissions,
  users,
  userGroups,
  groupMembers,
  teamMembers,
  teamResources,
  permissionRequests,
  roleTemplates,
} from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import {
  resolveEffectivePermission,
  invalidatePermissionCache,
  invalidatePermissionCacheForUser,
  type PermissionLevel,
} from '../lib/permissionResolver';
import { createNotification } from './notificationUtils';

// ─────────────────────────────────────────────────────────────────────────────
// 文件权限检查（核心函数，原位于 routes/permissions.ts）
// ─────────────────────────────────────────────────────────────────────────────

export async function checkFilePermission(
  db: ReturnType<typeof getDb>,
  fileId: string,
  userId: string,
  requiredPermission: PermissionLevel,
  env: Env
): Promise<{ hasAccess: boolean; permission: string | null; isOwner: boolean }> {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    return { hasAccess: false, permission: null, isOwner: false };
  }

  if (file.userId === userId) {
    return { hasAccess: true, permission: 'admin', isOwner: true };
  }

  const resolution = await resolveEffectivePermission(db, env, fileId, userId, requiredPermission);
  return {
    hasAccess: resolution.hasAccess,
    permission: resolution.permission,
    isOwner: false,
  };
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
    teamId: p.teamId,
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
          perm.groupId ? eq(filePermissions.groupId, perm.groupId) : isNull(filePermissions.groupId),
          perm.teamId ? eq(filePermissions.teamId, perm.teamId) : isNull(filePermissions.teamId)
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

  await db.update(files).set({ accessLevel, updatedAt: new Date().toISOString() }).where(eq(files.id, folderId));

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

      // 失效被移除成员的权限缓存（用户不再属于该组，组权限查询自然失效）
      if (env) {
        await invalidatePermissionCacheForUser(env, targetUserId);
      }

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

// ─────────────────────────────────────────────────────────────────────────────
// 基于角色模板授权
// ─────────────────────────────────────────────────────────────────────────────

export interface GrantWithRoleTemplateInput {
  fileId: string;
  targetUserId?: string;
  targetGroupId?: string;
  targetTeamId?: string;
  roleTemplate: 'viewer' | 'editor' | 'manager';
  expiresAt?: string;
}

const ROLE_TEMPLATE_PERMISSION_MAP: Record<string, 'read' | 'write' | 'admin'> = {
  viewer: 'read',
  editor: 'write',
  manager: 'admin',
};

const PERMISSION_LEVEL_ORDER: Record<string, number> = { read: 1, write: 2, admin: 3 };

export async function grantWithRoleTemplate(
  env: Env,
  grantedByUserId: string,
  input: GrantWithRoleTemplateInput
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { fileId, targetUserId, targetGroupId, targetTeamId, roleTemplate, expiresAt } = input;

  // 验证操作者是否是文件所有者
  const ownerFile = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, grantedByUserId)))
    .get();
  if (!ownerFile) {
    return { success: false, error: '文件不存在或您无权对此文件授权' };
  }

  // 检查目标至少指定一个
  if (!targetUserId && !targetGroupId && !targetTeamId) {
    return { success: false, error: '必须指定 targetUserId、targetGroupId 或 targetTeamId 其中之一' };
  }

  // 查询角色模板
  const template = await db.select().from(roleTemplates).where(eq(roleTemplates.slug, roleTemplate)).get();

  if (!template) {
    return { success: false, error: `角色模板 "${roleTemplate}" 不存在` };
  }

  // 解析模板权限，取最高级别
  const templatePermissions: string[] = JSON.parse(template.permissions || '[]');
  let highestPermission = ROLE_TEMPLATE_PERMISSION_MAP[roleTemplate];
  for (const perm of templatePermissions) {
    if (PERMISSION_LEVEL_ORDER[perm] > PERMISSION_LEVEL_ORDER[highestPermission]) {
      highestPermission = perm as 'read' | 'write' | 'admin';
    }
  }

  const now = new Date().toISOString();
  const subjectType = targetTeamId ? 'team' : targetGroupId ? 'group' : 'user';

  // 查找是否已有权限记录
  const existingConditions = [eq(filePermissions.fileId, fileId), eq(filePermissions.subjectType, subjectType)];
  if (targetUserId) existingConditions.push(eq(filePermissions.userId, targetUserId));
  else existingConditions.push(isNull(filePermissions.userId));
  if (targetGroupId) existingConditions.push(eq(filePermissions.groupId, targetGroupId));
  else existingConditions.push(isNull(filePermissions.groupId));
  if (targetTeamId) existingConditions.push(eq(filePermissions.teamId, targetTeamId));
  else existingConditions.push(isNull(filePermissions.teamId));

  const existing = await db
    .select()
    .from(filePermissions)
    .where(and(...existingConditions))
    .get();

  if (existing) {
    await db
      .update(filePermissions)
      .set({
        permission: highestPermission,
        expiresAt: expiresAt || null,
        updatedAt: now,
      })
      .where(eq(filePermissions.id, existing.id));
  } else {
    await db.insert(filePermissions).values({
      id: crypto.randomUUID(),
      fileId,
      userId: targetUserId || null,
      groupId: targetGroupId || null,
      teamId: targetTeamId || null,
      subjectType,
      permission: highestPermission,
      grantedBy: grantedByUserId,
      expiresAt: expiresAt || null,
      inheritToChildren: true, // 角色模板授权默认穿透
      scope: 'explicit',
      createdAt: now,
      updatedAt: now,
    });
  }

  // 失效缓存
  invalidatePermissionCache(env, fileId);

  logger.info('PermissionService', '基于角色模板授权', {
    fileId,
    roleTemplate,
    subjectType,
    permission: highestPermission,
  });

  return { success: true, message: `已使用模板 "${roleTemplate}" 授权（权限级别：${highestPermission}）` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 创建权限申请
// ─────────────────────────────────────────────────────────────────────────────

export interface CreatePermissionRequestInput {
  fileId: string;
  requestedPermission: 'read' | 'write' | 'admin';
  reason?: string;
  targetTeamId?: string;
}

export async function createPermissionRequest(
  env: Env,
  requesterId: string,
  input: CreatePermissionRequestInput
): Promise<{ success: true; message: string; requestId: string } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { fileId, requestedPermission, reason, targetTeamId } = input;

  // 检查文件是否存在
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  // 防重复：检查是否已有 pending 状态的同一文件申请
  const existingRequest = await db
    .select()
    .from(permissionRequests)
    .where(
      and(
        eq(permissionRequests.fileId, fileId),
        eq(permissionRequests.requesterId, requesterId),
        eq(permissionRequests.status, 'pending')
      )
    )
    .get();

  if (existingRequest) {
    return { success: false, error: '您已有针对该文件的待审批申请，请等待处理' };
  }

  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();

  await db.insert(permissionRequests).values({
    id: requestId,
    fileId,
    requesterId,
    targetTeamId: targetTeamId || null,
    requestedPermission,
    reason: reason || null,
    status: 'pending',
    createdAt: now,
  });

  // 发送通知给文件所有者
  try {
    await createNotification(env, {
      userId: file.userId,
      type: 'share_received',
      title: '新的权限申请',
      body: `用户申请访问文件 "${file.name}"，请求权限：${requestedPermission}`,
      data: { fileId, requestId, requesterId },
    });
  } catch (e) {
    logger.error('PermissionService', '发送权限申请通知失败', { fileId, requesterId }, e as Error);
  }

  logger.info('PermissionService', '创建权限申请', { requestId, fileId, requesterId, requestedPermission });

  return { success: true, message: '权限申请已提交，等待审批', requestId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 审批权限申请
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovePermissionRequestInput {
  requestId: string;
  action: 'approve' | 'reject';
  comment?: string;
}

export async function approvePermissionRequest(
  env: Env,
  reviewerId: string,
  input: ApprovePermissionRequestInput
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { requestId, action, comment } = input;

  // 查找申请记录
  const request = await db.select().from(permissionRequests).where(eq(permissionRequests.id, requestId)).get();
  if (!request) {
    return { success: false, error: '申请记录不存在' };
  }
  if (request.status !== 'pending') {
    return { success: false, error: '该申请已被处理' };
  }

  // 获取文件信息以验证审批人权限
  const file = await db.select().from(files).where(eq(files.id, request.fileId)).get();
  if (!file) {
    return { success: false, error: '关联文件不存在' };
  }

  // 检查审批人是否有权限（文件所有者 或 团队 admin/owner）
  const isFileOwner = file.userId === reviewerId;
  let isTeamAdmin = false;

  if (!isFileOwner && request.targetTeamId) {
    const teamMembership = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, request.targetTeamId), eq(teamMembers.userId, reviewerId)))
      .get();
    if (teamMembership && (teamMembership.role === 'admin' || teamMembership.role === 'owner')) {
      isTeamAdmin = true;
    }
  }

  if (!isFileOwner && !isTeamAdmin) {
    return { success: false, error: '无权审批此申请（需为文件所有者或团队管理员）' };
  }

  const now = new Date().toISOString();

  if (action === 'approve') {
    // 更新申请状态
    await db
      .update(permissionRequests)
      .set({
        status: 'approved',
        reviewedBy: reviewerId,
        reviewedAt: now,
        reviewComment: comment || null,
      })
      .where(eq(permissionRequests.id, requestId));

    // 自动创建 file_permissions 记录
    const subjectType = request.targetTeamId ? 'team' : 'user';
    const permId = crypto.randomUUID();

    await db.insert(filePermissions).values({
      id: permId,
      fileId: request.fileId,
      userId: subjectType === 'user' ? request.requesterId : null,
      groupId: null,
      teamId: request.targetTeamId || null,
      subjectType,
      permission: request.requestedPermission,
      grantedBy: reviewerId,
      inheritToChildren: true, // 审批通过默认穿透
      scope: 'explicit',
      createdAt: now,
      updatedAt: now,
    });

    // 团队权限审批通过时，同步创建挂载记录
    if (request.targetTeamId) {
      const existingMount = await db
        .select()
        .from(teamResources)
        .where(and(eq(teamResources.teamId, request.targetTeamId), eq(teamResources.fileId, request.fileId)))
        .get();
      if (!existingMount) {
        await db.insert(teamResources).values({
          id: crypto.randomUUID(),
          teamId: request.targetTeamId,
          fileId: request.fileId,
          mountedBy: reviewerId,
          mountedAt: now,
          targetFolderId: null,
        });
      }
    }

    // 失效缓存
    invalidatePermissionCache(env, request.fileId);

    // 通知申请人
    try {
      await createNotification(env, {
        userId: request.requesterId,
        type: 'permission_granted',
        title: '权限申请已通过',
        body: `您对文件 "${file.name}" 的 ${request.requestedPermission} 权限申请已通过`,
        data: { fileId: request.fileId, requestId },
      });
    } catch (e) {
      logger.error('PermissionService', '发送审批通过通知失败', { requestId }, e as Error);
    }

    logger.info('PermissionService', '审批通过权限申请', {
      requestId,
      reviewerId,
      permission: request.requestedPermission,
    });

    return { success: true, message: '已批准申请并自动授权' };
  } else {
    // reject
    await db
      .update(permissionRequests)
      .set({
        status: 'rejected',
        reviewedBy: reviewerId,
        reviewedAt: now,
        reviewComment: comment || null,
      })
      .where(eq(permissionRequests.id, requestId));

    // 通知申请人
    try {
      await createNotification(env, {
        userId: request.requesterId,
        type: 'system',
        title: '权限申请被拒绝',
        body: comment ? `您的权限申请被拒绝：${comment}` : `您对文件 "${file.name}" 的权限申请被拒绝`,
        data: { fileId: request.fileId, requestId },
      });
    } catch (e) {
      logger.error('PermissionService', '发送审批拒绝通知失败', { requestId }, e as Error);
    }

    logger.info('PermissionService', '拒绝权限申请', { requestId, reviewerId, comment });

    return { success: true, message: '已拒绝该申请' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 查询权限申请列表
// ─────────────────────────────────────────────────────────────────────────────

export interface ListPermissionRequestsInput {
  type: 'my' | 'pending';
  page?: number;
  limit?: number;
}

export interface PermissionRequestItem {
  id: string;
  fileId: string;
  fileName: string;
  requesterId: string;
  requesterName: string | null;
  requestedPermission: string;
  reason: string | null;
  status: string;
  targetTeamId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewComment: string | null;
}

export async function listPermissionRequests(
  env: Env,
  userId: string,
  input: ListPermissionRequestsInput
): Promise<{ items: PermissionRequestItem[]; total: number; page: number; limit: number }> {
  const db = getDb(env.DB);
  const { type, page = 1, limit = 20 } = input;
  const offset = (page - 1) * limit;

  let requests;
  let total = 0;

  if (type === 'my') {
    // 我发起的申请
    const [countResult] = await db
      .select({ total: count() })
      .from(permissionRequests)
      .where(eq(permissionRequests.requesterId, userId))
      .all();
    total = Number(countResult?.total ?? 0);

    requests = await db
      .select({
        id: permissionRequests.id,
        fileId: permissionRequests.fileId,
        fileName: files.name,
        requesterId: permissionRequests.requesterId,
        requesterName: users.name,
        requestedPermission: permissionRequests.requestedPermission,
        reason: permissionRequests.reason,
        status: permissionRequests.status,
        targetTeamId: permissionRequests.targetTeamId,
        createdAt: permissionRequests.createdAt,
        reviewedAt: permissionRequests.reviewedAt,
        reviewComment: permissionRequests.reviewComment,
      })
      .from(permissionRequests)
      .leftJoin(files, eq(permissionRequests.fileId, files.id))
      .leftJoin(users, eq(permissionRequests.requesterId, users.id))
      .where(eq(permissionRequests.requesterId, userId))
      .orderBy(desc(permissionRequests.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
  } else {
    // pending — 待我审批的：用户作为 owner 的文件 + 用户作为 admin/owner 的团队 相关的 pending 申请

    // 找出用户作为 owner 的文件 ID
    const ownedFiles = await db.select({ id: files.id }).from(files).where(eq(files.userId, userId)).all();
    const ownedFileIds = ownedFiles.map((f) => f.id);

    // 找出用户作为 admin/owner 的团队 ID
    const adminTeams = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, userId), or(eq(teamMembers.role, 'admin'), eq(teamMembers.role, 'owner'))!))
      .all();
    const adminTeamIds = adminTeams.map((t) => t.teamId);

    const pendingConditions = [eq(permissionRequests.status, 'pending')];

    if (ownedFileIds.length > 0 || adminTeamIds.length > 0) {
      const fileOrTeamConditions = [];
      if (ownedFileIds.length > 0) {
        fileOrTeamConditions.push(inArray(permissionRequests.fileId, ownedFileIds));
      }
      if (adminTeamIds.length > 0) {
        fileOrTeamConditions.push(inArray(permissionRequests.targetTeamId, adminTeamIds));
      }
      pendingConditions.push(or(...fileOrTeamConditions)!);
    } else {
      // 无匹配条件，返回空结果
      return { items: [], total: 0, page, limit };
    }

    // pending 总数查询
    const [pendingCountResult] = await db
      .select({ total: count() })
      .from(permissionRequests)
      .where(and(...pendingConditions))
      .all();
    total = Number(pendingCountResult?.total ?? 0);

    requests = await db
      .select({
        id: permissionRequests.id,
        fileId: permissionRequests.fileId,
        fileName: files.name,
        requesterId: permissionRequests.requesterId,
        requesterName: users.name,
        requestedPermission: permissionRequests.requestedPermission,
        reason: permissionRequests.reason,
        status: permissionRequests.status,
        targetTeamId: permissionRequests.targetTeamId,
        createdAt: permissionRequests.createdAt,
        reviewedAt: permissionRequests.reviewedAt,
        reviewComment: permissionRequests.reviewComment,
      })
      .from(permissionRequests)
      .leftJoin(files, eq(permissionRequests.fileId, files.id))
      .leftJoin(users, eq(permissionRequests.requesterId, users.id))
      .where(and(...pendingConditions))
      .orderBy(desc(permissionRequests.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
  }

  const items: PermissionRequestItem[] = requests.map((r) => ({
    id: r.id,
    fileId: r.fileId,
    fileName: r.fileName || '(未知文件)',
    requesterId: r.requesterId,
    requesterName: r.requesterName,
    requestedPermission: r.requestedPermission,
    reason: r.reason,
    status: r.status,
    targetTeamId: r.targetTeamId,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    reviewComment: r.reviewComment,
  }));

  logger.info('PermissionService', '查询权限申请列表', { userId, type, count: items.length });

  return { items, total, page, limit };
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量授权
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchGrantPermissionsInput {
  fileIds: string[];
  targetUserId?: string;
  targetGroupId?: string;
  targetTeamId?: string;
  permission: 'read' | 'write' | 'admin';
  subjectType?: 'user' | 'group' | 'team';
}

export async function batchGrantPermissions(
  env: Env,
  grantedByUserId: string,
  input: BatchGrantPermissionsInput
): Promise<{
  success: true;
  succeeded: number;
  failed: number;
  errors: Array<{ fileId: string; error: string }>;
}> {
  const db = getDb(env.DB);
  const { fileIds, targetUserId, targetGroupId, targetTeamId, permission, subjectType } = input;

  if (!targetUserId && !targetGroupId && !targetTeamId) {
    throw new Error('必须指定 targetUserId、targetGroupId 或 targetTeamId');
  }

  // 验证操作者是否是所有目标文件的所有者
  const ownedFiles = await db
    .select({ id: files.id })
    .from(files)
    .where(and(inArray(files.id, fileIds), eq(files.userId, grantedByUserId)))
    .all();
  const ownedFileIds = new Set(ownedFiles.map((f) => f.id));
  const unauthorizedIds = fileIds.filter((id) => !ownedFileIds.has(id));
  if (unauthorizedIds.length > 0) {
    return {
      success: true,
      succeeded: 0,
      failed: unauthorizedIds.length,
      errors: unauthorizedIds.map((fileId) => ({
        fileId,
        error: '无权对此文件授权（非文件所有者）',
      })),
    };
  }

  const resolvedSubjectType = subjectType || (targetTeamId ? 'team' : targetGroupId ? 'group' : 'user');

  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ fileId: string; error: string }> = [];

  const now = new Date().toISOString();

  for (const fileId of fileIds) {
    try {
      // 构建查找条件
      const conditions = [eq(filePermissions.fileId, fileId), eq(filePermissions.subjectType, resolvedSubjectType)];
      if (targetUserId) conditions.push(eq(filePermissions.userId, targetUserId));
      else conditions.push(isNull(filePermissions.userId));
      if (targetGroupId) conditions.push(eq(filePermissions.groupId, targetGroupId));
      else conditions.push(isNull(filePermissions.groupId));
      if (targetTeamId) conditions.push(eq(filePermissions.teamId, targetTeamId));
      else conditions.push(isNull(filePermissions.teamId));

      const existing = await db
        .select()
        .from(filePermissions)
        .where(and(...conditions))
        .get();

      if (existing) {
        await db.update(filePermissions).set({ permission, updatedAt: now }).where(eq(filePermissions.id, existing.id));
      } else {
        await db.insert(filePermissions).values({
          id: crypto.randomUUID(),
          fileId,
          userId: targetUserId || null,
          groupId: targetGroupId || null,
          teamId: targetTeamId || null,
          subjectType: resolvedSubjectType,
          permission,
          grantedBy: grantedByUserId,
          inheritToChildren: true, // 批量授权默认穿透
          scope: 'explicit',
          createdAt: now,
          updatedAt: now,
        });

        // 团队授权时，同步创建挂载记录（与 POST /permissions/grant 保持一致）
        if (targetTeamId && resolvedSubjectType === 'team') {
          const existingMount = await db
            .select()
            .from(teamResources)
            .where(and(eq(teamResources.teamId, targetTeamId), eq(teamResources.fileId, fileId)))
            .get();
          if (!existingMount) {
            await db.insert(teamResources).values({
              id: crypto.randomUUID(),
              teamId: targetTeamId,
              fileId,
              mountedBy: grantedByUserId,
              mountedAt: now,
              targetFolderId: null,
            });
          }
        }
      }

      // 失效缓存
      invalidatePermissionCache(env, fileId);
      succeeded++;
    } catch (e) {
      failed++;
      errors.push({ fileId, error: (e as Error).message });
    }
  }

  logger.info('PermissionService', '批量授权完成', { total: fileIds.length, succeeded, failed });

  return { success: true, succeeded, failed, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量撤销权限
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchRevokePermissionsInput {
  fileIds: string[];
  targetUserId?: string;
  targetGroupId?: string;
  targetTeamId?: string;
  subjectType?: 'user' | 'group' | 'team';
}

export async function batchRevokePermissions(
  env: Env,
  operatorId: string,
  input: BatchRevokePermissionsInput
): Promise<{
  success: true;
  succeeded: number;
  failed: number;
  errors: Array<{ fileId: string; error: string }>;
}> {
  const db = getDb(env.DB);
  const { fileIds, targetUserId, targetGroupId, targetTeamId, subjectType } = input;

  if (!targetUserId && !targetGroupId && !targetTeamId) {
    throw new Error('必须指定 targetUserId、targetGroupId 或 targetTeamId');
  }

  // 验证操作者是否是所有目标文件的所有者（与 batchGrantPermissions 保持一致的安全边界）
  const ownedFiles = await db
    .select({ id: files.id })
    .from(files)
    .where(and(inArray(files.id, fileIds), eq(files.userId, operatorId)))
    .all();
  const ownedFileIds = new Set(ownedFiles.map((f) => f.id));
  const unauthorizedIds = fileIds.filter((id) => !ownedFileIds.has(id));
  if (unauthorizedIds.length > 0) {
    return {
      success: true,
      succeeded: 0,
      failed: unauthorizedIds.length,
      errors: unauthorizedIds.map((fileId) => ({
        fileId,
        error: '无权对此文件撤销权限（非文件所有者）',
      })),
    };
  }

  const resolvedSubjectType = subjectType || (targetTeamId ? 'team' : targetGroupId ? 'group' : 'user');

  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ fileId: string; error: string }> = [];

  for (const fileId of fileIds) {
    try {
      const conditions = [eq(filePermissions.fileId, fileId), eq(filePermissions.subjectType, resolvedSubjectType)];
      if (targetUserId) conditions.push(eq(filePermissions.userId, targetUserId));
      else conditions.push(isNull(filePermissions.userId));
      if (targetGroupId) conditions.push(eq(filePermissions.groupId, targetGroupId));
      else conditions.push(isNull(filePermissions.groupId));
      if (targetTeamId) conditions.push(eq(filePermissions.teamId, targetTeamId));
      else conditions.push(isNull(filePermissions.teamId));

      await db.delete(filePermissions).where(and(...conditions));

      // 团队权限撤销时，同步清理挂载记录
      if (targetTeamId && resolvedSubjectType === 'team') {
        const mountRecord = await db
          .select()
          .from(teamResources)
          .where(and(eq(teamResources.teamId, targetTeamId), eq(teamResources.fileId, fileId)))
          .get();
        if (mountRecord) {
          await db
            .delete(teamResources)
            .where(and(eq(teamResources.teamId, targetTeamId), eq(teamResources.fileId, fileId)));
        }
      }

      // 失效缓存
      invalidatePermissionCache(env, fileId);
      succeeded++;
    } catch (e) {
      failed++;
      errors.push({ fileId, error: (e as Error).message });
    }
  }

  logger.info('PermissionService', '批量撤销权限完成', { total: fileIds.length, succeeded, failed });

  return { success: true, succeeded, failed, errors };
}
