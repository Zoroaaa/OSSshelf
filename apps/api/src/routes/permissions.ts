/**
 * permissions.ts
 * 文件权限与标签路由
 *
 * 功能:
 * - 文件权限授予与撤销（支持用户和组）
 * - 权限查询与检查
 * - 文件标签管理
 * - 批量标签操作
 */

import { Hono } from 'hono';
import { eq, and, inArray, like, isNull, count, desc } from 'drizzle-orm';
import {
  getDb,
  files,
  filePermissions,
  users,
  fileTags,
  userGroups,
  groupMembers,
  teams,
  teamMembers,
  roleTemplates,
} from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, logger } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { checkPermissionWithCache, invalidatePermissionCache } from '../lib/permissionResolver';
import { createNotification, getUserInfo } from '../lib/notificationUtils';
import { TAG_COLORS } from '@osshelf/shared';

export {
  checkFilePermission,
  inheritParentPermissions,
  setFolderAccessLevel,
  manageGroupMembers,
  type SetFolderAccessLevelInput,
  type ManageGroupMembersInput,
} from '../lib/permissionService';

import {
  checkFilePermission,
  createPermissionRequest,
  approvePermissionRequest,
  listPermissionRequests,
  batchGrantPermissions,
  batchRevokePermissions,
} from '../lib/permissionService';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const grantPermissionSchema = z.object({
  fileId: z.string().min(1),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  teamId: z.string().optional(),
  permission: z.enum(['read', 'write', 'admin']),
  subjectType: z.enum(['user', 'group', 'team']).default('user'),
  expiresAt: z.string().optional(),
});

const revokePermissionSchema = z.object({
  fileId: z.string().min(1),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  teamId: z.string().optional(),
});

const addTagSchema = z.object({
  fileId: z.string().min(1),
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const removeTagSchema = z.object({
  fileId: z.string().min(1),
  tagName: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// checkFilePermission / inheritParentPermissions 已迁移至 ../lib/permissionService
// 此处仅保留 re-export，确保所有现有 import 路径兼容
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 静态路由必须在参数化路由之前定义
// ─────────────────────────────────────────────────────────────────────────────

app.get('/all', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const userFiles = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const fileIds = userFiles.map((f) => f.id);

  if (fileIds.length === 0) {
    return c.json({ success: true, data: { permissions: [] } });
  }

  const CHUNK_SIZE = 100;
  const chunks = [];
  for (let i = 0; i < fileIds.length; i += CHUNK_SIZE) {
    chunks.push(fileIds.slice(i, i + CHUNK_SIZE));
  }

  const permissionChunks = await Promise.all(
    chunks.map((chunk) =>
      db
        .select({
          id: filePermissions.id,
          subjectType: filePermissions.subjectType,
          userId: filePermissions.userId,
          groupId: filePermissions.groupId,
          teamId: filePermissions.teamId,
          permission: filePermissions.permission,
          expiresAt: filePermissions.expiresAt,
          createdAt: filePermissions.createdAt,
          fileId: filePermissions.fileId,
          fileName: files.name,
          filePath: files.path,
          isFolder: files.isFolder,
          userName: users.name,
          userEmail: users.email,
          groupName: userGroups.name,
          teamName: teams.name,
        })
        .from(filePermissions)
        .innerJoin(files, eq(filePermissions.fileId, files.id))
        .leftJoin(users, eq(filePermissions.userId, users.id))
        .leftJoin(userGroups, eq(filePermissions.groupId, userGroups.id))
        .leftJoin(teams, eq(filePermissions.teamId, teams.id))
        .where(inArray(filePermissions.fileId, chunk))
        .all()
    )
  );

  const permissions = permissionChunks.flat();

  const formattedPermissions = permissions.map((p) => ({
    id: p.id,
    subjectType: p.subjectType,
    subjectId: p.subjectType === 'user' ? p.userId : p.subjectType === 'group' ? p.groupId : p.teamId,
    subjectName:
      p.subjectType === 'user'
        ? p.userName || p.userEmail || '未知用户'
        : p.subjectType === 'group'
          ? p.groupName || '未知组'
          : p.teamName || '未知团队',
    fileId: p.fileId,
    fileName: p.fileName,
    filePath: p.filePath,
    isFolder: p.isFolder,
    permission: p.permission,
    expiresAt: p.expiresAt,
    createdAt: p.createdAt,
  }));

  return c.json({ success: true, data: { permissions: formattedPermissions } });
});

app.get('/users/search', async (c) => {
  const userId = c.get('userId')!;
  const query = c.req.query('q') || '';
  const db = getDb(c.env.DB);

  if (query.length < 2) {
    return c.json({ success: true, data: [] });
  }

  const matchedUsers = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(like(users.email, `%${query}%`))
    .limit(10);

  const filteredUsers = matchedUsers.filter((u) => u.id !== userId);

  return c.json({
    success: true,
    data: filteredUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
    })),
  });
});

