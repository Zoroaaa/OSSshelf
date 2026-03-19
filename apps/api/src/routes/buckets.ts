/**
 * buckets.ts
 * 存储桶管理路由
 *
 * 功能:
 * - 多厂商存储桶配置（R2、S3、OSS、COS、OBS、B2、MinIO等）
 * - 存储桶增删改查
 * - 存储桶测试与切换
 * - 凭证AES-GCM加密存储
 */

import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, storageBuckets, files } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { getEncryptionKey } from '../lib/crypto';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

// ── Provider metadata (for frontend display) ──────────────────────────────
export const PROVIDERS = {
  r2: { name: 'Cloudflare R2', defaultEndpoint: 'https://<accountId>.r2.cloudflarestorage.com', pathStyle: false },
  s3: { name: 'Amazon S3', defaultEndpoint: '', pathStyle: false },
  oss: { name: 'Aliyun OSS', defaultEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com', pathStyle: false },
  cos: { name: 'Tencent COS', defaultEndpoint: 'https://cos.ap-guangzhou.myqcloud.com', pathStyle: false },
  obs: { name: 'Huawei OBS', defaultEndpoint: 'https://obs.cn-north-4.myhuaweicloud.com', pathStyle: false },
  b2: { name: 'Backblaze B2', defaultEndpoint: 'https://s3.us-west-004.backblazeb2.com', pathStyle: true },
  minio: { name: 'MinIO', defaultEndpoint: 'http://localhost:9000', pathStyle: true },
  custom: { name: '自定义 S3 兼容', defaultEndpoint: '', pathStyle: false },
  telegram: { name: 'Telegram', defaultEndpoint: '', pathStyle: false },
} as const;

// Import credential helpers and S3 test from shared lib
import { encryptSecret, testS3Connection, makeBucketConfigAsync } from '../lib/s3client';

// ── Schemas ────────────────────────────────────────────────────────────────
const createBucketSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  provider: z.enum(['r2', 's3', 'oss', 'cos', 'obs', 'b2', 'minio', 'custom', 'telegram']),
  bucketName: z.string().min(1, '存储桶名称不能为空').max(255),
  endpoint: z.string().url('Endpoint 必须是有效的 URL').optional().or(z.literal('')),
  region: z.string().max(64).optional(),
  accessKeyId: z.string().min(1, 'Access Key ID / Bot Token 不能为空'),
  secretAccessKey: z.string().optional().default('telegram-no-secret'),
  pathStyle: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
  notes: z.string().max(500).optional(),
  storageQuota: z.number().int().positive().nullable().optional(), // bytes, null = unlimited
});

const updateBucketSchema = createBucketSchema.partial();

// ── Helper: strip credentials from response ───────────────────────────────
function sanitize(bucket: typeof storageBuckets.$inferSelect) {
  const { accessKeyId, secretAccessKey, ...safe } = bucket;
  // Telegram Bot Token 以 "<id>:ABC..." 格式呈现，只显示前8字符
  const displayAkId = bucket.provider === 'telegram'
    ? accessKeyId.slice(0, 8) + '••••••••'
    : accessKeyId.slice(0, 4) + '••••••••' + accessKeyId.slice(-4);
  return {
    ...safe,
    accessKeyId: displayAkId,
    secretAccessKeyMasked: bucket.provider === 'telegram' ? '(telegram)' : '••••••••••••••••',
  };
}

// ── GET /api/buckets — list all buckets ────────────────────────────────────
app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const buckets = await db.select().from(storageBuckets).where(eq(storageBuckets.userId, userId)).all();

  const activeFiles = await db
    .select({ bucketId: files.bucketId, size: files.size, isFolder: files.isFolder })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const bucketStats = new Map<string, { storageUsed: number; fileCount: number }>();
  for (const f of activeFiles.filter((f) => !f.isFolder)) {
    const bucketId = f.bucketId || '__no_bucket__';
    const stats = bucketStats.get(bucketId) || { storageUsed: 0, fileCount: 0 };
    stats.storageUsed += f.size;
    stats.fileCount += 1;
    bucketStats.set(bucketId, stats);
  }

  const sorted = [...buckets].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });

  const result = sorted.map((b) => {
    const actualStats = bucketStats.get(b.id) || { storageUsed: 0, fileCount: 0 };
    const sanitized = sanitize(b);
    return {
      ...sanitized,
      storageUsed: actualStats.storageUsed,
      fileCount: actualStats.fileCount,
    };
  });

  return c.json({ success: true, data: result });
});

// ── GET /api/buckets/providers — static provider metadata ─────────────────
app.get('/providers', (c) => {
  return c.json({ success: true, data: PROVIDERS });
});

