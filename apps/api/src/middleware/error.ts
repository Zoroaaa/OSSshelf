/**
 * error.ts
 * 错误处理中间件
 *
 * 功能:
 * - 全局异常捕获
 * - 统一错误响应格式
 * - 错误日志记录
 */

import type { MiddlewareHandler } from 'hono';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';

type AppEnv = { Bindings: Env; Variables: Variables };

/**
 * 带 HTTP 状态码的业务错误，可在路由中直接 throw 以跳过逐层 return。
 * 例: throw new AppError(403, ERROR_CODES.FORBIDDEN, '无权操作')
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: 400 | 401 | 403 | 404 | 409 | 429 | 500,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    await next();
  } catch (error) {
    // 已知业务错误（AppError）直接序列化
    if (error instanceof AppError) {
      return c.json({ success: false, error: { code: error.code, message: error.message } }, error.statusCode);
    }

    console.error('Unhandled error:', error);

    if (error instanceof Error) {
      // 保留兜底的字符串映射，但不依赖它处理正常业务流程
      const status = getErrorStatus(error.message);
      return c.json({ success: false, error: { code: getErrorCode(error.message), message: error.message } }, status);
    }

    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '服务器内部错误' } }, 500);
  }
};

function getErrorStatus(message: string): 401 | 403 | 404 | 400 | 500 {
  if (message.includes('未授权') || message.includes('token')) return 401;
  if (message.includes('无权限') || message.includes('禁止')) return 403;
  if (message.includes('不存在') || message.includes('未找到')) return 404;
  if (message.includes('已存在') || message.includes('验证')) return 400;
  return 500;
}

function getErrorCode(message: string): string {
  if (message.includes('未授权') || message.includes('token')) return ERROR_CODES.UNAUTHORIZED;
  if (message.includes('无权限') || message.includes('禁止')) return ERROR_CODES.FORBIDDEN;
  if (message.includes('不存在') || message.includes('未找到')) return ERROR_CODES.NOT_FOUND;
  if (message.includes('验证')) return ERROR_CODES.VALIDATION_ERROR;
  return ERROR_CODES.INTERNAL_ERROR;
}
