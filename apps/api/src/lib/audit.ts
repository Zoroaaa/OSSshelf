/**
 * audit.ts
 * 审计日志工具
 *
 * 功能:
 * - 记录用户操作日志
 * - 支持多种操作类型
 * - 记录IP地址和User-Agent
 */

import { getDb, auditLogs } from '../db';
import type { Env } from '../types/env';
import type { AuditAction } from '@osshelf/shared';
import { logger } from '@osshelf/shared';

interface CreateAuditLogParams {
  env: Env;
  userId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  status?: 'success' | 'failed';
  errorMessage?: string | null;
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  const {
    env,
    userId,
    action,
    resourceType,
    resourceId,
    details,
    ipAddress,
    userAgent,
    status = 'success',
    errorMessage,
  } = params;

  try {
    const db = getDb(env.DB);
    const now = new Date().toISOString();

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: userId || null,
      action,
      resourceType,
      resourceId: resourceId || null,
      details: details ? JSON.stringify(details) : null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      status,
      errorMessage: errorMessage || null,
      createdAt: now,
    });
  } catch (error) {
    logger.error('AUDIT', '创建审计日志失败', { userId, action }, error);
  }
}

export function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const cfConnectingIp = c.req.header('CF-Connecting-IP');
  if (cfConnectingIp) return cfConnectingIp;

  const xForwardedFor = c.req.header('X-Forwarded-For');
  if (xForwardedFor) return xForwardedFor.split(',')[0].trim();

  const xRealIp = c.req.header('X-Real-IP');
  if (xRealIp) return xRealIp;

  return null;
}

export function getUserAgent(c: { req: { header: (name: string) => string | undefined } }): string | null {
  return c.req.header('User-Agent') || null;
}

export async function logUserAction(
  env: Env,
  userId: string,
  action: AuditAction,
  resourceType: string,
  resourceId?: string,
  details?: Record<string, unknown>,
  c?: { req: { header: (name: string) => string | undefined } }
): Promise<void> {
  await createAuditLog({
    env,
    userId,
    action,
    resourceType,
    resourceId,
    details,
    ipAddress: c ? getClientIp(c) : null,
    userAgent: c ? getUserAgent(c) : null,
  });
}

export async function logFailedAction(
  env: Env,
  userId: string | undefined,
  action: AuditAction,
  resourceType: string,
  errorMessage: string,
  c?: { req: { header: (name: string) => string | undefined } }
): Promise<void> {
  await createAuditLog({
    env,
    userId,
    action,
    resourceType,
    status: 'failed',
    errorMessage,
    ipAddress: c ? getClientIp(c) : null,
    userAgent: c ? getUserAgent(c) : null,
  });
}
