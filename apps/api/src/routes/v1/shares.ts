/**
 * v1/shares.ts
 * 分享 API 路由
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { getDb, files, shares } from '../../db';
import { authMiddleware } from '../../middleware/auth';
import { checkFilePermission } from '../../routes/permissions';
import { throwAppError } from '../../middleware/error';
import type { Env, Variables } from '../../types/env';

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const ShareSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  fileName: z.string(),
  expiresAt: z.string().nullable(),
  downloadLimit: z.number().nullable(),
  downloadCount: z.number(),
  hasPassword: z.boolean(),
  createdAt: z.string(),
});

const createShareRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            fileId: z.string().min(1),
            password: z.string().min(4).max(32).optional(),
            expiresAt: z.string().optional(),
            downloadLimit: z.number().min(1).max(10000).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': { schema: z.object({ success: z.boolean(), data: ShareSchema }) },
      },
      description: '分享创建成功',
    },
  },
  tags: ['Shares'],
  summary: '创建分享链接',
});

app.openapi(createShareRoute, async (c) => {
  const userId = c.get('userId')!;
  const { fileId, password, expiresAt, downloadLimit } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const { hasAccess, isOwner } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess && !isOwner) {
    throwAppError('FILE_ACCESS_DENIED', '无权分享此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file || file.deletedAt) {
    throwAppError('FILE_NOT_FOUND', '文件不存在');
  }

  const shareId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(shares).values({
    id: shareId,
    userId,
    fileId,
    password: password || null,
    expiresAt: expiresAt || null,
    downloadLimit: downloadLimit || null,
    downloadCount: 0,
    createdAt: now,
  });

  return c.json(
    {
      success: true,
      data: {
        id: shareId,
        fileId,
        fileName: file.name,
        expiresAt: expiresAt || null,
        downloadLimit: downloadLimit || null,
        downloadCount: 0,
        hasPassword: !!password,
        createdAt: now,
      },
    },
    201
  );
});

const listSharesRoute = createRoute({
  method: 'get',
  path: '/',
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({ success: z.boolean(), data: z.array(ShareSchema) }) },
      },
      description: '分享列表',
    },
  },
  tags: ['Shares'],
  summary: '列出我的分享',
});

app.openapi(listSharesRoute, async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const shareList = await db
    .select({
      id: shares.id,
      fileId: shares.fileId,
      fileName: files.name,
      expiresAt: shares.expiresAt,
      downloadLimit: shares.downloadLimit,
      downloadCount: shares.downloadCount,
      password: shares.password,
      createdAt: shares.createdAt,
    })
    .from(shares)
    .leftJoin(files, eq(shares.fileId, files.id))
    .where(eq(shares.userId, userId))
    .orderBy(desc(shares.createdAt))
    .all();

  return c.json({
    success: true,
    data: shareList.map((s) => ({
      id: s.id,
      fileId: s.fileId,
      fileName: s.fileName ?? '未知文件',
      expiresAt: s.expiresAt,
      downloadLimit: s.downloadLimit,
      downloadCount: s.downloadCount ?? 0,
      hasPassword: !!s.password,
      createdAt: s.createdAt,
    })),
  });
});

const deleteShareRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ message: z.string() }) }) },
      },
      description: '删除成功',
    },
  },
  tags: ['Shares'],
  summary: '删除分享',
});

app.openapi(deleteShareRoute, async (c) => {
  const userId = c.get('userId')!;
  const { id } = c.req.valid('param');
  const db = getDb(c.env.DB);

  const share = await db
    .select()
    .from(shares)
    .where(and(eq(shares.id, id), eq(shares.userId, userId)))
    .get();

  if (!share) {
    throwAppError('SHARE_NOT_FOUND', '分享不存在');
  }

  await db.delete(shares).where(eq(shares.id, id));

  return c.json({ success: true, data: { message: '分享已删除' } });
});

export { app as sharesRoute };
