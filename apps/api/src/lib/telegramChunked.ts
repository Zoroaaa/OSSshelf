/**
 * telegramChunked.ts
 * Telegram 大文件分片存储
 *
 * 背景：
 *   Telegram Bot API 单次上传上限 50MB。
 *   对于超过 50MB 的文件，此模块将文件切成 ≤ 49MB 的块，
 *   逐块上传到 Telegram（每块一个独立消息），并在 D1 中记录分片元数据。
 *   下载时按块顺序拉取并在 Worker 内拼接为 TransformStream 流式输出，
 *   避免一次性加载整个文件到内存。
 *
 * 设计约束：
 *   - Cloudflare Workers CPU 时间限制（Paid: 30s/request），
 *     超大文件（>500MB，即 >10 块）在高负载下可能触发 CPU 超时。
 *   - 分片元数据存储在 telegram_file_chunks 表（migration 0006 新增）。
 *   - 原有 telegram_file_refs 仍保留（用于 ≤50MB 文件），两者互不干扰。
 *   - 分片文件在 files 表中有一条正常记录，bucketId 指向 Telegram 桶。
 *   - telegramFileRefs 对分片文件记录 chunkGroupId（虚拟 tgFileId 前缀 "chunked:"）。
 *
 * 分片大小：
 *   TG_CHUNK_SIZE = 49MB（留 1MB 余量，避免因 caption 等元数据超限）
 */

import { eq } from 'drizzle-orm';
import { telegramFileRefs } from '../db/schema';
import type { DrizzleDb } from '../db';
import { tgUploadFile, tgGetFileInfo, tgGetDownloadUrl, type TelegramBotConfig } from './telegramClient';

/** 单分片最大字节数（49 MB） */
export const TG_CHUNK_SIZE = 49 * 1024 * 1024;

/**
 * 大文件是否需要分片（> TG_CHUNK_SIZE）
 */
export function needsChunking(fileSize: number): boolean {
  return fileSize > TG_CHUNK_SIZE;
}

export interface TgChunkUploadResult {
  /** 虚拟 file_id，格式为 "chunked:{groupId}" */
  virtualFileId: string;
  /** 分片数量 */
  chunkCount: number;
  /** 实际写入的总字节数 */
  totalBytes: number;
}

/** DB 分片记录结构（对应 telegram_file_chunks 表） */
export interface TgChunkRecord {
  id: string;
  groupId: string; // 同一文件所有分片共享的 UUID
  chunkIndex: number; // 0-based
  tgFileId: string; // Telegram file_id
  chunkSize: number; // 此块字节数
  bucketId: string;
  createdAt: string;
}

// ── Schema（内联 SQL 用于 migration，Drizzle 无类型导出） ──────────────────
// telegram_file_chunks 表在 migration 0006 中创建，此处用 raw SQL 操作

