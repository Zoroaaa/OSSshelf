/**
 * retrieval/fts.ts
 * FTS5 关键词检索（D1 不支持时自动回退 LIKE）
 *
 * 表结构：使用 122 迁移建的 files_fts_v2（列名 file_id）。
 * 070 建的旧 files_fts 列名是 id，110 的同名声明被 IF NOT EXISTS 跳过，
 * 直接查它会永远失败——这里只在 v2 不可用时降级 LIKE，不再回退旧表。
 *
 * 熔断：失败后进入 TTL 冷却（ai.rag.fts_circuit_ttl_ms），到期半开探测一次；
 * 不用永久 WeakSet，避免一次瞬时故障让关键词检索永久失效。
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Env } from '../../../types/env';
import { getDb, files } from '../../../db';
import { logger } from '@osshelf/shared';
import { AI_RAG_DEFAULTS, getAiConfigNumber } from '../aiConfigService';

export interface KeywordHit {
  fileId: string;
  score: number;
}

const FTS_TABLE = 'files_fts_v2';
/** env → 熔断到期时间戳；到期后允许半开探测 */
const circuitOpenUntil = new WeakMap<object, number>();

function isCircuitOpen(env: Env): boolean {
  const until = circuitOpenUntil.get(env) ?? 0;
  return Date.now() < until;
}

async function openCircuit(env: Env): Promise<void> {
  let ttl: number = AI_RAG_DEFAULTS.ftsCircuitTtlMs;
  try {
    ttl = await getAiConfigNumber(env, 'ai.rag.fts_circuit_ttl_ms', AI_RAG_DEFAULTS.ftsCircuitTtlMs);
  } catch {
    // 配置读取失败时用注册表默认值
  }
  circuitOpenUntil.set(env, Date.now() + Math.max(1_000, ttl));
  logger.warn('FTS', 'FTS unavailable, circuit opened', { ttlMs: ttl });
}

function closeCircuit(env: Env): void {
  circuitOpenUntil.delete(env);
}

/**
 * 构造 FTS5 MATCH 表达式。
 *
 * 为什么用前缀查询：unicode61 把连续中文当成一个 token（"季度报告2026"），
 * 直接 `"季度"` 永远匹配不到；加 `*` 后按前缀命中同一 token，中文关键词才有效。
 * 输入里的 FTS 操作符先剔除，前缀星号由本函数统一追加，避免注入。
 */
export function buildFtsMatchQuery(query: string, maxTokens: number): string {
  const tokens = query
    .replace(/["'*():^~[\]{}]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 1)
    .slice(0, Math.max(1, maxTokens));

  if (tokens.length === 0) return '';
  return tokens.map((token) => `"${token}"*`).join(' OR ');
}

async function getFtsMaxTokens(env: Env): Promise<number> {
  try {
    return await getAiConfigNumber(env, 'ai.rag.fts_max_tokens', AI_RAG_DEFAULTS.ftsMaxTokens);
  } catch {
    return AI_RAG_DEFAULTS.ftsMaxTokens;
  }
}

export async function syncFileFts(env: Env, fileId: string): Promise<void> {
  if (isCircuitOpen(env)) return;

  try {
    const db = getDb(env.DB);
    const file = await db
      .select({
        id: files.id,
        name: files.name,
        description: files.description,
        aiSummary: files.aiSummary,
        aiTags: files.aiTags,
      })
      .from(files)
      .where(eq(files.id, fileId))
      .get();

    if (!file) return;

    let tagsText = '';
    if (file.aiTags) {
      try {
        const tags = JSON.parse(file.aiTags) as string[];
        tagsText = Array.isArray(tags) ? tags.join(' ') : file.aiTags;
      } catch {
        tagsText = file.aiTags;
      }
    }

    await db.run(sql`DELETE FROM files_fts_v2 WHERE file_id = ${fileId}`);
    await db.run(sql`
      INSERT INTO files_fts_v2 (file_id, name, description, ai_summary, ai_tags)
      VALUES (${fileId}, ${file.name}, ${file.description ?? ''}, ${file.aiSummary ?? ''}, ${tagsText})
    `);
    closeCircuit(env);
  } catch (error) {
    await openCircuit(env);
    logger.warn('FTS', 'FTS write failed, falling back to LIKE', { fileId }, error);
  }
}

export async function deleteFileFts(env: Env, fileId: string): Promise<void> {
  if (isCircuitOpen(env)) return;

  try {
    await getDb(env.DB).run(sql`DELETE FROM files_fts_v2 WHERE file_id = ${fileId}`);
    closeCircuit(env);
  } catch (error) {
    await openCircuit(env);
    logger.warn('FTS', 'Failed to delete FTS row', { fileId }, error);
  }
}

export async function searchFileIdsByKeyword(
  env: Env,
  query: string,
  userId: string,
  limit: number
): Promise<KeywordHit[]> {
  const maxTokens = await getFtsMaxTokens(env);
  const matchQuery = buildFtsMatchQuery(query, maxTokens);
  if (!matchQuery) return [];

  if (!isCircuitOpen(env)) {
    try {
      const db = getDb(env.DB);
      const rows = await db.all(
        sql`
          SELECT file_id, bm25(${sql.raw(FTS_TABLE)}) AS rank
          FROM ${sql.raw(FTS_TABLE)}
          WHERE ${sql.raw(FTS_TABLE)} MATCH ${matchQuery}
            AND file_id IN (SELECT id FROM files WHERE user_id = ${userId} AND deleted_at IS NULL)
          ORDER BY rank
          LIMIT ${limit}
        `
      );

      closeCircuit(env);
      return (rows as Array<{ file_id: string; rank: number }>).map((row) => ({
        fileId: row.file_id,
        // bm25 越小越相关；转成递减分数，RRF 只用排序
        score: 1 / (1 + Math.abs(row.rank)),
      }));
    } catch (error) {
      await openCircuit(env);
      logger.warn('FTS', 'FTS query failed, falling back to LIKE', { query }, error);
    }
  }

  return searchByLike(env, query, userId, limit);
}

async function searchByLike(env: Env, query: string, userId: string, limit: number): Promise<KeywordHit[]> {
  const db = getDb(env.DB);
  const like = `%${query.toLowerCase()}%`;

  try {
    const rows = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), sql`lower(${files.name}) LIKE ${like}`))
      .limit(limit)
      .all();

    return rows.map((row) => ({ fileId: row.id, score: 0.5 }));
  } catch {
    return [];
  }
}

export async function rebuildFtsForUser(env: Env, userId: string): Promise<number> {
  if (isCircuitOpen(env)) return 0;

  const db = getDb(env.DB);
  const userFiles = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .all();

  let synced = 0;
  for (const file of userFiles) {
    await syncFileFts(env, file.id);
    synced++;
  }
  return synced;
}
