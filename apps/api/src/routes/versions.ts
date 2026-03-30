/**
 * versions.ts
 * 文件版本管理路由
 *
 * 功能:
 * - 版本历史记录查询
 * - 版本回滚
 * - 版本下载
 * - 版本删除
 * - 版本设置管理
 */

import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb, files, fileVersions, filePermissions } from '../db';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { updateUserStorage } from '../lib/bucketResolver';
import { s3Get, s3Delete } from '../lib/s3client';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { getEncryptionKey } from '../lib/crypto';
import { isVersionableFile } from '../lib/versionManager';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const updateVersionSettingsSchema = z.object({
  maxVersions: z.number().int().min(1).max(100).optional(),
  versionRetentionDays: z.number().int().min(1).max(365).optional(),
});

app.use('/*', authMiddleware);

app.get('/:fileId/versions', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND');
  }

  if (file.userId !== userId) {
    const permission = await db
      .select()
      .from(filePermissions)
      .where(and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, userId!)))
      .get();
    if (!permission) {
      throwAppError('FILE_ACCESS_DENIED');
    }
  }

  if (file.isFolder) {
    throwAppError('FOLDER_VERSION_NOT_SUPPORTED');
  }

  if (!isVersionableFile(file.mimeType, file.name)) {
    return c.json({
      success: true,
      data: {
        versions: [],
        currentVersion: file.currentVersion ?? 1,
        maxVersions: file.maxVersions ?? 10,
        versionRetentionDays: file.versionRetentionDays ?? 30,
        total: 0,
        versionable: false,
        message: '此文件类型不支持版本控制，仅支持可编辑的文本文件',
      },
    });
  }

  const versions = await db
    .select({
      id: fileVersions.id,
      version: fileVersions.version,
      size: fileVersions.size,
      mimeType: fileVersions.mimeType,
      changeSummary: fileVersions.changeSummary,
      createdBy: fileVersions.createdBy,
      createdAt: fileVersions.createdAt,
    })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.version))
    .all();

  const currentVersion = file.currentVersion ?? 1;
  const maxVersions = file.maxVersions ?? 10;
  const versionRetentionDays = file.versionRetentionDays ?? 30;

  return c.json({
    success: true,
    data: {
      versions,
      currentVersion,
      maxVersions,
      versionRetentionDays,
      total: versions.length,
      versionable: true,
    },
  });
});

app.get('/:fileId/versions/:version', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('fileId');
  const versionNum = parseInt(c.req.param('version'), 10);

  if (isNaN(versionNum) || versionNum < 1) {
    throwAppError('INVALID_VERSION_NUMBER');
  }

  const db = getDb(c.env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND');
  }

  if (file.userId !== userId) {
    throwAppError('FILE_ACCESS_DENIED');
  }

  const version = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, versionNum)))
    .get();

  if (!version) {
    throwAppError('VERSION_NOT_FOUND');
  }

  return c.json({
    success: true,
    data: {
      ...version,
      isCurrentVersion: versionNum === (file.currentVersion ?? 1),
    },
  });
});

app.get('/:fileId/versions/:version/download', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('fileId');
  const versionNum = parseInt(c.req.param('version'), 10);

  if (isNaN(versionNum) || versionNum < 1) {
    throwAppError('INVALID_VERSION_NUMBER');
  }

  const db = getDb(c.env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND');
  }

  if (file.userId !== userId) {
    throwAppError('FILE_ACCESS_DENIED');
  }

  const version = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, versionNum)))
    .get();

  if (!version) {
    throwAppError('VERSION_NOT_FOUND');
  }

  if (!file.bucketId) {
    throwAppError('BUCKET_NOT_FOUND');
  }

  const encKey = await getEncryptionKey(c.env);
  const bucketConfig = await resolveBucketConfig(db, userId!, encKey, file.bucketId);

  if (!bucketConfig) {
    throwAppError('BUCKET_CONNECTION_FAILED');
  }

  const fileResponse = await s3Get(bucketConfig, version.r2Key);
  const fileBuffer = await fileResponse.arrayBuffer();

  c.header('Content-Type', version.mimeType || 'application/octet-stream');
  c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
  c.header('Content-Length', String(version.size));

  return c.body(fileBuffer);
});

app.post('/:fileId/versions/:version/restore', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('fileId');
  const versionNum = parseInt(c.req.param('version'), 10);

  if (isNaN(versionNum) || versionNum < 1) {
    throwAppError('INVALID_VERSION_NUMBER');
  }

  const db = getDb(c.env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND');
  }

  if (file.userId !== userId) {
    throwAppError('FILE_WRITE_DENIED');
  }

  if (file.isFolder) {
    throwAppError('FOLDER_VERSION_NOT_SUPPORTED');
  }

  const targetVersion = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, versionNum)))
    .get();

  if (!targetVersion) {
    throwAppError('VERSION_NOT_FOUND');
  }

  const currentVersion = file.currentVersion ?? 1;

  if (versionNum === currentVersion) {
    return c.json({
      success: true,
      data: { message: '已是当前版本', version: versionNum },
    });
  }

  const newVersionNum = currentVersion + 1;
  const versionId = crypto.randomUUID();

  await db.insert(fileVersions).values({
    id: versionId,
    fileId,
    version: newVersionNum,
    r2Key: targetVersion.r2Key,
    size: targetVersion.size,
    mimeType: targetVersion.mimeType,
    hash: targetVersion.hash,
    refCount: 1,
    changeSummary: `从版本 ${versionNum} 恢复`,
    createdBy: userId,
    createdAt: new Date().toISOString(),
  });

  await db
    .update(files)
    .set({
      currentVersion: newVersionNum,
      size: targetVersion.size,
      mimeType: targetVersion.mimeType,
      hash: targetVersion.hash,
      r2Key: targetVersion.r2Key,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(files.id, fileId));

  // 恢复版本不更新存储空间，因为版本的存储对象已经存在
  // 文件的 size 字段仅表示当前版本的大小，不反映实际存储占用

  await db
    .update(fileVersions)
    .set({ refCount: sql`${fileVersions.refCount} + 1` })
    .where(eq(fileVersions.id, targetVersion.id));

  return c.json({
    success: true,
    data: {
      message: '版本恢复成功',
      newVersion: newVersionNum,
      restoredFrom: versionNum,
    },
  });
});

