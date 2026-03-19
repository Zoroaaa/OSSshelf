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
import { eq, and, isNull, like, gte, lte, inArray, or, desc, SQL } from 'drizzle-orm';
import { getDb, files, fileTags, storageBuckets } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

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

  const searchParams = result.data;
  const db = getDb(c.env.DB);

  async function getAllDescendantFolderIds(parentFolderId: string): Promise<Set<string>> {
    const folderIds = new Set<string>([parentFolderId]);
    const queue = [parentFolderId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const childFolders = await db
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.parentId, currentId), eq(files.isFolder, true), isNull(files.deletedAt)))
        .all();

      for (const folder of childFolders) {
        if (!folderIds.has(folder.id)) {
          folderIds.add(folder.id);
          queue.push(folder.id);
        }
      }
    }

    return folderIds;
  }

  const conditions: SQL[] = [eq(files.userId, userId), isNull(files.deletedAt)];

  if (searchParams.parentId !== undefined) {
    if (searchParams.parentId && searchParams.recursive) {
      const folderIds = await getAllDescendantFolderIds(searchParams.parentId);
      const folderIdArray = Array.from(folderIds);
      if (folderIdArray.length > 0) {
        conditions.push(inArray(files.parentId, folderIdArray));
      }
    } else {
      conditions.push(searchParams.parentId ? eq(files.parentId, searchParams.parentId) : isNull(files.parentId));
    }
  }

  if (searchParams.query) {
    conditions.push(like(files.name, `%${searchParams.query}%`));
  }

  if (searchParams.mimeType) {
    if (searchParams.mimeType.endsWith('/*')) {
      const prefix = searchParams.mimeType.slice(0, -1);
      conditions.push(like(files.mimeType, `${prefix}%`));
    } else {
      conditions.push(eq(files.mimeType, searchParams.mimeType));
    }
  }

  if (searchParams.isFolder !== undefined) {
    conditions.push(eq(files.isFolder, searchParams.isFolder));
  }

  if (searchParams.bucketId) {
    conditions.push(eq(files.bucketId, searchParams.bucketId));
  }

  if (searchParams.minSize !== undefined) {
    conditions.push(gte(files.size, searchParams.minSize));
  }

  if (searchParams.maxSize !== undefined) {
    conditions.push(lte(files.size, searchParams.maxSize));
  }

  if (searchParams.createdAfter) {
    conditions.push(gte(files.createdAt, searchParams.createdAfter));
  }

  if (searchParams.createdBefore) {
    conditions.push(lte(files.createdAt, searchParams.createdBefore));
  }

  if (searchParams.updatedAfter) {
    conditions.push(gte(files.updatedAt, searchParams.updatedAfter));
  }

  if (searchParams.updatedBefore) {
    conditions.push(lte(files.updatedAt, searchParams.updatedBefore));
  }

  let results = await db
    .select()
    .from(files)
    .where(and(...conditions))
    .all();

  if (searchParams.tags && searchParams.tags.length > 0) {
    const fileIdsWithTag = await db
      .select({ fileId: fileTags.fileId })
      .from(fileTags)
      .where(and(eq(fileTags.userId, userId), inArray(fileTags.name, searchParams.tags)))
      .all();

    const fileIdSet = new Set(fileIdsWithTag.map((t) => t.fileId));
    results = results.filter((f) => fileIdSet.has(f.id));
  }

  const sortBy = searchParams.sortBy || 'createdAt';
  const sortOrder = searchParams.sortOrder || 'desc';
  results.sort((a, b) => {
    let aVal: string | number = a[sortBy] ?? '';
    let bVal: string | number = b[sortBy] ?? '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (sortOrder === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    }
    return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
  });

  const total = results.length;
  const page = searchParams.page || 1;
  const limit = searchParams.limit || 50;
  const offset = (page - 1) * limit;
  const paginatedResults = results.slice(offset, offset + limit);

  const bucketIds = [...new Set(paginatedResults.map((f) => f.bucketId).filter(Boolean))] as string[];
  const bucketMap: Record<string, { id: string; name: string; provider: string }> = {};
  for (const bid of bucketIds) {
    const b = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bid)).get();
    if (b) bucketMap[b.id] = { id: b.id, name: b.name, provider: b.provider };
  }

  const fileIds = paginatedResults.map((f) => f.id);
  const allTags =
    fileIds.length > 0
      ? await db
          .select()
          .from(fileTags)
          .where(and(eq(fileTags.userId, userId), inArray(fileTags.fileId, fileIds)))
          .all()
      : [];

  const tagsByFile: Record<string, typeof allTags> = {};
  for (const tag of allTags) {
    if (!tagsByFile[tag.fileId]) tagsByFile[tag.fileId] = [];
    tagsByFile[tag.fileId].push(tag);
  }

  const itemsWithMeta = paginatedResults.map((f) => ({
    ...f,
    bucket: f.bucketId ? (bucketMap[f.bucketId] ?? null) : null,
    tags: tagsByFile[f.id] || [],
  }));

  const aggregations = {
    types: {} as Record<string, number>,
    mimeTypes: {} as Record<string, number>,
    sizeRange: { min: 0, max: 0 },
  };

  for (const f of results) {
    if (!f.isFolder) {
      const type = f.mimeType?.split('/')[0] || 'other';
      aggregations.types[type] = (aggregations.types[type] || 0) + 1;
      aggregations.mimeTypes[f.mimeType || 'unknown'] = (aggregations.mimeTypes[f.mimeType || 'unknown'] || 0) + 1;
    }
  }

  const sizes = results.filter((f) => !f.isFolder).map((f) => f.size);
  aggregations.sizeRange = {
    min: sizes.length > 0 ? Math.min(...sizes) : 0,
    max: sizes.length > 0 ? Math.max(...sizes) : 0,
  };

  return c.json({
    success: true,
    data: {
      items: itemsWithMeta,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      aggregations,
    },
  });
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

  const { conditions: searchConditions, logic, sortBy, sortOrder, page, limit } = result.data;
  const db = getDb(c.env.DB);

  const allFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const evaluateCondition = (file: typeof files.$inferSelect, condition: (typeof searchConditions)[0]): boolean => {
    const { field, operator, value } = condition;
    let fieldValue: unknown;

    if (field === 'tags') {
      return true;
    }

    fieldValue = file[field as keyof typeof file];

    switch (operator) {
      case 'contains':
        return (
          typeof fieldValue === 'string' &&
          typeof value === 'string' &&
          fieldValue.toLowerCase().includes(value.toLowerCase())
        );
      case 'equals':
        return fieldValue === value;
      case 'startsWith':
        return (
          typeof fieldValue === 'string' &&
          typeof value === 'string' &&
          fieldValue.toLowerCase().startsWith(value.toLowerCase())
        );
      case 'endsWith':
        return (
          typeof fieldValue === 'string' &&
          typeof value === 'string' &&
          fieldValue.toLowerCase().endsWith(value.toLowerCase())
        );
      case 'gt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
      case 'gte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue >= value;
      case 'lt':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
      case 'lte':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue <= value;
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue as string);
      default:
        return false;
    }
  };

  let filteredFiles = allFiles;

  const tagConditions = searchConditions.filter((c) => c.field === 'tags');
  const otherConditions = searchConditions.filter((c) => c.field !== 'tags');

  if (otherConditions.length > 0) {
    filteredFiles = filteredFiles.filter((file) => {
      const results = otherConditions.map((cond) => evaluateCondition(file, cond));
      return logic === 'and' ? results.every(Boolean) : results.some(Boolean);
    });
  }

  if (tagConditions.length > 0) {
    for (const tagCond of tagConditions) {
      const tagNames = Array.isArray(tagCond.value) ? tagCond.value : [tagCond.value as string];
      const filesWithTags = await db
        .select({ fileId: fileTags.fileId })
        .from(fileTags)
        .where(and(eq(fileTags.userId, userId), inArray(fileTags.name, tagNames)))
        .all();

      const fileIdSet = new Set(filesWithTags.map((t) => t.fileId));
      filteredFiles = filteredFiles.filter((f) => fileIdSet.has(f.id));
    }
  }

  const sortField = sortBy || 'createdAt';
  const order = sortOrder || 'desc';
  filteredFiles.sort((a, b) => {
    let aVal: string | number = a[sortField] ?? '';
    let bVal: string | number = b[sortField] ?? '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (order === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    }
    return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
  });

  const total = filteredFiles.length;
  const offset = ((page || 1) - 1) * (limit || 50);
  const paginatedResults = filteredFiles.slice(offset, offset + (limit || 50));

  return c.json({
    success: true,
    data: {
      items: paginatedResults,
      total,
      page: page || 1,
      limit: limit || 50,
      totalPages: Math.ceil(total / (limit || 50)),
    },
  });
});

