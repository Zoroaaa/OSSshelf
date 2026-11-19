/**
 * migrate.ts
 * 存储桶迁移路由（原地迁移）
 *
 * 语义：
 * - 迁移只改变文件的物理存放桶，不新建 files 记录：
 *   目标桶按原 r2Key 拷贝对象，然后原地更新 files.bucket_id。
 *   因此 fileId、文件名、目录结构、版本、直链、权限、标签全部保留，
 *   也不会触发「同目录同名」唯一索引冲突。
 * - 同一 r2Key 可能被多条记录共享（同桶去重），按 key 分组处理：
 *   一次拷贝 + 批量切换，避免重复拷贝与引用不一致。
 * - 来源为 Telegram 时按 fileId 处理（telegram_file_refs.r2_key 唯一，不存在共享）。
 * - 目标为 Telegram 时无法复用 r2Key（ref 按 fileId 查询且 r2_key 唯一），
 *   按文件生成新 key 并写入 ref。
 * - Worker 单次执行窗口有限，任务分片执行：
 *   POST /start 初始化，前端循环调用 POST /:id/run 直到 status 不再为 running。
 * - deleteSource=true 时，在对象拷贝并切换成功后清理来源桶对象（失败进入
 *   storage_deletion_queue 由 cron 重试）。
 * - targetFolderId 非空时，迁移完成后把用户选中的顶层项移动到该目录
 *   （复用 serviceMoveFile；此时文件已在目标桶，不会再触发 CROSS_BUCKET）。
 *
 * 端点：
 * - POST /api/migrate/start                创建迁移任务
 * - POST /api/migrate/:migrationId/run     执行一个批次（前端循环调用）
 * - GET  /api/migrate/:migrationId         查询进度
 * - POST /api/migrate/:migrationId/cancel  取消迁移
 */

import { Hono } from 'hono';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, files, fileVersions, storageBuckets, telegramFileRefs } from '../db';
import { authMiddleware, requireApiKeyScope } from '../middleware/auth';
import { ERROR_CODES, logger, MAX_BUFFERED_TRANSFER_BYTES } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import { getEncryptionKey } from '../lib/crypto';
import { s3Get, s3Put, decryptSecret, makeBucketConfigAsync } from '../lib/s3client';
import { deleteObjectSafely } from '../lib/storageGC';
import { moveFile as serviceMoveFile } from '../lib/fileService';
import { tgUploadFile, tgDownloadFile, type TelegramBotConfig } from '../lib/telegramClient';
import {
  isChunkedFileId,
  tgDownloadChunked,
  needsChunking,
  tgUploadChunked,
} from '../lib/telegramChunked';
import { encodeFilename } from '../lib/utils';
import { normalizeParentId } from '../lib/pathUtils';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);
app.use('*', requireApiKeyScope('files:read', 'files:write'));

// ── 迁移状态 KV ────────────────────────────────────────────────────────────
// kv key: "migrate:{userId}:{migrationId}"

type EntryStatus = 'pending' | 'done' | 'failed';
type MigrationPhase = 'copying' | 'cleaning' | 'moving' | 'completed';

interface MigrationEntry {
  fileId: string;
  fileName: string;
  /** 迁移前的 r2Key，也是目标桶使用的 key（目标为 Telegram 时会改写文件记录） */
  r2Key: string;
  size: number;
  mimeType: string | null;
  status: EntryStatus;
  error?: string;
}

interface MigrationStatus {
  migrationId: string;
  userId: string;
  sourceBucketId: string;
  targetBucketId: string;
  targetFolderId: string | null;
  deleteSource: boolean;
  /** bucket = 整桶迁移；selection = 仅迁移选中项 */
  scope: 'bucket' | 'selection';
  /** 用户选中的原始 ID（用于同步文件夹默认桶） */
  selectedIds?: string[];
  /** 需要移动到 targetFolderId 的顶层项 */
  moveIds: string[];
  total: number;
  done: number;
  failed: number;
  results: MigrationEntry[];
  phase: MigrationPhase;
  /** 待清理的来源对象 key 列表 */
  cleanupKeys?: string[];
  cleanupDone?: number;
  moveDone?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
}

