/**
 * files.service.ts
 * 文件管理业务逻辑服务
 *
 * 功能:
 * - 文件/文件夹的增删改查
 * - 文件上传与下载
 * - 回收站管理
 * - 文件预览与缩略图
 */

import { eq, and, isNull, isNotNull, like, or, inArray, sql } from 'drizzle-orm';
import { getDb, files, users, storageBuckets, filePermissions, telegramFileRefs } from '../db';
import { checkFilePermission } from './permissions.service';
import { ERROR_CODES, MAX_FILE_SIZE, isPreviewableMimeType, inferMimeType } from '@osshelf/shared';
import type { Env } from '../types/env';
import { s3Put, s3Get, s3Delete, decryptSecret } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { checkFolderMimeTypeRestriction } from '../lib/folderPolicy';
import { getEncryptionKey } from '../lib/crypto';
import {
  tgUploadFile,
  tgDownloadFile,
  TG_MAX_FILE_SIZE,
  type TelegramBotConfig,
} from '../lib/telegramClient';

const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

export interface CreateFolderParams {
  name: string;
  parentId?: string | null;
  bucketId?: string | null;
}

export interface UploadFileParams {
  file: File;
  parentId?: string | null;
  bucketId?: string | null;
}

export async function resolveTgBucketConfig(
  db: ReturnType<typeof getDb>,
  bucketId: string,
  encKey: string
): Promise<TelegramBotConfig | null> {
  const bucket = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();
  if (!bucket || bucket.provider !== 'telegram') return null;
  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  return {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };
}

export async function createFolder(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: CreateFolderParams
) {
  const { name, parentId, bucketId: requestedBucketId } = params;

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

  if (existing) {
    return { success: false, error: '同名文件夹已存在' };
  }

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
  } else if (!parentId) {
    const bucketConfig = await resolveBucketConfig(db, userId, encKey, null, null);
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
    type: 'folder' as const,
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

  let bucketInfo: { id: string; name: string; provider: string } | null = null;
  if (effectiveBucketId) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, effectiveBucketId)).get();
    if (b) bucketInfo = { id: b.id, name: b.name, provider: b.provider };
  }

  return { success: true, data: { ...newFolder, bucket: bucketInfo } };
}

export async function uploadFile(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: UploadFileParams
) {
  const { file, parentId, bucketId: requestedBucketId } = params;

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB）` };
  }

  const fileMime = inferMimeType(file.name, file.type);
  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId ?? null, fileMime);
  if (!mimeCheck.allowed) {
    return { success: false, error: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}` };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId ?? null, parentId ?? null);

  const effectiveBucketId = bucketConfig?.id ?? requestedBucketId ?? null;
  let isTelegramBucket = false;
  if (effectiveBucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, effectiveBucketId)).get();
    if (bkt?.provider === 'telegram') isTelegramBucket = true;
  }

  if (isTelegramBucket && file.size > TG_MAX_FILE_SIZE) {
    return {
      success: false,
      error: `Telegram 存储桶单文件上限 50MB，当前文件 ${(file.size / 1024 / 1024).toFixed(1)}MB`,
    };
  }

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && user.storageUsed + file.size > user.storageQuota) {
    return { success: false, error: '用户存储配额已满' };
  }

  if (bucketConfig) {
    const quotaErr = await checkBucketQuota(db, bucketConfig.id, file.size);
    if (quotaErr) {
      return { success: false, error: quotaErr };
    }
  }

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `files/${userId}/${fileId}/${file.name}`;
  const path = parentId ? `${parentId}/${file.name}` : `/${file.name}`;

  if (isTelegramBucket && effectiveBucketId) {
    const tgConfig = await resolveTgBucketConfig(db, effectiveBucketId, encKey);
    if (!tgConfig) {
      return { success: false, error: '无法加载 Telegram 配置' };
    }
    const caption = `📁 ${file.name}\n🗂 OSSshelf | ${now.slice(0, 10)}`;
    let tgResult;
    try {
      tgResult = await tgUploadFile(tgConfig, await file.arrayBuffer(), file.name, fileMime, caption);
    } catch (e: any) {
      return { success: false, error: e?.message || 'Telegram 上传失败' };
    }
    await db.insert(telegramFileRefs).values({
      id: crypto.randomUUID(),
      fileId,
      r2Key,
      tgFileId: tgResult.fileId,
      tgFileSize: tgResult.fileSize,
      bucketId: effectiveBucketId,
      createdAt: now,
    });
  } else if (bucketConfig) {
    await s3Put(bucketConfig, r2Key, await file.arrayBuffer(), fileMime, {
      userId,
      originalName: file.name,
    });
  } else if (env.FILES) {
    await env.FILES.put(r2Key, file.stream(), {
      httpMetadata: { contentType: fileMime },
      customMetadata: { userId, originalName: file.name },
    });
  } else {
    return { success: false, error: '未配置存储桶，请先在「存储桶管理」中添加至少一个存储桶' };
  }

  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name: file.name,
    path,
    type: 'file',
    size: file.size,
    r2Key,
    mimeType: fileMime || null,
    hash: null,
    isFolder: false,
    bucketId: isTelegramBucket ? effectiveBucketId : (bucketConfig?.id ?? null),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  if (user) {
    await db
      .update(users)
      .set({ storageUsed: user.storageUsed + file.size, updatedAt: now })
      .where(eq(users.id, userId));
  }

  if (isTelegramBucket && effectiveBucketId) {
    await updateBucketStats(db, effectiveBucketId, file.size, 1);
  } else if (bucketConfig) {
    await updateBucketStats(db, bucketConfig.id, file.size, 1);
  }

  return {
    success: true,
    data: {
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: fileMime,
      path,
      bucketId: isTelegramBucket ? effectiveBucketId : (bucketConfig?.id ?? null),
      createdAt: now,
    },
  };
}

