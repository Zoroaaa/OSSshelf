/**
 * apiKeys.ts
 * API Key 管理路由
 *
 * 功能:
 * - 创建/列出/删除 API Key
 * - Scope 权限管理
 * - 安全存储（SHA-256 哈希）
 */

import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, apiKeys, users } from '../db';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const VALID_SCOPES = ['files:read', 'files:write', 'shares:read', 'shares:write', 'buckets:read', 'api_keys:read'];

const createApiKeySchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称过长'),
  scopes: z.array(z.string()).min(1, '至少选择一个权限'),
  expiresAt: z.string().optional(),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称过长').optional(),
  scopes: z.array(z.string()).min(1, '至少选择一个权限').optional(),
  isActive: z.boolean().optional(),
});

app.use('/*', authMiddleware);

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      isActive: apiKeys.isActive,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt))
    .all();

  return c.json({
    success: true,
    data: keys.map((k) => ({
      ...k,
      scopes: JSON.parse(k.scopes),
    })),
  });
});

app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createApiKeySchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { name, scopes, expiresAt } = result.data;

  const invalidScopes = scopes.filter((s) => !VALID_SCOPES.includes(s));
  if (invalidScopes.length > 0) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: `无效的权限: ${invalidScopes.join(', ')}` },
      },
      400
    );
  }

  const user = c.get('user');
  if (scopes.includes('api_keys:read') && user?.role !== 'admin') {
    return c.json(
      { success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '只有管理员可以授予 api_keys:read 权限' } },
      403
    );
  }

  const rawKey = generateApiKey();
  const keyHash = await sha256(rawKey);
  const keyPrefix = rawKey.slice(0, 12) + '...';

  const keyId = crypto.randomUUID();
  const now = new Date().toISOString();

  const db = getDb(c.env.DB);
  await db.insert(apiKeys).values({
    id: keyId,
    userId,
    name,
    keyHash,
    keyPrefix,
    scopes: JSON.stringify(scopes),
    lastUsedAt: null,
    expiresAt: expiresAt || null,
    isActive: true,
    createdAt: now,
  });

  return c.json({
    success: true,
    data: {
      id: keyId,
      name,
      key: rawKey,
      keyPrefix,
      scopes,
      expiresAt,
      createdAt: now,
      warning: '请妥善保存此 API Key，系统不会再次显示完整密钥',
    },
  });
});

app.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const keyId = c.req.param('id');
  const db = getDb(c.env.DB);

  const key = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      isActive: apiKeys.isActive,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .get();

  if (!key) {
    throwAppError('API_KEY_NOT_FOUND', 'API Key 不存在');
  }

  return c.json({
    success: true,
    data: {
      ...key,
      scopes: JSON.parse(key.scopes),
    },
  });
});

app.patch('/:id', async (c) => {
  const userId = c.get('userId')!;
  const keyId = c.req.param('id');
  const body = await c.req.json();
  const result = updateApiKeySchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { name, scopes, isActive } = result.data;
  const db = getDb(c.env.DB);

  const key = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .get();

  if (!key) {
    throwAppError('API_KEY_NOT_FOUND', 'API Key 不存在');
  }

  if (scopes) {
    const invalidScopes = scopes.filter((s) => !VALID_SCOPES.includes(s));
    if (invalidScopes.length > 0) {
      return c.json(
        {
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: `无效的权限: ${invalidScopes.join(', ')}` },
        },
        400
      );
    }

    const user = c.get('user');
    if (scopes.includes('api_keys:read') && user?.role !== 'admin') {
      return c.json(
        { success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '只有管理员可以授予 api_keys:read 权限' } },
        403
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (scopes !== undefined) updateData.scopes = JSON.stringify(scopes);
  if (isActive !== undefined) updateData.isActive = isActive ? 1 : 0;

  if (Object.keys(updateData).length > 0) {
    await db.update(apiKeys).set(updateData).where(eq(apiKeys.id, keyId));
  }

  return c.json({
    success: true,
    data: { message: 'API Key 已更新' },
  });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const keyId = c.req.param('id');
  const db = getDb(c.env.DB);

  const key = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .get();

  if (!key) {
    throwAppError('API_KEY_NOT_FOUND', 'API Key 不存在');
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, keyId));

  return c.json({
    success: true,
    data: { message: 'API Key 已删除' },
  });
});

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const keyBody = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `osk_live_${keyBody}`;
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default app;
