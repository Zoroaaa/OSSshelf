/**
 * assetInvalidation.ts — AI 资产失效统一入口
 *
 * 文件元数据（名称/描述/摘要/标签）变更后必须同步 FTS，否则"改名后搜不到"；
 * 内容或摘要变化影响向量召回时，还要重新排队 index，否则新上传/覆盖后仍召回旧片段。
 * 调用方不要直接调 syncFileFts / deleteFileFts，否则上面两类修正会分散到各处重复实现。
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../types/env';
import { getDb } from '../../db';
import { files } from '../../db/schema';
import { logger } from '@osshelf/shared';
import { syncFileFts } from './retrieval/fts';

export interface InvalidateAssetOptions {
  /** 触发原因，仅用于日志排查（rename/description/summary/tags/retry/…） */
  reason: string;
  /**
   * 是否重新排队索引任务。
   * 仅当"可被向量/分块召回的内容"发生变化时为 true（例如重新解析、覆盖上传），
   * 单纯改名/改描述只影响 FTS，不必烧 embedding 额度。
   */
  reindex?: boolean;
}

/**
 * 让某个文件的检索资产与最新元数据保持一致。
 * 失败只记日志：元数据写入已成功，不能因为索引维护失败把接口变成 500。
 */
export async function invalidateAsset(env: Env, fileId: string, options: InvalidateAssetOptions): Promise<void> {
  await syncFileFts(env, fileId);

  if (!options.reindex) return;

  try {
    const db = getDb(env.DB);
    const file = await db.select({ userId: files.userId }).from(files).where(eq(files.id, fileId)).get();
    if (!file) return;
    if (!env.AI_TASKS_QUEUE) {
      logger.warn('AI', '索引队列未配置，跳过资产重建', { fileId, reason: options.reason });
      return;
    }

    // 动态导入：aiTaskQueue → fileService → 本模块，静态导入会形成模块环
    const { createTaskRecord, enqueueAiTasks } = await import('./aiTaskQueue');
    const task = await createTaskRecord(env, 'index', file.userId, 1);
    await enqueueAiTasks(env, 'index', [fileId], file.userId, task.id);
    logger.info('AI', '资产已重新排队索引', { fileId, taskId: task.id, reason: options.reason });
  } catch (error) {
    logger.warn('AI', '资产重建入队失败', { fileId, reason: options.reason }, error);
  }
}
