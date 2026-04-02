/**
 * preview.ts
 * 文件预览路由
 *
 * 功能:
 * - 获取预览信息（类型、语言等）
 * - 获取原始文本内容
 * - 流媒体预览
 * - 缩略图生成
 * - Office文档预览
 *
 * ============================================================================
 * 【重要提醒】修改此文件后必须同步更新：
 *   - apps/web/src/components/files/FilePreview.tsx      # 文件管理预览组件
 *   - apps/web/src/components/share/ShareFilePreview.tsx # 分享预览组件
 *   - packages/shared/src/constants/previewTypes.ts      # 预览类型配置
 * ============================================================================
 */

import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, storageBuckets, telegramFileRefs } from '../db';
import { authMiddleware } from '../middleware/auth';
import { checkFilePermission } from './permissions';
import {
  ERROR_CODES,
  CODE_HIGHLIGHT_EXTENSIONS,
  ALL_OFFICE_MIME_TYPES,
  EPUB_MIME_TYPES,
  FONT_MIME_TYPES,
  ARCHIVE_PREVIEW_MIME_TYPES,
} from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import type { Env, Variables } from '../types/env';
import { s3Get } from '../lib/s3client';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { verifyJWT, getEncryptionKey } from '../lib/crypto';
import { tgDownloadFile } from '../lib/telegramClient';
import { isChunkedFileId, tgDownloadChunked } from '../lib/telegramChunked';
import { decryptSecret } from '../lib/s3client';
import type { Context, MiddlewareHandler } from 'hono';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_PREVIEW_SIZE = 30 * 1024 * 1024;

type AppEnv = { Bindings: Env; Variables: Variables };

async function resolveTgBucketConfig(
  db: ReturnType<typeof getDb>,
  bucketId: string,
  encKey: string
): Promise<{ botToken: string; chatId: string; apiBase?: string } | null> {
  const bucket = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();
  if (!bucket || bucket.provider !== 'telegram') return null;
  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  return {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };
}

async function verifyTokenFromQuery(
  c: Context<AppEnv>
): Promise<{ userId: string; email: string; role: string } | null> {
  const token = c.req.query('token');
  if (!token) return null;

  try {
    const decoded = await verifyJWT(token, c.env.JWT_SECRET);
    // 与 authMiddleware 保持一致：校验 KV session 是否仍有效（防止已注销的 token 仍可预览）
    const session = await c.env.KV.get(`session:${token}`);
    if (!session) return null;
    return decoded;
  } catch {
    return null;
  }
}

const previewAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const decoded = await verifyTokenFromQuery(c);
  if (decoded) {
    c.set('userId', decoded.userId);
    c.set('user', { id: decoded.userId, email: decoded.email, role: decoded.role });
    return next();
  }
  return authMiddleware(c, next);
};

app.use('*', previewAuthMiddleware);

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '';
}

function getLanguageFromExtension(ext: string): string | null {
  return CODE_HIGHLIGHT_EXTENSIONS[ext] || null;
}

function isPreviewable(mimeType: string | null, fileName: string): { previewable: boolean; type: string } {
  if (!mimeType) {
    const ext = getFileExtension(fileName);
    if (CODE_HIGHLIGHT_EXTENSIONS[ext]) {
      return { previewable: true, type: 'code' };
    }
    if (['.epub'].includes(ext)) {
      return { previewable: true, type: 'epub' };
    }
    if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
      return { previewable: true, type: 'font' };
    }
    if (['.zip'].includes(ext)) {
      return { previewable: true, type: 'archive' };
    }
    return { previewable: false, type: 'unknown' };
  }

  if (mimeType.startsWith('image/')) {
    return { previewable: true, type: 'image' };
  }
  if (mimeType.startsWith('video/')) {
    return { previewable: true, type: 'video' };
  }
  if (mimeType.startsWith('audio/')) {
    return { previewable: true, type: 'audio' };
  }
  if (mimeType === 'application/pdf') {
    return { previewable: true, type: 'pdf' };
  }
  if (mimeType.startsWith('text/')) {
    if (mimeType === 'text/markdown' || fileName.endsWith('.md')) {
      return { previewable: true, type: 'markdown' };
    }
    if (mimeType === 'text/csv' || fileName.endsWith('.csv')) {
      return { previewable: true, type: 'csv' };
    }
    return { previewable: true, type: 'text' };
  }
  if (mimeType === 'application/json' || mimeType === 'application/xml') {
    return { previewable: true, type: 'code' };
  }

  const ext = getFileExtension(fileName);
  if (CODE_HIGHLIGHT_EXTENSIONS[ext]) {
    return { previewable: true, type: 'code' };
  }

  if (ALL_OFFICE_MIME_TYPES.includes(mimeType as (typeof ALL_OFFICE_MIME_TYPES)[number])) {
    return { previewable: true, type: 'office' };
  }

  if (EPUB_MIME_TYPES.includes(mimeType as (typeof EPUB_MIME_TYPES)[number])) {
    return { previewable: true, type: 'epub' };
  }

  if (FONT_MIME_TYPES.includes(mimeType as (typeof FONT_MIME_TYPES)[number])) {
    return { previewable: true, type: 'font' };
  }

  if (ARCHIVE_PREVIEW_MIME_TYPES.includes(mimeType as (typeof ARCHIVE_PREVIEW_MIME_TYPES)[number])) {
    return { previewable: true, type: 'archive' };
  }

  return { previewable: false, type: 'unknown' };
}

