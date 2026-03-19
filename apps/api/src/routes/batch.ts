/**
 * batch.ts
 * 批量操作路由
 *
 * 功能:
 * - 批量删除文件
 * - 批量移动文件
 * - 批量复制文件
 * - 批量重命名
 * - 批量永久删除
 * - 批量恢复
 */

import { Hono } from 'hono';
import { eq, and, isNull, isNotNull, inArray } from 'drizzle-orm';
import { getDb, files, users, storageBuckets } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { s3Delete, s3Put, s3Get } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { getEncryptionKey } from '../lib/crypto';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const batchDeleteSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
});

const batchMoveSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
  targetParentId: z.string().nullable(),
});

const batchCopySchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(50),
  targetParentId: z.string().nullable(),
  targetBucketId: z.string().nullable().optional(),
});

const batchRenameSchema = z.object({
  items: z
    .array(
      z.object({
        fileId: z.string().min(1),
        newName: z.string().min(1).max(255),
      })
    )
    .min(1)
    .max(100),
});

const batchTagSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
  tags: z.array(z.string().min(1).max(50)).min(1).max(10),
  action: z.enum(['add', 'remove', 'set']),
});

interface BatchResult {
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

async function softDeleteFolder(db: ReturnType<typeof getDb>, folderId: string, now: string) {
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

app.post('/delete', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchDeleteSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds } = result.data;
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const fileId of fileIds) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get();

      if (!file) {
        batchResult.failed++;
        batchResult.errors.push({ id: fileId, error: '文件不存在或已被删除' });
        continue;
      }

      if (file.isFolder) {
        await softDeleteFolder(db, fileId, now);
      }
      await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, fileId));
      batchResult.success++;
    } catch (error) {
      batchResult.failed++;
      batchResult.errors.push({ id: fileId, error: error instanceof Error ? error.message : '未知错误' });
    }
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.delete',
    resourceType: 'batch',
    details: { action: 'delete', count: fileIds.length, success: batchResult.success },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: batchResult });
});

app.post('/move', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchMoveSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds, targetParentId } = result.data;
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  if (targetParentId) {
    const targetFolder = await db
      .select()
      .from(files)
      .where(
        and(eq(files.id, targetParentId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt))
      )
      .get();
    if (!targetFolder) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '目标文件夹不存在' } }, 404);
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
        batchResult.failed++;
        batchResult.errors.push({ id: fileId, error: '文件不存在或已被删除' });
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
        batchResult.failed++;
        batchResult.errors.push({ id: fileId, error: '目标位置已存在同名文件' });
        continue;
      }

      const newPath = targetParentId ? `${targetParentId}/${file.name}` : `/${file.name}`;
      await db
        .update(files)
        .set({ parentId: targetParentId, path: newPath, updatedAt: now })
        .where(eq(files.id, fileId));

      batchResult.success++;
    } catch (error) {
      batchResult.failed++;
      batchResult.errors.push({ id: fileId, error: error instanceof Error ? error.message : '未知错误' });
    }
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.move',
    resourceType: 'batch',
    details: { action: 'move', count: fileIds.length, success: batchResult.success, targetParentId },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: batchResult });
});

