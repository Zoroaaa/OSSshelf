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
import { eq, and, isNotNull, lt } from 'drizzle-orm';
import { getDb, files, users, shares, webdavSessions, uploadTasks, loginAttempts, userDevices } from '../db';
import { TRASH_RETENTION_DAYS, DEVICE_SESSION_EXPIRY, ERROR_CODES } from '@osshelf/shared';
import type { Env } from '../types/env';
import { s3Delete } from '../lib/s3client';
import { resolveBucketConfig, updateBucketStats } from '../lib/bucketResolver';
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

  return c.json({
    success: true,
    data: {
      deletedCount,
      freedBytes,
      message: `已清理 ${deletedCount} 个过期文件，释放 ${(freedBytes / 1024 / 1024).toFixed(2)} MB 空间`,
    },
  });
});

app.post('/cron/session-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  // 清理过期 WebDAV sessions
  const expiredWebdav = await db
    .delete(webdavSessions)
    .where(lt(webdavSessions.expiresAt, now))
    .returning({ id: webdavSessions.id });

  // 清理过期上传任务
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

  // 清理过期登录记录（保留 30 天）
  const oldLoginAttempts = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()))
    .returning({ id: loginAttempts.id });

  // 修复：清理超过 DEVICE_SESSION_EXPIRY（30天）未活跃的登录设备。
  // 原逻辑写在 GET /api/auth/devices 里（阈值写死为 7 天），每次查列表时静默删除，
  // 导致前端缓存持有的 deviceId 失效后点注销返回 404。
  // 现统一在此处清理，使用 shared 常量保证与 auth.ts 中 DEVICE_SESSION_EXPIRY 语义一致。
  const deviceExpiryThreshold = new Date(Date.now() - DEVICE_SESSION_EXPIRY).toISOString();
  const expiredDevices = await db
    .delete(userDevices)
    .where(lt(userDevices.lastActive, deviceExpiryThreshold))
    .returning({ id: userDevices.id });

  return c.json({
    success: true,
    data: {
      webdavSessionsCleaned: expiredWebdav.length,
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

app.post('/cron/all', async (c) => {
  const results = {
    trash: null as unknown,
    sessions: null as unknown,
    shares: null as unknown,
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

  return c.json({
    success: true,
    data: results,
  });
});

export default app;
