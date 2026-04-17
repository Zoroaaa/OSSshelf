/**
 * directLink.ts
 * 文件直链路由
 *
 * 功能:
 * - 创建/删除文件直链
 * - 通过直链公开访问文件（无需登录）
 * - 支持设置有效期或永久有效
 */

import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, storageBuckets, telegramFileRefs } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import { getEncryptionKey } from '../lib/crypto';
import { s3Get } from '../lib/s3client';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { tgDownloadFile, type TelegramBotConfig } from '../lib/telegramClient';
import { isChunkedFileId, tgDownloadChunked } from '../lib/telegramChunked';
import { decryptSecret } from '../lib/s3client';
import { throwAppError } from '../middleware/error';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createDirectLinkSchema = z.object({
  fileId: z.string().min(1, '文件ID不能为空'),
  expiresAt: z.string().nullable().optional(),
});

const DIRECT_LINK_DEFAULT_EXPIRY_DAYS = 7;

/**
 * 获取文件的直链信息（需认证）
 * GET /api/direct/file/:fileId
 * 注意：这个路由必须放在 /:token 之前
 */
app.get('/file/:fileId', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select({
      id: files.id,
      name: files.name,
      size: files.size,
      mimeType: files.mimeType,
      directLinkToken: files.directLinkToken,
      directLinkExpiresAt: files.directLinkExpiresAt,
    })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');

  if (!file.directLinkToken) {
    return c.json({ success: true, data: null });
  }

  const baseUrl = c.env.PUBLIC_URL || new URL(c.req.url).origin;
  const directUrl = `${baseUrl}/api/direct/${file.directLinkToken}`;

  return c.json({
    success: true,
    data: {
      token: file.directLinkToken,
      fileId: file.id,
      fileName: file.name,
      directUrl,
      expiresAt: file.directLinkExpiresAt,
      isPermanent: file.directLinkExpiresAt === null,
    },
  });
});

/**
 * 创建直链（需认证）
 * POST /api/direct
 */
app.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createDirectLinkSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileId, expiresAt } = result.data;
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');

  if (file.isFolder) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '文件夹不支持创建直链' } },
      400
    );
  }

  const token = file.directLinkToken || crypto.randomUUID();
  const now = new Date().toISOString();
  // expiresAt 为 null 表示永久有效，为 undefined 使用默认值
  const expires =
    expiresAt === null
      ? null
      : expiresAt || new Date(Date.now() + DIRECT_LINK_DEFAULT_EXPIRY_DAYS * 86400000).toISOString();

  await db
    .update(files)
    .set({
      directLinkToken: token,
      directLinkExpiresAt: expires,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  const baseUrl = c.env.PUBLIC_URL || new URL(c.req.url).origin;
  const directUrl = `${baseUrl}/api/direct/${token}`;

  return c.json({
    success: true,
    data: {
      token,
      fileId,
      fileName: file.name,
      directUrl,
      expiresAt: expires,
      isPermanent: expires === null,
      createdAt: now,
    },
  });
});

/**
 * 删除直链（需认证）
 * DELETE /api/direct/:fileId
 */
