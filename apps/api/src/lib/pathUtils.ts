/**
 * pathUtils.ts
 * 文件路径语义的统一校验 / 规范化入口。
 *
 * 当前数据模型同时存在两种 path 写法：
 *   - REST / 上传：`<parentId>/<name>`（根目录为 `/<name>`）
 *   - WebDAV 展示：由 parentId 链拼出的逻辑路径
 * 本模块只统一“写入口”的校验与前缀匹配方式，不改变现有数据模型；
 * 数据模型迁移在存储升级线中完成。
 *
 * 约定：
 * - 文件名必须经过 normalizeEntryName 校验后才允许落库
 * - 递归匹配统一使用 pathPrefixCondition（精确前缀 + 分隔符），不再直接拼 LIKE 通配符
 */

import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
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

/** 构造存储路径（保持现有 `<parentId>/<name>` 语义） */
export function buildFilePath(parentId: string | null | undefined, name: string): string {
  const safeName = normalizeEntryName(name);
  const pid = normalizeParentId(parentId);
  return pid ? `${pid}/${safeName}` : `/${safeName}`;
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

/** 把以 oldPath 为前缀的路径改写为 newPath 前缀 */
export function replacePathPrefix(path: string, oldPath: string, newPath: string): string {
  const oldPrefix = trimTrailingSlash(oldPath);
  if (!path.startsWith(oldPrefix)) return path;
  return `${trimTrailingSlash(newPath)}${path.slice(oldPrefix.length)}`;
}

/** candidate 是否等于 ancestor 或位于其子树内（用于移动/循环校验） */
export function isSameOrDescendantPath(candidate: string, ancestor: string): boolean {
  const child = trimTrailingSlash(candidate);
  const parent = trimTrailingSlash(ancestor);
  return child === parent || child.startsWith(`${parent}/`);
}