export async function listFiles(
  db: ReturnType<typeof getDb>,
  userId: string,
  params: {
    parentId?: string | null;
    search?: string;
    sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
  }
) {
  const { parentId, search, sortBy = 'createdAt', sortOrder = 'desc' } = params;

  const permittedFileIds = await db
    .select({ fileId: filePermissions.fileId })
    .from(filePermissions)
    .where(eq(filePermissions.userId, userId))
    .all();
  const permittedIds = permittedFileIds.map((p) => p.fileId);

  const ownershipCondition = or(
    eq(files.userId, userId),
    permittedIds.length > 0 ? inArray(files.id, permittedIds) : undefined
  );

  const conditions = [ownershipCondition, isNull(files.deletedAt)];
  if (parentId) {
    conditions.push(eq(files.parentId, parentId));
  } else {
    conditions.push(isNull(files.parentId));
  }
  if (search) conditions.push(like(files.name, `%${search}%`));

  const items = await db
    .select()
    .from(files)
    .where(and(...(conditions.filter(Boolean) as any[])))
    .all();

  const sorted = [...items].sort((a, b) => {
    const aVal = a[sortBy] ?? '';
    const bVal = b[sortBy] ?? '';
    if (sortOrder === 'asc') return aVal > bVal ? 1 : -1;
    return aVal < bVal ? 1 : -1;
  });

  const bucketIds = [...new Set(sorted.map((f) => f.bucketId).filter(Boolean))] as string[];
  const bucketMap: Record<string, { id: string; name: string; provider: string }> = {};
  if (bucketIds.length > 0) {
    const bucketRows = await db
      .select({ id: storageBuckets.id, name: storageBuckets.name, provider: storageBuckets.provider })
      .from(storageBuckets)
      .where(inArray(storageBuckets.id, bucketIds))
      .all();
    for (const b of bucketRows) bucketMap[b.id] = b;
  }

  const ownerIds = [...new Set(sorted.map((f) => f.userId).filter(Boolean))] as string[];
  const ownerMap: Record<string, { id: string; name: string | null; email: string }> = {};
  if (ownerIds.length > 0) {
    const ownerRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ownerIds))
      .all();
    for (const u of ownerRows) ownerMap[u.id] = u;
  }

  const permittedIdSet = new Set(permittedIds);
  const permissionsMap: Record<string, { permission: string | null; isOwner: boolean }> = {};
  for (const file of sorted) {
    const isOwner = file.userId === userId;
    permissionsMap[file.id] = {
      permission: isOwner ? 'admin' : permittedIdSet.has(file.id) ? 'read' : null,
      isOwner,
    };
  }

  const withBucket = sorted.map((f) => ({
    ...f,
    bucket: f.bucketId ? (bucketMap[f.bucketId] ?? null) : null,
    owner: ownerMap[f.userId] ?? null,
    accessPermission: permissionsMap[f.id]?.permission,
    isOwner: permissionsMap[f.id]?.isOwner,
  }));

  return withBucket;
}

