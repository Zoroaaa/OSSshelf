/**
 * share.ts
 * 文件分享路由
 *
 * 功能：
 * - 创建下载分享链接（文件 / 文件夹）
 * - 创建上传链接（允许外部用户向文件夹上传）
 * - 密码保护、有效期、下载次数限制
 * - 文件夹分享：列出子文件 + ZIP 打包下载
 * - 上传链接：无需账号，遵循文件夹 MIME 类型限制
 */

import { Hono } from 'hono';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { getDb, files, shares, storageBuckets, telegramFileRefs, users } from '../db';
import { s3Get, s3Put } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats } from '../lib/bucketResolver';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, SHARE_DEFAULT_EXPIRY, MAX_FILE_SIZE, inferMimeType } from '@osshelf/shared';
import { getEncryptionKey, hashPassword, verifyPassword } from '../lib/crypto';
import { checkFolderMimeTypeRestriction } from '../lib/folderPolicy';
import { tgUploadFile, tgDownloadFile, type TelegramBotConfig } from '../lib/telegramClient';
import { isChunkedFileId, tgDownloadChunked, needsChunking, tgUploadChunked } from '../lib/telegramChunked';
import { decryptSecret } from '../lib/s3client';
import { ZipBuilder } from '../lib/zipStream';
import { encodeFilename } from '../lib/utils';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Validation schemas ─────────────────────────────────────────────────────

const createShareSchema = z.object({
  fileId: z.string().min(1, '文件ID不能为空'),
  password: z.string().optional(),
  expiresAt: z.string().optional(),
  downloadLimit: z.number().int().min(1).optional(),
});

const createUploadLinkSchema = z.object({
  /** 目标文件夹 ID */
  folderId: z.string().min(1, '文件夹ID不能为空'),
  password: z.string().optional(),
  expiresAt: z.string().optional(),
  /** 单文件大小上限（字节），null = 继承系统上限 */
  maxUploadSize: z.number().int().min(1).optional(),
  /** 允许的 MIME 类型列表，null = 继承文件夹 allowedMimeTypes */
  allowedMimeTypes: z.array(z.string()).optional(),
  /** 最多可上传文件数，null = 不限 */
  maxUploadCount: z.number().int().min(1).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * 验证分享链接有效性（expiry + password），返回 share 记录或 error。
 * 适用于下载类分享（is_upload_link = false）。
 */
async function resolveDownloadShare(db: ReturnType<typeof getDb>, shareId: string, password?: string) {
  const share = await db.select().from(shares).where(eq(shares.id, shareId)).get();
  if (!share) return { error: { code: ERROR_CODES.NOT_FOUND, message: '分享链接不存在' }, status: 404 as const };
  if (share.isUploadLink)
    return {
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: '此链接为上传链接，不可下载' },
      status: 400 as const,
    };
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return { error: { code: ERROR_CODES.SHARE_EXPIRED, message: '分享链接已过期' }, status: 410 as const };
  }
  if (share.password) {
    if (password === undefined) {
      return { error: { code: ERROR_CODES.SHARE_PASSWORD_REQUIRED, message: '需要密码访问' }, status: 401 as const };
    }
    const valid = share.password.startsWith('pbkdf2:')
      ? await verifyPassword(password, share.password)
      : share.password === password; // 兼容旧明文记录
    if (!valid) {
      return { error: { code: ERROR_CODES.SHARE_PASSWORD_INVALID, message: '密码错误' }, status: 401 as const };
    }
  }
  return { share };
}

/**
 * 验证上传链接有效性（token + expiry + password）。
 */
