/**
 * usage.ts
 * AI 用量记账与配额
 *
 * 原则:
 * - 每次模型调用（含工具轮次汇总）写一条 ai_usage_events
 * - token 优先使用 provider 返回的真实 usage；缺失时由调用方传入估算值
 * - 配额/限流统一从 ai_config 读取，避免硬编码
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, aiUsageEvents } from '../../db';
import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';
import { getAiConfigNumber } from './aiConfigService';

export interface UsageEventInput {
  userId: string;
  sessionId?: string | null;
  requestId?: string | null;
  feature?: string;
  provider: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  latencyMs?: number;
  toolCalls?: number;
  status?: 'completed' | 'error' | 'aborted';
  errorCode?: string | null;
}

export interface UsageSummary {
  totals: { inputTokens: number; outputTokens: number; requests: number };
  byDay: Array<{ day: string; inputTokens: number; outputTokens: number; requests: number }>;
  byModel: Array<{ modelId: string; inputTokens: number; outputTokens: number; requests: number }>;
  byFeature: Array<{ feature: string; inputTokens: number; outputTokens: number; requests: number }>;
}

function startOfUtcDay(date = new Date()): string {
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

export async function recordUsage(env: Env, input: UsageEventInput): Promise<void> {
  try {
    const db = getDb(env.DB);
    await db.insert(aiUsageEvents).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      requestId: input.requestId ?? null,
      feature: input.feature ?? 'chat',
      provider: input.provider,
      modelId: input.modelId,
      inputTokens: Math.max(0, input.inputTokens ?? 0),
      outputTokens: Math.max(0, input.outputTokens ?? 0),
      cachedTokens: Math.max(0, input.cachedTokens ?? 0),
      latencyMs: Math.max(0, input.latencyMs ?? 0),
      toolCalls: Math.max(0, input.toolCalls ?? 0),
      status: input.status ?? 'completed',
      errorCode: input.errorCode ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // 记账失败不应打断主流程
    logger.error('AI_USAGE', 'Failed to record usage', { userId: input.userId }, error);
  }
}

export async function getDailyUsage(env: Env, userId: string): Promise<{ tokens: number; requests: number }> {
  const db = getDb(env.DB);
  const row = await db
    .select({
      tokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}), 0)`,
      requests: sql<number>`count(*)`,
    })
    .from(aiUsageEvents)
    .where(and(eq(aiUsageEvents.userId, userId), gte(aiUsageEvents.createdAt, startOfUtcDay())))
    .get();

  return { tokens: row?.tokens ?? 0, requests: row?.requests ?? 0 };
}

export async function getUsageSummary(env: Env, userId: string, days = 7): Promise<UsageSummary> {
  const db = getDb(env.DB);
  const since = new Date(Date.now() - Math.max(1, days) * 86400_000).toISOString();

  const totals = await db
    .select({
      inputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`,
      requests: sql<number>`count(*)`,
    })
    .from(aiUsageEvents)
    .where(and(eq(aiUsageEvents.userId, userId), gte(aiUsageEvents.createdAt, since)))
    .get();

  const byDay = await db
    .select({
      day: sql<string>`substr(${aiUsageEvents.createdAt}, 1, 10)`,
      inputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`,
      requests: sql<number>`count(*)`,
    })
    .from(aiUsageEvents)
    .where(and(eq(aiUsageEvents.userId, userId), gte(aiUsageEvents.createdAt, since)))
    .groupBy(sql`substr(${aiUsageEvents.createdAt}, 1, 10)`)
    .orderBy(sql`substr(${aiUsageEvents.createdAt}, 1, 10)`)
    .all();

  const byModel = await db
    .select({
      modelId: aiUsageEvents.modelId,
      inputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`,
      requests: sql<number>`count(*)`,
    })
    .from(aiUsageEvents)
    .where(and(eq(aiUsageEvents.userId, userId), gte(aiUsageEvents.createdAt, since)))
    .groupBy(aiUsageEvents.modelId)
    .orderBy(desc(sql`count(*)`))
    .all();

  const byFeature = await db
    .select({
      feature: aiUsageEvents.feature,
      inputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`,
      requests: sql<number>`count(*)`,
    })
    .from(aiUsageEvents)
    .where(and(eq(aiUsageEvents.userId, userId), gte(aiUsageEvents.createdAt, since)))
    .groupBy(aiUsageEvents.feature)
    .orderBy(desc(sql`count(*)`))
    .all();

  return {
    totals: totals ?? { inputTokens: 0, outputTokens: 0, requests: 0 },
    byDay,
    byModel,
    byFeature,
  };
}

export async function listUsageEvents(
  env: Env,
  userId: string,
  limit = 50
): Promise<Array<typeof aiUsageEvents.$inferSelect>> {
  const db = getDb(env.DB);
  return db
    .select()
    .from(aiUsageEvents)
    .where(eq(aiUsageEvents.userId, userId))
    .orderBy(desc(aiUsageEvents.createdAt))
    .limit(Math.min(Math.max(1, limit), 200))
    .all();
}

export interface QuotaDecision {
  allowed: boolean;
  reason?: 'token_quota' | 'request_quota' | 'rate_limit';
  usedTokens: number;
  tokenLimit: number;
  usedRequests: number;
  requestLimit: number;
  minuteRequests: number;
  minuteLimit: number;
}

const DEFAULT_DAILY_TOKENS = 200_000;
const DEFAULT_DAILY_REQUESTS = 200;

/**
 * 日配额 + 分钟级限流。
 * 限额 <= 0 时视为不限制。
 */
export async function checkAiQuota(env: Env, userId: string): Promise<QuotaDecision> {
  const [tokenLimit, requestLimit, rpm] = await Promise.all([
    getAiConfigNumber(env, 'ai.quota.daily_tokens', DEFAULT_DAILY_TOKENS),
    getAiConfigNumber(env, 'ai.quota.daily_requests', DEFAULT_DAILY_REQUESTS),
    getAiConfigNumber(env, 'ai.rate.requests_per_minute', 20),
  ]);

  const [daily, minuteCountRow] = await Promise.all([
    getDailyUsage(env, userId),
    (async () => {
      const db = getDb(env.DB);
      return db
        .select({ requests: sql<number>`count(*)` })
        .from(aiUsageEvents)
        .where(
          and(
            eq(aiUsageEvents.userId, userId),
            gte(aiUsageEvents.createdAt, new Date(Date.now() - 60_000).toISOString())
          )
        )
        .get();
    })(),
  ]);

  const minuteCount = minuteCountRow?.requests ?? 0;

  const decision: QuotaDecision = {
    allowed: true,
    usedTokens: daily.tokens,
    tokenLimit,
    usedRequests: daily.requests,
    requestLimit,
    minuteRequests: minuteCount,
    minuteLimit: rpm,
  };

  if (rpm > 0 && minuteCount >= rpm) {
    return { ...decision, allowed: false, reason: 'rate_limit' };
  }
  if (requestLimit > 0 && daily.requests >= requestLimit) {
    return { ...decision, allowed: false, reason: 'request_quota' };
  }
  if (tokenLimit > 0 && daily.tokens >= tokenLimit) {
    return { ...decision, allowed: false, reason: 'token_quota' };
  }

  return decision;
}

/** 配额状态查询（只读，不占用配额） */
export async function getQuotaStatus(env: Env, userId: string): Promise<QuotaDecision> {
  return checkAiQuota(env, userId);
}
