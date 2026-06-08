/**
 * fileService.ts — 文件操作公共服务层
 *
 * 从 routes/files.ts 提取的核心业务逻辑，
 * 供 API 路由和 AI AgentTools 共同调用，避免重复实现。
 *
 * 功能:
 * - 文本文件创建（含存储写入、权限检查、MIME检测）
 * - 文件内容编辑（含版本快照、多存储后端支持）
 * - 文件移动（含循环检测、同名冲突、子路径更新）
 * - 软删除（含文件夹递归、通知、webhook）
 * - 重命名、收藏管理
 * - 文件夹创建
 */

import { eq, and, isNull, isNotNull, sql, inArray } from 'drizzle-orm';
import { getDb, files, users, userStars, storageBuckets, fileTags } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { checkFilePermission } from '../lib/permissionService';
import { inheritParentPermissions } from '../lib/permissionService';
import { inferMimeType } from '@osshelf/shared';
import { resolveBucketConfig, updateUserStorage, updateBucketStats, checkBucketQuota } from './bucketResolver';
import { getEncryptionKey } from './crypto';
import { createVersionSnapshot, shouldCreateVersion } from './versionManager';
import { dispatchWebhook } from './webhook';
import { readFileContent, writeFileContent } from './fileContentHelper';
import { deleteFileVector } from './ai/vectorIndex';

export interface CreateTextFileInput {
  name: string;
  content: string;
  parentId?: string | null;
  bucketId?: string | null;
  mimeType?: string;
}

export interface MoveFileInput {
  targetParentId?: string | null;
}

export interface RenameFileInput {
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 创建文本文件（复用 files.ts POST /create 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

export async function createTextFile(
  env: Env,
  userId: string,
  input: CreateTextFileInput
): Promise<{ success: true; fileId: string; file: Record<string, unknown> } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const encKey = getEncryptionKey(env);
  const { name, content, parentId, bucketId: requestedBucketId, mimeType: providedMimeType } = input;

  const fileMime = inferMimeType(name, providedMimeType);

  // 权限检查
  if (parentId) {
    const { hasAccess } = await checkFilePermission(db, parentId, userId, 'write', env);
    if (!hasAccess) {
      return { success: false, error: '无权向此目录创建文件' };
    }
  }

  // 存储配额检查
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  const contentBytes = new TextEncoder().encode(content);
  if (user && user.storageQuota! < 999999 * 1024 ** 3 && user.storageUsed + contentBytes.length > user.storageQuota!) {
    return { success: false, error: '用户存储配额已满' };
  }

  // 解析目标存储桶
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId, parentId);

  if (bucketConfig) {
    const quotaErr = await checkBucketQuota(db, bucketConfig.id, contentBytes.length);
    if (quotaErr) return { success: false, error: quotaErr };
  }

  const effectiveBucketId = bucketConfig?.id ?? requestedBucketId ?? null;
  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `files/${userId}/${fileId}/${name}`;
  const path = parentId ? `${parentId}/${name}` : `/${name}`;

  // 写入存储
  try {
    const writeResult = await writeFileContent(
      env,
      {
        id: fileId,
        r2Key,
        bucketId: effectiveBucketId,
        mimeType: fileMime,
        size: contentBytes.length,
        userId,
        parentId: parentId || null,
        name,
        path,
        isFolder: false,
        createdAt: now,
        updatedAt: now,
      } as any,
      content,
      userId
    );

    if (!writeResult.success) {
      return { success: false, error: writeResult.error || '存储写入失败' };
    }
  } catch (writeError) {
    logger.error('FileService', '写入存储失败', { fileId }, writeError);
    return { success: false, error: `存储写入失败: ${writeError instanceof Error ? writeError.message : '未知错误'}` };
  }

  // 写入数据库
  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name,
    path,
    type: 'file',
    size: contentBytes.length,
    r2Key,
    mimeType: fileMime,
    hash: null,
    refCount: 1,
    isFolder: false,
    bucketId: effectiveBucketId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  await inheritParentPermissions(db, fileId, parentId || null);

  if (user) {
    await updateUserStorage(db, userId, contentBytes.length);
  }

  if (effectiveBucketId) {
    await updateBucketStats(db, effectiveBucketId, contentBytes.length, 1);
  }

  logger.info('FileService', '文本文件创建成功', { fileId, fileName: name, size: contentBytes.length });

  return {
    success: true,
    fileId,
    file: { id: fileId, name, size: contentBytes.length, mimeType: fileMime, path, parentId },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 编辑文件内容（复用 files.ts PUT /:id/content 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

const EDITABLE_MIME_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
  'text/markdown',
  'text/plain',
  'text/csv',
  'text/html',
  'text/css',
];