async function resolveUploadShare(db: ReturnType<typeof getDb>, uploadToken: string, password?: string) {
  const share = await db.select().from(shares).where(eq(shares.uploadToken, uploadToken)).get();
  if (!share) return { error: { code: ERROR_CODES.NOT_FOUND, message: '上传链接不存在' }, status: 404 as const };
  if (!share.isUploadLink)
    return {
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: '此链接为下载链接，不可上传' },
      status: 400 as const,
    };
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return { error: { code: ERROR_CODES.SHARE_EXPIRED, message: '上传链接已过期' }, status: 410 as const };
  }
  if (share.password) {
    if (password === undefined) {
      return { error: { code: ERROR_CODES.SHARE_PASSWORD_REQUIRED, message: '需要密码访问' }, status: 401 as const };
    }
    const valid = share.password.startsWith('pbkdf2:')
      ? await verifyPassword(password, share.password)
      : share.password === password; // 兼容旧明文记录
    if (!valid) {
      return { error: { code: ERROR_CODES.SHARE_PASSWORD_INVALID, message: '密码错误' }, status: 401 as const };
    }
  }
  return { share };
}

/**
 * 从对象存储中下载文件内容，返回 ArrayBuffer。
 * 统一处理 S3 / Telegram / legacy R2 三种情况。
 */
async function fetchFileContent(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  file: typeof files.$inferSelect
): Promise<ArrayBuffer> {
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id)).get();
      if (!ref) throw new Error(`Telegram 文件引用不存在: ${file.id}`);
      const botToken = await decryptSecret(bkt.accessKeyId, encKey);
      const tgConfig: TelegramBotConfig = {
        botToken,
        chatId: bkt.bucketName,
        apiBase: bkt.endpoint || undefined,
      };
      if (isChunkedFileId(ref.tgFileId)) {
        const stream = await tgDownloadChunked(tgConfig, ref.tgFileId, db);
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let pos = 0;
        for (const c of chunks) {
          out.set(c, pos);
          pos += c.length;
        }
        return out.buffer;
      }
      const resp = await tgDownloadFile(tgConfig, ref.tgFileId);
      return resp.arrayBuffer();
    }
  }
  const bucketCfg = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  if (bucketCfg) {
    const resp = await s3Get(bucketCfg, file.r2Key);
    return resp.arrayBuffer();
  }
  if (env.FILES) {
    const obj = await env.FILES.get(file.r2Key);
    if (!obj) throw new Error(`文件内容不存在: ${file.r2Key}`);
    return obj.arrayBuffer();
  }
  throw new Error('存储桶未配置');
}

/**
 * 递归收集文件夹下的所有非文件夹文件（用于 ZIP 打包）。
 * 返回 [{file, relativePath}]，relativePath 相对于分享文件夹根。
 */
