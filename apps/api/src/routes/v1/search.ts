/**
 * v1/search.ts
 * 搜索 API 路由
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { eq, and, isNull, or, like, desc, sql } from 'drizzle-orm';
import { getDb, files, fileTags } from '../../db';
import { authMiddleware } from '../../middleware/auth';
import type { Env, Variables } from '../../types/env';

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  size: z.number(),
  mimeType: z.string().nullable(),
  isFolder: z.boolean(),
  parentId: z.string().nullable(),
  bucketId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const searchRoute = createRoute({
  method: 'get',
  path: '/',
  request: {
    query: z.object({
      q: z.string().min(1),
      type: z.enum(['file', 'folder', 'all']).optional(),
      mimeType: z.string().optional(),
      parentId: z.string().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              files: z.array(FileSchema),
              total: z.number(),
              page: z.number(),
              limit: z.number(),
            }),
          }),
        },
      },
      description: '搜索结果',
    },
  },
  tags: ['Search'],
  summary: '搜索文件',
});

app.openapi(searchRoute, async (c) => {
  const userId = c.get('userId')!;
  const { q, type = 'all', mimeType, parentId, page = '1', limit = '20' } = c.req.valid('query');
  const db = getDb(c.env.DB);

  const pageNum = parseInt(page, 10);
  const limitNum = Math.min(parseInt(limit, 10), 100);
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(files.userId, userId), isNull(files.deletedAt), like(files.name, `%${q}%`)];

  if (type === 'file') {
    conditions.push(eq(files.isFolder, false));
  } else if (type === 'folder') {
    conditions.push(eq(files.isFolder, true));
  }

  if (mimeType) {
    conditions.push(like(files.mimeType, `${mimeType}%`));
  }

  if (parentId) {
    conditions.push(eq(files.parentId, parentId));
  }

  const fileList = await db
    .select()
    .from(files)
    .where(and(...conditions))
    .orderBy(desc(files.updatedAt))
    .limit(limitNum)
    .offset(offset)
    .all();

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(files)
    .where(and(...conditions))
    .get();

  return c.json({
    success: true,
    data: {
      files: fileList.map((f) => ({
        id: f.id,
        name: f.name,
        path: f.path,
        size: f.size ?? 0,
        mimeType: f.mimeType,
        isFolder: f.isFolder,
        parentId: f.parentId,
        bucketId: f.bucketId,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
      total: countResult?.count ?? 0,
      page: pageNum,
      limit: limitNum,
    },
  });
});

const searchByTagRoute = createRoute({
  method: 'get',
  path: '/tags/{tag}',
  request: {
    params: z.object({ tag: z.string() }),
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              files: z.array(FileSchema),
              total: z.number(),
            }),
          }),
        },
      },
      description: '搜索结果',
    },
  },
  tags: ['Search'],
  summary: '按标签搜索',
});

app.openapi(searchByTagRoute, async (c) => {
  const userId = c.get('userId')!;
  const { tag } = c.req.valid('param');
  const { page = '1', limit = '20' } = c.req.valid('query');
  const db = getDb(c.env.DB);

  const pageNum = parseInt(page, 10);
  const limitNum = Math.min(parseInt(limit, 10), 100);
  const offset = (pageNum - 1) * limitNum;

  const taggedFiles = await db
    .select({
      id: files.id,
      name: files.name,
      path: files.path,
      size: files.size,
      mimeType: files.mimeType,
      isFolder: files.isFolder,
      parentId: files.parentId,
      bucketId: files.bucketId,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
    })
    .from(fileTags)
    .innerJoin(files, eq(fileTags.fileId, files.id))
    .where(and(eq(fileTags.name, tag), eq(files.userId, userId), isNull(files.deletedAt)))
    .orderBy(desc(files.updatedAt))
    .limit(limitNum)
    .offset(offset)
    .all();

  return c.json({
    success: true,
    data: {
      files: taggedFiles.map((f) => ({
        ...f,
        size: f.size ?? 0,
      })),
      total: taggedFiles.length,
    },
  });
});

export { app as searchRoute };
