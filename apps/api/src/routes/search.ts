/**
 * search.ts
 * 文件搜索路由
 *
 * 功能:
 * - 关键词搜索
 * - 高级条件搜索
 * - 搜索建议
 * - 最近搜索记录
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { searchFiles, advancedSearch, getSearchSuggestions, getRecentFiles } from '../services/search.service';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const searchSchema = z.object({
  query: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
  recursive: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  mimeType: z.string().optional(),
  minSize: z.number().int().min(0).optional(),
  maxSize: z.number().int().min(0).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  updatedAfter: z.string().datetime().optional(),
  updatedBefore: z.string().datetime().optional(),
  isFolder: z.boolean().optional(),
  bucketId: z.string().optional(),
  sortBy: z.enum(['name', 'size', 'createdAt', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).default(1).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
});

const advancedSearchSchema = z.object({
  conditions: z
    .array(
      z.object({
        field: z.enum(['name', 'mimeType', 'size', 'createdAt', 'updatedAt', 'tags']),
        operator: z.enum(['contains', 'equals', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'in']),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
      })
    )
    .min(1),
  logic: z.enum(['and', 'or']).default('and'),
  sortBy: z.enum(['name', 'size', 'createdAt', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).default(1).optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
});

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const query = c.req.query();

  const params = {
    query: query.query,
    parentId: query.parentId,
    recursive: query.recursive === 'true',
    tags: query.tags ? query.tags.split(',').filter(Boolean) : undefined,
    mimeType: query.mimeType,
    minSize: query.minSize ? parseInt(query.minSize, 10) : undefined,
    maxSize: query.maxSize ? parseInt(query.maxSize, 10) : undefined,
    createdAfter: query.createdAfter,
    createdBefore: query.createdBefore,
    updatedAfter: query.updatedAfter,
    updatedBefore: query.updatedBefore,
    isFolder: query.isFolder === 'true' ? true : query.isFolder === 'false' ? false : undefined,
    bucketId: query.bucketId,
    sortBy: query.sortBy as 'name' | 'size' | 'createdAt' | 'updatedAt' | undefined,
    sortOrder: query.sortOrder as 'asc' | 'desc' | undefined,
    page: query.page ? parseInt(query.page, 10) : 1,
    limit: query.limit ? parseInt(query.limit, 10) : 50,
  };

  const result = searchSchema.safeParse(params);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const searchResult = await searchFiles(db, userId, result.data);

  return c.json({ success: true, data: searchResult });
});

app.post('/advanced', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = advancedSearchSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const db = getDb(c.env.DB);
  const searchResult = await advancedSearch(db, userId, result.data);

  return c.json({ success: true, data: searchResult });
});

app.get('/suggestions', async (c) => {
  const userId = c.get('userId')!;
  const query = c.req.query('q') || '';
  const type = (c.req.query('type') || 'name') as 'name' | 'tags' | 'mime';

  const db = getDb(c.env.DB);
  const suggestions = await getSearchSuggestions(db, userId, query, type);

  return c.json({ success: true, data: suggestions });
});

app.get('/recent', async (c) => {
  const userId = c.get('userId')!;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const db = getDb(c.env.DB);

  const recentFiles = await getRecentFiles(db, userId, limit);

  return c.json({ success: true, data: recentFiles });
});

export default app;
