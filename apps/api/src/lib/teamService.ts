/**
 * teamService.ts — 团队管理核心服务层
 */

import { eq, and, isNull, sql, or, inArray } from 'drizzle-orm';
import { getDb, teams, teamMembers, teamResources, files, users, filePermissions } from '../db';
import type { DrizzleDb } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { recordActivity } from './teamActivityService';
import { invalidatePermissionCacheForUser } from './permissionResolver';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTeamInput {
  name: string;
  description?: string;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  storageQuota?: number;
  defaultMemberRole?: string;
}

export interface ManageTeamMembersInput {
  action: 'add' | 'remove' | 'change_role';
  targetUserId: string;
  role?: 'owner' | 'admin' | 'member' | 'guest';
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具函数
// ─────────────────────────────────────────────────────────────────────────────

function permissionRank(perm: string): number {
  if (perm === 'admin') return 3;
  if (perm === 'write') return 2;
  return 1; // read or unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// 团队 CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createTeam(
  env: Env,
  userId: string,
  input: CreateTeamInput
): Promise<{ success: true; teamId: string; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { name, description } = input;

  if (!name || name.trim().length === 0) {
    return { success: false, error: '团队名称不能为空' };
  }

  const now = new Date().toISOString();
  const teamId = crypto.randomUUID();

  await db.insert(teams).values({
    id: teamId,
    ownerId: userId,
    name: name.trim(),
    description: description?.trim() || null,
    settings: '{}',
    storageQuota: 5368709120, // 5GB 默认
    storageUsed: 0,
    defaultMemberRole: 'member',
    createdAt: now,
    updatedAt: now,
  });

  // 创建者自动成为 owner
  await db.insert(teamMembers).values({
    id: crypto.randomUUID(),
    teamId,
    userId,
    role: 'owner',
    addedBy: userId,
    createdAt: now,
  });

  // Activity
  await recordActivity(db, {
    teamId,
    userId,
    action: 'team_created',
    resourceType: 'team',
    resourceId: teamId,
    details: { teamName: name.trim() },
  });

  logger.info('TeamService', '创建团队', { userId, teamId, name });
  return { success: true, teamId, message: `团队 "${name}" 创建成功` };
}

export async function getTeam(
  db: DrizzleDb,
  teamId: string,
  userId?: string
): Promise<{
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  memberCount?: number;
} | null> {
  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get();
  if (!team) return null;

  if (userId) {
    const member = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .get();
    if (!member) return null;
  }

  const memberCount = await db
    .select({ count: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
    .all();

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    ownerId: team.ownerId,
    createdAt: team.createdAt,
    memberCount: memberCount.length,
  };
}

export async function updateTeam(
  env: Env,
  userId: string,
  teamId: string,
  input: UpdateTeamInput
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { name, description } = input;

  if (
    name === undefined &&
    description === undefined &&
    input.storageQuota === undefined &&
    input.defaultMemberRole === undefined
  ) {
    return { success: false, error: '至少需要更新一个字段' };
  }

  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get();
  if (!team) {
    return { success: false, error: '团队不存在' };
  }

  // 只有 owner 或 admin 可以更新团队信息
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return { success: false, error: '只有团队管理员可以修改团队信息' };
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (input.storageQuota !== undefined) updates.storageQuota = input.storageQuota;
  if (input.defaultMemberRole !== undefined) updates.defaultMemberRole = input.defaultMemberRole;

  await db.update(teams).set(updates).where(eq(teams.id, teamId));

  // Activity
  await recordActivity(db, {
    teamId,
    userId,
    action: 'team_settings_updated',
    details: updates,
  });

  logger.info('TeamService', '更新团队', { userId, teamId, updates });
  return { success: true, message: `团队 "${team.name}" 更新成功` };
}

export async function deleteTeam(
  env: Env,
  userId: string,
  teamId: string
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get();
  if (!team) {
    return { success: false, error: '团队不存在' };
  }

  if (team.ownerId !== userId) {
    return { success: false, error: '只有团队所有者可以删除团队' };
  }

  // 先清理关联的权限记录和缓存
  try {
    const affectedPerms = await db
      .select({ fileId: filePermissions.fileId })
      .from(filePermissions)
      .where(and(eq(filePermissions.teamId, teamId), eq(filePermissions.subjectType, 'team')))
      .all();
    const affectedFileIds = [...new Set(affectedPerms.map((p) => p.fileId))];

    await db
      .delete(filePermissions)
      .where(and(eq(filePermissions.teamId, teamId), eq(filePermissions.subjectType, 'team')));

    for (const fid of affectedFileIds) {
      try {
        await invalidatePermissionCacheForUser(env, fid);
      } catch {
        /* 单文件缓存失效失败不影响主流程 */
      }
    }
  } catch {
    /* 清理失败不影响主流程 */
  }

  // 级联删除由数据库 ON DELETE CASCADE 处理（teamMembers 等）
  await db.delete(teams).where(eq(teams.id, teamId));

  logger.info('TeamService', '删除团队', { userId, teamId, teamName: team.name });
  return { success: true, message: `团队 "${team.name}" 已删除` };
}

export async function listTeams(
  db: DrizzleDb,
  userId: string
): Promise<{
  owned: Array<{
    id: string;
    name: string;
    description: string | null;
    memberCount: number;
    userRole: string;
    isOwner: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  joined: Array<{
    id: string;
    name: string;
    description: string | null;
    memberCount: number;
    userRole: string;
    isOwner: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
}> {
  // 用户拥有的团队
  const ownedTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      createdAt: teams.createdAt,
      updatedAt: teams.updatedAt,
    })
    .from(teams)
    .where(eq(teams.ownerId, userId))
    .all();

  const ownedWithCounts = await Promise.all(
    ownedTeams.map(async (team) => {
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id))
        .get();
      return {
        ...team,
        memberCount: Number(countResult?.count ?? 0),
        userRole: 'owner' as const,
        isOwner: true,
      };
    })
  );

