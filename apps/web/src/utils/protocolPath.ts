/**
 * protocolPath.ts
 * 解析系统协议链接 `web+osshelf://` 中的目录路径
 *
 * 映射规则（与 manifest.json 的 protocol_handlers `/files?path=%s` 对应）：
 * - `path` 表示目录路径，按 `/` 分段，每段按「目录名称」匹配同级目录
 * - 空值、`/`、`//` 均视为根目录
 * - 逐级向下解析；任一级不存在时停在根目录并提示
 * - 同级存在多个同名目录时取第一个匹配项，并提示重名
 *
 * 示例：
 * - `web+osshelf://photos/2026` → path=`//photos/2026` → 打开 /照片/2026（按名称匹配）
 * - `web+osshelf://`          → 根目录
 */

import { filesApi } from '@/services/api';
import type { FileItem } from '@osshelf/shared';

export interface ProtocolPathResult {
  /** 解析到的目录 id；null 表示根目录 */
  folderId: string | null;
  /** 已成功解析的路径段 */
  resolvedSegments: string[];
  /** 第一个不存在的路径段（此时 folderId 为 null） */
  missingAt?: string;
  /** 遇到重名的路径段（已取同级第一个匹配项，继续解析） */
  duplicateAt?: string;
}

/**
 * 把协议链接中的原始 path 拆成目录名称数组。
 * Chrome 传入的是 scheme 之后的部分，可能带 `//` 前缀或百分号编码。
 */
const PROTOCOL_SCHEME_PATTERN = /^web\+osshelf:(\/\/)?/i;

function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseProtocolPath(raw: string | null): string[] {
  if (!raw) return [];

  // 浏览器通过 `%s` 传递的是完整 URL（可能整条被百分号编码），
  // 先整体解码并去掉 `web+osshelf://` 前缀，避免把 scheme 当作目录名。
  let value = raw.trim();
  const decoded = tryDecode(value);
  const schemeMatch = PROTOCOL_SCHEME_PATTERN.exec(decoded);
  if (schemeMatch) {
    value = decoded.slice(schemeMatch[0].length);
  }

  // 先按 `/` 分段再逐段解码，避免目录名中的编码斜杠（%2F）被误当作分隔符
  return value
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment).trim();
      } catch {
        // 非法编码时保留原值，按字面路径处理
        return segment.trim();
      }
    })
    .filter(Boolean);
}

async function findFoldersByName(parentId: string | null, name: string): Promise<FileItem[]> {
  const pageSize = 100;
  let page = 1;
  const matches: FileItem[] = [];

  for (;;) {
    const res = await filesApi.list({ parentId, page, limit: pageSize });
    const payload = res.data.data as unknown as FileItem[] | { items?: FileItem[] } | null;
    const items: FileItem[] = Array.isArray(payload) ? payload : (payload?.items ?? []);
    matches.push(...items.filter((item) => item.isFolder && item.name === name));

    const pagination = (res as { data?: { pagination?: { total?: number } } }).data?.pagination;
    const total = pagination?.total ?? items.length;
    if (items.length === 0 || page * pageSize >= total) break;
    page += 1;
  }

  return matches;
}

/** 按目录名称逐级解析协议路径 */
export async function resolveProtocolFolder(segments: string[]): Promise<ProtocolPathResult> {
  let parentId: string | null = null;
  let duplicateAt: string | undefined;

  for (const [index, name] of segments.entries()) {
    const matches = await findFoldersByName(parentId, name);
    const first = matches[0];

    if (!first) {
      return { folderId: null, resolvedSegments: segments.slice(0, index), missingAt: name };
    }

    if (matches.length > 1 && !duplicateAt) {
      duplicateAt = name;
    }

    parentId = first.id;
  }

  return { folderId: parentId, resolvedSegments: segments, duplicateAt };
}
