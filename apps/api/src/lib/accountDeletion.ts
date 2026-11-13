/**
 * accountDeletion.ts
 * 账户注销的数据清理（应用层）。
 *
 * 依据：对本地 D1 施加全量迁移后执行 `PRAGMA foreign_key_list(<table>)` 穷举，
 * 全库共 37 列引用 `users(id)`。其中 `ON DELETE CASCADE` 的列由数据库自动处理，
 * 剩下的列不会随 `users` 行消失，必须在删除用户前显式清理，否则
 * `DELETE FROM users` 会抛 `FOREIGN KEY constraint failed`
 * 或 `NOT NULL constraint failed`（SET NULL 声明在 NOT NULL 列上）。
 *
 * 该清单由 `accountDeletion.test.ts` 对照 migrations/*.sql 校验完整性：
 * 新增任何引用 users 的非级联列而忘记登记，单测会失败。
 */

import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { AppError } from '../middleware/error';

export type UserRefAction = 'set-null' | 'delete-rows';

export interface UserRefCleanup {
  table: string;
  column: string;
  action: UserRefAction;
  reason: string;
}

/**
 * 引用 `users(id)` 且不会随用户删除自动消失的列。
 * `team_activities.user_id` 声明为 `ON DELETE SET NULL` 但列是 NOT NULL，
 * 数据库会直接报错，因此按删除行处理。
 */
export const USER_REF_CLEANUP: UserRefCleanup[] = [
  {
    table: 'file_permissions',
    column: 'granted_by',
    action: 'delete-rows',
    reason: 'NOT NULL 且 NO ACTION：授权人注销后其授出的权限一并撤销',
  },
  {
    table: 'team_resources',
    column: 'mounted_by',
    action: 'delete-rows',
    reason: 'NOT NULL 且 NO ACTION：挂载人注销后取消其挂载',
  },
  {
    table: 'team_activities',
    column: 'user_id',
    action: 'delete-rows',
    reason: '声明 SET NULL 但列 NOT NULL，数据库会报错；操作记录随人删除',
  },
  {
    table: 'file_versions',
    column: 'created_by',
    action: 'set-null',
    reason: 'NO ACTION 且可空：保留版本快照，仅丢失创建人',
  },
  {
    table: 'group_members',
    column: 'added_by',
    action: 'set-null',
    reason: 'NO ACTION 且可空：保留成员关系，仅丢失邀请人',
  },
  {
    table: 'team_members',
    column: 'added_by',
    action: 'set-null',
    reason: 'NO ACTION 且可空：保留成员关系，仅丢失邀请人',
  },
  {
    table: 'permission_requests',
    column: 'reviewed_by',
    action: 'set-null',
    reason: 'NO ACTION 且可空：保留审批记录，仅丢失审批人',
  },
];

