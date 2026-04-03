/**
 * error.ts
 * 错误处理中间件
 *
 * 功能:
 * - 全局异常捕获
 * - 统一错误响应格式
 * - 错误日志记录
 * - 请求追踪
 */

import type { MiddlewareHandler, Context } from 'hono';
import { ERROR_CODES, type ErrorCode, logger } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';

type AppEnv = { Bindings: Env; Variables: Variables };

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    name: string;
    message: string;
    details?: unknown;
    stack?: string;
    requestId: string;
    timestamp: string;
  };
}

export class AppError extends Error {
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(
    public readonly errorCode: ErrorCode,
    options?: { details?: unknown; message?: string }
  ) {
    const errorInfo = ERROR_CODES[errorCode];
    super(options?.message || errorInfo.message);
    this.name = errorCode;
    this.httpStatus = errorInfo.httpStatus;
    this.details = options?.details;
  }

  static fromCode(code: ErrorCode, message?: string): AppError {
    return new AppError(code, { message });
  }

  static withDetails(code: ErrorCode, details: unknown, message?: string): AppError {
    return new AppError(code, { details, message });
  }
}

export function createErrorResponse(c: Context<AppEnv>, error: AppError | Error | unknown): Response {
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const isDev = c.env.ENVIRONMENT === 'development';

  if (error instanceof AppError) {
    const errorInfo = ERROR_CODES[error.errorCode];
    const response: ErrorResponse = {
      success: false,
      error: {
        code: errorInfo.code,
        name: error.errorCode,
        message: error.message,
        details: isDev ? error.details : undefined,
        stack: isDev ? error.stack : undefined,
        requestId,
        timestamp,
      },
    };
    return c.json(response, error.httpStatus as 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 500 | 502 | 503 | 507);
  }

  if (error instanceof Error) {
    logger.error('ERROR', '未处理错误', {}, error);
    const response: ErrorResponse = {
      success: false,
      error: {
        code: 'G000',
        name: 'INTERNAL_ERROR',
        message: isDev ? error.message : '服务器内部错误',
        details: isDev ? { originalError: error.message } : undefined,
        stack: isDev ? error.stack : undefined,
        requestId,
        timestamp,
      },
    };
    return c.json(response, 500);
  }

  logger.error('ERROR', '未知错误类型', {}, error);
  const response: ErrorResponse = {
    success: false,
    error: {
      code: 'G000',
      name: 'INTERNAL_ERROR',
      message: '服务器内部错误',
      requestId,
      timestamp,
    },
  };
  return c.json(response, 500);
}

export const errorHandler: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    await next();
  } catch (error) {
    return createErrorResponse(c, error);
  }
};

export function throwAppError(code: ErrorCode, message?: string): never {
  throw new AppError(code, { message });
}

export function throwWithDetails(code: ErrorCode, details: unknown, message?: string): never {
  throw new AppError(code, { details, message });
}
