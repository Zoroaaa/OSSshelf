/**
 * files.ts
 * 文件管理路由
 *
 * 功能:
 * - 文件/文件夹的增删改查
 * - 文件上传与下载
 * - 回收站管理
 * - 文件预览与缩略图
 */

import { Hono, type Context } from 'hono';
import { eq, and, isNull, isNotNull, like, or, inArray, sql, count, gt } from 'drizzle-orm';
import {
  getDb,
  files,
  users,
  storageBuckets,
  filePermissions,
  telegramFileRefs,
  fileVersions,
  groupMembers,
  userStars,
  shares,
  auditLogs,
  fileTags,
} from '../db';
import { checkFilePermission } from './permissions';
import { inheritParentPermissions } from './permissions';
import {
  restoreFile as serviceRestoreFile,
  renameFile as serviceRenameFile,
  moveFile as serviceMoveFile,
  softDeleteFile as serviceSoftDeleteFile,
  toggleStar as serviceToggleStar,
  calculateFoldersSize,
  type FolderSizeStats,
} from '../lib/fileService';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import {
  ERROR_CODES,
  MAX_FILE_SIZE,
  isPreviewableMimeType,
  inferMimeType,
  logger,
  isEditableFile,
  MAX_EDITABLE_SIZE,
} from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { sendNotification } from '../lib/notificationUtils';
import { s3Put, s3Get, s3Delete, decryptSecret } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, updateUserStorage, checkBucketQuota } from '../lib/bucketResolver';
import { checkFolderMimeTypeRestriction } from '../lib/folderPolicy';
import { getEncryptionKey } from '../lib/crypto';
import { createAuditLog, getClientIp, getUserAgent } from '../lib/audit';
import { recordActivityWithEnv } from '../lib/teamActivityService';
import { tgUploadFile, tgDownloadFile, TG_MAX_CHUNKED_FILE_SIZE, type TelegramBotConfig } from '../lib/telegramClient';
import {
  needsChunking,
  tgUploadChunked,
  tgDownloadChunked,
  tgDeleteChunked,
  isChunkedFileId,
} from '../lib/telegramChunked';
import { checkAndClaimDedup, releaseFileRef, computeSha256Hex } from '../lib/dedup';
import { createVersionSnapshot, shouldCreateVersion } from '../lib/versionManager';
import { autoProcessFile, isAIConfigured, enqueueAutoProcessFile } from '../lib/ai/features';
import { dispatchWebhook } from '../lib/webhook';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Shared auth helper for pre-middleware routes ───────────────────────────
/**
 * preview / download 路由位于 authMiddleware 挂载点之前，需手动解析 token。
 * 支持 Authorization: Bearer <token> 和 ?token=<token> 两种方式。
 */

async function resolveUserFromRequest(c: Context): Promise<string | undefined> {
  const jwtSecret = (c.env as Env).JWT_SECRET;
  const { verifyJWT } = await import('../lib/crypto');

  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = await verifyJWT(authHeader.slice(7), jwtSecret);
      if (payload?.userId) return payload.userId as string;
    } catch {
      /* ignore */
    }
  }

  const queryToken = c.req.query('token');
  if (queryToken) {
    try {
      const payload = await verifyJWT(queryToken, jwtSecret);
      if (payload?.userId) return payload.userId as string;
    } catch {
      /* ignore */
    }
  }

  return undefined;
}

// ── Telegram helper ────────────────────────────────────────────────────────
async function resolveTgBucketConfig(
  db: ReturnType<typeof getDb>,
  bucketId: string,
  encKey: string
): Promise<TelegramBotConfig | null> {
  const bucket = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();
  if (!bucket || bucket.provider !== 'telegram') return null;
  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  return {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };
}

const createFolderSchema = z.object({
  name: z.string().min(1, '文件夹名称不能为空').max(255, '名称过长'),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
});

const createFileSchema = z.object({
  name: z.string().min(1, '文件名称不能为空').max(255, '名称过长'),
  content: z.string().optional().default(''),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
  mimeType: z.string().optional(),
});

const updateFileSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(255, '名称过长').optional(),
  parentId: z.string().nullable().optional(),
});

const updateFolderSettingsSchema = z.object({
  allowedMimeTypes: z.array(z.string()).nullable().optional(),
});

const moveFileSchema = z.object({
  targetParentId: z.string().nullable(),
});

// ── Preview (before authMiddleware, supports token query param) ─────────────
app.get('/:id/preview', async (c) => {
  const userId = await resolveUserFromRequest(c);
  if (!userId) throwAppError('UNAUTHORIZED');
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const { hasAccess } = await checkFilePermission(db, fileId, userId!, 'read', c.env);
  if (!hasAccess) throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '无法预览文件夹');
  if (!isPreviewableMimeType(file.mimeType, file.name)) throwAppError('FILE_PREVIEW_NOT_SUPPORTED');
  const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  const pvHeaders = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Length': file.size.toString(),
    'Cache-Control': 'public, max-age=3600',
  };

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
        return new Response(body, { headers: pvHeaders });
      } catch (e: any) {
        throwAppError('TG_DOWNLOAD_FAILED', String(e?.message || 'Telegram 下载失败'));
      }
    }
  }

  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);
    return new Response(s3Res.body, { headers: pvHeaders });
  }
  if (c.env.FILES) {
    const obj = await c.env.FILES.get(file.r2Key);
    if (!obj) throwAppError('FILE_CONTENT_NOT_FOUND');
    return new Response(obj.body, { headers: pvHeaders });
  }
  throwAppError('NO_STORAGE_CONFIGURED', '存储桶未配置');
});

// ── Download (before authMiddleware, supports token query param) ───────────
app.get('/:id/download', async (c) => {
  const userId = await resolveUserFromRequest(c);
  if (!userId) throwAppError('UNAUTHORIZED');
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const { hasAccess } = await checkFilePermission(db, fileId, userId!, 'read', c.env);
  if (!hasAccess) throwAppError('FILE_ACCESS_DENIED', '无权下载此文件');

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '无法下载文件夹');
  const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  const dlHeaders = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Content-Length': file.size.toString(),
  };

  // ── Telegram 桶下载路径 ───────────────────────────────────────────────
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, fileId)).get();
      if (!ref) {
        return c.json(
          { success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用，文件可能已损坏' } },
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
        return new Response(body, { headers: dlHeaders });
      } catch (e: any) {
        return c.json(
          { success: false, error: { code: 'TG_DOWNLOAD_FAILED', message: e?.message || 'Telegram 下载失败' } },
          502
        );
      }
    }
  }

  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);

    sendNotification(c, {
      userId,
      type: 'file_downloaded',
      title: '文件下载成功',
      body: `文件「${file.name}」已成功下载`,
      data: {
        fileId,
        fileName: file.name,
        size: file.size,
        mimeType: file.mimeType,
      },
    });

    return new Response(s3Res.body, { headers: dlHeaders });
  }
  if (c.env.FILES) {
    const obj = await c.env.FILES.get(file.r2Key);
    if (!obj) throwAppError('FILE_CONTENT_NOT_FOUND');

    sendNotification(c, {
      userId,
      type: 'file_downloaded',
      title: '文件下载成功',
      body: `文件「${file.name}」已成功下载`,
      data: {
        fileId,
        fileName: file.name,
        size: file.size,
        mimeType: file.mimeType,
      },
    });

    return new Response(obj.body, { headers: dlHeaders });
  }
  throwAppError('NO_STORAGE_CONFIGURED', '存储桶未配置');
});

