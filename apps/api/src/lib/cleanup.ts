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
import { TRASH_RETENTION_DAYS, DEVICE_SESSION_EXPIRY, logger, logCleanupError } from '@osshelf/shared';
import type { Env } from '../types/env';
import { getAuditRetentionDays, hasTelegramAlert } from '../types/env';
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

async function sendCronAlert(env: Env, message: string): Promise<void> {
  if (!hasTelegramAlert(env)) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.ALERT_TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.ALERT_TG_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (error) {
    logger.error('CLEANUP', 'Telegram告警发送失败', {}, error);
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
    logCleanupError('回收站', error);
    failures.push(`回收站清理: ${msg}`);
  }

  try {
    result.sessions = await runSessionCleanup(db, env, encKey);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logCleanupError('会话', error);
    failures.push(`会话清理: ${msg}`);
  }

  try {
    result.shares = await runShareCleanup(db);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logCleanupError('分享', error);
    failures.push(`分享清理: ${msg}`);
  }

  try {
    result.audit = await runAuditLogCleanup(db, env);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logCleanupError('审计日志', error);
    failures.push(`审计日志清理: ${msg}`);
  }

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
        logger.error('CLEANUP', '删除文件失败', { fileId: file.id, r2Key: file.r2Key }, error);
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

  logger.info('CLEANUP', `回收站清理完成: ${deletedCount} 文件, ${(freedBytes / 1024 / 1024).toFixed(2)} MB`);

  return { deletedCount, freedBytes };
}

async function runSessionCleanup(
  db: ReturnType<typeof getDb>,
  env: Env,
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
    } catch (error) {
      logger.error('CLEANUP', '中止过期上传失败', { taskId: task.id, r2Key: task.r2Key }, error);
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

  logger.info(
    'CLEANUP',
    `会话清理完成: ${expiredUploadTasks.length} 上传任务, ${oldLoginAttempts.length} 登录尝试, ${expiredDevices.length} 设备`
  );

  return {
    uploadTasksExpired: expiredUploadTasks.length,
    loginAttemptsCleaned: oldLoginAttempts.length,
    devicesCleaned: expiredDevices.length,
  };
}

async function runShareCleanup(db: ReturnType<typeof getDb>): Promise<{ sharesCleaned: number }> {
  const now = new Date().toISOString();

  const expiredShares = await db
    .delete(shares)
    .where(and(isNotNull(shares.expiresAt), lt(shares.expiresAt, now)))
    .returning({ id: shares.id });

  logger.info('CLEANUP', `分享清理完成: ${expiredShares.length} 条过期分享`);

  return { sharesCleaned: expiredShares.length };
}

async function runAuditLogCleanup(db: ReturnType<typeof getDb>, env: Env): Promise<{ cleaned: number }> {
  const retentionDays = getAuditRetentionDays(env);
  const threshold = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

  const deleted = await db.delete(auditLogs).where(lt(auditLogs.createdAt, threshold)).returning({ id: auditLogs.id });

  logger.info('CLEANUP', `审计日志清理完成: ${deleted.length} 条 (保留 ${retentionDays} 天)`);

  return { cleaned: deleted.length };
}
