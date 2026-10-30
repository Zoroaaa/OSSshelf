/**
 * agentToolUtils.ts — AI 工具通用辅助函数
 *
 * 统一所有 AI 工具的公共逻辑：
 * - 统一的文件存在性检查
 * - 统一的错误响应格式
 * - 统一的日志记录
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files } from '../../../db';
import type { InferSelectModel } from 'drizzle-orm';
import { logger } from '@osshelf/shared';

/**
 * 检查文件是否存在且用户有权限访问
 * 返回文件记录或错误信息
 */
export async function validateFileAccess(
  db: ReturnType<typeof getDb>,
  fileId: string,
  userId: string
): Promise<{ success: true; file: InferSelectModel<typeof files> } | { success: false; error: string }> {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) {
    return { success: false, error: `文件不存在或无权访问: ${fileId}` };
  }

  return { success: true, file };
}

/**
 * 创建标准化的成功响应（带 _next_actions）
 */
export function createSuccessResponse(data: Record<string, unknown>, nextActions?: string[]): Record<string, unknown> {
  return {
    ...data,
    ...(nextActions?.length ? { _next_actions: nextActions } : {}),
  };
}

/**
 * 创建标准化的错误响应（带详细诊断信息）
 */
export function createErrorResponse(error: string, context?: Record<string, unknown>): Record<string, unknown> {
  logger.error('AgentTool', error, context);

  return {
    error,
    ...(context ? { details: context } : {}),
  };
}