app.get('/tags/user', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const tags = await db.select().from(fileTags).where(eq(fileTags.userId, userId)).all();

  const uniqueTags = Array.from(new Map(tags.map((t) => [t.name, t])).values());

  return c.json({ success: true, data: uniqueTags });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST 路由
// ─────────────────────────────────────────────────────────────────────────────

app.post('/grant', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = grantPermissionSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, userId: targetUserId, groupId, teamId, permission, subjectType, expiresAt } = result.data;

  if (subjectType === 'user' && !targetUserId) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '用户ID不能为空' } }, 400);
  }

  if (subjectType === 'group' && !groupId) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '用户组ID不能为空' } }, 400);
  }

  if (subjectType === 'team' && !teamId) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '团队ID不能为空' } }, 400);
  }

  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND', '文件不存在或无权限');
  }

  if (subjectType === 'user') {
    const targetUser = await db.select().from(users).where(eq(users.id, targetUserId!)).get();
    if (!targetUser) {
      throwAppError('USER_NOT_FOUND', '目标用户不存在');
    }
  } else if (subjectType === 'group') {
    const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId!)).get();
    if (!group) {
      throwAppError('GROUP_NOT_FOUND', '用户组不存在');
    }

    const membership = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId!), eq(groupMembers.userId, userId)))
      .get();

    if (!membership || membership.role !== 'admin') {
      throwAppError('FORBIDDEN', '只有组管理员可以授权');
    }

    // 检查目标文件是否属于当前用户自己（避免授予自己的组导致文件重复显示）
    const targetFile = await db
      .select({ id: files.id, name: files.name })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)))
      .get();
    if (targetFile) {
      logger.warn('PERMISSIONS', '用户将自己的文件授予所在用户组，可能导致文件重复显示', {
        userId,
        fileId,
        fileName: targetFile.name,
        groupId,
        groupName: group.name,
      });
    }
  } else {
    // subjectType === 'team': 验证团队存在且操作者是 admin/owner
    const team = await db.select().from(teams).where(eq(teams.id, teamId!)).get();
    if (!team) {
      throwAppError('TEAM_NOT_FOUND', '团队不存在');
    }

    const teamMembership = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId!), eq(teamMembers.userId, userId)))
      .get();

    if (!teamMembership || (teamMembership.role !== 'admin' && teamMembership.role !== 'owner')) {
      throwAppError('FORBIDDEN', '只有团队管理员可以授予团队权限');
    }
  }

  const now = new Date().toISOString();

  const grantPermissionForFile = async (fId: string) => {
    let whereClause;
    if (subjectType === 'user') {
      whereClause = and(eq(filePermissions.fileId, fId), eq(filePermissions.userId, targetUserId!));
    } else if (subjectType === 'group') {
      whereClause = and(eq(filePermissions.fileId, fId), eq(filePermissions.groupId, groupId!));
    } else {
      // team
      whereClause = and(eq(filePermissions.fileId, fId), eq(filePermissions.teamId, teamId!));
    }

    const existing = await db.select().from(filePermissions).where(whereClause).get();

    if (existing) {
      await db
        .update(filePermissions)
        .set({
          permission,
          expiresAt: expiresAt || null,
          updatedAt: now,
        })
        .where(eq(filePermissions.id, existing.id));
    } else {
      await db.insert(filePermissions).values({
        id: crypto.randomUUID(),
        fileId: fId,
        userId: subjectType === 'user' ? targetUserId! : null,
        groupId: subjectType === 'group' ? groupId! : null,
        teamId: subjectType === 'team' ? teamId! : null,
        subjectType,
        permission,
        grantedBy: userId,
        expiresAt: expiresAt || null,
        inheritToChildren: true,
        scope: 'explicit',
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  await grantPermissionForFile(fileId);

  if (file.isFolder) {
    const folderPath = file.path.endsWith('/') ? file.path.slice(0, -1) : file.path;
    const childFiles = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.userId, file.userId), isNull(files.deletedAt), like(files.path, `${folderPath}/%`)))
      .all();

    for (const child of childFiles) {
      await grantPermissionForFile(child.id);
    }
  }

  await invalidatePermissionCache(c.env, fileId);

  await createAuditLog({
    env: c.env,
    userId,
    action: 'permission.grant',
    resourceType: 'permission',
    resourceId: fileId,
    details: {
      targetUserId,
      targetGroupId: groupId,
      permission,
      subjectType,
      expiresAt,
      fileName: file.name,
      isFolder: file.isFolder,
    },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const granterInfo = await getUserInfo(c.env, userId);
        const granterName = granterInfo?.name || granterInfo?.email || '用户';

        if (subjectType === 'user' && targetUserId && targetUserId !== userId) {
          await createNotification(c.env, {
            userId: targetUserId,
            type: 'permission_granted',
            title: '您被授予了文件权限',
            body: `${granterName} 授予了您对「${file.name}」的${permission === 'read' ? '读取' : permission === 'write' ? '读写' : '管理'}权限`,
            data: {
              fileId,
              fileName: file.name,
              isFolder: file.isFolder,
              permission,
              granterId: userId,
              granterName,
            },
          });
        }

        await createNotification(c.env, {
          userId,
          type: 'permission_granted_to',
          title: '权限授予成功',
          body: `您已将「${file.name}」的${permission === 'read' ? '读取' : permission === 'write' ? '读写' : '管理'}权限授予给${subjectType === 'user' ? '用户' : '用户组'}`,
          data: {
            fileId,
            fileName: file.name,
            isFolder: file.isFolder,
            permission,
            targetUserId,
            targetGroupId: groupId,
            subjectType,
          },
        });
      } catch (error) {
        logger.error('PERMISSIONS', '发送通知失败', {}, error);
      }
    })()
  );

  return c.json({
    success: true,
    data: { message: '权限已授予', fileId, userId: targetUserId, groupId, permission },
  });
});

