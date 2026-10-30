/**
 * logger.ts
 * 统一日志工具
 *
 * 功能:
 * - 结构化日志输出
 * - 上下文信息记录
 * - 错误追踪
 *
 * 前后端共用，确保日志格式一致
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: LogContext;
  error?: string;
  stack?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLogLevel: LogLevel = 'info';

function formatTimestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

function createLogEntry(
  level: LogLevel,
  context: string,
  message: string,
  data?: LogContext,
  error?: unknown
): LogEntry {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    context,
    message,
  };

  if (data && Object.keys(data).length > 0) {
    entry.data = data;
  }

  if (error instanceof Error) {
    entry.error = error.message;
    entry.stack = error.stack;
  } else if (error !== undefined) {
    entry.error = String(error);
  }

  return entry;
}

function outputLog(entry: LogEntry): void {
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.context}]`;
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  const errorStr = entry.error ? ` Error: ${entry.error}` : '';

  switch (entry.level) {
    case 'debug':
      console.log(`${prefix} ${entry.message}${dataStr}${errorStr}`);
      break;
    case 'info':
      console.log(`${prefix} ${entry.message}${dataStr}${errorStr}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${entry.message}${dataStr}${errorStr}`);
      break;
    case 'error':
      console.error(`${prefix} ${entry.message}${dataStr}${errorStr}`);
      if (entry.stack) {
        console.error(entry.stack);
      }
      break;
  }
}

export const logger = {
  debug: (context: string, message: string, data?: LogContext): void => {
    if (!shouldLog('debug')) return;
    outputLog(createLogEntry('debug', context, message, data));
  },

  info: (context: string, message: string, data?: LogContext): void => {
    if (!shouldLog('info')) return;
    outputLog(createLogEntry('info', context, message, data));
  },

  warn: (context: string, message: string, data?: LogContext, error?: unknown): void => {
    if (!shouldLog('warn')) return;
    outputLog(createLogEntry('warn', context, message, data, error));
  },

  error: (context: string, message: string, data?: LogContext, error?: unknown): void => {
    if (!shouldLog('error')) return;
    outputLog(createLogEntry('error', context, message, data, error));
  },
};

export function logAiError(operation: string, fileId: string, error: unknown): void {
  logger.error('AI', `${operation} 失败`, { fileId }, error);
}

export function logCleanupError(task: string, error: unknown): void {
  logger.error('CLEANUP', `${task} 清理失败`, {}, error);
}
