/**
 * env.ts
 * 环境变量类型定义
 *
 * 功能:
 * - 定义所有环境变量类型
 * - 消除any类型
 * - 提供类型安全的环境变量访问
 */

import type { Context } from 'hono';

export interface AiTaskMessage {
  type: 'index' | 'summary' | 'tags' | 'agent_batch';
  fileId: string;
  userId: string;
  taskId: string;
  retryCount?: number;
  /** tags/summary 完成后是否自动触发向量索引（上传自动处理时使用） */
  triggerIndexOnComplete?: boolean;
  /** 是否支持断点续传（批量索引时标记） */
  isResumable?: boolean;
  /** agent_batch 操作类型（move/delete/rename） */
  operation?: 'move' | 'delete' | 'rename';
  /** agent_batch 操作参数 */
  targetFolderId?: string;
  newName?: string;
}

export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;
  KV: KVNamespace;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  OSSShelfAgent: DurableObjectNamespace;
  AI_TASKS_QUEUE?: Queue<AiTaskMessage>;
  /** Cloudflare 账户 ID：用于实时拉取 Workers AI 模型目录 */
  CF_ACCOUNT_ID?: string;
  /** Cloudflare API Token（权限：Workers AI Read）：用于实时拉取 Workers AI 模型目录 */
  CF_API_TOKEN?: string;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PUBLIC_URL?: string;
  CORS_ORIGINS?: string;
  ALERT_TG_BOT_TOKEN?: string;
  ALERT_TG_CHAT_ID?: string;
  AUDIT_RETENTION_DAYS?: string;
  TRASH_RETENTION_DAYS?: string;
}

export type Variables = {
  userId?: string;
  user?: { id: string; email: string; role: string };
  authType?: 'jwt' | 'apiKey';
  apiKeyId?: string;
  apiKeyScopes?: string[];
  /** 处理函数上报的真实 token 用量，供 aiRateLimit 结算预扣 */
  aiUsageTokens?: number;
};

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
export function getEnvNumber(env: Env, key: keyof Env, defaultValue: number): number {
  const value = env[key];
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}
export function getAuditRetentionDays(env: Env): number {
  return getEnvNumber(env, 'AUDIT_RETENTION_DAYS', 90);
}
export function getTrashRetentionDays(env: Env): number {
  return getEnvNumber(env, 'TRASH_RETENTION_DAYS', 30);
}
export function hasTelegramAlert(env: Env): boolean {
  return !!(env.ALERT_TG_BOT_TOKEN && env.ALERT_TG_CHAT_ID);
}
