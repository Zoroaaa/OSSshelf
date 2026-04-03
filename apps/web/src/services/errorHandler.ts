/**
 * errorHandler.ts
 * 前端错误处理工具
 *
 * 功能:
 * - 统一 API 错误处理
 * - 错误消息友好化
 * - 错误码映射
 */

import axios from 'axios';
import { ERROR_CODES, type ErrorCode, type ErrorInfo } from '@osshelf/shared';

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    name: string;
    message: string;
    details?: unknown;
    requestId?: string;
    timestamp?: string;
  };
}

export interface ParsedError {
  code: string;
  name: string;
  message: string;
  httpStatus?: number;
  requestId?: string;
  isNetworkError: boolean;
  isTimeout: boolean;
  isAuthError: boolean;
}

export function isApiErrorResponse(data: unknown): data is ApiErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'success' in data &&
    data.success === false &&
    'error' in data &&
    typeof (data as any).error === 'object'
  );
}

export function parseApiError(error: unknown): ParsedError {
  if (axios.isAxiosError(error)) {
    const response = error.response;
    const requestData = response?.data;

    if (isApiErrorResponse(requestData)) {
      const errorInfo = requestData.error;
      const errorCode = errorInfo.name as ErrorCode;
      const mappedInfo = (ERROR_CODES as Record<string, ErrorInfo>)[errorCode];

      return {
        code: errorInfo.code || mappedInfo?.code || 'G000',
        name: errorInfo.name || 'INTERNAL_ERROR',
        message: errorInfo.message || mappedInfo?.message || '请求失败',
        httpStatus: response?.status,
        requestId: errorInfo.requestId,
        isNetworkError: false,
        isTimeout: error.code === 'ECONNABORTED',
        isAuthError: response?.status === 401,
      };
    }

    if (response) {
      const status = response.status;
      let message = '请求失败';
      let name = 'INTERNAL_ERROR';
      let code = 'G000';

      switch (status) {
        case 400:
          message = '请求参数错误';
          name = 'VALIDATION_ERROR';
          code = 'G100';
          break;
        case 401:
          message = '未授权，请先登录';
          name = 'UNAUTHORIZED';
          code = 'A000';
          break;
        case 403:
          message = '权限不足';
          name = 'PERMISSION_DENIED';
          code = 'P000';
          break;
        case 404:
          message = '资源不存在';
          name = 'NOT_FOUND';
          code = 'G000';
          break;
        case 409:
          message = '资源冲突';
          name = 'CONFLICT';
          code = 'G000';
          break;
        case 429:
          message = '请求过于频繁，请稍后重试';
          name = 'RATE_LIMIT_EXCEEDED';
          code = 'G002';
          break;
        case 500:
          message = '服务器内部错误';
          name = 'INTERNAL_ERROR';
          code = 'G000';
          break;
        case 502:
        case 503:
        case 504:
          message = '服务暂时不可用，请稍后重试';
          name = 'SERVICE_UNAVAILABLE';
          code = 'G001';
          break;
      }

      return {
        code,
        name,
        message,
        httpStatus: status,
        isNetworkError: false,
        isTimeout: false,
        isAuthError: status === 401,
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        code: 'G001',
        name: 'TIMEOUT',
        message: '请求超时，请稍后重试',
        isNetworkError: false,
        isTimeout: true,
        isAuthError: false,
      };
    }

    return {
      code: 'G001',
      name: 'NETWORK_ERROR',
      message: '网络错误，请检查网络连接',
      isNetworkError: true,
      isTimeout: false,
      isAuthError: false,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'G000',
      name: 'INTERNAL_ERROR',
      message: error.message || '发生未知错误',
      isNetworkError: false,
      isTimeout: false,
      isAuthError: false,
    };
  }

  return {
    code: 'G000',
    name: 'INTERNAL_ERROR',
    message: '发生未知错误',
    isNetworkError: false,
    isTimeout: false,
    isAuthError: false,
  };
}

export function getErrorMessage(error: unknown): string {
  return parseApiError(error).message;
}

export function getErrorCode(error: unknown): string {
  return parseApiError(error).code;
}

export function isAuthError(error: unknown): boolean {
  return parseApiError(error).isAuthError;
}

export function isNetworkError(error: unknown): boolean {
  return parseApiError(error).isNetworkError;
}

export function isTimeoutError(error: unknown): boolean {
  return parseApiError(error).isTimeout;
}

export function shouldRedirectToLogin(error: unknown): boolean {
  const parsed = parseApiError(error);
  return parsed.isAuthError && !parsed.isNetworkError;
}

export function getErrorToast(error: unknown): {
  title: string;
  description: string;
  variant: 'destructive' | 'default';
} {
  const parsed = parseApiError(error);

  let title = '操作失败';

  if (parsed.isNetworkError) {
    title = '网络错误';
  } else if (parsed.isTimeout) {
    title = '请求超时';
  } else if (parsed.isAuthError) {
    title = '登录已过期';
  } else if (parsed.httpStatus && parsed.httpStatus >= 500) {
    title = '服务器错误';
  }

  return {
    title,
    description: parsed.message,
    variant: 'destructive',
  };
}

export function logError(error: unknown, context?: string): void {
  const parsed = parseApiError(error);

  console.error('[Error]', {
    context,
    code: parsed.code,
    name: parsed.name,
    message: parsed.message,
    httpStatus: parsed.httpStatus,
    requestId: parsed.requestId,
    isNetworkError: parsed.isNetworkError,
    isTimeout: parsed.isTimeout,
  });
}

export function createErrorReporter(context: string) {
  return (error: unknown) => logError(error, context);
}