app.get('/suggestions', async (c) => {
  const userId = c.get('userId')!;
  const query = c.req.query('q') || '';
  const type = c.req.query('type') || 'name';

  const db = getDb(c.env.DB);

  if (type === 'name' && query.length >= 2) {
    const results = await db
      .select({ name: files.name })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), like(files.name, `${query}%`)))
      .limit(10)
      .all();

    const suggestions = [...new Set(results.map((r) => r.name))];
    return c.json({ success: true, data: suggestions });
  }

  if (type === 'tags') {
    const allTags = await db.select({ name: fileTags.name }).from(fileTags).where(eq(fileTags.userId, userId)).all();

    const uniqueTags = [...new Set(allTags.map((t) => t.name))];
    const filtered = query ? uniqueTags.filter((t) => t.toLowerCase().includes(query.toLowerCase())) : uniqueTags;

    return c.json({ success: true, data: filtered.slice(0, 20) });
  }

  if (type === 'mime') {
    const results = await db
      .select({ mimeType: files.mimeType })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
      .all();

    const mimeTypes = [...new Set(results.map((r) => r.mimeType).filter(Boolean))] as string[];
    const filtered = query ? mimeTypes.filter((m) => m.toLowerCase().includes(query.toLowerCase())) : mimeTypes;

    return c.json({ success: true, data: filtered.slice(0, 20) });
  }

  return c.json({ success: true, data: [] });
});

app.get('/recent', async (c) => {
  const userId = c.get('userId')!;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const db = getDb(c.env.DB);

  const recentFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .orderBy(desc(files.updatedAt))
    .limit(limit)
    .all();

  return c.json({ success: true, data: recentFiles });
});

export default app;