app.delete('/:fileId/versions/:version', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('fileId');
  const versionNum = parseInt(c.req.param('version'), 10);

  if (isNaN(versionNum) || versionNum < 1) {
    throwAppError('INVALID_VERSION_NUMBER');
  }

  const db = getDb(c.env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND');
  }

  if (file.userId !== userId) {
    throwAppError('FILE_DELETE_DENIED');
  }

  const currentVersion = file.currentVersion ?? 1;
  if (versionNum === currentVersion) {
    throwAppError('CANNOT_DELETE_CURRENT_VERSION');
  }

  const version = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, versionNum)))
    .get();

  if (!version) {
    throwAppError('VERSION_NOT_FOUND');
  }

  // 检查同一 r2Key 是否还有其他版本引用（去重场景）
  const sharedRefs = await db
    .select({ id: fileVersions.id })
    .from(fileVersions)
    .where(and(eq(fileVersions.r2Key, version.r2Key), eq(fileVersions.fileId, fileId)))
    .all();

  const isLastRef = sharedRefs.length <= 1 && version.r2Key !== file.r2Key;

  // 删除版本记录
  await db.delete(fileVersions).where(eq(fileVersions.id, version.id));

  // 若是最后一个引用且与主文件 r2Key 不同，清理物理对象
  if (isLastRef) {
    const encKey = getEncryptionKey(c.env);
    const bucketConfig = await resolveBucketConfig(db, userId!, encKey, file.bucketId);
    if (bucketConfig) {
      await s3Delete(bucketConfig, version.r2Key).catch((e) =>
        console.error(`Version r2Key delete failed ${version.r2Key}:`, e)
      );
    } else if (c.env.FILES) {
      await (c.env.FILES as R2Bucket).delete(version.r2Key).catch(() => {});
    }
    // 释放存储空间
    await updateUserStorage(db, userId!, -version.size);
  }

  return c.json({
    success: true,
    data: { message: '版本已删除' },
  });
});

app.patch('/:fileId/version-settings', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('fileId');
  const body = await c.req.json();

  const parsed = updateVersionSettingsSchema.safeParse(body);
  if (!parsed.success) {
    throwAppError('VALIDATION_ERROR', parsed.error.message);
  }

  const db = getDb(c.env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND');
  }

  if (file.userId !== userId) {
    throwAppError('FILE_WRITE_DENIED');
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.maxVersions !== undefined) {
    updateData.maxVersions = parsed.data.maxVersions;
  }
  if (parsed.data.versionRetentionDays !== undefined) {
    updateData.versionRetentionDays = parsed.data.versionRetentionDays;
  }

  await db.update(files).set(updateData).where(eq(files.id, fileId));

  return c.json({
    success: true,
    data: {
      message: '版本设置已更新',
      maxVersions: parsed.data.maxVersions ?? file.maxVersions,
      versionRetentionDays: parsed.data.versionRetentionDays ?? file.versionRetentionDays,
    },
  });
});

app.get('/:fileId/versions/diff', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('fileId');
  const fromVersion = parseInt(c.req.query('from') || '', 10);
  const toVersion = parseInt(c.req.query('to') || '', 10);

  if (isNaN(fromVersion) || isNaN(toVersion)) {
    throwAppError('INVALID_VERSION_NUMBER', '请提供有效的版本号');
  }

  const db = getDb(c.env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    throwAppError('FILE_NOT_FOUND');
  }

  if (file.userId !== userId) {
    throwAppError('FILE_ACCESS_DENIED');
  }

  const fromVer = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, fromVersion)))
    .get();

  const toVer = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, toVersion)))
    .get();

  if (!fromVer || !toVer) {
    throwAppError('VERSION_NOT_FOUND');
  }

  const isTextFile = (mimeType: string | null) => {
    if (!mimeType) return false;
    return (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/xml' ||
      mimeType === 'application/javascript'
    );
  };

  if (!isTextFile(fromVer.mimeType) || !isTextFile(toVer.mimeType)) {
    return c.json({
      success: true,
      data: {
        canDiff: false,
        message: '仅支持文本文件的版本对比',
        fromVersion: {
          version: fromVersion,
          size: fromVer.size,
          mimeType: fromVer.mimeType,
        },
        toVersion: {
          version: toVersion,
          size: toVer.size,
          mimeType: toVer.mimeType,
        },
      },
    });
  }

  return c.json({
    success: true,
    data: {
      canDiff: true,
      fromVersion: {
        version: fromVersion,
        size: fromVer.size,
        mimeType: fromVer.mimeType,
      },
      toVersion: {
        version: toVersion,
        size: toVer.size,
        mimeType: toVer.mimeType,
      },
      message: '请使用 /raw 端点获取文件内容进行对比',
    },
  });
});

export default app;
