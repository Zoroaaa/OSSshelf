/**
 * batch.ts
 * 批量操作路由
 *
 * 功能:
 * - 批量删除文件
 * - 批量移动文件
 * - 批量重命名
 * - 批量永久删除
 * - 批量恢复
 */

import { Hono } from 'hono';
import { eq, and, isNull, isNotNull, inArray } from 'drizzle-orm';
import { getDb, files } from '../db';
import { authMiddleware, requireApiKeyScope } from '../middleware/auth';
import { ERROR_CODES, logger } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { s3Get } from '../lib/s3client';
import { deleteObjectSafely } from '../lib/storageGC';
import {
  buildFilePath,
  buildDescendantPathUpdate,
  normalizeEntryName,
  normalizeParentId,
  pathPrefix,
} from '../lib/pathUtils';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { getEncryptionKey } from '../lib/crypto';
import { releaseFileRef } from '../lib/dedup';
import { createZipStream, assertZipLimits } from '../lib/zipStream';
import { openFileStream } from '../lib/fileContentHelper';
import { restoreFile } from '../lib/fileService';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);
app.use('*', requireApiKeyScope('files:read', 'files:write'));

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
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.issues[0].message } },
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
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.issues[0].message } },
      400
    );
  }

  const { fileIds, targetParentId: rawTargetParentId } = result.data;
  // 统一入口：目标父目录先校验/规范化
  const targetParentId = normalizeParentId(rawTargetParentId);
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

      const newPath = await buildFilePath(db, userId, targetParentId, file.name);

      // 自身更新 + 子树 path 更新放在同一 batch 中，避免只改一半
      const updateSelf = db
        .update(files)
        .set({ parentId: targetParentId, path: newPath, updatedAt: now })
        .where(eq(files.id, fileId));
      if (file.isFolder) {
        await db.batch([
          updateSelf,
          buildDescendantPathUpdate(db, userId, file.path, newPath, now, file.teamId ?? null),
        ]);
      } else {
        await db.batch([updateSelf]);
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
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.issues[0].message } },
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

      const newName = normalizeEntryName(item.newName);

      const conflict = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.userId, userId),
            eq(files.name, newName),
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

      const newPath = await buildFilePath(db, userId, file.parentId, newName);

      const updateSelf = db
        .update(files)
        .set({ name: newName, path: newPath, updatedAt: now })
        .where(eq(files.id, item.fileId));
      if (file.isFolder) {
        await db.batch([
          updateSelf,
          buildDescendantPathUpdate(db, userId, file.path, newPath, now, file.teamId ?? null),
        ]);
      } else {
        await db.batch([updateSelf]);
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
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.issues[0].message } },
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

      const idsToDelete: string[] = [];

      if (file.isFolder) {
        const subtreePrefix = pathPrefix(file.path);
        const namespaceCondition = file.teamId ? eq(files.teamId, file.teamId) : isNull(files.teamId);
        const allFiles = await db
          .select()
          .from(files)
          .where(and(eq(files.userId, userId), namespaceCondition, isNotNull(files.deletedAt)))
          .all();

        const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(subtreePrefix));

        for (const child of childFiles) {
          if (!child.isFolder) {
            const { shouldDeleteStorage } = await releaseFileRef(db, child.id);
            if (shouldDeleteStorage) {
              await deleteObjectSafely(c.env, db, {
                userId,
                bucketId: child.bucketId,
                parentId: child.parentId,
                r2Key: child.r2Key,
                reason: 'batch-permanent-delete',
              });
            }
            totalFreed += child.size;
          }
          idsToDelete.push(child.id);
        }
      } else {
        const { shouldDeleteStorage } = await releaseFileRef(db, fileId);
        if (shouldDeleteStorage) {
          await deleteObjectSafely(c.env, db, {
            userId,
            bucketId: file.bucketId,
            parentId: file.parentId,
            r2Key: file.r2Key,
            reason: 'batch-permanent-delete',
          });
        }
        totalFreed += file.size;
      }

      idsToDelete.push(fileId);
      // 单次 SQL 删除整批记录，避免逐条删除留下半删除状态
      await db
        .delete(files)
        .where(and(eq(files.userId, userId), inArray(files.id, idsToDelete)));
      batchResult.success++;
    } catch (error) {
      batchResult.failed++;
      batchResult.errors.push({ id: fileId, error: error instanceof Error ? error.message : '删除失败' });
    }
  }

  // 配额在软删除时已由 files 触发器扣减，永久删除不重复扣减。

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
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.issues[0].message } },
      400
    );
  }

  const { fileIds } = result.data;
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const fileId of fileIds) {
    try {
      // 复用单条恢复逻辑：会一并恢复被删除的祖先目录，避免子项成为不可见的孤儿。
      const restored = await restoreFile(c.env, userId, fileId);
      if (!restored.success) {
        batchResult.failed++;
        batchResult.errors.push({ id: fileId, error: restored.error });
        continue;
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
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.issues[0].message } },
      400
    );
  }

  const { fileIds, zipName = 'download' } = result.data;
  const db = getDb(c.env.DB);

  const fileRecords = await db
    .select()
    .from(files)
    .where(
      and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false), inArray(files.id, fileIds))
    )
    .all();

  try {
    assertZipLimits(fileRecords);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: error instanceof Error ? error.message : 'ZIP 打包参数超出限制',
        },
      },
      400
    );
  }

  const sources = fileRecords.map((file) => ({
    name: file.name,
    size: file.size,
    modDate: new Date(file.updatedAt),
    open: () => openFileStream(c.env, file),
  }));

  return new Response(createZipStream(sources), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}.zip`,
    },
  });
});

export default app;
