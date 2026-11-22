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

import type { MiddlewareHandler, Context, Hono } from 'hono';
import { ERROR_CODES, type ErrorCode, logger } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { isFileNameConflictError } from '../lib/dbErrors';

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
    // 兜底：即便传入未登记的码，也降级为 INTERNAL_ERROR，避免构造阶段读取 undefined.httpStatus 崩溃
    const errorInfo = ERROR_CODES[errorCode] ?? ERROR_CODES.INTERNAL_ERROR;
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
    const errorInfo = ERROR_CODES[error.errorCode] ?? ERROR_CODES.INTERNAL_ERROR;
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

  // 迁移 119：文件命名唯一约束冲突（并发下未预检到的重名）统一按 409 返回，
  // 避免 WebDAV/分享转存等未单独包装的写入路径冒出 500。
  if (isFileNameConflictError(error)) {
    return createErrorResponse(
      c,
      new AppError('FILE_ALREADY_EXISTS', { message: '同名文件或文件夹已存在，请重命名后重试' })
    );
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

/**
 * 给子应用安装统一错误处理。
 *
 * 背景（本地冒烟测试发现）：Hono 的 app.route() 挂载的子应用有独立的 onError，
 * 子应用内 throw 的 AppError 不会冒泡到父应用 app.use('*', errorHandler)，
 * 而是被 Hono 默认处理器转成纯文本 500（业务状态码与错误码全部丢失）。
 * 典型表现：GET /api/notes/:fileId 无权限时应为 403，实际返回 500。
 *
 * 因此所有通过 app.route() 挂载的子应用都必须显式安装同一套 onError。
 */
export function installErrorHandler<T extends Hono<any, any, any>>(app: T): T {
  app.onError((err, c) => createErrorResponse(c as unknown as Context<AppEnv>, err));
  return app;
}

/** 供 Hono onError 直接使用的处理函数（主应用兜底） */
export function onAppError(err: Error, c: Context<any>): Response {
  return createErrorResponse(c as unknown as Context<AppEnv>, err);
}

export function throwAppError(code: ErrorCode, message?: string): never {
  throw new AppError(code, { message });
}