function isEditableMimeType(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return EDITABLE_MIME_TYPES.some((t) => mimeType.startsWith(t) || mimeType === t);
}

export async function updateFileContent(
  env: Env,
  userId: string,
  fileId: string,
  newContent: string
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write', env);
  if (!hasAccess) return { success: false, error: '无权修改此文件' };

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return { success: false, error: '文件不存在' };

  if (!isEditableMimeType(file.mimeType)) {
    return { success: false, error: `此文件类型(${file.mimeType})不支持在线编辑` };
  }

  const MAX_EDITABLE_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_EDITABLE_SIZE) {
    return { success: false, error: '文件过大，不支持在线编辑' };
  }

  // 读取当前内容用于版本对比
  const readResult = await readFileContent(env, file, userId);
  let oldContent = '';
  if (readResult.success && readResult.content) {
    oldContent = readResult.content;
  }

  // 创建版本快照（如果配置允许且内容有变化）
  if (oldContent !== newContent) {
    try {
      const newHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(newContent)).then((buf) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      );
      const doSnapshot = await shouldCreateVersion(getDb(env.DB), fileId, newHash);
      if (doSnapshot) {
        await createVersionSnapshot(db, env, { id: fileId } as any, { changeSummary: 'Agent 编辑', createdBy: userId });
      }
    } catch (versionError) {
      logger.warn('FileService', '创建版本快照失败（非致命）', { fileId }, versionError);
    }
  }

  // 写入新内容
  const contentBytes = new TextEncoder().encode(newContent);
  const writeResult = await writeFileContent(env, file, newContent, userId);

  if (!writeResult.success) {
    return { success: false, error: writeResult.error || '保存失败' };
  }

  // 更新数据库记录
  const now = new Date().toISOString();
  await db
    .update(files)
    .set({
      size: contentBytes.length,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  logger.info('FileService', '文件内容更新成功', { fileId, fileName: file.name, newSize: contentBytes.length });

  // 触发 webhook
  try {
    dispatchWebhook(env, userId, 'file.updated', { fileId, fileName: file.name });
  } catch {
    /* webhook 失败非致命 */
  }

  return { success: true, message: '文件内容已更新' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 移动文件（复用 files.ts POST /:id/move 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

export async function moveFile(
  env: Env,
  userId: string,
  fileId: string,
  input: MoveFileInput
): Promise<
  | { success: true; message: string }
  | { success: false; error: string; sourceBucketId?: string; targetBucketId?: string }
> {
  const db = getDb(env.DB);
  const { targetParentId } = input;

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) return { success: false, error: '文件不存在或无权访问' };

  // 目标目录权限检查
  if (targetParentId) {
    const { hasAccess: targetAccess } = await checkFilePermission(db, targetParentId, userId, 'write', env);
    if (!targetAccess) return { success: false, error: '无权向目标目录移动文件' };
  }

  // ── 跨桶移动检测 ────────────────────────────────────────────────
  if (targetParentId) {
    const targetFolder = await db
      .select({ bucketId: files.bucketId })
      .from(files)
      .where(eq(files.id, targetParentId))
      .get();

    if (targetFolder?.bucketId && file.bucketId && targetFolder.bucketId !== file.bucketId) {
      return {
        success: false,
        error: 'CROSS_BUCKET',
        sourceBucketId: file.bucketId,
        targetBucketId: targetFolder.bucketId,
      };
    }
  }
  // ────────────────────────────────────────────────────────────────

  // 文件夹循环检测
  if (file.isFolder && targetParentId) {
    let checkId: string | null = targetParentId;
    while (checkId) {
      if (checkId === fileId) return { success: false, error: '不能将文件夹移动到自身或其子文件夹中' };
      const parent = await db.select().from(files).where(eq(files.id, checkId)).get();
      checkId = parent?.parentId ?? null;
    }
  }

  // 同名冲突检查
  const conflict = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.name, file.name),
        targetParentId ? eq(files.parentId, targetParentId) : isNull(files.parentId),
        isNull(files.deletedAt)
      )
    )
    .get();

  if (conflict && conflict.id !== fileId) {
    return { success: false, error: '目标位置已存在同名文件' };
  }

  const now = new Date().toISOString();
  const newPath = targetParentId ? `${targetParentId}/${file.name}` : `/${file.name}`;

  await db.update(files).set({ parentId: targetParentId, path: newPath, updatedAt: now }).where(eq(files.id, fileId));

  // 如果是文件夹，更新所有子项的路径
  if (file.isFolder) {
    const folderPath = file.path?.endsWith('/') ? file.path!.slice(0, -1) : file.path;
    const allFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
      .all();

    const childFiles = allFiles.filter((f) => f.id !== fileId && f.path && f.path.startsWith(folderPath + '/'));
    for (const child of childFiles) {
      const relativePath = child.path!.slice(folderPath!.length);
      const childNewPath = `${newPath.endsWith('/') ? newPath.slice(0, -1) : newPath}${relativePath}`;
      await db.update(files).set({ path: childNewPath, updatedAt: now }).where(eq(files.id, child.id));
    }
  }

  logger.info('FileService', '文件移动成功', { fileId, fileName: file.name, targetParentId });
  return { success: true, message: '移动成功' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 重命名文件（复用 files.ts PUT /:id 的部分逻辑）
// ─────────────────────────────────────────────────────────────────────────────

export async function renameFile(
  env: Env,
  userId: string,
  fileId: string,
  input: RenameFileInput
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { name } = input;

  if (!name || name.length === 0 || name.length > 255) {
    return { success: false, error: '名称长度必须在1-255个字符之间' };
  }

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write', env);
  if (!hasAccess) return { success: false, error: '无权修改此文件' };

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return { success: false, error: '文件不存在' };

  const now = new Date().toISOString();
  const newPath = file.parentId ? `${file.parentId}/${name}` : `/${name}`;

  await db
    .update(files)
    .set({
      name,
      path: newPath,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  logger.info('FileService', '文件重命名成功', { fileId, oldName: file.name, newName: name });
  return { success: true, message: '重命名成功' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 软删除文件（复用 files.ts DELETE /:id 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

async function softDeleteFolder(db: ReturnType<typeof getDb>, folderId: string, deletedAt: string, env: Env) {
  const folder = await db.select().from(files).where(eq(files.id, folderId)).get();
  if (!folder?.isFolder) return;

  const children = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, folder.userId), eq(files.parentId, folderId), isNull(files.deletedAt)))
    .all();

  for (const child of children) {
    if (child.isFolder) {
      await softDeleteFolder(db, child.id, deletedAt, env);
    }
    await db.update(files).set({ deletedAt, updatedAt: deletedAt }).where(eq(files.id, child.id));
    await deleteFileVector(env, child.id);
  }
}

export async function softDeleteFile(
  env: Env,
  userId: string,
  fileId: string
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'admin', env);
  if (!hasAccess) return { success: false, error: '无权删除此文件' };

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();

  if (!file) return { success: false, error: '文件不存在' };

  const now = new Date().toISOString();
  if (file.isFolder) await softDeleteFolder(db, fileId, now, env);
  await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, fileId));

  // 软删除时立即释放存储配额（避免用户反复上传-软删除导致配额误判）
  if (!file.isFolder && file.size > 0) {
    await updateUserStorage(db, userId, -file.size);
    if (file.bucketId) {
      await updateBucketStats(db, file.bucketId, -file.size, -1);
    }
  }

  await deleteFileVector(env, fileId);

  logger.info('FileService', '文件软删除成功', { fileId, fileName: file.name, isFolder: file.isFolder });

  try {
    dispatchWebhook(env, userId, 'file.deleted', { fileId, fileName: file.name, isFolder: file.isFolder });
  } catch {
    /* 非致命 */
  }

  return { success: true, message: file.isFolder ? '文件夹已移入回收站' : '文件已移入回收站' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 收藏管理（复用 files.ts POST/DELETE /:id/star 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

export async function toggleStar(
  env: Env,
  userId: string,
  fileId: string,
  starred: boolean
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', env);
  if (!hasAccess) return { success: false, error: '无权访问此文件' };

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();

  if (!file) return { success: false, error: '文件不存在或无权访问' };

  const now = new Date().toISOString();

  if (starred) {
    const existing = await db
      .select()
      .from(userStars)
      .where(and(eq(userStars.userId, userId), eq(userStars.fileId, fileId)))
      .get();
    if (!existing) {
      await db.insert(userStars).values({ userId, fileId, createdAt: now });
    }
  } else {
    await db.delete(userStars).where(and(eq(userStars.userId, userId), eq(userStars.fileId, fileId)));
  }

  logger.info('FileService', '收藏状态更新', { fileId, starred });
  return { success: true, message: starred ? '已添加到收藏' : '已取消收藏' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 创建文件夹（复用 files.ts POST / 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

export async function createFolder(
  env: Env,
  userId: string,
  name: string,
  parentId?: string | null,
  requestedBucketId?: string | null
): Promise<{ success: true; folderId: string; folder: Record<string, unknown> } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const encKey = getEncryptionKey(env);

  // 同名检查
  const existing = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.name, name),
        parentId ? eq(files.parentId, parentId) : isNull(files.parentId),
        eq(files.isFolder, true),
        isNull(files.deletedAt)
      )
    )
    .get();

  if (existing) return { success: false, error: '同名文件夹已存在' };

  // 存储桶解析
  let effectiveBucketId: string | null = null;
  if (requestedBucketId) {
    const bucketRow = await db
      .select()
      .from(storageBuckets)
      .where(
        and(
          eq(storageBuckets.id, requestedBucketId),
          eq(storageBuckets.userId, userId),
          eq(storageBuckets.isActive, true)
        )
      )
      .get();

    if (!bucketRow) {
      return { success: false, error: '指定的存储桶不存在或未激活' };
    }
    effectiveBucketId = requestedBucketId;
  } else {
    const bucketConfig = await resolveBucketConfig(db, userId, encKey, null, parentId);
    effectiveBucketId = bucketConfig?.id ?? null;
  }

  const folderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const path = parentId ? `${parentId}/${name}` : `/${name}`;

  const newFolder = {
    id: folderId,
    userId,
    parentId: parentId || null,
    name,
    path,
    type: 'folder',
    size: 0,
    r2Key: `folders/${folderId}`,
    mimeType: null,
    hash: null,
    isFolder: true,
    bucketId: effectiveBucketId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await db.insert(files).values(newFolder);
  await inheritParentPermissions(db, folderId, parentId || null);

  logger.info('FileService', '文件夹创建成功', { folderId, name, parentId });
  return { success: true, folderId, folder: newFolder };
}

