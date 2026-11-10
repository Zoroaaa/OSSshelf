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

/**
 * 按父目录实际所属的命名空间生成路径。
 * 共享目录里创建/上传的文件，其 parentId 链可能不属于调用者，
 * 必须用父目录的 owner / teamId 计算，否则 path 会退化成 `/name`。
 */
export async function buildPathUnderParent(
  db: DrizzleDb,
  parentId: string | null | undefined,
  name: string,
  fallbackUserId: string,
  teamId: string | null = null
): Promise<string> {
  const pid = normalizeParentId(parentId);
  if (!pid) {
    return teamId ? buildTeamFilePath(db, teamId, null, name) : buildFilePath(db, fallbackUserId, null, name);
  }

  const parent = await db
    .select({ userId: files.userId, teamId: files.teamId })
    .from(files)
    .where(eq(files.id, pid))
    .get();

  if (parent?.teamId) return buildTeamFilePath(db, parent.teamId, pid, name);
  if (parent) return buildFilePath(db, parent.userId, pid, name);
  return teamId ? buildTeamFilePath(db, teamId, pid, name) : buildFilePath(db, fallbackUserId, pid, name);
}

/**
 * 上传落库前解析可用文件名：同目录同名时自动追加 ` (n)` 后缀。
 *
 * 数据库没有 (userId, parentId, name) 唯一约束，只能由应用层保证。
 * 同目录视为同一命名空间（共享目录下不同上传者的同名文件同样冲突）；
 * 根目录则按 userId + teamId 区分。回收站中的同名文件不参与冲突。
 */
export async function resolveAvailableFileName(
  db: DrizzleDb,
  params: { parentId: string | null | undefined; userId: string; teamId?: string | null; name: string }
): Promise<string> {
  const pid = normalizeParentId(params.parentId);
  const baseName = normalizeEntryName(params.name);
  const teamId = params.teamId ?? null;

  const isTaken = async (candidate: string): Promise<boolean> => {
    const conditions: SQL[] = [
      eq(files.name, candidate),
      pid ? eq(files.parentId, pid) : isNull(files.parentId),
      isNull(files.deletedAt),
    ];
    if (teamId) {
      conditions.push(eq(files.teamId, teamId));
    } else if (!pid) {
      conditions.push(eq(files.userId, params.userId), isNull(files.teamId));
    }
    const hit = await db
      .select({ id: files.id })
      .from(files)
      .where(and(...conditions))
      .get();
    return Boolean(hit);
  };

  if (!(await isTaken(baseName))) return baseName;

  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  for (let i = 1; i <= 999; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (candidate.length > MAX_NAME_LENGTH) continue;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`.slice(0, MAX_NAME_LENGTH);
}

/** 迁移 119 中的文件名唯一索引名 */
const FILE_NAME_UNIQUE_INDEX = 'uniq_files_name_per_parent_active';

function collectErrorText(error: unknown, depth = 0): string {
  if (!error || depth > 4) return '';
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return String(error);
  const e = error as { message?: unknown; cause?: unknown };
  return `${typeof e.message === 'string' ? e.message : ''} ${collectErrorText(e.cause, depth + 1)}`;
}

/**
 * 判断是否为「同目录同名」唯一约束冲突（迁移 119）。
 * D1/SQLite 对表达式索引的报错形如：
 *   UNIQUE constraint failed: index 'uniq_files_name_per_parent_active'
 * Drizzle 会把原始错误包在 cause 中，因此需要沿 cause 链取文本。
 */
export function isFileNameConflictError(error: unknown): boolean {
  const text = collectErrorText(error).toLowerCase();
  return text.includes(FILE_NAME_UNIQUE_INDEX) || /unique constraint failed:\s*files\.name/.test(text);
}

/**
 * 落库文件记录：先解析可用文件名，再插入；并发撞到唯一索引时重新解析后缀重试。
 *
 * 迁移 119 起数据库对「命名空间 + 父目录 + 文件名」有唯一约束，
 * 上传场景不允许直接 500，因此这里做有限次重试（默认 5 次）。
 * 每次重试都会重新查询当前目录的最小可用后缀，不会无限循环。
 */
export async function insertFileWithUniqueName(
  db: DrizzleDb,
  params: {
    parentId: string | null | undefined;
    userId: string;
    teamId?: string | null;
    name: string;
    toValues: (name: string, path: string) => typeof files.$inferInsert;
    maxAttempts?: number;
  }
): Promise<{ name: string; path: string }> {
  const maxAttempts = params.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const name = await resolveAvailableFileName(db, params);
    const path = await buildPathUnderParent(db, params.parentId, name, params.userId, params.teamId ?? null);
    try {
      await db.insert(files).values(params.toValues(name, path));
      return { name, path };
    } catch (error) {
      if (!isFileNameConflictError(error)) throw error;
      if (attempt === maxAttempts) break;
    }
  }
  throwAppError('FILE_ALREADY_EXISTS', '同名文件冲突，请重命名后重试');
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
