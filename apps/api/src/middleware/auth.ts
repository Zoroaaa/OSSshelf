/**
 * auth.ts
 * 认证中间件
 *
 * 功能:
 * - JWT令牌验证
 * - API Key 验证
 * - 用户身份注入
 *
 * 认证优先级:
 * 1. Authorization: Bearer <jwt>
 * 2. Authorization: ApiKey osk_live_xxxx
 * 3. X-API-Key: osk_live_xxxx header
 */

import type { MiddlewareHandler } from 'hono';
import { eq, and } from 'drizzle-orm';
import { verifyJWT } from '../lib/crypto';
import { getDb, apiKeys, users } from '../db';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';

type AppEnv = { Bindings: Env; Variables: Variables };

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization') || '';
  const xApiKey = c.req.header('X-API-Key');

  if (authHeader.startsWith('Bearer ')) {
    return await handleJwtAuth(c, next, authHeader.slice(7));
  }

  if (authHeader.startsWith('ApiKey ')) {
    return await handleApiKeyAuth(c, next, authHeader.slice(7));
  }

  if (xApiKey) {
    return await handleApiKeyAuth(c, next, xApiKey);
  }

  return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '未提供认证令牌' } }, 401);
};

async function handleJwtAuth(c: any, next: () => Promise<void>, token: string) {
  try {
    const decoded = await verifyJWT(token, c.env.JWT_SECRET);

    const session = await c.env.KV.get(`session:${token}`);
    if (!session) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '会话已过期，请重新登录' } },
        401
      );
    }

    const db = getDb(c.env.DB);
    const user = await db.select().from(users).where(eq(users.id, decoded.userId)).get();

    if (!user) {
      return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '用户不存在' } }, 401);
    }

    if (user.passwordChangedAt && decoded.iat) {
      const passwordChangedAt = new Date(user.passwordChangedAt).getTime() / 1000;
      if (passwordChangedAt > decoded.iat) {
        await c.env.KV.delete(`session:${token}`);
        return c.json(
          { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '密码已更改，请重新登录' } },
          401
        );
      }
    }

    c.set('userId', decoded.userId);
    c.set('user', { id: decoded.userId, email: decoded.email, role: decoded.role });
    c.set('authType', 'jwt');

    await next();
  } catch {
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '令牌无效或已过期' } }, 401);
  }
}

async function handleApiKeyAuth(c: any, next: () => Promise<void>, apiKey: string) {
  if (!apiKey.startsWith('osk_live_')) {
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '无效的 API Key 格式' } }, 401);
  }

  try {
    const keyHash = await sha256(apiKey);
    const db = getDb(c.env.DB);

    const keyRecord = await db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        scopes: apiKeys.scopes,
        expiresAt: apiKeys.expiresAt,
        isActive: apiKeys.isActive,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)))
      .get();

    if (!keyRecord) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: 'API Key 无效或已被撤销' } },
        401
      );
    }

    if (keyRecord.expiresAt) {
      const expiresAt = new Date(keyRecord.expiresAt);
      if (expiresAt < new Date()) {
        return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: 'API Key 已过期' } }, 401);
      }
    }

    const user = await db.select().from(users).where(eq(users.id, keyRecord.userId)).get();
    if (!user) {
      return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '用户不存在' } }, 401);
    }

    const now = new Date().toISOString();
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, keyRecord.id));

    c.set('userId', keyRecord.userId);
    c.set('user', { id: user.id, email: user.email, role: user.role });
    c.set('authType', 'apiKey');
    c.set('apiKeyId', keyRecord.id);
    c.set('apiKeyScopes', JSON.parse(keyRecord.scopes));

    await next();
  } catch (error) {
    console.error('API Key auth error:', error);
    return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: 'API Key 验证失败' } }, 401);
  }
}

export function requireScope(scopes: string | string[]): MiddlewareHandler<AppEnv> {
  const requiredScopes = Array.isArray(scopes) ? scopes : [scopes];

  return async (c, next) => {
    const authType = c.get('authType');

    if (authType === 'jwt') {
      await next();
      return;
    }

    const apiKeyScopes = c.get('apiKeyScopes') as string[] | undefined;

    if (!apiKeyScopes) {
      return c.json({ success: false, error: { code: ERROR_CODES.FORBIDDEN, message: '权限不足' } }, 403);
    }

    const hasScope = requiredScopes.some((scope) => apiKeyScopes.includes(scope));
    if (!hasScope) {
      return c.json(
        {
          success: false,
          error: { code: ERROR_CODES.FORBIDDEN, message: `需要以下权限之一: ${requiredScopes.join(', ')}` },
        },
        403
      );
    }

    await next();
  };
}

export function requireEmailVerification(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '未认证' } }, 401);
    }

    const db = getDb(c.env.DB);
    const user = await db.select().from(users).where(eq(users.id, userId)).get();

    if (!user) {
      return c.json({ success: false, error: { code: ERROR_CODES.USER_NOT_FOUND, message: '用户不存在' } }, 404);
    }

    if (!user.emailVerified) {
      return c.json(
        {
          success: false,
          error: { code: 'EMAIL_NOT_VERIFIED', message: '请先验证邮箱后再使用此功能' },
        },
        403
      );
    }

    await next();
  };
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
