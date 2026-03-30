/**
 * versionManager.ts
 * 文件版本管理器
 *
 * 功能:
 * - 创建版本快照（自动触发）
 * - 裁剪超量版本（maxVersions 限制）
 * - 处理 CoW 引用计数
 * - 孤儿 r2Key 清理
 *
 * 设计原则:
 * - 文件内容变更时自动创建版本快照
 * - 版本数超过 maxVersions 时自动裁剪最老版本
 * - 使用 ref_count 追踪同一 r2Key 的引用，实现去重存储
 */

import { eq, and, desc, lt } from 'drizzle-orm';
import { getDb, files, fileVersions } from '../db';
import type { DrizzleDb } from '../db';
import type { Env } from '../types/env';
import { s3Delete } from './s3client';
import { resolveBucketConfig } from './bucketResolver';
import { getEncryptionKey } from './crypto';
import { updateUserStorage } from './bucketResolver';
import { isEditableFile } from '@osshelf/shared';

type FileRecord = typeof files.$inferSelect;

const isVersionableFile = isEditableFile;

export { isEditableFile, isVersionableFile };

export interface CreateVersionOptions {
  changeSummary?: string;
  createdBy: string;
}

export interface VersionSnapshotResult {
  versionId: string;
  version: number;
  created: boolean;
  skipped: boolean;
  reason?: string;
}

export interface PruneResult {
  prunedCount: number;
  freedBytes: number;
  errors: string[];
}

/**
 * 创建版本快照
 *
 * 在文件内容变更前调用，保存当前版本的快照。
 * 如果 hash 相同（内容未变），则跳过创建。
 *
 * 重要：此函数应在内容更新前调用，保存的是当前（旧）内容。
 *
 * @param db - Drizzle DB 实例
 * @param env - 环境变量
 * @param file - 文件记录
 * @param options - 创建选项
 * @returns 版本快照结果
 */
export async function createVersionSnapshot(
  db: DrizzleDb,
  env: Env,
  file: FileRecord,
  options: CreateVersionOptions
): Promise<VersionSnapshotResult> {
  if (file.isFolder) {
    return {
      versionId: '',
      version: file.currentVersion ?? 1,
      created: false,
      skipped: true,
      reason: '文件夹不支持版本控制',
    };
  }

  if (!isVersionableFile(file.mimeType, file.name)) {
    return {
      versionId: '',
      version: file.currentVersion ?? 1,
      created: false,
      skipped: true,
      reason: '此文件类型不支持版本控制，仅支持可编辑的文本文件',
    };
  }

  if (!file.hash) {
    return {
      versionId: '',
      version: file.currentVersion ?? 1,
      created: false,
      skipped: true,
      reason: '文件无 hash，跳过版本创建',
    };
  }

  const currentVersion = file.currentVersion ?? 1;
  const maxVersions = file.maxVersions ?? 10;

  const existingVersions = await db
    .select({ id: fileVersions.id, version: fileVersions.version, hash: fileVersions.hash })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, file.id))
    .orderBy(desc(fileVersions.version))
    .all();

  const latestVersion = existingVersions[0];
  if (latestVersion && latestVersion.hash === file.hash) {
    return {
      versionId: latestVersion.id,
      version: latestVersion.version,
      created: false,
      skipped: true,
      reason: '内容未变化，跳过版本创建',
    };
  }

  const snapshotVersion = currentVersion;
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(fileVersions).values({
    id: versionId,
    fileId: file.id,
    version: snapshotVersion,
    r2Key: file.r2Key,
    size: file.size,
    mimeType: file.mimeType,
    hash: file.hash,
    refCount: 1,
    changeSummary: options.changeSummary ?? `版本 ${snapshotVersion} 快照`,
    createdBy: options.createdBy,
    createdAt: now,
  });

  const newFileVersion = currentVersion + 1;
  await db
    .update(files)
    .set({
      currentVersion: newFileVersion,
      updatedAt: now,
    })
    .where(eq(files.id, file.id));

  const totalVersions = existingVersions.length + 1;
  if (totalVersions > maxVersions) {
    await pruneExcessVersions(db, env, file.id, maxVersions);
  }

  return {
    versionId,
    version: snapshotVersion,
    created: true,
    skipped: false,
  };
}

/**
 * 裁剪超量版本
 *
 * 当版本数超过 maxVersions 时，删除最老的版本。
 * 正确处理 ref_count，当 ref_count 降为 0 时删除物理对象。
 *
 * @param db - Drizzle DB 实例
 * @param env - 环境变量
 * @param fileId - 文件 ID
 * @param maxVersions - 最大版本数
 * @returns 裁剪结果
 */
