/**
 * middleware/aiRateLimit.ts
 * AI 分钟级限流 + 日配额（原子预扣）
 *
 * 通过 reserveAiQuota 在请求进入时原子预扣一次调用与估算 token：
 * - 并发 burst 会被 D1 单条条件 upsert 串行化，无法同时穿透
 * - 处理函数可用 c.set('aiUsageTokens', n) 上报真实用量，结束时自动结算差额
 * - 未上报真实用量时保留估算值，避免 token 配额被同步接口绕过
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env';
import { reserveAiQuota } from '../lib/ai/usage';

type AiContext = { Bindings: Env; Variables: Variables };

const REASON_MESSAGE: Record<string, string> = {
  rate_limit: 'AI 请求过于频繁，请稍后再试',
  request_quota: '今日 AI 调用次数已达上限',
  token_quota: '今日 AI Token 配额已用完',
};

export function aiRateLimit(options: { estimatedTokens?: number } = {}): MiddlewareHandler<AiContext> {
  return async (c, next) => {
    const userId = c.get('userId');
    if (!userId) return next();

    const result = await reserveAiQuota(c.env, userId, { estimatedTokens: options.estimatedTokens });
    if (!result.allowed || !result.reservation) {
      const decision = result.decision;
      const message = REASON_MESSAGE[decision.reason ?? 'rate_limit'] ?? 'AI 配额不足';

      return c.json(
        {
          success: false,
          error: {
            code: decision.reason === 'rate_limit' ? 'AI_RATE_LIMIT' : 'AI_QUOTA_EXCEEDED',
            message,
            quota: {
              usedTokens: decision.usedTokens,
              tokenLimit: decision.tokenLimit,
              usedRequests: decision.usedRequests,
              requestLimit: decision.requestLimit,
            },
          },
        },
        429
      );
    }

    try {
      await next();
    } catch (error) {
      await result.reservation.release();
      throw error;
    }

    const actualTokens = c.get('aiUsageTokens');
    if (typeof actualTokens === 'number' && Number.isFinite(actualTokens)) {
      await result.reservation.settle(actualTokens);
    }
  };
}
