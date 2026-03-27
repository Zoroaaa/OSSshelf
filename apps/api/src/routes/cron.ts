/**
 * cron.ts
 * 定时任务路由
 *
 * 功能:
 * - 回收站自动清理
 * - 会话/设备自动清理
 * - 分享链接过期清理
 * - 全量清理任务
 */

import { Hono } from 'hono';
import { eq, and, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { getDb, files, users, shares, uploadTasks, loginAttempts, userDevices, fileVersions } from '../db';
import { TRASH_RETENTION_DAYS, DEVICE_SESSION_EXPIRY, ERROR_CODES } from '@osshelf/shared';
import type { Env } from '../types/env';
import { s3Delete } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats, updateUserStorage } from '../lib/bucketResolver';
import { getEncryptionKey } from '../lib/crypto';

const app = new Hono<{ Bindings: Env }>();

app.post('/cron/trash-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);

  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - TRASH_RETENTION_DAYS);
  const threshold = retentionDate.toISOString();

  const expiredFiles = await db
    .select()
    .from(files)
    .where(and(isNotNull(files.deletedAt), lt(files.deletedAt, threshold)))
    .all();

  let deletedCount = 0;
  let freedBytes = 0;
  const userStorageChanges: Map<string, number> = new Map();

  for (const file of expiredFiles) {
    if (!file.isFolder) {
      try {
        const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);
        if (bucketConfig) {
          await s3Delete(bucketConfig, file.r2Key);
          await updateBucketStats(db, bucketConfig.id, -file.size, -1);
        } else if (c.env.FILES) {
          await c.env.FILES.delete(file.r2Key);
        }

        const currentChange = userStorageChanges.get(file.userId) || 0;
        userStorageChanges.set(file.userId, currentChange + file.size);
        freedBytes += file.size;
      } catch (error) {
        console.error(`Failed to delete file ${file.id}:`, error);
        continue;
      }
    }

    await db.delete(files).where(eq(files.id, file.id));
    deletedCount++;
  }

  for (const [userId, freedSize] of userStorageChanges) {
    await updateUserStorage(db, userId, -freedSize);
  }

  // ── 清理过期直链 token ────────────────────────────────────────────────
  const now = new Date().toISOString();
  const expiredDirectLinks = await db
    .update(files)
    .set({ directLinkToken: null, directLinkExpiresAt: null })
    .where(
      and(isNotNull(files.directLinkToken), isNotNull(files.directLinkExpiresAt), lt(files.directLinkExpiresAt, now))
    )
    .returning({ id: files.id });

  console.log(
    `Trash cleanup completed: ${deletedCount} files deleted, ${(freedBytes / 1024 / 1024).toFixed(2)} MB freed, ${expiredDirectLinks.length} direct links expired`
  );

  return c.json({
    success: true,
    data: {
      deletedCount,
      freedBytes,
      expiredDirectLinks: expiredDirectLinks.length,
      message: `已清理 ${deletedCount} 个过期文件，释放 ${(freedBytes / 1024 / 1024).toFixed(2)} MB 空间，清除 ${expiredDirectLinks.length} 个过期直链`,
    },
  });
});

app.post('/cron/session-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const expiredUploadTasks = await db
    .select()
    .from(uploadTasks)
    .where(and(lt(uploadTasks.expiresAt, now), eq(uploadTasks.status, 'pending')))
    .all();

  for (const task of expiredUploadTasks) {
    const bucketConfig = await resolveBucketConfig(db, task.userId, getEncryptionKey(c.env), task.bucketId, null);
    if (bucketConfig) {
      try {
        const { s3AbortMultipartUpload } = await import('../lib/s3client');
        await s3AbortMultipartUpload(bucketConfig, task.r2Key, task.uploadId);
      } catch (e) {
        console.error('Failed to abort expired upload:', e);
      }
    }
    await db.update(uploadTasks).set({ status: 'expired', updatedAt: now }).where(eq(uploadTasks.id, task.id));
  }

  const oldLoginAttempts = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()))
    .returning({ id: loginAttempts.id });

  const deviceExpiryThreshold = new Date(Date.now() - DEVICE_SESSION_EXPIRY).toISOString();
  const expiredDevices = await db
    .delete(userDevices)
    .where(lt(userDevices.lastActive, deviceExpiryThreshold))
    .returning({ id: userDevices.id });

  return c.json({
    success: true,
    data: {
      uploadTasksExpired: expiredUploadTasks.length,
      loginAttemptsCleaned: oldLoginAttempts.length,
      devicesCleaned: expiredDevices.length,
    },
  });
});