const KV_MIGRATE_TTL = 60 * 60 * 24 * 3; // 3 days
/** 单个批次的时间预算，避免超出 Worker 单次执行窗口 */
const BATCH_BUDGET_MS = 18_000;
/** D1 单条语句绑定参数上限 100，IN 查询按 90 分片 */
const D1_IN_CHUNK = 90;

function kvKey(userId: string, migrationId: string) {
  return `migrate:${userId}:${migrationId}`;
}

// ── Validation schemas ─────────────────────────────────────────────────────

const startMigrateSchema = z.object({
  /** 来源存储桶 ID（可选，不传则从 fileIds 自动推断） */
  sourceBucketId: z.string().min(1).optional(),
  /** 目标存储桶 ID */
  targetBucketId: z.string().min(1),
  /**
   * 要迁移的文件/文件夹 ID 列表。
   * 若传文件夹 ID，后端会递归展开其所有子文件。
   * 不传则迁移 sourceBucketId 下的全部文件（此时 sourceBucketId 必填）。
   */
  fileIds: z.array(z.string()).optional(),
  /** 迁移完成后，把选中的顶层项移动到该父文件夹（null = 保持原位置） */
  targetFolderId: z.string().nullable().optional(),
  /** 是否在迁移成功后清理来源桶中的对象 */
  deleteSource: z.boolean().default(false),
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** 递归收集文件夹下所有属于指定桶的文件 ID */
async function collectFileIds(
  db: ReturnType<typeof getDb>,
  userId: string,
  ids: string[],
  bucketId: string
): Promise<string[]> {
  const result = new Set<string>();
  const visited = new Set<string>();
  const queue = [...ids];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const row = await db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!row) continue;

    if (row.isFolder) {
      const children = await db
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.parentId, id), eq(files.userId, userId), isNull(files.deletedAt)))
        .all();
      queue.push(...children.map((c) => c.id));
    } else if (row.bucketId === bucketId) {
      result.add(row.id);
    }
  }
  return [...result];
}

/** 读取待迁移的文件记录（含回收站，它们同样持有物理对象引用） */
async function loadFileRows(
  db: ReturnType<typeof getDb>,
  userId: string,
  bucketId: string,
  ids: string[] | null
) {
  if (!ids) {
    return db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.bucketId, bucketId), eq(files.isFolder, false)))
      .all();
  }

  const rows: (typeof files.$inferSelect)[] = [];
  for (let i = 0; i < ids.length; i += D1_IN_CHUNK) {
    const chunk = ids.slice(i, i + D1_IN_CHUNK);
    const part = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.bucketId, bucketId), inArray(files.id, chunk)))
      .all();
    rows.push(...part);
  }
  return rows;
}

/** 过滤出用户选中的顶层项（父级不在选中集合内） */
async function resolveTopLevelIds(
  db: ReturnType<typeof getDb>,
  userId: string,
  ids: string[]
): Promise<string[]> {
  const requested = new Set(ids);
  const topLevel: string[] = [];

  for (const id of ids) {
    let cursor = (await db.select({ parentId: files.parentId }).from(files).where(eq(files.id, id)).get())?.parentId ?? null;
    const seen = new Set<string>();
    let isDescendant = false;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (requested.has(cursor)) {
        isDescendant = true;
        break;
      }
      cursor = (await db.select({ parentId: files.parentId }).from(files).where(eq(files.id, cursor)).get())?.parentId ?? null;
    }
    if (!isDescendant) topLevel.push(id);
  }
  return topLevel;
}

/** 解析 Telegram 桶配置 */
async function resolveTgConfig(
  db: ReturnType<typeof getDb>,
  bucketId: string,
  encKey: string
): Promise<TelegramBotConfig | null> {
  const bucket = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();
  if (!bucket || bucket.provider !== 'telegram') return null;
  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  return {
    botToken,
    chatId: bucket.bucketName,
    apiBase: bucket.endpoint || undefined,
  };
}