app.get('/:id/info', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '文件夹无法预览');

  const { previewable, type } = isPreviewable(file.mimeType, file.name);

  const ext = getFileExtension(file.name);
  const language = getLanguageFromExtension(ext);

  return c.json({
    success: true,
    data: {
      id: file.id,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      previewable,
      previewType: type,
      language,
      extension: ext,
      canPreview: previewable && file.size <= MAX_PREVIEW_SIZE,
    },
  });
});

app.get('/:id/raw', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '文件夹无法预览');

  if (file.size > MAX_PREVIEW_SIZE) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.FILE_TOO_LARGE, message: '文件过大，无法在线预览' } },
      400
    );
  }

  // ── Telegram 桶预览路径 ───────────────────────────────────────────────
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, fileId)).get();
      if (!ref) {
        return c.json(
          { success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用' } },
          404
        );
      }
      const tgConfig = await resolveTgBucketConfig(db, file.bucketId, encKey);
      if (!tgConfig) {
        throwAppError('TG_CONFIG_ERROR', '无法加载 Telegram 配置');
      }
      try {
        const body = isChunkedFileId(ref.tgFileId)
          ? await tgDownloadChunked(tgConfig, ref.tgFileId, db)
          : (await tgDownloadFile(tgConfig, ref.tgFileId)).body;
        const arrayBuffer = await new Response(body).arrayBuffer();
        let content: string;
        try {
          content = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
          if (/[\ufffd]/.test(content)) {
            try {
              const gbkDecoder = new TextDecoder('gbk', { fatal: false });
              content = gbkDecoder.decode(arrayBuffer);
            } catch {
              // GBK 解码失败，保持 UTF-8 结果
            }
          }
        } catch {
          content = new TextDecoder('utf-8').decode(arrayBuffer);
        }
        return c.json({
          success: true,
          data: {
            content,
            mimeType: file.mimeType,
            name: file.name,
            size: file.size,
          },
        });
      } catch (e: any) {
        throwAppError('TG_DOWNLOAD_FAILED', String(e?.message || 'Telegram 下载失败'));
      }
    }
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) throwAppError('FILE_CONTENT_NOT_FOUND');

  let content: string;
  try {
    const arrayBuffer = await s3Res.arrayBuffer();
    content = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
    if (/[\ufffd]/.test(content)) {
      try {
        const gbkDecoder = new TextDecoder('gbk', { fatal: false });
        content = gbkDecoder.decode(arrayBuffer);
      } catch {
        // GBK 解码失败，保持 UTF-8 结果
      }
    }
  } catch {
    content = await s3Res.text();
  }

  return c.json({
    success: true,
    data: {
      content,
      mimeType: file.mimeType,
      name: file.name,
      size: file.size,
    },
  });
});