export interface CopyFileInput {
  targetFolderId: string;
  newName?: string;
}

export async function copyFile(
  env: Env,
  userId: string,
  fileId: string,
  input: CopyFileInput
): Promise<
  { success: true; message: string; newFileId: string; fileName: string } | { success: false; error: string }
> {
  const db = getDb(env.DB);
  const { targetFolderId, newName } = input;

  const [file, targetFolder] = await Promise.all([
    db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get(),
    db
      .select()
      .from(files)
      .where(and(eq(files.id, targetFolderId), eq(files.userId, userId)))
      .get(),
  ]);

  if (!file) return { success: false, error: '源文件不存在或无权访问' };
  if (!targetFolder) return { success: false, error: '目标文件夹不存在' };
  if (file.isFolder) return { success: false, error: '暂不支持复制文件夹' };

  const finalName = newName || file.name;
  const newFileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const parentPath = targetFolder.path || '';
  const newPath = `${parentPath}/${finalName}`.replace('//', '/');

  const r2KeyPrefix = file.r2Key?.substring(0, file.r2Key.lastIndexOf('/')) || `uploads/${userId}`;
  const newR2Key = `${r2KeyPrefix}/${newFileId}/${finalName}`;

  await db.insert(files).values({
    id: newFileId,
    userId,
    parentId: targetFolderId,
    name: finalName,
    path: newPath,
    size: file.size,
    r2Key: newR2Key,
    mimeType: file.mimeType,
    isFolder: false,
    createdAt: now,
    updatedAt: now,
  });

  try {
    const sourceObject = await env.FILES?.get(file.r2Key!);
    if (sourceObject) {
      const body = await sourceObject.arrayBuffer();
      await env.FILES?.put(newR2Key, new Uint8Array(body));
    }
  } catch (error) {
    logger.error('FileService', '复制文件存储失败', { sourceId: fileId, newFileId }, error);
    try {
      await env.FILES?.delete(newR2Key);
    } catch {
      /* ignore */
    }
    await db.delete(files).where(eq(files.id, newFileId));
    return { success: false, error: '文件复制失败: 存储服务异常' };
  }

  const userRow = await db.select().from(users).where(eq(users.id, userId)).get();
  if (userRow) await updateUserStorage(db, userId, file.size);

  await inheritParentPermissions(db, newFileId, targetFolderId);

  logger.info('FileService', '文件复制成功', { sourceId: fileId, newFileId, fileName: finalName });
  return { success: true, message: `"${file.name}" 已复制为 "${finalName}"`, newFileId, fileName: finalName };
}

