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
import { getDb, files, users } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, logger } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { s3Delete, s3Put, s3Get } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, updateUserStorage } from '../lib/bucketResolver';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { getEncryptionKey } from '../lib/crypto';
import { releaseFileRef } from '../lib/dedup';
import { ZipBuilder } from '../lib/zipStream';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const batchDeleteSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
});

const batchMoveSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
  targetParentId: z.string().nullable(),
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
      throwAppError('FOLDER_NOT_FOUND', '目标文件夹不存在');
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

      // ── 跨桶移动检测 ────────────────────────────────────────
      if (targetParentId && file.bucketId) {
        const targetFolder = await db
          .select({ bucketId: files.bucketId })
          .from(files)
          .where(eq(files.id, targetParentId))
          .get();

        if (targetFolder?.bucketId && targetFolder.bucketId !== file.bucketId) {
          batchResult.failed++;
          batchResult.errors.push({
            id: fileId,
            error: 'CROSS_BUCKET',
            sourceBucketId: file.bucketId,
            targetBucketId: targetFolder.bucketId,
          } as any);
          continue;
        }
      }
      // ────────────────────────────────────────────────────────

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

      if (file.isFolder) {
        const oldPath = file.path.endsWith('/') ? file.path.slice(0, -1) : file.path;
        const allFiles = await db
          .select()
          .from(files)
          .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
          .all();

        const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(oldPath + '/'));
        for (const child of childFiles) {
          const newChildPath = newPath + child.path.slice(oldPath.length);
          await db.update(files).set({ path: newChildPath, updatedAt: now }).where(eq(files.id, child.id));
        }
      }

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

      if (file.isFolder) {
        const oldPath = file.path.endsWith('/') ? file.path.slice(0, -1) : file.path;
        const allFiles = await db
          .select()
          .from(files)
          .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
          .all();

        const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(oldPath + '/'));
        for (const child of childFiles) {
          const newChildPath = newPath + child.path.slice(oldPath.length);
          await db.update(files).set({ path: newChildPath, updatedAt: now }).where(eq(files.id, child.id));
        }
      }

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

      if (file.isFolder) {
        const folderPath = file.path.endsWith('/') ? file.path.slice(0, -1) : file.path;
        const allFiles = await db
          .select()
          .from(files)
          .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
          .all();

        const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(folderPath + '/'));

        for (const child of childFiles) {
          if (!child.isFolder) {
            const { shouldDeleteStorage } = await releaseFileRef(db, child.id);
            if (shouldDeleteStorage) {
              const bucketConfig = await resolveBucketConfig(db, userId, encKey, child.bucketId, child.parentId);
              if (bucketConfig) {
                try {
                  await s3Delete(bucketConfig, child.r2Key);
                  await updateBucketStats(db, bucketConfig.id, -child.size, -1);
                } catch (error) {
                  logger.error('BATCH', 'S3删除失败', { r2Key: child.r2Key }, error);
                }
              } else if (c.env.FILES) {
                await c.env.FILES.delete(child.r2Key);
              }
            }
            totalFreed += child.size;
          }
          await db.delete(files).where(eq(files.id, child.id));
        }
      } else {
        const { shouldDeleteStorage } = await releaseFileRef(db, fileId);
        if (shouldDeleteStorage) {
          const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
          if (bucketConfig) {
            try {
              await s3Delete(bucketConfig, file.r2Key);
              await updateBucketStats(db, bucketConfig.id, -file.size, -1);
            } catch (error) {
              logger.error('BATCH', 'S3删除失败', { r2Key: file.r2Key }, error);
            }
          } else if (c.env.FILES) {
            await c.env.FILES.delete(file.r2Key);
          }
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
    await updateUserStorage(db, userId, -totalFreed);
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

      if (file.isFolder) {
        const folderPath = file.path.endsWith('/') ? file.path.slice(0, -1) : file.path;
        const allFiles = await db
          .select()
          .from(files)
          .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
          .all();

        const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(folderPath + '/'));
        for (const child of childFiles) {
          await db.update(files).set({ deletedAt: null, updatedAt: now }).where(eq(files.id, child.id));
        }
      }

      batchResult.success++;
    } catch (error) {
      batchResult.failed++;
      batchResult.errors.push({ id: fileId, error: error instanceof Error ? error.message : '恢复失败' });
    }
  }

  return c.json({ success: true, data: batchResult });
});

const batchZipSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
  zipName: z.string().max(100).optional(),
});

app.post('/zip', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = batchZipSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds, zipName = 'download' } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const MAX_ZIP_BYTES = 500 * 1024 * 1024;

  const fileRecords = await db
    .select()
    .from(files)
    .where(
      and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false), inArray(files.id, fileIds))
    )
    .all();

  const totalBytes = fileRecords.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_ZIP_BYTES) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `ZIP 总大小不超过 500MB，当前 ${(totalBytes / 1024 / 1024).toFixed(1)}MB`,
        },
      },
      400
    );
  }

  const zip = new ZipBuilder();

  for (const file of fileRecords) {
    try {
      const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
      let buf: ArrayBuffer;
      if (bucketConfig) {
        const res = await s3Get(bucketConfig, file.r2Key);
        buf = await res.arrayBuffer();
      } else if (c.env.FILES) {
        const obj = await c.env.FILES.get(file.r2Key);
        if (!obj) continue;
        buf = await obj.arrayBuffer();
      } else {
        continue;
      }
      zip.addFile(file.name, buf, new Date(file.updatedAt));
    } catch {
      continue;
    }
  }

  const zipBytes = zip.finalize();
  return new Response(zipBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}.zip`,
      'Content-Length': zipBytes.length.toString(),
    },
  });
});

export default app;