  // 用户加入的团队（非 owner）
  const joinedTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      role: teamMembers.role,
      createdAt: teams.createdAt,
      updatedAt: teams.updatedAt,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teamMembers.userId, userId), sql`${teamMembers.role} != 'owner'`))
    .all();

  const joinedWithCounts = await Promise.all(
    joinedTeams.map(async (team) => {
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id))
        .get();
      return {
        id: team.id,
        name: team.name,
        description: team.description,
        memberCount: Number(countResult?.count ?? 0),
        userRole: team.role,
        isOwner: false,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      };
    })
  );

  return { owned: ownedWithCounts, joined: joinedWithCounts };
}

// ─────────────────────────────────────────────────────────────────────────────
// 成员管理
// ─────────────────────────────────────────────────────────────────────────────

export async function manageTeamMembers(
  env: Env,
  userId: string,
  teamId: string,
  input: ManageTeamMembersInput
): Promise<Record<string, unknown>> {
  const db = getDb(env.DB);
  const { action, targetUserId, role } = input;

  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get();
  if (!team) {
    return { success: false, error: '团队不存在' };
  }

  const operatorMembership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();

  if (!operatorMembership) {
    return { success: false, error: '您不是该团队的成员' };
  }

  const now = new Date().toISOString();

  switch (action) {
    case 'add': {
      // admin 或 owner 可添加成员
      if (operatorMembership.role !== 'admin' && operatorMembership.role !== 'owner') {
        return { success: false, error: '只有管理员或所有者可以添加成员' };
      }

      const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).get();
      if (!targetUser) {
        return { success: false, error: '目标用户不存在' };
      }

      // 检查是否已存在
      const existingMember = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
        .get();

      if (existingMember) {
        return { message: '用户已是团队成员', alreadyMember: true };
      }

      await db.insert(teamMembers).values({
        id: crypto.randomUUID(),
        teamId,
        userId: targetUserId,
        role: role || 'member',
        addedBy: userId,
        createdAt: now,
      });

      // Activity
      await recordActivity(db, {
        teamId,
        userId,
        action: 'member_joined',
        resourceType: 'member',
        resourceId: targetUserId,
        details: { targetUserName: targetUser?.name, role: role || 'member' },
      });

      logger.info('TeamService', '添加团队成员', { teamId, targetUserId, role: role || 'member' });
      return {
        success: true,
        message: `已将用户添加到团队 "${team.name}"`,
        addedUserId: targetUserId,
        role: role || 'member',
      };
    }

    case 'remove': {
      const isSelf = targetUserId === userId;

      const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).get();

      // 检查目标成员是否存在
      const targetMembership = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
        .get();

      if (!targetMembership) {
        return { success: false, error: '该用户不是团队成员' };
      }

      // 不能移除 owner
      if (targetMembership.role === 'owner') {
        return { success: false, error: '不能移除团队所有者' };
      }

      // 用户可自行退出
      if (!isSelf) {
        // admin 只能移除非 admin 成员
        if (operatorMembership.role === 'admin' && targetMembership.role === 'admin') {
          return { success: false, error: '管理员不能移除其他管理员' };
        }
        // 只有 owner 和 admin 可以移除其他成员
        if (operatorMembership.role !== 'owner' && operatorMembership.role !== 'admin') {
          return { success: false, error: '只有管理员或所有者可以移除成员' };
        }
      }

      await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));

      // 失效被移除成员的权限缓存（用户不再属于该团队，团队权限查询自然失效）
      try {
        await invalidatePermissionCacheForUser(env, targetUserId);
      } catch {
        /* 缓存失效失败不影响主流程 */
      }

      // Activity
      await recordActivity(db, {
        teamId,
        userId,
        action: 'member_left',
        resourceType: 'member',
        resourceId: targetUserId,
        details: { targetUserName: targetUser?.name, isSelf: targetUserId === userId },
      });

      logger.info('TeamService', '移除团队成员', { teamId, targetUserId });
      return {
        success: true,
        message: isSelf ? `您已退出团队 "${team.name}"` : `已从团队 "${team.name}" 移除用户`,
        removedUserId: targetUserId,
      };
    }

    case 'change_role': {
      // 只有 owner 可变更角色
      if (operatorMembership.role !== 'owner') {
        return { success: false, error: '只有团队所有者可以变更角色' };
      }

      if (!role || !['admin', 'member', 'guest'].includes(role)) {
        return { success: false, error: '无效的角色，可选值: admin, member, guest' };
      }

      // 不能变更 owner 的角色
      if (targetUserId === team.ownerId) {
        return { success: false, error: '不能变更团队所有者的角色' };
      }

      const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).get();

      const targetMembership = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
        .get();

      if (!targetMembership) {
        return { success: false, error: '该用户不是团队成员' };
      }

      await db
        .update(teamMembers)
        .set({ role })
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));

      // Activity
      await recordActivity(db, {
        teamId,
        userId,
        action: 'role_changed',
        resourceType: 'member',
        resourceId: targetUserId,
        details: { targetUserName: targetUser?.name, newRole: role },
      });

      logger.info('TeamService', '变更成员角色', { teamId, targetUserId, newRole: role });
      return {
        success: true,
        message: `已将用户角色更改为 ${role}`,
        userId: targetUserId,
        newRole: role,
      };
    }

    default:
      return { success: false, error: `未知操作: ${action}` };
  }
}

