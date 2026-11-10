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
import { normalizeParentId, pathPrefix } from '../lib/pathUtils';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { getEncryptionKey } from '../lib/crypto';
import { releaseFileRef } from '../lib/dedup';
import { createZipStream, assertZipLimits } from '../lib/zipStream';
import { openFileStream } from '../lib/fileContentHelper';
import { restoreFile, softDeleteFile, moveFile, renameFile } from '../lib/fileService';
import { checkFilePermission } from '../lib/permissionService';

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
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const fileId of fileIds) {
    try {
      // 与单条删除同一套语义：按文件校验 admin 权限，而不是只看 userId。
      const deleted = await softDeleteFile(c.env, userId, fileId);
      if (!deleted.success) {
        batchResult.failed++;
        batchResult.errors.push({ id: fileId, error: deleted.error });
        continue;
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
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  if (targetParentId) {
    const targetFolder = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, targetParentId), eq(files.isFolder, true), isNull(files.deletedAt)))
      .get();
    if (!targetFolder) {
      throwAppError('FOLDER_NOT_FOUND', '目标文件夹不存在');
    }
    // 与单条移动一致：目标目录要求 write 权限（共享目录同样适用），而不是要求目标必须属于自己。
    const { hasAccess } = await checkFilePermission(db, targetParentId, userId, 'write', c.env);
    if (!hasAccess) {
      throwAppError('FORBIDDEN', '无权向目标目录移动文件');
    }
  }

  for (const fileId of fileIds) {
    try {
      // 复用单条移动：源文件归属、目标写权限、跨桶与循环移动校验全部一致。
      const moved = await moveFile(c.env, userId, fileId, { targetParentId });
      if (!moved.success) {
        batchResult.failed++;
        batchResult.errors.push({ id: fileId, error: moved.error });
        continue;
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
  const batchResult: BatchResult = { success: 0, failed: 0, errors: [] };

  for (const item of items) {
    try {
      // 复用单条重命名：权限（write）、路径与子树同步、全文索引更新保持一致。
      const renamed = await renameFile(c.env, userId, item.fileId, { name: item.newName });
      if (!renamed.success) {
        batchResult.failed++;
        batchResult.errors.push({ id: item.fileId, error: renamed.error });
        continue;
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

  // 与单条下载一致：按文件校验 read 权限，而不是只认归属，
  // 否则共享给自己的文件在批量下载时会被静默丢弃。
  const permittedFileIds: string[] = [];
  for (const fileId of fileIds) {
    const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
    if (hasAccess) permittedFileIds.push(fileId);
  }
  if (permittedFileIds.length === 0) {
    throwAppError('FILE_ACCESS_DENIED', '没有可下载的文件');
  }

  const fileRecords = await db
    .select()
    .from(files)
    .where(and(isNull(files.deletedAt), eq(files.isFolder, false), inArray(files.id, permittedFileIds)))
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