export async function restoreFile(
  env: Env,
  userId: string,
  fileId: string
): Promise<{ success: true; message: string; fileName: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
    .get();

  if (!file) return { success: false, error: '该文件不在回收站中或不存在' };

  const now = new Date().toISOString();
  await db.update(files).set({ deletedAt: null, updatedAt: now }).where(eq(files.id, fileId));

  if (file.isFolder) {
    const folderPath = file.path?.endsWith('/') ? file.path.slice(0, -1) : file.path;
    const allTrashed = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
      .all();

    const childFiles = allTrashed.filter((f) => f.path && f.path.startsWith(folderPath + '/'));
    for (const child of childFiles) {
      await db.update(files).set({ deletedAt: null, updatedAt: now }).where(eq(files.id, child.id));
    }
  }

  logger.info('FileService', '文件恢复成功', { fileId, fileName: file.name });
  return { success: true, message: `"${file.name}" 已从回收站恢复`, fileName: file.name };
}

export async function findOrCreateFolder(env: Env, userId: string, path: string): Promise<string | null> {
  const db = getDb(env.DB);

  const existing = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), eq(files.path, path), eq(files.isFolder, true), isNull(files.deletedAt)))
    .get();

  if (existing) return existing.id;

  const parts = path.replace(/^\/+/, '').split('/');
  let parentId: string | null = null;
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    const folder = await db
      .select()
      .from(files)
      .where(
        and(eq(files.userId, userId), eq(files.path, currentPath), eq(files.isFolder, true), isNull(files.deletedAt))
      )
      .get();

    if (folder) {
      parentId = folder.id;
    } else {
      const newFolderId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.insert(files).values({
        id: newFolderId,
        userId,
        parentId,
        name: part,
        path: currentPath,
        size: 0,
        r2Key: '',
        mimeType: null,
        isFolder: true,
        createdAt: now,
        updatedAt: now,
      });

      await inheritParentPermissions(db, newFolderId, parentId);
      parentId = newFolderId;
    }
  }

  return parentId;
}