export async function listTeamMembers(
  db: DrizzleDb,
  teamId: string
): Promise<Array<{ id: string; userId: string; userName: string | null; role: string; createdAt: string }>> {
  const members = await db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      userName: users.name,
      role: teamMembers.role,
      createdAt: teamMembers.createdAt,
    })
    .from(teamMembers)
    .leftJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId))
    .all();

  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    userName: m.userName,
    role: m.role,
    createdAt: m.createdAt,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 资源挂载/卸载
// ─────────────────────────────────────────────────────────────────────────────

export async function mountResourceToTeam(
  env: Env,
  userId: string,
  teamId: string,
  fileId: string,
  options?: { targetFolderId?: string | null }
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get();
  if (!team) {
    return { success: false, error: '团队不存在' };
  }

  // 检查操作者是否是团队成员且有权限
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();

  if (!membership) {
    return { success: false, error: '您不是该团队成员' };
  }

  // 检查文件是否存在且未删除
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();

  if (!file) {
    return { success: false, error: '文件不存在或已被删除' };
  }

  // 挂载者必须是文件所有者 或 团队 admin/owner
  const isFileOwner = file.userId === userId;
  const isTeamAdminOrOwner = membership.role === 'admin' || membership.role === 'owner';

  if (!isFileOwner && !isTeamAdminOrOwner) {
    return { success: false, error: '只有文件所有者或团队管理员可以挂载资源' };
  }

  // 检查是否已挂载
  const existingMount = await db
    .select()
    .from(teamResources)
    .where(and(eq(teamResources.teamId, teamId), eq(teamResources.fileId, fileId)))
    .get();

  if (existingMount) {
    return { success: false, error: '该资源已挂载到团队' };
  }

  const now = new Date().toISOString();
  await db.insert(teamResources).values({
    id: crypto.randomUUID(),
    teamId,
    fileId,
    mountedBy: userId,
    mountedAt: now,
    targetFolderId: options?.targetFolderId ?? null,
  });

  // ★ V2 核心：同步创建 team 级别的 file_permissions
  const existingPerm = await db
    .select()
    .from(filePermissions)
    .where(
      and(
        eq(filePermissions.fileId, fileId),
        eq(filePermissions.subjectType, 'team'),
        eq(filePermissions.teamId, teamId)
      )
    )
    .get();

  if (!existingPerm) {
    await db.insert(filePermissions).values({
      id: crypto.randomUUID(),
      fileId,
      userId: null,
      groupId: null,
      teamId,
      subjectType: 'team',
      permission: 'read', // 默认只读，管理员可后续提升
      grantedBy: userId,
      inheritToChildren: true,
      scope: 'explicit',
      createdAt: now,
      updatedAt: now,
    });
  }

  // Activity
  await recordActivity(db, {
    teamId,
    userId,
    action: 'file_mounted',
    resourceType: 'file',
    resourceId: fileId,
    details: { fileName: file.name, isFolder: file.isFolder },
  });

  logger.info('TeamService', '挂载资源到团队', { userId, teamId, fileId });
  return { success: true, message: `文件 "${file.name}" 已挂载到团队 "${team.name}"` };
}

