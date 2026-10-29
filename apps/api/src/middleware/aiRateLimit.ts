/**
 * middleware/aiRateLimit.ts
 * AI 分钟级限流 + 日配额
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env';
import { checkAiQuota } from '../lib/ai/usage';

type AiContext = { Bindings: Env; Variables: Variables };

const REASON_MESSAGE: Record<string, string> = {
  rate_limit: 'AI 请求过于频繁，请稍后再试',
  request_quota: '今日 AI 调用次数已达上限',
  token_quota: '今日 AI Token 配额已用完',
};

export function aiRateLimit(): MiddlewareHandler<AiContext> {
  return async (c, next) => {
    const userId = c.get('userId');
    if (!userId) return next();

    const decision = await checkAiQuota(c.env, userId);
    if (decision.allowed) return next();

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
  };
}
