/**
 * webdav.service.ts
 * WebDAV 协议业务逻辑服务
 *
 * 功能:
 * - WebDAV 会话管理
 * - 文件操作（GET/PUT/DELETE/MKCOL/COPY/MOVE）
 * - 目录列表（PROPFIND）
 * - 权限验证
 */

import { eq, and, isNull, isNotNull, like } from 'drizzle-orm';
import { getDb, users, files, storageBuckets, webdavSessions } from '../db';
import { s3Get, s3Put, s3Delete } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { getEncryptionKey } from '../lib/crypto';
import { WEBDAV_SESSION_EXPIRY, MAX_FILE_SIZE } from '@osshelf/shared';
import type { Env } from '../types/env';

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseWebDAVPath(path: string): { parentId: string | null; name: string } {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { parentId: null, name: '' };
  }
  const name = segments[segments.length - 1];
  return { parentId: null, name };
}

function buildPathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

async function findFileByPath(
  db: ReturnType<typeof getDb>,
  userId: string,
  path: string
): Promise<typeof files.$inferSelect | null> {
  const segments = buildPathSegments(path);
  if (segments.length === 0) return null;

  let currentParentId: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;

    const conditions: any[] = [
      eq(files.userId, userId),
      eq(files.name, segment),
      isNull(files.deletedAt),
      currentParentId ? eq(files.parentId, currentParentId) : isNull(files.parentId),
    ];

    const file = await db.select().from(files).where(and(...conditions)).get();

    if (!file) return null;

    if (isLast) return file;

    if (!file.isFolder) return null;

    currentParentId = file.id;
  }

  return null;
}

async function ensureParentFolders(
  db: ReturnType<typeof getDb>,
  userId: string,
  path: string
): Promise<string | null> {
  const segments = buildPathSegments(path);
  if (segments.length <= 1) return null;

  const parentSegments = segments.slice(0, -1);
  let currentParentId: string | null = null;

  for (const segment of parentSegments) {
    const conditions: any[] = [
      eq(files.userId, userId),
      eq(files.name, segment),
      isNull(files.deletedAt),
      currentParentId ? eq(files.parentId, currentParentId) : isNull(files.parentId),
      eq(files.isFolder, true),
    ];

    let folder = await db.select().from(files).where(and(...conditions)).get();

    if (!folder) {
      const folderId = crypto.randomUUID();
      const now = new Date().toISOString();
      const folderPath = currentParentId ? `${currentParentId}/${segment}` : `/${segment}`;

      await db.insert(files).values({
        id: folderId,
        userId,
        parentId: currentParentId,
        name: segment,
        path: folderPath,
        type: 'folder',
        size: 0,
        r2Key: `folders/${folderId}`,
        mimeType: null,
        hash: null,
        isFolder: true,
        bucketId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      currentParentId = folderId;
    } else {
      currentParentId = folder.id;
    }
  }

  return currentParentId;
}

export async function createWebDAVSession(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  userAgent?: string
) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return { success: false, error: '用户不存在' };
  }

  const token = generateSessionToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + WEBDAV_SESSION_EXPIRY).toISOString();

  await db.insert(webdavSessions).values({
    id: crypto.randomUUID(),
    userId,
    token,
    createdAt: now,
    expiresAt,
  });

  return {
    success: true,
    data: {
      token,
      expiresAt,
      username: user.email,
      password: token,
    },
  };
}

export async function validateWebDAVSession(
  db: ReturnType<typeof getDb>,
  email: string,
  token: string
) {
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    return { valid: false };
  }

  const session = await db
    .select()
    .from(webdavSessions)
    .where(and(eq(webdavSessions.userId, user.id), eq(webdavSessions.token, token)))
    .get();

  if (!session) {
    return { valid: false };
  }

  if (new Date(session.expiresAt) < new Date()) {
    await db.delete(webdavSessions).where(eq(webdavSessions.id, session.id));
    return { valid: false };
  }

  return { valid: true, userId: user.id, user };
}

export async function webdavPropFind(
  db: ReturnType<typeof getDb>,
  userId: string,
  path: string,
  depth: '0' | '1' | 'infinity'
) {
  const targetFile = await findFileByPath(db, userId, path);

  const items: typeof files.$inferSelect[] = [];

  if (targetFile) {
    items.push(targetFile);

    if (depth !== '0' && targetFile.isFolder) {
      const children = await db
        .select()
        .from(files)
        .where(and(eq(files.parentId, targetFile.id), isNull(files.deletedAt)))
        .all();
      items.push(...children);

      if (depth === 'infinity') {
        const queue = [...children.filter((c) => c.isFolder)];
        while (queue.length > 0) {
          const folder = queue.shift()!;
          const subChildren = await db
            .select()
            .from(files)
            .where(and(eq(files.parentId, folder.id), isNull(files.deletedAt)))
            .all();
          items.push(...subChildren);
          queue.push(...subChildren.filter((c) => c.isFolder));
        }
      }
    }
  } else if (path === '/' || path === '') {
    const rootItems = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.parentId), isNull(files.deletedAt)))
      .all();
    items.push(...rootItems);
  }

  return items;
}

