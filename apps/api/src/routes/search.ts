/**
 * search.ts
 * 文件搜索路由
 *
 * 功能:
 * - 关键词搜索（始终递归搜索子目录）
 * - 高级条件搜索
 * - 搜索建议
 * - 最近搜索记录
 * - 显示文件所属文件夹路径
 */

import { Hono } from 'hono';
import { eq, and, isNull, like, gte, lte, inArray, desc, asc, sql, SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { getDb, files, fileTags, storageBuckets, searchHistory } from '../db';
import type { DrizzleDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, logger } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { buildFolderPath, clearFilePathCache } from '../lib/utils';
import { searchSimilarFiles, isAIConfigured } from '../lib/vectorIndex';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const searchSchema = z.object({
  query: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
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
  semantic: z.boolean().optional(),
  hybrid: z.boolean().optional(),
  fts: z.boolean().optional(),
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

async function getAllDescendantFolderIds(db: DrizzleDb, parentFolderId: string): Promise<Set<string>> {
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

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const query = c.req.query();

  const params = {
    query: query.query,
    parentId: query.parentId || undefined,
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
    semantic: query.semantic === 'true',
    hybrid: query.hybrid === 'true',
    fts: query.fts === 'true',
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

  const conditions: SQL[] = [eq(files.userId, userId), isNull(files.deletedAt)];

  if (searchParams.parentId) {
    const folderIds = await getAllDescendantFolderIds(db, searchParams.parentId);
    const folderIdArray = Array.from(folderIds);
    if (folderIdArray.length > 0) {
      conditions.push(inArray(files.parentId, folderIdArray));
    }
  }

  const semanticResults: Map<string, number> = new Map();
  const useSemantic =
    (searchParams.semantic || searchParams.hybrid) && searchParams.query && (await isAIConfigured(c.env));

  if (useSemantic && searchParams.query) {
    const results = await searchSimilarFiles(c.env, searchParams.query, userId, {
      limit: searchParams.limit || 50,
      threshold: 0.5, // bge-m3 cosine 分数普遍低于 bge-base-en，0.6 会过滤过多
      mimeType: searchParams.mimeType,
    });
    for (const r of results) {
      semanticResults.set(r.fileId, r.score);
    }
  }

  if (searchParams.query && !searchParams.semantic && !searchParams.fts) {
    conditions.push(like(files.name, `%${searchParams.query}%`));
  } else if (searchParams.fts && searchParams.query) {
    let ftsIds: string[] = [];
    try {
      const ftsResults = await db
        .select({ id: sql<string>`files_fts.id` })
        .from(sql`files_fts`)
        .where(sql`files_fts MATCH ${searchParams.query}`)
        .all();
      ftsIds = ftsResults.map((r) => r.id);
    } catch {
      // FTS5 虚拟表不可用时降级为 LIKE 搜索
      conditions.push(like(files.name, `%${searchParams.query}%`));
    }
    if (ftsIds.length > 0) {
      conditions.push(inArray(files.id, ftsIds));
    } else if (!searchParams.query) {
      return c.json({
        success: true,
        data: {
          items: [],
          total: 0,
          page: searchParams.page || 1,
          limit: searchParams.limit || 50,
          totalPages: 0,
          aggregations: { types: {}, mimeTypes: {}, sizeRange: { min: 0, max: 0 } },
        },
      });
    }
  } else if (searchParams.semantic && semanticResults.size > 0) {
    conditions.push(inArray(files.id, Array.from(semanticResults.keys())));
  } else if (searchParams.hybrid && searchParams.query) {
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

  // tags 过滤前置：先获取符合 tag 条件的 fileId 集合，加入 SQL conditions
  if (searchParams.tags && searchParams.tags.length > 0) {
    const fileIdsWithTag = await db
      .select({ fileId: fileTags.fileId })
      .from(fileTags)
      .where(and(eq(fileTags.userId, userId), inArray(fileTags.name, searchParams.tags)))
      .all();

    const taggedIds = fileIdsWithTag.map((t) => t.fileId);
    if (taggedIds.length === 0) {
      return c.json({
        success: true,
        data: {
          items: [],
          total: 0,
          page: searchParams.page || 1,
          limit: searchParams.limit || 50,
          totalPages: 0,
          aggregations: { types: {}, mimeTypes: {}, sizeRange: { min: 0, max: 0 } },
        },
      });
    }
    conditions.push(inArray(files.id, taggedIds));
  }

  const sortBy = searchParams.sortBy || 'createdAt';
  const sortOrder = searchParams.sortOrder || 'desc';
  const sortColMap: Record<string, SQLiteColumn> = {
    name: files.name,
    size: files.size,
    createdAt: files.createdAt,
    updatedAt: files.updatedAt,
  };
  const sortCol = sortColMap[sortBy] ?? files.createdAt;
  const orderExpr = sortOrder === 'asc' ? asc(sortCol) : desc(sortCol);

  const page = searchParams.page || 1;
  const limit = searchParams.limit || 50;
  const offset = (page - 1) * limit;

  // total count + 分页结果并发查询，排序分页下推到 SQL
  const [paginatedResults, countRow] = await Promise.all([
    db
      .select()
      .from(files)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(limit)
      .offset(offset)
      .all(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(files)
      .where(and(...conditions))
      .get(),
  ]);

  const total = countRow?.count ?? 0;

  clearFilePathCache();

  // bucketMap 批量查询（一次 inArray 替代 N 次 .get()）
  const bucketIds = [...new Set(paginatedResults.map((f) => f.bucketId).filter(Boolean))] as string[];
  const bucketRows =
    bucketIds.length > 0
      ? await db
          .select({ id: storageBuckets.id, name: storageBuckets.name, provider: storageBuckets.provider })
          .from(storageBuckets)
          .where(inArray(storageBuckets.id, bucketIds))
          .all()
      : [];
  const bucketMap: Record<string, { id: string; name: string; provider: string }> = {};
  for (const b of bucketRows) bucketMap[b.id] = b;

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

  // buildFolderPath 并发执行
  const itemsWithMeta = await Promise.all(
    paginatedResults.map(async (f) => {
      const folderPath = await buildFolderPath(db, userId, f.parentId);
      return {
        ...f,
        bucket: f.bucketId ? (bucketMap[f.bucketId] ?? null) : null,
        tags: tagsByFile[f.id] || [],
        folderPath,
      };
    })
  );

  const aggregations = {
    types: {} as Record<string, number>,
    mimeTypes: {} as Record<string, number>,
    sizeRange: { min: 0, max: 0 },
  };

  for (const f of paginatedResults) {
    if (!f.isFolder) {
      const type = f.mimeType?.split('/')[0] || 'other';
      aggregations.types[type] = (aggregations.types[type] || 0) + 1;
      aggregations.mimeTypes[f.mimeType || 'unknown'] = (aggregations.mimeTypes[f.mimeType || 'unknown'] || 0) + 1;
    }
  }

  const sizes = paginatedResults.filter((f) => !f.isFolder).map((f) => f.size);
  aggregations.sizeRange = {
    min: sizes.length > 0 ? Math.min(...sizes) : 0,
    max: sizes.length > 0 ? Math.max(...sizes) : 0,
  };

  if (searchParams.query) {
    const q = searchParams.query.trim();
    try {
      const existing = await db
        .select()
        .from(searchHistory)
        .where(and(eq(searchHistory.userId, userId), eq(searchHistory.query, q)))
        .get();
      if (!existing) {
        await db.insert(searchHistory).values({
          id: crypto.randomUUID(),
          userId,
          query: q,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('SEARCH', '保存搜索历史失败', {}, error);
    }
  }

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
  const pageNum = page || 1;
  const limitNum = limit || 50;

  const tagConditions = searchConditions.filter((cond) => cond.field === 'tags');
  const fieldConditions = searchConditions.filter((cond) => cond.field !== 'tags');

  const baseConditions: SQL[] = [eq(files.userId, userId), isNull(files.deletedAt)];

  function buildFieldSQL(cond: (typeof fieldConditions)[0]): SQL | null {
    const { field, operator, value } = cond;
    const col = files[field as keyof typeof files.$inferSelect] as any;
    if (!col) return null;
    switch (operator) {
      case 'contains':
        return like(col, `%${value}%`);
      case 'equals':
        return sql`${col} = ${value}`;
      case 'startsWith':
        return like(col, `${value}%`);
      case 'endsWith':
        return like(col, `%${value}`);
      case 'gt':
        return sql`${col} > ${value}`;
      case 'gte':
        return sql`${col} >= ${value}`;
      case 'lt':
        return sql`${col} < ${value}`;
      case 'lte':
        return sql`${col} <= ${value}`;
      case 'in':
        return Array.isArray(value) && value.length > 0 ? inArray(col, value) : null;
      default:
        return null;
    }
  }

  const fieldSQLs = fieldConditions.map(buildFieldSQL).filter((s): s is SQL => s !== null);

  if (fieldSQLs.length > 0) {
    if (logic === 'or') {
      baseConditions.push(sql`(${sql.join(fieldSQLs, sql` OR `)})`);
    } else {
      baseConditions.push(...fieldSQLs);
    }
  }

  let tagFileIdSet: Set<string> | null = null;
  if (tagConditions.length > 0) {
    const allTagNames = tagConditions.flatMap((cond) =>
      Array.isArray(cond.value) ? cond.value : [cond.value as string]
    );
    const tagRows = await db
      .select({ fileId: fileTags.fileId })
      .from(fileTags)
      .where(and(eq(fileTags.userId, userId), inArray(fileTags.name, allTagNames)))
      .all();
    tagFileIdSet = new Set(tagRows.map((r) => r.fileId));
    if (tagFileIdSet.size > 0) {
      baseConditions.push(inArray(files.id, Array.from(tagFileIdSet)));
    } else {
      return c.json({ success: true, data: { items: [], total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
    }
  }

  const sortCol =
    {
      name: files.name,
      size: files.size,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
    }[sortBy || 'createdAt'] ?? files.createdAt;
  const orderExpr = (sortOrder || 'desc') === 'asc' ? asc(sortCol) : desc(sortCol);

  const [items, countRow] = await Promise.all([
    db
      .select()
      .from(files)
      .where(and(...baseConditions))
      .orderBy(orderExpr)
      .limit(limitNum)
      .offset((pageNum - 1) * limitNum)
      .all(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(files)
      .where(and(...baseConditions))
      .get(),
  ]);

  const total = countRow?.count ?? 0;

  return c.json({
    success: true,
    data: {
      items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
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

app.get('/history', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(searchHistory)
    .where(eq(searchHistory.userId, userId))
    .orderBy(desc(searchHistory.createdAt))
    .limit(20)
    .all();
  return c.json({ success: true, data: rows });
});

app.delete('/history', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  await db.delete(searchHistory).where(eq(searchHistory.userId, userId));
  return c.json({ success: true });
});

app.delete('/history/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  await db.delete(searchHistory).where(and(eq(searchHistory.id, id), eq(searchHistory.userId, userId)));
  return c.json({ success: true });
});

export default app;