// ── POST /api/migrate/start ────────────────────────────────────────────────
app.post('/start', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = startMigrateSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.issues[0].message } },
      400
    );
  }

  const {
    sourceBucketId: rawSourceBucketId,
    targetBucketId,
    fileIds,
    targetFolderId: rawTargetFolderId,
    deleteSource,
  } = result.data;
  const targetFolderId = normalizeParentId(rawTargetFolderId);
  const db = getDb(c.env.DB);

  // ── 自动推断 sourceBucketId ────────────────────────────────────────────
  let sourceBucketId = rawSourceBucketId;
  if (!sourceBucketId && fileIds && fileIds.length > 0) {
    const sample = await db
      .select({ bucketId: files.bucketId })
      .from(files)
      .where(and(eq(files.id, fileIds[0]), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!sample?.bucketId) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '无法从指定文件推断来源存储桶' } },
        400
      );
    }
    sourceBucketId = sample.bucketId;
  }

  if (!sourceBucketId) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '必须提供 sourceBucketId 或 fileIds' } },
      400
    );
  }

  if (sourceBucketId === targetBucketId) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '来源和目标存储桶不能相同' } },
      400
    );
  }

  // 两个桶都必须属于当前用户且激活
  const [srcBucket, tgtBucket] = await Promise.all([
    db
      .select()
      .from(storageBuckets)
      .where(
        and(eq(storageBuckets.id, sourceBucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true))
      )
      .get(),
    db
      .select()
      .from(storageBuckets)
      .where(
        and(eq(storageBuckets.id, targetBucketId), eq(storageBuckets.userId, userId), eq(storageBuckets.isActive, true))
      )
      .get(),
  ]);

  if (!srcBucket) throwAppError('BUCKET_NOT_FOUND', '来源存储桶不存在或未激活');
  if (!tgtBucket) throwAppError('BUCKET_NOT_FOUND', '目标存储桶不存在或未激活');

  // 两个桶记录可能指向同一个物理桶：此时拷贝会覆盖自身，清理阶段会删掉唯一副本
  if (
    srcBucket.provider === tgtBucket.provider &&
    srcBucket.bucketName === tgtBucket.bucketName &&
    (srcBucket.endpoint ?? '') === (tgtBucket.endpoint ?? '')
  ) {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: '来源和目标指向同一个物理存储桶，无需迁移' },
      },
      400
    );
  }

  // 目标目录必须是当前用户未删除的文件夹
  if (targetFolderId) {
    const folder = await db
      .select({ id: files.id })
      .from(files)
      .where(
        and(eq(files.id, targetFolderId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt))
      )
      .get();
    if (!folder) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '目标文件夹不存在或无权访问' } },
        400
      );
    }
  }

  // ── 构建迁移清单 ───────────────────────────────────────────────────────
  const uniqueInputIds = fileIds && fileIds.length > 0 ? [...new Set(fileIds)] : null;
  let candidateIds: string[] | null = null;
  if (uniqueInputIds) {
    candidateIds = await collectFileIds(db, userId, uniqueInputIds, sourceBucketId);
  }

  const rows = await loadFileRows(db, userId, sourceBucketId, candidateIds);
  if (rows.length === 0) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '没有找到可迁移的文件' } },
      400
    );
  }

  const now = new Date().toISOString();
  const entries: MigrationEntry[] = rows.map((row) => ({
    fileId: row.id,
    fileName: row.name,
    r2Key: row.r2Key,
    size: row.size,
    mimeType: row.mimeType,
    status: 'pending',
  }));

  // 目标目录：只移动用户选中的顶层项
  let moveIds: string[] = [];
  if (targetFolderId && uniqueInputIds) {
    moveIds = await resolveTopLevelIds(db, userId, uniqueInputIds);
  }

  const migrationId = crypto.randomUUID();
  const status: MigrationStatus = {
    migrationId,
    userId,
    sourceBucketId,
    targetBucketId,
    targetFolderId: targetFolderId ?? null,
    deleteSource,
    scope: uniqueInputIds ? 'selection' : 'bucket',
    selectedIds: uniqueInputIds ?? undefined,
    moveIds,
    total: entries.length,
    done: 0,
    failed: 0,
    results: entries,
    phase: 'copying',
    status: 'running',
    startedAt: now,
    updatedAt: now,
  };

  await c.env.KV.put(kvKey(userId, migrationId), JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });

  return c.json({
    success: true,
    data: {
      migrationId,
      total: entries.length,
      status: 'running',
      message: `迁移任务已创建，共 ${entries.length} 个文件`,
    },
  });
});

// ── POST /api/migrate/:migrationId/run ─────────────────────────────────────
app.post('/:migrationId/run', async (c) => {
  const userId = c.get('userId')!;
  const migrationId = c.req.param('migrationId');
  const db = getDb(c.env.DB);

  const status = await runBatch(c.env, db, userId, getEncryptionKey(c.env), migrationId);
  if (!status) {
    throwAppError('MIGRATION_NOT_FOUND', '迁移任务不存在或已过期');
  }
  return c.json({ success: true, data: status });
});

