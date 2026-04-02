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
import { eq, and, inArray, like, isNull, or } from 'drizzle-orm';
import { getDb, files, filePermissions, users, fileTags, userGroups, groupMembers } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import {
  checkPermissionWithCache,
  invalidatePermissionCache,
  resolveEffectivePermission,
  type PermissionLevel,
} from '../lib/permissionResolver';
import { createNotification, sendNotification, getUserInfo } from '../lib/notificationUtils';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const grantPermissionSchema = z.object({
  fileId: z.string().min(1),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  permission: z.enum(['read', 'write', 'admin']),
  subjectType: z.enum(['user', 'group']).default('user'),
  expiresAt: z.string().optional(),
});

const revokePermissionSchema = z.object({
  fileId: z.string().min(1),
  userId: z.string().optional(),
  groupId: z.string().optional(),
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

async function checkFileOwnership(db: ReturnType<typeof getDb>, fileId: string, userId: string) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();
  return file;
}

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
        const permissionLevels = { read: 1, write: 2, admin: 3 };
        const hasAccess =
          permissionLevels[groupPermission.permission as keyof typeof permissionLevels] >=
          permissionLevels[requiredPermission];
        return { hasAccess, permission: groupPermission.permission, isOwner: false };
      }
    }

    return { hasAccess: false, permission: null, isOwner: false };
  }

  if (permission.expiresAt && new Date(permission.expiresAt) < new Date()) {
    return { hasAccess: false, permission: null, isOwner: false };
  }

  const permissionLevels = { read: 1, write: 2, admin: 3 };
  const hasAccess =
    permissionLevels[permission.permission as keyof typeof permissionLevels] >= permissionLevels[requiredPermission];

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
        })
        .from(filePermissions)
        .innerJoin(files, eq(filePermissions.fileId, files.id))
        .leftJoin(users, eq(filePermissions.userId, users.id))
        .leftJoin(userGroups, eq(filePermissions.groupId, userGroups.id))
        .where(inArray(filePermissions.fileId, chunk))
        .all()
    )
  );

  const permissions = permissionChunks.flat();

  const formattedPermissions = permissions.map((p) => ({
    id: p.id,
    subjectType: p.subjectType,
    subjectId: p.subjectType === 'user' ? p.userId : p.groupId,
    subjectName: p.subjectType === 'user' ? p.userName || p.userEmail || '未知用户' : p.groupName || '未知组',
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

  const { fileId, userId: targetUserId, groupId, permission, subjectType, expiresAt } = result.data;

  if (subjectType === 'user' && !targetUserId) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '用户ID不能为空' } }, 400);
  }

  if (subjectType === 'group' && !groupId) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '用户组ID不能为空' } }, 400);
  }

  const db = getDb(c.env.DB);

  const file = await checkFileOwnership(db, fileId, userId);
  if (!file) {
    throwAppError('FILE_NOT_FOUND', '文件不存在或无权限');
  }

  if (subjectType === 'user') {
    const targetUser = await db.select().from(users).where(eq(users.id, targetUserId!)).get();
    if (!targetUser) {
      throwAppError('USER_NOT_FOUND', '目标用户不存在');
    }
  } else {
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
  }

  const now = new Date().toISOString();

  const grantPermissionForFile = async (fId: string) => {
    const whereClause =
      subjectType === 'user'
        ? and(eq(filePermissions.fileId, fId), eq(filePermissions.userId, targetUserId!))
        : and(eq(filePermissions.fileId, fId), eq(filePermissions.groupId, groupId!));

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
    const allFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, file.userId), isNull(files.deletedAt)))
      .all();

    const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(folderPath + '/'));
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
      } catch (e) {
        console.error('Failed to send notification:', e);
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

  const { fileId, userId: targetUserId, groupId } = result.data;
  const db = getDb(c.env.DB);

  const file = await checkFileOwnership(db, fileId, userId);
  if (!file) {
    throwAppError('FILE_NOT_FOUND', '文件不存在或无权限');
  }

  const whereClause = targetUserId
    ? and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, targetUserId))
    : and(eq(filePermissions.fileId, fileId), eq(filePermissions.groupId, groupId!));

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

export default app;
