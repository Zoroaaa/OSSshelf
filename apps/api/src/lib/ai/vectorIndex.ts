/**
 * vectorIndex.ts
 * 向量索引与混合检索
 *
 * 变更:
 * - 分块正文落 D1 file_chunks，Vectorize 只存向量（检索可回表取原文）
 * - 向量 id 统一为 `${fileId}:${index}`（兼容旧 `_chunk_` id）
 * - 关键词召回改走 FTS5（不可用时回退 LIKE）
 * - 嵌入模型统一由 resolveEmbeddingProvider 解析
 */

import type { Env } from '../../types/env';
import { getDb, files, fileNotes, fileChunks } from '../../db';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { logger } from '@osshelf/shared';
import { readFileContent } from '../fileContentHelper';
import { VECTOR_LOG_MODULE } from './constants';
import { resolveEmbeddingProvider } from './modelRuntime';
import { AI_RAG_DEFAULTS, getAiConfigBoolean, getAiConfigNumber, getAiConfigString } from './aiConfigService';
import { estimateTokens } from './utils';
import { recordUsage, reserveAiQuota } from './usage';

const MAX_TEXT_LENGTH = 4096;

const CHUNK_CONFIG = {
  chunkSize: 1000,
  overlap: 128,
  maxChunks: 20,
} as const;

const LEGACY_CHUNK_PREFIX = '_chunk_';

export interface VectorSearchResult {
  fileId: string;
  score: number;
  chunkIndex?: number;
  metadata?: Record<string, unknown>;
}

export interface ChunkSearchResult {
  fileId: string;
  name: string;
  mimeType: string | null;
  chunkIndex: number;
  snippet: string;
  score: number;
}

/**
 * 滑动窗口分块。
 */
export function splitTextIntoChunks(
  text: string,
  options: { chunkSize?: number; overlap?: number; maxChunks?: number } = {}
): string[] {
  if (text.length <= MAX_TEXT_LENGTH) {
    return [text];
  }

  const chunkSize = Math.max(100, options.chunkSize ?? CHUNK_CONFIG.chunkSize);
  const overlap = Math.min(Math.max(0, options.overlap ?? CHUNK_CONFIG.overlap), chunkSize - 1);
  const maxChunks = Math.max(1, options.maxChunks ?? CHUNK_CONFIG.maxChunks);

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length && chunks.length < maxChunks) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }

  return chunks;
}

export function buildChunkVectorId(fileId: string, index: number): string {
  return `${fileId}:${index}`;
}

function isChunkId(vectorId: string): boolean {
  return vectorId.includes(':') || vectorId.includes(LEGACY_CHUNK_PREFIX);
}

function extractFileIdFromVectorId(vectorId: string): string {
  if (vectorId.includes(LEGACY_CHUNK_PREFIX)) return vectorId.split(LEGACY_CHUNK_PREFIX)[0];
  return vectorId.split(':')[0];
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function legacyVectorIds(fileId: string): string[] {
  const ids = [fileId];
  for (let i = 0; i < CHUNK_CONFIG.maxChunks; i++) {
    ids.push(`${fileId}${LEGACY_CHUNK_PREFIX}${i}`);
    ids.push(buildChunkVectorId(fileId, i));
  }
  return ids;
}

const VECTORIZE_RETRY = {
  maxAttempts: 6,
  baseDelayMs: 2000,
  maxDelayMs: 30_000,
} as const;

function isVectorizeRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('40041') || message.includes('Too Many Requests');
}

/**
 * Vectorize 写入是异步 mutation，账号级/索引级存在未公开的写入频率限制，
 * 突发批量索引会返回 40041 Too Many Requests。这里只对限流做退避重试，
 * 不重跑嵌入与文件读取。
 */
