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
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { getEncryptionKey } from '../lib/crypto';
import {
  PROVIDERS,
  listBuckets,
  createBucket,
  getBucketById,
  updateBucket,
  setDefaultBucket,
  toggleBucket,
  testBucketConnection,
  deleteBucket,
} from '../services/buckets.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

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
  storageQuota: z.number().int().positive().nullable().optional(),
});

const updateBucketSchema = createBucketSchema.partial();

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const result = await listBuckets(db, userId);
  return c.json({ success: true, data: result });
});

app.get('/providers', (c) => {
  return c.json({ success: true, data: PROVIDERS });
});

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

  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const newBucket = await createBucket(db, encKey, userId, result.data);

  return c.json({ success: true, data: newBucket }, 201);
});

app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const bucket = await getBucketById(db, userId, id);
  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  return c.json({ success: true, data: bucket });
});

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
  const encKey = getEncryptionKey(c.env);
  const updated = await updateBucket(db, encKey, userId, id, result.data);

  if (!updated) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  return c.json({ success: true, data: updated });
});

app.post('/:id/set-default', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const result = await setDefaultBucket(db, userId, id);
  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, 404);
  }

  return c.json({ success: true, data: { message: '已设为默认存储桶' } });
});

app.post('/:id/toggle', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const result = await toggleBucket(db, userId, id);
  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, 404);
  }

  return c.json({ success: true, data: { isActive: result.isActive } });
});

app.post('/:id/test', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const result = await testBucketConnection(db, encKey, userId, id);
  if (!result.success) {
    return c.json({ success: false, error: { code: 'CONNECTION_FAILED', message: result.error } }, 200);
  }

  return c.json({ success: true, data: result.data });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const result = await deleteBucket(db, userId, id);
  if (!result.success) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: result.error } }, 404);
  }

  return c.json({ success: true, data: { message: '已删除存储桶配置' } });
});

export default app;