// ── Folder download as ZIP ───────────────────────────────────────────────
// GET /:id/zip?fileIds=id1,id2,...
// 文件夹打包下载（支持选择部分文件）
app.get('/:id/zip', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const fileIdsParam = c.req.query('fileIds'); // 可选：逗号分隔的文件 ID
  const db = getDb(c.env.DB);

  // 查询文件夹
  const folder = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt)))
    .get();

  if (!folder) throwAppError('FILE_NOT_FOUND');

  const encKey = getEncryptionKey(c.env);

  // 收集要打包的文件
  let entries: Array<{ file: typeof files.$inferSelect; relativePath: string }>;

  if (fileIdsParam) {
    // 仅打包用户指定的文件（需验证属于此文件夹）
    const selectedIds = fileIdsParam.split(',').filter(Boolean);
    const selectedFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.parentId, fileId), inArray(files.id, selectedIds), isNull(files.deletedAt)))
      .all();
    entries = selectedFiles.filter((f) => !f.isFolder).map((f) => ({ file: f, relativePath: f.name }));
  } else {
    // 打包整个文件夹（递归收集）
    entries = await collectFolderFiles(db, fileId, '', userId);
  }

  if (entries.length === 0) {
    throwAppError('VALIDATION_ERROR', '文件夹为空或无可下载文件');
  }

  // 安全限制
  const MAX_ZIP_FILES = 200;
  const MAX_ZIP_BYTES = 500 * 1024 * 1024; // 500MB

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
  const { ZipBuilder } = await import('../lib/zipStream');
  const zip = new ZipBuilder();
  const errors: string[] = [];

  for (const { file, relativePath } of entries) {
    try {
      const buf = await fetchFileContent(c.env, db, encKey, file);
      zip.addFile(relativePath, buf, new Date(file.updatedAt));
    } catch (error) {
      errors.push(`${relativePath}: ${error instanceof Error ? error.message : '未知错误'}`);
      logger.error('FILES', '获取文件内容失败', { relativePath }, error);
    }
  }

  if (errors.length === entries.length) {
    throwAppError('FILE_DOWNLOAD_FAILED', '所有文件下载失败');
  }

  const zipBytes = zip.finalize();
  const zipName = `${folder.name}.zip`;

  return new Response(zipBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      'Content-Length': zipBytes.length.toString(),
      ...(errors.length > 0 ? { 'X-Partial-Zip': String(errors.length) } : {}),
    },
  });
});

/**
 * 递归收集文件夹下的所有非文件夹文件
 */