// ── POST /api/buckets — create a new bucket config ────────────────────────
app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createBucketSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message },
      },
      400
    );
  }

  const data = result.data;
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const encKey = getEncryptionKey(c.env);

  if (data.isDefault) {
    await db
      .update(storageBuckets)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true)));
  }

  const existing = await db.select().from(storageBuckets).where(eq(storageBuckets.userId, userId)).all();
  const shouldBeDefault = data.isDefault || existing.length === 0;

  const id = crypto.randomUUID();
  const encryptedAccessKeyId = await encryptSecret(data.accessKeyId, encKey);
  const encryptedSecretAccessKey = await encryptSecret(data.secretAccessKey, encKey);

  const newBucket = {
    id,
    userId,
    name: data.name,
    provider: data.provider,
    bucketName: data.bucketName,
    endpoint: data.endpoint || null,
    region: data.region || null,
    accessKeyId: encryptedAccessKeyId,
    secretAccessKey: encryptedSecretAccessKey,
    pathStyle: data.pathStyle ?? false,
    isDefault: shouldBeDefault,
    isActive: true,
    storageUsed: 0,
    fileCount: 0,
    storageQuota: data.storageQuota ?? null,
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(storageBuckets).values(newBucket);

  return c.json(
    {
      success: true,
      data: sanitize(newBucket as typeof storageBuckets.$inferSelect),
    },
    201
  );
});

// ── GET /api/buckets/:id — get single bucket ──────────────────────────────
app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  return c.json({ success: true, data: sanitize(bucket) });
});

// ── PUT /api/buckets/:id — update bucket config ───────────────────────────
app.put('/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const result = updateBucketSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message },
      },
      400
    );
  }

  const db = getDb(c.env.DB);
  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  const data = result.data;
  const now = new Date().toISOString();
  const encKey = getEncryptionKey(c.env);

  if (data.isDefault && !bucket.isDefault) {
    await db
      .update(storageBuckets)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true)));
  }

  const updateData: Record<string, unknown> = { updatedAt: now };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.provider !== undefined) updateData.provider = data.provider;
  if (data.bucketName !== undefined) updateData.bucketName = data.bucketName;
  if (data.endpoint !== undefined) updateData.endpoint = data.endpoint || null;
  if (data.region !== undefined) updateData.region = data.region || null;
  if (data.accessKeyId !== undefined) updateData.accessKeyId = await encryptSecret(data.accessKeyId, encKey);
  if (data.secretAccessKey !== undefined)
    updateData.secretAccessKey = await encryptSecret(data.secretAccessKey, encKey);
  if (data.pathStyle !== undefined) updateData.pathStyle = data.pathStyle;
  if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
  if (data.notes !== undefined) updateData.notes = data.notes || null;
  if (data.storageQuota !== undefined) updateData.storageQuota = data.storageQuota ?? null;

  await db.update(storageBuckets).set(updateData).where(eq(storageBuckets.id, id));

  const updated = await db.select().from(storageBuckets).where(eq(storageBuckets.id, id)).get();
  return c.json({ success: true, data: updated ? sanitize(updated) : null });
});

// ── POST /api/buckets/:id/set-default — set as default ────────────────────
app.post('/:id/set-default', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  // Unset all defaults, then set this one
  await db.update(storageBuckets).set({ isDefault: false, updatedAt: now }).where(eq(storageBuckets.userId, userId));

  await db.update(storageBuckets).set({ isDefault: true, updatedAt: now }).where(eq(storageBuckets.id, id));

  return c.json({ success: true, data: { message: '已设为默认存储桶' } });
});

// ── POST /api/buckets/:id/toggle — enable/disable ─────────────────────────
app.post('/:id/toggle', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  const now = new Date().toISOString();
  const newIsActive = !bucket.isActive;
  await db.update(storageBuckets).set({ isActive: newIsActive, updatedAt: now }).where(eq(storageBuckets.id, id));

  // 返回实际写入的值而非内存中的旧值，防止并发时返回错误状态
  return c.json({ success: true, data: { isActive: newIsActive } });
});

// ── POST /api/buckets/:id/test — test connectivity ────────────────────────
app.post('/:id/test', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  // ── Telegram 专用测试路径 ──────────────────────────────────────────────
  if (bucket.provider === 'telegram') {
    try {
      const { tgTestConnection } = await import('../lib/telegramClient');
      const { decryptSecret } = await import('../lib/s3client');
      const botToken = await decryptSecret(bucket.accessKeyId, encKey);
      const tgResult = await tgTestConnection({
        botToken,
        chatId: bucket.bucketName,
        apiBase: bucket.endpoint || undefined,
      });
      return c.json({
        success: tgResult.connected,
        data: {
          connected: tgResult.connected,
          message: tgResult.message,
          statusCode: tgResult.connected ? 200 : 400,
        },
      });
    } catch (err: any) {
      return c.json({
        success: false,
        error: { code: 'CONNECTION_FAILED', message: err.message || 'Telegram 连接失败' },
      }, 200);
    }
  }

  try {
    const cfg = await makeBucketConfigAsync(bucket, encKey, db);
    const testResult = await testS3Connection(cfg);
    return c.json({ success: true, data: testResult });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'CONNECTION_FAILED', message: err.message || '连接失败' } }, 200);
  }
});

// ── DELETE /api/buckets/:id — delete bucket config ────────────────────────
app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  if (bucket.isDefault) {
    // 晋升最早创建的存储桶为新默认桶（确定性，避免随机顺序）
    const remaining = await db
      .select()
      .from(storageBuckets)
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true)))
      .all();
    const next = remaining.filter((b) => b.id !== id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (next) {
      const now = new Date().toISOString();
      await db.update(storageBuckets).set({ isDefault: true, updatedAt: now }).where(eq(storageBuckets.id, next.id));
    }
  }

  await db.delete(storageBuckets).where(eq(storageBuckets.id, id));

  return c.json({ success: true, data: { message: '已删除存储桶配置' } });
});

export default app;
