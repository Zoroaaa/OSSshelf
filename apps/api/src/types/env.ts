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

export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;
  KV: KVNamespace;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PUBLIC_URL?: string;
  CORS_ORIGINS?: string;
  ALERT_TG_BOT_TOKEN?: string;
  ALERT_TG_CHAT_ID?: string;
  AUDIT_RETENTION_DAYS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_API_ID?: string;
  TELEGRAM_API_HASH?: string;
  TELEGRAM_SESSION?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  INVITE_CODE?: string;
  DISABLE_REGISTRATION?: string;
  MAX_FILE_SIZE?: string;
  MAX_STORAGE_QUOTA?: string;
}

export type Variables = {
  userId?: string;
  user?: { id: string; email: string; role: string };
  authType?: 'jwt' | 'apiKey';
  apiKeyId?: string;
  apiKeyScopes?: string[];
};

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const DEFAULT_ENV_VALUES = {
  AUDIT_RETENTION_DAYS: '90',
  MAX_FILE_SIZE: String(5 * 1024 * 1024 * 1024),
  MAX_STORAGE_QUOTA: String(10 * 1024 * 1024 * 1024),
} as const;

export function getEnvNumber(env: Env, key: keyof Env, defaultValue: number): number {
  const value = env[key];
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

export function getEnvBoolean(env: Env, key: keyof Env, defaultValue: boolean): boolean {
  const value = env[key];
  if (typeof value === 'string') {
    return value === 'true' || value === '1';
  }
  return defaultValue;
}

export function getAuditRetentionDays(env: Env): number {
  return getEnvNumber(env, 'AUDIT_RETENTION_DAYS', 90);
}

export function getMaxFileSize(env: Env): number {
  return getEnvNumber(env, 'MAX_FILE_SIZE', 5 * 1024 * 1024 * 1024);
}

export function getMaxStorageQuota(env: Env): number {
  return getEnvNumber(env, 'MAX_STORAGE_QUOTA', 10 * 1024 * 1024 * 1024);
}

export function isRegistrationDisabled(env: Env): boolean {
  return getEnvBoolean(env, 'DISABLE_REGISTRATION', false);
}

export function hasTelegramAlert(env: Env): boolean {
  return !!(env.ALERT_TG_BOT_TOKEN && env.ALERT_TG_CHAT_ID);
}

export function hasEmailConfig(env: Env): boolean {
  return !!(env.RESEND_API_KEY || (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS));
}
