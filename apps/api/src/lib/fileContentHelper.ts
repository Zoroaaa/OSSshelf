/**
 * fileContentHelper.ts — 公共文件内容读写工具
 *
 * 从 preview.ts 的 /raw 路由提取的核心逻辑，供所有 AI 工具复用
 *
 * 功能:
 * - 统一的文件内容读取（支持 R2/S3/Telegram 多存储后端）
 * - 统一的文件内容写入（支持多路径保存）
 * - 编码自动检测（UTF-8/GBK）
 * - 完善的错误处理和日志记录
 */

import { eq } from 'drizzle-orm';
import { getDb, files, storageBuckets, telegramFileRefs } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { s3Get, s3Put } from './s3client';
import { resolveBucketConfig } from './bucketResolver';
import { getEncryptionKey, decryptCredential } from './crypto';
import { tgDownloadFile } from './telegramClient';
import { isChunkedFileId, tgDownloadChunked } from '../lib/telegramChunked';
import type { InferSelectModel } from 'drizzle-orm';

const MAX_FILE_SIZE_FOR_READ = 30 * 1024 * 1024;

export interface FileReadResult {
  success: boolean;
  content: string | null;
  error?: string;
  source?: 'r2' | 's3' | 'telegram' | 'metadata';
}

export interface FileWriteResult {
  success: boolean;
  error?: string;
  savedTo?: string[];
}

/**
 * 读取文件的实际文本内容（复用 preview.ts /raw 路由逻辑）
 * 支持存储后端：R2 → S3兼容存储 → Telegram → null降级
 */
export async function readFileContent(
  env: Env,
  file: InferSelectModel<typeof files>,
  userId?: string
): Promise<FileReadResult> {
  if (!file.r2Key) {
    return {
      success: false,
      content: null,
      error: '文件的 r2Key 为空',
    };
  }

  if (file.size > MAX_FILE_SIZE_FOR_READ) {
    return {
      success: false,
      content: null,
      error: `文件过大 (${file.size} bytes)，超过 ${MAX_FILE_SIZE_FOR_READ} 限制`,
    };
  }

  const db = getDb(env.DB);
  const encKey = getEncryptionKey(env);

  // ── 路径1：Telegram 存储 ──────────────────────────────────────
  if (file.bucketId) {
    try {
      const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
      if (bkt?.provider === 'telegram') {
        const telegramResult = await readFromTelegram(env, db, file, encKey);
        if (telegramResult.success) {
          return telegramResult;
        }
        logger.warn('FileContentHelper', 'Telegram读取失败，尝试其他路径', { fileId: file.id }, telegramResult.error);
      }
    } catch (tgError) {
      logger.warn('FileContentHelper', 'Telegram读取异常', { fileId: file.id }, tgError);
    }
  }

  // ── 路径2：R2 存储（主要） ────────────────────────────────────
  if (env.FILES) {
    try {
      const object = await env.FILES.get(file.r2Key);
      if (object) {
        const arrayBuffer = await object.arrayBuffer();
        const content = decodeTextContent(arrayBuffer);
        if (content) {
          logger.info('FileContentHelper', '成功从R2读取文件', { fileId: file.id, contentLength: content.length });
          return { success: true, content, source: 'r2' };
        }
      }
    } catch (r2Error) {
      logger.warn('FileContentHelper', 'R2读取失败', { fileId: file.id, r2Key: file.r2Key }, r2Error);
    }
  }

  // ── 路径3：S3 兼容存储（备用） ────────────────────────────────
  if (file.bucketId) {
    try {
      const bucketConfig = await resolveBucketConfig(db, userId || '', encKey, file.bucketId, file.parentId);
      if (bucketConfig && file.r2Key) {
        const s3Res = await s3Get(bucketConfig, file.r2Key);
        if (s3Res.ok) {
          const arrayBuffer = await s3Res.arrayBuffer();
          const content = decodeTextContent(arrayBuffer);
          if (content) {
            logger.info('FileContentHelper', '成功从S3兼容存储读取文件', {
              fileId: file.id,
              contentLength: content.length,
            });
            return { success: true, content, source: 's3' };
          }
        }
      }
    } catch (s3Error) {
      logger.warn('FileContentHelper', 'S3兼容存储读取失败', { fileId: file.id }, s3Error);
    }
  }

  // ── 所有路径均失败 ────────────────────────────────────────────
  logger.error('FileContentHelper', '所有读取路径均失败', {
    fileId: file.id,
    fileName: file.name,
    hasFILESBinding: !!env.FILES,
    bucketId: file.bucketId,
    r2Key: file.r2Key,
  });

  return {
    success: false,
    content: null,
    error: '无法从任何存储后端读取文件内容',
  };
}

