/**
 * auth.ts
 * 认证中间件
 * 
 * 功能:
 * - JWT令牌验证
 * - 用户身份注入
 * - 权限检查
 */

import type { MiddlewareHandler } from 'hono';
import { verifyJWT } from '../lib/crypto';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';

type AppEnv = { Bindings: Env; Variables: Variables };

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '未提供认证令牌' } },
      401,
    );
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await verifyJWT(token, c.env.JWT_SECRET);

    const session = await c.env.KV.get(`session:${token}`);
    if (!session) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '会话已过期，请重新登录' } },
        401,
      );
    }

    c.set('userId', decoded.userId);
    c.set('user', { id: decoded.userId, email: decoded.email, role: decoded.role });

    await next();
  } catch {
    return c.json(
      { success: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: '令牌无效或已过期' } },
      401,
    );
  }
};

export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = await verifyJWT(token, c.env.JWT_SECRET);
      c.set('userId', decoded.userId);
      c.set('user', { id: decoded.userId, email: decoded.email, role: decoded.role });
    } catch {
      // continue without auth
    }
  }

  await next();
};
