/**
 * retrievalService.ts
 * 文件级混合检索的唯一入口
 *
 * 收敛前的三套策略：
 * 1. searchAndFetchFiles：向量 + FTS + RRF（k=60 写死）
 * 2. executeSearchFiles：RRF + 额外 LIKE 补漏（阈值 0.22 写死）
 * 3. executeSmartSearch：向量固定权重 1.2 + LIKE 固定权重 0.8
 *
 * 现在统一为：向量召回 + FTS 召回 → RRF 融合 → 一次文件行过滤。
 * - 阈值、RRF k、召回倍数全部来自 ai.rag.*
 * - LIKE 只在 FTS 熔断时由 retrieval/fts.ts 内部降级，不再在业务层重复补漏
 * - 过滤（归属/未删除/MIME/目录）在一次 SQL 内完成，顺序按融合分数
 */

import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import type { Env } from '../../types/env';
import { getDb, files } from '../../db';
import { searchFileIdsByKeyword } from './retrieval/fts';
import { searchSimilarFiles, type VectorSearchResult } from './vectorIndex';
import { AI_RAG_DEFAULTS, getAiConfigNumber } from './aiConfigService';

export interface RetrieveOptions {
  limit: number;
  mimeTypePrefix?: string;
  /** 精确 MIME 过滤（/api/ai/search 使用） */
  mimeType?: string;
  folderId?: string;
  /** 显式覆盖向量阈值；默认读 ai.rag.vector_threshold */
  threshold?: number;
}

export interface FusedHit {
  fileId: string;
  score: number;
}

function reciprocalRankFusion(
  vectorResults: VectorSearchResult[],
  keywordResults: VectorSearchResult[],
  k: number
): FusedHit[] {
  const scores = new Map<string, number>();
  const safeK = Math.max(1, k);

  for (const results of [vectorResults, keywordResults]) {
    results.forEach((result, rank) => {
      const prev = scores.get(result.fileId) ?? 0;
      scores.set(result.fileId, prev + 1 / (safeK + rank + 1));
    });
  }

  return Array.from(scores.entries())
    .map(([fileId, score]) => ({ fileId, score }))
    .sort((a, b) => b.score - a.score);
}

/** 只返回 fileId + 融合分数，供需要自定义取数的调用方使用 */
export async function retrieveFileIds(
  env: Env,
  query: string,
  userId: string,
  options: RetrieveOptions
): Promise<FusedHit[]> {
  const limit = Math.min(Math.max(options.limit, 1), 100);
  const [rrfK, multiplier] = await Promise.all([
    getAiConfigNumber(env, 'ai.rag.rrf_k', AI_RAG_DEFAULTS.rrfK),
    getAiConfigNumber(env, 'ai.rag.top_k_multiplier', AI_RAG_DEFAULTS.topKMultiplier),
  ]);

  const candidateLimit = Math.min(limit * Math.max(1, multiplier), 50);

  const [vectorResults, keywordHits] = await Promise.all([
    searchSimilarFiles(env, query, userId, {
      limit: candidateLimit,
      threshold: options.threshold,
    }),
    searchFileIdsByKeyword(env, query, userId, candidateLimit),
  ]);

  const keywordResults: VectorSearchResult[] = keywordHits.map((hit) => ({
    fileId: hit.fileId,
    score: hit.score,
  }));

  return reciprocalRankFusion(vectorResults, keywordResults, rrfK).slice(0, limit);
}

/** 返回文件行（含 similarityScore），按融合排序过滤后保持顺序 */
export async function searchFilesHybrid(
  env: Env,
  query: string,
  userId: string,
  options: RetrieveOptions
): Promise<Array<InferSelectModel<typeof files> & { similarityScore: number }>> {
  const fused = await retrieveFileIds(env, query, userId, options);
  if (fused.length === 0) return [];

  const conditions = [
    eq(files.userId, userId),
    isNull(files.deletedAt),
    inArray(
      files.id,
      fused.map((hit) => hit.fileId)
    ),
  ];
  if (options.mimeType) conditions.push(eq(files.mimeType, options.mimeType));
  else if (options.mimeTypePrefix) conditions.push(like(files.mimeType, `${options.mimeTypePrefix}%`));
  if (options.folderId) conditions.push(eq(files.parentId, options.folderId));

  const rows = await getDb(env.DB)
    .select()
    .from(files)
    .where(and(...conditions))
    .all();

  const scoreMap = new Map(fused.map((hit) => [hit.fileId, hit.score]));
  return rows
    .map((row) => ({ ...row, similarityScore: scoreMap.get(row.id) ?? 0 }))
    .sort((a, b) => b.similarityScore - a.similarityScore);
}
