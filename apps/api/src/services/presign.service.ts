/**
 * presign.service.ts
 * 预签名URL业务逻辑服务
 *
 * 功能:
 * - 生成预签名上传URL
 * - 生成预签名下载URL
 * - 分片上传初始化与管理
 * - 上传确认与完成
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, users, storageBuckets } from '../db';
import { ERROR_CODES, MAX_FILE_SIZE, isPreviewableMimeType } from '@osshelf/shared';
import { getEncryptionKey } from '../lib/crypto';
import type { Env } from '../types/env';
import {
  s3PresignUrl,
  s3PresignUploadPart,
  s3CreateMultipartUpload,
  s3CompleteMultipartUpload,
  s3AbortMultipartUpload,
  type MultipartPart,
} from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, checkBucketQuota } from '../lib/bucketResolver';
import { checkFolderMimeTypeRestriction } from '../lib/folderPolicy';

const UPLOAD_EXPIRY = 3600;
const DOWNLOAD_EXPIRY = 21600;

function encodeFilename(name: string): string {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
}

async function getUserOrFail(db: ReturnType<typeof getDb>, userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('用户不存在');
  return user;
}

export async function getPresignedUploadUrl(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    parentId?: string | null;
    bucketId?: string | null;
  }
) {
  const { fileName, fileSize, mimeType, parentId, bucketId: requestedBucketId } = params;

  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId ?? null, mimeType);
  if (!mimeCheck.allowed) {
    return { success: false, error: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}` };
  }

  const user = await getUserOrFail(db, userId);
  if (user.storageUsed + fileSize > user.storageQuota) {
    return { success: false, error: '用户存储配额已满' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId ?? null, parentId ?? null);

  if (!bucketConfig) {
    return { success: true, data: { useProxy: true } };
  }

  if (bucketConfig.provider === 'telegram') {
    return { success: true, data: { useProxy: true, bucketId: bucketConfig.id } };
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
  if (quotaErr) {
    return { success: false, error: quotaErr };
  }

  const fileId = crypto.randomUUID();
  const r2Key = `files/${userId}/${fileId}/${encodeFilename(fileName)}`;

  const uploadUrl = await s3PresignUrl(bucketConfig, 'PUT', r2Key, UPLOAD_EXPIRY, mimeType);

  return {
    success: true,
    data: {
      uploadUrl,
      fileId,
      r2Key,
      bucketId: bucketConfig.id,
      expiresIn: UPLOAD_EXPIRY,
    },
  };
}
export async function confirmUpload(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  params: {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    parentId?: string | null;
    r2Key: string;
    bucketId?: string | null;
  }
) {
  const { fileId, fileName, fileSize, mimeType, parentId, r2Key, bucketId } = params;

  const existing = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (existing) {
    return { success: true, data: { id: existing.id, name: existing.name, alreadyConfirmed: true } };
  }

  const now = new Date().toISOString();
  const path = parentId ? `${parentId}/${fileName}` : `/${fileName}`;

  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name: fileName,
    path,
    type: 'file',
    size: fileSize,
    r2Key,
    mimeType: mimeType || null,
    hash: null,
    isFolder: false,
    bucketId: bucketId || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user) {
    await db
      .update(users)
      .set({ storageUsed: user.storageUsed + fileSize, updatedAt: now })
      .where(eq(users.id, userId));
  }

  if (bucketId) {
    await updateBucketStats(db, bucketId, fileSize, 1);
  }

  return {
    success: true,
    data: { id: fileId, name: fileName, size: fileSize, mimeType, path, bucketId: bucketId || null, createdAt: now },
  };
}
export async function initMultipartUpload(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    parentId?: string | null;
    bucketId?: string | null;
  }
) {
  const { fileName, fileSize, mimeType, parentId, bucketId: requestedBucketId } = params;

  const mimeCheck = await checkFolderMimeTypeRestriction(db, parentId ?? null, mimeType);
  if (!mimeCheck.allowed) {
    return { success: false, error: `此文件夹仅允许上传以下类型的文件: ${mimeCheck.allowedTypes?.join(', ')}` };
  }

  const user = await getUserOrFail(db, userId);
  if (user.storageUsed + fileSize > user.storageQuota) {
    return { success: false, error: '用户存储配额已满' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, requestedBucketId ?? null, parentId ?? null);
  if (!bucketConfig) {
    return { success: true, data: { useProxy: true } };
  }

  if (bucketConfig.provider === 'telegram') {
    return { success: true, data: { useProxy: true, bucketId: bucketConfig.id } };
  }

  const quotaErr = await checkBucketQuota(db, bucketConfig.id, fileSize);
  if (quotaErr) {
    return { success: false, error: quotaErr };
  }

  const fileId = crypto.randomUUID();
  const r2Key = `files/${userId}/${fileId}/${encodeFilename(fileName)}`;

  const uploadId = await s3CreateMultipartUpload(bucketConfig, r2Key, mimeType || 'application/octet-stream');

  const firstPartUrl = await s3PresignUploadPart(bucketConfig, r2Key, uploadId, 1, UPLOAD_EXPIRY);

  return {
    success: true,
    data: {
      uploadId,
      fileId,
      r2Key,
      bucketId: bucketConfig.id,
      firstPartUrl,
      expiresIn: UPLOAD_EXPIRY,
    },
  };
}
export async function getMultipartPartUrl(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: {
    r2Key: string;
    uploadId: string;
    partNumber: number;
    bucketId?: string | null;
  }
) {
  const { r2Key, uploadId, partNumber, bucketId } = params;

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, bucketId ?? null, null);
  if (!bucketConfig) {
    return { success: false, error: '未找到存储桶配置' };
  }

  const partUrl = await s3PresignUploadPart(bucketConfig, r2Key, uploadId, partNumber, UPLOAD_EXPIRY);

  return { success: true, data: { partUrl, partNumber, expiresIn: UPLOAD_EXPIRY } };
}
export async function completeMultipartUpload(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    parentId?: string | null;
    r2Key: string;
    uploadId: string;
    bucketId?: string | null;
    parts: MultipartPart[];
  }
) {
  const { fileId, fileName, fileSize, mimeType, parentId, r2Key, uploadId, bucketId, parts } = params;

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, bucketId ?? null, parentId ?? null);
  if (!bucketConfig) {
    return { success: false, error: '未找到存储桶配置' };
  }

  const existing = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (existing) {
    return { success: true, data: { id: existing.id, name: existing.name, alreadyConfirmed: true } };
  }

  await s3CompleteMultipartUpload(bucketConfig, r2Key, uploadId, parts);

  const now = new Date().toISOString();
  const path = parentId ? `${parentId}/${fileName}` : `/${fileName}`;

  await db.insert(files).values({
    id: fileId,
    userId,
    parentId: parentId || null,
    name: fileName,
    path,
    type: 'file',
    size: fileSize,
    r2Key,
    mimeType: mimeType || null,
    hash: null,
    isFolder: false,
    bucketId: bucketConfig.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user) {
    await db
      .update(users)
      .set({ storageUsed: user.storageUsed + fileSize, updatedAt: now })
      .where(eq(users.id, userId));
  }
  await updateBucketStats(db, bucketConfig.id, fileSize, 1);

  return {
    success: true,
    data: { id: fileId, name: fileName, size: fileSize, mimeType, path, bucketId: bucketConfig.id, createdAt: now },
  };
}
export async function abortMultipartUpload(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: {
    r2Key: string;
    uploadId: string;
    bucketId?: string | null;
  }
) {
  const { r2Key, uploadId, bucketId } = params;

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, bucketId ?? null, null);
  if (!bucketConfig) {
    return { success: false, error: '未找到存储桶配置' };
  }

  await s3AbortMultipartUpload(bucketConfig, r2Key, uploadId);

  return { success: true, data: { message: '分片上传已中止' } };
}
export async function getPresignedDownloadUrl(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  fileId: string
) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }
  if (file.isFolder) {
    return { success: false, error: '无法下载文件夹' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return { success: true, data: { useProxy: true, proxyUrl: `/api/files/${fileId}/download` } };
  }

  const downloadUrl = await s3PresignUrl(bucketConfig, 'GET', file.r2Key, DOWNLOAD_EXPIRY);

  return {
    success: true,
    data: {
      downloadUrl,
      fileName: file.name,
      mimeType: file.mimeType,
      size: file.size,
      expiresIn: DOWNLOAD_EXPIRY,
    },
  };
}
export async function getPresignedPreviewUrl(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  fileId: string
) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();
  if (!file) {
    return { success: false, error: '文件不存在' };
  }
  if (file.isFolder) {
    return { success: false, error: '文件夹无法预览' };
  }

  if (!isPreviewableMimeType(file.mimeType)) {
    return { success: false, error: '该文件类型不支持预览' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return { success: true, data: { useProxy: true, proxyUrl: `/api/files/${fileId}/preview` } };
  }

  const previewUrl = await s3PresignUrl(bucketConfig, 'GET', file.r2Key, 7200);

  return {
    success: true,
    data: {
      previewUrl,
      mimeType: file.mimeType,
      size: file.size,
      expiresIn: 7200,
    },
  };
}
