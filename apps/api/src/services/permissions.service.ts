/**
 * permissions.service.ts
 * 文件权限与标签业务逻辑服务
 *
 * 功能:
 * - 文件权限授予与撤销
 * - 权限查询与检查
 * - 文件标签管理
 * - 批量标签操作
 */

import { eq, and, inArray, like } from 'drizzle-orm';
import { getDb, files, filePermissions, users, fileTags } from '../db';
import { ERROR_CODES } from '@osshelf/shared';

export async function checkFileOwnership(db: ReturnType<typeof getDb>, fileId: string, userId: string) {
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

export async function grantPermission(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string,
  targetUserId: string,
  permission: 'read' | 'write' | 'admin'
) {
  const file = await checkFileOwnership(db, fileId, userId);
  if (!file) {
    return { success: false, error: '文件不存在或无权限' };
  }

  const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).get();
  if (!targetUser) {
    return { success: false, error: '目标用户不存在' };
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

  return { success: true, data: { message: '权限已授予', fileId, userId: targetUserId, permission } };
}

export async function revokePermission(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string,
  targetUserId: string
) {
  const file = await checkFileOwnership(db, fileId, userId);
  if (!file) {
    return { success: false, error: '文件不存在或无权限' };
  }

  await db
    .delete(filePermissions)
    .where(and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, targetUserId)));

  return { success: true, data: { message: '权限已撤销' } };
}

export async function getFilePermissions(db: ReturnType<typeof getDb>, fileId: string, userId: string) {
  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'read');
  if (!hasAccess) {
    return { success: false, error: '无权访问此文件' };
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

  return {
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
  };
}
export async function addTag(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string,
  name: string,
  color?: string
) {
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write');
  if (!hasAccess) {
    return { success: false, error: '无权修改此文件' };
  }

  const existing = await db
    .select()
    .from(fileTags)
    .where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, name)))
    .get();

  if (existing) {
    return { success: true, data: existing };
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

  return {
    success: true,
    data: { id: tagId, fileId, userId, name, color: color || '#6366f1', createdAt: now },
  };
}
export async function removeTag(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string,
  tagName: string
) {
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write');
  if (!hasAccess) {
    return { success: false, error: '无权修改此文件' };
  }

  await db.delete(fileTags).where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, tagName)));

  return { success: true, data: { message: '标签已移除' } };
}
export async function getFileTags(db: ReturnType<typeof getDb>, fileId: string, userId: string) {
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read');
  if (!hasAccess) {
    return { success: false, error: '无权访问此文件' };
  }

  const tags = await db.select().from(fileTags).where(eq(fileTags.fileId, fileId)).all();
  return { success: true, data: tags };
}
export async function getUserTags(db: ReturnType<typeof getDb>, userId: string) {
  const tags = await db.select().from(fileTags).where(eq(fileTags.userId, userId)).all();
  const uniqueTags = Array.from(new Map(tags.map((t) => [t.name, t])).values());
  return { success: true, data: uniqueTags };
}
export async function getBatchTags(db: ReturnType<typeof getDb>, fileIds: string[]) {
  const tags = await db.select().from(fileTags).where(inArray(fileTags.fileId, fileIds)).all();

  const tagsByFileId: Record<string, typeof tags> = {};
  for (const tag of tags) {
    if (!tagsByFileId[tag.fileId]) {
      tagsByFileId[tag.fileId] = [];
    }
    tagsByFileId[tag.fileId].push(tag);
  }

  return { success: true, data: tagsByFileId };
}
export async function checkPermission(
  db: ReturnType<typeof getDb>,
  fileId: string,
  userId: string
) {
  const result = await checkFilePermission(db, fileId, userId, 'read');
  return {
    success: true,
    data: {
      hasAccess: result.hasAccess,
      permission: result.permission,
      isOwner: result.isOwner,
    },
  };
}
export async function searchUsers(
  db: ReturnType<typeof getDb>,
  userId: string,
  query: string
) {
  if (query.length < 2) {
    return { success: true, data: [] };
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

  return {
    success: true,
    data: filteredUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
    })),
  };
}
