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
import { eq, and, isNull, isNotNull, like, or, inArray, sql } from 'drizzle-orm';
import {
  getDb,
  files,
  users,
  storageBuckets,
  filePermissions,
  telegramFileRefs,
  fileVersions,
  groupMembers,
} from '../db';
import { checkFilePermission } from './permissions';
import { inheritParentPermissions } from './permissions';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import { ERROR_CODES, MAX_FILE_SIZE, isPreviewableMimeType, inferMimeType } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { s3Put, s3Get, s3Delete, decryptSecret } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, updateUserStorage, checkBucketQuota } from '../lib/bucketResolver';
import { checkFolderMimeTypeRestriction } from '../lib/folderPolicy';
import { getEncryptionKey } from '../lib/crypto';
import {
  tgUploadFile,
  tgDownloadFile,
  TG_MAX_FILE_SIZE,
  TG_CHUNKED_THRESHOLD,
  TG_MAX_CHUNKED_FILE_SIZE,
  type TelegramBotConfig,
} from '../lib/telegramClient';
import {
  needsChunking,
  tgUploadChunked,
  tgDownloadChunked,
  tgDeleteChunked,
  isChunkedFileId,
} from '../lib/telegramChunked';
import { checkAndClaimDedup, releaseFileRef, computeSha256Hex } from '../lib/dedup';
import { createVersionSnapshot, shouldCreateVersion } from '../lib/versionManager';
import { autoProcessFile, isAIConfigured } from '../lib/aiFeatures';

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
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId!), isNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder) throwAppError('FOLDER_VERSION_NOT_SUPPORTED', '无法预览文件夹');
  if (!isPreviewableMimeType(file.mimeType, file.name)) throwAppError('FILE_PREVIEW_NOT_SUPPORTED');
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
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
    return new Response(s3Res.body, { headers: dlHeaders });
  }
  if (c.env.FILES) {
    const obj = await c.env.FILES.get(file.r2Key);
    if (!obj) throwAppError('FILE_CONTENT_NOT_FOUND');
    return new Response(obj.body, { headers: dlHeaders });
  }
  throwAppError('NO_STORAGE_CONFIGURED', '存储桶未配置');
});

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
  if (user && user.storageUsed + uploadFile.size > user.storageQuota) {
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
  const sortBy = (c.req.query('sortBy') || 'createdAt') as keyof typeof files.$inferSelect;
  const sortOrder = c.req.query('sortOrder') || 'desc';

  const db = getDb(c.env.DB);

  // 如果指定了 parentId，需要检查用户是否有权限访问该目录
  if (parentId) {
    const { hasAccess } = await checkFilePermission(db, parentId, userId, 'read', c.env);
    if (!hasAccess) {
      throwAppError('FILE_ACCESS_DENIED', '无权访问此目录');
    }
  }

  // 构建查询条件
  const conditions: any[] = [isNull(files.deletedAt)];

  if (parentId) {
    // 如果指定了 parentId，查询该目录下的文件
    // 用户需要有权限访问该目录（已在上面检查）
    conditions.push(eq(files.parentId, parentId));
  } else {
    // 未指定 parentId，返回：
    // 1. 用户自己的根目录文件
    // 2. 被授权访问的文件（无论在哪个目录）

    // 获取用户所属的用户组
    const userGroups = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId))
      .all();
    const groupIds = userGroups.map((g) => g.groupId);

    // 查询用户直接获得授权的文件ID
    const userPermittedFiles = await db
      .select({ fileId: filePermissions.fileId })
      .from(filePermissions)
      .where(and(eq(filePermissions.userId, userId), eq(filePermissions.subjectType, 'user')))
      .all();

    // 查询用户组获得授权的文件ID
    let groupPermittedFiles: { fileId: string }[] = [];
    if (groupIds.length > 0) {
      groupPermittedFiles = await db
        .select({ fileId: filePermissions.fileId })
        .from(filePermissions)
        .where(and(inArray(filePermissions.groupId, groupIds), eq(filePermissions.subjectType, 'group')))
        .all();
    }

    const permittedIds = new Set([
      ...userPermittedFiles.map((p) => p.fileId),
      ...groupPermittedFiles.map((p) => p.fileId),
    ]);

    // 根目录查询条件：
    // - 用户自己的根目录文件 (userId = current AND parentId IS NULL)
    // - 或被授权访问的文件 (id IN permittedIds)
    const ownershipCondition = or(
      and(eq(files.userId, userId), isNull(files.parentId)),
      permittedIds.size > 0 ? inArray(files.id, Array.from(permittedIds)) : undefined
    );
    conditions.push(ownershipCondition);
  }

  if (search) conditions.push(like(files.name, `%${search}%`));

  const items = await db
    .select()
    .from(files)
    .where(and(...conditions.filter(Boolean)))
    .all();
  const sorted = [...items].sort((a, b) => {
    const aVal = a[sortBy] ?? '';
    const bVal = b[sortBy] ?? '';
    if (sortOrder === 'asc') return aVal > bVal ? 1 : -1;
    return aVal < bVal ? 1 : -1;
  });

  // 批量查询存储桶信息（避免 N+1）
  const bucketIds = [...new Set(sorted.map((f) => f.bucketId).filter(Boolean))] as string[];
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
  const ownerIds = [...new Set(sorted.map((f) => f.userId).filter(Boolean))] as string[];
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
  for (const file of sorted) {
    const isOwner = file.userId === userId;
    permissionsMap[file.id] = {
      permission: isOwner ? 'admin' : null,
      isOwner,
    };
  }

  const withBucket = sorted.map((f) => ({
    ...f,
    bucket: f.bucketId ? (bucketMap[f.bucketId] ?? null) : null,
    owner: ownerMap[f.userId] ?? null,
    accessPermission: permissionsMap[f.id]?.permission,
    isOwner: permissionsMap[f.id]?.isOwner,
  }));
  return c.json({ success: true, data: withBucket });
});

