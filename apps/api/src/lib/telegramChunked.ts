/**
 * telegramChunked.ts
 * Telegram 大文件分片存储
 *
 * 新上传路径：前端分片 -> /api/tasks/telegram-part（Worker 接收转发 TG）
 * 本模块的 tgUploadChunked 仅供 legacy /telegram-upload 路由使用。
 * getChunks / tgDownloadChunked 供下载路由调用。
 */

import { eq, asc } from 'drizzle-orm';
import { telegramFileRefs, telegramFileChunks } from '../db/schema';
import type { DrizzleDb } from '../db';
import { tgUploadFile, tgGetFileInfo, tgGetDownloadUrl, type TelegramBotConfig } from './telegramClient';

/** 分片阈值：50MB 以下不启用分片，直接上传 */
export const TG_CHUNK_THRESHOLD = 50 * 1024 * 1024;

/** 单分片最大字节数（30 MB） */
export const TG_CHUNK_SIZE = 30 * 1024 * 1024;

export function needsChunking(fileSize: number): boolean {
  return fileSize > TG_CHUNK_THRESHOLD;
}

export interface TgChunkUploadResult {
  virtualFileId: string;
  chunkCount: number;
  totalBytes: number;
}

export interface TgUploadProgress {
  uploadedChunks: number;
  totalChunks: number;
  percent: number;
}

export interface TgChunkRecord {
  id: string;
  groupId: string;
  chunkIndex: number;
  tgFileId: string;
  chunkSize: number;
  bucketId: string;
  createdAt: string;
}

// ── DB helpers（全部用 Drizzle ORM，不用 raw SQL）────────────────────────

async function insertChunk(db: DrizzleDb, record: TgChunkRecord): Promise<void> {
  await db
    .insert(telegramFileChunks)
    .values({
      id: record.id,
      groupId: record.groupId,
      chunkIndex: record.chunkIndex,
      tgFileId: record.tgFileId,
      chunkSize: record.chunkSize,
      bucketId: record.bucketId,
      createdAt: record.createdAt,
    })
    .onConflictDoUpdate({
      target: telegramFileChunks.id,
      set: { tgFileId: record.tgFileId, chunkSize: record.chunkSize },
    });
}

export async function getChunks(db: DrizzleDb, groupId: string): Promise<TgChunkRecord[]> {
  const rows = await db
    .select()
    .from(telegramFileChunks)
    .where(eq(telegramFileChunks.groupId, groupId))
    .orderBy(asc(telegramFileChunks.chunkIndex))
    .all();
  return rows;
}

async function deleteChunks(db: DrizzleDb, groupId: string): Promise<void> {
  await db.delete(telegramFileChunks).where(eq(telegramFileChunks.groupId, groupId));
}

// ── Upload（legacy，供 /telegram-upload 旧路由使用）──────────────────────

export async function tgUploadChunked(
  config: TelegramBotConfig,
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string | null | undefined,
  db: DrizzleDb,
  bucketId: string,
  onProgress?: (progress: TgUploadProgress) => void
): Promise<TgChunkUploadResult> {
  const data = new Uint8Array(buffer);
  const totalSize = data.byteLength;
  const chunkCount = Math.ceil(totalSize / TG_CHUNK_SIZE);
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();

  onProgress?.({ uploadedChunks: 0, totalChunks: chunkCount, percent: 0 });

  for (let i = 0; i < chunkCount; i++) {
    const start = i * TG_CHUNK_SIZE;
    const end = Math.min(start + TG_CHUNK_SIZE, totalSize);
    const chunk = data.slice(start, end).buffer;

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

    const uploadedChunks = i + 1;
    const percent = Math.round((uploadedChunks / chunkCount) * 100);
    onProgress?.({ uploadedChunks, totalChunks: chunkCount, percent });
  }

  return { virtualFileId: `chunked:${groupId}`, chunkCount, totalBytes: totalSize };
}

// ── Download ──────────────────────────────────────────────────────────────

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

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

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

async function downloadChunk(config: TelegramBotConfig, tgFileId: string): Promise<Response> {
  const info = await tgGetFileInfo(config, tgFileId);
  const url = tgGetDownloadUrl(config, info.filePath);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Chunk download failed: HTTP ${resp.status}`);
  return resp;
}

// ── Delete ────────────────────────────────────────────────────────────────

export async function tgDeleteChunked(db: DrizzleDb, virtualFileId: string): Promise<void> {
  if (!virtualFileId.startsWith('chunked:')) return;
  const groupId = virtualFileId.slice('chunked:'.length);
  await deleteChunks(db, groupId);
}

export function isChunkedFileId(tgFileId: string): boolean {
  return tgFileId.startsWith('chunked:');
}
