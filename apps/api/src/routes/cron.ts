/**
 * cron.ts
 * 定时任务路由
 *
 * - /cron/* 仅允许管理员手动触发（scheduled 事件不经过此处）
 * - 具体清理逻辑统一在 lib/cleanup.ts，路由层不再重复实现
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { logger } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { getEncryptionKey } from '../lib/crypto';
import { cleanExpiredVersions } from '../lib/versionManager';
import { runDataCleanup, runSessionCleanup, runShareCleanup, runTrashCleanup } from '../lib/cleanup';
import { runStorageReconciliation } from '../lib/storageReconciliation';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('/*', authMiddleware);
app.use('/*', requireAdmin());

app.post('/trash-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const result = await runTrashCleanup(db, c.env, getEncryptionKey(c.env));

  return c.json({
    success: true,
    data: {
      ...result,
      message: `已清理 ${result.deletedCount} 个过期文件，释放 ${(result.freedBytes / 1024 / 1024).toFixed(2)} MB 空间，清除 ${result.expiredDirectLinks} 个过期直链`,
    },
  });
});

app.post('/session-cleanup', async (c) => {
  const db = getDb(c.env.DB);
  const result = await runSessionCleanup(db, c.env, getEncryptionKey(c.env));

  return c.json({ success: true, data: result });
});

app.post('/share-cleanup', async (c) => {
  const result = await runShareCleanup(getDb(c.env.DB));

  return c.json({ success: true, data: result });
});

app.post('/version-cleanup', async (c) => {
  const db = getDb(c.env.DB);

  try {
    const result = await cleanExpiredVersions(db, c.env);

    logger.info(
      'CRON',
      `版本清理完成: ${result.prunedCount} 版本, ${result.freedBytes} bytes, ${result.errors.length} 错误`
    );

    return c.json({
      success: true,
      data: {
        deletedVersions: result.prunedCount,
        freedBytes: result.freedBytes,
        errors: result.errors.length,
        errorDetails: result.errors.length > 0 ? result.errors.slice(0, 10) : undefined,
        message: `已清理 ${result.prunedCount} 个过期版本，释放 ${(result.freedBytes / 1024).toFixed(2)} KB`,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('CRON', '版本清理失败', {}, error);
    return c.json(
      {
        success: false,
        error: { code: 'VERSION_CLEANUP_FAILED', message: msg },
      },
      500
    );
  }
});

app.post('/data-cleanup', async (c) => {
  const result = await runDataCleanup(getDb(c.env.DB));

  return c.json({ success: true, data: result });
});

// ── 存储对账（只读，每日定时任务也会执行）────────────────────────────────
app.post('/reconcile', async (c) => {
  const report = await runStorageReconciliation(c.env);

  return c.json({ success: true, data: report });
});

app.post('/all', async (c) => {
  const db = getDb(c.env.DB);
  const env = c.env;
  const results: Record<string, unknown> = {};

  const runStep = async (key: string, step: () => Promise<unknown>) => {
    try {
      results[key] = await step();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('CRON', `清理任务失败: ${key}`, {}, error);
      results[key] = { error: msg };
    }
  };

  await runStep('trash', () => runTrashCleanup(db, env, getEncryptionKey(env)));
  await runStep('sessions', () => runSessionCleanup(db, env, getEncryptionKey(env)));
  await runStep('shares', () => runShareCleanup(db));
  await runStep('versions', () => cleanExpiredVersions(db, env));
  await runStep('data', () => runDataCleanup(db));
  await runStep('reconcile', () => runStorageReconciliation(env));

  return c.json({ success: true, data: results });
});

export default app;
