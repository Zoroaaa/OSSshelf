/**
 * shareService.ts — 分享操作公共服务层
 *
 * 从 routes/share.ts 提取的核心业务逻辑，
 * 供 API 路由和 AI AgentTools 共同调用。
 */

import { eq } from 'drizzle-orm';
import { getDb, files, shares } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { checkFilePermission } from '../routes/permissions';
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
