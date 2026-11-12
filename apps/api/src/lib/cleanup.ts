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

import { eq, and, or, isNull, isNotNull, lt, inArray } from 'drizzle-orm';
import {
  getDb,
  files,
  shares,
  uploadTasks,
  loginAttempts,
  userDevices,
  emailTokens,
  auditLogs,
  searchHistory,
  notifications,
  aiTasks,
  aiTaskItems,
  aiQuotaCounters,
} from '../db';
import { DEVICE_SESSION_EXPIRY, logger, logCleanupError } from '@osshelf/shared';
import type { Env } from '../types/env';
import { getAuditRetentionDays, getTrashRetentionDays, hasTelegramAlert } from '../types/env';
import { s3AbortMultipartUpload } from './s3client';
import { resolveBucketConfig } from './bucketResolver';
import { releaseFileRef } from './dedup';
import { getEncryptionKey } from './crypto';
import { pathPrefixCondition } from './pathUtils';
import { processDeletionQueue, deleteObjectSafely } from './storageGC';
import { runStorageReconciliation, type ReconciliationReport } from './storageReconciliation';

interface CleanupResult {
  trash: {
    deletedCount: number;
    freedBytes: number;
    expiredDirectLinks: number;
  };
  sessions: {
    uploadTasksExpired: number;
    loginAttemptsCleaned: number;
    devicesCleaned: number;
    emailTokensCleaned: number;
  };
  shares: {
    sharesCleaned: number;
  };
  audit: {
    cleaned: number;
  };
  data: {
    searchHistoryCleaned: number;
    notificationsCleaned: number;
    aiTasksCleaned: number;
  };
  storageGC: {
    processed: number;
    succeeded: number;
    failed: number;
  };
  reconciliation: ReconciliationReport;
}

export interface CronAlertResult {
  sent: boolean;
  /** 前置条件缺失：Worker Secret 或环境变量未配置 */
  skipped?: 'missing-credentials';
  /** Telegram 返回的 description 或网络异常信息 */
  reason?: string;
  /** Telegram HTTP 状态码（网络层异常时为空） */
  status?: number;
}