async function collectFolderFiles(
  db: ReturnType<typeof getDb>,
  folderId: string,
  basePath = ''
): Promise<Array<{ file: typeof files.$inferSelect; relativePath: string }>> {
  const children = await db
    .select()
    .from(files)
    .where(and(eq(files.parentId, folderId), isNull(files.deletedAt)))
    .all();

  const result: Array<{ file: typeof files.$inferSelect; relativePath: string }> = [];
  for (const child of children) {
    if (child.isFolder) {
      const sub = await collectFolderFiles(db, child.id, `${basePath}${child.name}/`);
      result.push(...sub);
    } else {
      result.push({ file: child, relativePath: `${basePath}${child.name}` });
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 下载分享（有账号端点）
// ═══════════════════════════════════════════════════════════════════════════

// ── Create download share ────────────────────────────────────────────────
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
  const expires = expiresAt || new Date(Date.now() + SHARE_DEFAULT_EXPIRY).toISOString();
  const hashedPassword = password ? await hashPassword(password) : null;

  await db.insert(shares).values({
    id: shareId,
    fileId,
    userId,
    password: hashedPassword,
    expiresAt: expires,
    downloadLimit: downloadLimit || null,
    downloadCount: 0,
    isUploadLink: false,
    uploadToken: null,
    maxUploadSize: null,
    uploadAllowedMimeTypes: null,
    maxUploadCount: null,
    uploadCount: 0,
    createdAt: now,
  });

  return c.json({
    success: true,
    data: {
      id: shareId,
      fileId,
      isFolder: file.isFolder,
      expiresAt: expires,
      downloadLimit,
      createdAt: now,
      shareUrl: `/share/${shareId}`,
    },
  });
});

// ── List user's shares ────────────────────────────────────────────────────
app.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const userShares = await db.select().from(shares).where(eq(shares.userId, userId)).all();

  // Batch fetch files (避免 N+1)
  const fileIds = [...new Set(userShares.map((s) => s.fileId))];
  const fileRows = fileIds.length > 0 ? await db.select().from(files).where(inArray(files.id, fileIds)).all() : [];
  const fileMap = Object.fromEntries(fileRows.map((f) => [f.id, f]));

  const enriched = userShares.map((share) => {
    const file = fileMap[share.fileId];
    return {
      ...share,
      file: file
        ? { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, isFolder: file.isFolder }
        : null,
    };
  });

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

// ═══════════════════════════════════════════════════════════════════════════
// 上传链接（有账号端点：创建 / 列表）
// ═══════════════════════════════════════════════════════════════════════════

// ── Create upload link ────────────────────────────────────────────────────
app.post('/upload-link', authMiddleware, async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createUploadLinkSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { folderId, password, expiresAt, maxUploadSize, allowedMimeTypes, maxUploadCount } = result.data;
  const db = getDb(c.env.DB);

  // 验证目标文件夹归属当前用户
  const folder = await db
    .select()
    .from(files)
    .where(and(eq(files.id, folderId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt)))
    .get();
  if (!folder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件夹不存在' } }, 404);
  }

  const shareId = crypto.randomUUID();
  const uploadToken = crypto.randomUUID();
  const now = new Date().toISOString();
  const expires = expiresAt || new Date(Date.now() + SHARE_DEFAULT_EXPIRY).toISOString();
  const hashedPassword = password ? await hashPassword(password) : null;

  await db.insert(shares).values({
    id: shareId,
    fileId: folderId,
    userId,
    password: hashedPassword,
    expiresAt: expires,
    downloadLimit: null,
    downloadCount: 0,
    isUploadLink: true,
    uploadToken,
    maxUploadSize: maxUploadSize ?? null,
    uploadAllowedMimeTypes: allowedMimeTypes ? JSON.stringify(allowedMimeTypes) : null,
    maxUploadCount: maxUploadCount ?? null,
    uploadCount: 0,
    createdAt: now,
  });

  return c.json({
    success: true,
    data: {
      id: shareId,
      folderId,
      folderName: folder.name,
      uploadToken,
      expiresAt: expires,
      maxUploadSize,
      allowedMimeTypes: allowedMimeTypes ?? null,
      maxUploadCount: maxUploadCount ?? null,
      createdAt: now,
      uploadUrl: `/upload/${uploadToken}`,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 公开端点（无鉴权，通过 shareId / uploadToken 访问）
// ═══════════════════════════════════════════════════════════════════════════

// ── Public: get share info（含文件夹子文件列表）────────────────────────────
app.get('/:id', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

  // 文件夹分享：返回一层子文件列表（不递归，支持前端分页浏览）
  let children: Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string | null;
    isFolder: boolean;
    updatedAt: string;
  }> | null = null;
  if (file.isFolder) {
    const rows = await db
      .select()
      .from(files)
      .where(and(eq(files.parentId, file.id), isNull(files.deletedAt)))
      .all();
    children = rows.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
      isFolder: f.isFolder,
      updatedAt: f.updatedAt,
    }));
  }

  return c.json({
    success: true,
    data: {
      id: share.id,
      file: {
        id: file.id,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        isFolder: file.isFolder,
      },
      children,
      expiresAt: share.expiresAt,
      downloadLimit: share.downloadLimit,
      downloadCount: share.downloadCount,
      hasPassword: !!share.password,
    },
  });
});

const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

