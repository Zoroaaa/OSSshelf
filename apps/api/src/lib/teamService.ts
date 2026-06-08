/**
 * teamService.ts — 团队管理核心服务层
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb, teams, teamMembers, teamResources, files, users } from '../db';
import type { DrizzleDb } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';

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
}

export interface ManageTeamMembersInput {
  action: 'add' | 'remove' | 'change_role';
  targetUserId: string;
  role?: 'owner' | 'admin' | 'member' | 'guest';
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

  if (!name && !description) {
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

  await db.update(teams).set(updates).where(eq(teams.id, teamId));

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

  // 级联删除由数据库 ON DELETE CASCADE 处理
  await db.delete(teams).where(eq(teams.id, teamId));

  logger.info('TeamService', '删除团队', { userId, teamId, teamName: team.name });
  return { success: true, message: `团队 "${team.name}" 已删除` };
}

export async function listTeams(
  db: DrizzleDb,
  userId: string
): Promise<{ owned: Array<{ id: string; name: string; memberCount: number }>; joined: Array<{ id: string; name: string; role: string }> }> {
  const ownedTeams = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.ownerId, userId))
    .all();

  const ownedWithCounts = await Promise.all(
    ownedTeams.map(async (team) => {
      const count = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id))
        .all();
      return { ...team, memberCount: count.length };
    })
  );

  const joinedTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teamMembers.userId, userId), sql`${teamMembers.role} != 'owner'`))
    .all();

  return { owned: ownedWithCounts, joined: joinedTeams };
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

      await db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));

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
  fileId: string
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

  await db
    .delete(teamResources)
    .where(and(eq(teamResources.teamId, teamId), eq(teamResources.fileId, fileId)));

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
