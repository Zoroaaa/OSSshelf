/**
 * vectorIndex.ts
 * 向量索引模块
 *
 * 功能:
 * - 为文件生成向量嵌入并存储到 Vectorize（支持分块索引）
 * - 语义相似文件搜索
 * - 批量索引管理
 * 模型: @cf/baai/bge-m3（多语言，1024维）
 * 注意: Vectorize 索引需以 --dimensions=1024 --metric=cosine 创建
 */

import type { Env } from '../../types/env';
import { getDb, files, fileNotes } from '../../db';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { logger } from '@osshelf/shared';
import { readFileContent } from '../fileContentHelper';
import { VECTOR_LOG_MODULE } from './constants';

// bge-m3: 多语言，1024 维，中文效果远优于 bge-base-en-v1.5
const EMBEDDING_MODEL = '@cf/baai/bge-m3';
const MAX_TEXT_LENGTH = 4096;

// 分块配置: 滑动窗口策略
const CHUNK_CONFIG = {
  chunkSize: 1000, // 约 512 token (中文约 2 字符/token)
  overlap: 128, // 约 64 token 重叠，保持上下文连续性
  maxChunks: 20, // 单文件最多 20 块，控制存储成本
} as const;

// 向量 ID 前缀: 用于区分单块和多块模式
const CHUNK_ID_PREFIX = '_chunk_';

