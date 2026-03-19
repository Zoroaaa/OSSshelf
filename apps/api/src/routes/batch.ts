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
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { getEncryptionKey } from '../lib/crypto';
import {
  batchSoftDelete,
  batchMove,
  batchCopy,
  batchRename,
  batchPermanentDelete,
  batchRestore,
} from '../services/batch.service';

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
  const batchResult = await batchSoftDelete(db, userId, fileIds);

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
  const batchResult = await batchMove(db, userId, fileIds, targetParentId);

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
  const batchResult = await batchCopy(c.env, db, encKey, userId, fileIds, targetParentId, targetBucketId);

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
  const batchResult = await batchRename(db, userId, items);

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
  const batchResult = await batchPermanentDelete(c.env, db, encKey, userId, fileIds);

  return c.json({
    success: true,
    data: {
      ...batchResult,
      message: `已永久删除 ${batchResult.success} 个文件，释放 ${(batchResult.freedBytes / 1024 / 1024).toFixed(2)} MB`,
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
  const batchResult = await batchRestore(db, userId, fileIds);

  return c.json({ success: true, data: batchResult });
});

export default app;