// ── GET /api/migrate/:migrationId ──────────────────────────────────────────
app.get('/:migrationId', async (c) => {
  const userId = c.get('userId')!;
  const migrationId = c.req.param('migrationId');

  const raw = await c.env.KV.get(kvKey(userId, migrationId));
  if (!raw) {
    throwAppError('MIGRATION_NOT_FOUND', '迁移任务不存在或已过期');
  }

  return c.json({ success: true, data: JSON.parse(raw) });
});

// ── POST /api/migrate/:migrationId/cancel ──────────────────────────────────
app.post('/:migrationId/cancel', async (c) => {
  const userId = c.get('userId')!;
  const migrationId = c.req.param('migrationId');

  const raw = await c.env.KV.get(kvKey(userId, migrationId));
  if (!raw) {
    throwAppError('MIGRATION_NOT_FOUND', '迁移任务不存在或已过期');
  }

  const status: MigrationStatus = JSON.parse(raw);
  if (status.status !== 'running') {
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: `任务状态为 ${status.status}，无法取消` },
      },
      400
    );
  }

  status.status = 'cancelled';
  status.updatedAt = new Date().toISOString();
  await c.env.KV.put(kvKey(userId, migrationId), JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });

  return c.json({ success: true, data: { message: '迁移任务已取消（当前批次完成后停止）' } });
});

// ── Core runner ────────────────────────────────────────────────────────────

interface RuntimeContext {
  env: Env;
  db: ReturnType<typeof getDb>;
  userId: string;
  status: MigrationStatus;
  srcBucket: typeof storageBuckets.$inferSelect;
  tgtBucket: typeof storageBuckets.$inferSelect;
  srcS3: Awaited<ReturnType<typeof makeBucketConfigAsync>> | null;
  tgtS3: Awaited<ReturnType<typeof makeBucketConfigAsync>> | null;
  srcTg: TelegramBotConfig | null;
  tgtTg: TelegramBotConfig | null;
}

/**
 * 执行一个批次：按时间预算推进 copying / cleaning / moving 三个阶段。
 * 每次调用都从 KV 重新加载状态，天然可恢复、可重入。
 */
async function runBatch(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  encKey: string,
  migrationId: string
): Promise<MigrationStatus | null> {
  const kKey = kvKey(userId, migrationId);
  const raw = await env.KV.get(kKey);
  if (!raw) return null;

  const status: MigrationStatus = JSON.parse(raw);
  if (status.status !== 'running') return status;

  const [srcBucket, tgtBucket] = await Promise.all([
    db.select().from(storageBuckets).where(eq(storageBuckets.id, status.sourceBucketId)).get(),
    db.select().from(storageBuckets).where(eq(storageBuckets.id, status.targetBucketId)).get(),
  ]);

  if (!srcBucket || !tgtBucket) {
    status.status = 'failed';
    status.updatedAt = new Date().toISOString();
    await env.KV.put(kKey, JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });
    return status;
  }

  let ctx: RuntimeContext;
  try {
    ctx = {
      env,
      db,
      userId,
      status,
      srcBucket,
      tgtBucket,
      srcS3: srcBucket.provider !== 'telegram' ? await makeBucketConfigAsync(srcBucket, encKey, db) : null,
      tgtS3: tgtBucket.provider !== 'telegram' ? await makeBucketConfigAsync(tgtBucket, encKey, db) : null,
      srcTg: srcBucket.provider === 'telegram' ? await resolveTgConfig(db, status.sourceBucketId, encKey) : null,
      tgtTg: tgtBucket.provider === 'telegram' ? await resolveTgConfig(db, status.targetBucketId, encKey) : null,
    };
  } catch (err: any) {
    logger.error('MIGRATE', '存储桶配置解析失败', { migrationId }, err);
    status.status = 'failed';
    status.updatedAt = new Date().toISOString();
    await env.KV.put(kKey, JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });
    return status;
  }

  const deadline = Date.now() + BATCH_BUDGET_MS;
  let steps = 0;

  while (Date.now() < deadline) {
    const progressed = await advance(ctx);
    if (!progressed) break;
    steps++;
    // 每 20 步落一次进度，控制 KV 写入次数；条目处理是幂等的，中断重跑安全
    if (steps % 20 === 0) {
      status.updatedAt = new Date().toISOString();
      await env.KV.put(kKey, JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });
    }
  }

  status.updatedAt = new Date().toISOString();
  await env.KV.put(kKey, JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });
  return status;
}