export interface PurgeUserResult {
  enqueuedObjects: number;
  deletedVectors: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 把该用户独占的存储对象投递到 `storage_deletion_queue`，由 cron 逐个物理删除。
 *
 * 只投递「没有其它 files 行共享同一 r2_key」的对象：去重（dedup）会让多个用户
 * 的文件行指向同一个对象，直接删会破坏别人的数据。
 */
async function enqueueStorageObjects(env: Env, userId: string): Promise<number> {
  const files = await env.DB.prepare(
    `SELECT f.r2_key AS r2Key, f.bucket_id AS bucketId
       FROM files f
      WHERE f.user_id = ?1 AND f.is_folder = 0
        AND NOT EXISTS (SELECT 1 FROM files o WHERE o.r2_key = f.r2_key AND o.user_id <> ?1)`
  )
    .bind(userId)
    .all<{ r2Key: string; bucketId: string | null }>();

  const versions = await env.DB.prepare(
    `SELECT v.r2_key AS r2Key, f.bucket_id AS bucketId
       FROM file_versions v
       JOIN files f ON f.id = v.file_id
      WHERE f.user_id = ?1
        AND NOT EXISTS (
          SELECT 1 FROM file_versions o JOIN files fo ON fo.id = o.file_id
           WHERE o.r2_key = v.r2_key AND fo.user_id <> ?1
        )`
  )
    .bind(userId)
    .all<{ r2Key: string; bucketId: string | null }>();

  const targets = [...(files.results ?? []), ...(versions.results ?? [])];
  if (targets.length === 0) return 0;

  const now = new Date().toISOString();
  const statements = targets.map((t) =>
    env.DB.prepare(
      `INSERT INTO storage_deletion_queue
         (id, user_id, bucket_id, object_key, reason, attempts, last_error, next_retry_at, created_at, resolved_at)
       VALUES (?, ?, ?, ?, 'account-deleted', 0, NULL, ?, ?, NULL)`
    ).bind(crypto.randomUUID(), userId, t.bucketId, t.r2Key, now, now)
  );

  for (const part of chunk(statements, 50)) {
    await env.DB.batch(part);
  }
  return targets.length;
}

/** 清理该用户文件的向量（失败只记录，不阻塞注销）。 */
async function deleteUserVectors(env: Env, userId: string): Promise<number> {
  if (!env.VECTORIZE) return 0;

  try {
    const fileIds = await env.DB.prepare(`SELECT id FROM files WHERE user_id = ?1 AND is_folder = 0`)
      .bind(userId)
      .all<{ id: string }>();
    const ids = new Set<string>((fileIds.results ?? []).map((r) => r.id));

    // 分块向量的 id 形如 `${fileId}:${chunkIndex}`，见 ai/vectorIndex.ts buildChunkVectorId
    const chunks = await env.DB.prepare(
      `SELECT fc.file_id AS fileId, fc.chunk_index AS chunkIndex
         FROM file_chunks fc JOIN files f ON f.id = fc.file_id
        WHERE f.user_id = ?1`
    )
      .bind(userId)
      .all<{ fileId: string; chunkIndex: number }>();
    for (const row of chunks.results ?? []) ids.add(`${row.fileId}:${row.chunkIndex}`);

    const vectorIds = Array.from(ids);
    let deleted = 0;
    for (const part of chunk(vectorIds, 500)) {
      await env.VECTORIZE.deleteByIds(part);
      deleted += part.length;
    }
    return deleted;
  } catch (error) {
    logger.warn('ACCOUNT', '注销时清理向量失败（不阻塞删除）', { userId }, error);
    return 0;
  }
}

/**
 * 注销前置：团队所有权不随用户删除（teams.owner_id 虽是 CASCADE，
 * 但业务上要求先转移，否则团队资产会被静默销毁）。
 * 冲突时在 details 里带未转移团队清单，供前端直接展示。
 */
async function assertNoOwnedTeams(env: Env, userId: string): Promise<void> {
  const rows = await env.DB.prepare('SELECT id, name FROM teams WHERE owner_id = ? ORDER BY name')
    .bind(userId)
    .all<{ id: string; name: string }>();

  const owned = rows.results ?? [];
  if (owned.length === 0) return;

  throw new AppError('TEAM_OWNERSHIP_TRANSFER_REQUIRED', {
    details: { teams: owned },
    message: `仍有 ${owned.length} 个团队未转移所有权：${owned
      .map((t) => t.name)
      .join('、')}。请先在「团队」页把所有权转给其他成员，再注销账户。`,
  });
}

/**
 * 注销账户：先校验团队所有权，再回收资源、清理不随级联删除的引用，最后删除用户行。
 * 调用方必须在返回成功后再删除 KV 会话、写审计日志。
 */
export async function purgeUser(env: Env, userId: string): Promise<PurgeUserResult> {
  await assertNoOwnedTeams(env, userId);

  const enqueuedObjects = await enqueueStorageObjects(env, userId);
  const deletedVectors = await deleteUserVectors(env, userId);

  for (const ref of USER_REF_CLEANUP) {
    const sql =
      ref.action === 'set-null'
        ? `UPDATE "${ref.table}" SET "${ref.column}" = NULL WHERE "${ref.column}" = ?`
        : `DELETE FROM "${ref.table}" WHERE "${ref.column}" = ?`;
    await env.DB.prepare(sql).bind(userId).run();
  }

  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

  return { enqueuedObjects, deletedVectors };
}
