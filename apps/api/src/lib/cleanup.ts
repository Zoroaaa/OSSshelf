/**
 * cleanup.ts
 * 定时清理任务逻辑
 *
 * 功能:
 * - 回收站过期文件清理
 * - 过期会话/设备清理
 * - 过期分享清理
 * - 过期上传任务清理
 * - cron 执行结果 Telegram 告警
 */

import { eq, and, isNotNull, lt } from 'drizzle-orm';
import { getDb, files, users, shares, uploadTasks, loginAttempts, userDevices, auditLogs } from '../db';
import { TRASH_RETENTION_DAYS, DEVICE_SESSION_EXPIRY } from '@osshelf/shared';
import type { Env } from '../types/env';
import { s3Delete, s3AbortMultipartUpload } from './s3client';
import { resolveBucketConfig, updateBucketStats } from './bucketResolver';
import { getEncryptionKey } from './crypto';

interface CleanupResult {
  trash: {
    deletedCount: number;
    freedBytes: number;
  };
  sessions: {
    uploadTasksExpired: number;
    loginAttemptsCleaned: number;
    devicesCleaned: number;
  };
  shares: {
    sharesCleaned: number;
  };
  audit: {
    cleaned: number;
  };
}

/**
 * 向 Telegram 发送 cron 执行告警。
 * 需要在环境变量中配置 ALERT_TG_BOT_TOKEN 和 ALERT_TG_CHAT_ID。
 * 任意一项缺失则静默跳过（不影响主流程）。
 */
async function sendCronAlert(env: Env, message: string): Promise<void> {
  const botToken = (env as any).ALERT_TG_BOT_TOKEN as string | undefined;
  const chatId = (env as any).ALERT_TG_CHAT_ID as string | undefined;
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('[CronAlert] Failed to send Telegram notification:', e);
  }
}

export async function runAllCleanupTasks(env: Env): Promise<CleanupResult> {
  const db = getDb(env.DB);
  const encKey = getEncryptionKey(env);
  const startedAt = new Date().toISOString();

  const result: CleanupResult = {
    trash: { deletedCount: 0, freedBytes: 0 },
    sessions: { uploadTasksExpired: 0, loginAttemptsCleaned: 0, devicesCleaned: 0 },
    shares: { sharesCleaned: 0 },
    audit: { cleaned: 0 },
  };

  const failures: string[] = [];

  try {
    result.trash = await runTrashCleanup(db, env, encKey);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Trash cleanup failed:', error);
    failures.push(`回收站清理: ${msg}`);
  }

  try {
    result.sessions = await runSessionCleanup(db, encKey);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Session cleanup failed:', error);
    failures.push(`会话清理: ${msg}`);
  }

  try {
    result.shares = await runShareCleanup(db);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Share cleanup failed:', error);
    failures.push(`分享清理: ${msg}`);
  }

  try {
    result.audit = await runAuditLogCleanup(db, env);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Audit log cleanup failed:', error);
    failures.push(`审计日志清理: ${msg}`);
  }

  // 发送 Telegram 告警
  if (failures.length > 0) {
    const alertMsg =
      `⚠️ <b>OSSshelf Cron 告警</b>\n` +
      `时间：${startedAt}\n` +
      `失败任务（${failures.length}/${4}）：\n` +
      failures.map((f) => `• ${f}`).join('\n');
    await sendCronAlert(env, alertMsg);
  } else {
    const mb = (result.trash.freedBytes / 1024 / 1024).toFixed(2);
    const summaryMsg =
      `✅ <b>OSSshelf Cron 完成</b>\n` +
      `时间：${startedAt}\n` +
      `• 回收站：删除 ${result.trash.deletedCount} 文件，释放 ${mb} MB\n` +
      `• 会话：清理 ${result.sessions.uploadTasksExpired} 上传任务，${result.sessions.devicesCleaned} 设备\n` +
      `• 分享：清理 ${result.shares.sharesCleaned} 条\n` +
      `• 审计日志：清理 ${result.audit.cleaned} 条`;
    await sendCronAlert(env, summaryMsg);
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

  console.log(`Trash cleanup: ${deletedCount} files deleted, ${(freedBytes / 1024 / 1024).toFixed(2)} MB freed`);

  return { deletedCount, freedBytes };
}

async function runSessionCleanup(
  db: ReturnType<typeof getDb>,
  encKey: string
): Promise<{
  uploadTasksExpired: number;
  loginAttemptsCleaned: number;
  devicesCleaned: number;
}> {
  const now = new Date().toISOString();

  const expiredUploadTasks = await db
    .select()
    .from(uploadTasks)
    .where(and(lt(uploadTasks.expiresAt, now), eq(uploadTasks.status, 'pending')))
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

  console.log(
    `Session cleanup: ${expiredUploadTasks.length} upload tasks, ` +
      `${oldLoginAttempts.length} login attempts, ` +
      `${expiredDevices.length} inactive devices`
  );

  return {
    uploadTasksExpired: expiredUploadTasks.length,
    loginAttemptsCleaned: oldLoginAttempts.length,
    devicesCleaned: expiredDevices.length,
  };
}

async function runShareCleanup(db: ReturnType<typeof getDb>): Promise<{ sharesCleaned: number }> {
  const now = new Date().toISOString();

  // 只删除有明确过期时间且已过期的分享（NULL 表示永不过期）
  const expiredShares = await db
    .delete(shares)
    .where(and(isNotNull(shares.expiresAt), lt(shares.expiresAt, now)))
    .returning({ id: shares.id });

  console.log(`Share cleanup: ${expiredShares.length} expired shares removed`);

  return { sharesCleaned: expiredShares.length };
}

async function runAuditLogCleanup(db: ReturnType<typeof getDb>, env: Env): Promise<{ cleaned: number }> {
  // 默认保留 90 天，通过 AUDIT_RETENTION_DAYS env var 配置
  const retentionDays = parseInt((env as any).AUDIT_RETENTION_DAYS || '90', 10);
  const threshold = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

  const deleted = await db.delete(auditLogs).where(lt(auditLogs.createdAt, threshold)).returning({ id: auditLogs.id });

  console.log(`Audit log cleanup: ${deleted.length} records older than ${retentionDays} days removed`);
  return { cleaned: deleted.length };
}