export async function webdavGet(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  path: string
) {
  const file = await findFileByPath(db, userId, path);
  if (!file) {
    return { success: false, error: '文件不存在', status: 404 };
  }

  if (file.isFolder) {
    return { success: false, error: '无法下载文件夹', status: 400 };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);
    return {
      success: true,
      data: {
        body: s3Res.body,
        headers: {
          'Content-Type': file.mimeType || 'application/octet-stream',
          'Content-Length': file.size.toString(),
          'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
        },
      },
    };
  }

  if (env.FILES) {
    const obj = await env.FILES.get(file.r2Key);
    if (!obj) {
      return { success: false, error: '文件内容不存在', status: 404 };
    }
    return {
      success: true,
      data: {
        body: obj.body,
        headers: {
          'Content-Type': file.mimeType || 'application/octet-stream',
          'Content-Length': file.size.toString(),
          'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
        },
      },
    };
  }

  return { success: false, error: '存储桶未配置', status: 500 };
}

export async function webdavPut(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  path: string,
  content: ArrayBuffer,
  contentType: string
) {
  if (content.byteLength > MAX_FILE_SIZE) {
    return { success: false, error: '文件大小超过限制', status: 413 };
  }

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && user.storageUsed + content.byteLength > user.storageQuota) {
    return { success: false, error: '存储配额已满', status: 507 };
  }

  const segments = buildPathSegments(path);
  const fileName = segments[segments.length - 1] || 'untitled';

  const parentId = await ensureParentFolders(db, userId, path);

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, null, parentId);
  if (!bucketConfig) {
    return { success: false, error: '存储桶未配置', status: 500 };
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, content.byteLength);
  if (quotaErr) {
    return { success: false, error: quotaErr, status: 507 };
  }

  const existingFile = await findFileByPath(db, userId, path);
  const now = new Date().toISOString();
  const fileId = existingFile?.id || crypto.randomUUID();
  const r2Key = `files/${userId}/${fileId}/${fileName}`;

  await s3Put(bucketConfig, r2Key, content, contentType);

  if (existingFile) {
    const sizeDiff = content.byteLength - existingFile.size;
    await db
      .update(files)
      .set({
        size: content.byteLength,
        mimeType: contentType,
        updatedAt: now,
        bucketId: bucketConfig.id,
      })
      .where(eq(files.id, existingFile.id));

    if (user) {
      await db
        .update(users)
        .set({ storageUsed: user.storageUsed + sizeDiff, updatedAt: now })
        .where(eq(users.id, userId));
    }

    await updateBucketStats(db, bucketConfig.id, sizeDiff, 0);
  } else {
    const filePath = parentId ? `${parentId}/${fileName}` : `/${fileName}`;

    await db.insert(files).values({
      id: fileId,
      userId,
      parentId,
      name: fileName,
      path: filePath,
      type: 'file',
      size: content.byteLength,
      r2Key,
      mimeType: contentType,
      hash: null,
      isFolder: false,
      bucketId: bucketConfig.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    if (user) {
      await db
        .update(users)
        .set({ storageUsed: user.storageUsed + content.byteLength, updatedAt: now })
        .where(eq(users.id, userId));
    }

    await updateBucketStats(db, bucketConfig.id, content.byteLength, 1);
  }

  return { success: true, data: { fileId, size: content.byteLength } };
}

export async function webdavDelete(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  path: string
) {
  const file = await findFileByPath(db, userId, path);
  if (!file) {
    return { success: false, error: '文件不存在', status: 404 };
  }

  const now = new Date().toISOString();

  if (file.isFolder) {
    const children = await db
      .select()
      .from(files)
      .where(and(eq(files.parentId, file.id), isNull(files.deletedAt)))
      .all();

    if (children.length > 0) {
      for (const child of children) {
        await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, child.id));
      }
    }
  } else {
    const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
    if (bucketConfig) {
      try {
        await s3Delete(bucketConfig, file.r2Key);
      } catch (e) {
        console.error('S3 delete error:', e);
      }
      await updateBucketStats(db, bucketConfig.id, -file.size, -1);
    } else if (env.FILES) {
      await env.FILES.delete(file.r2Key);
    }

    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      await db
        .update(users)
        .set({ storageUsed: Math.max(0, user.storageUsed - file.size), updatedAt: now })
        .where(eq(users.id, userId));
    }
  }

  await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, file.id));

  return { success: true };
}

