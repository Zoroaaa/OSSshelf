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
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, teamMembers, teamResources, files, users } from '../db';
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
  getTeamFiles,
  getTeamStorageStats,
} from '../lib/teamService';
import {
  createInvite,
  listPendingInvites,
  listAllInvites,
  revokeInvite,
  type InviteInfo,
} from '../lib/inviteService';
import { listTeamActivities } from '../lib/teamActivityService';
import { recordActivityWithEnv } from '../lib/teamActivityService';

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
  storageQuota: z.number().min(52428800, '最小 50MB').max(1099511627776, '最大 1TB').optional(),
  defaultMemberRole: z.enum(['member', 'guest', 'admin']).optional(),
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
  targetFolderId: z.string().nullable().optional(),
  /** 文件夹挂载时是否穿透下级（默认 true） */
  penetrate: z.boolean().default(true),
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
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: (result as { success: false; error: string }).error },
      },
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

  // 补充 name 和 email
  const membersWithInfo = await Promise.all(
    members.map(async (m) => {
      const user = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, m.userId))
        .get();
      return {
        id: m.id,
        teamId,
        userId: m.userId,
        role: m.role,
        addedBy: null,
        createdAt: m.createdAt,
        name: user?.name ?? m.userName ?? null,
        email: user?.email ?? null,
      };
    })
  );

  return c.json({ success: true, data: membersWithInfo });
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

  const result = await mountResourceToTeam(c.env, userId, teamId, parseResult.data.fileId, {
    targetFolderId: parseResult.data.targetFolderId,
    penetrate: parseResult.data.penetrate,
  });

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

// ════════════════════════════════════════════════════════════════════════════
// 工作区文件浏览
// ════════════════════════════════════════════════════════════════════════════

/** 获取团队工作区文件列表 */
app.get('/:id/workspace/files', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const folderId = c.req.query('folderId') || undefined;
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const result = await getTeamFiles(c.env, teamId, userId, { folderId, limit, offset });
    return c.json({ success: true, data: result });
  } catch (e: any) {
    throwAppError('WORKSPACE_ERROR', (e as Error).message || '获取工作区文件失败');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 邀请管理
// ════════════════════════════════════════════════════════════════════════════

/** 创建邀请链接 */
app.post('/:id/invites', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const body = await c.req.json();

  const createInviteSchema = z.object({
    role: z.enum(['member', 'guest']).default('member'),
    email: z.string().email('邮箱格式不正确').optional(),
    message: z.string().max(200).optional(),
    expiresInDays: z.number().min(1).max(30).default(7),
  });
  const parseResult = createInviteSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: parseResult.error.errors[0].message },
      },
      400
    );
  }

  // 从请求头构建真实 baseUrl（优先 Origin，其次 Host）
  const origin = c.req.header('origin') || '';
  const host = c.req.header('host') || '';
  const protocol = c.req.header('x-forwarded-proto') || (c.req.header('x-forwarded-host') ? 'https' : 'http');
  const requestBaseUrl = origin || (host ? `${protocol}://${host}` : '');

  const result = await createInvite(c.env, userId, {
    teamId,
    inviterUserId: userId,
    ...parseResult.data,
    requestBaseUrl: requestBaseUrl || undefined,
  });

  if (!result.success) {
    throwAppError('INVITE_CREATE_FAILED', (result as { error: string }).error);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'team.invite.create' as never,
    resourceType: 'team_invite',
    resourceId: teamId,
    details: parseResult.data,
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: (result as { invite: InviteInfo }).invite });
});

/** 列出待定邀请 */
app.get('/:id/invites', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const db = getDb(c.env.DB);

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();
  if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
    throwAppError('FORBIDDEN', '只有管理员可查看邀请列表');
  }

  const invites = await listPendingInvites(db, teamId);
  return c.json({ success: true, data: { invites } });
});

/** 列出所有邀请记录（支持状态筛选）- 增强版 */
app.get('/:id/invites/all', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const status = c.req.query('status') as 'pending' | 'accepted' | 'expired' | 'revoked' | undefined;
  const db = getDb(c.env.DB);

  // 权限验证：只有团队成员可以查看邀请记录
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();
  if (!membership) {
    throwAppError('TEAM_ACCESS_DENIED', '您不是该团队的成员');
  }

  // 验证状态参数合法性
  if (status && !['pending', 'accepted', 'expired', 'revoked'].includes(status)) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无效的状态值' } },
      400
    );
  }

  const invites = await listAllInvites(db, teamId, status);
  return c.json({ success: true, data: { invites } });
});

/** 撤销邀请 */
app.delete('/:id/invites/:inviteId', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const inviteId = c.req.param('inviteId');

  const result = await revokeInvite(c.env, teamId, inviteId, userId);
  if (!result.success) {
    throwAppError('INVITE_REVOKE_FAILED', (result as { error: string }).error);
  }

  return c.json({ success: true, data: { message: '邀请已撤销' } });
});