const PREVIEWABLE_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'text/'];
const PREVIEWABLE_MIME_TYPES = [
  'application/pdf',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
];

function isPreviewableMimeType(mimeType: string | null): boolean {
  if (!mimeType) return false;
  if (PREVIEWABLE_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
  if (PREVIEWABLE_MIME_TYPES.includes(mimeType)) return true;
  return false;
}

function getPreviewType(mimeType: string | null): string {
  if (!mimeType) return 'unknown';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'text';
  if (['application/json', 'application/xml', 'application/javascript', 'application/typescript'].includes(mimeType))
    return 'code';
  return 'unknown';
}

// ── Public: preview（支持图片/视频/音频/PDF/文本）────────────────────────────
app.get('/:id/preview', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

  if (!isPreviewableMimeType(file.mimeType)) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该文件类型不支持预览' } },
      400
    );
  }

  if (file.size > MAX_PREVIEW_SIZE && !file.mimeType?.startsWith('video/') && !file.mimeType?.startsWith('audio/')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.FILE_TOO_LARGE, message: '文件过大，请下载后查看' } },
      400
    );
  }

  const encKey = getEncryptionKey(c.env);
  try {
    const buf = await fetchFileContent(c.env, db, encKey, file);
    return new Response(buf, {
      headers: { 'Content-Type': file.mimeType!, 'Cache-Control': 'private, max-age=300' },
    });
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: e?.message } }, 502);
  }
});

// ── Public: stream preview（视频/音频流式预览，支持 Range）────────────────────
app.get('/:id/stream', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

  if (!file.mimeType?.startsWith('video/') && !file.mimeType?.startsWith('audio/')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '仅支持视频/音频流式预览' } },
      400
    );
  }

  const encKey = getEncryptionKey(c.env);
  const range = c.req.header('Range');

  try {
    const buf = await fetchFileContent(c.env, db, encKey, file);
    const fileSize = buf.byteLength;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0] || '0', 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const chunk = buf.slice(start, end + 1);

      return new Response(chunk, {
        status: 206,
        headers: {
          'Content-Type': file.mimeType!,
          'Content-Length': chunkSize.toString(),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    return new Response(buf, {
      headers: {
        'Content-Type': file.mimeType!,
        'Content-Length': fileSize.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: e?.message } }, 502);
  }
});

// ── Public: raw text content（文本内容预览）──────────────────────────────────
app.get('/:id/raw', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

  const isTextFile =
    file.mimeType?.startsWith('text/') ||
    file.mimeType === 'application/json' ||
    file.mimeType === 'application/xml' ||
    file.mimeType === 'application/javascript' ||
    file.mimeType === 'application/typescript';

  if (!isTextFile) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '仅支持文本文件预览' } },
      400
    );
  }

  if (file.size > MAX_PREVIEW_SIZE) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.FILE_TOO_LARGE, message: '文件过大，请下载后查看' } },
      400
    );
  }

  const encKey = getEncryptionKey(c.env);
  try {
    const buf = await fetchFileContent(c.env, db, encKey, file);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    return c.json({ success: true, data: { content: text, mimeType: file.mimeType } });
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: e?.message } }, 502);
  }
});

// ── Public: preview info（获取预览信息）──────────────────────────────────────
app.get('/:id/preview-info', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

  const previewType = getPreviewType(file.mimeType);
  const canPreview = isPreviewableMimeType(file.mimeType);

  return c.json({
    success: true,
    data: {
      id: file.id,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      previewType,
      canPreview,
    },
  });
});

// ── Public: download single file via share ────────────────────────────────
app.get('/:id/download', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
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
  if (file.isFolder) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '文件夹请使用 /zip 端点下载' } },
      400
    );
  }

  await db
    .update(shares)
    .set({ downloadCount: share.downloadCount + 1 })
    .where(eq(shares.id, shareId));

  const encKey = getEncryptionKey(c.env);
  try {
    const buf = await fetchFileContent(c.env, db, encKey, file);
    return new Response(buf, {
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'Content-Length': file.size.toString(),
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: e?.message } }, 502);
  }
});

