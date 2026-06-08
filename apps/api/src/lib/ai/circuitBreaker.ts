/**
 * circuitBreaker.ts — 模型调用熔断器
 *
 * 功能:
 * - 监控模型调用健康状态
 * - 连续失败达到阈值时自动熔断（标记模型不可用）
 * - 超时后自动半开探测恢复
 * - 区分错误类型（模型错误触发熔断，网络超时不触发）
 *
 * 状态机：
 * - closed（正常）：允许调用，失败计数递增
 * - open（熔断）：拒绝调用，等待恢复超时
 * - half-open（半开）：允许一次试探，成功则关闭，失败则重新打开
 *
 * 配置参数：
 * - FAILURE_THRESHOLD = 3：连续失败次数阈值
 * - RECOVERY_TIMEOUT_MS = 10min：熔断恢复时间
 *
 * 使用场景：
 * - 模型服务异常时自动切换备用模型
 * - 防止故障模型持续消耗资源
 * - Agent 引擎集成自动保护
 */

import { logger } from '@osshelf/shared';

interface CircuitState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

const FAILURE_THRESHOLD = 3;
const RECOVERY_TIMEOUT_MS = 10 * 60 * 1000;
const circuitCache = new Map<string, CircuitState>();

export function classifyError(error: unknown): 'model_error' | 'network_timeout' | 'unknown' {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('timeout') || error.message.includes('Timeout')) {
      return 'network_timeout';
    }
    if (error.message.includes('model') || error.message.includes('429') || error.message.includes('rate')) {
      return 'model_error';
    }
  }
  return 'unknown';
}

export async function isModelAvailable(
  modelId: string,
  _env?: { KV: { get: (key: string) => Promise<string | null> } }
): Promise<boolean> {
  const cached = circuitCache.get(modelId);
  if (cached && cached.state === 'open') {
    const elapsed = Date.now() - cached.lastFailureTime;
    if (elapsed < RECOVERY_TIMEOUT_MS) {
      return false;
    }
    cached.state = 'half-open';
    logger.info('CircuitBreaker', 'Circuit half-open, allowing test request', { modelId });
    return true;
  }
  return true;
}

export async function recordModelFailure(modelId: string, error: unknown): Promise<void> {
  const errorType = classifyError(error);

  if (errorType === 'network_timeout') {
    logger.warn('CircuitBreaker', 'Network timeout, not triggering circuit breaker', { modelId });
    return;
  }

  const current = circuitCache.get(modelId) || { failures: 0, lastFailureTime: 0, state: 'closed' as const };
  current.failures += 1;
  current.lastFailureTime = Date.now();

  if (current.failures >= FAILURE_THRESHOLD) {
    current.state = 'open';
    logger.warn('CircuitBreaker', `Circuit OPEN for model ${modelId} after ${current.failures} failures`, { modelId });
  }

  circuitCache.set(modelId, current);
}

export async function recordModelSuccess(modelId: string): Promise<void> {
  const current = circuitCache.get(modelId);
  if (!current) return;

  if (current.state === 'half-open') {
    current.failures = 0;
    current.state = 'closed';
    logger.info('CircuitBreaker', 'Circuit CLOSED after successful test', { modelId });
  } else if (current.state === 'closed') {
    current.failures = Math.max(0, current.failures - 1);
  }
}