async function insertChunk(db: DrizzleDb, record: TgChunkRecord): Promise<void> {
  await (db as any).run(
    `INSERT INTO telegram_file_chunks
       (id, group_id, chunk_index, tg_file_id, chunk_size, bucket_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.groupId, record.chunkIndex, record.tgFileId, record.chunkSize, record.bucketId, record.createdAt]
  );
}

async function getChunks(db: DrizzleDb, groupId: string): Promise<TgChunkRecord[]> {
  const rows = await (db as any).all(
    `SELECT id, group_id AS groupId, chunk_index AS chunkIndex,
            tg_file_id AS tgFileId, chunk_size AS chunkSize,
            bucket_id AS bucketId, created_at AS createdAt
     FROM telegram_file_chunks
     WHERE group_id = ?
     ORDER BY chunk_index ASC`,
    [groupId]
  );
  return rows as TgChunkRecord[];
}

async function deleteChunks(db: DrizzleDb, groupId: string): Promise<void> {
  await (db as any).run(`DELETE FROM telegram_file_chunks WHERE group_id = ?`, [groupId]);
}

// ── Upload ─────────────────────────────────────────────────────────────────

/**
 * 将大文件切分并上传到 Telegram。
 * 调用方负责：
 *   1. 验证文件大小（needsChunking() 返回 true）
 *   2. 写入 files 表（使用返回的 virtualFileId 作为 r2Key 辨识）
 *   3. 写入 telegramFileRefs（tgFileId = virtualFileId）
 *
 * @param config  Telegram Bot 配置
 * @param buffer  完整文件内容（ArrayBuffer）
 * @param fileName 原始文件名
 * @param mimeType 文件 MIME 类型
 * @param db      数据库实例
 * @param bucketId 所属存储桶 ID
 */
export async function tgUploadChunked(
  config: TelegramBotConfig,
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string | null | undefined,
  db: DrizzleDb,
  bucketId: string
): Promise<TgChunkUploadResult> {
  const data = new Uint8Array(buffer);
  const totalSize = data.byteLength;
  const chunkCount = Math.ceil(totalSize / TG_CHUNK_SIZE);
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();

  // 逐块上传
  for (let i = 0; i < chunkCount; i++) {
    const start = i * TG_CHUNK_SIZE;
    const end = Math.min(start + TG_CHUNK_SIZE, totalSize);
    const chunk = data.slice(start, end).buffer;

    // 分片文件名格式：originalName.part001（方便识别）
    const chunkFileName = `${fileName}.part${String(i + 1).padStart(3, '0')}`;
    const caption = `📦 ${fileName} [${i + 1}/${chunkCount}]\n🗂 OSSshelf chunk | group:${groupId.slice(0, 8)}`;

    const result = await tgUploadFile(config, chunk, chunkFileName, mimeType, caption);

    await insertChunk(db, {
      id: crypto.randomUUID(),
      groupId,
      chunkIndex: i,
      tgFileId: result.fileId,
      chunkSize: end - start,
      bucketId,
      createdAt: now,
    });
  }

  return {
    virtualFileId: `chunked:${groupId}`,
    chunkCount,
    totalBytes: totalSize,
  };
}

// ── Download ───────────────────────────────────────────────────────────────

/**
 * 流式下载分片文件，返回 ReadableStream。
 * 按 chunkIndex 顺序拉取每块内容，TransformStream 拼接后向客户端输出。
 * 避免一次性把整个文件载入内存。
 *
 * @param config      Telegram Bot 配置
 * @param virtualFileId  格式 "chunked:{groupId}"
 * @param db          数据库实例
 */
export async function tgDownloadChunked(
  config: TelegramBotConfig,
  virtualFileId: string,
  db: DrizzleDb
): Promise<ReadableStream<Uint8Array>> {
  if (!virtualFileId.startsWith('chunked:')) {
    throw new Error(`Invalid chunked virtualFileId: ${virtualFileId}`);
  }
  const groupId = virtualFileId.slice('chunked:'.length);
  const chunks = await getChunks(db, groupId);

  if (chunks.length === 0) {
    throw new Error(`No chunks found for groupId: ${groupId}`);
  }

  // 用 TransformStream 逐块 pipe，避免全量缓冲
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  // 在后台逐块写入（不 await，让调用方在 readable 上读取）
  (async () => {
    try {
      for (const chunk of chunks) {
        const resp = await downloadChunk(config, chunk.tgFileId);
        const buf = await resp.arrayBuffer();
        await writer.write(new Uint8Array(buf));
      }
      await writer.close();
    } catch (err) {
      await writer.abort(err);
    }
  })();

  return readable;
}

/**
 * 下载单个分片，返回 Response（复用 tgGetFileInfo + tgGetDownloadUrl）
 */
async function downloadChunk(config: TelegramBotConfig, tgFileId: string): Promise<Response> {
  const info = await tgGetFileInfo(config, tgFileId);
  const url = tgGetDownloadUrl(config, info.filePath);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Chunk download failed: HTTP ${resp.status}`);
  return resp;
}

// ── Delete ─────────────────────────────────────────────────────────────────

/**
 * 删除分片记录（DB 层面）。
 * Telegram 服务器上的分片消息无法被 Bot 强制删除，忽略。
 */
export async function tgDeleteChunked(db: DrizzleDb, virtualFileId: string): Promise<void> {
  if (!virtualFileId.startsWith('chunked:')) return;
  const groupId = virtualFileId.slice('chunked:'.length);
  await deleteChunks(db, groupId);
}

/**
 * 判断一个 tgFileId 是否为虚拟分片标识
 */
export function isChunkedFileId(tgFileId: string): boolean {
  return tgFileId.startsWith('chunked:');
}