async function withVectorizeRateLimitRetry<T>(operation: () => Promise<T>, action: string): Promise<T> {
  let attempt = 1;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isVectorizeRateLimit(error) || attempt >= VECTORIZE_RETRY.maxAttempts) {
        throw error;
      }

      const delay = Math.min(VECTORIZE_RETRY.baseDelayMs * 2 ** (attempt - 1), VECTORIZE_RETRY.maxDelayMs);
      // 50% 随机抖动，避免同一批文件在退避后同时重试再次撞上限流窗口
      const jitter = Math.floor(Math.random() * delay * 0.5);
      logger.warn(VECTOR_LOG_MODULE, 'Vectorize 限流，退避后重试', {
        action,
        attempt,
        delayMs: delay + jitter,
      });
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      attempt++;
    }
  }
}

async function deleteVectorsForFile(env: Env, fileId: string): Promise<void> {
  if (!env.VECTORIZE) return;

  try {
    const db = getDb(env.DB);
    const existing = await db
      .select({ chunkIndex: fileChunks.chunkIndex })
      .from(fileChunks)
      .where(eq(fileChunks.fileId, fileId))
      .all();

    const ids = new Set<string>(legacyVectorIds(fileId));
    for (const chunk of existing) ids.add(buildChunkVectorId(fileId, chunk.chunkIndex));

    const vectorize = env.VECTORIZE;
    await withVectorizeRateLimitRetry(() => vectorize.deleteByIds(Array.from(ids)), 'deleteByIds');
  } catch (error) {
    logger.warn(VECTOR_LOG_MODULE, '清理旧向量失败', { fileId }, error);
  }
}

export async function indexFileVector(env: Env, fileId: string, text: string): Promise<void> {
  if (!env.AI || !env.VECTORIZE) {
    logger.warn(VECTOR_LOG_MODULE, 'AI或VECTORIZE未配置，跳过向量索引');
    return;
  }

  if (!text || text.trim().length === 0) {
    logger.warn(VECTOR_LOG_MODULE, '文件文本为空，跳过向量索引', { fileId });
    return;
  }

  try {
    const db = getDb(env.DB);
    const file = await db.select().from(files).where(eq(files.id, fileId)).get();

    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }

    const [chunkOverlap, maxChunks] = await Promise.all([
      getAiConfigNumber(env, 'ai.rag.chunk_overlap', AI_RAG_DEFAULTS.chunkOverlap),
      getAiConfigNumber(env, 'ai.rag.max_chunks', AI_RAG_DEFAULTS.maxChunks),
    ]);
    const chunks = splitTextIntoChunks(text, { overlap: chunkOverlap, maxChunks });
    // embedding 的配额预扣与记账由 provider 统一完成
    const provider = await resolveEmbeddingProvider(env, { userId: file.userId, feature: 'embedding' });
    const embedInputs = chunks.map((chunk) => chunk.slice(0, MAX_TEXT_LENGTH));
    const embeddings = await provider.embed(embedInputs);

    if (embeddings.length !== chunks.length || embeddings.length === 0) {
      throw new Error('Failed to generate embeddings: empty data');
    }

    await deleteVectorsForFile(env, fileId);
    await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));

    const now = new Date().toISOString();
    const chunkRows = chunks.map((chunk, index) => ({
      id: buildChunkVectorId(fileId, index),
      fileId,
      chunkIndex: index,
      content: chunk,
      contentHash: hashText(chunk),
      embeddingModel: provider.modelKey,
      tokenCount: estimateTokens(chunk),
      createdAt: now,
    }));

    // D1 单条 SQL 绑定参数上限 100：file_chunks 每行 8 个参数，必须分批插入
    const maxRowsPerInsert = Math.floor(100 / Object.keys(chunkRows[0]).length);
    for (let i = 0; i < chunkRows.length; i += maxRowsPerInsert) {
      await db.insert(fileChunks).values(chunkRows.slice(i, i + maxRowsPerInsert));
    }

    const vectorize = env.VECTORIZE;
    await withVectorizeRateLimitRetry(
      () =>
        vectorize.upsert(
          chunks.map((_, index) => ({
            id: buildChunkVectorId(fileId, index),
            values: embeddings[index],
            metadata: {
              userId: file.userId,
              name: file.name,
              mimeType: file.mimeType || '',
              chunkIndex: index,
              chunkCount: chunks.length,
              sourceFileId: fileId,
              folderId: file.parentId || '',
              updatedAt: file.updatedAt,
            },
          }))
        ),
      'upsert'
    );

    await db.update(files).set({ vectorIndexedAt: now }).where(eq(files.id, fileId));

    logger.info(VECTOR_LOG_MODULE, '文件索引完成', {
      fileId,
      chunkCount: chunks.length,
      embeddingModel: provider.modelKey,
    });
  } catch (error) {
    logger.error(VECTOR_LOG_MODULE, '文件索引失败', { fileId }, error);
    throw error;
  }
}