app.post('/cron/share-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  const expiredShares = await db
    .delete(shares)
    .where(and(isNotNull(shares.expiresAt), lt(shares.expiresAt, now)))
    .returning({ id: shares.id });

  return c.json({
    success: true,
    data: {
      sharesCleaned: expiredShares.length,
    },
  });
});

// ── Version cleanup ────────────────────────────────────────────────────────
app.post('/cron/version-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const encKey = getEncryptionKey(c.env);
  const now = new Date().toISOString();

  let deletedVersions = 0;
  let errors = 0;

  // 1. 按保留天数清理过期版本
  const retentionExpired = await db
    .select({
      vId: fileVersions.id,
      vR2Key: fileVersions.r2Key,
      vRefCount: fileVersions.refCount,
      fId: files.id,
      fR2Key: files.r2Key,
      fBucketId: files.bucketId,
      fUserId: files.userId,
      fCurrentVersion: files.currentVersion,
      fVersion: fileVersions.version,
      fRetentionDays: files.versionRetentionDays,
      fCreatedAt: fileVersions.createdAt,
    })
    .from(fileVersions)
    .innerJoin(files, eq(fileVersions.fileId, files.id))
    .all();

  // Group by fileId to apply per-file maxVersions limit and retention days
  const byFile = new Map<string, typeof retentionExpired>();
  for (const row of retentionExpired) {
    const arr = byFile.get(row.fId) ?? [];
    arr.push(row);
    byFile.set(row.fId, arr);
  }

  for (const [, versionRows] of byFile) {
    const file = versionRows[0];
    const retentionMs = (file.fRetentionDays ?? 30) * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    const currentVersion = file.fCurrentVersion ?? 1;

    for (const row of versionRows) {
      // Skip current version — never delete it via cron
      if (row.fVersion === currentVersion) continue;

      const isExpiredByTime = row.fCreatedAt < cutoff;
      if (!isExpiredByTime) continue;

      // Only delete physical object if this version has its own unique r2Key
      const isUniqueKey = row.vR2Key !== file.fR2Key && row.vRefCount <= 1;

      try {
        await db.delete(fileVersions).where(eq(fileVersions.id, row.vId));

        if (isUniqueKey) {
          const bucketConfig = await resolveBucketConfig(db, file.fUserId, encKey, file.fBucketId);
          if (bucketConfig) {
            await s3Delete(bucketConfig, row.vR2Key).catch(() => {});
          } else if (c.env.FILES) {
            await (c.env.FILES as R2Bucket).delete(row.vR2Key).catch(() => {});
          }
        }
        deletedVersions++;
      } catch (e) {
        console.error(`Version cleanup failed for version ${row.vId}:`, e);
        errors++;
      }
    }
  }

  console.log(`Version cleanup: ${deletedVersions} versions deleted, ${errors} errors`);

  return c.json({
    success: true,
    data: {
      deletedVersions,
      errors,
      message: `已清理 ${deletedVersions} 个过期版本`,
    },
  });
});

app.post('/cron/all', async (c) => {
  const results = {
    trash: null as unknown,
    sessions: null as unknown,
    shares: null as unknown,
    versions: null as unknown,
  };

  try {
    const trashRes = await fetch(new URL('/cron/trash-cleanup', c.req.url), {
      method: 'POST',
      headers: c.req.raw.headers,
    });
    results.trash = await trashRes.json();
  } catch (e) {
    results.trash = { error: String(e) };
  }

  try {
    const sessionRes = await fetch(new URL('/cron/session-cleanup', c.req.url), {
      method: 'POST',
      headers: c.req.raw.headers,
    });
    results.sessions = await sessionRes.json();
  } catch (e) {
    results.sessions = { error: String(e) };
  }

  try {
    const shareRes = await fetch(new URL('/cron/share-cleanup', c.req.url), {
      method: 'POST',
      headers: c.req.raw.headers,
    });
    results.shares = await shareRes.json();
  } catch (e) {
    results.shares = { error: String(e) };
  }

  try {
    const versionRes = await fetch(new URL('/cron/version-cleanup', c.req.url), {
      method: 'POST',
      headers: c.req.raw.headers,
    });
    results.versions = await versionRes.json();
  } catch (e) {
    results.versions = { error: String(e) };
  }

  return c.json({
    success: true,
    data: results,
  });
});

export default app;
