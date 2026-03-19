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

import { Hono } from 'hono';
import { eq, and, isNull, isNotNull, like, or, inArray, sql } from 'drizzle-orm';
import { getDb, files, users, storageBuckets, filePermissions, telegramFileRefs } from '../db';
import { checkFilePermission } from './permissions';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, MAX_FILE_SIZE, isPreviewableMimeType, inferMimeType } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { s3Put, s3Get, s3Delete, decryptSecret } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { checkFolderMimeTypeRestriction } from '../lib/folderPolicy';
import { getEncryptionKey } from '../lib/crypto';
import {
  tgUploadFile,
  tgDownloadFile,
  TG_MAX_FILE_SIZE,
  type TelegramBotConfig,
} from '../lib/telegramClient';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  let userId: string | undefined;
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const { verifyJWT } = await import('../lib/crypto');
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      if (payload?.userId) userId = payload.userId;
    } catch {
      /* ignore */
    }
  }
  if (!userId) {
    const queryToken = c.req.query('token');
    if (queryToken) {
      try {
        const { verifyJWT } = await import('../lib/crypto');
        const payload = await verifyJWT(queryToken, c.env.JWT_SECRET);
        if (payload?.userId) userId = payload.userId;
      } catch {
        /* ignore */
      }
    }
  }
  if (!userId) return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '未授权' } }, 401);

  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (file.isFolder)
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无法预览文件夹' } }, 400);
  if (!isPreviewableMimeType(file.mimeType))
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该文件类型不支持预览' } },
      400
    );
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
        return c.json({ success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用' } }, 404);
      }
      const tgConfig = await resolveTgBucketConfig(db, file.bucketId, encKey);
      if (!tgConfig) {
        return c.json({ success: false, error: { code: 'TG_CONFIG_ERROR', message: '无法加载 Telegram 配置' } }, 500);
      }
      try {
        const tgResp = await tgDownloadFile(tgConfig, ref.tgFileId);
        return new Response(tgResp.body, { headers: pvHeaders });
      } catch (e: any) {
        return c.json({ success: false, error: { code: 'TG_DOWNLOAD_FAILED', message: e?.message } }, 502);
      }
    }
  }

  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);
    return new Response(s3Res.body, { headers: pvHeaders });
  }
  if (c.env.FILES) {
    const obj = await c.env.FILES.get(file.r2Key);
    if (!obj) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404);
    return new Response(obj.body, { headers: pvHeaders });
  }
  return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
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

  // Telegram 单文件 50MB 限制
  if (isTelegramBucket && uploadFile.size > TG_MAX_FILE_SIZE) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.FILE_TOO_LARGE,
          message: `Telegram 存储桶单文件上限 50MB，当前文件 ${(uploadFile.size / 1024 / 1024).toFixed(1)}MB`,
        },
      },
      413
    );
  }

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && user.storageUsed + uploadFile.size > user.storageQuota) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: '用户存储配额已满' } }, 400);
  }
  if (bucketConfig) {
    const quotaErr = await checkBucketQuota(db, bucketConfig.id, uploadFile.size);
    if (quotaErr)
      return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: quotaErr } }, 400);
  }

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `files/${userId}/${fileId}/${uploadFile.name}`;
  const path = parentId ? `${parentId}/${uploadFile.name}` : `/${uploadFile.name}`;

  if (isTelegramBucket && effectiveBucketId) {
    // ── Telegram 上传路径 ────────────────────────────────────────────────
    const tgConfig = await resolveTgBucketConfig(db, effectiveBucketId, encKey);
    if (!tgConfig) {
      return c.json({ success: false, error: { code: 'TG_CONFIG_ERROR', message: '无法加载 Telegram 配置' } }, 500);
    }
    const caption = `📁 ${uploadFile.name}\n🗂 OSSshelf | ${now.slice(0, 10)}`;
    let tgResult;
    try {
      tgResult = await tgUploadFile(tgConfig, await uploadFile.arrayBuffer(), uploadFile.name, fileMime, caption);
    } catch (e: any) {
      return c.json({ success: false, error: { code: 'TG_UPLOAD_FAILED', message: e?.message || 'Telegram 上传失败' } }, 502);
    }
    // 持久化 file_id 映射
    await db.insert(telegramFileRefs).values({
      id: crypto.randomUUID(),
      fileId,
      r2Key,
      tgFileId: tgResult.fileId,
      tgFileSize: tgResult.fileSize,
      bucketId: effectiveBucketId,
      createdAt: now,
    });
  } else if (bucketConfig) {
    await s3Put(bucketConfig, r2Key, await uploadFile.arrayBuffer(), fileMime, {
      userId,
      originalName: uploadFile.name,
    });
  } else if (c.env.FILES) {
    await c.env.FILES.put(r2Key, uploadFile.stream(), {
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

  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name: uploadFile.name,
    path,
    type: 'file',
    size: uploadFile.size,
    r2Key,
    mimeType: fileMime || null,
    hash: null,
    isFolder: false,
    bucketId: isTelegramBucket ? effectiveBucketId : (bucketConfig?.id ?? null),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  if (user) {
    await db
      .update(users)
      .set({ storageUsed: user.storageUsed + uploadFile.size, updatedAt: now })
      .where(eq(users.id, userId));
  }
  // Telegram 桶统计在 tgUploadFile 之后已通过 insert telegramFileRefs 记录，此处统一更新 bucket stats
  if (isTelegramBucket && effectiveBucketId) {
    await updateBucketStats(db, effectiveBucketId, uploadFile.size, 1);
  } else if (bucketConfig) {
    await updateBucketStats(db, bucketConfig.id, uploadFile.size, 1);
  }

  return c.json({
    success: true,
    data: {
      id: fileId,
      name: uploadFile.name,
      size: uploadFile.size,
      mimeType: fileMime,
      path,
      bucketId: isTelegramBucket ? effectiveBucketId : (bucketConfig?.id ?? null),
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

  // 查询用户通过权限表获得授权访问的文件ID
  const permittedFileIds = await db
    .select({ fileId: filePermissions.fileId })
    .from(filePermissions)
    .where(eq(filePermissions.userId, userId))
    .all();
  const permittedIds = permittedFileIds.map((p) => p.fileId);

  // 构建查询条件：用户自己的文件 或 被授权访问的文件
  const ownershipCondition = or(
    eq(files.userId, userId),
    permittedIds.length > 0 ? inArray(files.id, permittedIds) : undefined
  );

  const conditions = [ownershipCondition, isNull(files.deletedAt)];
  if (parentId) {
    conditions.push(eq(files.parentId, parentId));
  } else {
    conditions.push(isNull(files.parentId));
  }
  if (search) conditions.push(like(files.name, `%${search}%`));

  const items = await db
    .select()
    .from(files)
    .where(and(...(conditions.filter(Boolean) as any[])))
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

  // 权限信息（纯内存计算，无需额外 DB 查询）
  const permittedIdSet = new Set(permittedIds);
  const permissionsMap: Record<string, { permission: string | null; isOwner: boolean }> = {};
  for (const file of sorted) {
    const isOwner = file.userId === userId;
    permissionsMap[file.id] = {
      permission: isOwner ? 'admin' : permittedIdSet.has(file.id) ? 'read' : null,
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
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
    .get();
  if (!file)
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在或未被删除' } }, 404);
  await db.update(files).set({ deletedAt: null, updatedAt: new Date().toISOString() }).where(eq(files.id, fileId));
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
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (!file.isFolder) {
    await deleteFileFromStorage(c.env, db, userId, encKey, file);
    // 更新用户存储配额
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      await db
        .update(users)
        .set({ storageUsed: Math.max(0, user.storageUsed - file.size), updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
    }
  }
  await db.delete(files).where(eq(files.id, fileId));
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
      await deleteFileFromStorage(c.env, db, userId, encKey, file);
      freedBytes += file.size;
    }
    await db.delete(files).where(eq(files.id, file.id));
  }
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && freedBytes > 0) {
    await db
      .update(users)
      .set({ storageUsed: Math.max(0, user.storageUsed - freedBytes), updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));
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
  if (existing)
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '同名文件夹已存在' } }, 400);

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
  } else if (!parentId) {
    const bucketConfig = await resolveBucketConfig(db, userId, encKey, null, null);
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

  let bucketInfo: { id: string; name: string; provider: string } | null = null;
  if (effectiveBucketId) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, effectiveBucketId)).get();
    if (b) bucketInfo = { id: b.id, name: b.name, provider: b.provider };
  }
  return c.json({ success: true, data: { ...newFolder, bucket: bucketInfo } });
});

