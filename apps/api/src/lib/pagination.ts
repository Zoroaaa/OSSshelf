/**
 * pagination.ts
 * 分页参数解析的单一入口。
 *
 * 约定：非法/缺省的 limit 回退到默认值，offset 回退到 0，
 * 并且 limit 不超过上限，避免前端传入超大值导致全表扫描。
 */

import type { Context } from 'hono';

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export function parsePagination(c: Context, options: PaginationOptions = {}): PaginationParams {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;

  const rawLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
  const rawOffset = Number.parseInt(c.req.query('offset') ?? '', 10);

  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  return { limit, offset };
}
