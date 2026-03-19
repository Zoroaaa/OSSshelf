/**
 * batch.service.ts
 * 批量操作业务逻辑服务
 *
 * 功能:
 * - 批量删除文件
 * - 批量移动文件
 * - 批量复制文件
 * - 批量重命名
 * - 批量永久删除
 * - 批量恢复
 */

import { eq, and, isNull, isNotNull, inArray } from 'drizzle-orm';
import { getDb, files, users, storageBuckets, telegramFileRefs } from '../db';
import { ERROR_CODES } from '@osshelf/shared';
import { s3Delete, s3Put, s3Get, decryptSecret } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { getEncryptionKey } from '../lib/crypto';
import type { Env } from '../types/env';
import type { TelegramBotConfig } from '../lib/telegramClient';

export interface BatchResult {
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

export async function softDeleteFolder(db: ReturnType<typeof getDb>, folderId: string, now: string) {
  const children = await db
    .select()
    .from(files)
    .where(and(eq(files.parentId, folderId), isNull(files.deletedAt)))
    .all();
  for (const child of children) {
    if (child.isFolder) await softDeleteFolder(db, child.id, now);
    await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, child.id));
  }
}

export async function batchSoftDelete(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileIds: string[]
): Promise<BatchResult> {
  const now = new Date().toISOString();
  const result: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const fileId of fileIds) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get();

      if (!file) {
        result.failed++;
        result.errors.push({ id: fileId, error: '文件不存在或已被删除' });
        continue;
      }

      if (file.isFolder) {
        await softDeleteFolder(db, fileId, now);
      }
      await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, fileId));
      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: fileId, error: error instanceof Error ? error.message : '未知错误' });
    }
  }

  return result;
}

export async function batchMove(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileIds: string[],
  targetParentId: string | null
): Promise<BatchResult> {
  const now = new Date().toISOString();
  const result: BatchResult = { success: 0, failed: 0, errors: [] };

  if (targetParentId) {
    const targetFolder = await db
      .select()
      .from(files)
      .where(
        and(eq(files.id, targetParentId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt))
      )
      .get();
    if (!targetFolder) {
      return { success: 0, failed: fileIds.length, errors: fileIds.map(id => ({ id, error: '目标文件夹不存在' })) };
    }
  }

  for (const fileId of fileIds) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get();

      if (!file) {
        result.failed++;
        result.errors.push({ id: fileId, error: '文件不存在或已被删除' });
        continue;
      }

      if (file.isFolder && targetParentId) {
        let checkId: string | null = targetParentId;
        while (checkId) {
          if (checkId === fileId) {
            throw new Error('不能将文件夹移动到自身或其子文件夹中');
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
        result.failed++;
        result.errors.push({ id: fileId, error: '目标位置已存在同名文件' });
        continue;
      }

      const newPath = targetParentId ? `${targetParentId}/${file.name}` : `/${file.name}`;
      await db
        .update(files)
        .set({ parentId: targetParentId, path: newPath, updatedAt: now })
        .where(eq(files.id, fileId));

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: fileId, error: error instanceof Error ? error.message : '未知错误' });
    }
  }

  return result;
}

