/**
 * storage.ts — 存储空间管理工具
 *
 * 功能:
 * - 存储使用情况统计
 * - 大文件发现
 * - 空间清理建议
 * - 文件类型分布
 */

import { eq, and, isNull, isNotNull, desc, sql, count } from 'drizzle-orm';
import { getDb, files, storageBuckets, shares } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';
import { formatBytes } from '../utils';

export const definitions: ToolDefinition[] = [
  // 1. get_storage_usage — 存储概览
  {
    type: 'function',
    function: {
      name: 'get_storage_usage',
      description: `【空间概况】查看存储空间的使用情况。
适用场景：
• "我的空间用得怎么样"
• "还剩多少空间"
• "哪些东西占空间大"

提供总览：已用/剩余、文件数量、文件夹数量等`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      examples: [
        { user_query: '我的空间用得怎么样', tool_call: {} },
        { user_query: '还剩多少空间', tool_call: {} },
      ],
    },
  },

  // 2. get_large_files — 大文件列表
  {
    type: 'function',
    function: {
      name: 'get_large_files',
      description: `【大文件】找出占用空间最多的文件。
适用场景：
• "找一下大文件"
• "什么占的空间最多"
• "清理一些大文件"

帮助释放存储空间`,
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回数量（默认20）' },
          minSize: { type: 'number', description: '最小大小（字节），如 10*1024*1024=10MB' },
        },
      },
      examples: [
        { user_query: '找一下大文件', tool_call: {} },
        { user_query: '超过50MB的文件有哪些', tool_call: { minSize: 52428800, limit: 30 } },
      ],
    },
  },

  // 3. get_folder_sizes — 文件夹大小
  {
    type: 'function',
    function: {
      name: 'get_folder_sizes',
      description: `【文件夹占用】查看各文件夹的存储占用情况。
适用场景：
• "哪个文件夹最大"
• "工作目录占多少空间"
• "清理特定文件夹"`,
      parameters: {
        type: 'object',
        properties: {
          topN: { type: 'number', description: '显示最大的 N 个（默认10）' },
          folderId: { type: 'string', description: '指定父文件夹（可选，不传则全局）' },
        },
      },
      examples: [
        { user_query: '哪个文件夹最大', tool_call: {} },
        { user_query: '工作目录占多少空间', tool_call: { folderId: '<work_id>', topN: 20 } },
      ],
    },
  },

  // 5. get_cleanup_suggestions — 清理建议
  {
    type: 'function',
    function: {
      name: 'get_cleanup_suggestions',
      description: `【清理建议】智能分析并提供空间清理建议。
适用场景：
• "帮我清理一下空间"
• "有什么可以删的"
• "优化存储使用"

会分析：重复文件、过期分享、大文件、空文件夹等`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      examples: [
        { user_query: '帮我清理一下空间', tool_call: {} },
        { user_query: '有什么可以删的', tool_call: {} },
      ],
    },
  },

  // 6. list_buckets — 存储桶列表
  {
    type: 'function',
    function: {
      name: 'list_buckets',
      description: `【存储桶列表】查看所有可用的存储桶。
适用场景：
• "有哪些存储桶"
• "查看存储桶配置"`,
      parameters: {
        type: 'object',
        properties: {
          includeStats: { type: 'boolean', description: '是否包含使用统计（默认false）' },
        },
      },
      examples: [
        { user_query: '有哪些存储桶', tool_call: {} },
        { user_query: '显示存储桶使用统计', tool_call: { includeStats: true } },
      ],
    },
  },

  // 7. get_bucket_info — 存储桶详情
  {
    type: 'function',
    function: {
      name: 'get_bucket_info',
      description: `【存储桶详情】获取指定存储桶的详细信息。
适用场景：
• "这个存储桶的配置"
• "查看存储桶容量"`,
      parameters: {
        type: 'object',
        properties: {
          bucketId: { type: 'string', description: '存储桶ID' },
        },
        required: ['bucketId'],
      },
      examples: [
        { user_query: '这个存储桶的配置', tool_call: { bucketId: '<bucket_id>' } },
        { user_query: '查看存储桶容量', tool_call: { bucketId: '<bucket_id>' } },
      ],
    },
  },

  // 8. set_default_bucket — 设置默认存储桶
  {
    type: 'function',
    function: {
      name: 'set_default_bucket',
      description: `【设置默认存储桶】更改用户的默认存储桶。
⚠️ 此操作会影响后续上传文件的存储位置`,
      parameters: {
        type: 'object',
        properties: {
          bucketId: { type: 'string', description: '要设为默认的存储桶ID' },
        },
        required: ['bucketId'],
      },
      examples: [
        { user_query: '把S3存储设为默认', tool_call: { bucketId: '<s3_bucket_id>' } },
        { user_query: '切换默认存储位置', tool_call: { bucketId: '<backup_bucket_id>' } },
      ],
    },
  },

  // 9. migrate_file_to_bucket — 迁移文件
  {
    type: 'function',
    function: {
      name: 'migrate_file_to_bucket',
      description: `【迁移文件】将文件迁移到另一个存储桶。
适用场景：
• "把这个文件移到另一个存储桶"
• "文件存储位置调整"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '要迁移的文件ID' },
          targetBucketId: { type: 'string', description: '目标存储桶ID' },
        },
        required: ['fileId', 'targetBucketId'],
      },
      examples: [
        { user_query: '把这个文件移到S3存储', tool_call: { fileId: '<file_id>', targetBucketId: '<s3_bucket_id>' } },
        { user_query: '迁移到备份存储桶', tool_call: { fileId: '<important_id>', targetBucketId: '<backup_id>' } },
      ],
    },
  },
];

export class StorageTools {
  static async executeGetStorageUsage(env: Env, userId: string, _args: Record<string, unknown>) {
    const db = getDb(env.DB);

    const [totalStats, folderCount] = await Promise.all([
      db
        .select({
          totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)`,
          fileCount: count(),
        })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
        .get(),
      db
        .select({ cnt: count() })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, true)))
        .get(),
    ]);

    return {
      usedBytes: totalStats?.totalSize || 0,
      usedFormatted: formatBytes(totalStats?.totalSize || 0),
      fileCount: totalStats?.fileCount || 0,
      folderCount: folderCount?.cnt || 0,
    };
  }

  static async executeGetLargeFiles(env: Env, userId: string, args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) || 20, 100);
    const minSize = (args.minSize as number) || 10 * 1024 * 1024;
    const db = getDb(env.DB);

    const rows = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          isNull(files.deletedAt),
          eq(files.isFolder, false),
          sql`${files.size} >= ${minSize}`
        )
      )
      .orderBy(desc(files.size))
      .limit(limit)
      .all();

    return {
      total: rows.length,
      files: rows.map((f) => ({
        id: f.id,
        name: f.name,
        size: formatBytes(f.size),
        sizeBytes: f.size,
        mimeType: f.mimeType,
        updatedAt: f.updatedAt,
      })),
    };
  }

  static async executeGetFolderSizes(env: Env, userId: string, args: Record<string, unknown>) {
    const topN = Math.min((args.topN as number) || 10, 50);
    const db = getDb(env.DB);

    const rows = await db
      .select({
        folderId: files.id,
        folderName: files.name,
        folderPath: files.path,
        totalSize: sql<number>`COALESCE((SELECT SUM(f2.size) FROM files f2 WHERE f2.parent_id = files.id AND f2.deleted_at IS NULL), 0)`,
        fileCount: sql<number>`(SELECT COUNT(*) FROM files f2 WHERE f2.parent_id = files.id AND f2.deleted_at IS NULL AND f2.is_folder = FALSE)`,
      })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, true)))
      .orderBy(
        desc(
          sql`(SELECT COALESCE(SUM(f2.size), 0) FROM files f2 WHERE f2.parent_id = files.id AND f2.deleted_at IS NULL)`
        )
      )
      .limit(topN)
      .all();

    return {
      total: rows.length,
      folders: rows.map((r) => ({
        id: r.folderId,
        name: r.folderName,
        path: r.folderPath,
        totalSize: formatBytes(r.totalSize || 0),
        totalSizeBytes: r.totalSize || 0,
        fileCount: Number(r.fileCount) || 0,
      })),
    };
  }

  static async executeGetCleanupSuggestions(env: Env, userId: string, _args: Record<string, unknown>) {
    const db = getDb(env.DB);

    const [duplicates, largeFiles, , expiredShares] = await Promise.all([
      db
        .select({ hash: files.hash, cnt: count() })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), isNotNull(files.hash)))
        .groupBy(files.hash)
        .having(sql`count(*) > 1`)
        .limit(10)
        .all(),
      db
        .select()
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), sql`${files.size} > 104857600`))
        .orderBy(desc(files.size))
        .limit(10)
        .all(),
      db
        .select()
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, true)))
        .limit(50)
        .all(),
      db
        .select()
        .from(shares)
        .where(and(eq(shares.userId, userId), sql`${shares.expiresAt} < datetime('now')`))
        .limit(10)
        .all(),
    ]);

    return {
      suggestions: [
        {
          type: 'duplicates',
          message: `发现 ${duplicates.length} 组重复文件`,
          count: duplicates.length,
          potentialSavings: '可节省空间',
        },
        {
          type: 'large_files',
          message: `发现 ${largeFiles.length} 个超过100MB的大文件`,
          count: largeFiles.length,
        },
        {
          type: 'expired_shares',
          message: `发现 ${expiredShares.length} 个已过期的分享链接`,
          count: expiredShares.length,
        },
      ],
      _next_actions: ['可使用 search_duplicates 查看重复文件详情', '可使用 get_large_files 查看大文件列表'],
    };
  }

  static async executeListBuckets(env: Env, userId: string, _args: Record<string, unknown>) {
    const db = getDb(env.DB);

    try {
      const buckets = await db.select().from(storageBuckets).where(eq(storageBuckets.userId, userId)).all();

      const bucketsWithStats = await Promise.all(
        buckets.map(async (bucket) => {
          const stats = await db
            .select({
              totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)`,
              fileCount: count(),
            })
            .from(files)
            .where(
              and(
                eq(files.userId, userId),
                eq(files.bucketId, bucket.id),
                isNull(files.deletedAt),
                eq(files.isFolder, false)
              )
            )
            .get();

          return {
            id: bucket.id,
            name: bucket.name,
            provider: bucket.provider,
            endpoint: bucket.endpoint ? maskEndpoint(bucket.endpoint) : null,
            isActive: bucket.isActive,
            isDefault: bucket.isDefault,
            totalSize: formatBytes(stats?.totalSize || 0),
            totalSizeBytes: stats?.totalSize || 0,
            fileCount: Number(stats?.fileCount) || 0,
            createdAt: bucket.createdAt,
          };
        })
      );

      return {
        total: bucketsWithStats.length,
        buckets: bucketsWithStats,
      };
    } catch (error) {
      logger.warn('AgentTool', 'Failed to list storage buckets', undefined, error);
      return {
        total: 0,
        buckets: [],
        note: '存储桶功能可能未完全启用',
      };
    }
  }

  static async executeGetBucketInfo(env: Env, userId: string, args: Record<string, unknown>) {
    const bucketId = args.bucketId as string;
    const db = getDb(env.DB);

    const bucket = await db
      .select()
      .from(storageBuckets)
      .where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, userId)))
      .get();
    if (!bucket) return { error: '存储桶不存在' };

    const [stats, recentFiles] = await Promise.all([
      db
        .select({
          totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)`,
          fileCount: count(),
          folderCount: sql<number>`COUNT(*) FILTER (WHERE ${files.isFolder} = TRUE)`,
        })
        .from(files)
        .where(and(eq(files.userId, userId), eq(files.bucketId, bucketId), isNull(files.deletedAt)))
        .get(),
      db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(and(eq(files.userId, userId), eq(files.bucketId, bucketId), isNull(files.deletedAt)))
        .orderBy(desc(files.createdAt))
        .limit(5)
        .all(),
    ]);

    return {
      id: bucket.id,
      name: bucket.name,
      provider: bucket.provider,
      endpoint: bucket.endpoint,
      region: bucket.region,
      isActive: bucket.isActive,
      isDefault: bucket.isDefault,
      stats: {
        totalSize: formatBytes(stats?.totalSize || 0),
        totalSizeBytes: stats?.totalSize || 0,
        fileCount: Number(stats?.fileCount) || 0,
        folderCount: Number(stats?.folderCount) || 0,
      },
      recentFiles: (recentFiles || []).map((f) => ({
        id: f.id,
        name: f.name,
        size: formatBytes(f.size),
        mimeType: f.mimeType,
        createdAt: f.createdAt,
      })),
      createdAt: bucket.createdAt,
    };
  }

  static async executeSetDefaultBucket(env: Env, userId: string, args: Record<string, unknown>) {
    const bucketId = args.bucketId as string;
    const db = getDb(env.DB);

    const bucket = await db
      .select()
      .from(storageBuckets)
      .where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, userId)))
      .get();
    if (!bucket) return { error: '存储桶不存在' };

    await db
      .update(storageBuckets)
      .set({ isDefault: false })
      .where(and(eq(storageBuckets.userId, userId), eq(storageBuckets.isDefault, true)));

    await db.update(storageBuckets).set({ isDefault: true }).where(eq(storageBuckets.id, bucketId));

    logger.info('AgentTool', 'Set default bucket', { bucketId, bucketName: bucket.name, userId });

    return {
      success: true,
      message: `"${bucket.name}" 已设为默认存储桶`,
      bucketId,
      bucketName: bucket.name,
      provider: bucket.provider,
    };
  }

  static async executeMigrateFileToBucket(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const targetBucketId = args.targetBucketId as string;
    const db = getDb(env.DB);

    const [file, targetBucket] = await Promise.all([
      db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get(),
      db
        .select()
        .from(storageBuckets)
        .where(and(eq(storageBuckets.id, targetBucketId), eq(storageBuckets.userId, userId)))
        .get(),
    ]);

    if (!file) return { error: '文件不存在或无权访问' };
    if (!targetBucket) return { error: '目标存储桶不存在' };
    if (file.isFolder) return { error: '暂不支持迁移文件夹' };

    try {
      const sourceObject = await env.FILES?.get(file.r2Key!);
      if (!sourceObject) return { error: '源文件数据不可用' };

      const body = await sourceObject.arrayBuffer();
      const newR2Key = `uploads/${userId}/${fileId}/${file.name}`;

      await env.FILES?.put(newR2Key, new Uint8Array(body));

      await db
        .update(files)
        .set({
          bucketId: targetBucketId,
          r2Key: newR2Key,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(files.id, fileId));

      logger.info('AgentTool', 'Migrated file to different bucket', {
        fileId,
        fileName: file.name,
        fromBucket: file.bucketId || 'default',
        toBucket: targetBucketId,
        toBucketName: targetBucket.name,
      });

      return {
        success: true,
        message: `"${file.name}" 已迁移到 "${targetBucket.name}"`,
        fileId,
        fileName: file.name,
        fromBucket: file.bucketId || 'default',
        toBucket: targetBucketId,
        toBucketName: targetBucket.name,
        size: formatBytes(file.size),
      };
    } catch (error) {
      logger.error('AgentTool', 'Failed to migrate file', { fileId, targetBucketId }, error);
      return { error: '迁移失败: ' + (error instanceof Error ? error.message : '存储服务异常') };
    }
  }
}

function maskEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return url.protocol + '//' + url.hostname + '/***';
  } catch {
    return endpoint.replace(/\/\/[^@]+@/, '//***@');
  }
}
