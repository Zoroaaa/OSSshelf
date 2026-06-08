/**
 * version.ts — 版本管理工具
 *
 * 功能:
 * - 获取版本历史
 * - 恢复到指定版本
 * - 版本对比
 * - 设置版本保留策略
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { getDb, files, fileVersions } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';
import { formatBytes } from '../utils';

export const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_file_versions',
      description: `【获取版本历史】查看文件的所有历史版本。
适用场景："这个文件有几个版本""看看之前的版本"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          limit: { type: 'number', description: '返回数量，默认 20' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '这个文件有几个版本', tool_call: { fileId: '<file_id>' } },
        { user_query: '看看之前的版本', tool_call: { fileId: '<doc_id>', limit: 10 } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'restore_version',
      description: `【恢复到指定版本】将文件恢复到某个历史版本。
⚠️ 恢复前请确认，当前版本将被覆盖为新版本。
适用场景："回滚到上一个版本""恢复到修改前的状态"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          versionId: { type: 'string', description: '要恢复到的版本 ID' },
          _confirmed: { type: 'boolean', description: '用户确认（必须为true）' },
        },
        required: ['fileId', 'versionId', '_confirmed'],
      },
      examples: [
        { user_query: '回滚到上一个版本', tool_call: { fileId: '<file_id>', versionId: '<v2_id>', _confirmed: true } },
        {
          user_query: '恢复到修改前的状态',
          tool_call: { fileId: '<doc_id>', versionId: '<old_version_id>', _confirmed: true },
        },
      ],
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_versions',
      description: `【对比两个版本】比较两个版本的差异信息。
包括大小变化、时间差异等元数据对比。`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          versionA: { type: 'number', description: '版本号 A' },
          versionB: { type: 'number', description: '版本号 B' },
        },
        required: ['fileId', 'versionA', 'versionB'],
      },
      examples: [
        { user_query: '对比版本1和版本3的差异', tool_call: { fileId: '<file_id>', versionA: 1, versionB: 3 } },
        { user_query: '看看最近两个版本的差别', tool_call: { fileId: '<doc_id>', versionA: 4, versionB: 5 } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'set_version_retention',
      description: `【设置版本保留策略】配置文件的版本保留规则。
可设置最大版本数和保留天数。
⚠️ 超出限制的旧版本会被自动清理。`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          maxVersions: { type: 'number', description: '最大保留版本数（1-50），默认 10' },
          retentionDays: { type: 'number', description: '版本保留天数（1-365），默认 30' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '只保留5个版本', tool_call: { fileId: '<file_id>', maxVersions: 5 } },
        {
          user_query: '设置保留策略为20个版本60天',
          tool_call: { fileId: '<doc_id>', maxVersions: 20, retentionDays: 60, _confirmed: true },
        },
      ],
    },
  },
];

export class VersionTools {
  static async executeGetFileVersions(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const limit = Math.min((args.limit as number) || 20, 50);
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    const versions = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId))
      .orderBy(desc(fileVersions.version))
      .limit(limit)
      .all();

    return {
      fileId,
      fileName: file.name,
      currentVersion: file.currentVersion || 0,
      maxVersions: file.maxVersions || null,
      totalVersions: versions.length,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        size: formatBytes(v.size),
        sizeBytes: v.size,
        createdAt: v.createdAt,
        comment: v.changeSummary || null,
        isCurrent: v.version === (file.currentVersion || 0),
      })),
      _next_actions:
        versions.length >= 2
          ? [
              `如需对比两个版本，调用 compare_versions(fileId="${fileId}", versionA=X, versionB=Y)`,
              `如需恢复到某个版本，调用 restore_version(fileId="${fileId}", versionId="<版本id>")`,
            ]
          : ['只有一个版本，无需对比或恢复'],
    };
  }

  static async executeRestoreVersion(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const versionId = args.versionId as string;
    const db = getDb(env.DB);

    const [file, targetVersion] = await Promise.all([
      db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get(),
      db
        .select()
        .from(fileVersions)
        .where(and(eq(fileVersions.id, versionId), eq(fileVersions.fileId, fileId)))
        .get(),
    ]);

    if (!file) return { error: '文件不存在或已被删除' };
    if (!targetVersion) return { error: '目标版本不存在' };

    try {
      const sourceObject = await env.FILES?.get(targetVersion.r2Key);
      if (!sourceObject) return { error: '版本文件数据已丢失' };

      const body = await sourceObject.arrayBuffer();
      await env.FILES?.put(file.r2Key!, new Uint8Array(body));

      const newVersionNum = (file.currentVersion || 0) + 1;
      const now = new Date().toISOString();

      await db.insert(fileVersions).values({
        id: crypto.randomUUID(),
        fileId,
        version: newVersionNum,
        r2Key: file.r2Key,
        size: targetVersion.size,
        mimeType: targetVersion.mimeType,
        changeSummary: `从版本 ${targetVersion.version} 恢复`,
        createdBy: userId,
        createdAt: now,
      });

      await db
        .update(files)
        .set({
          currentVersion: newVersionNum,
          size: targetVersion.size,
          updatedAt: now,
        })
        .where(eq(files.id, fileId));

      logger.info('AgentTool', 'Restored file to previous version', {
        fileId,
        fromVersion: targetVersion.version,
        toVersion: newVersionNum,
      });

      return {
        success: true,
        message: `已从版本 ${targetVersion.version} 恢复（新版本号: ${newVersionNum}）`,
        fileId,
        fileName: file.name,
        fromVersion: targetVersion.version,
        toVersion: newVersionNum,
        restoredAt: now,
        _next_actions: [`恢复成功，可调用 get_file_versions(fileId="${fileId}") 确认当前版本`],
      };
    } catch (error) {
      logger.error('AgentTool', 'Failed to restore version', { fileId, versionId }, error);
      return { error: '恢复失败: ' + (error instanceof Error ? error.message : '未知错误') };
    }
  }

  static async executeCompareVersions(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const versionA = args.versionA as number;
    const versionB = args.versionB as number;
    const db = getDb(env.DB);

    const [verA, verB] = await Promise.all([
      db
        .select()
        .from(fileVersions)
        .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, versionA)))
        .get(),
      db
        .select()
        .from(fileVersions)
        .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, versionB)))
        .get(),
    ]);

    if (!verA) return { error: `版本 ${versionA} 不存在` };
    if (!verB) return { error: `版本 ${versionB} 不存在` };

    return {
      fileId,
      comparison: {
        versionA: {
          number: verA.version,
          size: formatBytes(verA.size),
          sizeBytes: verA.size,
          createdAt: verA.createdAt,
          comment: verA.changeSummary,
        },
        versionB: {
          number: verB.version,
          size: formatBytes(verB.size),
          sizeBytes: verB.size,
          createdAt: verB.createdAt,
          comment: verB.changeSummary,
        },
        diff: {
          sizeChange: verB.size - verA.size,
          sizeChangeFormatted: formatSizeDiff(verB.size - verA.size),
          timeGapDays:
            Math.abs(new Date(verB.createdAt).getTime() - new Date(verA.createdAt).getTime()) / (1000 * 60 * 60 * 24),
          newerVersion: verB.createdAt > verA.createdAt ? 'B' : 'A',
        },
      },
      _next_actions: [`如需恢复到其中一个版本，调用 restore_version(fileId="${fileId}", versionId="<版本id>")`],
    };
  }

  static async executeSetVersionRetention(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const maxVersions = Math.max(1, Math.min((args.maxVersions as number) || 10, 50));
    const retentionDays = Math.max(1, Math.min((args.retentionDays as number) || 30, 365));
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或已被删除' };

    await db
      .update(files)
      .set({
        maxVersions,
        versionRetentionDays: retentionDays,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(files.id, fileId));

    return {
      success: true,
      message: '版本保留策略已更新',
      fileId,
      fileName: file.name,
      settings: {
        maxVersions,
        retentionDays,
        note: `最多保留 ${maxVersions} 个版本，超出或超过 ${retentionDays} 天的旧版本将自动清理`,
      },
      _next_actions: [`可调用 get_file_versions(fileId="${fileId}") 查看当前版本列表`],
    };
  }
}

function formatSizeDiff(diffBytes: number): string {
  if (diffBytes === 0) return '无变化';
  const prefix = diffBytes > 0 ? '+' : '';
  if (Math.abs(diffBytes) < 1024) return `${prefix}${diffBytes} B`;
  if (Math.abs(diffBytes) < 1024 * 1024) return `${prefix}${(diffBytes / 1024).toFixed(1)} KB`;
  return `${prefix}${(diffBytes / (1024 * 1024)).toFixed(1)} MB`;
}
