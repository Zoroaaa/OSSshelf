/**
 * groups.ts
 * 用户组管理路由
 *
 * 功能:
 * - 创建/列出/删除用户组
 * - 组成员管理（添加/移除/角色变更）
 * - 组权限查询
 */

import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb, userGroups, groupMembers, users, filePermissions, files } from '../db';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

const createGroupSchema = z.object({
  name: z.string().min(1, '组名不能为空').max(100, '组名过长'),
  description: z.string().max(500, '描述过长').optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1, '组名不能为空').max(100, '组名过长').optional(),
  description: z.string().max(500, '描述过长').optional(),
});

const addMemberSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  role: z.enum(['member', 'admin']).default('member'),
});

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const ownedGroups = await db
    .select()
    .from(userGroups)
    .where(eq(userGroups.ownerId, userId))
    .orderBy(desc(userGroups.createdAt))
    .all();

  const memberGroups = await db
    .select({
      id: userGroups.id,
      ownerId: userGroups.ownerId,
      name: userGroups.name,
      description: userGroups.description,
      createdAt: userGroups.createdAt,
      updatedAt: userGroups.updatedAt,
    })
    .from(groupMembers)
    .innerJoin(userGroups, eq(groupMembers.groupId, userGroups.id))
    .where(and(eq(groupMembers.userId, userId), sql`${userGroups.ownerId} != ${userId}`))
    .orderBy(desc(userGroups.createdAt))
    .all();

  return c.json({
    success: true,
    data: {
      owned: ownedGroups,
      memberOf: memberGroups,
    },
  });
});

app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createGroupSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { name, description } = result.data;
  const db = getDb(c.env.DB);

  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(userGroups).values({
    id: groupId,
    ownerId: userId,
    name,
    description: description || null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(groupMembers).values({
    id: crypto.randomUUID(),
    groupId,
    userId,
    role: 'admin',
    addedBy: userId,
    createdAt: now,
  });

  await createAuditLog({
    env: c.env,
    userId,
    action: 'group.create',
    resourceType: 'group',
    resourceId: groupId,
    details: { name, description },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({
    success: true,
    data: {
      id: groupId,
      name,
      description,
      createdAt: now,
    },
  });
});

app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const db = getDb(c.env.DB);

  const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).get();

  if (!group) {
    throwAppError('GROUP_NOT_FOUND', '用户组不存在');
  }

  const membership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();

  if (!membership) {
    throwAppError('GROUP_ACCESS_DENIED', '您不是此组的成员');
  }

  const memberCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .get();

  return c.json({
    success: true,
    data: {
      ...group,
      memberCount: memberCount?.count ?? 0,
      userRole: membership.role,
      isOwner: group.ownerId === userId,
    },
  });
});

app.put('/:id', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const body = await c.req.json();
  const result = updateGroupSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);

  const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).get();

  if (!group) {
    throwAppError('GROUP_NOT_FOUND', '用户组不存在');
  }

  if (group.ownerId !== userId) {
    throwAppError('FORBIDDEN', '只有组所有者可以修改组信息');
  }

  const { name, description } = result.data;
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;

  await db.update(userGroups).set(updateData).where(eq(userGroups.id, groupId));

  await createAuditLog({
    env: c.env,
    userId,
    action: 'group.update',
    resourceType: 'group',
    resourceId: groupId,
    details: { name, description },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '组信息已更新' } });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const db = getDb(c.env.DB);

  const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).get();

  if (!group) {
    throwAppError('GROUP_NOT_FOUND', '用户组不存在');
  }

  if (group.ownerId !== userId) {
    throwAppError('FORBIDDEN', '只有组所有者可以删除组');
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'group.delete',
    resourceType: 'group',
    resourceId: groupId,
    details: { name: group.name },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  await db.delete(userGroups).where(eq(userGroups.id, groupId));

  return c.json({ success: true, data: { message: '用户组已删除' } });
});

app.get('/:id/members', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const db = getDb(c.env.DB);

  const membership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();

  if (!membership) {
    throwAppError('GROUP_ACCESS_DENIED', '您不是此组的成员');
  }

  const members = await db
    .select({
      id: groupMembers.id,
      userId: groupMembers.userId,
      role: groupMembers.role,
      addedBy: groupMembers.addedBy,
      createdAt: groupMembers.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(groupMembers)
    .leftJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(desc(groupMembers.role), desc(groupMembers.createdAt))
    .all();

  return c.json({
    success: true,
    data: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      addedBy: m.addedBy,
      createdAt: m.createdAt,
      name: m.userName,
      email: m.userEmail,
    })),
  });
});