export async function getFileById(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string
) {
  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'read');
  if (!hasAccess) {
    return { success: false, error: '无权访问此文件' };
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  let bucketInfo: { id: string; name: string; provider: string } | null = null;
  if (file.bucketId) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (b) bucketInfo = { id: b.id, name: b.name, provider: b.provider };
  }

  let ownerInfo = null;
  if (!isOwner && file.userId) {
    const owner = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, file.userId))
      .get();
    if (owner) ownerInfo = owner;
  }

  return { success: true, data: { ...file, bucket: bucketInfo, owner: ownerInfo, isOwner } };
}

export async function updateFile(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string,
  data: { name?: string; parentId?: string | null }
) {
  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'write');
  if (!hasAccess) {
    return { success: false, error: '无权修改此文件' };
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  const { name, parentId } = data;
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (name) {
    updateData.name = name;
    updateData.path =
      parentId !== undefined
        ? parentId
          ? `${parentId}/${name}`
          : `/${name}`
        : file.parentId
          ? `${file.parentId}/${name}`
          : `/${name}`;
  }

  if (parentId !== undefined && isOwner) {
    updateData.parentId = parentId || null;
    const n = (name as string | undefined) || file.name;
    updateData.path = parentId ? `${parentId}/${n}` : `/${n}`;
  }

  await db.update(files).set(updateData).where(eq(files.id, fileId));
  return { success: true, data: { message: '更新成功' } };
}

export async function updateFolderSettings(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string,
  data: { allowedMimeTypes?: string[] | null }
) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }
  if (!file.isFolder) {
    return { success: false, error: '只有文件夹可以设置上传类型限制' };
  }

  const { allowedMimeTypes } = data;
  const now = new Date().toISOString();

  await db
    .update(files)
    .set({
      allowedMimeTypes: allowedMimeTypes ? JSON.stringify(allowedMimeTypes) : null,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  return {
    success: true,
    data: {
      message: '设置已更新',
      allowedMimeTypes: allowedMimeTypes || null,
    },
  };
}

export async function moveFile(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string,
  targetParentId: string | null
) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  if (file.isFolder && targetParentId) {
    let checkId: string | null = targetParentId;
    while (checkId) {
      if (checkId === fileId) {
        return { success: false, error: '不能将文件夹移动到自身或其子文件夹中' };
      }
      const parent = await db.select().from(files).where(eq(files.id, checkId)).get();
      checkId = parent?.parentId ?? null;
    }
  }

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
  return { success: true, data: { message: '移动成功' } };
}

export async function softDeleteFile(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string
) {
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'admin');
  if (!hasAccess) {
    return { success: false, error: '无权删除此文件' };
  }

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  const now = new Date().toISOString();

  async function softDeleteFolderRecursive(folderId: string) {
    const children = await db
      .select()
      .from(files)
      .where(and(eq(files.parentId, folderId), isNull(files.deletedAt)))
      .all();
    for (const child of children) {
      if (child.isFolder) await softDeleteFolderRecursive(child.id);
      await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, child.id));
    }
  }

  if (file.isFolder) await softDeleteFolderRecursive(fileId);
  await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, fileId));
  return { success: true, data: { message: '已移入回收站' } };
}

