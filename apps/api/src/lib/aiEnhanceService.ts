/**
 * aiEnhanceService.ts — AI增强操作公共服务层
 *
 * 复用 routes/ai.ts 中已验证的稳定AI逻辑，
 * 为 AI AgentTools 提供统一的AI增强操作接口。
 *
 * 设计原则：
 * - 不重复造轮子，与 ai.ts 的逻辑模式保持一致
 * - 提供 AgentTools 需要的便捷封装
 * - 文件查询复用 permissionService
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb, files } from '../db';
import type { Env } from '../types/env';
import { checkFilePermission } from './permissionService';

export interface FileAiInfo {
  id: string;
  name: string;
  mimeType: string | null;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  aiTags: string | null;
  aiTagsAt: string | null;
  vectorIndexedAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取文件基本信息（用于权限验证和类型检查）
// 复用 permissionService.checkFilePermission 进行权限验证
// ─────────────────────────────────────────────────────────────────────────────

export async function getFileBasicInfo(env: Env, userId: string, fileId: string): Promise<FileAiInfo | null> {
  const db = getDb(env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', env);
  if (!hasAccess) return null;

  const file = await db
    .select({
      id: files.id,
      name: files.name,
      mimeType: files.mimeType,
      aiSummary: files.aiSummary,
      aiSummaryAt: files.aiSummaryAt,
      aiTags: files.aiTags,
      aiTagsAt: files.aiTagsAt,
      vectorIndexedAt: files.vectorIndexedAt,
    })
    .from(files)
    .where(eq(files.id, fileId))
    .get();

  return file || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取文件更新后的AI信息
// ─────────────────────────────────────────────────────────────────────────────

export async function getFileUpdatedAiInfo(
  env: Env,
  fileId: string
): Promise<Pick<FileAiInfo, 'aiSummary' | 'aiSummaryAt' | 'aiTags' | 'aiTagsAt'> | null> {
  const db = getDb(env.DB);

  const file = await db
    .select({
      aiSummary: files.aiSummary,
      aiSummaryAt: files.aiSummaryAt,
      aiTags: files.aiTags,
      aiTagsAt: files.aiTagsAt,
    })
    .from(files)
    .where(eq(files.id, fileId))
    .get();

  return file || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 解析AI标签JSON字符串（纯工具函数）
// ─────────────────────────────────────────────────────────────────────────────

export function parseAiTags(aiTagsJson: string | null): string[] {
  if (!aiTagsJson) return [];

  try {
    const parsed = JSON.parse(aiTagsJson);
    if (Array.isArray(parsed)) {
      return parsed.map((t: any) => (typeof t === 'string' ? t : t.tag || t)).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 检查文件是否为图片类型（纯工具函数）
// ─────────────────────────────────────────────────────────────────────────────

export function isImageFile(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith('image/');
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取需要建立向量索引的文件列表
// 与 routes/ai.ts 中的批量任务筛选逻辑一致
// ─────────────────────────────────────────────────────────────────────────────

export async function getFilesForVectorIndex(
  env: Env,
  userId: string,
  forceAll?: boolean
): Promise<Array<{ id: string }>> {
  const db = getDb(env.DB);

  const conditions = [eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)];

  if (!forceAll) {
    conditions.push(sql`${files.vectorIndexedAt} IS NULL`);
  }

  const results = await db
    .select({ id: files.id })
    .from(files)
    .where(and(...conditions))
    .all();

  return results;
}