// ── Public: download folder as ZIP ────────────────────────────────────────
// GET /api/share/:id/zip?password=...&fileIds=id1,id2,...
// fileIds 为可选筛选（仅打包指定子文件，不传则打包全部）
app.get('/:id/zip', async (c) => {
  const shareId = c.req.param('id');
  const password = c.req.query('password');
  const fileIdsParam = c.req.query('fileIds'); // 可选：逗号分隔的文件 ID
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
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

  const folder = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!folder) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件夹不存在' } }, 404);
  if (!folder.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '此分享不是文件夹' } }, 400);
  }

  const encKey = getEncryptionKey(c.env);

  // 收集要打包的文件
  let entries: Array<{ file: typeof files.$inferSelect; relativePath: string }>;
  if (fileIdsParam) {
    // 仅打包用户指定的文件 ID（需验证它们属于此文件夹）
    const selectedIds = fileIdsParam.split(',').filter(Boolean);
    const selectedFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.parentId, folder.id), inArray(files.id, selectedIds), isNull(files.deletedAt)))
      .all();
    entries = selectedFiles.filter((f) => !f.isFolder).map((f) => ({ file: f, relativePath: f.name }));
  } else {
    entries = await collectFolderFiles(db, folder.id, '');
  }

  if (entries.length === 0) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '文件夹为空' } }, 400);
  }

  // 安全限制：单次 ZIP 最多 200 个文件，总大小不超过 500MB
  const MAX_ZIP_FILES = 200;
  const MAX_ZIP_BYTES = 500 * 1024 * 1024;
  if (entries.length > MAX_ZIP_FILES) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `ZIP 打包最多 ${MAX_ZIP_FILES} 个文件，当前 ${entries.length} 个`,
        },
      },
      400
    );
  }
  const totalBytes = entries.reduce((n, e) => n + e.file.size, 0);
  if (totalBytes > MAX_ZIP_BYTES) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `ZIP 打包总大小不超过 500MB，当前 ${(totalBytes / 1024 / 1024).toFixed(1)}MB`,
        },
      },
      400
    );
  }

  // 构建 ZIP
  const zip = new ZipBuilder();
  const errors: string[] = [];

  for (const { file, relativePath } of entries) {
    try {
      const buf = await fetchFileContent(c.env, db, encKey, file);
      zip.addFile(relativePath, buf, new Date(file.updatedAt));
    } catch (e: any) {
      errors.push(`${relativePath}: ${e?.message}`);
      console.error('[share/zip] fetchFileContent failed:', relativePath, e);
    }
  }

  if (errors.length === entries.length) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: '所有文件下载失败' } }, 502);
  }

  // 更新下载计数（整个 ZIP 算一次下载）
  await db
    .update(shares)
    .set({ downloadCount: share.downloadCount + 1 })
    .where(eq(shares.id, shareId));

  const zipBytes = zip.finalize();
  const zipName = `${folder.name}.zip`;

  return new Response(zipBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      'Content-Length': zipBytes.length.toString(),
      ...(errors.length > 0 ? { 'X-Partial-Zip': errors.length.toString() } : {}),
    },
  });
});

