/**
 * pathUtils.ts
 * 文件路径语义的唯一入口。
 *
 * 数据模型（117 迁移后）：
 *   - parentId 是目录结构的唯一事实
 *   - files.path 是由 parentId 链拼出的逻辑路径缓存：`/docs/2026/a.txt`
 *     根目录文件为 `/a.txt`，不带尾部斜杠
 *   - 所有写入口必须通过 buildFilePath / buildFolderPath 生成路径，
 *     禁止再手工拼接 `<parentId>/<name>`
 *
 * 约定：
 * - 文件名必须经过 normalizeEntryName 校验后才允许落库
 * - 递归匹配统一使用 pathPrefixCondition（精确前缀 + 分隔符），不再直接拼 LIKE 通配符
 */

import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { DrizzleDb } from '../db';
import { files } from '../db/schema';
import { throwAppError } from '../middleware/error';

const MAX_NAME_LENGTH = 255;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 校验并规范化文件 / 文件夹名 */
export function normalizeEntryName(raw: string): string {
  if (typeof raw !== 'string') throwAppError('INVALID_FILENAME');
  const name = raw.trim();

  if (!name) throwAppError('INVALID_FILENAME', '名称不能为空');
  if (name.length > MAX_NAME_LENGTH) throwAppError('FILENAME_TOO_LONG');
  if (name === '.' || name === '..') throwAppError('INVALID_FILENAME', '名称不能为 . 或 ..');
  if (name.includes('/') || name.includes('\\')) throwAppError('INVALID_FILENAME', '名称不能包含路径分隔符');
  if (hasControlChars(name)) throwAppError('INVALID_FILENAME', '名称包含非法控制字符');

  return name;
}

/** 校验 parentId：只允许空值或单段合法标识（禁止带路径分隔符） */
export function normalizeParentId(parentId: string | null | undefined): string | null {
  if (parentId === null || parentId === undefined) return null;
  if (typeof parentId !== 'string') throwAppError('INVALID_PATH');
  const value = parentId.trim();
  if (!value) return null;
  if (value.length > 128) throwAppError('INVALID_PATH', '父级目录标识无效');
  if (value.includes('/') || value.includes('\\') || hasControlChars(value)) {
    throwAppError('INVALID_PATH', '父级目录标识无效');
  }
  return value;
}

/** 目录链路最大深度，防御脏数据造成的环 */
const MAX_FOLDER_DEPTH = 64;

/**
 * 构造逻辑路径：由 parentId 链上的 name 依次拼接。
 * 与 WebDAV 展示路径完全一致，是 path 字段的唯一写入口。
 */
export async function buildFilePath(
  db: DrizzleDb,
  userId: string,
  parentId: string | null | undefined,
  name: string
): Promise<string> {
  const safeName = normalizeEntryName(name);
  const pid = normalizeParentId(parentId);
  if (!pid) return `/${safeName}`;

  const parts: string[] = [safeName];
  let cursor: string | null = pid;
  const visited = new Set<string>();

  while (cursor) {
    if (visited.has(cursor) || visited.size >= MAX_FOLDER_DEPTH) {
      throwAppError('INVALID_PATH', '目录层级异常，无法计算路径');
    }
    visited.add(cursor);

    const parent = await db
      .select({ name: files.name, parentId: files.parentId })
      .from(files)
      .where(and(eq(files.id, cursor), eq(files.userId, userId)))
      .get();

    if (!parent) break;
    parts.unshift(parent.name);
    cursor = parent.parentId;
  }

  return `/${parts.join('/')}`;
}

/**
 * 团队文件路径：团队根使用 `/teams/<teamId>/` 命名空间，避免与个人路径冲突。
 * 子项沿用父目录 path 前缀；父目录也可能是挂载到团队的个人文件夹。
 */
export async function buildTeamFilePath(
  db: DrizzleDb,
  teamId: string,
  parentId: string | null | undefined,
  name: string
): Promise<string> {
  const safeName = normalizeEntryName(name);
  const pid = normalizeParentId(parentId);
  if (!pid) return `/teams/${teamId}/${safeName}`;

  const parent = await db.select({ path: files.path }).from(files).where(eq(files.id, pid)).get();
  if (!parent) throwAppError('INVALID_PATH', '父目录不存在');

  return `${trimTrailingSlash(parent.path)}/${safeName}`;
}

/** 构造文件夹展示路径（带尾部斜杠），用于搜索结果等展示场景 */
export async function buildFolderPath(
  db: DrizzleDb,
  userId: string,
  parentId: string | null | undefined
): Promise<string> {
  const pid = normalizeParentId(parentId);
  if (!pid) return '/';

  const parts: string[] = [];
  let cursor: string | null = pid;
  const visited = new Set<string>();

  while (cursor) {
    if (visited.has(cursor) || visited.size >= MAX_FOLDER_DEPTH) break;
    visited.add(cursor);

    const parent = await db
      .select({ name: files.name, parentId: files.parentId })
      .from(files)
      .where(and(eq(files.id, cursor), eq(files.userId, userId)))
      .get();

    if (!parent) break;
    parts.unshift(parent.name);
    cursor = parent.parentId;
  }

  return `/${parts.join('/')}${parts.length > 0 ? '/' : ''}`;
}

export function trimTrailingSlash(path: string): string {
  let value = path;
  while (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

/**
 * 目录子树前缀：`/a/b` → `/a/b/`，根目录 → `/`
 * 内存过滤（startsWith）与 SQL 前缀匹配共用同一份前缀计算逻辑。
 */
export function pathPrefix(folderPath: string): string {
  const base = trimTrailingSlash(folderPath);
  return base === '/' ? '/' : `${base}/`;
}

/**
 * 精确前缀匹配条件：`substr(path, 1, len(prefix)) = prefix`
 * 使用 substr 而不是 LIKE，`%` / `_` 等字符不会被当作通配符。
 */
export function pathPrefixCondition(column: SQLiteColumn, folderPath: string): SQL {
  const prefix = pathPrefix(folderPath);
  return sql`substr(${column}, 1, ${prefix.length}) = ${prefix}`;
}

/**
 * 构造“替换子树 path 前缀”的更新语句（不执行）。
 * 供 db.batch 将“更新自身 + 更新子树”合并为原子事务。
 */
export function buildDescendantPathUpdate(
  db: DrizzleDb,
  userId: string,
  oldPath: string,
  newPath: string,
  updatedAt: string,
  teamId: string | null = null
) {
  const oldPrefix = pathPrefix(oldPath);
  const newPrefix = pathPrefix(newPath);
  const offset = oldPrefix.length + 1; // SQLite substr 从 1 开始
  const namespaceCondition = teamId ? eq(files.teamId, teamId) : isNull(files.teamId);

  return db
    .update(files)
    .set({
      path: sql`${newPrefix} || substr(${files.path}, ${offset})`,
      updatedAt,
    })
    .where(and(eq(files.userId, userId), namespaceCondition, pathPrefixCondition(files.path, oldPath)));
}

/** candidate 是否等于 ancestor 或位于其子树内（用于移动/循环校验） */
export function isSameOrDescendantPath(candidate: string, ancestor: string): boolean {
  const child = trimTrailingSlash(candidate);
  const parent = trimTrailingSlash(ancestor);
  return child === parent || child.startsWith(`${parent}/`);
}
