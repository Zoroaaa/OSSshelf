import { Hono } from 'hono';
import { eq, and, isNull, isNotNull, like } from 'drizzle-orm';
import { getDb, files, users, storageBuckets } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, MAX_FILE_SIZE } from '@r2shelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { s3Put, s3Get, s3Delete } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createFolderSchema = z.object({
  name: z.string().min(1, '文件夹名称不能为空').max(255, '名称过长'),
  parentId: z.string().nullable().optional(),
  bucketId: z.string().nullable().optional(),
});

const updateFileSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(255, '名称过长').optional(),
  parentId: z.string().nullable().optional(),
});

const moveFileSchema = z.object({
  targetParentId: z.string().nullable(),
});

app.use('*', authMiddleware);

// ── Upload ─────────────────────────────────────────────────────────────────
app.post('/upload', async (c) => {
  const userId = c.get('userId')!;
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请使用 multipart/form-data 格式上传' } }, 400);
  }

  const formData = await c.req.formData();
  const uploadFile = formData.get('file') as File | null;
  const parentId = formData.get('parentId') as string | null;
  const requestedBucketId = formData.get('bucketId') as string | null;

  if (!uploadFile) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请选择要上传的文件' } }, 400);
  if (uploadFile.size > MAX_FILE_SIZE) return c.json({ success: false, error: { code: ERROR_CODES.FILE_TOO_LARGE, message: `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB）` } }, 400);

  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'r2shelf-key';
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId, parentId);

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && user.storageUsed + uploadFile.size > user.storageQuota) {
    return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: '用户存储配额已满' } }, 400);
  }
  if (bucketConfig) {
    const quotaErr = await checkBucketQuota(db, bucketConfig.id, uploadFile.size);
    if (quotaErr) return c.json({ success: false, error: { code: ERROR_CODES.STORAGE_EXCEEDED, message: quotaErr } }, 400);
  }

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const r2Key = `files/${userId}/${fileId}/${uploadFile.name}`;
  const path = parentId ? `${parentId}/${uploadFile.name}` : `/${uploadFile.name}`;

  if (bucketConfig) {
    await s3Put(bucketConfig, r2Key, await uploadFile.arrayBuffer(), uploadFile.type || 'application/octet-stream', { userId, originalName: uploadFile.name });
  } else if (c.env.FILES) {
    await c.env.FILES.put(r2Key, uploadFile.stream(), { httpMetadata: { contentType: uploadFile.type }, customMetadata: { userId, originalName: uploadFile.name } });
  } else {
    return c.json({ success: false, error: { code: 'NO_STORAGE', message: '未配置存储桶，请先在「存储桶管理」中添加至少一个存储桶' } }, 400);
  }

  await db.insert(files).values({
    id: fileId, userId, parentId: parentId || null, name: uploadFile.name,
    path, type: 'file', size: uploadFile.size, r2Key,
    mimeType: uploadFile.type || null, hash: null, isFolder: false,
    bucketId: bucketConfig?.id ?? null,
    createdAt: now, updatedAt: now, deletedAt: null,
  });

  if (user) {
    await db.update(users).set({ storageUsed: user.storageUsed + uploadFile.size, updatedAt: now }).where(eq(users.id, userId));
  }
  if (bucketConfig) {
    await updateBucketStats(db, bucketConfig.id, uploadFile.size, 1);
  }

  return c.json({ success: true, data: { id: fileId, name: uploadFile.name, size: uploadFile.size, mimeType: uploadFile.type, path, bucketId: bucketConfig?.id ?? null, createdAt: now } });
});

// ── List files ─────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const parentId = c.req.query('parentId') || null;
  const search = c.req.query('search') || '';
  const sortBy = (c.req.query('sortBy') || 'createdAt') as keyof typeof files.$inferSelect;
  const sortOrder = c.req.query('sortOrder') || 'desc';

  const db = getDb(c.env.DB);
  const conditions = [eq(files.userId, userId), isNull(files.deletedAt)];
  if (parentId) { conditions.push(eq(files.parentId, parentId)); } else { conditions.push(isNull(files.parentId)); }
  if (search) conditions.push(like(files.name, `%${search}%`));

  const items = await db.select().from(files).where(and(...conditions)).all();
  const sorted = [...items].sort((a, b) => {
    const aVal = a[sortBy] ?? ''; const bVal = b[sortBy] ?? '';
    if (sortOrder === 'asc') return aVal > bVal ? 1 : -1;
    return aVal < bVal ? 1 : -1;
  });

  const bucketIds = [...new Set(sorted.map((f) => f.bucketId).filter(Boolean))] as string[];
  const bucketMap: Record<string, { id: string; name: string; provider: string }> = {};
  for (const bid of bucketIds) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bid)).get();
    if (b) bucketMap[b.id] = { id: b.id, name: b.name, provider: b.provider };
  }

  const withBucket = sorted.map((f) => ({ ...f, bucket: f.bucketId ? (bucketMap[f.bucketId] ?? null) : null }));
  return c.json({ success: true, data: withBucket });
});

