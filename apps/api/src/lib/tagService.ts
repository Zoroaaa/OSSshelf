/**
 * tagService.ts — 标签操作公共服务层
 *
 * 复用 routes/permissions.ts 中已验证的稳定标签逻辑，
 * 为 AI AgentTools 提供统一的标签操作接口。
 *
 * 设计原则：
 * - 不重复造轮子，与 permissions.ts 的 SQL 模式保持一致
 * - 提供 AgentTools 需要的高级封装（批量操作、统计等）
 * - 权限检查复用 permissionService
 */

import { eq, and, isNull, inArray, sql, count, desc } from 'drizzle-orm';
import { getDb, files, fileTags } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { checkFilePermission } from './permissionService';

export interface TagInput {
  fileId: string;
  name: string;
  color?: string;
}

export interface TagResult {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 添加标签到文件
// 与 routes/permissions.ts POST /tags/add 逻辑一致
// ─────────────────────────────────────────────────────────────────────────────

export async function addTagToFile(
  env: Env,
  userId: string,
  input: TagInput
): Promise<{ success: true; tag: TagResult } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const { hasAccess } = await checkFilePermission(db, input.fileId, userId, 'write', env);
  if (!hasAccess) {
    return { success: false, error: '无权修改此文件' };
  }

  const existing = await db
    .select()
    .from(fileTags)
    .where(and(eq(fileTags.fileId, input.fileId), eq(fileTags.name, input.name)))
    .get();

  if (existing) {
    return { success: false, error: `标签 "${input.name}" 已存在` };
  }

  const tagId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(fileTags).values({
    id: tagId,
    fileId: input.fileId,
    userId,
    name: input.name,
    color: input.color || '#6366f1',
    createdAt: now,
  });

  logger.info('TagService', 'Tag added to file', { userId, fileId: input.fileId, tagName: input.name });

  return {
    success: true,
    tag: { id: tagId, name: input.name, color: input.color || '#6366f1', createdAt: now },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 从文件移除标签
// 与 routes/permissions.ts POST /tags/remove 逻辑一致
// ─────────────────────────────────────────────────────────────────────────────

export async function removeTagFromFile(
  env: Env,
  userId: string,
  fileId: string,
  tagName: string
): Promise<{ success: true; removed: boolean } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'write', env);
  if (!hasAccess) {
    return { success: false, error: '无权修改此文件' };
  }

  const existing = await db
    .select()
    .from(fileTags)
    .where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, tagName)))
    .get();

  if (!existing) {
    return { success: true, removed: false };
  }

  await db
    .delete(fileTags)
    .where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, tagName), eq(fileTags.userId, userId)));

  logger.info('TagService', 'Tag removed from file', { userId, fileId, tagName });

  return { success: true, removed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 查询文件的所有标签
// 与 routes/permissions.ts GET /tags/file/:fileId 逻辑一致
// ─────────────────────────────────────────────────────────────────────────────

export async function getFileTags(env: Env, userId: string, fileId: string): Promise<TagResult[]> {
  const db = getDb(env.DB);

  await checkFilePermission(db, fileId, userId, 'read', env);

  const tags = await db.select().from(fileTags).where(eq(fileTags.fileId, fileId)).all();

  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color, createdAt: t.createdAt }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取用户的全部标签列表（去重）
// 与 routes/permissions.ts GET /tags/user 逻辑一致 + 去重增强
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllUserTags(
  env: Env,
  userId: string,
  options?: { search?: string; limit?: number }
): Promise<TagResult[]> {
  const db = getDb(env.DB);

  let tags = await db.select().from(fileTags).where(eq(fileTags.userId, userId)).all();

  if (options?.search) {
    tags = tags.filter((t) => t.name.includes(options.search!));
  }

  const uniqueTags = Array.from(new Map(tags.map((t) => [t.name, t])).values());

  const limit = options?.limit || 50;
  return uniqueTags
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((t) => ({ id: t.id, name: t.name, color: t.color, createdAt: t.createdAt }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量查询文件的标签
// 与 routes/permissions.ts POST /tags/batch 逻辑一致
// ─────────────────────────────────────────────────────────────────────────────

export async function batchGetFileTags(
  env: Env,
  userId: string,
  fileIds: string[]
): Promise<Record<string, TagResult[]>> {
  const db = getDb(env.DB);

  if (fileIds.length === 0) return {};

  const permittedFileIds: string[] = [];
  for (const fid of fileIds) {
    const { hasAccess } = await checkFilePermission(db, fid, userId, 'read', env);
    if (hasAccess) permittedFileIds.push(fid);
  }

  if (permittedFileIds.length === 0) return {};

  const tags = await db.select().from(fileTags).where(inArray(fileTags.fileId, permittedFileIds)).all();

  const tagsByFileId: Record<string, TagResult[]> = {};
  for (const tag of tags) {
    if (!tagsByFileId[tag.fileId]) tagsByFileId[tag.fileId] = [];
    tagsByFileId[tag.fileId].push({ id: tag.id, name: tag.name, color: tag.color, createdAt: tag.createdAt });
  }

  return tagsByFileId;
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取标签使用统计（AgentTools专用扩展）
// ─────────────────────────────────────────────────────────────────────────────

export async function getTagStats(env: Env, userId: string): Promise<Array<{ name: string; count: number }>> {
  const db = getDb(env.DB);

  const results = await db
    .select({ name: fileTags.name, count: count() })
    .from(fileTags)
    .where(eq(fileTags.userId, userId))
    .groupBy(fileTags.name)
    .orderBy(desc(count()))
    .limit(30)
    .all();

  return results.map((r) => ({ name: r.name, count: Number(r.count) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量添加标签到多个文件（AgentTools专用扩展）
// ─────────────────────────────────────────────────────────────────────────────

export async function batchAddTagsToFiles(
  env: Env,
  userId: string,
  fileIds: string[],
  tagName: string,
  color?: string
): Promise<{ successCount: number; failCount: number; errors: Array<{ fileId: string; error: string }> }> {
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ fileId: string; error: string }> = [];

  for (const fileId of fileIds) {
    const result = await addTagToFile(env, userId, { fileId, name: tagName, color });
    if (result.success) {
      successCount++;
    } else {
      failCount++;
      errors.push({ fileId, error: result.error });
    }
  }

  return { successCount, failCount, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取图片文件用于AI标签生成
// 与 routes/ai.ts POST /tags/batch 中的图片筛选逻辑一致
// ─────────────────────────────────────────────────────────────────────────────

export async function getImageFilesForAutoTagging(
  env: Env,
  userId: string,
  fileIds?: string[]
): Promise<Array<{ id: string; name: string; mimeType: string | null }>> {
  const db = getDb(env.DB);

  const conditions = [eq(files.userId, userId), isNull(files.deletedAt), sql`${files.mimeType} LIKE 'image/%'`];

  if (fileIds && fileIds.length > 0) {
    conditions.push(inArray(files.id, fileIds));
  }

  const results = await db
    .select({ id: files.id, name: files.name, mimeType: files.mimeType })
    .from(files)
    .where(and(...conditions))
    .all();

  return results;
}
