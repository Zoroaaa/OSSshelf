/**
 * aiErrors.ts
 * AI 层统一错误分类
 *
 * 目标:
 * - 上游错误 → 稳定的业务错误码（供 API/Agent/前端一致处理）
 * - 明确可重试性，避免对不可重试错误做无效重试
 */

export type AiErrorCode =
  | 'AI_UNAUTHORIZED'
  | 'AI_RATE_LIMIT'
  | 'AI_CONFIG_INVALID'
  | 'AI_CONTEXT_OVERFLOW'
  | 'AI_TIMEOUT'
  | 'AI_UPSTREAM_ERROR'
  | 'AI_TOOL_FAILED';

const STATUS_BY_CODE: Record<AiErrorCode, number> = {
  AI_UNAUTHORIZED: 401,
  AI_RATE_LIMIT: 429,
  AI_CONFIG_INVALID: 400,
  AI_CONTEXT_OVERFLOW: 400,
  AI_TIMEOUT: 504,
  AI_UPSTREAM_ERROR: 502,
  AI_TOOL_FAILED: 500,
};

const RETRYABLE: Record<AiErrorCode, boolean> = {
  AI_UNAUTHORIZED: false,
  AI_RATE_LIMIT: true,
  AI_CONFIG_INVALID: false,
  AI_CONTEXT_OVERFLOW: false,
  AI_TIMEOUT: true,
  AI_UPSTREAM_ERROR: true,
  AI_TOOL_FAILED: false,
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: AiErrorCode, message: string, options?: { cause?: unknown; retryable?: boolean }) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.retryable = options?.retryable ?? RETRYABLE[code];
    if (options?.cause !== undefined) this.cause = options.cause;
  }

  toJSON(): { code: AiErrorCode; message: string; retryable: boolean } {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

/**
 * 把 provider / fetch / AI SDK 抛出的错误映射为 AiError。
 * 优先读取结构化字段（status/statusCode），再退回 message 关键字。
 */
export function mapAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;

  const err = error as {
    name?: string;
    message?: string;
    status?: number;
    statusCode?: number;
    cause?: { status?: number; message?: string };
  };

  const name = err?.name ?? '';
  const message = err?.message ?? String(error);
  const status = err?.status ?? err?.statusCode ?? err?.cause?.status;

  if (name === 'AbortError') {
    return new AiError('AI_TIMEOUT', 'AI 请求已取消或超时', { cause: error });
  }

  // 模型下线（如 llava-1.5 返回 410），换参数重试也没有意义
  if (status === 410 || /model.*(deprecated|removed|sunset)|no longer available/i.test(message)) {
    return new AiError('AI_CONFIG_INVALID', '该模型已下线或不可用，请更换模型', { cause: error });
  }

  if (status === 401 || status === 403 || /invalid.*api.*key|unauthorized/i.test(message)) {
    return new AiError('AI_UNAUTHORIZED', 'AI 服务鉴权失败，请检查模型配置', { cause: error });
  }

  if (status === 429 || /rate.?limit|too many requests/i.test(message)) {
    return new AiError('AI_RATE_LIMIT', 'AI 服务限流，请稍后重试', { cause: error });
  }

  if (/context.*(length|window)|maximum context|too many tokens/i.test(message)) {
    return new AiError('AI_CONTEXT_OVERFLOW', '对话上下文超出模型限制', { cause: error });
  }

  // 部分模型（如 llama-3.2-11b-vision）首次使用前需显式接受许可，否则直接拒绝推理
  if (/must submit the prompt ['"]?agree/i.test(message)) {
    return new AiError(
      'AI_UNAUTHORIZED',
      '该模型需先接受许可协议：请在 Cloudflare Dashboard 打开该模型页面点击 Agree，或手动发送一次 {"prompt":"agree"} 后再试',
      { cause: error }
    );
  }

  if (name === 'TimeoutError' || /timeout|timed out/i.test(message)) {
    return new AiError('AI_TIMEOUT', 'AI 模型响应超时', { cause: error });
  }

  if (typeof status === 'number' && status >= 500) {
    return new AiError('AI_UPSTREAM_ERROR', 'AI 上游服务异常', { cause: error });
  }

  return new AiError('AI_UPSTREAM_ERROR', message || 'AI 调用失败', { cause: error });
}
