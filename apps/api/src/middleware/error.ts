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

export const errorHandler: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    await next();
  } catch (error) {
    console.error('Unhandled error:', error);

    if (error instanceof Error) {
      const status = getErrorStatus(error.message);
      return c.json(
        { success: false, error: { code: getErrorCode(error.message), message: error.message } },
        status,
      );
    }

    return c.json(
      { success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '服务器内部错误' } },
      500,
    );
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
