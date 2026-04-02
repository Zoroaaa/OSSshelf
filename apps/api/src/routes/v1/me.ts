/**
 * v1/me.ts
 * 当前用户 API 路由
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb, users, files, storageBuckets } from '../../db';
import { authMiddleware } from '../../middleware/auth';
import { throwAppError } from '../../middleware/error';
import type { Env, Variables } from '../../types/env';

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  storageQuota: z.number(),
  storageUsed: z.number(),
  createdAt: z.string(),
});

const getMeRoute = createRoute({
  method: 'get',
  path: '/',
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({ success: z.boolean(), data: UserSchema }) },
      },
      description: '用户信息',
    },
  },
  tags: ['Me'],
  summary: '获取当前用户信息',
});

app.openapi(getMeRoute, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const user = await db.select().from(users).where(eq(users.id, userId)).get();

  if (!user) {
    throwAppError('USER_NOT_FOUND', '用户不存在');
  }

  const storageResult = await db
    .select({ total: sql<number>`COALESCE(SUM(size), 0)` })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      storageQuota: user.storageQuota ?? 0,
      storageUsed: Number(storageResult?.total ?? 0),
      createdAt: user.createdAt,
    },
  });
});

const getStatsRoute = createRoute({
  method: 'get',
  path: '/stats',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              fileCount: z.number(),
              folderCount: z.number(),
              storageUsed: z.number(),
              bucketCount: z.number(),
            }),
          }),
        },
      },
      description: '用户统计',
    },
  },
  tags: ['Me'],
  summary: '获取用户统计',
});

app.openapi(getStatsRoute, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const fileStats = await db
    .select({
      fileCount: sql<number>`COUNT(CASE WHEN is_folder = 0 THEN 1 END)`,
      folderCount: sql<number>`COUNT(CASE WHEN is_folder = 1 THEN 1 END)`,
      storageUsed: sql<number>`COALESCE(SUM(size), 0)`,
    })
    .from(files)
    .where(eq(files.userId, userId))
    .get();

  const bucketCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(storageBuckets)
    .where(eq(storageBuckets.userId, userId))
    .get();

  return c.json({
    success: true,
    data: {
      fileCount: Number(fileStats?.fileCount ?? 0),
      folderCount: Number(fileStats?.folderCount ?? 0),
      storageUsed: Number(fileStats?.storageUsed ?? 0),
      bucketCount: Number(bucketCount?.count ?? 0),
    },
  });
});

const updateMeRoute = createRoute({
  method: 'patch',
  path: '/',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(100).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({ success: z.boolean(), data: UserSchema }) },
      },
      description: '更新成功',
    },
  },
  tags: ['Me'],
  summary: '更新用户信息',
});

app.openapi(updateMeRoute, async (c) => {
  const userId = c.get('userId')!;
  const { name } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const now = new Date().toISOString();
  await db.update(users).set({ name, updatedAt: now }).where(eq(users.id, userId));

  const user = await db.select().from(users).where(eq(users.id, userId)).get();

  return c.json({
    success: true,
    data: {
      id: user!.id,
      email: user!.email,
      name: user!.name,
      role: user!.role,
      storageQuota: user!.storageQuota ?? 0,
      storageUsed: 0,
      createdAt: user!.createdAt,
    },
  });
});

export { app as meRoute };