app.post('/:id/members', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const body = await c.req.json();
  const result = addMemberSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { userId: targetUserId, role } = result.data;
  const db = getDb(c.env.DB);

  const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).get();

  if (!group) {
    throwAppError('GROUP_NOT_FOUND', '用户组不存在');
  }

  const operatorMembership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();

  if (!operatorMembership || operatorMembership.role !== 'admin') {
    throwAppError('FORBIDDEN', '只有组管理员可以添加成员');
  }

  const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).get();

  if (!targetUser) {
    throwAppError('USER_NOT_FOUND', '目标用户不存在');
  }

  const existingMembership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
    .get();

  if (existingMembership) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '用户已是组成员' } }, 400);
  }

  const memberRecordId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(groupMembers).values({
    id: memberRecordId,
    groupId,
    userId: targetUserId,
    role,
    addedBy: userId,
    createdAt: now,
  });

  await createAuditLog({
    env: c.env,
    userId,
    action: 'group.member.add',
    resourceType: 'group',
    resourceId: groupId,
    details: { targetUserId, targetUserEmail: targetUser.email, role },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({
    success: true,
    data: {
      id: memberRecordId,
      userId: targetUserId,
      role,
      createdAt: now,
    },
  });
});

app.delete('/:id/members/:memberUserId', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const memberUserId = c.req.param('memberUserId');
  const db = getDb(c.env.DB);

  const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).get();

  if (!group) {
    throwAppError('GROUP_NOT_FOUND', '用户组不存在');
  }

  const operatorMembership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();

  const isSelf = memberUserId === userId;

  if (!operatorMembership) {
    throwAppError('GROUP_ACCESS_DENIED', '您不是此组的成员');
  }

  if (!isSelf && operatorMembership.role !== 'admin') {
    throwAppError('FORBIDDEN', '只有组管理员可以移除其他成员');
  }

  const targetMembership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberUserId)))
    .get();

  if (!targetMembership) {
    throwAppError('MEMBER_NOT_FOUND', '该用户不是组成员');
  }

  if (targetMembership.role === 'admin' && group.ownerId !== userId) {
    throwAppError('FORBIDDEN', '只有组所有者可以移除管理员');
  }

  if (memberUserId === group.ownerId) {
    throwAppError('FORBIDDEN', '不能移除组所有者');
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'group.member.remove',
    resourceType: 'group',
    resourceId: groupId,
    details: { targetUserId: memberUserId },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  await db.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberUserId)));

  return c.json({ success: true, data: { message: '成员已移除' } });
});

app.put('/:id/members/:memberUserId/role', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const memberUserId = c.req.param('memberUserId');
  const { role } = await c.req.json();

  if (!role || !['member', 'admin'].includes(role)) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无效的角色' } }, 400);
  }

  const db = getDb(c.env.DB);

  const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).get();

  if (!group) {
    throwAppError('GROUP_NOT_FOUND', '用户组不存在');
  }

  if (group.ownerId !== userId) {
    throwAppError('FORBIDDEN', '只有组所有者可以更改成员角色');
  }

  const targetMembership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberUserId)))
    .get();

  if (!targetMembership) {
    throwAppError('MEMBER_NOT_FOUND', '该用户不是组成员');
  }

  if (memberUserId === group.ownerId) {
    throwAppError('FORBIDDEN', '不能更改组所有者的角色');
  }

  await db
    .update(groupMembers)
    .set({ role })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberUserId)));

  await createAuditLog({
    env: c.env,
    userId,
    action: 'group.member.role_change',
    resourceType: 'group',
    resourceId: groupId,
    details: { targetUserId: memberUserId, newRole: role },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '角色已更新' } });
});

app.get('/:id/files', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const db = getDb(c.env.DB);

  const membership = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();

  if (!membership) {
    throwAppError('GROUP_ACCESS_DENIED', '您不是此组的成员');
  }

  const permissions = await db
    .select({
      id: filePermissions.id,
      fileId: filePermissions.fileId,
      permission: filePermissions.permission,
      createdAt: filePermissions.createdAt,
      fileName: files.name,
      filePath: files.path,
    })
    .from(filePermissions)
    .leftJoin(files, eq(filePermissions.fileId, files.id))
    .where(and(eq(filePermissions.groupId, groupId), eq(filePermissions.subjectType, 'group')))
    .orderBy(desc(filePermissions.createdAt))
    .all();

  return c.json({
    success: true,
    data: permissions,
  });
});

export default app;
