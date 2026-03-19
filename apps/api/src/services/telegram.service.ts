/**
 * telegram.service.ts
 * Telegram 集成业务逻辑服务
 *
 * 功能:
 * - Telegram Bot 配置管理
 * - 文件上传/下载
 * - 消息发送
 * - Webhook 处理
 */

import { eq, and } from 'drizzle-orm';
import { getDb, storageBuckets, files, telegramFileRefs } from '../db';
import { decryptSecret } from '../lib/s3client';
import {
  tgUploadFile,
  tgDownloadFile,
  tgGetFileInfo,
  tgTestConnection,
  TG_MAX_FILE_SIZE,
  type TelegramBotConfig,
} from '../lib/telegramClient';
import { resolveBucketConfig, updateBucketStats } from '../lib/bucketResolver';
import type { Env } from '../types/env';

export async function testTelegramConnection(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: { botToken: string; chatId: string; apiBase?: string }
) {
  const config: TelegramBotConfig = {
    botToken: params.botToken,
    chatId: params.chatId,
    apiBase: params.apiBase,
  };

  const result = await tgTestConnection(config);
  return result;
}

export async function uploadToTelegram(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: {
    bucketId: string;
    fileName: string;
    fileData: ArrayBuffer;
    mimeType: string;
    caption?: string;
  }
) {
  const { bucketId, fileName, fileData, mimeType, caption } = params;

  if (fileData.byteLength > TG_MAX_FILE_SIZE) {
    return {
      success: false,
      error: `文件大小超过 Telegram 限制（最大 ${TG_MAX_FILE_SIZE / 1024 / 1024}MB）`,
    };
  }

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.provider, 'telegram')))
    .get();

  if (!bucket) {
    return { success: false, error: 'Telegram 存储桶不存在或无权访问' };
  }

  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  const config: TelegramBotConfig = {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };

  try {
    const result = await tgUploadFile(config, fileData, fileName, mimeType, caption);
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message || '上传失败' };
  }
}

export async function downloadFromTelegram(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: { bucketId: string; tgFileId: string }
) {
  const { bucketId, tgFileId } = params;

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.provider, 'telegram')))
    .get();

  if (!bucket) {
    return { success: false, error: 'Telegram 存储桶不存在或无权访问' };
  }

  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  const config: TelegramBotConfig = {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };

  try {
    const response = await tgDownloadFile(config, tgFileId);
    const buffer = await response.arrayBuffer();
    return { success: true, data: { buffer, mimeType: response.headers.get('content-type') || 'application/octet-stream' } };
  } catch (error: any) {
    return { success: false, error: error.message || '下载失败' };
  }
}

export async function sendTelegramMessage(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: { bucketId: string; text: string; parseMode?: 'Markdown' | 'HTML' }
) {
  const { bucketId, text, parseMode } = params;

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.provider, 'telegram')))
    .get();

  if (!bucket) {
    return { success: false, error: 'Telegram 存储桶不存在或无权访问' };
  }

  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  const config: TelegramBotConfig = {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };

  try {
    const chatId = config.chatId;
    const url = `${config.apiBase || 'https://api.telegram.org'}/bot${config.botToken}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (parseMode) body.parse_mode = parseMode;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error: ${errorText}`);
    }
    const result = await response.json();
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message || '发送消息失败' };
  }
}

export async function getTelegramFileInfo(
  db: ReturnType<typeof getDb>,
  encKey: string,
  userId: string,
  params: { bucketId: string; tgFileId: string }
) {
  const { bucketId, tgFileId } = params;

  const bucket = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.provider, 'telegram')))
    .get();

  if (!bucket) {
    return { success: false, error: 'Telegram 存储桶不存在或无权访问' };
  }

  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  const config: TelegramBotConfig = {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };

  try {
    const result = await tgGetFileInfo(config, tgFileId);
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message || '获取文件信息失败' };
  }
}

export async function listTelegramBuckets(db: ReturnType<typeof getDb>, userId: string) {
  const buckets = await db
    .select()
    .from(storageBuckets)
    .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.provider, 'telegram')))
    .all();

  return buckets.map((b) => ({
    id: b.id,
    name: b.name,
    chatId: b.bucketName,
    isActive: b.isActive,
    storageUsed: b.storageUsed,
    fileCount: b.fileCount,
    createdAt: b.createdAt,
  }));
}

export async function deleteTelegramFile(
  db: ReturnType<typeof getDb>,
  userId: string,
  fileId: string
) {
  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    return { success: false, error: '文件不存在' };
  }

  const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, fileId)).get();

  if (ref) {
    await db.delete(telegramFileRefs).where(eq(telegramFileRefs.id, ref.id));
  }

  await db.delete(files).where(eq(files.id, fileId));

  if (file.bucketId) {
    await updateBucketStats(db, file.bucketId, -file.size, -1);
  }

  return { success: true };
}

export { TG_MAX_FILE_SIZE };
export type { TelegramBotConfig };