/** 推进一步；返回 false 表示阶段切换后无事可做 */
async function advance(ctx: RuntimeContext): Promise<boolean> {
  const { status } = ctx;

  if (status.phase === 'copying') {
    const pending = status.results.find((r) => r.status === 'pending');
    if (!pending) {
      await transitionAfterCopy(ctx);
      return true;
    }
    await copyEntry(ctx, pending);
    return true;
  }

  if (status.phase === 'cleaning') {
    const keys = status.cleanupKeys ?? [];
    const done = status.cleanupDone ?? 0;
    if (done >= keys.length) {
      await transitionAfterCleanup(ctx);
      return true;
    }
    await cleanupSourceObject(ctx, keys[done]);
    status.cleanupDone = done + 1;
    return true;
  }

  if (status.phase === 'moving') {
    const ids = status.moveIds;
    const done = status.moveDone ?? 0;
    if (done >= ids.length) {
      await finish(ctx);
      return true;
    }
    const res = await serviceMoveFile(ctx.env, ctx.userId, ids[done], {
      targetParentId: status.targetFolderId,
    });
    if (!res.success) {
      logger.warn('MIGRATE', '迁移后移动目录失败', { fileId: ids[done], error: res.error });
    }
    status.moveDone = done + 1;
    return true;
  }

  return false;
}

/** 拷贝一条记录（目标为 S3 时按 r2Key 分组批量切换） */
async function copyEntry(ctx: RuntimeContext, entry: MigrationEntry): Promise<void> {
  const { db, status } = ctx;

  // 目标为 Telegram：ref 按 fileId 建立，r2Key 不能复用
  if (ctx.tgtBucket.provider === 'telegram') {
    try {
      // 重入保护：已切换成功则直接标记完成，避免重复上传
      const current = await db
        .select({ bucketId: files.bucketId })
        .from(files)
        .where(eq(files.id, entry.fileId))
        .get();
      if (current?.bucketId === status.targetBucketId) {
        entry.status = 'done';
        status.done++;
        return;
      }

      const newKey = await copyEntryToTelegram(ctx, entry);
      const now = new Date().toISOString();
      await db
        .update(files)
        .set({ bucketId: status.targetBucketId, r2Key: newKey, updatedAt: now })
        .where(and(eq(files.id, entry.fileId), eq(files.bucketId, status.sourceBucketId)));
      entry.status = 'done';
      status.done++;
    } catch (err: any) {
      entry.status = 'failed';
      entry.error = err?.message ?? '未知错误';
      status.failed++;
      logger.error('MIGRATE', '文件迁移失败', { fileId: entry.fileId }, err);
    }
    return;
  }

  // 目标为 S3：同一 r2Key 的多条记录共享一个物理对象，必须整组切换
  const group = status.results.filter((r) => r.status === 'pending' && r.r2Key === entry.r2Key);
  try {
    // 重入保护：该 key 下已无来源桶记录说明上一轮已完成，无需重复拷贝
    const remaining = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.r2Key, entry.r2Key), eq(files.bucketId, status.sourceBucketId)))
      .limit(1)
      .get();
    if (!remaining) {
      for (const item of group) item.status = 'done';
      status.done += group.length;
      return;
    }

    await copyObjectSameKey(ctx, entry);
    // 历史版本对象使用独立 key，必须一并拷贝到目标桶，否则切换后版本下载会 404
    await copyVersionObjects(ctx, group.map((item) => item.fileId));
    const now = new Date().toISOString();
    await db
      .update(files)
      .set({ bucketId: status.targetBucketId, updatedAt: now })
      .where(and(eq(files.r2Key, entry.r2Key), eq(files.bucketId, status.sourceBucketId)));
    for (const item of group) item.status = 'done';
    status.done += group.length;
  } catch (err: any) {
    const message = err?.message ?? '未知错误';
    for (const item of group) {
      item.status = 'failed';
      item.error = message;
    }
    status.failed += group.length;
    logger.error('MIGRATE', '文件迁移失败', { r2Key: entry.r2Key }, err);
  }
}

