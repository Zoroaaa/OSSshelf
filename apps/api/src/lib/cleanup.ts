/**
 * cleanup.ts
 * 定时清理任务逻辑
 * 
 * 功能:
 * - 回收站过期文件清理
 * - 过期会话清理
 * - 过期分享清理
 * - 过期上传任务清理
 */

import { eq, and, isNotNull, lt } from 'drizzle-orm';
import { getDb, files, users, shares, webdavSessions, uploadTasks, loginAttempts } from '../db';
import { TRASH_RETENTION_DAYS } from '@osshelf/shared';
import type { Env } from '../types/env';
import { s3Delete, s3AbortMultipartUpload } from './s3client';
import { resolveBucketConfig, updateBucketStats } from './bucketResolver';

interface CleanupResult {
  trash: {
    deletedCount: number;
    freedBytes: number;
  };
  sessions: {
    webdavSessionsCleaned: number;
    uploadTasksExpired: number;
    loginAttemptsCleaned: number;
  };
  shares: {
    sharesCleaned: number;
  };
}

export async function runAllCleanupTasks(env: Env): Promise<CleanupResult> {
  const db = getDb(env.DB);
  const encKey = env.JWT_SECRET || 'ossshelf-key';

  const result: CleanupResult = {
    trash: { deletedCount: 0, freedBytes: 0 },
    sessions: { webdavSessionsCleaned: 0, uploadTasksExpired: 0, loginAttemptsCleaned: 0 },
    shares: { sharesCleaned: 0 },
  };

  try {
    result.trash = await runTrashCleanup(db, env, encKey);
  } catch (error) {
    console.error('Trash cleanup failed:', error);
  }

  try {
    result.sessions = await runSessionCleanup(db, encKey);
  } catch (error) {
    console.error('Session cleanup failed:', error);
  }

  try {
    result.shares = await runShareCleanup(db);
  } catch (error) {
    console.error('Share cleanup failed:', error);
  }

  return result;
}

async function runTrashCleanup(
  db: ReturnType<typeof getDb>,
  env: Env,
  encKey: string
): Promise<{ deletedCount: number; freedBytes: number }> {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - TRASH_RETENTION_DAYS);
  const threshold = retentionDate.toISOString();

  const expiredFiles = await db.select().from(files)
    .where(and(
      isNotNull(files.deletedAt),
      lt(files.deletedAt, threshold)
    ))
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
      await db.update(users)
        .set({
          storageUsed: Math.max(0, user.storageUsed - freedSize),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId));
    }
  }

  console.log(`Trash cleanup: ${deletedCount} files deleted, ${(freedBytes / 1024 / 1024).toFixed(2)} MB freed`);

  return { deletedCount, freedBytes };
}

async function runSessionCleanup(
  db: ReturnType<typeof getDb>,
  encKey: string
): Promise<{ webdavSessionsCleaned: number; uploadTasksExpired: number; loginAttemptsCleaned: number }> {
  const now = new Date().toISOString();

  const expiredWebdav = await db.delete(webdavSessions)
    .where(lt(webdavSessions.expiresAt, now))
    .returning({ id: webdavSessions.id });

  const expiredUploadTasks = await db.select().from(uploadTasks)
    .where(and(
      lt(uploadTasks.expiresAt, now),
      eq(uploadTasks.status, 'pending')
    ))
    .all();

  for (const task of expiredUploadTasks) {
    try {
      const bucketConfig = await resolveBucketConfig(db, task.userId, encKey, task.bucketId, null);
      if (bucketConfig) {
        await s3AbortMultipartUpload(bucketConfig, task.r2Key, task.uploadId);
      }
    } catch (e) {
      console.error('Failed to abort expired upload:', e);
    }
    await db.update(uploadTasks)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(uploadTasks.id, task.id));
  }

  const oldLoginAttempts = await db.delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()))
    .returning({ id: loginAttempts.id });

  console.log(`Session cleanup: ${expiredWebdav.length} webdav sessions, ${expiredUploadTasks.length} upload tasks, ${oldLoginAttempts.length} login attempts`);

  return {
    webdavSessionsCleaned: expiredWebdav.length,
    uploadTasksExpired: expiredUploadTasks.length,
    loginAttemptsCleaned: oldLoginAttempts.length,
  };
}

async function runShareCleanup(db: ReturnType<typeof getDb>): Promise<{ sharesCleaned: number }> {
  const now = new Date().toISOString();

  const expiredShares = await db.delete(shares)
    .where(lt(shares.expiresAt, now))
    .returning({ id: shares.id });

  console.log(`Share cleanup: ${expiredShares.length} expired shares removed`);

  return { sharesCleaned: expiredShares.length };
}