async function collectFolderFiles(
  db: ReturnType<typeof getDb>,
  folderId: string,
  basePath: string,
  userId: string
): Promise<Array<{ file: typeof files.$inferSelect; relativePath: string }>> {
  const children = await db
    .select()
    .from(files)
    .where(and(eq(files.parentId, folderId), eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const result: Array<{ file: typeof files.$inferSelect; relativePath: string }> = [];

  for (const child of children) {
    if (child.isFolder) {
      const sub = await collectFolderFiles(db, child.id, `${basePath}${child.name}/`, userId);
      result.push(...sub);
    } else {
      result.push({ file: child, relativePath: `${basePath}${child.name}` });
    }
  }

  return result;
}

/**
 * 从对象存储中获取文件内容
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
      const tgConfig = { botToken, chatId: bkt.bucketName, apiBase: bkt.endpoint || undefined };

      if (isChunkedFileId(ref.tgFileId)) {
        const { tgDownloadChunked } = await import('../lib/telegramChunked');
        const stream = await tgDownloadChunked(tgConfig, ref.tgFileId, db);
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        // eslint-disable-next-line no-constant-condition
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

      const { tgDownloadFile } = await import('../lib/telegramClient');
      const resp = await tgDownloadFile(tgConfig, ref.tgFileId);
      return resp.arrayBuffer();
    }

    const bucketCfg = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
    if (bucketCfg) {
      const { s3Get } = await import('../lib/s3client');
      const resp = await s3Get(bucketCfg, file.r2Key);
      return resp.arrayBuffer();
    }
  }

  if (env.FILES) {
    const obj = await env.FILES.get(file.r2Key);
    if (!obj) throw new Error(`文件内容不存在: ${file.r2Key}`);
    return obj.arrayBuffer();
  }

  throw new Error('存储桶未配置');
}

app.use('*', authMiddleware);

// ── Upload ─────────────────────────────────────────────────────────────────
app.post('/upload', async (c) => {
  const userId = c.get('userId')!;
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data 格式上传' } },
      400
    );
  }

  const formData = await c.req.formData();
  const uploadFile = formData.get('file') as File | null;
  const parentId = formData.get('parentId') as string | null;
  const requestedBucketId = formData.get('bucketId') as string | null;

  if (!uploadFile)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请选择要上传的文件' } },
      400
    );
  if (uploadFile.size > MAX_FILE_SIZE)
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.FILE_TOO_LARGE,
          message: `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB）`,
        },
      },
      400
    );

  const db = getDb(c.env.DB);

  const fileMime = inferMimeType(uploadFile.name, uploadFile.type);
  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId, fileMime);
  if (!mimeCheck.allowed) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}`,
        },
      },
      400
    );
  }

  if (parentId) {
    const { hasAccess } = await checkFilePermission(db, parentId, userId, 'write', c.env);
    if (!hasAccess) {
      return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权向此目录上传文件' } }, 403);
    }
  }

  const encKey = getEncryptionKey(c.env);
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId, parentId);

  // ── 检测是否为 Telegram 存储桶 ─────────────────────────────────────────
  const effectiveBucketId = bucketConfig?.id ?? requestedBucketId ?? null;
  let isTelegramBucket = false;
  if (effectiveBucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, effectiveBucketId)).get();
    if (bkt?.provider === 'telegram') isTelegramBucket = true;
  }

  // Telegram 文件大小检查（分片上传最大 2GB；≤50MB 直接上传，>50MB 自动分片）
  if (isTelegramBucket && uploadFile.size > TG_MAX_CHUNKED_FILE_SIZE) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.FILE_TOO_LARGE,
          message: `Telegram 存储桶文件上限 2GB，当前文件 ${(uploadFile.size / 1024 / 1024 / 1024).toFixed(2)}GB`,
        },
      },
      413
    );
  }

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && user.storageQuota! < 999999 * 1024 ** 3 && user.storageUsed + uploadFile.size > user.storageQuota!) {
    throwAppError('STORAGE_EXCEEDED', '用户存储配额已满');
  }
  if (bucketConfig) {
    const quotaErr = await checkBucketQuota(db, bucketConfig.id, uploadFile.size);
    if (quotaErr) throwAppError('STORAGE_EXCEEDED', quotaErr);
  }

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `files/${userId}/${fileId}/${uploadFile.name}`;
  const path = parentId ? `${parentId}/${uploadFile.name}` : `/${uploadFile.name}`;
  const finalBucketId = isTelegramBucket ? effectiveBucketId : (bucketConfig?.id ?? null);

  // ── CoW 去重：单次读取 buffer，计算 hash，查找可复用对象 ───────────────
  const fileBuffer = await uploadFile.arrayBuffer();
  const hash = await computeSha256Hex(fileBuffer);
  const dedupResult = await checkAndClaimDedup(db, hash, finalBucketId, userId);
  const finalR2Key = dedupResult.isDuplicate ? dedupResult.existingR2Key! : r2Key;

  if (!dedupResult.isDuplicate) {
    // 未命中去重：正常写入存储后端
    if (isTelegramBucket && effectiveBucketId) {
      const tgConfig = await resolveTgBucketConfig(db, effectiveBucketId, encKey);
      if (!tgConfig) {
        return c.json({ success: false, error: { code: 'TG_CONFIG_ERROR', message: '无法加载 Telegram 配置' } }, 500);
      }
      let tgFileId: string;
      let tgFileSize: number;
      try {
        if (needsChunking(fileBuffer.byteLength)) {
          // 大文件：分片上传（每块 ≤49MB）
          const chunked = await tgUploadChunked(tgConfig, fileBuffer, uploadFile.name, fileMime, db, effectiveBucketId);
          tgFileId = chunked.virtualFileId; // "chunked:{groupId}"
          tgFileSize = chunked.totalBytes;
        } else {
          // 小文件：直接上传
          const caption = `📁 ${uploadFile.name}\n🗂 OSSshelf | ${now.slice(0, 10)}`;
          const result = await tgUploadFile(tgConfig, fileBuffer, uploadFile.name, fileMime, caption);
          tgFileId = result.fileId;
          tgFileSize = result.fileSize;
        }
      } catch (e: any) {
        return c.json(
          { success: false, error: { code: 'TG_UPLOAD_FAILED', message: e?.message || 'Telegram 上传失败' } },
          502
        );
      }
      await db.insert(telegramFileRefs).values({
        id: crypto.randomUUID(),
        fileId,
        r2Key: finalR2Key,
        tgFileId,
        tgFileSize,
        bucketId: effectiveBucketId,
        createdAt: now,
      });
    } else if (bucketConfig) {
      await s3Put(bucketConfig, finalR2Key, fileBuffer, fileMime, {
        userId,
        originalName: uploadFile.name,
      });
    } else if (c.env.FILES) {
      await c.env.FILES.put(finalR2Key, fileBuffer, {
        httpMetadata: { contentType: fileMime },
        customMetadata: { userId, originalName: uploadFile.name },
      });
    } else {
      return c.json(
        {
          success: false,
          error: { code: 'NO_STORAGE', message: '未配置存储桶，请先在「存储桶管理」中添加至少一个存储桶' },
        },
        400
      );
    }
  } else if (isTelegramBucket && effectiveBucketId) {
    // 去重命中 Telegram：为新 fileId 创建指向同一 tgFileId 的引用记录
    const origRef = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.r2Key, finalR2Key)).get();
    if (!origRef) {
      // origRef 缺失说明去重状态不一致，报错而非静默跳过（避免创建无法下载的孤儿记录）
      return c.json(
        { success: false, error: { code: 'TG_REF_MISSING', message: 'Telegram 去重引用记录缺失，请重新上传' } },
        500
      );
    }
    await db.insert(telegramFileRefs).values({
      id: crypto.randomUUID(),
      fileId,
      r2Key: finalR2Key,
      tgFileId: origRef.tgFileId,
      tgFileSize: origRef.tgFileSize,
      bucketId: effectiveBucketId,
      createdAt: now,
    });
  }

  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name: uploadFile.name,
    path,
    type: 'file',
    size: uploadFile.size,
    r2Key: finalR2Key,
    mimeType: fileMime || null,
    hash,
    refCount: 1,
    isFolder: false,
    bucketId: finalBucketId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  await inheritParentPermissions(db, fileId, parentId);

  if (user) {
    await updateUserStorage(db, userId, uploadFile.size);
  }
  // bucket stats：去重命中时物理存储未增加（sizeDelta=0），fileCount 仍 +1
  const physicalSizeDelta = dedupResult.isDuplicate ? 0 : uploadFile.size;
  if (isTelegramBucket && effectiveBucketId) {
    await updateBucketStats(db, effectiveBucketId, physicalSizeDelta, 1);
  } else if (bucketConfig) {
    await updateBucketStats(db, bucketConfig.id, physicalSizeDelta, 1);
  }

  sendNotification(c, {
    userId,
    type: 'file_uploaded',
    title: '文件上传成功',
    body: `文件「${uploadFile.name}」已成功上传`,
    data: {
      fileId,
      fileName: uploadFile.name,
      size: uploadFile.size,
      mimeType: fileMime,
      bucketId: finalBucketId,
      deduped: dedupResult.isDuplicate,
    },
  });

  c.executionCtx.waitUntil(
    dispatchWebhook(c.env, userId, 'file.uploaded', {
      fileId,
      fileName: uploadFile.name,
      size: uploadFile.size,
      mimeType: fileMime,
      bucketId: finalBucketId,
    })
  );

  c.executionCtx.waitUntil(
    (async () => {
      try {
        if (isAIConfigured(c.env)) {
          await autoProcessFile(c.env, fileId);
        }
      } catch (error) {
        logger.error('FILES', '自动处理文件失败', { fileId }, error);
      }
    })()
  );

  return c.json({
    success: true,
    data: {
      id: fileId,
      name: uploadFile.name,
      size: uploadFile.size,
      mimeType: fileMime,
      path,
      bucketId: finalBucketId,
      deduped: dedupResult.isDuplicate,
      createdAt: now,
    },
  });
});

// ── List files ─────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const parentId = c.req.query('parentId') || null;
  const search = c.req.query('search') || '';
  const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'size'] as const;
  const sortByRaw = c.req.query('sortBy') || 'createdAt';
  const sortBy = ALLOWED_SORT_FIELDS.includes(sortByRaw as any) ? sortByRaw : 'createdAt';
  const sortOrder = c.req.query('sortOrder') || 'desc';
  const starred = c.req.query('starred') === 'true';

  // 标签筛选（逗号分隔或重复参数）
  const rawTags = c.req.query('tags');
  const tagNames = rawTags
    ? rawTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  // 分页参数（默认第1页，每页50条，最大100条）
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = (page - 1) * limit;
  const scope = c.req.query('scope'); // 'all' 表示搜索用户全部文件（不限目录层级）

  const db = getDb(c.env.DB);

  // 如果指定了 parentId，需要检查用户是否有权限访问该目录
  if (parentId) {
    const { hasAccess } = await checkFilePermission(db, parentId, userId, 'read', c.env);
    if (!hasAccess) {
      throwAppError('FILE_ACCESS_DENIED', '无权访问此目录');
    }
  }

  // 构建查询条件
  const conditions: Array<ReturnType<typeof isNull> | ReturnType<typeof eq>> = [isNull(files.deletedAt)];

  // 收藏文件筛选
  if (starred) {
    const starredFileIds = await db
      .select({ fileId: userStars.fileId })
      .from(userStars)
      .where(eq(userStars.userId, userId))
      .all();
    if (starredFileIds.length === 0) {
      return c.json({ success: true, data: { files: [], total: 0 } });
    }
    conditions.push(
      inArray(
        files.id,
        starredFileIds.map((s) => s.fileId)
      )
    );
  }

  // 标签筛选
  if (tagNames.length > 0) {
    const taggedFileIds = await db
      .select({ fileId: fileTags.fileId })
      .from(fileTags)
      .where(and(eq(fileTags.userId, userId), inArray(fileTags.name, tagNames)))
      .all();
    if (taggedFileIds.length === 0) {
      return c.json({
        success: true,
        data: { files: [], total: 0 },
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }
    conditions.push(
      inArray(
        files.id,
        taggedFileIds.map((t) => t.fileId)
      )
    );
  }

  if (parentId) {
    // 如果指定了 parentId，查询该目录下的文件
    // 用户需要有权限访问该目录（已在上面检查）
    conditions.push(eq(files.parentId, parentId));
  } else if (tagNames.length > 0) {
    // 标签筛选模式：只返回用户自己打标签的文件（tags 已限定 ID 范围）
    conditions.push(eq(files.userId, userId));
  } else if (!starred) {
    // 未指定 parentId 且无标签/收藏筛选，返回：
    // 1. 用户自己的根目录文件
    // 2. 被授权访问的文件（无论在哪个目录）

    // 获取用户所属的用户组
    const userGroups = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId))
      .all();
    const groupIds = userGroups.map((g) => g.groupId);

    // 查询用户直接获得授权的文件ID（排除自己的文件，避免重复）
    const userPermittedFiles = await db
      .select({ fileId: filePermissions.fileId, fileUserId: files.userId })
      .from(filePermissions)
      .innerJoin(files, eq(filePermissions.fileId, files.id))
      .where(
        and(
          eq(filePermissions.userId, userId),
          eq(filePermissions.subjectType, 'user'),
          sql`${files.userId} != ${userId}`
        )
      )
      .all();

    // 查询用户组获得授权的文件ID（排除自己的文件，避免重复）
    let groupPermittedFiles: { fileId: string }[] = [];
    if (groupIds.length > 0) {
      groupPermittedFiles = await db
        .select({ fileId: filePermissions.fileId })
        .from(filePermissions)
        .innerJoin(files, eq(filePermissions.fileId, files.id))
        .where(
          and(
            inArray(filePermissions.groupId, groupIds),
            eq(filePermissions.subjectType, 'group'),
            sql`${files.userId} != ${userId}`
          )
        )
        .all();
    }

    const permittedIds = new Set([
      ...userPermittedFiles.map((p) => p.fileId),
      ...groupPermittedFiles.map((p) => p.fileId),
    ]);

    // 根目录查询条件（或全局搜索模式）：
    // - 默认：用户自己的根目录文件 (userId = current AND parentId IS NULL)
    // - 或被授权访问的文件 (id IN permittedIds)
    // - scope=all 时：用户自己的全部文件 + 被授权访问的文件
    const ownershipCondition = or(
      and(eq(files.userId, userId), scope === 'all' ? sql`1=1` : isNull(files.parentId)),
      permittedIds.size > 0 ? inArray(files.id, Array.from(permittedIds)) : sql`0=1`
    );
    if (ownershipCondition) conditions.push(ownershipCondition);
  } else {
    // 收藏筛选时，只返回用户自己的收藏文件
    conditions.push(eq(files.userId, userId));
  }

  if (search) {
    // 转义 LIKE 特殊字符（% _ \），防止搜索词变成通配符
    const escapedSearch = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(like(files.name, `%${escapedSearch}%`));
  }

  // 查询总数（用于分页）
  const totalCountResult = await db
    .select({ count: count() })
    .from(files)
    .where(and(...conditions.filter(Boolean)))
    .get();
  const total = totalCountResult?.count ?? 0;

  // 使用 SQL 排序和分页，避免内存爆炸
  const orderColumn = (() => {
    switch (sortBy) {
      case 'updatedAt':
        return files.updatedAt;
      case 'name':
        return files.name;
      case 'size':
        return files.size;
      default:
        return files.createdAt;
    }
  })();
  const orderDir = sortOrder === 'asc' ? sql`ASC` : sql`DESC`;

  const items = await db
    .select()
    .from(files)
    .where(and(...conditions.filter(Boolean)))
    .orderBy(sql`${orderColumn} ${orderDir}`)
    .limit(limit)
    .offset(offset)
    .all();

  // 批量查询存储桶信息（避免 N+1）
  const bucketIds = [...new Set(items.map((f) => f.bucketId).filter(Boolean))] as string[];
  const bucketMap: Record<string, { id: string; name: string; provider: string }> = {};
  if (bucketIds.length > 0) {
    const bucketRows = await db
      .select({ id: storageBuckets.id, name: storageBuckets.name, provider: storageBuckets.provider })
      .from(storageBuckets)
      .where(inArray(storageBuckets.id, bucketIds))
      .all();
    for (const b of bucketRows) bucketMap[b.id] = b;
  }

  // 批量查询文件归属人信息（避免 N+1）
  const ownerIds = [...new Set(items.map((f) => f.userId).filter(Boolean))] as string[];
  const ownerMap: Record<string, { id: string; name: string | null; email: string }> = {};
  if (ownerIds.length > 0) {
    const ownerRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ownerIds))
      .all();
    for (const u of ownerRows) ownerMap[u.id] = u;
  }

  // 权限信息
  const permissionsMap: Record<string, { permission: string | null; isOwner: boolean }> = {};
  for (const file of items) {
    const isOwner = file.userId === userId;
    permissionsMap[file.id] = {
      permission: isOwner ? 'admin' : null,
      isOwner,
    };
  }

  const withBucket = items.map((f) => ({
    ...f,
    bucket: f.bucketId ? (bucketMap[f.bucketId] ?? null) : null,
    owner: ownerMap[f.userId] ?? null,
    accessPermission: permissionsMap[f.id]?.permission,
    isOwner: permissionsMap[f.id]?.isOwner,
  }));

  return c.json({
    success: true,
    data: withBucket,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── Batch folder size stats ──────────────────────────────────────────────
// POST /api/files/folders/size
// Body: { folderIds: string[] }
// 批量获取文件夹大小统计（避免前端 N+1 请求）
app.post('/folders/size', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const body = await c.req.json();

  const schema = z.object({
    folderIds: z.array(z.string().min(1)).max(50).default([]),
  });
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { folderIds } = result.data;

  if (folderIds.length === 0) {
    return c.json({ success: true, data: {} });
  }

  // 验证所有文件夹都属于当前用户且存在
  const folderRecords = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(inArray(files.id, folderIds), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt))
    )
    .all();

  const validFolderIds = folderRecords.map((f) => f.id);

  if (validFolderIds.length === 0) {
    return c.json({ success: true, data: {}, message: '未找到有效文件夹' });
  }

  // 批量计算文件夹大小
  const sizeStats = await calculateFoldersSize(db, validFolderIds, userId);

  // 转换为普通对象
  const data: Record<string, FolderSizeStats> = {};
  for (const [folderId, stats] of sizeStats) {
    data[folderId] = stats;
  }

  return c.json({
    success: true,
    data,
    requested: folderIds.length,
    found: validFolderIds.length,
  });
});

// ── Trash: list ────────────────────────────────────────────────────────────
app.get('/trash', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  // SQL 层面排序+分页，避免全量加载到内存
  const totalCountResult = await db
    .select({ count: count() })
    .from(files)
    .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
    .get();
  const total = totalCountResult?.count ?? 0;

  const items = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
    .orderBy(sql`${files.deletedAt} DESC`)
    .limit(limit)
    .offset(offset)
    .all();

  return c.json({ success: true, data: items, total, page, limit });
});

// ── Trash: restore ─────────────────────────────────────────────────────────
app.post('/trash/:id/restore', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');

  const result = await serviceRestoreFile(c.env, userId, fileId);
  if (!result.success) throwAppError('FILE_NOT_FOUND', result.error);

  return c.json({ success: true, data: { message: result.message } });
});

// ── Trash: permanent delete ────────────────────────────────────────────────
app.delete('/trash/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  let freedBytes = 0;

  if (file.isFolder) {
    const folderPath = file.path.endsWith('/') ? file.path.slice(0, -1) : file.path;
    const pathPrefix = folderPath + '/';
    const allFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
      .all();

    // 精确匹配：确保 pathPrefix 后面是 / 分隔的子路径，避免 /docs 误匹配 /docs-backup/
    const childFiles = allFiles.filter((f) => f.path && f.path.startsWith(pathPrefix));

    for (const child of childFiles) {
      if (!child.isFolder) {
        const { shouldDeleteStorage } = await releaseFileRef(db, child.id);
        if (shouldDeleteStorage) {
          await deleteFileFromStorage(c.env, db, userId, encKey, child);
        }
        freedBytes += child.size;
      }
      await db.delete(files).where(eq(files.id, child.id));
    }
  } else {
    const { shouldDeleteStorage } = await releaseFileRef(db, fileId);
    if (shouldDeleteStorage) {
      await deleteFileFromStorage(c.env, db, userId, encKey, file);
    }
    freedBytes = file.size;
  }

  await db.delete(files).where(eq(files.id, fileId));

  if (freedBytes > 0) {
    await updateUserStorage(db, userId, -freedBytes);
  }

  return c.json({ success: true, data: { message: '已永久删除' } });
});

// ── Trash: empty ───────────────────────────────────────────────────────────
app.delete('/trash', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const trashed = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
    .all();
  let freedBytes = 0;
  for (const file of trashed) {
    if (!file.isFolder) {
      // CoW 引用计数：仅最后一个引用归零时才删除存储对象
      const { shouldDeleteStorage } = await releaseFileRef(db, file.id);
      if (shouldDeleteStorage) {
        await deleteFileFromStorage(c.env, db, userId, encKey, file);
      }
      freedBytes += file.size;
    }
    await db.delete(files).where(eq(files.id, file.id));
  }
  if (freedBytes > 0) {
    await updateUserStorage(db, userId, -freedBytes);
  }
  return c.json({ success: true, data: { message: `已清空回收站，释放 ${trashed.length} 个文件` } });
});

// ── Create folder ──────────────────────────────────────────────────────────
app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createFolderSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );

  const { name, parentId, bucketId: requestedBucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const existing = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.name, name),
        parentId ? eq(files.parentId, parentId) : isNull(files.parentId),
        eq(files.isFolder, true),
        isNull(files.deletedAt)
      )
    )
    .get();
  if (existing) throwAppError('FOLDER_ALREADY_EXISTS', '同名文件夹已存在');

  let effectiveBucketId: string | null = null;
  if (requestedBucketId) {
    const bucketRow = await db
      .select()
      .from(storageBuckets)
      .where(
        and(
          eq(storageBuckets.id, requestedBucketId),
          eq(storageBuckets.userId, userId),
          eq(storageBuckets.isActive, true)
        )
      )
      .get();
    if (!bucketRow)
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '指定的存储桶不存在或未激活' } },
        400
      );
    effectiveBucketId = requestedBucketId;
  } else {
    const bucketConfig = await resolveBucketConfig(db, userId, encKey, null, parentId);
    effectiveBucketId = bucketConfig?.id ?? null;
  }

  const folderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const path = parentId ? `${parentId}/${name}` : `/${name}`;
  const newFolder = {
    id: folderId,
    userId,
    parentId: parentId || null,
    name,
    path,
    type: 'folder',
    size: 0,
    r2Key: `folders/${folderId}`,
    mimeType: null,
    hash: null,
    isFolder: true,
    bucketId: effectiveBucketId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.insert(files).values(newFolder);
  await inheritParentPermissions(db, folderId, parentId || null);

  let bucketInfo: { id: string; name: string; provider: string } | null = null;
  if (effectiveBucketId) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, effectiveBucketId)).get();
    if (b) bucketInfo = { id: b.id, name: b.name, provider: b.provider };
  }
  return c.json({ success: true, data: { ...newFolder, bucket: bucketInfo } });
});

// ── Create file (direct text content) ───────────────────────────────────────
app.post('/create', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createFileSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );

  const { name, content, parentId, bucketId: requestedBucketId, mimeType: providedMimeType } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const fileMime = inferMimeType(name, providedMimeType);

  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId, fileMime);
  if (!mimeCheck.allowed) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}`,
        },
      },
      400
    );
  }

  if (parentId) {
    const { hasAccess } = await checkFilePermission(db, parentId, userId, 'write', c.env);
    if (!hasAccess) {
      return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权向此目录创建文件' } }, 403);
    }
  }

  const existing = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.name, name),
        parentId ? eq(files.parentId, parentId) : isNull(files.parentId),
        eq(files.isFolder, false),
        isNull(files.deletedAt)
      )
    )
    .get();
  if (existing) throwAppError('FILE_ALREADY_EXISTS', '同名文件已存在');

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId, parentId);
  const effectiveBucketId = bucketConfig?.id ?? requestedBucketId ?? null;

  let isTelegramBucket = false;
  if (effectiveBucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, effectiveBucketId)).get();
    if (bkt?.provider === 'telegram') isTelegramBucket = true;
  }

  const fileBuffer = new TextEncoder().encode(content || '');
  const fileArrayBuffer = fileBuffer.buffer as ArrayBuffer;
  const fileSize = fileBuffer.byteLength;

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && user.storageQuota! < 999999 * 1024 ** 3 && user.storageUsed + fileSize > user.storageQuota!) {
    throwAppError('STORAGE_EXCEEDED', '用户存储配额已满');
  }
  if (bucketConfig) {
    const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
    if (quotaErr) throwAppError('STORAGE_EXCEEDED', quotaErr);
  }

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `files/${userId}/${fileId}/${name}`;
  const path = parentId ? `${parentId}/${name}` : `/${name}`;
  const hash = await computeSha256Hex(fileArrayBuffer);

  const dedupResult = await checkAndClaimDedup(db, hash, effectiveBucketId, userId);
  const finalR2Key = dedupResult.isDuplicate ? dedupResult.existingR2Key! : r2Key;

  if (!dedupResult.isDuplicate) {
    if (isTelegramBucket && effectiveBucketId) {
      const tgConfig = await resolveTgBucketConfig(db, effectiveBucketId, encKey);
      if (!tgConfig) {
        return c.json({ success: false, error: { code: 'TG_CONFIG_ERROR', message: '无法加载 Telegram 配置' } }, 500);
      }
      let tgFileId: string;
      let tgFileSize: number;
      try {
        const caption = `📁 ${name}\n🗂 OSSshelf | ${now.slice(0, 10)}`;
        const result = await tgUploadFile(tgConfig, fileArrayBuffer, name, fileMime, caption);
        tgFileId = result.fileId;
        tgFileSize = result.fileSize;
      } catch (e: any) {
        return c.json(
          { success: false, error: { code: 'TG_UPLOAD_FAILED', message: e?.message || 'Telegram 上传失败' } },
          502
        );
      }
      await db.insert(telegramFileRefs).values({
        id: crypto.randomUUID(),
        fileId,
        r2Key: finalR2Key,
        tgFileId,
        tgFileSize,
        bucketId: effectiveBucketId,
        createdAt: now,
      });
    } else if (bucketConfig) {
      await s3Put(bucketConfig, finalR2Key, fileBuffer, fileMime, {
        userId,
        originalName: name,
      });
    } else if (c.env.FILES) {
      await c.env.FILES.put(finalR2Key, fileArrayBuffer, {
        httpMetadata: { contentType: fileMime },
        customMetadata: { userId, originalName: name },
      });
    } else {
      return c.json(
        {
          success: false,
          error: { code: 'NO_STORAGE', message: '未配置存储桶，请先在「存储桶管理」中添加至少一个存储桶' },
        },
        400
      );
    }
  } else if (isTelegramBucket && effectiveBucketId) {
    const origRef = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.r2Key, finalR2Key)).get();
    if (!origRef) {
      return c.json(
        { success: false, error: { code: 'TG_REF_MISSING', message: 'Telegram 去重引用记录缺失，请重新上传' } },
        500
      );
    }
    await db.insert(telegramFileRefs).values({
      id: crypto.randomUUID(),
      fileId,
      r2Key: finalR2Key,
      tgFileId: origRef.tgFileId,
      tgFileSize: origRef.tgFileSize,
      bucketId: effectiveBucketId,
      createdAt: now,
    });
  }

  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name,
    path,
    type: 'file',
    size: fileSize,
    r2Key: finalR2Key,
    mimeType: fileMime || null,
    hash,
    refCount: 1,
    isFolder: false,
    bucketId: effectiveBucketId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  await inheritParentPermissions(db, fileId, parentId || null);

  if (user) {
    await updateUserStorage(db, userId, fileSize);
  }

  const physicalSizeDelta = dedupResult.isDuplicate ? 0 : fileSize;
  if (isTelegramBucket && effectiveBucketId) {
    await updateBucketStats(db, effectiveBucketId, physicalSizeDelta, 1);
  } else if (bucketConfig) {
    await updateBucketStats(db, bucketConfig.id, physicalSizeDelta, 1);
  }

  let bucketInfo: { id: string; name: string; provider: string } | null = null;
  if (effectiveBucketId) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, effectiveBucketId)).get();
    if (b) bucketInfo = { id: b.id, name: b.name, provider: b.provider };
  }

  c.executionCtx.waitUntil(
    (async () => {
      try {
        if (isAIConfigured(c.env)) {
          await autoProcessFile(c.env, fileId);
        }
      } catch (error) {
        logger.error('FILES', '自动处理文件失败', { fileId }, error);
      }
    })()
  );

  return c.json({
    success: true,
    data: {
      id: fileId,
      name,
      size: fileSize,
      mimeType: fileMime,
      path,
      bucketId: effectiveBucketId,
      bucket: bucketInfo,
      deduped: dedupResult.isDuplicate,
      createdAt: now,
    },
  });
});

// ── Get single file ────────────────────────────────────────────────────────
app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  // 使用权限检查函数，允许被授权的用户访问
  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  let bucketInfo: { id: string; name: string; provider: string } | null = null;
  if (file.bucketId) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (b) bucketInfo = { id: b.id, name: b.name, provider: b.provider };
  }

  // 获取归属人信息
  let ownerInfo = null;
  if (!isOwner && file.userId) {
    const owner = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, file.userId))
      .get();
    if (owner) ownerInfo = owner;
  }

  return c.json({ success: true, data: { ...file, bucket: bucketInfo, owner: ownerInfo, isOwner } });
});

// ── File Detail (完整详情) - Phase 4 ──────────────────────────────────────
app.get('/:id/detail', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  // 权限检查
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  // 获取桶名称
  let bucketName: string | null = null;
  if (file.bucketId) {
    const b = await db
      .select({ name: storageBuckets.name })
      .from(storageBuckets)
      .where(eq(storageBuckets.id, file.bucketId))
      .get();
    if (b) bucketName = b.name;
  }

  // 解析 AI 标签
  let aiTagsArray: string[] = [];
  try {
    aiTagsArray = file.aiTags ? JSON.parse(file.aiTags as string) : [];
  } catch (e) {
    aiTagsArray = [];
  }

  // 活跃分享数
  const activeShareCountResult = await db
    .select({ count: count() })
    .from(shares)
    .where(and(eq(shares.fileId, fileId), or(isNull(shares.expiresAt), gt(shares.expiresAt, new Date().toISOString()))))
    .get();

  const activeShareCount = activeShareCountResult?.count ?? 0;

  // 文件夹专属信息（WITH RECURSIVE）
  let folderStats = null;
  if (file.isFolder) {
    // 直接子文件数和文件夹数
    const childFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.parentId, fileId), isNull(files.deletedAt), eq(files.isFolder, false)))
      .all();

    const childFolders = await db
      .select()
      .from(files)
      .where(and(eq(files.parentId, fileId), isNull(files.deletedAt), eq(files.isFolder, true)))
      .all();

    // WITH RECURSIVE 递归统计所有子文件
    let totalFileCount = childFiles.length;
    let totalSize = childFiles.reduce((sum, f) => sum + Number(f.size || 0), 0);
    try {
      const recursiveResult = await db.run(sql`
        WITH RECURSIVE file_tree AS (
          SELECT id, isFolder, size, parentId
          FROM files
          WHERE id = ${fileId} AND deletedAt IS NULL AND userId = ${userId}
          UNION ALL
          SELECT f.id, f.isFolder, f.size, f.parentId
          FROM files f
          INNER JOIN file_tree ft ON f.parentId = ft.id
          WHERE f.deletedAt IS NULL AND f.userId = ${userId}
        )
        SELECT COUNT(*) as totalFileCount, COALESCE(SUM(size), 0) as totalSize
        FROM file_tree WHERE isFolder = 0
      `);

      const recursiveStats = recursiveResult as unknown as Array<{ totalFileCount: number; totalSize: number }>;
      if (recursiveStats && recursiveStats.length > 0) {
        totalFileCount = recursiveStats[0].totalFileCount ?? totalFileCount;
        totalSize = recursiveStats[0].totalSize ?? totalSize;
      }
    } catch (e) {
      // WITH RECURSIVE 可能失败，使用直接子文件统计作为降级
    }

    folderStats = {
      childFileCount: childFiles.length,
      childFolderCount: childFolders.length,
      totalFileCount,
      totalSize,
    };
  }

  return c.json({
    success: true,
    data: {
      // 基础信息
      id: file.id,
      name: file.name,
      path: file.path || '',
      size: Number(file.size),
      mimeType: file.mimeType,
      isFolder: file.isFolder,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      description: file.description,

      // 存储信息
      bucketId: file.bucketId,
      bucketName,
      r2Key: file.r2Key,

      // 版本信息
      currentVersion: file.currentVersion ?? 1,
      maxVersions: file.maxVersions ?? 10,
      versionRetentionDays: file.versionRetentionDays ?? 30,

      // AI 信息
      aiSummary: file.aiSummary,
      aiTags: aiTagsArray,
      vectorIndexedAt: file.vectorIndexedAt,
      aiSummaryAt: file.aiSummaryAt,
      aiTagsAt: file.aiTagsAt,

      // 分享状态
      activeShareCount,

      // 文件夹专属
      ...folderStats,
    },
  });
});

// ── File access logs ───────────────────────────────────────────────────
// GET /:id/logs?limit=50&action=download
// 获取文件的访问日志（谁在什么时候访问/下载/修改了这个文件）
app.get('/:id/logs', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  // 分页和筛选参数
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));
  const action = c.req.query('action'); // 可选：过滤特定操作类型

  // 权限检查
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权查看此文件日志');
  }

  // 查询文件是否存在
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  // 构建查询条件
  const conditions = [eq(auditLogs.resourceId, fileId), eq(auditLogs.resourceType, 'file')];

  if (action) {
    conditions.push(eq(auditLogs.action, action));
  }

  // 查询总数
  const totalCountResult = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(and(...conditions))
    .get();
  const total = totalCountResult?.count ?? 0;

  // 查询日志（按时间倒序）
  const logs = await db
    .select({
      id: auditLogs.id,
      userId: auditLogs.userId,
      action: auditLogs.action,
      ipAddress: auditLogs.ipAddress,
      userAgent: auditLogs.userAgent,
      status: auditLogs.status,
      errorMessage: auditLogs.errorMessage,
      details: auditLogs.details,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(sql`${auditLogs.createdAt} DESC`)
    .limit(limit)
    .offset(offset)
    .all();

  // 批量查询用户信息
  const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
  const userMap: Record<string, { name: string | null; email: string }> = {};
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds))
      .all();
    for (const u of userRows) userMap[u.id] = { name: u.name, email: u.email };
  }

  // 统计各操作类型的数量
  const actionStatsResult = await db.run(sql`
    SELECT action, COUNT(*) as count
    FROM audit_logs
    WHERE resource_id = ${fileId} AND resource_type = 'file'
    GROUP BY action
    ORDER BY count DESC
  `);
  const actionStats = (actionStatsResult?.results as Array<{ action: string; count: number }>) || [];

  return c.json({
    success: true,
    data: {
      fileId,
      fileName: file.name,
      logs: logs.map((log) => ({
        ...log,
        user: log.userId ? (userMap[log.userId] ?? null) : null,
      })),
      stats: actionStats,
      pagination: {
        limit,
        offset,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

// ── Update (rename / move) ───────────────────────────────────────────────
app.put('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const body = await c.req.json();
  const result = updateFileSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );

  const { name, parentId } = result.data;

  if (name) {
    const renameResult = await serviceRenameFile(c.env, userId, fileId, { name });
    if (!renameResult.success) {
      throwAppError('FILE_NOT_FOUND', renameResult.error);
    }
  }

  if (parentId !== undefined) {
    const moveResult = await serviceMoveFile(c.env, userId, fileId, { targetParentId: parentId });
    if (!moveResult.success) {
      const errorMap: Record<string, string> = {
        目标位置已存在同名文件: 'FILE_NAME_CONFLICT',
        不能将文件夹移动到自身或其子文件夹中: 'CANNOT_MOVE_TO_SUBFOLDER',
        无权向目标目录移动文件: 'FORBIDDEN',
      };
      const errorCode = errorMap[moveResult.error] ?? 'VALIDATION_ERROR';
      return c.json(
        {
          success: false,
          error: { code: ERROR_CODES[errorCode as keyof typeof ERROR_CODES] || errorCode, message: moveResult.error },
        },
        errorCode === 'FORBIDDEN' ? 403 : errorCode === 'FILE_NAME_CONFLICT' ? 409 : 400
      );
    }
  }

  return c.json({ success: true, data: { message: '更新成功' } });
});

// ── Get file raw content (for editing) ─────────────────────────────────────
app.get('/:id/raw', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '无法获取文件夹内容');

  if (!isEditableFile(file.mimeType, file.name)) {
    return c.json(
      {
        success: false,
        error: { code: 'FILE_NOT_EDITABLE', message: '此文件类型不支持在线编辑' },
      },
      400
    );
  }

  const maxEditableSize = MAX_EDITABLE_SIZE;
  if (file.size > maxEditableSize) {
    return c.json(
      {
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: '文件过大，不支持在线编辑（最大 1MB）' },
      },
      400
    );
  }

  const encKey = getEncryptionKey(c.env);
  const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);

  let content: string;

  if (bucketConfig) {
    const response = await s3Get(bucketConfig, file.r2Key);
    const buffer = await response.arrayBuffer();
    content = new TextDecoder('utf-8').decode(buffer);
  } else if (c.env.FILES) {
    const obj = await c.env.FILES.get(file.r2Key);
    if (!obj) throwAppError('FILE_CONTENT_NOT_FOUND');
    content = await obj.text();
  } else {
    throwAppError('NO_STORAGE_CONFIGURED', '存储桶未配置');
  }

  return c.json({
    success: true,
    data: {
      content,
      mimeType: file.mimeType,
      size: file.size,
      name: file.name,
    },
  });
});

// ── Update file content (with version snapshot) ─────────────────────────────
const updateContentSchema = z.object({
  content: z.string(),
  changeSummary: z.string().max(500).optional(),
});

app.put('/:id/content', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const body = await c.req.json();
  const result = updateContentSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { content, changeSummary } = result.data;
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write', c.env);
  if (!hasAccess) {
    throwAppError('FILE_WRITE_DENIED', '无权修改此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '无法修改文件夹内容');

  if (!isEditableFile(file.mimeType, file.name)) {
    return c.json(
      {
        success: false,
        error: { code: 'FILE_NOT_EDITABLE', message: '此文件类型不支持在线编辑' },
      },
      400
    );
  }

  const contentBuffer = new TextEncoder().encode(content);
  const contentArrayBuffer = contentBuffer.buffer as ArrayBuffer;
  const newSize = contentBuffer.byteLength;

  const maxEditableSize = MAX_EDITABLE_SIZE;
  if (newSize > maxEditableSize) {
    return c.json(
      {
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: '内容过大，不支持在线编辑（最大 1MB）' },
      },
      400
    );
  }

  const newHash = await computeSha256Hex(contentArrayBuffer);
  const encKey = getEncryptionKey(c.env);

  const needsVersion = await shouldCreateVersion(db, fileId, newHash);
  if (needsVersion && file.hash) {
    await createVersionSnapshot(db, c.env, file, {
      changeSummary: changeSummary ?? '内容更新',
      createdBy: userId,
    });
  }

  const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);

  const currentVersion = file.currentVersion ?? 1;
  const newR2Key = `files/${file.userId}/${fileId}/v${currentVersion + 1}_${file.name}`;

  if (bucketConfig) {
    await s3Put(bucketConfig, newR2Key, contentArrayBuffer, file.mimeType || 'text/plain', {
      userId,
      originalName: file.name,
    });
  } else if (c.env.FILES) {
    await c.env.FILES.put(newR2Key, contentArrayBuffer, {
      httpMetadata: { contentType: file.mimeType || 'text/plain' },
      customMetadata: { userId, originalName: file.name },
    });
  } else {
    throwAppError('NO_STORAGE_CONFIGURED', '存储桶未配置');
  }

  const sizeDelta = newSize - file.size;
  const now = new Date().toISOString();

  await db
    .update(files)
    .set({
      r2Key: newR2Key,
      size: newSize,
      hash: newHash,
      currentVersion: currentVersion + 1,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  if (sizeDelta !== 0) {
    await updateUserStorage(db, file.userId, sizeDelta);
    if (bucketConfig) {
      await updateBucketStats(db, bucketConfig.id, sizeDelta, 0);
    }
  }

  c.executionCtx.waitUntil(
    dispatchWebhook(c.env, userId, 'file.updated', {
      fileId,
      fileName: file.name,
      size: newSize,
    })
  );

  // 内容变更后重新触发 AI 摘要 + 向量索引
  c.executionCtx.waitUntil(
    enqueueAutoProcessFile(c.env, fileId, userId).catch((err) =>
      logger.error('FILES', '内容更新后AI处理失败', { fileId }, err)
    )
  );

  return c.json({
    success: true,
    data: {
      message: '文件内容已更新',
      size: newSize,
      hash: newHash,
      versionCreated: needsVersion,
    },
  });
});

// ── Update folder settings (upload type control) ───────────────────────────
app.put('/:id/settings', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const body = await c.req.json();
  const result = updateFolderSettingsSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );

  const db = getDb(c.env.DB);
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (!file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '只有文件夹可以设置上传类型限制');

  const { allowedMimeTypes } = result.data;
  const now = new Date().toISOString();

  await db
    .update(files)
    .set({
      allowedMimeTypes: allowedMimeTypes ? JSON.stringify(allowedMimeTypes) : null,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  return c.json({
    success: true,
    data: {
      message: '设置已更新',
      allowedMimeTypes: allowedMimeTypes || null,
    },
  });
});

// ── Move ───────────────────────────────────────────────────────────────────
app.post('/:id/move', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const body = await c.req.json();
  const result = moveFileSchema.safeParse(body);
  if (!result.success)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );

  const { targetParentId } = result.data;
  const moveResult = await serviceMoveFile(c.env, userId, fileId, { targetParentId });

  if (!moveResult.success) {
    // ── 跨桶移动特殊处理 ──────────────────────────────────────
    if (moveResult.error === 'CROSS_BUCKET') {
      return c.json(
        {
          success: false,
          error: {
            code: 'CROSS_BUCKET',
            message: '目标文件夹位于不同存储桶，需要迁移文件内容',
            sourceBucketId: moveResult.sourceBucketId,
            targetBucketId: moveResult.targetBucketId,
          },
        },
        409
      );
    }
    // ─────────────────────────────────────────────────────────

    const errorMap: Record<string, string> = {
      文件不存在或无权访问: 'FILE_NOT_FOUND',
      目标位置已存在同名文件: 'FILE_NAME_CONFLICT',
      不能将文件夹移动到自身或其子文件夹中: 'CANNOT_MOVE_TO_SUBFOLDER',
      无权向目标目录移动文件: 'FORBIDDEN',
    };
    const errorCode = errorMap[moveResult.error] ?? 'VALIDATION_ERROR';
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES[errorCode as keyof typeof ERROR_CODES] || errorCode, message: moveResult.error },
      },
      errorCode === 'FORBIDDEN' ? 403 : errorCode === 'FILE_NAME_CONFLICT' ? 409 : 400
    );
  }

  return c.json({ success: true, data: { message: '移动成功' } });
});

// ── Soft delete ────────────────────────────────────────────────────────────
app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'admin', c.env);
  if (!hasAccess) {
    throwAppError('FILE_DELETE_DENIED', '无权删除此文件');
  }

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  const result = await serviceSoftDeleteFile(c.env, userId, fileId);
  if (!result.success) throwAppError('FILE_NOT_FOUND', result.error);

  // 团队活动记录：文件/文件夹删除
  if (file.teamId) {
    c.executionCtx.waitUntil(
      recordActivityWithEnv(c.env, {
        teamId: file.teamId,
        userId,
        action: 'file_deleted',
        resourceType: 'file',
        resourceId: fileId,
        details: { fileName: file.name, isFolder: file.isFolder },
      }).catch(() => {})
    );
  }

  sendNotification(c, {
    userId,
    type: file.isFolder ? 'folder_deleted' : 'file_deleted',
    title: file.isFolder ? '文件夹已删除' : '文件已删除',
    body: `${file.isFolder ? '文件夹' : '文件'}「${file.name}」已移入回收站`,
    data: {
      fileId,
      fileName: file.name,
      isFolder: file.isFolder,
    },
  });

  c.executionCtx.waitUntil(
    dispatchWebhook(c.env, userId, 'file.deleted', {
      fileId,
      fileName: file.name,
      isFolder: file.isFolder,
    })
  );

  return c.json({ success: true, data: { message: result.message } });
});

// ── Shared helper ──────────────────────────────────────────────────────────
/**
 * 从对象存储中物理删除文件，并更新 bucket 统计。
 * 此函数只应在 CoW ref_count 已归零时调用（由 releaseFileRef 判断）。
 * 注意：不更新用户 storageUsed，由调用方统一处理。
 * 同时清理关联的 file_versions 记录（版本 r2Key 去重 + 物理删除）。
 */
async function deleteFileFromStorage(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  encKey: string,
  file: typeof files.$inferSelect
) {
  // ── 收集所有版本的 r2Key（排除与主文件相同的）
  const versions = await db
    .select({ r2Key: fileVersions.r2Key })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, file.id))
    .all();

  // 收集所有需要删除的版本 r2Key（去重后）
  const versionKeysToDelete = new Set(versions.filter((v) => v.r2Key !== file.r2Key).map((v) => v.r2Key));

  // ── Telegram 桶：清理 DB 引用（物理文件在 Telegram 服务器，无法强制删除）
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.r2Key, file.r2Key)).get();
      if (ref && isChunkedFileId(ref.tgFileId)) {
        await tgDeleteChunked(db, ref.tgFileId);
      }
      await db.delete(telegramFileRefs).where(eq(telegramFileRefs.r2Key, file.r2Key));
      for (const vKey of versionKeysToDelete) {
        const vRef = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.r2Key, vKey)).get();
        if (vRef) {
          if (isChunkedFileId(vRef.tgFileId)) {
            await tgDeleteChunked(db, vRef.tgFileId).catch((error) => {
              logger.error('FILES', 'Telegram分片删除失败', { tgFileId: vRef.tgFileId }, error);
            });
          }
          await db.delete(telegramFileRefs).where(eq(telegramFileRefs.r2Key, vKey));
        }
      }
      // 删除所有版本记录
      await db.delete(fileVersions).where(eq(fileVersions.fileId, file.id));
      await updateBucketStats(db, file.bucketId, -file.size, -1);
      return;
    }
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (bucketConfig) {
    // 删除主文件
    try {
      await s3Delete(bucketConfig, file.r2Key);
    } catch (error) {
      logger.error('FILES', 'S3删除失败', { r2Key: file.r2Key }, error);
    }
    // 删除所有版本存储对象
    for (const vKey of versionKeysToDelete) {
      await s3Delete(bucketConfig, vKey).catch((error) => logger.error('FILES', 'S3版本删除失败', { vKey }, error));
    }
    await updateBucketStats(db, bucketConfig.id, -file.size, -1);
  } else if (env.FILES) {
    // 删除主文件
    await env.FILES.delete(file.r2Key);
    // 删除所有版本存储对象
    for (const vKey of versionKeysToDelete) {
      await env.FILES.delete(vKey).catch((error) => {
        logger.error('FILES', 'R2版本删除失败', { vKey }, error);
      });
    }
  }

  // 删除所有版本记录
  await db.delete(fileVersions).where(eq(fileVersions.fileId, file.id));
}

