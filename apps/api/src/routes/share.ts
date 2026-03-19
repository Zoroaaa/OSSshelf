/**
 * share.ts
 * 文件分享路由
 *
 * 功能:
 * - 创建分享链接
 * - 分享权限管理
 * - 分享文件预览与下载
 * - 密码保护与访问限制
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb, files, shares } from '../db';
import { s3Get } from '../lib/s3client';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, SHARE_DEFAULT_EXPIRY } from '@osshelf/shared';
import { getEncryptionKey } from '../lib/crypto';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createShareSchema = z.object({
  fileId: z.string().min(1, '文件ID不能为空'),
  password: z.string().optional(),
  expiresAt: z.string().optional(),
  downloadLimit: z.number().int().min(1).optional(),
});

// ── helpers ───────────────────────────────────────────────────────────────

async function resolveShare(db: ReturnType<typeof import('../db').getDb>, shareId: string, password?: string) {
  const share = await db.select().from(shares).where(eq(shares.id, shareId)).get();
  if (!share) return { error: { code: ERROR_CODES.NOT_FOUND, message: '分享链接不存在' }, status: 404 as const };
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return { error: { code: ERROR_CODES.SHARE_EXPIRED, message: '分享链接已过期' }, status: 410 as const };
  }
  if (share.password && share.password !== password) {
    const code = password !== undefined ? ERROR_CODES.SHARE_PASSWORD_INVALID : ERROR_CODES.SHARE_PASSWORD_REQUIRED;
    const message = password !== undefined ? '密码错误' : '需要密码访问';
    return { error: { code, message }, status: 401 as const };
  }
  return { share };
}

// ── Create share ──────────────────────────────────────────────────────────
app.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createShareSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, password, expiresAt, downloadLimit } = result.data;
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();
  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  const shareId = crypto.randomUUID();
  const now = new Date().toISOString();
  // If no expiresAt provided, use default expiry
  const expires = expiresAt || new Date(Date.now() + SHARE_DEFAULT_EXPIRY).toISOString();

  await db.insert(shares).values({
    id: shareId,
    fileId,
    userId,
    password: password || null,
    expiresAt: expires,
    downloadLimit: downloadLimit || null,
    downloadCount: 0,
    createdAt: now,
  });

  return c.json({
    success: true,
    data: { id: shareId, fileId, expiresAt: expires, downloadLimit, createdAt: now, shareUrl: `/share/${shareId}` },
  });
});

// ── List user's shares ────────────────────────────────────────────────────
app.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const userShares = await db.select().from(shares).where(eq(shares.userId, userId)).all();

  const enriched = await Promise.all(
    userShares.map(async (share) => {
      const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
      return {
        ...share,
        file: file
          ? { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, isFolder: file.isFolder }
          : null,
      };
    })
  );

  return c.json({ success: true, data: enriched });
});

// ── Delete share ──────────────────────────────────────────────────────────
app.delete('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const shareId = c.req.param('id');
  const db = getDb(c.env.DB);

  const share = await db
    .select()
    .from(shares)
    .where(and(eq(shares.id, shareId), eq(shares.userId, userId)))
    .get();
  if (!share) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '分享不存在' } }, 404);
  }

  await db.delete(shares).where(eq(shares.id, shareId));
  return c.json({ success: true, data: { message: '已删除分享' } });
});

// ── Public: get share info ────────────────────────────────────────────────
app.get('/:id', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

  return c.json({
    success: true,
    data: {
      id: share.id,
      file: { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, isFolder: file.isFolder },
      expiresAt: share.expiresAt,
      downloadLimit: share.downloadLimit,
      downloadCount: share.downloadCount,
      hasPassword: !!share.password,
    },
  });
});

// ── Public: inline preview (images only, for share landing page) ──────────
app.get('/:id/preview', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

  // Only allow image preview on public share page (to avoid media streaming abuse)
  if (!file.mimeType?.startsWith('image/')) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只支持预览图片' } }, 400);
  }

  const encKey = getEncryptionKey(c.env);
  const bucketCfg = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  if (bucketCfg) {
    const s3Res = await s3Get(bucketCfg, file.r2Key);
    return new Response(s3Res.body, {
      headers: { 'Content-Type': file.mimeType!, 'Cache-Control': 'private, max-age=300' },
    });
  } else if (c.env.FILES) {
    const r2Object = await c.env.FILES.get(file.r2Key);
    if (!r2Object)
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404);
    return new Response(r2Object.body, {
      headers: { 'Content-Type': file.mimeType!, 'Cache-Control': 'private, max-age=300' },
    });
  }
  return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
});

// ── Public: download via share ────────────────────────────────────────────
app.get('/:id/download', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  if (share.downloadLimit && share.downloadCount >= share.downloadLimit) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.SHARE_DOWNLOAD_LIMIT_EXCEEDED, message: '下载次数已达上限' } },
      403
    );
  }

  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (file.isFolder)
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无法下载文件夹' } }, 400);

  await db
    .update(shares)
    .set({ downloadCount: share.downloadCount + 1 })
    .where(eq(shares.id, shareId));

  const encKey = getEncryptionKey(c.env);
  const bucketCfg = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  const dlHeaders = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
    'Content-Length': file.size.toString(),
  };
  if (bucketCfg) {
    const s3Res = await s3Get(bucketCfg, file.r2Key);
    return new Response(s3Res.body, { headers: dlHeaders });
  }
  if (c.env.FILES) {
    const r2Object = await c.env.FILES.get(file.r2Key);
    if (!r2Object)
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404);
    return new Response(r2Object.body, { headers: dlHeaders });
  }
  return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
});

export default app;