export async function downloadFile(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  fileId: string
) {
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read');
  if (!hasAccess) {
    return { success: false, error: '无权下载此文件' };
  }

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }
  if (file.isFolder) {
    return { success: false, error: '无法下载文件夹' };
  }

  const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  const dlHeaders = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Content-Length': file.size.toString(),
  };

  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, fileId)).get();
      if (!ref) {
        return { success: false, error: '未找到 Telegram 文件引用，文件可能已损坏' };
      }
      const tgConfig = await resolveTgBucketConfig(db, file.bucketId, encKey);
      if (!tgConfig) {
        return { success: false, error: '无法加载 Telegram 配置' };
      }
      try {
        const tgResp = await tgDownloadFile(tgConfig, ref.tgFileId);
        return { success: true, data: { body: tgResp.body, headers: dlHeaders } };
      } catch (e: any) {
        return { success: false, error: e?.message || 'Telegram 下载失败' };
      }
    }
  }

  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);
    return { success: true, data: { body: s3Res.body, headers: dlHeaders } };
  }
  if (env.FILES) {
    const obj = await env.FILES.get(file.r2Key);
    if (!obj) {
      return { success: false, error: '文件内容不存在' };
    }
    return { success: true, data: { body: obj.body, headers: dlHeaders } };
  }
  return { success: false, error: '存储桶未配置' };
}

export async function previewFile(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  fileId: string
) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }
  if (file.isFolder) {
    return { success: false, error: '无法预览文件夹' };
  }
  if (!isPreviewableMimeType(file.mimeType)) {
    return { success: false, error: '该文件类型不支持预览' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  const pvHeaders = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Length': file.size.toString(),
    'Cache-Control': 'public, max-age=3600',
  };

  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, fileId)).get();
      if (!ref) {
        return { success: false, error: '未找到 Telegram 文件引用' };
      }
      const tgConfig = await resolveTgBucketConfig(db, file.bucketId, encKey);
      if (!tgConfig) {
        return { success: false, error: '无法加载 Telegram 配置' };
      }
      try {
        const tgResp = await tgDownloadFile(tgConfig, ref.tgFileId);
        return { success: true, data: { body: tgResp.body, headers: pvHeaders } };
      } catch (e: any) {
        return { success: false, error: e?.message };
      }
    }
  }

  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);
    return { success: true, data: { body: s3Res.body, headers: pvHeaders } };
  }
  if (env.FILES) {
    const obj = await env.FILES.get(file.r2Key);
    if (!obj) {
      return { success: false, error: '文件内容不存在' };
    }
    return { success: true, data: { body: obj.body, headers: pvHeaders } };
  }
  return { success: false, error: '存储桶未配置' };
}

export async function listTrash(db: ReturnType<typeof getDb>, userId: string) {
  const items = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
    .all();
  const sorted = [...items].sort((a, b) => ((b.deletedAt ?? '') > (a.deletedAt ?? '') ? 1 : -1));
  return sorted;
}
export async function restoreFile(db: ReturnType<typeof getDb>, userId: string, fileId: string) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在或未被删除' };
  }
  await db.update(files).set({ deletedAt: null, updatedAt: new Date().toISOString() }).where(eq(files.id, fileId));
  return { success: true, data: { message: '已恢复' } };
}
export async function permanentDeleteFile(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  fileId: string
) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  if (!file.isFolder) {
    await deleteFileFromStorage(env, db, userId, encKey, file);
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      await db
        .update(users)
        .set({ storageUsed: Math.max(0, user.storageUsed - file.size), updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
    }
  }

  await db.delete(files).where(eq(files.id, fileId));
  return { success: true, data: { message: '已永久删除' } };
}
export async function emptyTrash(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string
) {
  const trashed = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
    .all();
  let freedBytes = 0;
  for (const file of trashed) {
    if (!file.isFolder) {
      await deleteFileFromStorage(env, db, userId, encKey, file);
      freedBytes += file.size;
    }
    await db.delete(files).where(eq(files.id, file.id));
  }
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && freedBytes > 0) {
    await db
      .update(users)
      .set({ storageUsed: Math.max(0, user.storageUsed - freedBytes), updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));
  }
  return { success: true, data: { message: `已清空回收站，释放 ${trashed.length} 个文件` } };
}
async function deleteFileFromStorage(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  encKey: string,
  file: typeof files.$inferSelect
) {
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      await db.delete(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id));
      await updateBucketStats(db, file.bucketId, -file.size, -1);
      return;
    }
  }
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (bucketConfig) {
    try {
      await s3Delete(bucketConfig, file.r2Key);
    } catch (e) {
      console.error(`S3 delete failed for ${file.r2Key}:`, e);
    }
    await updateBucketStats(db, bucketConfig.id, -file.size, -1);
  } else if (env.FILES) {
    await env.FILES.delete(file.r2Key);
  }
}