app.post('/revoke', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = revokePermissionSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, userId: targetUserId, groupId, teamId } = result.data;
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND', '文件不存在或无权限');
  }

  let whereClause;
  if (targetUserId) {
    whereClause = and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, targetUserId));
  } else if (teamId) {
    whereClause = and(eq(filePermissions.fileId, fileId), eq(filePermissions.teamId, teamId));
  } else {
    whereClause = and(eq(filePermissions.fileId, fileId), eq(filePermissions.groupId, groupId!));
  }

  await db.delete(filePermissions).where(whereClause);

  await invalidatePermissionCache(c.env, fileId);

  await createAuditLog({
    env: c.env,
    userId,
    action: 'permission.revoke',
    resourceType: 'permission',
    resourceId: fileId,
    details: { targetUserId, targetGroupId: groupId, fileName: file.name },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '权限已撤销' } });
});

app.post('/tags/create', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();

  const createSchema = z.object({
    name: z.string().min(1).max(50),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  });
  const result = createSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { name, color } = result.data;
  const db = getDb(c.env.DB);

  // 检查是否已存在同名标签
  const existing = await db
    .select()
    .from(fileTags)
    .where(and(eq(fileTags.userId, userId), eq(fileTags.name, name)))
    .get();
  if (existing) {
    return c.json({ success: false, error: { code: 'TAG_EXISTS', message: '标签名称已存在' } }, 409);
  }

  const tagId = crypto.randomUUID();
  const now = new Date().toISOString();
  const resolvedColor = color || TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] || '#6366f1';

  // 插入一条"种子"记录（fileId 为空字符串表示这是标签定义）
  await db.insert(fileTags).values({
    id: tagId,
    fileId: '',
    userId,
    name,
    color: resolvedColor,
    createdAt: now,
  });

  logger.info('Permissions', 'Tag created', { userId, name, color: resolvedColor });

  return c.json({
    success: true,
    data: { id: tagId, name, color: resolvedColor, createdAt: now },
  });
});