export async function unmountResourceFromTeam(
  env: Env,
  userId: string,
  teamId: string,
  fileId: string
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get();
  if (!team) {
    return { success: false, error: '团队不存在' };
  }

  // 检查操作者权限
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();

  if (!membership) {
    return { success: false, error: '您不是该团队成员' };
  }

  // 检查文件信息（用于判断是否是文件所有者）
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  // 检查挂载记录
  const mountRecord = await db
    .select()
    .from(teamResources)
    .where(and(eq(teamResources.teamId, teamId), eq(teamResources.fileId, fileId)))
    .get();

  if (!mountRecord) {
    return { success: false, error: '该资源未挂载到此团队' };
  }

  // 文件所有者或团队 admin/owner 可以卸载
  const isFileOwner = file.userId === userId;
  const isTeamAdminOrOwner = membership.role === 'admin' || membership.role === 'owner';

  if (!isFileOwner && !isTeamAdminOrOwner) {
    return { success: false, error: '只有文件所有者或团队管理员可以卸载资源' };
  }

  await db.delete(teamResources).where(and(eq(teamResources.teamId, teamId), eq(teamResources.fileId, fileId)));

  // ★ 同步清理关联的 file_permissions
  await db
    .delete(filePermissions)
    .where(
      and(
        eq(filePermissions.fileId, fileId),
        eq(filePermissions.subjectType, 'team'),
        eq(filePermissions.teamId, teamId)
      )
    );

  // Activity
  await recordActivity(db, {
    teamId,
    userId,
    action: 'file_unmounted',
    resourceType: 'file',
    resourceId: fileId,
    details: { fileName: file.name },
  });

  logger.info('TeamService', '从团队卸载资源', { userId, teamId, fileId });
  return { success: true, message: `文件 "${file.name}" 已从团队 "${team.name}" 卸载` };
}