app.post('/copy', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchCopySchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds, targetParentId, targetBucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const now = new Date().toISOString();
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '用户不存在' } }, 401);
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
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '目标文件夹不存在' } }, 404);
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
      batchResult.failed++;
      batchResult.errors.push({ id: fileId, error: '文件不存在或已被删除' });
      continue;
    }

    if (file.isFolder) {
      batchResult.failed++;
      batchResult.errors.push({ id: fileId, error: '暂不支持复制文件夹' });
      continue;
    }

    totalSize += file.size;
    filesToCopy.push(file);
  }

  if (user.storageUsed + totalSize > user.storageQuota) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: '存储空间不足' } }, 400);
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, targetBucketId, targetParentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未配置存储桶' } }, 400);
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, totalSize);
  if (quotaErr) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: quotaErr } }, 400);
  }

  for (const file of filesToCopy) {
    try {
      const sourceBucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);

      let fileContent: ArrayBuffer;
      if (sourceBucketConfig) {
        const s3Res = await s3Get(sourceBucketConfig, file.r2Key);
        fileContent = await s3Res.arrayBuffer();
      } else if (c.env.FILES) {
        const obj = await c.env.FILES.get(file.r2Key);
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

      batchResult.success++;
    } catch (error) {
      batchResult.failed++;
      batchResult.errors.push({ id: file.id, error: error instanceof Error ? error.message : '复制失败' });
    }
  }

  if (batchResult.success > 0) {
    // 仅统计实际成功复制的文件大小（而非按顺序截取），避免中间失败时统计偏差
    const successIds = new Set(
      filesToCopy.filter((_, i) => !batchResult.errors.some((e) => e.id === filesToCopy[i].id)).map((f) => f.id)
    );
    const copiedSize = filesToCopy
      .filter((f) => !batchResult.errors.some((e) => e.id === f.id))
      .reduce((sum, f) => sum + f.size, 0);
    await db
      .update(users)
      .set({ storageUsed: user.storageUsed + copiedSize, updatedAt: now })
      .where(eq(users.id, userId));
    await updateBucketStats(db, bucketConfig.id, copiedSize, batchResult.success);
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.upload',
    resourceType: 'batch',
    details: { action: 'copy', count: fileIds.length, success: batchResult.success, targetParentId },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: batchResult });
});

app.post('/rename', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchRenameSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { items } = result.data;
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const item of items) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, item.fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get();

      if (!file) {
        batchResult.failed++;
        batchResult.errors.push({ id: item.fileId, error: '文件不存在或已被删除' });
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
        batchResult.failed++;
        batchResult.errors.push({ id: item.fileId, error: '已存在同名文件' });
        continue;
      }

      const newPath = file.parentId ? `${file.parentId}/${item.newName}` : `/${item.newName}`;
      await db
        .update(files)
        .set({ name: item.newName, path: newPath, updatedAt: now })
        .where(eq(files.id, item.fileId));

      batchResult.success++;
    } catch (error) {
      batchResult.failed++;
      batchResult.errors.push({ id: item.fileId, error: error instanceof Error ? error.message : '重命名失败' });
    }
  }

  await createAuditLog({
    env: c.env,
    userId,
    action: 'file.rename',
    resourceType: 'batch',
    details: { action: 'rename', count: items.length, success: batchResult.success },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({ success: true, data: batchResult });
});

app.post('/permanent-delete', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchDeleteSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };
  let totalFreed = 0;

  for (const fileId of fileIds) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
        .get();

      if (!file) {
        batchResult.failed++;
        batchResult.errors.push({ id: fileId, error: '文件不存在或不在回收站中' });
        continue;
      }

      if (!file.isFolder) {
        const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
        if (bucketConfig) {
          try {
            await s3Delete(bucketConfig, file.r2Key);
            await updateBucketStats(db, bucketConfig.id, -file.size, -1);
          } catch (e) {
            console.error(`S3 delete failed for ${file.r2Key}:`, e);
          }
        } else if (c.env.FILES) {
          await c.env.FILES.delete(file.r2Key);
        }
        totalFreed += file.size;
      }

      await db.delete(files).where(eq(files.id, fileId));
      batchResult.success++;
    } catch (error) {
      batchResult.failed++;
      batchResult.errors.push({ id: fileId, error: error instanceof Error ? error.message : '删除失败' });
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

  return c.json({
    success: true,
    data: {
      ...batchResult,
      freedBytes: totalFreed,
      message: `已永久删除 ${batchResult.success} 个文件，释放 ${(totalFreed / 1024 / 1024).toFixed(2)} MB`,
    },
  });
});

app.post('/restore', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchDeleteSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds } = result.data;
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const fileId of fileIds) {
    try {
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
        .get();

      if (!file) {
        batchResult.failed++;
        batchResult.errors.push({ id: fileId, error: '文件不存在或未被删除' });
        continue;
      }

      await db.update(files).set({ deletedAt: null, updatedAt: now }).where(eq(files.id, fileId));
      batchResult.success++;
    } catch (error) {
      batchResult.failed++;
      batchResult.errors.push({ id: fileId, error: error instanceof Error ? error.message : '恢复失败' });
    }
  }

  return c.json({ success: true, data: batchResult });
});

export default app;