/** 接受邀请（已登录用户通过 API） */
app.post('/:id/invites/:token/accept', async (c) => {
  const userId = c.get('userId')!;
  const token = c.req.param('token');

  const { acceptInvite } = await import('../lib/inviteService');
  const result = await acceptInvite(c.env, token, userId);
  if (!result.success) {
    throwAppError('INVITE_ACCEPT_FAILED', (result as { error: string }).error);
  }

  return c.json({ success: true, data: result });
});

// ════════════════════════════════════════════════════════════════════════════
// 团队活动流
// ════════════════════════════════════════════════════════════════════════════

/** 获取团队活动时间线 */
app.get('/:id/activities', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const db = getDb(c.env.DB);
  const limit = parseInt(c.req.query('limit') || '30', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();
  if (!membership) {
    throwAppError('TEAM_ACCESS_DENIED', '您不是该团队成员');
  }

  const result = await listTeamActivities(db, { teamId, limit, offset });
  return c.json({ success: true, data: result });
});

// ════════════════════════════════════════════════════════════════════════════
// 存储统计
// ════════════════════════════════════════════════════════════════════════════

/** 获取团队存储统计 */
app.get('/:id/storage', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const db = getDb(c.env.DB);

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();
  if (!membership) {
    throwAppError('TEAM_ACCESS_DENIED', '您不是该团队成员');
  }

  const stats = await getTeamStorageStats(db, teamId);
  if (!stats) throwAppError('TEAM_NOT_FOUND', '团队不存在');

  return c.json({ success: true, data: stats });
});

// ════════════════════════════════════════════════════════════════
// 团队共享空间 — 文件操作（类似个人 Files 的子集）
// ════════════════════════════════════════════════════════════════

/** 在团队空间中新建文件夹 */
app.post('/:id/workspace/folder', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const body = await c.req.json();
  const db = getDb(c.env.DB);

  // 验证权限：admin 或 owner 或有 write 权限的成员
  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();
  if (!membership) throwAppError('TEAM_ACCESS_DENIED', '您不是该团队成员');
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throwAppError('FORBIDDEN', '只有管理员可以在团队空间中创建文件夹');
  }

  const nameSchema = z.object({ name: z.string().min(1).max(255), parentId: z.string().optional() });
  const result = nameSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );

  const { name, parentId } = result.data;

  // 如果指定了 parentId，验证它属于这个团队或已挂载到这个团队
  if (parentId) {
    const parentFile = await db
      .select({ id: files.id, fileTeamId: files.teamId })
      .from(files)
      .where(and(eq(files.id, parentId), isNull(files.deletedAt)))
      .get();
    if (!parentFile) throwAppError('NOT_FOUND', '父文件夹不存在');
    const mountedToTeam = await db
      .select()
      .from(teamResources)
      .where(and(eq(teamResources.teamId, teamId), eq(teamResources.fileId, parentId)))
      .get();
    if (parentFile.fileTeamId !== teamId && !mountedToTeam) {
      throwAppError('FORBIDDEN', '只能在团队空间内的文件夹中创建子文件夹');
    }
  }

  const now = new Date().toISOString();
  const folderId = crypto.randomUUID();
  // 构建文件夹完整路径
  let folderPath: string;
  if (parentId) {
    const parentFile = await db.select({ path: files.path }).from(files).where(eq(files.id, parentId)).get();
    folderPath = (parentFile?.path || `/teams/${teamId}/`) + name.trim();
  } else {
    folderPath = `/teams/${teamId}/${name.trim()}`;
  }

  await db.insert(files).values({
    id: folderId,
    userId,
    parentId: parentId || null,
    name: name.trim(),
    path: folderPath,
    size: 0,
    r2Key: `teams/${teamId}/${folderId}/${name.trim()}`,
    isFolder: true,
    refCount: 0,
    createdAt: now,
    updatedAt: now,
    teamId, // ★ 标记为团队文件
  });

  await recordActivityWithEnv(c.env, {
    teamId,
    userId,
    action: 'file_uploaded',
    resourceType: 'file',
    resourceId: folderId,
    details: { fileName: name, isFolder: true },
  });

  return c.json({
    success: true,
    data: { id: folderId, name: name.trim(), isFolder: true, createdAt: now },
  });
});

/** 列出团队空间的所有文件（挂载的 + 团队自有的） */
app.get('/:id/workspace/all-files', async (c) => {
  const userId = c.get('userId')!;
  const teamId = c.req.param('id');
  const folderId = c.req.query('folderId') || undefined;
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const db = getDb(c.env.DB);

  const membership = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();
  if (!membership) throwAppError('TEAM_ACCESS_DENIED', '您不是该团队成员');

  // 直接使用 getTeamFiles()，它内部已正确区分 owned/mounted 并返回 source 字段
  const workspaceResult = await getTeamFiles(c.env, teamId, userId, { folderId, limit: 999, offset: 0 });

  const total = workspaceResult.files.length;
  const paged = workspaceResult.files.slice(offset, offset + limit);

  return c.json({ success: true, data: { files: paged, total } });
});

export default app;