export async function listTeamResources(
  db: DrizzleDb,
  teamId: string
): Promise<Array<{ id: string; fileId: string; fileName: string | null; mountedBy: string; mountedAt: string }>> {
  const resources = await db
    .select({
      id: teamResources.id,
      fileId: teamResources.fileId,
      fileName: files.name,
      mountedBy: teamResources.mountedBy,
      mountedAt: teamResources.mountedAt,
    })
    .from(teamResources)
    .leftJoin(files, eq(teamResources.fileId, files.id))
    .where(eq(teamResources.teamId, teamId))
    .all();

  return resources.map((r) => ({
    id: r.id,
    fileId: r.fileId,
    fileName: r.fileName,
    mountedBy: r.mountedBy,
    mountedAt: r.mountedAt,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 新增：工作区文件列表
// ─────────────────────────────────────────────────────────────────────────────

export interface TeamFileItem {
  fileId: string;
  fileName: string;
  filePath: string | null;
  fileType: string | null;
  mimeType: string | null;
  size: number;
  isFolder: boolean;
  mountedAt: string;
  permission: 'read' | 'write' | 'admin';
  /** 挂载目标文件夹ID（NULL=根目录） */
  targetFolderId: string | null;
}

/**
 * 获取团队工作区的文件列表
 * 聚合所有已挂载的资源，过滤出当前用户有权限访问的文件
 */
export async function getTeamFiles(
  env: Env,
  teamId: string,
  viewerUserId: string,
  options?: { folderId?: string; limit?: number; offset?: number }
): Promise<{ files: TeamFileItem[]; total: number }> {
  const db = getDb(env.DB);
  const { folderId, limit = 50, offset = 0 } = options ?? {};

  // 验证查看者是团队成员
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, viewerUserId)))
    .get();
  if (!membership) return { files: [], total: 0 };

  // 获取所有已挂载的资源（根据 targetFolderId 过滤）
  const mountConditions = [eq(teamResources.teamId, teamId)];
  if (folderId) {
    // 在子文件夹中浏览时，只显示挂载到该文件夹的资源
    mountConditions.push(eq(teamResources.targetFolderId, folderId));
  } else {
    // 在根目录浏览时，只显示 targetFolderId 为 NULL 的资源（即挂载到根目录的）
    mountConditions.push(isNull(teamResources.targetFolderId));
  }

  const mounts = await db
    .select({
      fileId: teamResources.fileId,
      mountedAt: teamResources.mountedAt,
      targetFolderId: teamResources.targetFolderId,
    })
    .from(teamResources)
    .where(and(...mountConditions))
    .all();

  if (mounts.length === 0) return { files: [], total: 0 };

  const mountedFileIds = mounts.map((m) => m.fileId);
  const mountedAtMap = new Map(mounts.map((m) => [m.fileId, m.mountedAt]));
  const targetFolderMap = new Map(mounts.map((m) => [m.fileId, m.targetFolderId]));

  // 查询这些文件的基本信息
  const baseConditions = [inArray(files.id, mountedFileIds), isNull(files.deletedAt)];
  if (folderId) {
    baseConditions.push(eq(files.parentId, folderId));
  }

  const allFiles = await db
    .select({
      id: files.id,
      name: files.name,
      path: files.path,
      type: files.type,
      mimeType: files.mimeType,
      size: files.size,
      isFolder: files.isFolder,
      parentId: files.parentId,
      deletedAt: files.deletedAt,
      userId: files.userId,
    })
    .from(files)
    .where(and(...baseConditions))
    .all();

  // 对每个文件检查权限（批量查询，避免 N+1）
  const allFileIds = allFiles.map((f) => f.id).filter(Boolean);
  const permsMap = new Map<string, { permission: string }>();

  if (allFileIds.length > 0) {
    const perms = await db
      .select({ fileId: filePermissions.fileId, permission: filePermissions.permission })
      .from(filePermissions)
      .where(
        and(
          inArray(filePermissions.fileId, allFileIds),
          or(
            and(eq(filePermissions.subjectType, 'user'), eq(filePermissions.userId, viewerUserId)),
            and(eq(filePermissions.subjectType, 'team'), eq(filePermissions.teamId, teamId))
          )!
        )
      )
      .all();

    // 同一文件多条权限记录时取最高权限: admin > write > read
    for (const p of perms) {
      const existing = permsMap.get(p.fileId);
      if (!existing || permissionRank(p.permission) > permissionRank(existing.permission)) {
        permsMap.set(p.fileId, { permission: p.permission });
      }
    }
  }

  const filesWithPerm: TeamFileItem[] = [];

  for (const file of allFiles) {
    if (!file.id) continue;

    // 文件所有者总有完全权限
    if (file.userId === viewerUserId) {
      filesWithPerm.push({
        fileId: file.id,
        fileName: file.name,
        filePath: file.path,
        fileType: file.type,
        mimeType: file.mimeType,
        size: file.size,
        isFolder: file.isFolder,
        mountedAt: mountedAtMap.get(file.id) || '',
        permission: 'admin',
        targetFolderId: targetFolderMap.get(file.id) ?? null,
      });
      continue;
    }

    // 从批量结果中查找权限
    const perm = permsMap.get(file.id);

    if (perm) {
      filesWithPerm.push({
        fileId: file.id,
        fileName: file.name,
        filePath: file.path,
        fileType: file.type,
        mimeType: file.mimeType,
        size: file.size,
        isFolder: file.isFolder,
        mountedAt: mountedAtMap.get(file.id) || '',
        permission: perm.permission as 'read' | 'write' | 'admin',
        targetFolderId: targetFolderMap.get(file.id) ?? null,
      });
    }
  }

  const total = filesWithPerm.length;
  const paged = filesWithPerm.slice(offset, offset + limit);

  return { files: paged, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 新增：团队存储统计
// ─────────────────────────────────────────────────────────────────────────────

export async function getTeamStorageStats(
  db: DrizzleDb,
  teamId: string
): Promise<{ storageQuota: number; storageUsed: number; usagePercent: number; fileCount: number } | null> {
  const team = await db.select().from(teams).where(eq(teams.id, teamId)).get();
  if (!team) return null;

  const quota = (team as any).storageQuota ?? 5368709120;

  // 实际计算：团队自有文件大小 + 挂载资源文件大小
  const [teamFilesResult, mountedFilesResult, resourceCount] = await Promise.all([
    // 团队自有文件（teamId 字段标记）
    db
      .select({ totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)` })
      .from(files)
      .where(and(eq(files.teamId, teamId), isNull(files.deletedAt)))
      .get(),
    // 挂载资源（通过 teamResources 关联 files 表）
    db
      .select({ totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)` })
      .from(teamResources)
      .innerJoin(files, eq(teamResources.fileId, files.id))
      .where(and(eq(teamResources.teamId, teamId), isNull(files.deletedAt)))
      .get(),
    // 挂载资源数量
    db
      .select({ count: sql<number>`count(*)` })
      .from(teamResources)
      .where(eq(teamResources.teamId, teamId))
      .get(),
  ]);

  const used = (teamFilesResult?.totalSize ?? 0) + (mountedFilesResult?.totalSize ?? 0);

  return {
    storageQuota: quota,
    storageUsed: used,
    usagePercent: quota > 0 ? Math.round((used / quota) * 10000) / 100 : 0,
    fileCount: Number(resourceCount?.count ?? 0),
  };
}