app.post('/tags/add', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = addTagSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, name, color } = result.data;
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write', c.env);
  if (!hasAccess) {
    throwAppError('FILE_WRITE_DENIED', '无权修改此文件');
  }

  const existing = await db
    .select()
    .from(fileTags)
    .where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, name)))
    .get();

  if (existing) {
    return c.json({ success: true, data: existing });
  }

  const tagId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(fileTags).values({
    id: tagId,
    fileId,
    userId,
    name,
    color: color || '#6366f1',
    createdAt: now,
  });

  return c.json({
    success: true,
    data: { id: tagId, fileId, userId, name, color: color || '#6366f1', createdAt: now },
  });
});

app.post('/tags/remove', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = removeTagSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, tagName } = result.data;
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write', c.env);
  if (!hasAccess) {
    throwAppError('FILE_WRITE_DENIED', '无权修改此文件');
  }

  await db
    .delete(fileTags)
    .where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, tagName), eq(fileTags.userId, userId)));

  return c.json({ success: true, data: { message: '标签已移除' } });
});

const batchTagsSchema = z.object({
  fileIds: z.array(z.string().min(1)).max(100),
});

app.post('/tags/batch', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchTagsSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds } = result.data;
  const db = getDb(c.env.DB);

  const permittedFileIds: string[] = [];
  for (const fid of fileIds) {
    const { hasAccess } = await checkFilePermission(db, fid, userId, 'read', c.env);
    if (hasAccess) {
      permittedFileIds.push(fid);
    }
  }

  if (permittedFileIds.length === 0) {
    return c.json({ success: true, data: {} });
  }

  const tags = await db.select().from(fileTags).where(inArray(fileTags.fileId, permittedFileIds)).all();

  const tagsByFileId: Record<string, typeof tags> = {};
  for (const tag of tags) {
    if (!tagsByFileId[tag.fileId]) {
      tagsByFileId[tag.fileId] = [];
    }
    tagsByFileId[tag.fileId].push(tag);
  }

  return c.json({ success: true, data: tagsByFileId });
});

// ─────────────────────────────────────────────────────────────────────────────
// 参数化路由（必须在静态路由之后）
// ─────────────────────────────────────────────────────────────────────────────

app.get('/file/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const permissions = await db
    .select({
      id: filePermissions.id,
      userId: filePermissions.userId,
      groupId: filePermissions.groupId,
      permission: filePermissions.permission,
      grantedBy: filePermissions.grantedBy,
      subjectType: filePermissions.subjectType,
      expiresAt: filePermissions.expiresAt,
      scope: filePermissions.scope,
      createdAt: filePermissions.createdAt,
      userName: users.name,
      userEmail: users.email,
      groupName: userGroups.name,
    })
    .from(filePermissions)
    .leftJoin(users, eq(filePermissions.userId, users.id))
    .leftJoin(userGroups, eq(filePermissions.groupId, userGroups.id))
    .where(eq(filePermissions.fileId, fileId))
    .all();

  return c.json({
    success: true,
    data: {
      isOwner,
      permissions: permissions.map((p) => ({
        id: p.id,
        userId: p.userId,
        groupId: p.groupId,
        permission: p.permission,
        grantedBy: p.grantedBy,
        subjectType: p.subjectType,
        expiresAt: p.expiresAt,
        scope: p.scope,
        userName: p.userName,
        userEmail: p.userEmail,
        groupName: p.groupName,
        createdAt: p.createdAt,
      })),
    },
  });
});

app.get('/tags/file/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const tags = await db.select().from(fileTags).where(eq(fileTags.fileId, fileId)).all();

  return c.json({ success: true, data: tags });
});

// ── 标签统计（按使用次数排序）──
app.get('/tags/stats', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const results = await db
    .select({ name: fileTags.name, count: count() })
    .from(fileTags)
    .where(eq(fileTags.userId, userId))
    .groupBy(fileTags.name)
    .orderBy(desc(count()))
    .limit(100)
    .all();

  return c.json({
    success: true,
    data: results.map((r) => ({ name: r.name, count: Number(r.count) })),
  });
});

// ── 重命名标签（批量更新该用户所有同名标签）──
const renameTagSchema = z.object({
  oldName: z.string().min(1).max(50),
  newName: z.string().min(1).max(50),
});