// ─────────────────────────────────────────────────────────────────────────────
// 文件集合分析（供 AgentTools 调用）
// ─────────────────────────────────────────────────────────────────────────────

export interface FileCollectionItem {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  summary: string;
  updatedAt: string;
}

export interface AnalyzeFileCollectionInput {
  scope: 'folder' | 'tag' | 'starred';
  folderId?: string;
  tagName?: string;
  maxFiles?: number;
}

export async function getFilesByScope(
  env: Env,
  userId: string,
  input: AnalyzeFileCollectionInput
): Promise<{ files: FileCollectionItem[]; totalCount: number; error?: string }> {
  const db = getDb(env.DB);
  const { scope, folderId, tagName, maxFiles = 20 } = input;

  const conditions = [isNull(files.deletedAt), eq(files.userId, userId)];

  switch (scope) {
    case 'folder':
      if (!folderId) {
        return { files: [], totalCount: 0, error: 'scope=folder 时必须提供 folderId' };
      }
      conditions.push(eq(files.parentId, folderId));
      break;

    case 'starred': {
      const starredFiles = await db
        .select({ fileId: userStars.fileId })
        .from(userStars)
        .where(eq(userStars.userId, userId))
        .all();

      if (starredFiles.length === 0) {
        return { files: [], totalCount: 0 };
      }

      const starredIds = starredFiles.map((s) => s.fileId);
      conditions.push(inArray(files.id, starredIds));
      break;
    }

    case 'tag': {
      if (!tagName) {
        return { files: [], totalCount: 0, error: 'scope=tag 时必须提供 tagName' };
      }

      const taggedFiles = await db
        .select({ fileId: fileTags.fileId })
        .from(fileTags)
        .where(and(eq(fileTags.userId, userId), eq(fileTags.name, tagName)))
        .all();

      if (taggedFiles.length === 0) {
        return { files: [], totalCount: 0 };
      }

      const taggedIds = taggedFiles.map((t) => t.fileId);
      conditions.push(inArray(files.id, taggedIds));
      break;
    }

    default:
      return { files: [], totalCount: 0, error: `无效的 scope: ${scope}` };
  }

  const fileList = await db
    .select({
      id: files.id,
      name: files.name,
      mimeType: files.mimeType,
      size: files.size,
      aiSummary: files.aiSummary,
      updatedAt: files.updatedAt,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(and(...conditions))
    .limit(maxFiles)
    .all();

  const result: FileCollectionItem[] = [];

  for (const f of fileList) {
    let summary = f.aiSummary || '';

    if (!summary && !f.mimeType?.startsWith('image/') && !f.mimeType?.startsWith('video/')) {
      try {
        const fileRecord = { id: f.id, r2Key: '', bucketId: null, mimeType: f.mimeType, size: f.size } as any;
        const readResult = await readFileContent(env, fileRecord, userId);

        if (readResult.success && readResult.content) {
          summary = readResult.content.slice(0, 500);
        }
      } catch (e) {
        logger.warn('FileService', '读取文件内容失败用于集合分析', { fileId: f.id }, e as Error);
      }
    }

    result.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: Number(f.size),
      summary: summary || (f.mimeType?.startsWith('image/') ? '[图片文件]' : '[二进制文件]'),
      updatedAt: f.updatedAt,
    });
  }

  logger.info('FileService', '文件集合查询完成', {
    userId,
    scope,
    count: result.length,
    total: fileList.length,
  });

  return { files: result, totalCount: fileList.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 文件夹大小统计（递归计算）
// ─────────────────────────────────────────────────────────────────────────────

export interface FolderSizeStats {
  folderId: string;
  totalSize: number;
  fileCount: number;
  folderCount: number;
  childFiles: Array<{ id: string; name: string; size: number }>;
  lastUpdated: string;
}

/**
 * 计算文件夹的总大小（递归包含所有子文件夹）
 * 使用 WITH RECURSIVE CTE 一次性查询，避免 N+1 问题
 */
export async function calculateFolderSize(
  db: ReturnType<typeof getDb>,
  folderId: string,
  userId: string
): Promise<FolderSizeStats> {
  const now = new Date().toISOString();

  // 查询直接子文件和子文件夹（第一层）
  const directChildren = await db
    .select({
      id: files.id,
      name: files.name,
      isFolder: files.isFolder,
      size: files.size,
    })
    .from(files)
    .where(and(eq(files.parentId, folderId), isNull(files.deletedAt)))
    .all();

  const childFiles = directChildren.filter((f) => !f.isFolder);
  const childFolders = directChildren.filter((f) => f.isFolder);

  // 使用 WITH RECURSIVE 递归查询所有后代文件
  let totalFileCount = childFiles.length;
  let totalSize = childFiles.reduce((sum, f) => sum + Number(f.size || 0), 0);

  try {
    const recursiveResult = await db.run(sql`
      WITH RECURSIVE file_tree AS (
        SELECT id, isFolder, size, parentId
        FROM files
        WHERE id = ${folderId} AND deletedAt IS NULL AND userId = ${userId}
        UNION ALL
        SELECT f.id, f.isFolder, f.size, f.parentId
        FROM files f
        INNER JOIN file_tree ft ON f.parentId = ft.id
        WHERE f.deletedAt IS NULL AND f.userId = ${userId}
      )
      SELECT COUNT(*) as totalCount, COALESCE(SUM(size), 0) as totalSize
      FROM file_tree WHERE isFolder = 0
    `);

    const stats = recursiveResult as unknown as Array<{ totalCount: number; totalSize: number }>;
    if (stats && stats.length > 0) {
      totalFileCount = stats[0].totalCount ?? totalFileCount;
      totalSize = stats[0].totalSize ?? totalSize;
    }
  } catch (error) {
    logger.error('FileService', '递归查询文件夹大小失败，使用直接子文件统计', { folderId }, error as Error);
  }

  // 获取最大的几个子文件信息（用于展示）
  const largestFiles = [...childFiles]
    .sort((a, b) => Number(b.size) - Number(a.size))
    .slice(0, 5)
    .map((f) => ({ id: f.id, name: f.name, size: Number(f.size) }));

  return {
    folderId,
    totalSize,
    fileCount: totalFileCount,
    folderCount: childFolders.length,
    childFiles: largestFiles,
    lastUpdated: now,
  };
}

/**
 * 批量计算多个文件夹的大小
 * @returns Map<folderId, FolderSizeStats>
 */
export async function calculateFoldersSize(
  db: ReturnType<typeof getDb>,
  folderIds: string[],
  userId: string
): Promise<Map<string, FolderSizeStats>> {
  const results = new Map<string, FolderSizeStats>();

  for (const folderId of folderIds) {
    try {
      const stats = await calculateFolderSize(db, folderId, userId);
      results.set(folderId, stats);
    } catch (error) {
      logger.error('FileService', '计算文件夹大小失败', { folderId }, error as Error);
    }
  }

  return results;
}
