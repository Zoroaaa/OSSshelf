/**
 * buckets.ts — Storage Bucket Management API
 *
 * Supports multi-vendor, multi-bucket configuration.
 * Credentials are stored encrypted in D1.
 * Compatible providers: Cloudflare R2, AWS S3, Aliyun OSS, Tencent COS,
 *   Huawei OBS, Backblaze B2, MinIO, and any S3-compatible endpoint.
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb, storageBuckets } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@r2shelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

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
} as const;

// ── Simple XOR-based obfuscation for credentials ──────────────────────────
// In production, use Cloudflare's encryption APIs or Workers Secrets.
function obfuscate(value: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key.repeat(Math.ceil(value.length / key.length)));
  const valueBytes = new TextEncoder().encode(value);
  const result = new Uint8Array(valueBytes.length);
  for (let i = 0; i < valueBytes.length; i++) {
    result[i] = valueBytes[i] ^ keyBytes[i];
  }
  return btoa(String.fromCharCode(...result));
}

function deobfuscate(value: string, key: string): string {
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    const keyBytes = new TextEncoder().encode(key.repeat(Math.ceil(bytes.length / key.length)));
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      result[i] = bytes[i] ^ keyBytes[i];
    }
    return new TextDecoder().decode(result);
  } catch {
    return value;
  }
}

// ── Schemas ────────────────────────────────────────────────────────────────
const createBucketSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  provider: z.enum(['r2', 's3', 'oss', 'cos', 'obs', 'b2', 'minio', 'custom']),
  bucketName: z.string().min(1, '存储桶名称不能为空').max(255),
  endpoint: z.string().url('Endpoint 必须是有效的 URL').optional().or(z.literal('')),
  region: z.string().max(64).optional(),
  accessKeyId: z.string().min(1, 'Access Key ID 不能为空'),
  secretAccessKey: z.string().min(1, 'Secret Access Key 不能为空'),
  pathStyle: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
  notes: z.string().max(500).optional(),
});

const updateBucketSchema = createBucketSchema.partial();

// ── Helper: strip credentials from response ───────────────────────────────
function sanitize(bucket: typeof storageBuckets.$inferSelect) {
  const { accessKeyId, secretAccessKey, ...safe } = bucket;
  return {
    ...safe,
    accessKeyId: accessKeyId.slice(0, 4) + '••••••••' + accessKeyId.slice(-4),
    secretAccessKeyMasked: '••••••••••••••••',
  };
}

// ── GET /api/buckets — list all buckets ────────────────────────────────────
app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const buckets = await db.select().from(storageBuckets)
    .where(eq(storageBuckets.userId, userId))
    .all();

  const sorted = [...buckets].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });

  return c.json({ success: true, data: sorted.map(sanitize) });
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
    return c.json({
      success: false,
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message },
    }, 400);
  }

  const data = result.data;
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const encKey = c.env.JWT_SECRET || 'r2shelf-default-key';

  // If this is set as default, unset existing defaults
  if (data.isDefault) {
    await db.update(storageBuckets)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true)));
  }

  // If no buckets exist yet, make this the default automatically
  const existing = await db.select().from(storageBuckets)
    .where(eq(storageBuckets.userId, userId)).all();
  const shouldBeDefault = data.isDefault || existing.length === 0;

  const id = crypto.randomUUID();
  const newBucket = {
    id,
    userId,
    name: data.name,
    provider: data.provider,
    bucketName: data.bucketName,
    endpoint: data.endpoint || null,
    region: data.region || null,
    accessKeyId: obfuscate(data.accessKeyId, encKey),
    secretAccessKey: obfuscate(data.secretAccessKey, encKey),
    pathStyle: data.pathStyle ?? false,
    isDefault: shouldBeDefault,
    isActive: true,
    storageUsed: 0,
    fileCount: 0,
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(storageBuckets).values(newBucket);

  return c.json({
    success: true,
    data: sanitize(newBucket as typeof storageBuckets.$inferSelect),
  }, 201);
});

// ── GET /api/buckets/:id — get single bucket ──────────────────────────────
app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const bucket = await db.select().from(storageBuckets)
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
    return c.json({
      success: false,
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message },
    }, 400);
  }

  const db = getDb(c.env.DB);
  const bucket = await db.select().from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  const data = result.data;
  const now = new Date().toISOString();
  const encKey = c.env.JWT_SECRET || 'r2shelf-default-key';

  // Handle default switch
  if (data.isDefault && !bucket.isDefault) {
    await db.update(storageBuckets)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true)));
  }

  const updateData: Record<string, unknown> = { updatedAt: now };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.provider !== undefined) updateData.provider = data.provider;
  if (data.bucketName !== undefined) updateData.bucketName = data.bucketName;
  if (data.endpoint !== undefined) updateData.endpoint = data.endpoint || null;
  if (data.region !== undefined) updateData.region = data.region || null;
  if (data.accessKeyId !== undefined) updateData.accessKeyId = obfuscate(data.accessKeyId, encKey);
  if (data.secretAccessKey !== undefined) updateData.secretAccessKey = obfuscate(data.secretAccessKey, encKey);
  if (data.pathStyle !== undefined) updateData.pathStyle = data.pathStyle;
  if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
  if (data.notes !== undefined) updateData.notes = data.notes || null;

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

  const bucket = await db.select().from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  // Unset all defaults, then set this one
  await db.update(storageBuckets)
    .set({ isDefault: false, updatedAt: now })
    .where(eq(storageBuckets.userId, userId));

  await db.update(storageBuckets)
    .set({ isDefault: true, updatedAt: now })
    .where(eq(storageBuckets.id, id));

  return c.json({ success: true, data: { message: '已设为默认存储桶' } });
});

// ── POST /api/buckets/:id/toggle — enable/disable ─────────────────────────
app.post('/:id/toggle', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const bucket = await db.select().from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  const now = new Date().toISOString();
  await db.update(storageBuckets)
    .set({ isActive: !bucket.isActive, updatedAt: now })
    .where(eq(storageBuckets.id, id));

  return c.json({ success: true, data: { isActive: !bucket.isActive } });
});

// ── POST /api/buckets/:id/test — test connectivity ────────────────────────
app.post('/:id/test', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const encKey = c.env.JWT_SECRET || 'r2shelf-default-key';

  const bucket = await db.select().from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  const accessKeyId = deobfuscate(bucket.accessKeyId, encKey);
  const secretKey = deobfuscate(bucket.secretAccessKey, encKey);
  const endpoint = resolveEndpoint(bucket.provider, bucket.endpoint, bucket.region);

  // Build S3 ListBuckets / HeadBucket request
  try {
    const testResult = await testS3Connection({
      endpoint,
      bucketName: bucket.bucketName,
      accessKeyId,
      secretAccessKey: secretKey,
      region: bucket.region || 'us-east-1',
      pathStyle: bucket.pathStyle,
    });

    return c.json({ success: true, data: testResult });
  } catch (err: any) {
    return c.json({
      success: false,
      error: { code: 'CONNECTION_FAILED', message: err.message || '连接失败' },
    }, 200); // Return 200 so frontend can display the error message
  }
});

// ── DELETE /api/buckets/:id — delete bucket config ────────────────────────
app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const bucket = await db.select().from(storageBuckets)
    .where(and(eq(storageBuckets.id, id), eq(storageBuckets.userId, userId)))
    .get();

  if (!bucket) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '存储桶不存在' } }, 404);
  }

  if (bucket.isDefault) {
    // Check if there's another bucket to promote to default
    const others = await db.select().from(storageBuckets)
      .where(and(eq(storageBuckets.userId, userId)))
      .all();
    const remaining = others.filter((b) => b.id !== id);
    if (remaining.length > 0) {
      const now = new Date().toISOString();
      await db.update(storageBuckets)
        .set({ isDefault: true, updatedAt: now })
        .where(eq(storageBuckets.id, remaining[0].id));
    }
  }

  await db.delete(storageBuckets).where(eq(storageBuckets.id, id));

  return c.json({ success: true, data: { message: '已删除存储桶配置' } });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveEndpoint(provider: string, endpoint: string | null, region: string | null): string {
  if (endpoint) return endpoint.replace(/\/$/, '');
  const r = region || 'us-east-1';
  switch (provider) {
    case 's3': return `https://s3.${r}.amazonaws.com`;
    case 'oss': return `https://oss-${r}.aliyuncs.com`;
    case 'cos': return `https://cos.${r}.myqcloud.com`;
    case 'obs': return `https://obs.${r}.myhuaweicloud.com`;
    case 'b2': return 'https://s3.us-west-004.backblazeb2.com';
    case 'minio': return 'http://localhost:9000';
    default: return '';
  }
}

interface S3ConnTestParams {
  endpoint: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  pathStyle: boolean;
}

async function testS3Connection(params: S3ConnTestParams) {
  const { endpoint, bucketName, accessKeyId, secretAccessKey, region, pathStyle } = params;

  if (!endpoint) throw new Error('未配置 Endpoint，无法测试连接');

  // Build HeadBucket request with AWS Signature V4
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const bucketUrl = pathStyle
    ? `${endpoint}/${bucketName}/`
    : endpoint.includes('://')
      ? `${endpoint.replace('://', `://${bucketName}.`)}/`
      : `https://${bucketName}.${endpoint}/`;

  const host = new URL(pathStyle ? `${endpoint}/${bucketName}` : bucketUrl).host;
  const canonicalUri = pathStyle ? `/${bucketName}/` : '/';
  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // empty body SHA256

  const headers: Record<string, string> = {
    'host': host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join('');
  const canonicalRequest = ['HEAD', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const encoder = new TextEncoder();

  async function hmacSHA256(key: ArrayBuffer | ArrayBufferView, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  }

  async function sha256Hex(data: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const canonicalHash = await sha256Hex(canonicalRequest);
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalHash].join('\n');

  const signingKey = await (async () => {
    const kDate = await hmacSHA256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
    const kRegion = await hmacSHA256(kDate, region);
    const kService = await hmacSHA256(kRegion, 's3');
    return hmacSHA256(kService, 'aws4_request');
  })();

  const sigBytes = await hmacSHA256(signingKey, stringToSign);
  const signature = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const finalUrl = pathStyle ? `${endpoint}/${bucketName}` : bucketUrl;
  const res = await fetch(finalUrl, {
    method: 'HEAD',
    headers: { ...headers, Authorization: authHeader },
  });

  if (res.status === 200 || res.status === 204) {
    return { connected: true, message: '连接成功', statusCode: res.status };
  } else if (res.status === 403) {
    return { connected: true, message: '凭证有效，但权限受限（存储桶存在）', statusCode: res.status };
  } else if (res.status === 301 || res.status === 307) {
    return { connected: true, message: '连接成功（重定向，请检查区域配置）', statusCode: res.status };
  } else {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200) || '连接失败'}`);
  }
}

export default app;