/** 打开来源对象，优先返回流，避免整文件进内存 */
async function openSourceStream(
  ctx: RuntimeContext,
  entry: MigrationEntry
): Promise<{ stream: ReadableStream | null; length: number }> {
  const { db, srcBucket, srcS3, srcTg } = ctx;

  if (srcBucket.provider === 'telegram') {
    if (!srcTg) throw new Error('来源 Telegram 配置无效');
    const ref = await db
      .select()
      .from(telegramFileRefs)
      .where(eq(telegramFileRefs.fileId, entry.fileId))
      .get();
    if (!ref) throw new Error('找不到 Telegram 文件引用');

    if (isChunkedFileId(ref.tgFileId)) {
      return { stream: await tgDownloadChunked(srcTg, ref.tgFileId, db), length: entry.size };
    }
    const resp = await tgDownloadFile(srcTg, ref.tgFileId);
    return {
      stream: resp.body ?? new Blob([]).stream(),
      length: Number(resp.headers.get('content-length')) || entry.size,
    };
  }

  if (!srcS3) throw new Error('来源存储配置无效');
  const resp = await s3Get(srcS3, entry.r2Key);
  return {
    stream: resp.body ?? new Blob([]).stream(),
    length: Number(resp.headers.get('content-length')) || entry.size,
  };
}

/** 同 key 拷贝到目标 S3 桶（流式，不落盘） */
async function copyObjectSameKey(ctx: RuntimeContext, entry: MigrationEntry): Promise<void> {
  const { tgtS3, userId, status } = ctx;
  if (!tgtS3) throw new Error('目标存储配置无效');

  const { stream, length } = await openSourceStream(ctx, entry);
  if (!stream) throw new Error('来源对象内容为空');

  await s3Put(
    tgtS3,
    entry.r2Key,
    stream,
    entry.mimeType ?? 'application/octet-stream',
    { userId, originalName: entry.fileName, migratedFrom: status.sourceBucketId },
    length
  );
}

/**
 * 拷贝历史版本对象（仅 S3 来源）。
 * 版本对象 key 与主对象不同，必须逐个复制；失败时整体迁移失败，
 * 保证不会出现「主对象已切换、版本仍留在旧桶」的破窗。
 */
async function copyVersionObjects(ctx: RuntimeContext, fileIds: string[]): Promise<void> {
  if (ctx.srcBucket.provider === 'telegram') return;
  const { db, tgtS3, userId, status } = ctx;
  if (!tgtS3) return;

  for (let i = 0; i < fileIds.length; i += D1_IN_CHUNK) {
    const versions = await db
      .select({ r2Key: fileVersions.r2Key, size: fileVersions.size, mimeType: fileVersions.mimeType })
      .from(fileVersions)
      .where(inArray(fileVersions.fileId, fileIds.slice(i, i + D1_IN_CHUNK)))
      .all();

    for (const version of versions) {
      const resp = await s3Get(ctx.srcS3!, version.r2Key);
      await s3Put(
        tgtS3,
        version.r2Key,
        resp.body ?? new Blob([]).stream(),
        version.mimeType ?? 'application/octet-stream',
        { userId, migratedFrom: status.sourceBucketId },
        Number(resp.headers.get('content-length')) || version.size
      );
    }
  }
}

