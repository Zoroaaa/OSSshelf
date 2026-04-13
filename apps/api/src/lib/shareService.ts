/**
 * shareService.ts — 分享操作公共服务层
 *
 * 从 routes/share.ts 提取的核心业务逻辑，
 * 供 API 路由和 AI AgentTools 共同调用。
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files, shares } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { checkFilePermission } from '../lib/permissionService';
import { hashPassword } from './crypto';

export interface CreateShareInput {
  fileId: string;
  password?: string;
  expiresAt?: string;
  maxUses?: number;
}

export async function createShareLink(
  env: Env,
  userId: string,
  input: CreateShareInput
): Promise<{ success: true; shareId: string; share: Record<string, unknown> } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { fileId, password, expiresAt, maxUses } = input;

  // 权限检查
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'admin', env);
  if (!hasAccess) {
    return { success: false, error: '无权分享此文件' };
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return { success: false, error: '文件不存在' };

  const shareId = crypto.randomUUID();
  const now = new Date().toISOString();

  let hashedPassword: string | null = null;
  if (password) {
    hashedPassword = await hashPassword(password);
  }

  await db.insert(shares).values({
    id: shareId,
    fileId,
    userId,
    password: hashedPassword,
    downloadLimit: maxUses || null,
    downloadCount: 0,
    isUploadLink: false,
    uploadToken: null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    createdAt: now,
  });

  logger.info('ShareService', '分享链接创建成功', { shareId, fileId });

  return {
    success: true,
    shareId,
    share: {
      id: shareId,
      hasPassword: !!password,
      expiresAt,
      maxUses,
      createdAt: now,
    },
  };
}

export async function revokeShare(
  env: Env,
  userId: string,
  shareId: string
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const share = await db.select().from(shares).where(eq(shares.id, shareId)).get();
  if (!share) return { success: false, error: '分享链接不存在' };

  if (share.userId !== userId) {
    return { success: false, error: '无权撤销此分享' };
  }

  // 软删除：设置过期时间为过去
  const now = new Date().toISOString();
  await db.update(shares).set({ expiresAt: now }).where(eq(shares.id, shareId));

  logger.info('ShareService', '分享链接已撤销', { shareId });
  return { success: true, message: '分享链接已撤销' };
}

export interface UpdateShareInput {
  password?: string | null;
  expiresAt?: string | null;
  maxUses?: number | null;
}

export async function updateShare(
  env: Env,
  userId: string,
  shareId: string,
  input: UpdateShareInput
): Promise<{ success: true; message: string; changes: string[] } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { password, expiresAt, maxUses } = input;

  const share = await db
    .select()
    .from(shares)
    .where(and(eq(shares.id, shareId), eq(shares.userId, userId)))
    .get();
  if (!share) return { success: false, error: '分享链接不存在' };

  const updates: Record<string, unknown> = {};
  const changes: string[] = [];

  if (password !== undefined) {
    updates.password = password ? await hashPassword(password) : null;
    changes.push('password');
  }
  if (expiresAt !== undefined) {
    updates.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
    changes.push('expiresAt');
  }
  if (maxUses !== undefined) {
    updates.downloadLimit = maxUses || null;
    changes.push('downloadLimit');
  }

  if (changes.length === 0) return { success: true, message: '无需更新', changes: [] };

  await db.update(shares).set(updates).where(eq(shares.id, shareId));

  logger.info('ShareService', '分享设置已更新', { shareId, changes });
  return { success: true, message: '分享设置已更新', changes };
}

export interface CreateUploadLinkInput {
  folderId: string;
  password?: string;
  expiresInHours?: number;
  allowedMimeTypes?: string[];
  maxSizeBytes?: number;
  maxUploads?: number;
}

export async function createUploadLink(
  env: Env,
  userId: string,
  input: CreateUploadLinkInput
): Promise<
  { success: true; uploadLinkId: string; url: string; folderName: string } | { success: false; error: string }
> {
  const db = getDb(env.DB);
  const { folderId, password, expiresInHours = 72, allowedMimeTypes, maxSizeBytes, maxUploads } = input;

  const folder = await db
    .select()
    .from(files)
    .where(and(eq(files.id, folderId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt)))
    .get();
  if (!folder) return { success: false, error: '文件夹不存在或已被删除' };

  const uploadLinkId = crypto.randomUUID();
  const token = generateSecureToken(40);
  const expiresAt = new Date(Date.now() + Math.min(expiresInHours, 720) * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await db.insert(shares).values({
    id: uploadLinkId,
    userId,
    fileId: folderId,
    password: password || null,
    expiresAt,
    downloadLimit: maxUploads || null,
    downloadCount: 0,
    isUploadLink: true,
    uploadToken: token,
    maxUploadSize: maxSizeBytes || null,
    uploadAllowedMimeTypes: allowedMimeTypes?.join(',') || null,
    maxUploadCount: maxUploads || null,
    uploadCount: 0,
    createdAt: now,
  });

  logger.info('ShareService', '上传链接已创建', { uploadLinkId, folderId, folderName: folder.name });
  return { success: true, uploadLinkId, url: `/upload/${token}`, folderName: folder.name };
}

function generateSecureToken(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values)
    .map((v) => chars[v % chars.length])
    .join('');
}
