/**
 * migrate.ts
 * 存储桶迁移路由
 *
 * 功能：
 * - 在不同存储桶之间迁移文件（跨 provider）
 * - 支持单文件迁移和文件夹（递归）迁移
 * - 流式拷贝：Worker 内 pipe s3Get → s3Put，不落盘
 * - 进度追踪：通过 KV 存储迁移状态，可中途查询
 * - 迁移完成后更新 files.bucketId / files.r2Key / bucket stats
 * - 幂等设计：同一 migrationId 重复调用安全
 *
 * 端点：
 * - POST /api/migrate/start           启动迁移任务
 * - GET  /api/migrate/:migrationId    查询迁移进度
 * - POST /api/migrate/:migrationId/cancel  取消迁移
 */

import { Hono } from 'hono';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { getDb, files, storageBuckets, telegramFileRefs, users } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES, logger } from '@osshelf/shared';
import { throwAppError } from '../middleware/error';
import { getEncryptionKey } from '../lib/crypto';
import { resolveBucketConfig, updateBucketStats } from '../lib/bucketResolver';
import { s3Get, s3Put, s3Delete, decryptSecret, makeBucketConfigAsync, type S3BucketConfig } from '../lib/s3client';
import { tgUploadFile, tgDownloadFile, type TelegramBotConfig } from '../lib/telegramClient';
import {
  isChunkedFileId,
  tgDownloadChunked,
  tgDeleteChunked,
  needsChunking,
  tgUploadChunked,
} from '../lib/telegramChunked';
import { encodeFilename } from '../lib/utils';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', authMiddleware);

// ── 迁移状态 KV Key 格式 ─────────────────────────────────────────────────
// kv key: "migrate:{userId}:{migrationId}"
// value: MigrationStatus JSON

interface MigrationStatus {
  migrationId: string;
  userId: string;
  sourceBucketId: string;
  targetBucketId: string;
  targetFolderId: string | null;
  /** 需要迁移的文件 ID 列表（不含文件夹自身） */
  fileIds: string[];
  total: number;
  done: number;
  failed: number;
  /** 每个文件的迁移结果 */
  results: Array<{
    fileId: string;
    fileName: string;
    status: 'pending' | 'done' | 'failed';
    error?: string;
    newR2Key?: string;
  }>;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
}

const KV_MIGRATE_TTL = 60 * 60 * 24 * 3; // 3 days

function kvKey(userId: string, migrationId: string) {
  return `migrate:${userId}:${migrationId}`;
}

// ── Validation schemas ─────────────────────────────────────────────────────

const startMigrateSchema = z.object({
  /** 来源存储桶 ID */
  sourceBucketId: z.string().min(1),
  /** 目标存储桶 ID */
  targetBucketId: z.string().min(1),
  /**
   * 要迁移的文件/文件夹 ID 列表。
   * 若传文件夹 ID，后端会递归展开其所有子文件。
   * 不传则迁移 sourceBucketId 下的全部文件。
   */
  fileIds: z.array(z.string()).optional(),
  /** 迁移后文件的目标父文件夹（null = 保持原 parentId） */
  targetFolderId: z.string().nullable().optional(),
  /** 是否在迁移成功后删除来源文件（相当于"移动"） */
  deleteSource: z.boolean().default(false),
});

// ── Helper: 递归收集文件夹下所有文件 ID ────────────────────────────────────
async function collectFileIds(db: ReturnType<typeof getDb>, userId: string, ids: string[]): Promise<string[]> {
  const result: string[] = [];
  const queue = [...ids];

  while (queue.length > 0) {
    const id = queue.shift()!;
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
    } else {
      result.push(row.id);
    }
  }
  return result;
}

// ── Helper: 收集 sourceBucketId 下所有文件 ID ──────────────────────────────
async function collectBucketFileIds(db: ReturnType<typeof getDb>, userId: string, bucketId: string): Promise<string[]> {
  const rows = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(eq(files.userId, userId), eq(files.bucketId, bucketId), eq(files.isFolder, false), isNull(files.deletedAt))
    )
    .all();
  return rows.map((r) => r.id);
}

