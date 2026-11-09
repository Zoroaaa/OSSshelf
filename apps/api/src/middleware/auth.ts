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
import { ERROR_CODES, logger } from '@osshelf/shared';
import type { Env, Variables, AppContext } from '../types/env';

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

  return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED.code, message: '未提供认证令牌' } }, 401);
};

async function handleJwtAuth(c: AppContext, next: () => Promise<void>, token: string) {
  try {
    const decoded = await verifyJWT(token, c.env.JWT_SECRET);

    const session = await c.env.KV.get(`session:${token}`);
    if (!session) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.SESSION_EXPIRED.code, message: '会话已过期，请重新登录' } },
        401
      );
    }

    const db = getDb(c.env.DB);
    const user = await db.select().from(users).where(eq(users.id, decoded.userId)).get();

    if (!user) {
      return c.json({ success: false, error: { code: ERROR_CODES.USER_NOT_FOUND.code, message: '用户不存在' } }, 401);
    }

    if (user.passwordChangedAt && decoded.iat) {
      const passwordChangedAt = new Date(user.passwordChangedAt).getTime() / 1000;
      if (passwordChangedAt > decoded.iat) {
        await c.env.KV.delete(`session:${token}`);
        return c.json(
          { success: false, error: { code: ERROR_CODES.TOKEN_EXPIRED.code, message: '密码已更改，请重新登录' } },
          401
        );
      }
    }

    c.set('userId', decoded.userId);
    c.set('user', { id: decoded.userId, email: decoded.email, role: decoded.role });
    c.set('authType', 'jwt');

    await next();
  } catch {
    return c.json(
      { success: false, error: { code: ERROR_CODES.TOKEN_INVALID.code, message: '令牌无效或已过期' } },
      401
    );
  }
}

async function handleApiKeyAuth(c: AppContext, next: () => Promise<void>, apiKey: string) {
  if (!apiKey.startsWith('osk_live_')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.TOKEN_INVALID.code, message: '无效的 API Key 格式' } },
      401
    );
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
        { success: false, error: { code: ERROR_CODES.TOKEN_INVALID.code, message: 'API Key 无效或已被撤销' } },
        401
      );
    }

    if (keyRecord.expiresAt) {
      const expiresAt = new Date(keyRecord.expiresAt);
      if (expiresAt < new Date()) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.TOKEN_EXPIRED.code, message: 'API Key 已过期' } },
          401
        );
      }
    }

    const user = await db.select().from(users).where(eq(users.id, keyRecord.userId)).get();
    if (!user) {
      return c.json({ success: false, error: { code: ERROR_CODES.USER_NOT_FOUND.code, message: '用户不存在' } }, 401);
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
    logger.error('AUTH', 'API Key验证失败', {}, error);
    return c.json(
      { success: false, error: { code: ERROR_CODES.TOKEN_INVALID.code, message: 'API Key 验证失败' } },
      401
    );
  }
}
/**
 * API Key 可用的权限作用域。
 * 注意：JWT 登录用户不受这些 scope 限制（scope 只约束 API Key）。
 */
export type ApiKeyScope =
  | 'files:read'
  | 'files:write'
  | 'shares:read'
  | 'shares:write'
  | 'buckets:read'
  | 'api_keys:read';

/**
 * 按 HTTP 方法对 API Key 做 scope 校验：
 * - 读请求（GET/HEAD/OPTIONS）需要 readScope
 * - 写请求需要 writeScope
 * - 持有 writeScope 的 Key 也允许读
 *
 * JWT 身份直接放行，保持原有登录态行为不变。
 */
export function requireApiKeyScope(readScope: ApiKeyScope, writeScope: ApiKeyScope): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get('authType') !== 'apiKey') {
      await next();
      return;
    }

    const scopes = (c.get('apiKeyScopes') as string[] | undefined) ?? [];
    const method = c.req.method.toUpperCase();
    const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    const required = isRead ? readScope : writeScope;

    if (!scopes.includes(required) && !scopes.includes(writeScope)) {
      return c.json(
        {
          success: false,
          error: { code: ERROR_CODES.FORBIDDEN.code, message: `API Key 缺少所需权限: ${required}` },
        },
        403
      );
    }

    await next();
  };
}

/**
 * 拒绝 API Key 身份访问（仅允许登录令牌）。
 * 用于 API Key 自助管理、权限/团队等尚未定义 scope 的敏感接口，
 * 防止低权限 Key 通过这些接口提权。
 */
export function denyApiKeyAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get('authType') === 'apiKey') {
      return c.json(
        {
          success: false,
          error: { code: ERROR_CODES.FORBIDDEN.code, message: '该接口不支持 API Key 认证，请使用登录令牌' },
        },
        403
      );
    }
    await next();
  };
}

/**
 * 管理员校验（以数据库中的角色为准，避免 JWT 内角色过期）。
 * 用于系统级配置、全局快照等仅管理员可操作的接口。
 */
export function requireAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ success: false, error: { code: ERROR_CODES.UNAUTHORIZED.code, message: '未认证' } }, 401);
    }

    const db = getDb(c.env.DB);
    const user = await db.select().from(users).where(eq(users.id, userId)).get();

    if (!user || user.role !== 'admin') {
      return c.json(
        {
          success: false,
          error: { code: ERROR_CODES.ADMIN_REQUIRED.code, message: ERROR_CODES.ADMIN_REQUIRED.message },
        },
        403
      );
    }

    c.set('user', { id: user.id, email: user.email, role: user.role });
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