export async function deleteFileVector(env: Env, fileId: string): Promise<void> {
  return deleteFileVectors(env, [fileId]);
}

export async function deleteFileVectors(env: Env, fileIds: string[]): Promise<void> {
  if (!env.VECTORIZE || fileIds.length === 0) return;

  try {
    const db = getDb(env.DB);
    // D1 单条 SQL 绑定参数上限为 100，按批查询与删除
    const DB_CHUNK = 100;
    const chunks: Array<{ fileId: string; chunkIndex: number }> = [];
    for (let i = 0; i < fileIds.length; i += DB_CHUNK) {
      const rows = await db
        .select({ fileId: fileChunks.fileId, chunkIndex: fileChunks.chunkIndex })
        .from(fileChunks)
        .where(inArray(fileChunks.fileId, fileIds.slice(i, i + DB_CHUNK)))
        .all();
      chunks.push(...rows);
    }

    const ids = new Set<string>();
    for (const fileId of fileIds) {
      ids.add(fileId);
      for (let i = 0; i < CHUNK_CONFIG.maxChunks; i++) {
        ids.add(`${fileId}${LEGACY_CHUNK_PREFIX}${i}`);
      }
    }
    for (const chunk of chunks) {
      ids.add(buildChunkVectorId(chunk.fileId, chunk.chunkIndex));
    }

    const allIds = Array.from(ids);
    const BATCH = 1000;
    for (let i = 0; i < allIds.length; i += BATCH) {
      await env.VECTORIZE.deleteByIds(allIds.slice(i, i + BATCH));
    }

    for (let i = 0; i < fileIds.length; i += DB_CHUNK) {
      await db.delete(fileChunks).where(inArray(fileChunks.fileId, fileIds.slice(i, i + DB_CHUNK)));
    }

    logger.info(VECTOR_LOG_MODULE, '批量删除向量成功', {
      fileCount: fileIds.length,
      vectorCount: allIds.length,
    });
  } catch (error) {
    logger.error(VECTOR_LOG_MODULE, '批量删除向量失败', { fileIds }, error);
  }
}