// ── Helper: 解析 Telegram 桶配置 ──────────────────────────────────────────
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
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { sourceBucketId, targetBucketId, fileIds, targetFolderId, deleteSource } = result.data;
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  if (sourceBucketId === targetBucketId) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '来源和目标存储桶不能相同' } },
      400
    );
  }

  // 验证两个桶都属于当前用户且激活
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

  if (!srcBucket) {
    throwAppError('BUCKET_NOT_FOUND', '来源存储桶不存在或未激活');
  }
  if (!tgtBucket) {
    throwAppError('BUCKET_NOT_FOUND', '目标存储桶不存在或未激活');
  }

  // 收集需要迁移的文件 ID
  let targetFileIds: string[];
  if (fileIds && fileIds.length > 0) {
    targetFileIds = await collectFileIds(db, userId, fileIds);
  } else {
    targetFileIds = await collectBucketFileIds(db, userId, sourceBucketId);
  }

  if (targetFileIds.length === 0) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '没有找到可迁移的文件' } },
      400
    );
  }

  // 构建迁移状态
  const migrationId = crypto.randomUUID();
  const now = new Date().toISOString();

  // 获取文件名（用于状态显示）
  const fileRows = await db
    .select({ id: files.id, name: files.name })
    .from(files)
    .where(inArray(files.id, targetFileIds))
    .all();
  const fileNameMap = Object.fromEntries(fileRows.map((f) => [f.id, f.name]));

  const status: MigrationStatus = {
    migrationId,
    userId,
    sourceBucketId,
    targetBucketId,
    targetFolderId: targetFolderId ?? null,
    fileIds: targetFileIds,
    total: targetFileIds.length,
    done: 0,
    failed: 0,
    results: targetFileIds.map((id) => ({
      fileId: id,
      fileName: fileNameMap[id] ?? id,
      status: 'pending',
    })),
    status: 'running',
    startedAt: now,
    updatedAt: now,
  };

  await c.env.KV.put(kvKey(userId, migrationId), JSON.stringify(status), {
    expirationTtl: KV_MIGRATE_TTL,
  });

  // 使用 ctx.waitUntil 异步执行迁移，立即返回 migrationId
  c.executionCtx.waitUntil(runMigration(c.env, db, userId, encKey, migrationId, tgtBucket.provider, deleteSource));

  return c.json({
    success: true,
    data: {
      migrationId,
      total: targetFileIds.length,
      status: 'running',
      message: `迁移任务已启动，共 ${targetFileIds.length} 个文件`,
    },
  });
});

// ── GET /api/migrate/:migrationId ──────────────────────────────────────────
app.get('/:migrationId', async (c) => {
  const userId = c.get('userId')!;
  const migrationId = c.req.param('migrationId');

  const raw = await c.env.KV.get(kvKey(userId, migrationId));
  if (!raw) {
    throwAppError('MIGRATION_NOT_FOUND', '迁移任务不存在或已过期');
  }

  const status: MigrationStatus = JSON.parse(raw);
  return c.json({ success: true, data: status });
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
  await c.env.KV.put(kvKey(userId, migrationId), JSON.stringify(status), {
    expirationTtl: KV_MIGRATE_TTL,
  });

  return c.json({ success: true, data: { message: '迁移任务已取消（进行中的文件会完成当前传输后停止）' } });
});

// ── Core migration runner ──────────────────────────────────────────────────
/**
 * 在 waitUntil 中执行的实际迁移逻辑。
 * 逐文件拷贝：读取来源 → 写入目标 → 更新 files 表 → 更新 bucket stats。
 * 每完成一个文件都写 KV 状态，支持前端轮询进度。
 */
