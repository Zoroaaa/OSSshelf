/**
 * share.service.ts
 * 文件分享业务逻辑服务
 *
 * 功能:
 * - 创建分享链接
 * - 分享权限管理
 * - 分享文件预览与下载
 * - 密码保护与访问限制
 */

import { eq, and } from 'drizzle-orm';
import { getDb, files, shares } from '../db';
import { s3Get } from '../lib/s3client';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { ERROR_CODES, SHARE_DEFAULT_EXPIRY } from '@osshelf/shared';
import { getEncryptionKey } from '../lib/crypto';
import type { Env } from '../types/env';

async function resolveShare(
  db: ReturnType<typeof getDb>,
  shareId: string,
  password?: string
) {
  const share = await db.select().from(shares).where(eq(shares.id, shareId)).get();
  if (!share) return { error: { code: ERROR_CODES.NOT_FOUND, message: '分享链接不存在' }, status: 404 as const };
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return { error: { code: ERROR_CODES.SHARE_EXPIRED, message: '分享链接已过期' }, status: 410 as const };
  }
  if (share.password && share.password !== password) {
    const code = password !== undefined ? ERROR_CODES.SHARE_PASSWORD_INVALID : ERROR_CODES.SHARE_PASSWORD_REQUIRED;
    const message = password !== undefined ? '密码错误' : '需要密码访问';
    return { error: { code, message }, status: 401 as const };
  }
  return { share };
}

export async function createShare(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  params: {
    fileId: string;
    password?: string;
    expiresAt?: string;
    downloadLimit?: number;
  }
) {
  const { fileId, password, expiresAt, downloadLimit } = params;

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  const shareId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expires = expiresAt || new Date(Date.now() + SHARE_DEFAULT_EXPIRY).toISOString();

  await db.insert(shares).values({
    id: shareId,
    fileId,
    userId,
    password: password || null,
    expiresAt: expires,
    downloadLimit: downloadLimit || null,
    downloadCount: 0,
    createdAt: now,
  });

  return {
    success: true,
    data: { id: shareId, fileId, expiresAt: expires, downloadLimit, createdAt: now, shareUrl: `/share/${shareId}` },
  };
}

export async function listUserShares(db: ReturnType<typeof getDb>, userId: string) {
  const userShares = await db.select().from(shares).where(eq(shares.userId, userId)).all();

  const enriched = await Promise.all(
    userShares.map(async (share) => {
      const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
      return {
        ...share,
        file: file
          ? { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, isFolder: file.isFolder }
          : null,
      };
    })
  );

  return enriched;
}

export async function deleteShare(db: ReturnType<typeof getDb>, userId: string, shareId: string) {
  const share = await db
    .select()
    .from(shares)
    .where(and(eq(shares.id, shareId), eq(shares.userId, userId)))
    .get();
  if (!share) {
    return { success: false, error: '分享不存在' };
  }

  await db.delete(shares).where(eq(shares.id, shareId));
  return { success: true };
}

export async function getShareInfo(db: ReturnType<typeof getDb>, shareId: string, password?: string) {
  const resolved = await resolveShare(db, shareId, password);
  if ('error' in resolved) {
    return { success: false, error: resolved.error, status: resolved.status };
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return { success: false, error: '文件不存在' };

  return {
    success: true,
    data: {
      id: share.id,
      file: { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, isFolder: file.isFolder },
      expiresAt: share.expiresAt,
      downloadLimit: share.downloadLimit,
      downloadCount: share.downloadCount,
      hasPassword: !!share.password,
    },
  };
}

export async function getSharePreview(
  env: Env,
  db: ReturnType<typeof getDb>,
  shareId: string,
  password?: string
) {
  const resolved = await resolveShare(db, shareId, password);
  if ('error' in resolved) {
    return { success: false, error: resolved.error, status: resolved.status };
  }

  const { share } = resolved;
  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return { success: false, error: '文件不存在' };

  if (!file.mimeType?.startsWith('image/')) {
    return { success: false, error: '只支持预览图片' };
  }

  const encKey = getEncryptionKey(env);
  const bucketCfg = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  if (bucketCfg) {
    const s3Res = await s3Get(bucketCfg, file.r2Key);
    return {
      success: true,
      data: {
        body: s3Res.body,
        headers: { 'Content-Type': file.mimeType!, 'Cache-Control': 'private, max-age=300' },
      },
    };
  } else if (env.FILES) {
    const r2Object = await env.FILES.get(file.r2Key);
    if (!r2Object) return { success: false, error: '文件内容不存在' };
    return {
      success: true,
      data: {
        body: r2Object.body,
        headers: { 'Content-Type': file.mimeType!, 'Cache-Control': 'private, max-age=300' },
      },
    };
  }
  return { success: false, error: '存储桶未配置' };
}

export async function downloadSharedFile(
  env: Env,
  db: ReturnType<typeof getDb>,
  shareId: string,
  password?: string
) {
  const resolved = await resolveShare(db, shareId, password);
  if ('error' in resolved) {
    return { success: false, error: resolved.error, status: resolved.status };
  }

  const { share } = resolved;
  if (share.downloadLimit && share.downloadCount >= share.downloadLimit) {
    return { success: false, error: '下载次数已达上限' };
  }

  const file = await db.select().from(files).where(eq(files.id, share.fileId)).get();
  if (!file) return { success: false, error: '文件不存在' };
  if (file.isFolder) return { success: false, error: '无法下载文件夹' };

  await db
    .update(shares)
    .set({ downloadCount: share.downloadCount + 1 })
    .where(eq(shares.id, shareId));

  const encKey = getEncryptionKey(env);
  const bucketCfg = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
  const dlHeaders = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
    'Content-Length': file.size.toString(),
  };

  if (bucketCfg) {
    const s3Res = await s3Get(bucketCfg, file.r2Key);
    return { success: true, data: { body: s3Res.body, headers: dlHeaders } };
  }
  if (env.FILES) {
    const r2Object = await env.FILES.get(file.r2Key);
    if (!r2Object) return { success: false, error: '文件内容不存在' };
    return { success: true, data: { body: r2Object.body, headers: dlHeaders } };
  }
  return { success: false, error: '存储桶未配置' };
}