/** 拷贝到 Telegram 桶，返回新的 r2Key；大文件保留内存上限 */
async function copyEntryToTelegram(ctx: RuntimeContext, entry: MigrationEntry): Promise<string> {
  const { db, tgtTg, userId, status } = ctx;
  if (!tgtTg) throw new Error('目标 Telegram 配置无效');

  const versionCount = await db
    .select({ id: fileVersions.id })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, entry.fileId))
    .limit(1)
    .get();
  if (versionCount) {
    throw new Error('该文件存在历史版本，暂不支持迁移到 Telegram 桶');
  }

  if (entry.size > MAX_BUFFERED_TRANSFER_BYTES) {
    throw new Error(`文件超过迁移单文件上限 ${MAX_BUFFERED_TRANSFER_BYTES / 1024 / 1024}MB`);
  }

  const { stream } = await openSourceStream(ctx, entry);
  if (!stream) throw new Error('来源对象内容为空');
  const buffer = await new Response(stream).arrayBuffer();

  const now = new Date().toISOString();
  let tgFileId: string;
  let tgFileSize: number;
  if (needsChunking(buffer.byteLength)) {
    const chunked = await tgUploadChunked(tgtTg, buffer, entry.fileName, entry.mimeType, db, status.targetBucketId);
    tgFileId = chunked.virtualFileId;
    tgFileSize = chunked.totalBytes;
  } else {
    const caption = `📁 ${entry.fileName}\n🗂 OSSshelf migrate | ${now.slice(0, 10)}`;
    const result = await tgUploadFile(tgtTg, buffer, entry.fileName, entry.mimeType, caption);
    tgFileId = result.fileId;
    tgFileSize = result.fileSize;
  }

  const newKey = `files/${userId}/${entry.fileId}/${encodeFilename(entry.fileName)}`;
  await db.insert(telegramFileRefs).values({
    id: crypto.randomUUID(),
    fileId: entry.fileId,
    r2Key: newKey,
    tgFileId,
    tgFileSize,
    bucketId: status.targetBucketId,
    createdAt: now,
  });
  return newKey;
}

/** 拷贝阶段结束后决定下一阶段 */
async function transitionAfterCopy(ctx: RuntimeContext): Promise<void> {
  const { status } = ctx;
  const doneKeys = [...new Set(status.results.filter((r) => r.status === 'done').map((r) => r.r2Key))];
  if (status.deleteSource && doneKeys.length > 0) {
    status.phase = 'cleaning';
    status.cleanupKeys = doneKeys;
    status.cleanupDone = 0;
    return;
  }
  await transitionAfterCleanup(ctx);
}

async function transitionAfterCleanup(ctx: RuntimeContext): Promise<void> {
  const { status } = ctx;
  if (status.targetFolderId && status.moveIds.length > 0) {
    // 文件夹的默认桶必须先在目录移动之前切换，
    // 否则 serviceMoveFile 会按旧 bucketId 判定为跨桶移动而拒绝执行。
    await syncFolderBuckets(ctx);
    status.phase = 'moving';
    status.moveDone = 0;
    return;
  }
  await finish(ctx);
}

/** 清理来源桶对象；仍被来源桶记录引用时跳过，避免误删共享对象 */
async function cleanupSourceObject(ctx: RuntimeContext, r2Key: string): Promise<void> {
  const { db, env, userId, status } = ctx;

  const stillReferenced = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.r2Key, r2Key), eq(files.bucketId, status.sourceBucketId)))
    .limit(1)
    .get();

  if (stillReferenced) {
    logger.warn('MIGRATE', '来源对象仍被记录引用，跳过清理', { r2Key });
    return;
  }

  await deleteObjectSafely(env, db, {
    userId,
    bucketId: status.sourceBucketId,
    parentId: null,
    r2Key,
    reason: 'migrate-source',
  });
}

/** 同步文件夹的默认桶（整桶迁移同步全部，局部迁移只同步选中项） */
async function syncFolderBuckets(ctx: RuntimeContext): Promise<void> {
  const { db, userId, status } = ctx;
  if (status.failed !== 0) return;

  const now = new Date().toISOString();
  if (status.scope === 'bucket') {
    await db
      .update(files)
      .set({ bucketId: status.targetBucketId, updatedAt: now })
      .where(and(eq(files.userId, userId), eq(files.bucketId, status.sourceBucketId), eq(files.isFolder, true)));
    return;
  }

  if (!status.selectedIds?.length) return;
  for (let i = 0; i < status.selectedIds.length; i += D1_IN_CHUNK) {
    await db
      .update(files)
      .set({ bucketId: status.targetBucketId, updatedAt: now })
      .where(
        and(
          eq(files.userId, userId),
          eq(files.bucketId, status.sourceBucketId),
          eq(files.isFolder, true),
          inArray(files.id, status.selectedIds.slice(i, i + D1_IN_CHUNK))
        )
      );
  }
}

async function finish(ctx: RuntimeContext): Promise<void> {
  await syncFolderBuckets(ctx);
  finishStatus(ctx.status);
}

function finishStatus(status: MigrationStatus): void {
  status.phase = 'completed';
  status.status = status.failed > 0 && status.done === 0 ? 'failed' : 'completed';
  status.updatedAt = new Date().toISOString();
}

export default app;