export async function searchSimilarFiles(
  env: Env,
  query: string,
  userId: string,
  options: {
    limit?: number;
    threshold?: number;
    mimeType?: string;
  } = {}
): Promise<VectorSearchResult[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  if (!env.AI || !env.VECTORIZE) {
    return [];
  }

  try {
    // 阈值统一来自配置；调用方显式传值时以调用方为准（例如 chunk 级检索）
    const threshold =
      options.threshold ?? (await getAiConfigNumber(env, 'ai.rag.vector_threshold', AI_RAG_DEFAULTS.vectorThreshold));
    const effectiveLimit = Math.min(limit, 100);
    const provider = await resolveEmbeddingProvider(env, { userId, feature: 'embedding' });
    const [values] = await provider.embed([query.slice(0, MAX_TEXT_LENGTH)]);
    if (!values) return [];

    const results = await env.VECTORIZE.query(values, {
      topK: effectiveLimit,
      filter: { userId },
      returnMetadata: 'all',
    });

    const rawMatches = results.matches
      .filter((match) => match.score >= threshold)
      .map((match) => ({
        fileId: isChunkId(match.id) ? extractFileIdFromVectorId(match.id) : match.id,
        score: match.score,
        chunkIndex:
          typeof (match.metadata as Record<string, unknown> | undefined)?.chunkIndex === 'number'
            ? ((match.metadata as Record<string, unknown>).chunkIndex as number)
            : undefined,
        metadata: match.metadata as Record<string, unknown> | undefined,
      }));

    const bestScoreMap = new Map<string, VectorSearchResult>();
    for (const match of rawMatches) {
      const existing = bestScoreMap.get(match.fileId);
      if (!existing || match.score > existing.score) {
        bestScoreMap.set(match.fileId, match);
      }
    }

    return Array.from(bestScoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (error) {
    logger.error(VECTOR_LOG_MODULE, '搜索相似文件失败', {}, error);
    return [];
  }
}

/**
 * chunk 级检索：返回命中片段正文，供 Agent 直接引用。
 */
export async function searchChunkContent(
  env: Env,
  query: string,
  userId: string,
  options: { limit?: number; threshold?: number } = {}
): Promise<ChunkSearchResult[]> {
  const limit = options.limit ?? 5;
  const threshold =
    options.threshold ??
    (await getAiConfigNumber(env, 'ai.rag.chunk_threshold', AI_RAG_DEFAULTS.chunkThreshold));

  const vectorHits = await searchSimilarFiles(env, query, userId, { limit: limit * 2, threshold });
  if (vectorHits.length === 0) return [];

  const db = getDb(env.DB);
  const fileIds = vectorHits.map((hit) => hit.fileId);
  const fileRows = await db
    .select({ id: files.id, name: files.name, mimeType: files.mimeType })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), inArray(files.id, fileIds)))
    .all();

  const fileMap = new Map(fileRows.map((file) => [file.id, file]));

  const chunkKeys = vectorHits
    .filter((hit) => typeof hit.chunkIndex === 'number')
    .map((hit) => ({ fileId: hit.fileId, chunkIndex: hit.chunkIndex as number }));

  const chunkRows = chunkKeys.length
    ? await db
        .select({
          fileId: fileChunks.fileId,
          chunkIndex: fileChunks.chunkIndex,
          content: fileChunks.content,
        })
        .from(fileChunks)
        .where(inArray(fileChunks.fileId, Array.from(new Set(chunkKeys.map((key) => key.fileId)))))
        .all()
    : [];

  const chunkMap = new Map(chunkRows.map((row) => [`${row.fileId}:${row.chunkIndex}`, row.content]));

  const results: ChunkSearchResult[] = [];
  for (const hit of vectorHits) {
    const file = fileMap.get(hit.fileId);
    if (!file) continue;

    const chunkIndex = hit.chunkIndex ?? 0;
    const content = chunkMap.get(`${hit.fileId}:${chunkIndex}`) ?? '';
    if (!content) continue;

    results.push({
      fileId: hit.fileId,
      name: file.name,
      mimeType: file.mimeType,
      chunkIndex,
      snippet: content.slice(0, 1200),
      score: hit.score,
    });
  }

  if (await getAiConfigBoolean(env, 'ai.rag.rerank_enabled', false)) {
    return (await rerankChunks(env, query, results, userId)).slice(0, limit);
  }

  return results.slice(0, limit);
}

/**
 * 可选重排：Workers AI bge-reranker。失败时原样返回。
 */