export async function sendCronAlert(env: Env, message: string): Promise<CronAlertResult> {
  if (!hasTelegramAlert(env)) {
    logger.warn('CLEANUP', 'Telegram告警未发送：缺少 ALERT_TG_BOT_TOKEN 或 ALERT_TG_CHAT_ID');
    return { sent: false, skipped: 'missing-credentials' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${env.ALERT_TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.ALERT_TG_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    // Telegram 失败时仍返回 4xx/5xx 且 body 为 { ok: false, description }，
    // fetch 不会抛错，必须显式检查，否则失败会被静默吞掉。
    let body: { ok?: boolean; description?: string } | null = null;
    try {
      body = (await response.json()) as { ok?: boolean; description?: string };
    } catch {
      body = null;
    }

    if (!response.ok || body?.ok !== true) {
      const description = body?.description ?? '响应体缺少 ok 字段';
      logger.error('CLEANUP', `Telegram告警发送失败: HTTP ${response.status} ${description}`, {
        status: response.status,
        description,
      });
      return { sent: false, status: response.status, reason: description };
    }

    logger.info('CLEANUP', 'Telegram告警已发送');
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('CLEANUP', 'Telegram告警发送异常', {}, error);
    return { sent: false, reason };
  }
}

export async function runAllCleanupTasks(env: Env): Promise<CleanupResult> {
  const db = getDb(env.DB);
  const encKey = getEncryptionKey(env);
  const startedAt = new Date().toISOString();

  const result: CleanupResult = {
    trash: { deletedCount: 0, freedBytes: 0, expiredDirectLinks: 0 },
    sessions: { uploadTasksExpired: 0, loginAttemptsCleaned: 0, devicesCleaned: 0, emailTokensCleaned: 0 },
    shares: { sharesCleaned: 0 },
    audit: { cleaned: 0 },
    data: { searchHistoryCleaned: 0, notificationsCleaned: 0, aiTasksCleaned: 0 },
    storageGC: { processed: 0, succeeded: 0, failed: 0 },
    reconciliation: {
      generatedAt: '',
      users: { checked: 0, withDiff: 0, totalDiffBytes: 0, samples: [] },
      buckets: { checked: 0, withDiff: 0, totalDiffBytes: 0, totalDiffCount: 0, samples: [] },
      unassigned: { files: 0, bytes: 0 },
      dedup: { sharedGroups: 0, crossBucketGroups: 0 },
      path: { mismatch: 0, unreachable: 0 },
    },
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

  try {
    result.data = await runDataCleanup(db);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logCleanupError('数据', error);
    failures.push(`数据清理: ${msg}`);
  }

  try {
    result.storageGC = await processDeletionQueue(env);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logCleanupError('存储删除补偿', error);
    failures.push(`存储删除补偿: ${msg}`);
  }

  try {
    result.reconciliation = await runStorageReconciliation(env);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logCleanupError('存储对账', error);
    failures.push(`存储对账: ${msg}`);
  }

  if (failures.length > 0) {
    const alertMsg =
      `⚠️ <b>OSSshelf Cron 告警</b>\n` +
      `时间：${startedAt}\n` +
      `失败任务（${failures.length}/7）：\n` +
      failures.map((f) => `• ${f}`).join('\n');
    await sendCronAlert(env, alertMsg);
  } else {
    const mb = (result.trash.freedBytes / 1024 / 1024).toFixed(2);
    const rc = result.reconciliation;
    const rcLine =
      rc.users.withDiff + rc.buckets.withDiff + rc.path.mismatch + rc.path.unreachable > 0
        ? `• 对账：用户差异 ${rc.users.withDiff}，桶差异 ${rc.buckets.withDiff}，路径不一致 ${rc.path.mismatch}，不可达 ${rc.path.unreachable}`
        : `• 对账：通过`;
    const summaryMsg =
      `✅ <b>OSSshelf Cron 完成</b>\n` +
      `时间：${startedAt}\n` +
      `• 回收站：删除 ${result.trash.deletedCount} 文件，释放 ${mb} MB\n` +
      `• 会话：清理 ${result.sessions.uploadTasksExpired} 上传任务，${result.sessions.devicesCleaned} 设备\n` +
      `• 分享：清理 ${result.shares.sharesCleaned} 条\n` +
      `• 审计日志：清理 ${result.audit.cleaned} 条\n` +
      `• 数据：清理 ${result.data.searchHistoryCleaned} 搜索历史，${result.data.notificationsCleaned} 通知，${result.data.aiTasksCleaned} AI任务\n` +
      rcLine;
    await sendCronAlert(env, summaryMsg);
  }

  return result;
}

export async function runTrashCleanup(
  db: ReturnType<typeof getDb>,
  env: Env,
  encKey: string
): Promise<{ deletedCount: number; freedBytes: number; expiredDirectLinks: number }> {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - getTrashRetentionDays(env));
  const threshold = retentionDate.toISOString();

  // 分批处理参数（防止单次 cron 超时）
  const BATCH_SIZE = 100;
  const MAX_BATCHES = 50; // 最多处理 5000 个文件，避免超长运行

  let deletedCount = 0;
  let freedBytes = 0;
  let batchCount = 0;
  const deletedIds = new Set<string>();

  while (batchCount < MAX_BATCHES) {
    // 分批查询过期文件（每次只取 BATCH_SIZE 条）
    const batchFiles = await db
      .select()
      .from(files)
      .where(and(isNotNull(files.deletedAt), lt(files.deletedAt, threshold)))
      .limit(BATCH_SIZE)
      .all();

    if (batchFiles.length === 0) break; // 没有更多文件需要处理

    for (const file of batchFiles) {
      if (deletedIds.has(file.id)) continue;

      // 文件夹：必须连同整棵子树一起永久删除，否则子项会变成孤儿且无法恢复
      const namespaceCondition = file.teamId ? eq(files.teamId, file.teamId) : isNull(files.teamId);
      const subtree =
        file.isFolder && file.path && file.path !== '/'
          ? await db
              .select()
              .from(files)
              .where(and(eq(files.userId, file.userId), namespaceCondition, pathPrefixCondition(files.path, file.path)))
              .all()
          : [];

      for (const target of [...subtree, file]) {
        if (deletedIds.has(target.id)) continue;

        try {
          if (!target.isFolder) {
            // CoW：仅当没有其它记录引用同一对象时才物理删除
            const { shouldDeleteStorage } = await releaseFileRef(db, target.id);
            if (shouldDeleteStorage) {
              await deleteObjectSafely(env, db, {
                userId: target.userId,
                bucketId: target.bucketId,
                parentId: target.parentId,
                r2Key: target.r2Key,
                reason: 'trash-cleanup',
              });
            }
            freedBytes += target.size;
          }
        } catch (error) {
          logger.error('CLEANUP', '删除文件失败', { fileId: target.id, r2Key: target.r2Key }, error);
          continue;
        }

        await db.delete(files).where(eq(files.id, target.id));
        deletedIds.add(target.id);
        deletedCount++;
      }
    }

    batchCount++;
  }

  if (batchCount >= MAX_BATCHES) {
    logger.warn('CLEANUP', `回收站清理达到批次上限 (${MAX_BATCHES} 批)，剩余文件将在下次 cron 处理`);
  }

  logger.info('CLEANUP', `回收站清理完成: ${deletedCount} 文件, ${(freedBytes / 1024 / 1024).toFixed(2)} MB`);

  // ── 清理过期直链 token ────────────────────────────────────────────────
  const now = new Date().toISOString();
  const expiredDirectLinks = await db
    .update(files)
    .set({ directLinkToken: null, directLinkExpiresAt: null })
    .where(
      and(isNotNull(files.directLinkToken), isNotNull(files.directLinkExpiresAt), lt(files.directLinkExpiresAt, now))
    )
    .returning({ id: files.id });

  return { deletedCount, freedBytes, expiredDirectLinks: expiredDirectLinks.length };
}

export async function runSessionCleanup(
  db: ReturnType<typeof getDb>,
  env: Env,
  encKey: string
): Promise<{
  uploadTasksExpired: number;
  loginAttemptsCleaned: number;
  devicesCleaned: number;
  emailTokensCleaned: number;
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

  const expiredEmailTokens = await db
    .delete(emailTokens)
    .where(or(lt(emailTokens.expiresAt, now), isNotNull(emailTokens.usedAt)))
    .returning({ id: emailTokens.id });

  logger.info(
    'CLEANUP',
    `会话清理完成: ${expiredUploadTasks.length} 上传任务, ${oldLoginAttempts.length} 登录尝试, ${expiredDevices.length} 设备, ${expiredEmailTokens.length} 邮件令牌`
  );

  return {
    uploadTasksExpired: expiredUploadTasks.length,
    loginAttemptsCleaned: oldLoginAttempts.length,
    devicesCleaned: expiredDevices.length,
    emailTokensCleaned: expiredEmailTokens.length,
  };
}

export async function runShareCleanup(db: ReturnType<typeof getDb>): Promise<{ sharesCleaned: number }> {
  const now = new Date().toISOString();

  const expiredShares = await db
    .delete(shares)
    .where(and(isNotNull(shares.expiresAt), lt(shares.expiresAt, now)))
    .returning({ id: shares.id });

  logger.info('CLEANUP', `分享清理完成: ${expiredShares.length} 条过期分享`);

  return { sharesCleaned: expiredShares.length };
}

export async function runAuditLogCleanup(db: ReturnType<typeof getDb>, env: Env): Promise<{ cleaned: number }> {
  const retentionDays = getAuditRetentionDays(env);
  const threshold = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

  const deleted = await db.delete(auditLogs).where(lt(auditLogs.createdAt, threshold)).returning({ id: auditLogs.id });

  logger.info('CLEANUP', `审计日志清理完成: ${deleted.length} 条 (保留 ${retentionDays} 天)`);

  return { cleaned: deleted.length };
}

export async function runDataCleanup(db: ReturnType<typeof getDb>): Promise<{
  searchHistoryCleaned: number;
  notificationsCleaned: number;
  aiTasksCleaned: number;
  quotaCountersCleaned: number;
}> {
  const searchRetentionDays = 30;
  const searchThreshold = new Date(Date.now() - searchRetentionDays * 86_400_000).toISOString();
  const oldSearchHistory = await db
    .delete(searchHistory)
    .where(lt(searchHistory.createdAt, searchThreshold))
    .returning({ id: searchHistory.id });

  const notificationRetentionDays = 30;
  const notificationThreshold = new Date(Date.now() - notificationRetentionDays * 86_400_000).toISOString();
  const oldNotifications = await db
    .delete(notifications)
    .where(and(eq(notifications.isRead, true), lt(notifications.createdAt, notificationThreshold)))
    .returning({ id: notifications.id });

  const aiTaskRetentionDays = 7;
  const aiTaskThreshold = new Date(Date.now() - aiTaskRetentionDays * 86_400_000).toISOString();
  const completedAiTasks = await db
    .delete(aiTasks)
    .where(
      and(
        or(eq(aiTasks.status, 'completed'), eq(aiTasks.status, 'failed'), eq(aiTasks.status, 'cancelled')),
        lt(aiTasks.updatedAt, aiTaskThreshold)
      )
    )
    .returning({ id: aiTasks.id });

  // 级联清理任务项，否则 ai_task_items 会无限堆积
  if (completedAiTasks.length > 0) {
    await db.delete(aiTaskItems).where(
      inArray(
        aiTaskItems.taskId,
        completedAiTasks.map((task) => task.id)
      )
    );
  }

  // 配额计数窗口只对当天/当分钟有效，保留 24 小时足够诊断，之后删除避免无限增长
  const quotaCounterThreshold = new Date(Date.now() - 86_400_000).toISOString();
  const staleQuotaCounters = await db
    .delete(aiQuotaCounters)
    .where(lt(aiQuotaCounters.updatedAt, quotaCounterThreshold))
    .returning({ userId: aiQuotaCounters.userId });

  logger.info(
    'CLEANUP',
    `数据清理完成: ${oldSearchHistory.length} 搜索历史, ${oldNotifications.length} 通知, ${completedAiTasks.length} AI任务, ${staleQuotaCounters.length} 配额窗口`
  );

  return {
    searchHistoryCleaned: oldSearchHistory.length,
    notificationsCleaned: oldNotifications.length,
    aiTasksCleaned: completedAiTasks.length,
    quotaCountersCleaned: staleQuotaCounters.length,
  };
}
