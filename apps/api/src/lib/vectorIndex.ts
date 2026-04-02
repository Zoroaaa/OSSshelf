/**
 * vectorIndex.ts
 * 向量索引模块
 *
 * 功能:
 * - 为文件生成向量嵌入并存储到 Vectorize
 * - 语义相似文件搜索
 * - 批量索引管理
 * 模型: @cf/baai/bge-m3（多语言，1024维）
 * 注意: Vectorize 索引需以 --dimensions=1024 --metric=cosine 创建
 */

import type { Env } from '../types/env';
import { getDb, files, fileNotes } from '../db';
import { eq, and, inArray, isNull } from 'drizzle-orm';

// bge-m3: 多语言，1024 维，中文效果远优于 bge-base-en-v1.5
const EMBEDDING_MODEL = '@cf/baai/bge-m3';
const MAX_TEXT_LENGTH = 4096;

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

export async function indexFileVector(env: Env, fileId: string, text: string): Promise<void> {
  if (!env.AI || !env.VECTORIZE) {
    console.warn('AI or VECTORIZE not configured, skipping vector indexing');
    return;
  }

  if (!text || text.trim().length === 0) {
    console.warn(`Empty text for file ${fileId}, skipping vector indexing`);
    return;
  }

  const truncatedText = text.slice(0, MAX_TEXT_LENGTH);

  try {
    const result = await (env.AI as any).run(EMBEDDING_MODEL, {
      text: [truncatedText],
    });

    // bge-m3 返回结构: { data: number[][] }
    const data = result?.data;
    if (!data || data.length === 0) {
      throw new Error('Failed to generate embedding: empty data');
    }

    const db = getDb(env.DB);
    const file = await db.select().from(files).where(eq(files.id, fileId)).get();

    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }

    await env.VECTORIZE.upsert([
      {
        id: fileId,
        values: data[0],
        metadata: {
          userId: file.userId,
          name: file.name,
          mimeType: file.mimeType || '',
        },
      },
    ]);

    await db.update(files).set({ vectorIndexedAt: new Date().toISOString() }).where(eq(files.id, fileId));
  } catch (error) {
    console.error(`Failed to index file ${fileId}:`, error);
    throw error;
  }
}

export async function deleteFileVector(env: Env, fileId: string): Promise<void> {
  if (!env.VECTORIZE) return;

  try {
    await env.VECTORIZE.deleteByIds([fileId]);
  } catch (error) {
    console.error(`Failed to delete vector for file ${fileId}:`, error);
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
  // threshold 默认 0.5（bge-m3 cosine 分数普遍偏低，0.7 会过滤掉大量有效结果）
  const { limit = 20, threshold = 0.5 } = options;

  if (!env.AI || !env.VECTORIZE) {
    return [];
  }

  try {
    const result = await (env.AI as any).run(EMBEDDING_MODEL, {
      text: [query.slice(0, MAX_TEXT_LENGTH)],
    });

    const data = result?.data;
    if (!data || data.length === 0) {
      return [];
    }

    // userId filter 防止跨用户泄露
    const filter: VectorizeVectorMetadataFilter = { userId };

    const results = await env.VECTORIZE.query(data[0], {
      topK: limit,
      filter,
      returnMetadata: 'all',
    });

    return results.matches
      .filter((m) => m.score >= threshold)
      .map((m) => ({
        fileId: m.id,
        score: m.score,
        metadata: m.metadata as Record<string, unknown> | undefined,
      }));
  } catch (error) {
    console.error('Failed to search similar files:', error);
    return [];
  }
}

export async function buildFileTextForVector(env: Env, fileId: string): Promise<string> {
  const db = getDb(env.DB);

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return '';

  const notes = await db
    .select({ content: fileNotes.content })
    .from(fileNotes)
    .where(eq(fileNotes.fileId, fileId))
    .limit(5)
    .all();

  const parts = [file.name, file.description || '', file.aiSummary || '', ...notes.map((n) => n.content)].filter(
    Boolean
  );

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
 * 语义搜索 + DB 查询合并，避免 ai/search 路由的全表扫描
 */
export async function searchAndFetchFiles(
  env: Env,
  query: string,
  userId: string,
  options: { limit?: number; threshold?: number; mimeType?: string } = {}
) {
  const searchResults = await searchSimilarFiles(env, query, userId, options);
  if (searchResults.length === 0) return [];

  const db = getDb(env.DB);
  const fileIds = searchResults.map((r) => r.fileId);

  const fileRecords = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), inArray(files.id, fileIds)))
    .all();

  const fileMap = new Map(fileRecords.map((f) => [f.id, f]));

  return searchResults
    .filter((r) => fileMap.has(r.fileId))
    .map((r) => ({
      ...fileMap.get(r.fileId)!,
      similarityScore: r.score,
    }));
}

export async function isAIConfigured(env: Env): Promise<boolean> {
  return !!(env.AI && env.VECTORIZE);
}