export async function webdavMkCol(
  db: ReturnType<typeof getDb>,
  userId: string,
  path: string
) {
  const existing = await findFileByPath(db, userId, path);
  if (existing) {
    return { success: false, error: '资源已存在', status: 405 };
  }

  const segments = buildPathSegments(path);
  const folderName = segments[segments.length - 1] || 'New Folder';

  const parentId = await ensureParentFolders(db, userId, path);

  const folderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const folderPath = parentId ? `${parentId}/${folderName}` : `/${folderName}`;

  await db.insert(files).values({
    id: folderId,
    userId,
    parentId,
    name: folderName,
    path: folderPath,
    type: 'folder',
    size: 0,
    r2Key: `folders/${folderId}`,
    mimeType: null,
    hash: null,
    isFolder: true,
    bucketId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  return { success: true, data: { folderId } };
}

export async function webdavCopy(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  sourcePath: string,
  destPath: string
) {
  const sourceFile = await findFileByPath(db, userId, sourcePath);
  if (!sourceFile) {
    return { success: false, error: '源文件不存在', status: 404 };
  }

  if (sourceFile.isFolder) {
    return { success: false, error: '暂不支持复制文件夹', status: 400 };
  }

  const destFile = await findFileByPath(db, userId, destPath);
  if (destFile) {
    return { success: false, error: '目标位置已存在同名文件', status: 405 };
  }

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && user.storageUsed + sourceFile.size > user.storageQuota) {
    return { success: false, error: '存储配额已满', status: 507 };
  }

  const destSegments = buildPathSegments(destPath);
  const destFileName = destSegments[destSegments.length - 1] || sourceFile.name;
  const destParentId = await ensureParentFolders(db, userId, destPath);

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, null, destParentId);
  if (!bucketConfig) {
    return { success: false, error: '存储桶未配置', status: 500 };
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, sourceFile.size);
  if (quotaErr) {
    return { success: false, error: quotaErr, status: 507 };
  }

  const sourceBucketConfig = await resolveBucketConfig(db, userId, encKey, sourceFile.bucketId, sourceFile.parentId);
  let fileContent: ArrayBuffer;

  if (sourceBucketConfig) {
    const s3Res = await s3Get(sourceBucketConfig, sourceFile.r2Key);
    fileContent = await s3Res.arrayBuffer();
  } else if (env.FILES) {
    const obj = await env.FILES.get(sourceFile.r2Key);
    if (!obj) {
      return { success: false, error: '源文件内容不存在', status: 404 };
    }
    fileContent = await obj.arrayBuffer();
  } else {
    return { success: false, error: '存储桶未配置', status: 500 };
  }

  const newFileId = crypto.randomUUID();
  const newR2Key = `files/${userId}/${newFileId}/${destFileName}`;
  const now = new Date().toISOString();

  await s3Put(bucketConfig, newR2Key, fileContent, sourceFile.mimeType || 'application/octet-stream');

  const destFilePath = destParentId ? `${destParentId}/${destFileName}` : `/${destFileName}`;

  await db.insert(files).values({
    id: newFileId,
    userId,
    parentId: destParentId,
    name: destFileName,
    path: destFilePath,
    type: 'file',
    size: sourceFile.size,
    r2Key: newR2Key,
    mimeType: sourceFile.mimeType,
    hash: sourceFile.hash,
    isFolder: false,
    bucketId: bucketConfig.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  if (user) {
    await db
      .update(users)
      .set({ storageUsed: user.storageUsed + sourceFile.size, updatedAt: now })
      .where(eq(users.id, userId));
  }

  await updateBucketStats(db, bucketConfig.id, sourceFile.size, 1);

  return { success: true, data: { fileId: newFileId } };
}

export async function webdavMove(
  db: ReturnType<typeof getDb>,
  userId: string,
  sourcePath: string,
  destPath: string
) {
  const sourceFile = await findFileByPath(db, userId, sourcePath);
  if (!sourceFile) {
    return { success: false, error: '源文件不存在', status: 404 };
  }

  const destFile = await findFileByPath(db, userId, destPath);
  if (destFile) {
    return { success: false, error: '目标位置已存在同名文件', status: 405 };
  }

  const destSegments = buildPathSegments(destPath);
  const destFileName = destSegments[destSegments.length - 1] || sourceFile.name;
  const destParentId = await ensureParentFolders(db, userId, destPath);

  const now = new Date().toISOString();
  const destFilePath = destParentId ? `${destParentId}/${destFileName}` : `/${destFileName}`;

  await db
    .update(files)
    .set({
      name: destFileName,
      parentId: destParentId,
      path: destFilePath,
      updatedAt: now,
    })
    .where(eq(files.id, sourceFile.id));

  return { success: true };
}

export async function listWebDAVSessions(db: ReturnType<typeof getDb>, userId: string) {
  const sessions = await db.select().from(webdavSessions).where(eq(webdavSessions.userId, userId)).all();

  const now = new Date();
  const active = sessions.filter((s) => new Date(s.expiresAt) > now);
  const expired = sessions.filter((s) => new Date(s.expiresAt) <= now);

  for (const s of expired) {
    await db.delete(webdavSessions).where(eq(webdavSessions.id, s.id));
  }

  return active;
}

export async function revokeWebDAVSession(db: ReturnType<typeof getDb>, userId: string, sessionId: string) {
  const session = await db
    .select()
    .from(webdavSessions)
    .where(and(eq(webdavSessions.id, sessionId), eq(webdavSessions.userId, userId)))
    .get();

  if (!session) {
    return { success: false, error: '会话不存在' };
  }

  await db.delete(webdavSessions).where(eq(webdavSessions.id, sessionId));

  return { success: true };
}
