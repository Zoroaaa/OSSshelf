/**
 * v1/folders.ts
 * 文件夹 API 路由
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { eq, and, isNull, desc, sql, or, inArray } from 'drizzle-orm';
import { getDb, files, storageBuckets, filePermissions, groupMembers } from '../../db';
import { authMiddleware } from '../../middleware/auth';
import { checkFilePermission, inheritParentPermissions } from '../../routes/permissions';
import { throwAppError } from '../../middleware/error';
import type { Env, Variables } from '../../types/env';

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  isFolder: z.literal(true),
  parentId: z.string().nullable(),
  bucketId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createFolderRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(255),
            parentId: z.string().optional().nullable(),
            bucketId: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': { schema: z.object({ success: z.boolean(), data: FolderSchema }) },
      },
      description: '文件夹创建成功',
    },
    400: { description: '参数错误' },
  },
  tags: ['Folders'],
  summary: '创建文件夹',
});

app.openapi(createFolderRoute, async (c) => {
  const userId = c.get('userId')!;
  const { name, parentId, bucketId } = c.req.valid('json');
  const db = getDb(c.env.DB);

  let targetBucketId = bucketId;
  if (!targetBucketId) {
    const defaultBucket = await db
      .select()
      .from(storageBuckets)
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true)))
      .get();
    targetBucketId = defaultBucket?.id;
  }

  if (!targetBucketId) {
    throwAppError('BUCKET_NOT_FOUND', '请先创建存储桶');
  }

  let parentPath = '';
  if (parentId) {
    const { hasAccess } = await checkFilePermission(db, parentId, userId, 'write', c.env);
    if (!hasAccess) {
      throwAppError('FOLDER_ACCESS_DENIED', '无权在此文件夹中创建');
    }

    const parent = await db.select().from(files).where(eq(files.id, parentId)).get();
    if (!parent || !parent.isFolder) {
      throwAppError('PARENT_NOT_FOLDER', '父目录不存在或不是文件夹');
    }
    parentPath = parent.path;
  }

  const folderId = crypto.randomUUID();
  const folderPath = parentPath ? `${parentPath}/${name}` : `/${name}`;
  const now = new Date().toISOString();

  await db.insert(files).values({
    id: folderId,
    userId,
    name,
    path: folderPath,
    isFolder: true,
    parentId: parentId || null,
    bucketId: targetBucketId,
    size: 0,
    hash: null,
    mimeType: null,
    r2Key: `folder:${folderId}`,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await inheritParentPermissions(db, folderId, parentId || null);

  return c.json(
    {
      success: true,
      data: {
        id: folderId,
        name,
        path: folderPath,
        isFolder: true,
        parentId: parentId || null,
        bucketId: targetBucketId,
        createdAt: now,
        updatedAt: now,
      },
    },
    201
  );
});

const listFoldersRoute = createRoute({
  method: 'get',
  path: '/',
  request: {
    query: z.object({
      parentId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(FolderSchema),
          }),
        },
      },
      description: '文件夹列表',
    },
  },
  tags: ['Folders'],
  summary: '列出文件夹',
});

app.openapi(listFoldersRoute, async (c) => {
  const userId = c.get('userId')!;
  const { parentId } = c.req.valid('query');
  const db = getDb(c.env.DB);

  // 获取用户所属的用户组
  const userGroups = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
    .all();
  const groupIds = userGroups.map((g) => g.groupId);

  // 查询用户直接获得授权的文件ID
  const userPermittedFiles = await db
    .select({ fileId: filePermissions.fileId })
    .from(filePermissions)
    .where(and(eq(filePermissions.userId, userId), eq(filePermissions.subjectType, 'user')))
    .all();

  // 查询用户组获得授权的文件ID
  let groupPermittedFiles: { fileId: string }[] = [];
  if (groupIds.length > 0) {
    groupPermittedFiles = await db
      .select({ fileId: filePermissions.fileId })
      .from(filePermissions)
      .where(and(inArray(filePermissions.groupId, groupIds), eq(filePermissions.subjectType, 'group')))
      .all();
  }

  const permittedIds = new Set([
    ...userPermittedFiles.map((p) => p.fileId),
    ...groupPermittedFiles.map((p) => p.fileId),
  ]);

  // 构建查询条件
  const conditions: any[] = [eq(files.isFolder, true), isNull(files.deletedAt)];

  if (parentId) {
    // 指定父目录时，检查权限
    const { hasAccess } = await checkFilePermission(db, parentId, userId, 'read', c.env);
    if (!hasAccess) {
      return c.json({ success: true, data: [] });
    }
    conditions.push(eq(files.parentId, parentId));
  } else {
    // 未指定父目录时：返回用户自己的根目录文件夹 + 被授权的文件夹
    const ownershipCondition = or(
      and(eq(files.userId, userId), isNull(files.parentId)),
      permittedIds.size > 0 ? inArray(files.id, Array.from(permittedIds)) : undefined
    );
    conditions.push(ownershipCondition);
  }

  const folders = await db
    .select()
    .from(files)
    .where(and(...conditions.filter(Boolean)))
    .orderBy(desc(files.name))
    .all();

  return c.json({
    success: true,
    data: folders.map((f) => ({
      id: f.id,
      name: f.name,
      path: f.path,
      isFolder: true,
      parentId: f.parentId,
      bucketId: f.bucketId,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })),
  });
});

export { app as foldersRoute };
