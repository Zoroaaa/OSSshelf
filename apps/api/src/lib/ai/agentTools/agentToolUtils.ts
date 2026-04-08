/**
 * agentToolUtils.ts — AI 工具通用辅助函数
 *
 * 统一所有 AI 工具的公共逻辑，避免重复代码：
 * - 统一的数据格式转换（toAgentFile）
 * - 统一的文件存在性检查
 * - 统一的错误响应格式
 * - 统一的日志记录
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files } from '../../../db';
import type { InferSelectModel } from 'drizzle-orm';
import { formatBytes } from '../utils';
import type { AgentFile } from './types';
import { logger } from '@osshelf/shared';

/**
 * 将数据库文件记录转换为 AgentFile 格式
 * 所有工具共用，确保返回格式一致
 */
export function toAgentFile(f: InferSelectModel<typeof files>): AgentFile {
  return {
    id: f.id,
    name: f.name,
    path: f.path,
    isFolder: f.isFolder,
    mimeType: f.mimeType,
    size: f.size,
    sizeFormatted: formatBytes(f.size),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    parentId: f.parentId,
    aiSummary: f.aiSummary,
    aiTags: f.aiTags,
    description: f.description,
    isStarred: f.isStarred ?? false,
    currentVersion: f.currentVersion ?? null,
    vectorIndexedAt: f.vectorIndexedAt,
  };
}

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
 * 检查文件夹是否存在且用户有权限访问
 */
export async function validateFolderAccess(
  db: ReturnType<typeof getDb>,
  folderId: string,
  userId: string
): Promise<{ success: true; folder: InferSelectModel<typeof files> } | { success: false; error: string }> {
  const folder = await db
    .select()
    .from(files)
    .where(and(eq(files.id, folderId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!folder) {
    return { success: false, error: `文件夹不存在或无权访问: ${folderId}` };
  }

  if (!folder.isFolder) {
    return { success: false, error: `${folderId} 不是文件夹` };
  }

  return { success: true, folder };
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

/**
 * 批量转换文件列表为 AgentFile 格式
 */
export function batchToAgentFile(rows: InferSelectModel<typeof files>[]): AgentFile[] {
  return rows.map(toAgentFile);
}