export interface VectorSearchResult {
  fileId: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface IndexResult {
  success: boolean;
  fileId: string;
  error?: string;
}

/**
 * 文本分块 — 滑动窗口策略
 * 超过 MAX_TEXT_LENGTH 的文本会被分割为多个重叠块
 */
function splitTextIntoChunks(text: string): string[] {
  if (text.length <= MAX_TEXT_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length && chunks.length < CHUNK_CONFIG.maxChunks) {
    const end = Math.min(start + CHUNK_CONFIG.chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += CHUNK_CONFIG.chunkSize - CHUNK_CONFIG.overlap;
  }

  return chunks;
}

/**
 * 生成分块向量 ID
 */
function buildChunkVectorId(fileId: string, index: number): string {
  return `${fileId}${CHUNK_ID_PREFIX}${index}`;
}

/**
 * 判断向量 ID 是否为分块 ID
 */
function isChunkId(vectorId: string): boolean {
  return vectorId.includes(CHUNK_ID_PREFIX);
}

/**
 * 从分块向量 ID 提取原始文件 ID
 */
function extractFileIdFromChunkId(vectorId: string): string {
  return vectorId.split(CHUNK_ID_PREFIX)[0];
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

    const chunks = splitTextIntoChunks(text);

    if (chunks.length === 1) {
      // 短文本：单块模式（兼容旧逻辑）
      const truncatedText = chunks[0].slice(0, MAX_TEXT_LENGTH);
      const result = await (env.AI as any).run(EMBEDDING_MODEL, {
        text: [truncatedText],
      });

      const data = result?.data;
      if (!data || data.length === 0) {
        throw new Error('Failed to generate embedding: empty data');
      }

      await env.VECTORIZE.upsert([
        {
          id: fileId,
          values: data[0],
          metadata: {
            userId: file.userId,
            name: file.name,
            mimeType: file.mimeType || '',
            chunkCount: 1,
          },
        },
      ]);
    } else {
      // 长文本：多块模式
      logger.info(VECTOR_LOG_MODULE, '文件使用分块索引', { fileId, chunkCount: chunks.length });

      const embeddings = await (env.AI as any).run(EMBEDDING_MODEL, {
        text: chunks.map((c) => c.slice(0, MAX_TEXT_LENGTH)),
      });

      const data = embeddings?.data;
      if (!data || data.length === 0) {
        throw new Error('Failed to generate embeddings: empty data');
      }

      const upsertItems = data.map((embedding: number[], index: number) => ({
        id: buildChunkVectorId(fileId, index),
        values: embedding,
        metadata: {
          userId: file.userId,
          name: file.name,
          mimeType: file.mimeType || '',
          chunkIndex: index,
          chunkCount: chunks.length,
          sourceFileId: fileId,
        },
      }));

      await env.VECTORIZE.upsert(upsertItems);
    }

    await db.update(files).set({ vectorIndexedAt: new Date().toISOString() }).where(eq(files.id, fileId));
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
    const allIdsToDelete: string[] = [];

    for (const fileId of fileIds) {
      allIdsToDelete.push(fileId);
      for (let i = 0; i < CHUNK_CONFIG.maxChunks; i++) {
        allIdsToDelete.push(buildChunkVectorId(fileId, i));
      }
    }

    const VECTORIZE_DELETE_CHUNK_SIZE = 1000;
    for (let i = 0; i < allIdsToDelete.length; i += VECTORIZE_DELETE_CHUNK_SIZE) {
      const chunk = allIdsToDelete.slice(i, i + VECTORIZE_DELETE_CHUNK_SIZE);
      await env.VECTORIZE.deleteByIds(chunk);
    }

    logger.info(VECTOR_LOG_MODULE, '批量删除向量成功', {
      fileCount: fileIds.length,
      vectorCount: allIdsToDelete.length,
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
  const { limit = 20, threshold = 0.5 } = options;

  if (!env.AI || !env.VECTORIZE) {
    return [];
  }

  try {
    // 搜索时增加 topK 以应对同一文件多个 chunk 的情况
    // Cloudflare Vectorize 限制：returnMetadata='all' 时 topK 最大 50
    const effectiveLimit = Math.min(limit * 3, 50);

    const result = await (env.AI as any).run(EMBEDDING_MODEL, {
      text: [query.slice(0, MAX_TEXT_LENGTH)],
    });

    const data = result?.data;
    if (!data || data.length === 0) {
      return [];
    }

    const filter: VectorizeVectorMetadataFilter = { userId };

    const results = await env.VECTORIZE.query(data[0], {
      topK: effectiveLimit,
      filter,
      returnMetadata: 'all',
    });

    const rawMatches = results.matches
      .filter((m) => m.score >= threshold)
      .map((m) => ({
        rawId: m.id,
        fileId: isChunkId(m.id) ? extractFileIdFromChunkId(m.id) : m.id,
        score: m.score,
        metadata: m.metadata as Record<string, unknown> | undefined,
      }));

    // 同一文件多个 chunk 时取最高分
    const bestScoreMap = new Map<string, VectorSearchResult>();
    for (const match of rawMatches) {
      const existing = bestScoreMap.get(match.fileId);
      if (!existing || match.score > existing.score) {
        bestScoreMap.set(match.fileId, {
          fileId: match.fileId,
          score: match.score,
          metadata: match.metadata,
        });
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

export async function buildFileTextForVector(env: Env, fileId: string): Promise<string> {
  const db = getDb(env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return '';

  // 层1：尝试读取实际文件内容（text、代码、PDF 等可提取类型）
  let actualContent = '';
  try {
    const readResult = await readFileContent(env, file);
    if (readResult.success && readResult.content) {
      actualContent = readResult.content.slice(0, 50000);
      logger.info(VECTOR_LOG_MODULE, '索引层1：实际文件内容', { fileId, source: readResult.source, length: actualContent.length });
    }
  } catch (error) {
    logger.warn(VECTOR_LOG_MODULE, '层1读取失败，将降级', { fileId, fileName: file.name }, error);
  }

  // 层2：AI 摘要（文本摘要 或 图片描述）
  const aiSummaryText = file.aiSummary || '';

  // 层3：AI 标签展开为词组
  let tagsText = '';
  if (file.aiTags) {
    try {
      const tags: string[] = JSON.parse(file.aiTags);
      tagsText = tags.join(' ');
    } catch {
      tagsText = file.aiTags;
    }
  }

  // 笔记内容（始终追加）
  const notes = await db
    .select({ content: fileNotes.content })
    .from(fileNotes)
    .where(eq(fileNotes.fileId, fileId))
    .limit(5)
    .all();

  // 基础元数据（始终放在最前，任何层都包含）
  const metaParts = [file.name, file.description || ''].filter(Boolean);

  // 分级回退：优先用实际内容，其次摘要+标签，最低仅元数据
  let bodyParts: string[];
  if (actualContent) {
    // 层1 成功：内容 + 摘要补充（摘要可能比内容更精炼，有助于召回）
    bodyParts = [actualContent, aiSummaryText, tagsText];
  } else if (aiSummaryText || tagsText) {
    // 层2：无法读取内容，用 AI 摘要 + 标签
    logger.info(VECTOR_LOG_MODULE, '索引层2降级：AI摘要+标签', { fileId, hasSummary: !!aiSummaryText, hasTags: !!tagsText });
    bodyParts = [aiSummaryText, tagsText];
  } else {
    // 层3：仅元数据（文件名+描述），至少保证文件可被语义搜索到
    logger.warn(VECTOR_LOG_MODULE, '索引层3降级：仅元数据', { fileId, fileName: file.name });
    bodyParts = [];
  }

  const parts = [
    ...metaParts,
    ...bodyParts,
    ...notes.map((n) => n.content),
  ].filter(Boolean);

  return parts.join('\n');
}

export async function batchIndexFiles(env: Env, fileIds: string[]): Promise<IndexResult[]> {
  const results: IndexResult[] = [];

  for (const fileId of fileIds) {
    try {
      const text = await buildFileTextForVector(env, fileId);
      await indexFileVector(env, fileId, text);
      results.push({ success: true, fileId });
    } catch (error) {
      results.push({
        success: false,
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Reciprocal Rank Fusion (RRF) — 合并语义搜索和关键词搜索结果
 * k=60 是常用值，用于平滑排名差异
 */
function reciprocalRankFusion(
  vectorResults: VectorSearchResult[],
  keywordResults: VectorSearchResult[],
  k: number = 60
): VectorSearchResult[] {
  const scores = new Map<string, number>();

  for (const results of [vectorResults, keywordResults]) {
    results.forEach((r, rank) => {
      const prev = scores.get(r.fileId) || 0;
      scores.set(r.fileId, prev + 1 / (k + rank + 1));
    });
  }

  return Array.from(scores.entries())
    .map(([fileId, score]) => ({ fileId, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 关键词搜索（SQL LIKE）— 作为语义搜索的补充
 */
async function keywordSearch(env: Env, query: string, userId: string, limit: number): Promise<VectorSearchResult[]> {
  const db = getDb(env.DB);

  try {
    const queryLower = query.toLowerCase();
    const matched = await db
      .select({ id: files.id })
      .from(files)
      .where(
        and(eq(files.userId, userId), isNull(files.deletedAt), sql`lower(${files.name}) like ${'%' + queryLower + '%'}`)
      )
      .limit(limit)
      .all();

    return matched.map((r) => ({ fileId: r.id, score: 0.8 }));
  } catch {
    return [];
  }
}

/**
 * 语义搜索 + DB 查询合并，使用 RRF 混合检索策略
 */
export async function searchAndFetchFiles(
  env: Env,
  query: string,
  userId: string,
  options: { limit?: number; threshold?: number; mimeType?: string } = {}
) {
  const { limit = 20 } = options;

  const [vectorResults, keywordResults] = await Promise.all([
    searchSimilarFiles(env, query, userId, { limit: Math.min(limit * 2, 40) }),
    keywordSearch(env, query, userId, Math.min(limit * 2, 40)),
  ]);

  const fusedResults = reciprocalRankFusion(vectorResults, keywordResults);
  const topResults = fusedResults.slice(0, limit);

  if (topResults.length === 0) return [];

  const db = getDb(env.DB);
  const fileIds = topResults.map((r) => r.fileId);

  const fileRecords = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), inArray(files.id, fileIds)))
    .all();

  const fileMap = new Map(fileRecords.map((f) => [f.id, f]));

  return topResults
    .filter((r) => fileMap.has(r.fileId))
    .map((r) => ({
      ...fileMap.get(r.fileId)!,
      similarityScore: r.score,
    }));
}

export async function isAIConfigured(env: Env): Promise<boolean> {
  return !!(env.AI && env.VECTORIZE);
}