app.put('/tags/rename', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = renameTagSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { oldName, newName } = result.data;

  if (oldName === newName) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '新名称与原名称相同' } },
      400
    );
  }

  const db = getDb(c.env.DB);

  // 检查新名称是否已存在
  const existing = await db
    .select()
    .from(fileTags)
    .where(and(eq(fileTags.userId, userId), eq(fileTags.name, newName)))
    .get();

  if (existing) {
    return c.json({ success: false, error: { code: 'TAG_EXISTS', message: `标签 "${newName}" 已存在` } }, 409);
  }

  // 批量更新
  await db
    .update(fileTags)
    .set({ name: newName })
    .where(and(eq(fileTags.userId, userId), eq(fileTags.name, oldName)));

  logger.info('Permissions', 'Tag renamed', { userId, oldName, newName });

  return c.json({ success: true, data: { message: '标签已重命名' } });
});

// ── 删除标签（从该用户所有文件中移除）──
app.delete('/tags/:tagName', async (c) => {
  const userId = c.get('userId')!;
  const tagName = decodeURIComponent(c.req.param('tagName'));
  const db = getDb(c.env.DB);

  const result = await db
    .delete(fileTags)
    .where(and(eq(fileTags.userId, userId), eq(fileTags.name, tagName)))
    .run();

  logger.info('Permissions', 'Tag deleted', { userId, tagName, affectedRows: result.meta.changes });

  return c.json({ success: true, data: { message: '标签已删除', affectedRows: result.meta.changes } });
});

app.get('/check/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const result = await checkFilePermission(db, fileId, userId, 'read', c.env);

  return c.json({
    success: true,
    data: {
      hasAccess: result.hasAccess,
      permission: result.permission,
      isOwner: result.isOwner,
    },
  });
});

app.get('/resolve/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const resolution = await checkPermissionWithCache(db, c.env, fileId, userId, 'read');

  return c.json({
    success: true,
    data: resolution,
  });
});

const updatePermissionSchema = z.object({
  permission: z.enum(['read', 'write', 'admin']),
  expiresAt: z.string().optional().nullable(),
});

app.patch('/:permissionId', async (c) => {
  const userId = c.get('userId')!;
  const permissionId = c.req.param('permissionId');
  const body = await c.req.json();
  const result = updatePermissionSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { permission, expiresAt } = result.data;
  const db = getDb(c.env.DB);

  const existingPermission = await db.select().from(filePermissions).where(eq(filePermissions.id, permissionId)).get();

  if (!existingPermission) {
    throwAppError('NOT_FOUND', '权限记录不存在');
  }

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, existingPermission.fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    throwAppError('FORBIDDEN', '无权修改此权限');
  }

  const now = new Date().toISOString();
  await db
    .update(filePermissions)
    .set({
      permission,
      expiresAt: expiresAt || null,
      updatedAt: now,
    })
    .where(eq(filePermissions.id, permissionId));

  await invalidatePermissionCache(c.env, existingPermission.fileId);

  await createAuditLog({
    env: c.env,
    userId,
    action: 'permission.update',
    resourceType: 'permission',
    resourceId: permissionId,
    details: {
      fileId: existingPermission.fileId,
      targetUserId: existingPermission.userId,
      targetGroupId: existingPermission.groupId,
      oldPermission: existingPermission.permission,
      newPermission: permission,
      expiresAt,
    },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '权限已更新' } });
});

app.delete('/:permissionId', async (c) => {
  const userId = c.get('userId')!;
  const permissionId = c.req.param('permissionId');
  const db = getDb(c.env.DB);

  const existingPermission = await db.select().from(filePermissions).where(eq(filePermissions.id, permissionId)).get();

  if (!existingPermission) {
    throwAppError('NOT_FOUND', '权限记录不存在');
  }

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, existingPermission.fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    throwAppError('FORBIDDEN', '无权删除此权限');
  }

  await db.delete(filePermissions).where(eq(filePermissions.id, permissionId));

  await invalidatePermissionCache(c.env, existingPermission.fileId);

  await createAuditLog({
    env: c.env,
    userId,
    action: 'permission.delete',
    resourceType: 'permission',
    resourceId: permissionId,
    details: {
      fileId: existingPermission.fileId,
      targetUserId: existingPermission.userId,
      targetGroupId: existingPermission.groupId,
    },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '权限已删除' } });
});

