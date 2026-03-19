/**
 * preview.service.ts
 * 文件预览业务逻辑服务
 *
 * 功能:
 * - 获取预览信息（类型、语言等）
 * - 获取原始文本内容
 * - 流媒体预览
 * - 缩略图生成
 * - Office文档预览
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, users } from '../db';
import { ERROR_CODES, CODE_HIGHLIGHT_EXTENSIONS, OFFICE_MIME_TYPES } from '@osshelf/shared';
import type { Env } from '../types/env';
import { s3Get } from '../lib/s3client';
import { resolveBucketConfig } from '../lib/bucketResolver';
import { verifyJWT, getEncryptionKey } from '../lib/crypto';

const MAX_PREVIEW_SIZE = 10 * 1024 * 1024;

export function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '';
}

export function getLanguageFromExtension(ext: string): string | null {
  return CODE_HIGHLIGHT_EXTENSIONS[ext] || null;
}

export function isPreviewable(mimeType: string | null, fileName: string): { previewable: boolean; type: string } {
  if (!mimeType) {
    const ext = getFileExtension(fileName);
    if (CODE_HIGHLIGHT_EXTENSIONS[ext]) {
      return { previewable: true, type: 'code' };
    }
    return { previewable: false, type: 'unknown' };
  }

  if (mimeType.startsWith('image/')) {
    return { previewable: true, type: 'image' };
  }
  if (mimeType.startsWith('video/')) {
    return { previewable: true, type: 'video' };
  }
  if (mimeType.startsWith('audio/')) {
    return { previewable: true, type: 'audio' };
  }
  if (mimeType === 'application/pdf') {
    return { previewable: true, type: 'pdf' };
  }
  if (mimeType.startsWith('text/')) {
    if (mimeType === 'text/markdown' || fileName.endsWith('.md')) {
      return { previewable: true, type: 'markdown' };
    }
    return { previewable: true, type: 'text' };
  }
  if (mimeType === 'application/json' || mimeType === 'application/xml') {
    return { previewable: true, type: 'code' };
  }

  const ext = getFileExtension(fileName);
  if (CODE_HIGHLIGHT_EXTENSIONS[ext]) {
    return { previewable: true, type: 'code' };
  }

  if (OFFICE_MIME_TYPES.includes(mimeType as (typeof OFFICE_MIME_TYPES)[number])) {
    return { previewable: true, type: 'office' };
  }

  return { previewable: false, type: 'unknown' };
}

export async function verifyTokenFromQuery(
  env: Env,
  token: string
): Promise<{ userId: string; email: string; role: string } | null> {
  if (!token) return null;

  try {
    const decoded = await verifyJWT(token, env.JWT_SECRET);
    const session = await env.KV.get(`session:${token}`);
    if (!session) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function getPreviewInfo(
  db: ReturnType<typeof getDb>,
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

  const { previewable, type } = isPreviewable(file.mimeType, file.name);

  const ext = getFileExtension(file.name);
  const language = getLanguageFromExtension(ext);

  return {
    success: true,
    data: {
      id: file.id,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      previewable,
      previewType: type,
      language,
      extension: ext,
      canPreview: previewable && file.size <= MAX_PREVIEW_SIZE,
    },
  };
}

export async function getRawContent(
  env: Env,
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

  if (file.size > MAX_PREVIEW_SIZE) {
    return { success: false, error: '文件过大，无法在线预览' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return { success: false, error: '存储桶未配置' };
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) {
    return { success: false, error: '文件内容不存在' };
  }

  const content = await s3Res.text();

  return {
    success: true,
    data: {
      content,
      mimeType: file.mimeType,
      name: file.name,
      size: file.size,
    },
  };
}

export async function getStreamContent(
  env: Env,
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

  const { type } = isPreviewable(file.mimeType, file.name);
  if (!['image', 'video', 'audio', 'pdf'].includes(type)) {
    return { success: false, error: '该文件类型不支持流式预览' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return { success: false, error: '存储桶未配置' };
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);

  if (!s3Res.ok) {
    return { success: false, error: '文件内容不存在' };
  }

  const headers: Record<string, string> = {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Length': file.size.toString(),
    'Accept-Ranges': 'bytes',
  };

  if (type === 'video' || type === 'audio') {
    headers['Content-Disposition'] = 'inline';
  }

  return { success: true, data: { body: s3Res.body, headers } };
}

export async function getThumbnail(
  env: Env,
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  fileId: string,
  width: number,
  height: number
) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
    .get();

  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  if (!file.mimeType?.startsWith('image/')) {
    return { success: false, error: '只支持图片文件生成缩略图' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return { success: false, error: '存储桶未配置' };
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) {
    return { success: false, error: '文件内容不存在' };
  }

  const imageBuffer = await s3Res.arrayBuffer();

  return {
    success: true,
    data: {
      buffer: imageBuffer,
      headers: {
        'Content-Type': file.mimeType,
        'Cache-Control': 'public, max-age=31536000',
        'X-Thumbnail-Size': `${width}x${height}`,
      },
    },
  };
}

export async function getOfficePreview(
  env: Env,
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

  if (!OFFICE_MIME_TYPES.includes(file.mimeType as (typeof OFFICE_MIME_TYPES)[number])) {
    return { success: false, error: '不支持该文件类型' };
  }

  const bucketConfig = await resolveBucketConfig(db, userId, encKey, file.bucketId, file.parentId);
  if (!bucketConfig) {
    return { success: false, error: '存储桶未配置' };
  }

  const s3Res = await s3Get(bucketConfig, file.r2Key);
  if (!s3Res.ok) {
    return { success: false, error: '文件内容不存在' };
  }

  const fileBuffer = await s3Res.arrayBuffer();
  const base64Content = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

  return {
    success: true,
    data: {
      fileName: file.name,
      mimeType: file.mimeType,
      base64Content,
      size: file.size,
    },
  };
}