/**
 * 写入文件内容到存储（多路径支持）
 */
export async function writeFileContent(
  env: Env,
  file: InferSelectModel<typeof files>,
  content: string | Uint8Array,
  userId?: string,
  preferredSource?: 'r2' | 's3' | 'telegram'
): Promise<FileWriteResult> {
  const db = getDb(env.DB);
  const encKey = getEncryptionKey(env);
  const contentBytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const savedTo: string[] = [];

  // ── 路径1：R2 存储 ────────────────────────────────────────────
  if ((!preferredSource || preferredSource === 'r2') && env.FILES && file.r2Key) {
    try {
      await env.FILES.put(file.r2Key, contentBytes);
      savedTo.push('R2');
      logger.info('FileContentHelper', '成功写入R2', { fileId: file.id });
    } catch (r2Error) {
      logger.warn('FileContentHelper', 'R2写入失败', { fileId: file.id }, r2Error);
    }
  }

  // ── 路径2：S3 兼容存储 ────────────────────────────────────────
  if ((savedTo.length === 0 || preferredSource === 's3') && file.bucketId && file.r2Key) {
    try {
      const bucketConfig = await resolveBucketConfig(db, userId || '', encKey, file.bucketId, file.parentId);
      if (bucketConfig) {
        await s3Put(bucketConfig, file.r2Key, contentBytes, file.mimeType || 'application/octet-stream');
        savedTo.push('S3-Compatible');
        logger.info('FileContentHelper', '成功写入S3兼容存储', { fileId: file.id });
      }
    } catch (s3Error) {
      logger.error('FileContentHelper', 'S3兼容存储写入失败', { fileId: file.id }, s3Error);
    }
  }

  if (savedTo.length === 0) {
    return {
      success: false,
      error: '所有存储路径写入失败',
    };
  }

  // 更新数据库中的文件大小和时间戳
  try {
    await db
      .update(files)
      .set({
        size: contentBytes.length,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(files.id, file.id));
  } catch (dbError) {
    logger.warn('FileContentHelper', '数据库更新失败（非致命）', { fileId: file.id }, dbError);
  }

  return {
    success: true,
    savedTo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 私有辅助函数
// ─────────────────────────────────────────────────────────────────────────────

async function readFromTelegram(
  env: Env,
  db: ReturnType<typeof getDb>,
  file: InferSelectModel<typeof files>,
  encKey: string
): Promise<FileReadResult> {
  if (!file.bucketId) {
    return { success: false, content: null, error: '无 bucketId' };
  }

  const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id)).get();
  if (!ref) {
    return { success: false, content: null, error: '未找到 Telegram 文件引用' };
  }

  const bkt = await db.select().from(storageBuckets).where(eq(storageBuckets.id, file.bucketId)).get();
  if (!bkt || bkt.provider !== 'telegram') {
    return { success: false, content: null, error: '不是 Telegram 存储桶' };
  }

  const botToken = await decryptCredential(bkt.accessKeyId, encKey);
  if (!botToken) {
    return { success: false, content: null, error: '无法解密 Telegram bot token' };
  }

  const tgConfig = {
    botToken,
    chatId: bkt.bucketName,
    apiBase: bkt.endpoint || undefined,
  };

  try {
    const body = isChunkedFileId(ref.tgFileId)
      ? await tgDownloadChunked(tgConfig, ref.tgFileId, db)
      : (await tgDownloadFile(tgConfig, ref.tgFileId)).body;

    const arrayBuffer = await new Response(body).arrayBuffer();
    const textContent = decodeTextContent(arrayBuffer);

    if (textContent) {
      logger.info('FileContentHelper', '成功从Telegram读取文件', {
        fileId: file.id,
        contentLength: textContent.length,
      });
      return { success: true, content: textContent, source: 'telegram' };
    }

    return { success: false, content: null, error: 'Telegram 文件内容为空' };
  } catch (tgError) {
    return {
      success: false,
      content: null,
      error: `Telegram 下载失败: ${tgError instanceof Error ? tgError.message : '未知错误'}`,
    };
  }
}

/**
 * 智能解码文本内容（UTF-8 + GBK 回退）
 */
function decodeTextContent(arrayBuffer: ArrayBuffer): string | null {
  try {
    let content = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);

    if (/[\ufffd]/.test(content)) {
      try {
        const gbkDecoder = new TextDecoder('gbk', { fatal: false });
        const gbkContent = gbkDecoder.decode(arrayBuffer);
        if (!/[\ufffd]/.test(gbkContent)) {
          content = gbkContent;
        }
      } catch {
        // GBK 解码失败，保持 UTF-8 结果
      }
    }

    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}
