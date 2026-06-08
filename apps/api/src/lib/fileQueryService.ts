/**
 * fileQueryService.ts — 文件查询公共服务层
 *
 * 复用 routes 中已验证的稳定文件查询逻辑，
 * 为 AI AgentTools 提供统一的文件查询接口。
 *
 * 设计原则：
 * - 不重复造轮子，权限检查复用 permissionService
 * - 提供 AgentTools 需要的便捷查询封装
 */

import { eq } from 'drizzle-orm';
import { getDb, files } from '../db';
import type { Env } from '../types/env';
import { checkFilePermission } from './permissionService';

// ─────────────────────────────────────────────────────────────────────────────
// 查询单个文件（完整信息 + 权限验证）
// 复用 permissionService.checkFilePermission 进行权限验证
// ─────────────────────────────────────────────────────────────────────────────

export async function getFileById(env: Env, userId: string, fileId: string): Promise<typeof files.$inferSelect | null> {
  const db = getDb(env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', env);
  if (!hasAccess) return null;

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  return file || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量查询文件列表（带权限过滤）
// ─────────────────────────────────────────────────────────────────────────────

export async function getFilesByIds(
  env: Env,
  userId: string,
  fileIds: string[]
): Promise<(typeof files.$inferSelect)[]> {
  if (fileIds.length === 0) return [];

  const db = getDb(env.DB);

  const permittedFiles: (typeof files.$inferSelect)[] = [];
  for (const fid of fileIds) {
    const { hasAccess } = await checkFilePermission(db, fid, userId, 'read', env);
    if (hasAccess) {
      const file = await db.select().from(files).where(eq(files.id, fid)).get();
      if (file) permittedFiles.push(file);
    }
  }

  return permittedFiles;
}

// ─────────────────────────────────────────────────────────────────────────────
// 验证文件是否存在且用户有访问权限
// ─────────────────────────────────────────────────────────────────────────────

export async function validateFileAccess(
  env: Env,
  userId: string,
  fileId: string
): Promise<{ valid: boolean; file?: typeof files.$inferSelect }> {
  const file = await getFileById(env, userId, fileId);

  if (!file) {
    return { valid: false };
  }

  return { valid: true, file };
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取文件的父目录路径
// ─────────────────────────────────────────────────────────────────────────────

export async function getParentPath(env: Env, parentId: string): Promise<string | null> {
  const db = getDb(env.DB);

  const parent = await db.select({ path: files.path }).from(files).where(eq(files.id, parentId)).get();

  return parent?.path || null;
}