// ── Public: download single child file within a folder share ──────────────
// GET /api/share/:id/file/:fileId/download?password=...
app.get('/:id/file/:fileId/download', async (c) => {
  const shareId = c.req.param('id');
  const childFileId = c.req.param('fileId');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const folder = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!folder?.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '分享文件夹不存在' } }, 404);
  }

  // 验证 childFileId 属于此文件夹（一级，防止路径遍历）
  const childFile = await db
    .select()
    .from(files)
    .where(and(eq(files.id, childFileId), eq(files.parentId, folder.id), isNull(files.deletedAt)))
    .get();
  if (!childFile || childFile.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  const encKey = getEncryptionKey(c.env);
  try {
    const buf = await fetchFileContent(c.env, db, encKey, childFile);
    return new Response(buf, {
      headers: {
        'Content-Type': childFile.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(childFile.name)}`,
        'Content-Length': childFile.size.toString(),
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: e?.message } }, 502);
  }
});

// ── Public: preview child file within a folder share ────────────────────────
// GET /api/share/:id/file/:fileId/preview?password=...
app.get('/:id/file/:fileId/preview', async (c) => {
  const shareId = c.req.param('id');
  const childFileId = c.req.param('fileId');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const folder = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!folder?.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '分享文件夹不存在' } }, 404);
  }

  const childFile = await db
    .select()
    .from(files)
    .where(and(eq(files.id, childFileId), eq(files.parentId, folder.id), isNull(files.deletedAt)))
    .get();
  if (!childFile || childFile.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (!isPreviewableMimeType(childFile.mimeType)) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该文件类型不支持预览' } },
      400
    );
  }

  if (
    childFile.size > MAX_PREVIEW_SIZE &&
    !childFile.mimeType?.startsWith('video/') &&
    !childFile.mimeType?.startsWith('audio/')
  ) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.FILE_TOO_LARGE, message: '文件过大，请下载后查看' } },
      400
    );
  }

  const encKey = getEncryptionKey(c.env);
  try {
    const buf = await fetchFileContent(c.env, db, encKey, childFile);
    return new Response(buf, {
      headers: { 'Content-Type': childFile.mimeType!, 'Cache-Control': 'private, max-age=300' },
    });
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: e?.message } }, 502);
  }
});

// ── Public: stream child file (video/audio) within a folder share ───────────
// GET /api/share/:id/file/:fileId/stream?password=...
app.get('/:id/file/:fileId/stream', async (c) => {
  const shareId = c.req.param('id');
  const childFileId = c.req.param('fileId');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const folder = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!folder?.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '分享文件夹不存在' } }, 404);
  }

  const childFile = await db
    .select()
    .from(files)
    .where(and(eq(files.id, childFileId), eq(files.parentId, folder.id), isNull(files.deletedAt)))
    .get();
  if (!childFile || childFile.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (!childFile.mimeType?.startsWith('video/') && !childFile.mimeType?.startsWith('audio/')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '仅支持视频/音频流式预览' } },
      400
    );
  }

  const encKey = getEncryptionKey(c.env);
  const range = c.req.header('Range');

  try {
    const buf = await fetchFileContent(c.env, db, encKey, childFile);
    const fileSize = buf.byteLength;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0] || '0', 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const chunk = buf.slice(start, end + 1);

      return new Response(chunk, {
        status: 206,
        headers: {
          'Content-Type': childFile.mimeType!,
          'Content-Length': chunkSize.toString(),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    return new Response(buf, {
      headers: {
        'Content-Type': childFile.mimeType!,
        'Content-Length': fileSize.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: e?.message } }, 502);
  }
});

// ── Public: raw text content of child file within a folder share ────────────
// GET /api/share/:id/file/:fileId/raw?password=...
app.get('/:id/file/:fileId/raw', async (c) => {
  const shareId = c.req.param('id');
  const childFileId = c.req.param('fileId');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveDownloadShare(db, shareId, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const folder = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!folder?.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '分享文件夹不存在' } }, 404);
  }

  const childFile = await db
    .select()
    .from(files)
    .where(and(eq(files.id, childFileId), eq(files.parentId, folder.id), isNull(files.deletedAt)))
    .get();
  if (!childFile || childFile.isFolder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  const isTextFile =
    childFile.mimeType?.startsWith('text/') ||
    childFile.mimeType === 'application/json' ||
    childFile.mimeType === 'application/xml' ||
    childFile.mimeType === 'application/javascript' ||
    childFile.mimeType === 'application/typescript';

  if (!isTextFile) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '仅支持文本文件预览' } },
      400
    );
  }

  if (childFile.size > MAX_PREVIEW_SIZE) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.FILE_TOO_LARGE, message: '文件过大，请下载后查看' } },
      400
    );
  }

  const encKey = getEncryptionKey(c.env);
  try {
    const buf = await fetchFileContent(c.env, db, encKey, childFile);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    return c.json({ success: true, data: { content: text, mimeType: childFile.mimeType } });
  } catch (e: any) {
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: e?.message } }, 502);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 上传链接公开端点
// ═══════════════════════════════════════════════════════════════════════════

// ── Public: get upload link info ──────────────────────────────────────────
// GET /api/share/upload/:token?password=...
app.get('/upload/:token', async (c) => {
  const token = c.req.param('token');
  const password = c.req.query('password');
  const db = getDb(c.env.DB);

  const resolved = await resolveUploadShare(db, token, password);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;
  const folder = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!folder)
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '目标文件夹不存在' } }, 404);

  const parsedAllowedMimes: string[] | null = share.uploadAllowedMimeTypes
    ? JSON.parse(share.uploadAllowedMimeTypes)
    : null;

  return c.json({
    success: true,
    data: {
      token,
      folderName: folder.name,
      expiresAt: share.expiresAt,
      hasPassword: !!share.password,
      maxUploadSize: share.maxUploadSize ?? MAX_FILE_SIZE,
      allowedMimeTypes: parsedAllowedMimes,
      maxUploadCount: share.maxUploadCount,
      uploadCount: share.uploadCount,
    },
  });
});

// ── Public: upload file via upload link ───────────────────────────────────
// POST /api/share/upload/:token
// Body: multipart/form-data { file, password? }
app.post('/upload/:token', async (c) => {
  const token = c.req.param('token');
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data 格式上传' } },
      400
    );
  }

  const formData = await c.req.formData();
  const password = formData.get('password') as string | null;
  const uploadFile = formData.get('file') as File | null;

  if (!uploadFile) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请选择文件' } }, 400);
  }

  const db = getDb(c.env.DB);
  const resolved = await resolveUploadShare(db, token, password ?? undefined);
  if ('error' in resolved) {
    return c.json({ success: false, error: resolved.error }, resolved.status);
  }

  const { share } = resolved;

  // 检查上传数量限制
  if (share.maxUploadCount !== null && share.uploadCount >= share.maxUploadCount) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `此上传链接最多允许上传 ${share.maxUploadCount} 个文件，已达上限`,
        },
      },
      403
    );
  }

  // 检查文件大小
  const maxSize = share.maxUploadSize ?? MAX_FILE_SIZE;
  if (uploadFile.size > maxSize) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.FILE_TOO_LARGE,
          message: `文件大小超过限制（此链接最大 ${(maxSize / 1024 / 1024).toFixed(0)}MB）`,
        },
      },
      400
    );
  }

  // 检查 MIME 类型（优先使用上传链接自身的限制，其次继承文件夹限制）
  const fileMime = inferMimeType(uploadFile.name, uploadFile.type);
  const parsedLinkMimes: string[] | null = share.uploadAllowedMimeTypes
    ? JSON.parse(share.uploadAllowedMimeTypes)
    : null;

  if (parsedLinkMimes && parsedLinkMimes.length > 0) {
    const allowed = parsedLinkMimes.some((m) =>
      m.endsWith('/*') ? fileMime.startsWith(m.slice(0, -1)) : m === fileMime
    );
    if (!allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `此上传链接仅允许上传以下类型的文件: ${parsedLinkMimes.join(', ')}`,
          },
        },
        400
      );
    }
  } else {
    // 继承文件夹 allowedMimeTypes 限制
    const mimeCheck = await checkFolderMimeTypeRestriction(db, share.fileId, fileMime);
    if (!mimeCheck.allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `目标文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}`,
          },
        },
        400
      );
    }
  }

  // 获取目标文件夹和存储桶配置（以文件夹 owner 身份写入）
  const folder = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!folder) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '目标文件夹不存在' } }, 404);
  }

  const folderOwnerId = folder.userId;
  const encKey = getEncryptionKey(c.env);
  const bucketConfig = await resolveBucketConfig(db, folderOwnerId, encKey, folder.bucketId, folder.id);

  if (!bucketConfig && !c.env.FILES) {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
  }

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `files/${folderOwnerId}/${fileId}/${encodeFilename(uploadFile.name)}`;
  const path = `${share.fileId}/${uploadFile.name}`;
  const fileBuffer = await uploadFile.arrayBuffer();

  // 写入存储
  let isTelegram = false;
  if (bucketConfig?.provider === 'telegram') {
    isTelegram = true;
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketConfig.id)).get();
    if (!bkt) {
      return c.json({ success: false, error: { code: 'TG_CONFIG_ERROR', message: '无法加载 Telegram 配置' } }, 500);
    }
    const botToken = await decryptSecret(bkt.accessKeyId, encKey);
    const tgConfig: TelegramBotConfig = {
      botToken,
      chatId: bkt.bucketName,
      apiBase: bkt.endpoint || undefined,
    };
    let tgFileId: string;
    let tgFileSize: number;
    if (needsChunking(fileBuffer.byteLength)) {
      const chunked = await tgUploadChunked(tgConfig, fileBuffer, uploadFile.name, fileMime, db, bucketConfig.id);
      tgFileId = chunked.virtualFileId;
      tgFileSize = chunked.totalBytes;
    } else {
      const caption = `📁 ${uploadFile.name}\n🗂 OSSshelf Upload Link | ${now.slice(0, 10)}`;
      const result = await tgUploadFile(tgConfig, fileBuffer, uploadFile.name, fileMime, caption);
      tgFileId = result.fileId;
      tgFileSize = result.fileSize;
    }
    await db.insert(telegramFileRefs).values({
      id: crypto.randomUUID(),
      fileId,
      r2Key,
      tgFileId,
      tgFileSize,
      bucketId: bucketConfig.id,
      createdAt: now,
    });
  } else if (bucketConfig) {
    await s3Put(bucketConfig, r2Key, fileBuffer, fileMime, {
      userId: folderOwnerId,
      originalName: uploadFile.name,
      uploadedVia: 'upload-link',
    });
  } else if (c.env.FILES) {
    await c.env.FILES.put(r2Key, fileBuffer, {
      httpMetadata: { contentType: fileMime },
      customMetadata: { userId: folderOwnerId, originalName: uploadFile.name },
    });
  }

  // 写入 files 表
  await db.insert(files).values({
    id: fileId,
    userId: folderOwnerId,
    parentId: share.fileId,
    name: uploadFile.name,
    path,
    type: 'file',
    size: uploadFile.size,
    r2Key,
    mimeType: fileMime || null,
    hash: null,
    refCount: 1,
    isFolder: false,
    bucketId: bucketConfig?.id ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  // 更新 owner 存储用量
  const owner = await db.select().from(users).where(eq(users.id, folderOwnerId)).get();
  if (owner) {
    await db
      .update(users)
      .set({ storageUsed: owner.storageUsed + uploadFile.size, updatedAt: now })
      .where(eq(users.id, folderOwnerId));
  }
  if (bucketConfig) {
    await updateBucketStats(db, bucketConfig.id, isTelegram ? uploadFile.size : uploadFile.size, 1);
  }

  // 更新上传链接计数
  await db
    .update(shares)
    .set({ uploadCount: share.uploadCount + 1 })
    .where(eq(shares.id, share.id));

  return c.json({
    success: true,
    data: {
      id: fileId,
      name: uploadFile.name,
      size: uploadFile.size,
      mimeType: fileMime,
      createdAt: now,
    },
  });
});

export default app;