// ── Star/Unstar file ───────────────────────────────────────────────────────
app.post('/:id/star', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  await serviceToggleStar(c.env, userId, fileId, true);

  sendNotification(c, {
    userId,
    type: 'file_starred',
    title: '文件已收藏',
    body: `您已收藏${file.isFolder ? '文件夹' : '文件'}「${file.name}」`,
    data: { fileId, fileName: file.name, isFolder: file.isFolder },
  });

  return c.json({ success: true, data: { message: '已收藏', isStarred: true } });
});

// ── 更改文件夹存储桶（级联子文件夹）────────────────────────────────────────
app.put('/:id/bucket', async (c) => {
  const userId = c.get('userId')!;
  const folderId = c.req.param('id');
  const db = getDb(c.env.DB);
  const body = await c.req.json();

  const targetBucketId = body?.bucketId as string | undefined;
  if (!targetBucketId) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: '缺少 targetBucketId' } }, 400);
  }

  // 验证文件夹存在且是文件夹
  const folder = await db
    .select()
    .from(files)
    .where(and(eq(files.id, folderId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt)))
    .get();
  if (!folder) {
    throwAppError('FILE_NOT_FOUND', '文件夹不存在');
  }
  if (folder.bucketId === targetBucketId) {
    return c.json({ success: true, data: { message: '已是目标存储桶，无需更改', updatedCount: 0 } });
  }

  // 验证目标桶存在
  const targetBucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, targetBucketId), eq(storageBuckets.userId, userId)))
    .get();
  if (!targetBucket) {
    return c.json({ success: false, error: { code: 'BUCKET_NOT_FOUND', message: '目标存储桶不存在' } }, 404);
  }

  const now = new Date().toISOString();
  let updatedCount = 0;

  // 递归收集所有子文件夹 ID（含自身）
  async function collectSubfolderIds(parentId: string): Promise<string[]> {
    const collected = [parentId];
    const children = await db
      .select({ id: files.id })
      .from(files)
      .where(
        and(eq(files.parentId, parentId), eq(files.isFolder, true), eq(files.userId, userId), isNull(files.deletedAt))
      )
      .all();
    for (const child of children) {
      collected.push(...(await collectSubfolderIds(child.id)));
    }
    return collected;
  }

  const allFolderIds = await collectSubfolderIds(folderId);

  // 批量更新所有子文件夹的 bucketId
  for (const fid of allFolderIds) {
    await db.update(files).set({ bucketId: targetBucketId, updatedAt: now }).where(eq(files.id, fid));
    updatedCount++;
  }

  createAuditLog({
    env: c.env,
    userId,
    action: 'file.update',
    resourceType: 'folder',
    details: {
      action: 'change_bucket',
      folderId,
      oldBucketId: folder.bucketId,
      newBucketId: targetBucketId,
      updatedFolderCount: updatedCount,
    },
    ipAddress: getClientIp(c),
    userAgent: getUserAgent(c),
  });

  return c.json({
    success: true,
    data: { message: `已将 ${updatedCount} 个文件夹的存储桶更改为 ${targetBucket.name}`, updatedCount },
  });
});

app.delete('/:id/star', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  await serviceToggleStar(c.env, userId, fileId, false);

  sendNotification(c, {
    userId,
    type: 'file_unstarred',
    title: '已取消收藏',
    body: `您已取消收藏${file.isFolder ? '文件夹' : '文件'}「${file.name}」`,
    data: { fileId, fileName: file.name, isFolder: file.isFolder },
  });

  return c.json({ success: true, data: { message: '已取消收藏', isStarred: false } });
});

export default app;