// ── Trash: list ────────────────────────────────────────────────────────────
app.get('/trash', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const items = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNotNull(files.deletedAt)))
    .all();
  const sorted = [...items].sort((a, b) => ((b.deletedAt ?? '') > (a.deletedAt ?? '') ? 1 : -1));
  return c.json({ success: true, data: sorted });
});

// ── Trash: restore ─────────────────────────────────────────────────────────
app.post('/trash/:id/restore', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND', '文件不存在或未被删除');

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

  return c.json({ success: true, data: { message: '已恢复' } });
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
  if (user && user.storageUsed + fileSize > user.storageQuota) {
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
        if (await isAIConfigured(c.env)) {
          await autoProcessFile(c.env, fileId);
        }
      } catch (error) {
        console.error('Failed to auto process file:', error);
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

// ── Update ─────────────────────────────────────────────────────────────────
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
  const db = getDb(c.env.DB);

  // 使用权限检查函数，需要 write 权限
  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'write', c.env);
  if (!hasAccess) {
    throwAppError('FILE_WRITE_DENIED', '无权修改此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  // 非所有者只能修改名称，不能移动位置
  const { name, parentId } = result.data;
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (name) {
    updateData.name = name;
    updateData.path =
      parentId !== undefined
        ? parentId
          ? `${parentId}/${name}`
          : `/${name}`
        : file.parentId
          ? `${file.parentId}/${name}`
          : `/${name}`;
  }

  // 只有所有者可以移动文件位置
  if (parentId !== undefined && isOwner) {
    updateData.parentId = parentId || null;
    const n = (name as string | undefined) || file.name;
    updateData.path = parentId ? `${parentId}/${n}` : `/${n}`;
  }

  await db.update(files).set(updateData).where(eq(files.id, fileId));
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

  const isEditableMimeType = (mimeType: string | null): boolean => {
    if (!mimeType) return false;
    const editableTypes = [
      'text/',
      'application/json',
      'application/xml',
      'application/javascript',
      'application/x-yaml',
      'application/yaml',
    ];
    return editableTypes.some((t) => mimeType.startsWith(t) || mimeType === t);
  };

  if (!isEditableMimeType(file.mimeType)) {
    return c.json(
      {
        success: false,
        error: { code: 'FILE_NOT_EDITABLE', message: '此文件类型不支持在线编辑' },
      },
      400
    );
  }

  const maxEditableSize = 1024 * 1024;
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

  const isEditableMimeType = (mimeType: string | null): boolean => {
    if (!mimeType) return false;
    const editableTypes = [
      'text/',
      'application/json',
      'application/xml',
      'application/javascript',
      'application/x-yaml',
      'application/yaml',
    ];
    return editableTypes.some((t) => mimeType.startsWith(t) || mimeType === t);
  };

  if (!isEditableMimeType(file.mimeType)) {
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

  const maxEditableSize = 1024 * 1024;
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
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  if (sizeDelta !== 0) {
    await updateUserStorage(db, file.userId, sizeDelta);
    if (bucketConfig) {
      await updateBucketStats(db, bucketConfig.id, sizeDelta, 0);
    }
  }

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
  const db = getDb(c.env.DB);
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) throwAppError('FILE_NOT_FOUND');
  if (file.isFolder && targetParentId) {
    let checkId: string | null = targetParentId;
    while (checkId) {
      if (checkId === fileId) throwAppError('CANNOT_MOVE_TO_SUBFOLDER', '不能将文件夹移动到自身或其子文件夹中');
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
  if (conflict && conflict.id !== fileId)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '目标位置已存在同名文件' } },
      409
    );
  const now = new Date().toISOString();
  const newPath = targetParentId ? `${targetParentId}/${file.name}` : `/${file.name}`;
  await db.update(files).set({ parentId: targetParentId, path: newPath, updatedAt: now }).where(eq(files.id, fileId));
  return c.json({ success: true, data: { message: '移动成功' } });
});

// ── Soft delete ────────────────────────────────────────────────────────────
app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  // 使用权限检查函数，需要 admin 权限才能删除
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
  const now = new Date().toISOString();
  if (file.isFolder) await softDeleteFolder(db, fileId, now);
  await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, fileId));
  return c.json({ success: true, data: { message: '已移入回收站' } });
});

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
          if (isChunkedFileId(vRef.tgFileId)) await tgDeleteChunked(db, vRef.tgFileId).catch(() => {});
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
    } catch (e) {
      console.error(`S3 delete failed for ${file.r2Key}:`, e);
    }
    // 删除所有版本存储对象
    for (const vKey of versionKeysToDelete) {
      await s3Delete(bucketConfig, vKey).catch((e) => console.error(`S3 version delete failed ${vKey}:`, e));
    }
    await updateBucketStats(db, bucketConfig.id, -file.size, -1);
  } else if (env.FILES) {
    // 删除主文件
    await env.FILES.delete(file.r2Key);
    // 删除所有版本存储对象
    for (const vKey of versionKeysToDelete) {
      await env.FILES.delete(vKey).catch(() => {});
    }
  }

  // 删除所有版本记录
  await db.delete(fileVersions).where(eq(fileVersions.fileId, file.id));
}

export default app;