// ─────────────────────────────────────────────────────────────────────────────
// 权限申请相关路由
// ─────────────────────────────────────────────────────────────────────────────

const createPermissionRequestSchema = z.object({
  fileId: z.string().min(1),
  requestedPermission: z.enum(['read', 'write', 'admin']),
  reason: z.string().optional(),
  targetTeamId: z.string().optional(),
});

app.post('/requests', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createPermissionRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  try {
    const requestResult = await createPermissionRequest(c.env, userId, result.data);
    return c.json({ success: true, data: requestResult });
  } catch (error) {
    logger.error('PERMISSIONS', '创建权限申请失败', { userId }, error);
    throwAppError('INTERNAL_ERROR', '创建权限申请失败');
  }
});

app.get('/requests/my', async (c) => {
  const userId = c.get('userId')!;
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);

  try {
    const result = await listPermissionRequests(c.env, userId, { type: 'my', page, limit });
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('PERMISSIONS', '获取我的权限申请失败', { userId }, error);
    throwAppError('INTERNAL_ERROR', '获取权限申请列表失败');
  }
});

app.get('/requests/pending', async (c) => {
  const userId = c.get('userId')!;
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);

  try {
    const result = await listPermissionRequests(c.env, userId, { type: 'pending', page, limit });
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('PERMISSIONS', '获取待审批申请失败', { userId }, error);
    throwAppError('INTERNAL_ERROR', '获取待审批申请列表失败');
  }
});

const reviewRequestSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().optional(),
});

app.put('/requests/:requestId/review', async (c) => {
  const userId = c.get('userId')!;
  const requestId = c.req.param('requestId');
  const body = await c.req.json();
  const result = reviewRequestSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  try {
    const reviewResult = await approvePermissionRequest(c.env, userId, { requestId, ...result.data });
    return c.json({ success: true, data: reviewResult });
  } catch (error) {
    logger.error('PERMISSIONS', '审批权限申请失败', { userId, requestId }, error);
    throwAppError('INTERNAL_ERROR', '审批权限申请失败');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 批量操作路由
// ─────────────────────────────────────────────────────────────────────────────

const batchGrantSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(50),
  targetUserId: z.string().optional(),
  targetGroupId: z.string().optional(),
  targetTeamId: z.string().optional(),
  permission: z.enum(['read', 'write', 'admin']),
  subjectType: z.enum(['user', 'group', 'team']).default('user'),
});

app.post('/batch-grant', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchGrantSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  try {
    const batchResult = await batchGrantPermissions(c.env, userId, result.data);
    return c.json({ success: true, data: batchResult });
  } catch (error) {
    logger.error('PERMISSIONS', '批量授权失败', { userId }, error);
    throwAppError('INTERNAL_ERROR', '批量授权失败');
  }
});

const batchRevokeSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(50),
  targetUserId: z.string().optional(),
  targetGroupId: z.string().optional(),
  targetTeamId: z.string().optional(),
  subjectType: z.enum(['user', 'group', 'team']).default('user'),
});

app.post('/batch-revoke', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchRevokeSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  try {
    const batchResult = await batchRevokePermissions(c.env, userId, result.data);
    return c.json({ success: true, data: batchResult });
  } catch (error) {
    logger.error('PERMISSIONS', '批量撤销失败', { userId }, error);
    throwAppError('INTERNAL_ERROR', '批量撤销失败');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 角色模板路由
// ─────────────────────────────────────────────────────────────────────────────

app.get('/roles/templates', async (c) => {
  const db = getDb(c.env.DB);

  const templates = await db
    .select({
      id: roleTemplates.id,
      name: roleTemplates.name,
      slug: roleTemplates.slug,
      permissions: roleTemplates.permissions,
      isBuiltin: roleTemplates.isBuiltin,
      description: roleTemplates.description,
    })
    .from(roleTemplates)
    .orderBy(roleTemplates.name)
    .all();

  const formattedTemplates = templates.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    permissions: typeof t.permissions === 'string' ? JSON.parse(t.permissions) : t.permissions,
    isBuiltin: t.isBuiltin,
    description: t.description,
  }));

  return c.json({ success: true, data: formattedTemplates });
});

export default app;