async function rerankChunks(
  env: Env,
  query: string,
  results: ChunkSearchResult[],
  userId: string
): Promise<ChunkSearchResult[]> {
  if (!env.AI || results.length === 0) return results;

  const [rerankModel, timeoutMs] = await Promise.all([
    getAiConfigString(env, 'ai.rag.rerank_model', AI_RAG_DEFAULTS.rerankModel),
    getAiConfigNumber(env, 'ai.rag.rerank_timeout_ms', AI_RAG_DEFAULTS.rerankTimeoutMs),
  ]);
  const estimatedInput = estimateTokens(query) + results.reduce((sum, item) => sum + estimateTokens(item.snippet), 0);
  const quota = await reserveAiQuota(env, userId, { estimatedTokens: estimatedInput, countRequest: false });
  if (!quota.allowed || !quota.reservation) {
    // 配额不足时降级为融合排序，不让 rerank 阻断整条检索链路
    return results;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`rerank timeout after ${timeoutMs}ms`, 'TimeoutError')),
    Math.max(1_000, timeoutMs)
  );

  try {
    const response = (await (env.AI as any).run(
      rerankModel,
      {
        query,
        contexts: results.map((item) => ({ text: item.snippet })),
      },
      { signal: controller.signal }
    )) as {
      response?: Array<{ id?: number; index?: number; score?: number }>;
      result?: Array<{ id?: number; index?: number; score?: number }>;
    };

    // rerank 同样按输入 token 计费，计入用量与配额
    await recordUsage(env, {
      userId,
      feature: 'rerank',
      provider: 'workers_ai',
      modelId: rerankModel,
      inputTokens: estimatedInput,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      status: 'completed',
    });
    await quota.reservation.settle(estimatedInput);

    const scores = response?.response ?? response?.result;
    if (!Array.isArray(scores) || scores.length === 0) return results;

    const scoreMap = new Map<number, number>();
    scores.forEach((item, fallbackIndex) => {
      const index = typeof item.index === 'number' ? item.index : typeof item.id === 'number' ? item.id : fallbackIndex;
      if (typeof item.score === 'number') scoreMap.set(index, item.score);
    });

    return results
      .map((item, index) => ({ ...item, score: scoreMap.get(index) ?? item.score }))
      .sort((a, b) => b.score - a.score);
  } catch (error) {
    await quota.reservation.release();
    logger.warn(VECTOR_LOG_MODULE, 'rerank failed, using original order', {}, error);
    return results;
  } finally {
    clearTimeout(timer);
  }
}

export async function buildFileTextForVector(env: Env, fileId: string): Promise<string> {
  const db = getDb(env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return '';

  let actualContent = '';
  try {
    const maxSourceChars = await getAiConfigNumber(env, 'ai.rag.max_source_chars', AI_RAG_DEFAULTS.maxSourceChars);
    const readResult = await readFileContent(env, file);
    if (readResult.success && readResult.content) {
      actualContent = readResult.content.slice(0, Math.max(1_000, maxSourceChars));
    }
  } catch (error) {
    logger.warn(VECTOR_LOG_MODULE, '实际内容读取失败，将降级', { fileId, fileName: file.name }, error);
  }

  const aiSummaryText = file.aiSummary || '';

  let tagsText = '';
  if (file.aiTags) {
    try {
      const tags: string[] = JSON.parse(file.aiTags);
      tagsText = tags.join(' ');
    } catch {
      tagsText = file.aiTags;
    }
  }

  const notes = await db
    .select({ content: fileNotes.content })
    .from(fileNotes)
    .where(eq(fileNotes.fileId, fileId))
    .limit(5)
    .all();

  const metaParts = [file.name, file.description || ''].filter(Boolean);

  let bodyParts: string[];
  if (actualContent) {
    bodyParts = [actualContent, aiSummaryText, tagsText];
  } else if (aiSummaryText || tagsText) {
    bodyParts = [aiSummaryText, tagsText];
  } else {
    bodyParts = [];
  }

  return [...metaParts, ...bodyParts, ...notes.map((note) => note.content)].filter(Boolean).join('\n');
}

export async function isAIConfigured(env: Env): Promise<boolean> {
  return !!(env.AI && env.VECTORIZE);
}
