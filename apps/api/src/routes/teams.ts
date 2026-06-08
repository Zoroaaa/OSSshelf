/**
 * teams.ts
 * 团队管理路由
 *
 * 功能:
 * - 创建/列出/获取/更新/删除团队
 * - 团队成员管理（添加/移除/角色变更/列表）
 * - 团队资源挂载/卸载/列表
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb, teams, teamMembers, teamResources, files, users } from '../db';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import {
  createTeam,
  getTeam,
  updateTeam,
  deleteTeam,
  listTeams,
  manageTeamMembers,
  listTeamMembers,
  mountResourceToTeam,
  unmountResourceFromTeam,
  listTeamResources,
} from '../lib/teamService';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// Zod 验证 Schema
// ─────────────────────────────────────────────────────────────────────────────

const createTeamSchema = z.object({
  name: z.string().min(1, '团队名称不能为空').max(100, '团队名称过长'),
  description: z.string().max(500, '描述过长').optional(),
});

const updateTeamSchema = z.object({
  name: z.string().min(1, '团队名称不能为空').max(100, '团队名称过长').optional(),
  description: z.string().max(500, '描述过长').optional(),
});

const addMemberSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  role: z.enum(['admin', 'member', 'guest']).default('member'),
});

const changeRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'guest']),
});

const mountResourceSchema = z.object({
  fileId: z.string().min(1, '文件ID不能为空'),
});

// ═══════════════════════════════════════════════════════════════════════════
// 团队 CRUD
// ═══════════════════════════════════════════════════════════════════════════

/** 列出用户的团队（owned + joined） */
app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const result = await listTeams(db, userId);

  return c.json({ success: true, data: result });
});

/** 创建团队 */
app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const parseResult = createTeamSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: parseResult.error.errors[0].message },
      },
      400
    );
  }

  const result = await createTeam(c.env, userId, parseResult.data);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: (result as { success: false; error: string }).error } },
      400
    );
  }

  const successResult = result as { success: true; teamId: string; message: string };
  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.create' as never,
    resourceType: 'team',
    resourceId: successResult.teamId,
    details: { name: parseResult.data.name, description: parseResult.data.description },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { id: successResult.teamId, message: successResult.message } });
});

/** 获取团队详情 */
app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const db = getDb(c.env.DB);

  const team = await getTeam(db, teamId, userId);

  if (!team) {
    throwAppError('TEAM_NOT_FOUND', '团队不存在');
  }

  // 获取当前用户角色
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();

  return c.json({
    success: true,
    data: {
      ...team,
      userRole: membership?.role ?? null,
      isOwner: team.ownerId === userId,
    },
  });
});

/** 更新团队信息 */
app.put('/:id', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const body = await c.req.json();
  const parseResult = updateTeamSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: parseResult.error.errors[0].message },
      },
      400
    );
  }

  const result = await updateTeam(c.env, userId, teamId, parseResult.data);

  if (!result.success) {
    throwAppError('TEAM_UPDATE_FAILED', (result as { success: false; error: string }).error);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.update' as never,
    resourceType: 'team',
    resourceId: teamId,
    details: parseResult.data,
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: (result as { success: true; message: string }).message } });
});

/** 删除团队 */
app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');

  const result = await deleteTeam(c.env, userId, teamId);

  if (!result.success) {
    throwAppError('TEAM_DELETE_FAILED', (result as { success: false; error: string }).error);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.delete' as never,
    resourceType: 'team',
    resourceId: teamId,
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: (result as { success: true; message: string }).message } });
});

// ═══════════════════════════════════════════════════════════════════════════
// 成员管理
// ═══════════════════════════════════════════════════════════════════════════

/** 列出团队成员 */
app.get('/:id/members', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const db = getDb(c.env.DB);

  // 验证当前用户是否是团队成员
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();

  if (!membership) {
    throwAppError('TEAM_ACCESS_DENIED', '您不是该团队的成员');
  }

  const members = await listTeamMembers(db, teamId);

  // 补充 userEmail
  const membersWithEmail = await Promise.all(
    members.map(async (m) => {
      const user = await db.select({ email: users.email }).from(users).where(eq(users.id, m.userId)).get();
      return { ...m, userEmail: user?.email ?? null };
    })
  );

  return c.json({ success: true, data: membersWithEmail });
});

