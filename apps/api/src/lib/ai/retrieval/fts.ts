/**
 * retrieval/fts.ts
 * FTS5 关键词检索（D1 不支持时自动回退 LIKE）
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Env } from '../../../types/env';
import { getDb, files } from '../../../db';
import { logger } from '@osshelf/shared';

export interface KeywordHit {
  fileId: string;
  score: number;
}

const unavailableEnvs = new WeakSet<object>();

function buildMatchQuery(query: string): string {
  const tokens = query
    .replace(/["'*():^~[\]{}]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 1)
    .slice(0, 8);

  if (tokens.length === 0) return '';
  return tokens.map((token) => `"${token}"`).join(' OR ');
}

export async function syncFileFts(env: Env, fileId: string): Promise<void> {
  if (unavailableEnvs.has(env)) return;

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

    await db.run(sql`DELETE FROM files_fts WHERE file_id = ${fileId}`);
    await db.run(sql`
      INSERT INTO files_fts (file_id, name, description, ai_summary, ai_tags)
      VALUES (${fileId}, ${file.name}, ${file.description ?? ''}, ${file.aiSummary ?? ''}, ${tagsText})
    `);
  } catch (error) {
    unavailableEnvs.add(env);
    logger.warn('FTS', 'FTS5 unavailable, falling back to LIKE', { fileId }, error);
  }
}

export async function deleteFileFts(env: Env, fileId: string): Promise<void> {
  if (unavailableEnvs.has(env)) return;

  try {
    await getDb(env.DB).run(sql`DELETE FROM files_fts WHERE file_id = ${fileId}`);
  } catch (error) {
    unavailableEnvs.add(env);
    logger.warn('FTS', 'Failed to delete FTS row', { fileId }, error);
  }
}

export async function searchFileIdsByKeyword(
  env: Env,
  query: string,
  userId: string,
  limit: number
): Promise<KeywordHit[]> {
  const matchQuery = buildMatchQuery(query);
  if (!matchQuery) return [];

  if (!unavailableEnvs.has(env)) {
    try {
      const db = getDb(env.DB);
      const rows = await db.all(
        sql`
          SELECT file_id, bm25(files_fts) AS rank
          FROM files_fts
          WHERE files_fts MATCH ${matchQuery}
            AND file_id IN (SELECT id FROM files WHERE user_id = ${userId} AND deleted_at IS NULL)
          ORDER BY rank
          LIMIT ${limit}
        `
      );

      return (rows as Array<{ file_id: string; rank: number }>).map((row) => ({
        fileId: row.file_id,
        // bm25 越小越相关；转成递减分数，RRF 只用排序
        score: 1 / (1 + Math.abs(row.rank)),
      }));
    } catch (error) {
      unavailableEnvs.add(env);
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
  if (unavailableEnvs.has(env)) return 0;

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
