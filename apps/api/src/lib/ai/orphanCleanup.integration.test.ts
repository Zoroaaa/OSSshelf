/**
 * orphanCleanup.integration.test.ts
 * 孤儿清理：真实迁移 + 内存 SQLite，验证只删孤儿、不误删有效数据。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types/env';
import { createD1Shim, createMigratedSqlite } from '../../test/d1Shim';
import { runAiOrphanCleanup } from './orphanCleanup';

const NOW = '2026-11-26T00:00:00.000Z';
let sqlite: ReturnType<typeof createMigratedSqlite>;
let env: Env;

const run = (sql: string, ...params: unknown[]) => sqlite.prepare(sql).run(...params);
const count = (table: string): number =>
  (sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).all() as Array<{ c: number }>)[0]?.c ?? 0;

beforeEach(() => {
  sqlite = createMigratedSqlite();
  sqlite.exec('PRAGMA foreign_keys = ON');
  env = { DB: createD1Shim(sqlite) } as unknown as Env;

  run(
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','u1@t.dev','x',?,?)`,
    NOW,
    NOW
  );
  run(
    `INSERT INTO files (id, user_id, name, path, type, size, r2_key, ref_count, is_folder, created_at, updated_at)
     VALUES ('live-file','u1','a.txt','/a.txt','text/plain',1,'k1',1,0,?,?)`,
    NOW,
    NOW
  );
  run(`INSERT INTO file_chunks (id, file_id, chunk_index, content, content_hash, embedding_model, token_count, created_at)
       VALUES ('c-live','live-file',0,'x','h','m',1,?)`, NOW);
  run(`INSERT INTO file_chunks (id, file_id, chunk_index, content, content_hash, embedding_model, token_count, created_at)
       VALUES ('c-ghost','ghost-file',0,'x','h','m',1,?)`, NOW);

  run(
    `INSERT INTO ai_chat_sessions (id, user_id, title, created_at, updated_at) VALUES ('s1','u1','t',?,?)`,
    NOW,
    NOW
  );
  run(
    `INSERT INTO ai_task_runs (id, session_id, user_id, goal, status, created_at, updated_at)
     VALUES ('r-live','s1','u1','g','running',?,?)`,
    NOW,
    NOW
  );
  run(
    `INSERT INTO ai_task_runs (id, session_id, user_id, goal, status, created_at, updated_at)
     VALUES ('r-ghost','s-deleted','u1','g','running',?,?)`,
    NOW,
    NOW
  );
  for (const id of ['r-live', 'r-ghost']) {
    run(
      `INSERT INTO ai_task_steps (id, run_id, step_index, title, status, updated_at) VALUES (?,?,0,'s','pending',?)`,
      `step-${id}`,
      id,
      NOW
    );
    run(
      `INSERT INTO ai_task_events (id, run_id, type, created_at) VALUES (?,?,'run_created',?)`,
      `evt-${id}`,
      id,
      NOW
    );
  }

  run(`INSERT INTO ai_tasks (id, user_id, type, status, total, processed, failed, started_at, updated_at)
       VALUES ('t1','u1','summary','running',1,0,0,?,?)`, NOW, NOW);
  run(`INSERT INTO ai_task_items (id, task_id, file_id, status, attempts, updated_at)
       VALUES ('i-live','t1','live-file','pending',0,?)`, NOW);
  run(`INSERT INTO ai_task_items (id, task_id, file_id, status, attempts, updated_at)
       VALUES ('i-ghost','t-deleted','live-file','pending',0,?)`, NOW);

  run(`INSERT INTO ai_memories (id, user_id, session_id, summary, created_at) VALUES ('m-live','u1','s1','x',?)`, NOW);
  run(
    `INSERT INTO ai_memories (id, user_id, session_id, summary, created_at) VALUES ('m-ghost','u1','s-deleted','x',?)`,
    NOW
  );
});

describe('runAiOrphanCleanup', () => {
  it('只删除没有归属的 AI 数据', async () => {
    const result = await runAiOrphanCleanup(env);

    expect(result.orphanChunkFiles).toBe(1);
    expect(result.orphanChunkRows).toBe(1);
    expect(result.orphanTaskItems).toBe(1);
    expect(result.orphanTaskSteps).toBe(1);
    expect(result.orphanTaskEvents).toBe(1);
    expect(result.orphanTaskRuns).toBe(1);
    expect(result.orphanMemories).toBe(1);
  });

  it('有效数据保持不变', async () => {
    await runAiOrphanCleanup(env);

    expect(count('file_chunks')).toBe(1);
    expect(count('ai_task_items')).toBe(1);
    expect(count('ai_task_runs')).toBe(1);
    expect(count('ai_task_steps')).toBe(1);
    expect(count('ai_task_events')).toBe(1);
    expect(count('ai_memories')).toBe(1);

    const chunk = sqlite.prepare(`SELECT file_id FROM file_chunks`).all() as Array<{ file_id: string }>;
    expect(chunk[0]?.file_id).toBe('live-file');
    const runRow = sqlite.prepare(`SELECT id FROM ai_task_runs`).all() as Array<{ id: string }>;
    expect(runRow[0]?.id).toBe('r-live');
  });

  it('无孤儿时是空操作', async () => {
    sqlite.exec(`DELETE FROM file_chunks WHERE file_id = 'ghost-file'`);
    sqlite.exec(`DELETE FROM ai_task_items WHERE id = 'i-ghost'`);
    sqlite.exec(`DELETE FROM ai_task_runs WHERE id = 'r-ghost'`);
    sqlite.exec(`DELETE FROM ai_task_steps WHERE run_id = 'r-ghost'`);
    sqlite.exec(`DELETE FROM ai_task_events WHERE run_id = 'r-ghost'`);
    sqlite.exec(`DELETE FROM ai_memories WHERE id = 'm-ghost'`);

    const result = await runAiOrphanCleanup(env);
    expect(result).toMatchObject({
      orphanChunkRows: 0,
      orphanTaskItems: 0,
      orphanTaskSteps: 0,
      orphanTaskEvents: 0,
      orphanTaskRuns: 0,
      orphanMemories: 0,
    });
  });
});