// ── Trash: list ────────────────────────────────────────────────────────────
app.get('/trash', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const items = await db.select().from(files).where(and(eq(files.userId, userId), isNotNull(files.deletedAt))).all();
  const sorted = [...items].sort((a, b) => (b.deletedAt ?? '') > (a.deletedAt ?? '') ? 1 : -1);
  return c.json({ success: true, data: sorted });
});

// ── Trash: restore ─────────────────────────────────────────────────────────
app.post('/trash/:id/restore', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const file = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt))).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在或未被删除' } }, 404);
  await db.update(files).set({ deletedAt: null, updatedAt: new Date().toISOString() }).where(eq(files.id, fileId));
  return c.json({ success: true, data: { message: '已恢复' } });
});

// ── Trash: permanent delete ────────────────────────────────────────────────
app.delete('/trash/:id', async (c) => {
  const userId = c.get('userId')!; const fileId = c.req.param('id');
  const db = getDb(c.env.DB); const encKey = c.env.JWT_SECRET || 'r2shelf-key';
  const file = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt))).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (!file.isFolder) await deleteFileFromStorage(c.env, db, userId, encKey, file);
  await db.delete(files).where(eq(files.id, fileId));
  return c.json({ success: true, data: { message: '已永久删除' } });
});

// ── Trash: empty ───────────────────────────────────────────────────────────
app.delete('/trash', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB); const encKey = c.env.JWT_SECRET || 'r2shelf-key';
  const trashed = await db.select().from(files).where(and(eq(files.userId, userId), isNotNull(files.deletedAt))).all();
  let freedBytes = 0;
  for (const file of trashed) {
    if (!file.isFolder) { await deleteFileFromStorage(c.env, db, userId, encKey, file); freedBytes += file.size; }
    await db.delete(files).where(eq(files.id, file.id));
  }
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user && freedBytes > 0) {
    await db.update(users).set({ storageUsed: Math.max(0, user.storageUsed - freedBytes), updatedAt: new Date().toISOString() }).where(eq(users.id, userId));
  }
  return c.json({ success: true, data: { message: `已清空回收站，释放 ${trashed.length} 个文件` } });
});

// ── Create folder ──────────────────────────────────────────────────────────
app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createFolderSchema.safeParse(body);
  if (!result.success) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } }, 400);

  const { name, parentId, bucketId: requestedBucketId } = result.data;
  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'r2shelf-key';

  const existing = await db.select().from(files).where(and(eq(files.userId, userId), eq(files.name, name), parentId ? eq(files.parentId, parentId) : isNull(files.parentId), eq(files.isFolder, true), isNull(files.deletedAt))).get();
  if (existing) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '同名文件夹已存在' } }, 400);

  let effectiveBucketId: string | null = null;
  if (requestedBucketId) {
    const bucketRow = await db.select().from(storageBuckets).where(and(eq(storageBuckets.id, requestedBucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true))).get();
    if (!bucketRow) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '指定的存储桶不存在或未激活' } }, 400);
    effectiveBucketId = requestedBucketId;
  } else if (!parentId) {
    const bucketConfig = await resolveBucketConfig(db, userId, encKey, null, null);
    effectiveBucketId = bucketConfig?.id ?? null;
  }

  const folderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const path = parentId ? `${parentId}/${name}` : `/${name}`;
  const newFolder = { id: folderId, userId, parentId: parentId || null, name, path, type: 'folder', size: 0, r2Key: `folders/${folderId}`, mimeType: null, hash: null, isFolder: true, bucketId: effectiveBucketId, createdAt: now, updatedAt: now, deletedAt: null };
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
  const userId = c.get('userId')!; const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const file = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  let bucketInfo: { id: string; name: string; provider: string } | null = null;
  if (file.bucketId) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
    if (b) bucketInfo = { id: b.id, name: b.name, provider: b.provider };
  }
  return c.json({ success: true, data: { ...file, bucket: bucketInfo } });
});

// ── Update ─────────────────────────────────────────────────────────────────
app.put('/:id', async (c) => {
  const userId = c.get('userId')!; const fileId = c.req.param('id');
  const body = await c.req.json(); const result = updateFileSchema.safeParse(body);
  if (!result.success) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } }, 400);
  const db = getDb(c.env.DB);
  const file = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId))).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  const { name, parentId } = result.data;
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = { updatedAt: now };
  if (name) { updateData.name = name; updateData.path = parentId !== undefined ? (parentId ? `${parentId}/${name}` : `/${name}`) : (file.parentId ? `${file.parentId}/${name}` : `/${name}`); }
  if (parentId !== undefined) { updateData.parentId = parentId || null; const n = (name as string | undefined) || file.name; updateData.path = parentId ? `${parentId}/${n}` : `/${n}`; }
  await db.update(files).set(updateData).where(eq(files.id, fileId));
  return c.json({ success: true, data: { message: '更新成功' } });
});