async function runMigration(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  encKey: string,
  migrationId: string,
  targetProvider: string,
  deleteSource: boolean
): Promise<void> {
  const kKey = kvKey(userId, migrationId);
  const raw = await env.KV.get(kKey);
  if (!raw) return;

  const status: MigrationStatus = JSON.parse(raw);

  // 预加载桶配置
  const srcBucketRow = await db.select().from(storageBuckets).where(eq(storageBuckets.id, status.sourceBucketId)).get();
  const tgtBucketRow = await db.select().from(storageBuckets).where(eq(storageBuckets.id, status.targetBucketId)).get();

  if (!srcBucketRow || !tgtBucketRow) {
    status.status = 'failed';
    status.updatedAt = new Date().toISOString();
    await env.KV.put(kKey, JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });
    return;
  }

  const srcS3 = srcBucketRow.provider !== 'telegram' ? await makeBucketConfigAsync(srcBucketRow, encKey, db) : null;
  const tgtS3 = tgtBucketRow.provider !== 'telegram' ? await makeBucketConfigAsync(tgtBucketRow, encKey, db) : null;
  const srcTg = srcBucketRow.provider === 'telegram' ? await resolveTgConfig(db, status.sourceBucketId, encKey) : null;
  const tgtTg = tgtBucketRow.provider === 'telegram' ? await resolveTgConfig(db, status.targetBucketId, encKey) : null;

  for (let i = 0; i < status.results.length; i++) {
    const entry = status.results[i];
    if (entry.status !== 'pending') continue;

    // 检查是否被取消
    const freshRaw = await env.KV.get(kKey);
    if (freshRaw) {
      const fresh: MigrationStatus = JSON.parse(freshRaw);
      if (fresh.status === 'cancelled') return;
    }

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, entry.fileId), isNull(files.deletedAt)))
      .get();

    if (!file) {
      entry.status = 'failed';
      entry.error = '文件不存在或已被删除';
      status.failed++;
      status.updatedAt = new Date().toISOString();
      await env.KV.put(kKey, JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });
      continue;
    }

    try {
      // Step 1: 从来源读取文件内容
      let fileBuffer: ArrayBuffer;

      if (srcBucketRow.provider === 'telegram') {
        // Telegram → 其他
        if (!srcTg) throw new Error('来源 Telegram 配置无效');
        const ref = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id)).get();
        if (!ref) throw new Error('找不到 Telegram 文件引用');

        if (isChunkedFileId(ref.tgFileId)) {
          const stream = await tgDownloadChunked(srcTg, ref.tgFileId, db);
          const reader = stream.getReader();
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const out = new Uint8Array(total);
          let pos = 0;
          for (const c of chunks) {
            out.set(c, pos);
            pos += c.length;
          }
          fileBuffer = out.buffer;
        } else {
          const resp = await tgDownloadFile(srcTg, ref.tgFileId);
          fileBuffer = await resp.arrayBuffer();
        }
      } else if (srcS3) {
        const resp = await s3Get(srcS3, file.r2Key);
        fileBuffer = await resp.arrayBuffer();
      } else if (env.FILES) {
        const obj = await env.FILES.get(file.r2Key);
        if (!obj) throw new Error('在 legacy R2 binding 中找不到文件');
        fileBuffer = await obj.arrayBuffer();
      } else {
        throw new Error('来源存储配置无效');
      }

      // Step 2: 写入目标存储
      const newFileId = crypto.randomUUID();
      const newR2Key = `files/${userId}/${newFileId}/${encodeFilename(file.name)}`;
      const now = new Date().toISOString();

      if (tgtBucketRow.provider === 'telegram') {
        // 其他 → Telegram
        if (!tgtTg) throw new Error('目标 Telegram 配置无效');
        let tgFileId: string;
        let tgFileSize: number;
        if (needsChunking(fileBuffer.byteLength)) {
          const chunked = await tgUploadChunked(tgtTg, fileBuffer, file.name, file.mimeType, db, status.targetBucketId);
          tgFileId = chunked.virtualFileId;
          tgFileSize = chunked.totalBytes;
        } else {
          const caption = `📁 ${file.name}\n🗂 OSSshelf migrate | ${now.slice(0, 10)}`;
          const result = await tgUploadFile(tgtTg, fileBuffer, file.name, file.mimeType, caption);
          tgFileId = result.fileId;
          tgFileSize = result.fileSize;
        }
        await db.insert(telegramFileRefs).values({
          id: crypto.randomUUID(),
          fileId: newFileId,
          r2Key: newR2Key,
          tgFileId,
          tgFileSize,
          bucketId: status.targetBucketId,
          createdAt: now,
        });
      } else if (tgtS3) {
        await s3Put(tgtS3, newR2Key, fileBuffer, file.mimeType ?? 'application/octet-stream', {
          userId,
          originalName: file.name,
          migratedFrom: status.sourceBucketId,
        });
      } else {
        throw new Error('目标存储配置无效');
      }

      // Step 3: 插入新 files 记录（保持原 parentId 或使用 targetFolderId）
      const newParentId = status.targetFolderId ?? file.parentId;
      const newPath = newParentId ? `${newParentId}/${file.name}` : `/${file.name}`;

      await db.insert(files).values({
        id: newFileId,
        userId,
        parentId: newParentId,
        name: file.name,
        path: newPath,
        type: 'file',
        size: file.size,
        r2Key: newR2Key,
        mimeType: file.mimeType,
        hash: file.hash,
        refCount: 1,
        isFolder: false,
        bucketId: status.targetBucketId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });

      // Step 4: 更新目标桶统计
      await updateBucketStats(db, status.targetBucketId, file.size, 1);

      // Step 5: 如果是"移动"模式，删除来源
      if (deleteSource) {
        try {
          if (srcBucketRow.provider === 'telegram') {
            // 删除 Telegram 引用记录（物理文件在 Telegram 服务器不可删除）
            const srcRef = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id)).get();
            if (srcRef && isChunkedFileId(srcRef.tgFileId)) {
              await tgDeleteChunked(db, srcRef.tgFileId);
            }
            await db.delete(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id));
          } else if (srcS3) {
            await s3Delete(srcS3, file.r2Key);
          } else if (env.FILES) {
            await env.FILES.delete(file.r2Key);
          }
          // 更新来源桶统计
          await updateBucketStats(db, status.sourceBucketId, -file.size, -1);
          // 软删除原文件记录
          await db.update(files).set({ deletedAt: now, updatedAt: now }).where(eq(files.id, file.id));
        } catch (delErr) {
          logger.warn('MIGRATE', '删除源文件失败', { fileId: file.id }, delErr);
        }
      }

      entry.status = 'done';
      entry.newR2Key = newR2Key;
      status.done++;
    } catch (err: any) {
      entry.status = 'failed';
      entry.error = err?.message ?? '未知错误';
      status.failed++;
      logger.error('MIGRATE', '文件迁移失败', { fileId: file.id }, err);
    }

    status.updatedAt = new Date().toISOString();
    await env.KV.put(kKey, JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });
  }

  // 所有文件处理完毕
  status.status = status.failed > 0 && status.done === 0 ? 'failed' : 'completed';
  status.updatedAt = new Date().toISOString();
  await env.KV.put(kKey, JSON.stringify(status), { expirationTtl: KV_MIGRATE_TTL });
}

export default app;