/** 添加成员 */
app.post('/:id/members', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const body = await c.req.json();
  const parseResult = addMemberSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: parseResult.error.errors[0].message },
      },
      400
    );
  }

  const { userId: targetUserId, role } = parseResult.data;

  const result = await manageTeamMembers(c.env, userId, teamId, {
    action: 'add',
    targetUserId,
    role,
  });

  if ('error' in result && !result.success) {
    if ('alreadyMember' in result && result.alreadyMember) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '用户已是团队成员' } },
        400
      );
    }
    throwAppError('MEMBER_ADD_FAILED', (result as { success: false; error: string }).error);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.member.add' as never,
    resourceType: 'team',
    resourceId: teamId,
    details: { targetUserId, role },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: result });
});

/** 移除成员 */
app.delete('/:id/members/:memberUserId', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const memberUserId = c.req.param('memberUserId');

  const result = await manageTeamMembers(c.env, userId, teamId, {
    action: 'remove',
    targetUserId: memberUserId,
  });

  if (!result.success) {
    throwAppError('MEMBER_REMOVE_FAILED', (result as { success: false; error: string }).error);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.member.remove' as never,
    resourceType: 'team',
    resourceId: teamId,
    details: { targetUserId: memberUserId },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: result });
});

/** 变更角色 */
app.put('/:id/members/:memberUserId/role', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const memberUserId = c.req.param('memberUserId');
  const body = await c.req.json();
  const parseResult = changeRoleSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: parseResult.error.errors[0].message },
      },
      400
    );
  }

  const result = await manageTeamMembers(c.env, userId, teamId, {
    action: 'change_role',
    targetUserId: memberUserId,
    role: parseResult.data.role,
  });

  if (!result.success) {
    throwAppError('ROLE_CHANGE_FAILED', (result as { success: false; error: string }).error);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.member.role_change' as never,
    resourceType: 'team',
    resourceId: teamId,
    details: { targetUserId: memberUserId, newRole: parseResult.data.role },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: result });
});

// ═══════════════════════════════════════════════════════════════════════════
// 资源挂载
// ═══════════════════════════════════════════════════════════════════════════

/** 挂载资源到团队 */
app.post('/:id/resources', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const body = await c.req.json();
  const parseResult = mountResourceSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: parseResult.error.errors[0].message },
      },
      400
    );
  }

  const result = await mountResourceToTeam(c.env, userId, teamId, parseResult.data.fileId);

  if (!result.success) {
    throwAppError('RESOURCE_MOUNT_FAILED', (result as { success: false; error: string }).error);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.resource.mount' as never,
    resourceType: 'team_resource',
    resourceId: teamId,
    details: { fileId: parseResult.data.fileId },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: result.message } });
});

/** 从团队卸载资源 */
app.delete('/:id/resources/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const fileId = c.req.param('fileId');

  const result = await unmountResourceFromTeam(c.env, userId, teamId, fileId);

  if (!result.success) {
    throwAppError('RESOURCE_UNMOUNT_FAILED', (result as { success: false; error: string }).error);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.resource.unmount' as never,
    resourceType: 'team_resource',
    resourceId: teamId,
    details: { fileId },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: (result as { success: true; message: string }).message } });
});

/** 列出团队资源 */
app.get('/:id/resources/list', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const db = getDb(c.env.DB);

  // 验证访问权限
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();

  if (!membership) {
    throwAppError('TEAM_ACCESS_DENIED', '您不是该团队的成员');
  }

  const resources = await listTeamResources(db, teamId);

  // 补充文件详细信息
  const resourcesWithFileInfo = await Promise.all(
    resources.map(async (r) => {
      const file = await db
        .select({
          fileName: files.name,
          filePath: files.path,
          isFolder: files.isFolder,
          mimeType: files.mimeType,
          size: files.size,
        })
        .from(files)
        .where(eq(files.id, r.fileId))
        .get();
      return {
        ...r,
        file: file ?? null,
      };
    })
  );

  return c.json({ success: true, data: resourcesWithFileInfo });
});

export default app;