app.delete('/:fileId', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');
  if (!file.directLinkToken) throwAppError('FILE_NOT_FOUND', '该文件未创建直链');

  const now = new Date().toISOString();
  await db
    .update(files)
    .set({
      directLinkToken: null,
      directLinkExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  return c.json({ success: true, data: { message: '直链已删除' } });
});

/**
 * 更新直链有效期（需认证）
 * PUT /api/direct/:fileId
 */
app.put('/:fileId', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const body = await c.req.json();
  const { expiresAt } = body;

  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');
  if (!file.directLinkToken) throwAppError('FILE_NOT_FOUND', '该文件未创建直链');

  const now = new Date().toISOString();
  // expiresAt 为 null 表示永久有效，为 undefined 使用默认值
  const expires =
    expiresAt === null
      ? null
      : expiresAt || new Date(Date.now() + DIRECT_LINK_DEFAULT_EXPIRY_DAYS * 86400000).toISOString();

  await db
    .update(files)
    .set({
      directLinkExpiresAt: expires,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  const baseUrl = c.env.PUBLIC_URL || new URL(c.req.url).origin;
  const directUrl = `${baseUrl}/api/direct/${file.directLinkToken}`;

  return c.json({
    success: true,
    data: {
      token: file.directLinkToken,
      fileId: file.id,
      fileName: file.name,
      directUrl,
      expiresAt: expires,
      isPermanent: expires === null,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 以下为公开端点（无需认证），必须放在最后
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 获取直链信息（公开，无需认证）
 * GET /api/direct/:token/info
 */
app.get('/:token/info', async (c) => {
  const token = c.req.param('token');
  const db = getDb(c.env.DB);

  const file = await db
    .select({
      id: files.id,
      name: files.name,
      size: files.size,
      mimeType: files.mimeType,
      directLinkExpiresAt: files.directLinkExpiresAt,
    })
    .from(files)
    .where(and(eq(files.directLinkToken, token), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.directLinkExpiresAt && new Date(file.directLinkExpiresAt) < new Date()) {
    throwAppError('SHARE_EXPIRED', '直链已过期');
  }

  return c.json({
    success: true,
    data: {
      ...file,
      isPermanent: file.directLinkExpiresAt === null,
    },
  });
});

/**
 * 通过直链token公开预览文件（无需认证）
 * GET /api/direct/:token/preview
 */
app.get('/:token/preview', async (c) => {
  const token = c.req.param('token');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.directLinkToken, token), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.directLinkExpiresAt && new Date(file.directLinkExpiresAt) < new Date()) {
    throwAppError('SHARE_EXPIRED', '直链已过期');
  }
  if (file.isFolder) {
    throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '文件夹不支持预览');
  }

  const encKey = getEncryptionKey(c.env);
  const pvHeaders = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Length': file.size.toString(),
    'Cache-Control': 'private, max-age=3600',
  };

  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id)).get();
      if (!ref) {
        return c.json(
          { success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用' } },
          404
        );
      }
      const botToken = await decryptSecret(bkt.accessKeyId, encKey);
      const tgConfig: TelegramBotConfig = {
        botToken,
        chatId: bkt.bucketName,
        apiBase: bkt.endpoint || undefined,
      };
      try {
        const body = isChunkedFileId(ref.tgFileId)
          ? await tgDownloadChunked(tgConfig, ref.tgFileId, db)
          : (await tgDownloadFile(tgConfig, ref.tgFileId)).body;
        return new Response(body, { headers: pvHeaders });
      } catch (e: any) {
        return c.json({ success: false, error: { code: 'TG_DOWNLOAD_FAILED', message: e?.message } }, 502);
      }
    }
  }

  const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);
    return new Response(s3Res.body, { headers: pvHeaders });
  }

  if (c.env.FILES) {
    const obj = await c.env.FILES.get(file.r2Key);
    if (!obj) throwAppError('FILE_CONTENT_NOT_FOUND');
    return new Response(obj.body, { headers: pvHeaders });
  }

  return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
});

/**
 * 通过直链token公开下载文件（无需认证）
 * GET /api/direct/:token
 * 注意：这个路由必须放在最后，因为 /:token 会匹配所有路径
 */
app.get('/:token', async (c) => {
  const token = c.req.param('token');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.directLinkToken, token), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND', '直链不存在或已失效');

  if (file.directLinkExpiresAt && new Date(file.directLinkExpiresAt) < new Date()) {
    throwAppError('SHARE_EXPIRED', '直链已过期');
  }

  if (file.isFolder) {
    throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '文件夹不支持直链访问');
  }

  // 直链速率限制：每IP每分钟最多60次请求，防止滥用为免费CDN
  const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0] || 'unknown';
  const dlRateKey = `directlink_rate:${token}:${clientIp}`;
  const dlRateCount = await c.env.KV.get(dlRateKey);
  if (dlRateCount && parseInt(dlRateCount) >= 60) {
    return c.json({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: '下载频率过高，请稍后再试' } }, 429);
  }
  const prevDl = await c.env.KV.get(dlRateKey);
  await c.env.KV.put(dlRateKey, String(parseInt(prevDl || '0') + 1), { expirationTtl: 60 });

  const encKey = getEncryptionKey(c.env);
  const dlHeaders = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Content-Length': file.size.toString(),
    'Cache-Control': 'private, max-age=3600',
  };

  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id)).get();
      if (!ref) {
        return c.json(
          { success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用，文件可能已损坏' } },
          404
        );
      }
      const botToken = await decryptSecret(bkt.accessKeyId, encKey);
      const tgConfig: TelegramBotConfig = {
        botToken,
        chatId: bkt.bucketName,
        apiBase: bkt.endpoint || undefined,
      };
      try {
        const body = isChunkedFileId(ref.tgFileId)
          ? await tgDownloadChunked(tgConfig, ref.tgFileId, db)
          : (await tgDownloadFile(tgConfig, ref.tgFileId)).body;
        return new Response(body, { headers: dlHeaders });
      } catch (e: any) {
        return c.json(
          { success: false, error: { code: 'TG_DOWNLOAD_FAILED', message: e?.message || 'Telegram 下载失败' } },
          502
        );
      }
    }
  }

  const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);
    return new Response(s3Res.body, { headers: dlHeaders });
  }

  if (c.env.FILES) {
    const obj = await c.env.FILES.get(file.r2Key);
    if (!obj) throwAppError('FILE_CONTENT_NOT_FOUND');
    return new Response(obj.body, { headers: dlHeaders });
  }

  return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
});

export default app;