app.get('/:id/stream', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '文件夹无法预览');

  const { type } = isPreviewable(file.mimeType, file.name);
  if (!['image', 'video', 'audio', 'pdf'].includes(type)) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该文件类型不支持流式预览' } },
      400
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Length': file.size.toString(),
    'Accept-Ranges': 'bytes',
  };

  if (type === 'video' || type === 'audio') {
    headers['Content-Disposition'] = 'inline';
  }

  // ── Telegram 桶预览路径 ───────────────────────────────────────────────
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, fileId)).get();
      if (!ref) {
        return c.json(
          { success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用' } },
          404
        );
      }
      const tgConfig = await resolveTgBucketConfig(db, file.bucketId, encKey);
      if (!tgConfig) {
        throwAppError('TG_CONFIG_ERROR', '无法加载 Telegram 配置');
      }
      try {
        const body = isChunkedFileId(ref.tgFileId)
          ? await tgDownloadChunked(tgConfig, ref.tgFileId, db)
          : (await tgDownloadFile(tgConfig, ref.tgFileId)).body;
        return new Response(body, { headers });
      } catch (e: any) {
        throwAppError('TG_DOWNLOAD_FAILED', String(e?.message || 'Telegram 下载失败'));
      }
    }
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);

  if (!s3Res.ok) throwAppError('FILE_CONTENT_NOT_FOUND');

  return new Response(s3Res.body, { headers });
});

app.get('/:id/thumbnail', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const width = parseInt(c.req.query('width') || '256', 10);
  const height = parseInt(c.req.query('height') || '256', 10);

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');

  if (!file.mimeType?.startsWith('image/')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只支持图片文件生成缩略图' } },
      400
    );
  }

  // ── Telegram 桶预览路径 ───────────────────────────────────────────────
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, fileId)).get();
      if (!ref) {
        return c.json(
          { success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用' } },
          404
        );
      }
      const tgConfig = await resolveTgBucketConfig(db, file.bucketId, encKey);
      if (!tgConfig) {
        throwAppError('TG_CONFIG_ERROR', '无法加载 Telegram 配置');
      }
      try {
        const body = isChunkedFileId(ref.tgFileId)
          ? await tgDownloadChunked(tgConfig, ref.tgFileId, db)
          : (await tgDownloadFile(tgConfig, ref.tgFileId)).body;
        const imageBuffer = await new Response(body).arrayBuffer();
        return new Response(imageBuffer, {
          headers: {
            'Content-Type': file.mimeType,
            'Cache-Control': 'public, max-age=31536000',
            'X-Thumbnail-Size': `${width}x${height}`,
          },
        });
      } catch (e: any) {
        throwAppError('TG_DOWNLOAD_FAILED', String(e?.message || 'Telegram 下载失败'));
      }
    }
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) throwAppError('FILE_CONTENT_NOT_FOUND');

  const imageBuffer = await s3Res.arrayBuffer();

  return new Response(imageBuffer, {
    headers: {
      'Content-Type': file.mimeType,
      'Cache-Control': 'public, max-age=31536000',
      'X-Thumbnail-Size': `${width}x${height}`,
    },
  });
});

app.get('/:id/office', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();

  if (!file) throwAppError('FILE_NOT_FOUND');
  if (!ALL_OFFICE_MIME_TYPES.includes(file.mimeType as (typeof ALL_OFFICE_MIME_TYPES)[number])) {
    throwAppError('FILE_PREVIEW_NOT_SUPPORTED', '不支持该文件类型');
  }

  // ── Telegram 桶预览路径 ───────────────────────────────────────────────
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, fileId)).get();
      if (!ref) {
        return c.json(
          { success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用' } },
          404
        );
      }
      const tgConfig = await resolveTgBucketConfig(db, file.bucketId, encKey);
      if (!tgConfig) {
        throwAppError('TG_CONFIG_ERROR', '无法加载 Telegram 配置');
      }
      try {
        const body = isChunkedFileId(ref.tgFileId)
          ? await tgDownloadChunked(tgConfig, ref.tgFileId, db)
          : (await tgDownloadFile(tgConfig, ref.tgFileId)).body;
        const fileBuffer = await new Response(body).arrayBuffer();
        const base64Content = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
        return c.json({
          success: true,
          data: {
            fileName: file.name,
            mimeType: file.mimeType,
            base64Content,
            size: file.size,
          },
        });
      } catch (e: any) {
        throwAppError('TG_DOWNLOAD_FAILED', String(e?.message || 'Telegram 下载失败'));
      }
    }
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) throwAppError('FILE_CONTENT_NOT_FOUND');

  const fileBuffer = await s3Res.arrayBuffer();
  const base64Content = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

  return c.json({
    success: true,
    data: {
      fileName: file.name,
      mimeType: file.mimeType,
      base64Content,
      size: file.size,
    },
  });
});

export default app;