// ── Get single file ────────────────────────────────────────────────────────
app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);

  // 使用权限检查函数，允许被授权的用户访问
  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'read');
  if (!hasAccess) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权访问此文件' } }, 403);
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

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
  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'write');
  if (!hasAccess) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权修改此文件' } }, 403);
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);

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
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (!file.isFolder)
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '只有文件夹可以设置上传类型限制' } },
      400
    );

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
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (file.isFolder && targetParentId) {
    let checkId: string | null = targetParentId;
    while (checkId) {
      if (checkId === fileId)
        return c.json(
          {
            success: false,
            error: { code: ERROR_CODES.VALIDATION_ERROR, message: '不能将文件夹移动到自身或其子文件夹中' },
          },
          400
        );
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
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'admin');
  if (!hasAccess) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权删除此文件' } }, 403);
  }

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
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

// ── Download ───────────────────────────────────────────────────────────────
app.get('/:id/download', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  // 使用权限检查函数，需要 read 权限
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read');
  if (!hasAccess) {
    return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '无权下载此文件' } }, 403);
  }

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (file.isFolder)
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无法下载文件夹' } }, 400);
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
        return c.json({ success: false, error: { code: 'TG_REF_NOT_FOUND', message: '未找到 Telegram 文件引用，文件可能已损坏' } }, 404);
      }
      const tgConfig = await resolveTgBucketConfig(db, file.bucketId, encKey);
      if (!tgConfig) {
        return c.json({ success: false, error: { code: 'TG_CONFIG_ERROR', message: '无法加载 Telegram 配置' } }, 500);
      }
      try {
        const tgResp = await tgDownloadFile(tgConfig, ref.tgFileId);
        return new Response(tgResp.body, { headers: dlHeaders });
      } catch (e: any) {
        return c.json({ success: false, error: { code: 'TG_DOWNLOAD_FAILED', message: e?.message || 'Telegram 下载失败' } }, 502);
      }
    }
  }

  if (bucketConfig) {
    const s3Res = await s3Get(bucketConfig, file.r2Key);
    return new Response(s3Res.body, { headers: dlHeaders });
  }
  if (c.env.FILES) {
    const obj = await c.env.FILES.get(file.r2Key);
    if (!obj) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404);
    return new Response(obj.body, { headers: dlHeaders });
  }
  return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
});

// ── Shared helper ──────────────────────────────────────────────────────────
/**
 * 从对象存储中删除文件，更新 bucket 统计。
 * 注意：此函数不更新用户 storageUsed，由调用方统一批量更新以避免双重扣减。
 */
async function deleteFileFromStorage(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  encKey: string,
  file: typeof files.$inferSelect
) {
  // ── Telegram 桶删除：清理 DB 引用（Telegram 消息删除为尽力而为）──────
  if (file.bucketId) {
    const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (bkt?.provider === 'telegram') {
      await db.delete(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id));
      await updateBucketStats(db, file.bucketId, -file.size, -1);
      return;
    }
  }
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (bucketConfig) {
    try {
      await s3Delete(bucketConfig, file.r2Key);
    } catch (e) {
      console.error(`S3 delete failed for ${file.r2Key}:`, e);
    }
    await updateBucketStats(db, bucketConfig.id, -file.size, -1);
  } else if (env.FILES) {
    await env.FILES.delete(file.r2Key);
  }
}

export default app;
