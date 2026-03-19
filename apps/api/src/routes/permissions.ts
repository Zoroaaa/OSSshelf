/**
 * permissions.ts
 * 文件权限与标签路由
 *
 * 功能:
 * - 文件权限授予与撤销
 * - 权限查询与检查
 * - 文件标签管理
 * - 批量标签操作
 */

import { Hono } from 'hono';
import { eq, and, inArray, like } from 'drizzle-orm';
import { getDb, files, filePermissions, users, fileTags } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const grantPermissionSchema = z.object({
  fileId: z.string().min(1),
  userId: z.string().min(1),
  permission: z.enum(['read', 'write', 'admin']),
});

const revokePermissionSchema = z.object({
  fileId: z.string().min(1),
  userId: z.string().min(1),
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
  requiredPermission: 'read' | 'write' | 'admin'
): Promise<{ hasAccess: boolean; permission: string | null; isOwner: boolean }> {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    return { hasAccess: false, permission: null, isOwner: false };
  }

  if (file.userId === userId) {
    return { hasAccess: true, permission: 'admin', isOwner: true };
  }

  const permission = await db
    .select()
    .from(filePermissions)
    .where(and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, userId)))
    .get();

  if (!permission) {
    return { hasAccess: false, permission: null, isOwner: false };
  }

  const permissionLevels = { read: 1, write: 2, admin: 3 };
  const hasAccess =
    permissionLevels[permission.permission as keyof typeof permissionLevels] >= permissionLevels[requiredPermission];

  return { hasAccess, permission: permission.permission, isOwner: false };
}

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

  const { fileId, userId: targetUserId, permission } = result.data;
  const db = getDb(c.env.DB);

  const file = await checkFileOwnership(db, fileId, userId);
  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在或无权限' } }, 404);
  }

  const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).get();
  if (!targetUser) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '目标用户不存在' } }, 404);
  }

  const existing = await db
    .select()
    .from(filePermissions)
    .where(and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, targetUserId)))
    .get();

  const now = new Date().toISOString();

  if (existing) {
    await db.update(filePermissions).set({ permission, updatedAt: now }).where(eq(filePermissions.id, existing.id));
  } else {
    await db.insert(filePermissions).values({
      id: crypto.randomUUID(),
      fileId,
      userId: targetUserId,
      permission,
      grantedBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.move',
    resourceType: 'permission',
    resourceId: fileId,
    details: { targetUserId, permission, fileName: file.name },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '权限已授予', fileId, userId: targetUserId, permission } });
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

  const { fileId, userId: targetUserId } = result.data;
  const db = getDb(c.env.DB);

  const file = await checkFileOwnership(db, fileId, userId);
  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在或无权限' } }, 404);
  }

  await db
    .delete(filePermissions)
    .where(and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, targetUserId)));

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.delete',
    resourceType: 'permission',
    resourceId: fileId,
    details: { targetUserId, fileName: file.name },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: { message: '权限已撤销' } });
});

app.get('/file/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'read');
  if (!hasAccess) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权访问此文件' } }, 403);
  }

  const permissions = await db
    .select({
      id: filePermissions.id,
      userId: filePermissions.userId,
      permission: filePermissions.permission,
      grantedBy: filePermissions.grantedBy,
      createdAt: filePermissions.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(filePermissions)
    .leftJoin(users, eq(filePermissions.userId, users.id))
    .where(eq(filePermissions.fileId, fileId))
    .all();

  return c.json({
    success: true,
    data: {
      isOwner,
      permissions: permissions.map((p) => ({
        id: p.id,
        userId: p.userId,
        permission: p.permission,
        grantedBy: p.grantedBy,
        userName: p.userName,
        userEmail: p.userEmail,
        createdAt: p.createdAt,
      })),
    },
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

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write');
  if (!hasAccess) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权修改此文件' } }, 403);
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

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write');
  if (!hasAccess) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权修改此文件' } }, 403);
  }

  await db.delete(fileTags).where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, tagName)));

  return c.json({ success: true, data: { message: '标签已移除' } });
});

app.get('/tags/file/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read');
  if (!hasAccess) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权访问此文件' } }, 403);
  }

  const tags = await db.select().from(fileTags).where(eq(fileTags.fileId, fileId)).all();

  return c.json({ success: true, data: tags });
});

app.get('/tags/user', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const tags = await db.select().from(fileTags).where(eq(fileTags.userId, userId)).all();

  const uniqueTags = Array.from(new Map(tags.map((t) => [t.name, t])).values());

  return c.json({ success: true, data: uniqueTags });
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

  const tags = await db.select().from(fileTags).where(inArray(fileTags.fileId, fileIds)).all();

  const tagsByFileId: Record<string, typeof tags> = {};
  for (const tag of tags) {
    if (!tagsByFileId[tag.fileId]) {
      tagsByFileId[tag.fileId] = [];
    }
    tagsByFileId[tag.fileId].push(tag);
  }

  return c.json({ success: true, data: tagsByFileId });
});

app.get('/check/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const result = await checkFilePermission(db, fileId, userId, 'read');

  return c.json({
    success: true,
    data: {
      hasAccess: result.hasAccess,
      permission: result.permission,
      isOwner: result.isOwner,
    },
  });
});

// ── 用户搜索接口（供普通用户搜索其他用户以授权）────────────────────────────────
app.get('/users/search', async (c) => {
  const userId = c.get('userId')!;
  const query = c.req.query('q') || '';
  const db = getDb(c.env.DB);

  // 最少需要2个字符才能搜索
  if (query.length < 2) {
    return c.json({ success: true, data: [] });
  }

  // 搜索邮箱匹配的用户，排除当前用户自己
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

  // 过滤掉当前用户
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

export default app;