// ── Move ───────────────────────────────────────────────────────────────────
app.post('/:id/move', async (c) => {
  const userId = c.get('userId')!; const fileId = c.req.param('id');
  const body = await c.req.json(); const result = moveFileSchema.safeParse(body);
  if (!result.success) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } }, 400);
  const { targetParentId } = result.data;
  const db = getDb(c.env.DB);
  const file = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt))).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (file.isFolder && targetParentId) {
    let checkId: string | null = targetParentId;
    while (checkId) { if (checkId === fileId) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '不能将文件夹移动到自身或其子文件夹中' } }, 400); const parent = await db.select().from(files).where(eq(files.id, checkId)).get(); checkId = parent?.parentId ?? null; }
  }
  const conflict = await db.select().from(files).where(and(eq(files.userId, userId), eq(files.name, file.name), targetParentId ? eq(files.parentId, targetParentId) : isNull(files.parentId), isNull(files.deletedAt))).get();
  if (conflict && conflict.id !== fileId) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '目标位置已存在同名文件' } }, 409);
  const now = new Date().toISOString(); const newPath = targetParentId ? `${targetParentId}/${file.name}` : `/${file.name}`;
  await db.update(files).set({ parentId: targetParentId, path: newPath, updatedAt: now }).where(eq(files.id, fileId));
  return c.json({ success: true, data: { message: '移动成功' } });
});

// ── Soft delete ────────────────────────────────────────────────────────────
app.delete('/:id', async (c) => {
  const userId = c.get('userId')!; const fileId = c.req.param('id');
  const db = getDb(c.env.DB);
  const file = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt))).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  const now = new Date().toISOString();
  if (file.isFolder) await softDeleteFolder(db, fileId, now);
  await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, fileId));
  return c.json({ success: true, data: { message: '已移入回收站' } });
});

async function softDeleteFolder(db: ReturnType<typeof getDb>, folderId: string, now: string) {
  const children = await db.select().from(files).where(and(eq(files.parentId, folderId), isNull(files.deletedAt))).all();
  for (const child of children) { if (child.isFolder) await softDeleteFolder(db, child.id, now); await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, child.id)); }
}

// ── Download ───────────────────────────────────────────────────────────────
app.get('/:id/download', async (c) => {
  const userId = c.get('userId')!; const fileId = c.req.param('id');
  const db = getDb(c.env.DB); const encKey = c.env.JWT_SECRET || 'r2shelf-key';
  const file = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt))).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (file.isFolder) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无法下载文件夹' } }, 400);
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  const dlHeaders = { 'Content-Type': file.mimeType || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`, 'Content-Length': file.size.toString() };
  if (bucketConfig) { const s3Res = await s3Get(bucketConfig, file.r2Key); return new Response(s3Res.body, { headers: dlHeaders }); }
  if (c.env.FILES) { const obj = await c.env.FILES.get(file.r2Key); if (!obj) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404); return new Response(obj.body, { headers: dlHeaders }); }
  return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
});

// ── Preview ────────────────────────────────────────────────────────────────
app.get('/:id/preview', async (c) => {
  let userId = c.get('userId');
  if (!userId) {
    const queryToken = c.req.query('token');
    if (queryToken) {
      try { const { verifyJWT } = await import('../lib/crypto'); const payload = await verifyJWT(queryToken, c.env.JWT_SECRET); const session = await c.env.KV.get(`session:${queryToken}`); if (session && payload?.userId) userId = payload.userId; } catch { /* ignore */ }
    }
    if (!userId) return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '未授权' } }, 401);
  }
  const fileId = c.req.param('id');
  const db = getDb(c.env.DB); const encKey = c.env.JWT_SECRET || 'r2shelf-key';
  const file = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt))).get();
  if (!file) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  if (file.isFolder) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无法预览文件夹' } }, 400);
  const previewable = file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/') || file.mimeType?.startsWith('audio/') || file.mimeType === 'application/pdf' || file.mimeType?.startsWith('text/');
  if (!previewable) return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该文件类型不支持预览' } }, 400);
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  const pvHeaders = { 'Content-Type': file.mimeType || 'application/octet-stream', 'Content-Length': file.size.toString() };
  if (bucketConfig) { const s3Res = await s3Get(bucketConfig, file.r2Key); return new Response(s3Res.body, { headers: pvHeaders }); }
  if (c.env.FILES) { const obj = await c.env.FILES.get(file.r2Key); if (!obj) return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件内容不存在' } }, 404); return new Response(obj.body, { headers: pvHeaders }); }
  return c.json({ success: false, error: { code: 'NO_STORAGE', message: '存储桶未配置' } }, 500);
});

// ── Shared helper ──────────────────────────────────────────────────────────
async function deleteFileFromStorage(env: Env, db: ReturnType<typeof getDb>, userId: string, encKey: string, file: typeof files.$inferSelect) {
  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (bucketConfig) {
    try { await s3Delete(bucketConfig, file.r2Key); } catch (e) { console.error(`S3 delete failed for ${file.r2Key}:`, e); }
    await updateBucketStats(db, bucketConfig.id, -file.size, -1);
  } else if (env.FILES) {
    await env.FILES.delete(file.r2Key);
  }
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user) await db.update(users).set({ storageUsed: Math.max(0, user.storageUsed - file.size), updatedAt: new Date().toISOString() }).where(eq(users.id, userId));
}

export default app;
