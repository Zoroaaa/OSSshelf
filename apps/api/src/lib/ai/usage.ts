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

function startOfUtcDayKey(date = new Date()): string {
  return `day:${date.toISOString().slice(0, 10)}`;
}

function startOfUtcMinuteKey(date = new Date()): string {
  return `min:${date.toISOString().slice(0, 16)}`;
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
const DEFAULT_ESTIMATED_TOKENS = 1_000;

interface QuotaLimits {
  tokenLimit: number;
  requestLimit: number;
  minuteLimit: number;
  estimatedTokens: number;
}

interface CounterRow {
  requests: number;
  tokens: number;
}

async function getQuotaLimits(env: Env): Promise<QuotaLimits> {
  const [tokenLimit, requestLimit, minuteLimit, estimatedTokens] = await Promise.all([
    getAiConfigNumber(env, 'ai.quota.daily_tokens', DEFAULT_DAILY_TOKENS),
    getAiConfigNumber(env, 'ai.quota.daily_requests', DEFAULT_DAILY_REQUESTS),
    getAiConfigNumber(env, 'ai.rate.requests_per_minute', 20),
    getAiConfigNumber(env, 'ai.quota.estimated_tokens_per_request', DEFAULT_ESTIMATED_TOKENS),
  ]);
  return { tokenLimit, requestLimit, minuteLimit, estimatedTokens };
}

/**
 * 原子预扣计数。
 * 单条 INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING 在 D1 的串行写事务中完成，
 * 条件不满足时不更新任何行并返回 null，即“超额拒绝”路径。
 * 限额 <= 0 表示不限制。
 */
async function bumpCounter(
  env: Env,
  userId: string,
  windowKey: string,
  deltaRequests: number,
  deltaTokens: number,
  guard: { maxRequests: number; maxTokens: number }
): Promise<CounterRow | null> {
  const row = await env.DB.prepare(
    `INSERT INTO ai_quota_counters (user_id, window_key, requests, tokens, updated_at)
     SELECT ?, ?, ?, ?, ?
     WHERE (? <= 0 OR ? <= ?)
       AND (? <= 0 OR ? <= ?)
     ON CONFLICT(user_id, window_key) DO UPDATE SET
       requests = ai_quota_counters.requests + excluded.requests,
       tokens = ai_quota_counters.tokens + excluded.tokens,
       updated_at = excluded.updated_at
     WHERE (? <= 0 OR ai_quota_counters.requests + excluded.requests <= ?)
       AND (? <= 0 OR ai_quota_counters.tokens + excluded.tokens <= ?)
     RETURNING requests, tokens`
  )
    .bind(
      userId,
      windowKey,
      deltaRequests,
      deltaTokens,
      new Date().toISOString(),
      // 新窗口插入时的上限校验（避免首次请求的估算值就超过 token 限额）
      guard.maxRequests,
      deltaRequests,
      guard.maxRequests,
      guard.maxTokens,
      deltaTokens,
      guard.maxTokens,
      // 已有窗口累加时的上限校验
      guard.maxRequests,
      guard.maxRequests,
      guard.maxTokens,
      guard.maxTokens
    )
    .first<CounterRow>();

  return row ?? null;
}

async function adjustCounter(
  env: Env,
  userId: string,
  windowKey: string,
  deltaRequests: number,
  deltaTokens: number
): Promise<void> {
  await env.DB.prepare(
    `UPDATE ai_quota_counters
     SET requests = MAX(0, requests + ?),
         tokens = MAX(0, tokens + ?),
         updated_at = ?
     WHERE user_id = ? AND window_key = ?`
  )
    .bind(deltaRequests, deltaTokens, new Date().toISOString(), userId, windowKey)
    .run();
}

async function readCounter(env: Env, userId: string, windowKey: string): Promise<CounterRow> {
  const row = await env.DB.prepare(
    `SELECT requests, tokens FROM ai_quota_counters WHERE user_id = ? AND window_key = ?`
  )
    .bind(userId, windowKey)
    .first<CounterRow>();
  return { requests: row?.requests ?? 0, tokens: row?.tokens ?? 0 };
}

export interface QuotaReservation {
  /** 预扣成功后的用量快照 */
  decision: QuotaDecision;
  /** 用真实 token 数结算预扣（只调整 token 差额，不重复计请求） */
  settle(actualTokens: number): Promise<void>;
  /** 模型调用未发生（异常/提前返回）时全额回滚预扣 */
  release(): Promise<void>;
}

export interface QuotaReserveResult {
  allowed: boolean;
  reason?: QuotaDecision['reason'];
  decision: QuotaDecision;
  reservation?: QuotaReservation;
}

/**
 * 原子预扣日配额与分钟限流。
 * - 先扣分钟窗口（超额 → rate_limit）
 * - 再扣日窗口（请求数 + 估算 token；超额 → request_quota / token_quota）
 * - 任一步失败都会回滚已扣的计数
 */
export async function reserveAiQuota(
  env: Env,
  userId: string,
  options: { estimatedTokens?: number } = {}
): Promise<QuotaReserveResult> {
  const limits = await getQuotaLimits(env);
  const estimatedTokens = Math.max(0, Math.floor(options.estimatedTokens ?? limits.estimatedTokens));
  const dayKey = startOfUtcDayKey();
  const minuteKey = startOfUtcMinuteKey();

  const minuteRow = await bumpCounter(env, userId, minuteKey, 1, 0, {
    maxRequests: limits.minuteLimit,
    maxTokens: 0,
  });

  if (!minuteRow) {
    const [day, minute] = await Promise.all([readCounter(env, userId, dayKey), readCounter(env, userId, minuteKey)]);
    return {
      allowed: false,
      reason: 'rate_limit',
      decision: {
        allowed: false,
        reason: 'rate_limit',
        usedTokens: day.tokens,
        tokenLimit: limits.tokenLimit,
        usedRequests: day.requests,
        requestLimit: limits.requestLimit,
        minuteRequests: minute.requests,
        minuteLimit: limits.minuteLimit,
      },
    };
  }

  const dayRow = await bumpCounter(env, userId, dayKey, 1, estimatedTokens, {
    maxRequests: limits.requestLimit,
    maxTokens: limits.tokenLimit,
  });

  if (!dayRow) {
    // 日窗口失败：回滚刚扣的分钟计数
    await adjustCounter(env, userId, minuteKey, -1, 0);
    const [day, minute] = await Promise.all([readCounter(env, userId, dayKey), readCounter(env, userId, minuteKey)]);
    const reason: QuotaDecision['reason'] =
      limits.requestLimit > 0 && day.requests >= limits.requestLimit ? 'request_quota' : 'token_quota';
    return {
      allowed: false,
      reason,
      decision: {
        allowed: false,
        reason,
        usedTokens: day.tokens,
        tokenLimit: limits.tokenLimit,
        usedRequests: day.requests,
        requestLimit: limits.requestLimit,
        minuteRequests: minute.requests,
        minuteLimit: limits.minuteLimit,
      },
    };
  }

  const decision: QuotaDecision = {
    allowed: true,
    usedTokens: dayRow.tokens,
    tokenLimit: limits.tokenLimit,
    usedRequests: dayRow.requests,
    requestLimit: limits.requestLimit,
    minuteRequests: minuteRow.requests,
    minuteLimit: limits.minuteLimit,
  };

  let finalized = false;

  return {
    allowed: true,
    decision,
    reservation: {
      decision,
      settle: async (actualTokens: number) => {
        if (finalized) return;
        finalized = true;
        const delta = Math.max(0, Math.floor(actualTokens)) - estimatedTokens;
        if (delta !== 0) await adjustCounter(env, userId, dayKey, 0, delta);
      },
      release: async () => {
        if (finalized) return;
        finalized = true;
        await Promise.all([
          adjustCounter(env, userId, dayKey, -1, -estimatedTokens),
          adjustCounter(env, userId, minuteKey, -1, 0),
        ]);
      },
    },
  };
}

/** 配额状态查询（只读，不占用配额） */
export async function getQuotaStatus(env: Env, userId: string): Promise<QuotaDecision> {
  const limits = await getQuotaLimits(env);
  const [day, minute] = await Promise.all([
    readCounter(env, userId, startOfUtcDayKey()),
    readCounter(env, userId, startOfUtcMinuteKey()),
  ]);

  const decision: QuotaDecision = {
    allowed: true,
    usedTokens: day.tokens,
    tokenLimit: limits.tokenLimit,
    usedRequests: day.requests,
    requestLimit: limits.requestLimit,
    minuteRequests: minute.requests,
    minuteLimit: limits.minuteLimit,
  };

  if (limits.minuteLimit > 0 && minute.requests >= limits.minuteLimit) {
    return { ...decision, allowed: false, reason: 'rate_limit' };
  }
  if (limits.requestLimit > 0 && day.requests >= limits.requestLimit) {
    return { ...decision, allowed: false, reason: 'request_quota' };
  }
  if (limits.tokenLimit > 0 && day.tokens >= limits.tokenLimit) {
    return { ...decision, allowed: false, reason: 'token_quota' };
  }
  return decision;
}