export async function pruneExcessVersions(
  db: DrizzleDb,
  env: Env,
  fileId: string,
  maxVersions: number
): Promise<PruneResult> {
  const result: PruneResult = {
    prunedCount: 0,
    freedBytes: 0,
    errors: [],
  };

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) {
    result.errors.push('文件不存在');
    return result;
  }

  const currentVersion = file.currentVersion ?? 1;

  const allVersions = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.version))
    .all();

  if (allVersions.length <= maxVersions) {
    return result;
  }

  const toPrune = allVersions.slice(maxVersions);
  const encKey = getEncryptionKey(env);

  for (const version of toPrune) {
    if (version.version === currentVersion) {
      continue;
    }

    try {
      const isUniqueKey = version.r2Key !== file.r2Key;

      await db.delete(fileVersions).where(eq(fileVersions.id, version.id));

      if (isUniqueKey) {
        const sharedRefs = await db
          .select({ id: fileVersions.id })
          .from(fileVersions)
          .where(and(eq(fileVersions.r2Key, version.r2Key), eq(fileVersions.fileId, fileId)))
          .all();

        if (sharedRefs.length === 0) {
          await deleteStorageObject(db, env, file, version.r2Key, encKey);
          result.freedBytes += version.size;
        }
      }

      result.prunedCount++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`版本 ${version.version} 删除失败: ${msg}`);
    }
  }

  if (result.freedBytes > 0 && file.userId) {
    await updateUserStorage(db, file.userId, -result.freedBytes);
  }

  return result;
}

/**
 * 清理过期版本
 *
 * 根据 versionRetentionDays 清理超过保留天数的版本。
 * 用于 cron job 定期清理。
 *
 * @param db - Drizzle DB 实例
 * @param env - 环境变量
 * @returns 清理结果
 */
export async function cleanExpiredVersions(db: DrizzleDb, env: Env): Promise<PruneResult> {
  const result: PruneResult = {
    prunedCount: 0,
    freedBytes: 0,
    errors: [],
  };

  const encKey = getEncryptionKey(env);
  const now = new Date();

  const allFiles = await db
    .select({
      id: files.id,
      currentVersion: files.currentVersion,
      versionRetentionDays: files.versionRetentionDays,
      r2Key: files.r2Key,
      bucketId: files.bucketId,
      userId: files.userId,
      parentId: files.parentId,
    })
    .from(files)
    .where(eq(files.isFolder, false))
    .all();

  for (const file of allFiles) {
    const retentionDays = file.versionRetentionDays ?? 30;
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const expiredVersions = await db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.fileId, file.id), lt(fileVersions.createdAt, cutoff)))
      .all();

    let fileFreedBytes = 0;

    for (const version of expiredVersions) {
      if (version.version === (file.currentVersion ?? 1)) {
        continue;
      }

      try {
        const isUniqueKey = version.r2Key !== file.r2Key;

        await db.delete(fileVersions).where(eq(fileVersions.id, version.id));

        if (isUniqueKey) {
          const sharedRefs = await db
            .select({ id: fileVersions.id })
            .from(fileVersions)
            .where(and(eq(fileVersions.r2Key, version.r2Key), eq(fileVersions.fileId, file.id)))
            .all();

          if (sharedRefs.length === 0) {
            await deleteStorageObject(db, env, file as any, version.r2Key, encKey);
            fileFreedBytes += version.size;
          }
        }

        result.prunedCount++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`版本 ${version.version} 清理失败: ${msg}`);
      }
    }

    if (fileFreedBytes > 0 && file.userId) {
      await updateUserStorage(db, file.userId, -fileFreedBytes);
      result.freedBytes += fileFreedBytes;
    }
  }

  return result;
}

/**
 * 删除存储对象
 *
 * 根据文件配置选择正确的存储后端删除对象。
 */
async function deleteStorageObject(
  db: DrizzleDb,
  env: Env,
  file: FileRecord,
  r2Key: string,
  encKey: string
): Promise<void> {
  const bucketConfig = await resolveBucketConfig(db, file.userId, encKey, file.bucketId, file.parentId);

  if (bucketConfig) {
    await s3Delete(bucketConfig, r2Key).catch((e) => {
      console.error(`Failed to delete storage object ${r2Key}:`, e);
    });
  } else if (env.FILES) {
    await (env.FILES as R2Bucket).delete(r2Key).catch(() => {});
  }
}

/**
 * 检查文件是否需要创建版本快照
 *
 * 用于判断是否需要触发版本创建逻辑。
 * 仅可编辑的文本文件支持版本控制。
 */
export async function shouldCreateVersion(db: DrizzleDb, fileId: string, newHash: string): Promise<boolean> {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file || file.isFolder) return false;
  if (!isVersionableFile(file.mimeType, file.name)) return false;
  if (!file.hash) return true;

  return file.hash !== newHash;
}

/**
 * 获取文件的版本统计信息
 */
export async function getVersionStats(
  db: DrizzleDb,
  fileId: string
): Promise<{
  totalVersions: number;
  currentVersion: number;
  maxVersions: number;
  totalSize: number;
}> {
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file) {
    return {
      totalVersions: 0,
      currentVersion: 0,
      maxVersions: 10,
      totalSize: 0,
    };
  }

  const versions = await db
    .select({ size: fileVersions.size })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .all();

  return {
    totalVersions: versions.length,
    currentVersion: file.currentVersion ?? 1,
    maxVersions: file.maxVersions ?? 10,
    totalSize: versions.reduce((sum, v) => sum + (v.size ?? 0), 0),
  };
}
