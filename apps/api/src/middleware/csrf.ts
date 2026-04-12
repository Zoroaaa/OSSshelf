/**
 * csrf.ts
 * CSRF保护中间件
 *
 * 功能:
 * - 保护写操作（POST/PUT/DELETE/PATCH）免受跨站请求伪造攻击
 * - 使用HMAC签名验证请求来源
 * - 支持时间戳防重放攻击
 */

import type { MiddlewareHandler } from 'hono';
import { logger, ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';

type AppEnv = { Bindings: Env; Variables: Variables };

const REQUEST_EXPIRY_MS = 5 * 60 * 1000;

export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    return next();
  }

  const authType = c.get('authType');
  if (authType === 'apiKey') {
    return next();
  }

  const requestSignature = c.req.header('X-Request-Signature');
  const requestTimestamp = c.req.header('X-Request-Timestamp');

  if (!requestSignature || !requestTimestamp) {
    logger.warn('CSRF', 'Missing CSRF headers', {
      method: c.req.method,
      path: c.req.path,
      hasSignature: !!requestSignature,
      hasTimestamp: !!requestTimestamp,
    });
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN.code,
          message: '缺少安全验证头',
        },
      },
      403
    );
  }

  const now = Date.now();
  const requestTime = parseInt(requestTimestamp, 10);

  if (isNaN(requestTime)) {
    logger.warn('CSRF', 'Invalid timestamp format', { timestamp: requestTimestamp });
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN.code,
          message: '无效的时间戳格式',
        },
      },
      403
    );
  }

  if (Math.abs(now - requestTime) > REQUEST_EXPIRY_MS) {
    logger.warn('CSRF', 'Request expired', {
      requestTime,
      currentTime: now,
      diffMs: Math.abs(now - requestTime),
    });
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN.code,
          message: '请求已过期，请刷新页面后重试',
        },
      },
      403
    );
  }

  try {
    const body = await c.req.text();
    const expectedSignature = await generateRequestSignature(
      c.env.JWT_SECRET,
      requestTimestamp,
      c.req.method,
      c.req.path,
      body
    );

    if (requestSignature !== expectedSignature) {
      logger.warn('CSRF', 'Invalid request signature', {
        method: c.req.method,
        path: c.req.path,
        expectedPrefix: expectedSignature.slice(0, 8),
        receivedPrefix: requestSignature.slice(0, 8),
      });
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.FORBIDDEN.code,
            message: '请求签名验证失败',
          },
        },
        403
      );
    }
  } catch (error) {
    logger.error('CSRF', 'Signature verification failed', {}, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN.code,
          message: '请求验证失败',
        },
      },
      403
    );
  }

  return next();
};

export async function generateRequestSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string
): Promise<string> {
  const message = `${method}:${path}:${timestamp}:${body}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const signatureArray = Array.from(new Uint8Array(signature));
  return signatureArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createCsrfHeaders(
  secret: string,
  method: string,
  path: string,
  body: string = ''
): Promise<{ 'X-Request-Signature': string; 'X-Request-Timestamp': string }> {
  const timestamp = Date.now().toString();
  return generateRequestSignature(secret, timestamp, method, path, body).then((signature) => ({
    'X-Request-Signature': signature,
    'X-Request-Timestamp': timestamp,
  }));
}