export async function batchCopy(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  fileIds: string[],
  targetParentId: string | null,
  targetBucketId?: string | null
): Promise<BatchResult> {
  const now = new Date().toISOString();
  const result: BatchResult = { success: 0, failed: 0, errors: [] };

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return { success: 0, failed: fileIds.length, errors: fileIds.map(id => ({ id, error: '用户不存在' })) };
  }

  if (targetParentId) {
    const targetFolder = await db
      .select()
      .from(files)
      .where(
        and(eq(files.id, targetParentId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt))
      )
      .get();
    if (!targetFolder) {
      return { success: 0, failed: fileIds.length, errors: fileIds.map(id => ({ id, error: '目标文件夹不存在' })) };
    }
  }

  let totalSize = 0;
  const filesToCopy: (typeof files.$inferSelect)[] = [];

  for (const fileId of fileIds) {
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) {
      result.failed++;
      result.errors.push({ id: fileId, error: '文件不存在或已被删除' });
      continue;
    }

    if (file.isFolder) {
      result.failed++;
      result.errors.push({ id: fileId, error: '暂不支持复制文件夹' });
      continue;
    }

    totalSize += file.size;
    filesToCopy.push(file);
  }

  if (user.storageUsed + totalSize > user.storageQuota) {
    return { success: 0, failed: fileIds.length, errors: fileIds.map(id => ({ id, error: '存储空间不足' })) };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, targetBucketId ?? null, targetParentId);
  if (!bucketConfig) {
    return { success: 0, failed: fileIds.length, errors: fileIds.map(id => ({ id, error: '未配置存储桶' })) };
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, totalSize);
  if (quotaErr) {
    return { success: 0, failed: fileIds.length, errors: fileIds.map(id => ({ id, error: quotaErr })) };
  }

  for (const file of filesToCopy) {
    try {
      const sourceBucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);

      let fileContent: ArrayBuffer;
      if (sourceBucketConfig) {
        const s3Res = await s3Get(sourceBucketConfig, file.r2Key);
        fileContent = await s3Res.arrayBuffer();
      } else if (env.FILES) {
        const obj = await env.FILES.get(file.r2Key);
        if (!obj) throw new Error('源文件内容不存在');
        fileContent = await obj.arrayBuffer();
      } else {
        throw new Error('无法获取源文件内容');
      }

      const newFileId = crypto.randomUUID();
      const newR2Key = `files/${userId}/${newFileId}/${file.name}`;
      const newPath = targetParentId ? `${targetParentId}/${file.name}` : `/${file.name}`;

      await s3Put(bucketConfig, newR2Key, fileContent, file.mimeType || 'application/octet-stream');

      await db.insert(files).values({
        id: newFileId,
        userId,
        parentId: targetParentId,
        name: file.name,
        path: newPath,
        type: 'file',
        size: file.size,
        r2Key: newR2Key,
        mimeType: file.mimeType,
        hash: file.hash,
        isFolder: false,
        bucketId: bucketConfig.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: file.id, error: error instanceof Error ? error.message : '复制失败' });
    }
  }

  if (result.success > 0) {
    const copiedSize = filesToCopy
      .filter((f) => !result.errors.some((e) => e.id === f.id))
      .reduce((sum, f) => sum + f.size, 0);
    await db
      .update(users)
      .set({ storageUsed: user.storageUsed + copiedSize, updatedAt: now })
      .where(eq(users.id, userId));
    await updateBucketStats(db, bucketConfig.id, copiedSize, result.success);
  }

  return result;
}

export async function batchRename(
  db: ReturnType<typeof getDb>,
  userId: string,
  items: Array<{ fileId: string; newName: string }>
): Promise<BatchResult> {
  const now = new Date().toISOString();
  const result: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const item of items) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, item.fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get();

      if (!file) {
        result.failed++;
        result.errors.push({ id: item.fileId, error: '文件不存在或已被删除' });
        continue;
      }

      const conflict = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.userId, userId),
            eq(files.name, item.newName),
            file.parentId ? eq(files.parentId, file.parentId) : isNull(files.parentId),
            isNull(files.deletedAt)
          )
        )
        .get();

      if (conflict && conflict.id !== item.fileId) {
        result.failed++;
        result.errors.push({ id: item.fileId, error: '已存在同名文件' });
        continue;
      }

      const newPath = file.parentId ? `${file.parentId}/${item.newName}` : `/${item.newName}`;
      await db
        .update(files)
        .set({ name: item.newName, path: newPath, updatedAt: now })
        .where(eq(files.id, item.fileId));

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: item.fileId, error: error instanceof Error ? error.message : '重命名失败' });
    }
  }

  return result;
}

export async function batchPermanentDelete(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  fileIds: string[]
): Promise<BatchResult & { freedBytes: number }> {
  const result: BatchResult = { success: 0, failed: 0, errors: [] };
  let totalFreed = 0;

  for (const fileId of fileIds) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
        .get();

      if (!file) {
        result.failed++;
        result.errors.push({ id: fileId, error: '文件不存在或不在回收站中' });
        continue;
      }

      if (!file.isFolder) {
        await deleteFileFromStorage(env, db, userId, encKey, file);
        totalFreed += file.size;
      }

      await db.delete(files).where(eq(files.id, fileId));
      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: fileId, error: error instanceof Error ? error.message : '删除失败' });
    }
  }

  if (totalFreed > 0) {
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      await db
        .update(users)
        .set({ storageUsed: Math.max(0, user.storageUsed - totalFreed), updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
    }
  }

  return { ...result, freedBytes: totalFreed };
}

export async function batchRestore(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileIds: string[]
): Promise<BatchResult> {
  const now = new Date().toISOString();
  const result: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const fileId of fileIds) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
        .get();

      if (!file) {
        result.failed++;
        result.errors.push({ id: fileId, error: '文件不存在或未被删除' });
        continue;
      }

      await db.update(files).set({ deletedAt: null, updatedAt: now }).where(eq(files.id, fileId));
      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: fileId, error: error instanceof Error ? error.message : '恢复失败' });
    }
  }

  return result;
}

export async function deleteFileFromStorage(
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
