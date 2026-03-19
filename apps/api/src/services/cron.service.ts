/**
 * cron.service.ts
 * 定时任务业务逻辑服务
 *
 * 功能:
 * - 回收站自动清理
 * - 会话/设备自动清理
 * - 分享链接过期清理
 * - 全量清理任务
 */

import { eq, and, isNotNull, lt } from 'drizzle-orm';
import { getDb, files, users, shares, webdavSessions, uploadTasks, loginAttempts, userDevices, storageBuckets } from '../db';
import { TRASH_RETENTION_DAYS, DEVICE_SESSION_EXPIRY } from '@osshelf/shared';
import { s3Delete } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats } from '../lib/bucketResolver';
import { getEncryptionKey } from '../lib/crypto';
import type { Env } from '../types/env';

export async function runTrashCleanup(env: Env, db: ReturnType<typeof getDb>) {
  const encKey = getEncryptionKey(env);

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
      } else if (env.FILES) {
        await env.FILES.delete(file.r2Key);
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
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      await db
        .update(users)
        .set({
          storageUsed: Math.max(0, user.storageUsed - freedSize),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId));
    }
  }

  console.log(
    `Trash cleanup completed: ${deletedCount} files deleted, ${(freedBytes / 1024 / 1024).toFixed(2)} MB freed`
  );

  return {
    deletedCount,
    freedBytes,
    message: `已清理 ${deletedCount} 个过期文件，释放 ${(freedBytes / 1024 / 1024).toFixed(2)} MB 空间`,
  };
}

export async function runSessionCleanup(env: Env, db: ReturnType<typeof getDb>) {
  const now = new Date().toISOString();

  const expiredWebdav = await db
    .delete(webdavSessions)
    .where(lt(webdavSessions.expiresAt, now))
    .returning({ id: webdavSessions.id });

  const expiredUploadTasks = await db
    .select()
    .from(uploadTasks)
    .where(and(lt(uploadTasks.expiresAt, now), eq(uploadTasks.status, 'pending')))
    .all();

  for (const task of expiredUploadTasks) {
    const bucketConfig = await resolveBucketConfig(db, task.userId, getEncryptionKey(env), task.bucketId, null);
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

  return {
    webdavSessionsCleaned: expiredWebdav.length,
    uploadTasksExpired: expiredUploadTasks.length,
    loginAttemptsCleaned: oldLoginAttempts.length,
    devicesCleaned: expiredDevices.length,
  };
}

export async function runShareCleanup(db: ReturnType<typeof getDb>) {
  const now = new Date().toISOString();

  const expiredShares = await db
    .delete(shares)
    .where(and(isNotNull(shares.expiresAt), lt(shares.expiresAt, now)))
    .returning({ id: shares.id });

  return {
    sharesCleaned: expiredShares.length,
  };
}

export async function runAllCleanupTasks(env: Env, db: ReturnType<typeof getDb>) {
  const results = {
    trash: null as unknown,
    sessions: null as unknown,
    shares: null as unknown,
  };

  try {
    const trashResult = await runTrashCleanup(env, db);
    results.trash = trashResult;
  } catch (e) {
    results.trash = { error: String(e) };
  }

  try {
    const sessionResult = await runSessionCleanup(env, db);
    results.sessions = sessionResult;
  } catch (e) {
    results.sessions = { error: String(e) };
  }

  try {
    const shareResult = await runShareCleanup(db);
    results.shares = shareResult;
  } catch (e) {
    results.shares = { error: String(e) };
  }

  return results;
}
