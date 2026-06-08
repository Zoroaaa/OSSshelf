/**
 * stats.ts — 统计与分析工具
 *
 * 功能:
 * - 存储统计
 * - 活动趋势统计
 * - 用户配额信息（新增）
 * - 文件类型分布（新增）
 * - 分享链接统计（新增）
 */

import { eq, and, isNull, gte, count, sql, desc, or } from 'drizzle-orm';
import { getDb, files, shares } from '../../../db';
import type { Env } from '../../../types/env';
import type { ToolDefinition } from './types';
import { formatBytes, getMimeTypeCategory } from '../utils';

export const definitions: ToolDefinition[] = [
  // 1. get_storage_stats — 存储统计
  {
    type: 'function',
    function: {
      name: 'get_storage_stats',
      description: `【存储统计】按类型、桶、时间维度汇总用户的存储使用情况。
适用场景："我用了多少空间""空间怎么分配的"。`,
      parameters: {
        type: 'object',
        properties: {
          dimension: {
            type: 'string',
            enum: ['mimetype', 'bucket', 'month'],
            description: '聚合维度：mimetype=按文件类型, bucket=按桶, month=按月',
          },
        },
        required: [],
      },
      examples: [
        { user_query: '我用了多少空间', tool_call: {} },
        { user_query: '按文件类型看空间分布', tool_call: { dimension: 'mimetype' } },
        { user_query: '每月存储增长趋势', tool_call: { dimension: 'month' } },
      ],
    },
  },

  // 2. get_activity_stats — 活动趋势统计
  {
    type: 'function',
    function: {
      name: 'get_activity_stats',
      description: `【活动趋势】按日/周/月统计上传/下载/分享等活动数据。
适用场景："最近上传了多少文件""上周的活动情况"。`,
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            description: '时间粒度，默认 day',
          },
          days: { type: 'number', description: '最近多少天，默认 30' },
        },
        required: [],
      },
      examples: [
        { user_query: '最近上传了多少文件', tool_call: {} },
        { user_query: '上周的活动情况', tool_call: { period: 'week', days: 7 } },
        { user_query: '本月统计', tool_call: { period: 'month', days: 30 } },
      ],
    },
  },

  // 3. get_user_quota_info — 用户配额信息（新增）
  {
    type: 'function',
    function: {
      name: 'get_user_quota_info',
      description: `【配额信息】查看用户的存储配额使用情况。
包括已用空间、总容量、剩余空间、使用百分比等。`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      examples: [
        { user_query: '我的存储配额使用情况', tool_call: {} },
        { user_query: '还剩多少空间', tool_call: {} },
      ],
    },
  },

  // 4. get_file_type_distribution — 文件类型分布（新增）
  {
    type: 'function',
    function: {
      name: 'get_file_type_distribution',
      description: `【文件类型分布】详细的文件类型统计分析。
包括各类型的数量、大小占比、Top类别等。`,
      parameters: {
        type: 'object',
        properties: {
          groupBy: {
            type: 'string',
            enum: ['category', 'mimetype', 'extension'],
            description: '分组方式：category=大类(图片/视频/文档), mimetype=完整MIME类型, extension=扩展名',
          },
          topN: { type: 'number', description: '显示Top N，默认 20' },
        },
        required: [],
      },
      examples: [
        { user_query: '文件类型分布', tool_call: {} },
        { user_query: '按扩展名统计', tool_call: { groupBy: 'extension' } },
        { user_query: 'Top10文件类型', tool_call: { topN: 10 } },
      ],
    },
  },

  // 5. get_sharing_stats — 分享链接统计（新增）
  {
    type: 'function',
    function: {
      name: 'get_sharing_stats',
      description: `【分享统计】分享链接的使用情况统计。
包括活跃分享数、过期分享数、下载量等。`,
      parameters: {
        type: 'object',
        properties: {
          includeExpired: { type: 'boolean', description: '是否包含已过期的分享，默认 false' },
        },
        required: [],
      },
      examples: [
        { user_query: '分享链接使用情况', tool_call: {} },
        { user_query: '包括过期的也显示', tool_call: { includeExpired: true } },
      ],
    },
  },
];

export class StatsTools {
  static async executeGetStorageStats(env: Env, userId: string, args: Record<string, unknown>) {
    const dimension = (args.dimension as string) || 'mimetype';
    const db = getDb(env.DB);

    const baseWhere = and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false));

    let result: any;

    switch (dimension) {
      case 'bucket': {
        const bucketRows = await db
          .select({
            bucketId: files.bucketId,
            totalSize: sql<number>`SUM(${files.size})`,
            fileCount: count(),
          })
          .from(files)
          .where(baseWhere)
          .groupBy(files.bucketId)
          .orderBy(desc(sql`SUM(${files.size})`))
          .all();
        result = {
          byBucket: bucketRows.map((b) => ({
            bucketId: b.bucketId || 'default',
            size: formatBytes(b.totalSize || 0),
            sizeBytes: b.totalSize || 0,
            fileCount: Number(b.fileCount) || 0,
          })),
        };
        break;
      }
      case 'month': {
        const monthRows = await db
          .select({
            month: sql<string>`SUBSTR(${files.createdAt}, 1, 7)`,
            totalSize: sql<number>`SUM(${files.size})`,
            fileCount: count(),
          })
          .from(files)
          .where(baseWhere)
          .groupBy(sql`SUBSTR(${files.createdAt}, 1, 7)`)
          .orderBy(sql`SUBSTR(${files.createdAt}, 1, 7)`)
          .limit(12)
          .all();
        result = {
          byMonth: monthRows.map((m) => ({
            month: m.month,
            size: formatBytes(m.totalSize || 0),
            sizeBytes: m.totalSize || 0,
            fileCount: Number(m.fileCount) || 0,
          })),
        };
        break;
      }
      default: {
        const mimeRows = await db
          .select({
            mimeType: files.mimeType,
            totalSize: sql<number>`SUM(${files.size})`,
            fileCount: count(),
          })
          .from(files)
          .where(baseWhere)
          .groupBy(files.mimeType)
          .orderBy(desc(sql`SUM(${files.size})`))
          .limit(20)
          .all();
        result = {
          byMimeType: mimeRows.map((m) => ({
            mimeType: m.mimeType || 'unknown',
            category: getMimeTypeCategory(m.mimeType),
            size: formatBytes(m.totalSize || 0),
            sizeBytes: m.totalSize || 0,
            fileCount: Number(m.fileCount) || 0,
          })),
        };
      }
    }

    const totalRow = await db
      .select({ totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)`, totalCount: count() })
      .from(files)
      .where(baseWhere)
      .get();

    return {
      total: {
        size: formatBytes(totalRow?.totalSize || 0),
        sizeBytes: totalRow?.totalSize || 0,
        fileCount: Number(totalRow?.totalCount) || 0,
      },
      dimension,
      ...result,
      _next_actions: [
        '如需了解大文件占用，调用 get_large_files 获取列表',
        '如需清理建议，调用 get_cleanup_suggestions',
        '如需按文件夹查看占用，调用 get_folder_sizes',
      ],
    };
  }

  static async executeGetActivityStats(env: Env, userId: string, args: Record<string, unknown>) {
    const period = (args.period as string) || 'day';
    const days = Math.min((args.days as number) || 30, 90);
    const db = getDb(env.DB);

    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let dateFormat: string;
    switch (period) {
      case 'week':
        dateFormat = '%Y-%W';
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      default:
        dateFormat = '%Y-%m-%d';
        break;
    }

    const activityRows = await db
      .select({
        period: sql<string>`strftime('${dateFormat}', ${files.createdAt})`,
        uploadCount: count(),
        uploadSize: sql<number>`SUM(${files.size})`,
      })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), gte(files.createdAt, sinceDate)))
      .groupBy(sql`strftime('${dateFormat}', ${files.createdAt})`)
      .orderBy(sql`strftime('${dateFormat}', ${files.createdAt})`)
      .all();

    const totals = activityRows.reduce(
      (acc, row) => ({
        uploads: acc.uploads + (Number(row.uploadCount) || 0),
        bytes: acc.bytes + (row.uploadSize || 0),
      }),
      { uploads: 0, bytes: 0 }
    );

    return {
      period,
      range: { days, since: sinceDate },
      total: {
        uploads: totals.uploads,
        size: formatBytes(totals.bytes),
        sizeBytes: totals.bytes,
        avgPerPeriod: Math.round(totals.uploads / Math.max(activityRows.length, 1)),
      },
      data: activityRows.map((r) => ({
        period: r.period,
        uploads: Number(r.uploadCount) || 0,
        size: formatBytes(r.uploadSize || 0),
        sizeBytes: r.uploadSize || 0,
      })),
      _next_actions: ['如需查看最近上传了哪些文件，调用 get_recent_files', '如需查看存储总量，调用 get_storage_stats'],
    };
  }

  static async executeGetUserQuotaInfo(env: Env, userId: string, _args: Record<string, unknown>) {
    const db = getDb(env.DB);

    const stats = await db
      .select({
        totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)`,
        fileCount: count(),
        folderCount: sql<number>`COUNT(*) FILTER (WHERE ${files.isFolder} = TRUE)`,
        withSummary: sql<number>`COUNT(*) FILTER (WHERE ${files.aiSummary} IS NOT NULL)`,
        withTags: sql<number>`COUNT(*) FILTER (WHERE ${files.aiTags} IS NOT NULL)`,
        starredCount: sql<number>`COUNT(*) FILTER (WHERE ${files.isStarred} = TRUE)`,
      })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    return {
      usedSpace: {
        bytes: stats?.totalSize || 0,
        formatted: formatBytes(stats?.totalSize || 0),
      },
      files: {
        total: Number(stats?.fileCount) || 0,
        folders: Number(stats?.folderCount) || 0,
        withAiSummary: Number(stats?.withSummary) || 0,
        withAiTags: Number(stats?.withTags) || 0,
        starred: Number(stats?.starredCount) || 0,
      },
      coverage: {
        summaryRate: stats?.fileCount
          ? ((Number(stats.withSummary) / Number(stats.fileCount)) * 100).toFixed(1) + '%'
          : '0%',
        tagsRate: stats?.fileCount ? ((Number(stats.withTags) / Number(stats.fileCount)) * 100).toFixed(1) + '%' : '0%',
      },
      _next_actions: [
        '如需详细空间分布，调用 get_storage_stats(dimension="mimetype")',
        '如需查看重复文件，调用 search_duplicates 释放冗余空间',
      ],
    };
  }

  static async executeGetFileTypeDistribution(env: Env, userId: string, args: Record<string, unknown>) {
    const groupBy = (args.groupBy as string) || 'category';
    const topN = Math.min((args.topN as number) || 20, 50);
    const db = getDb(env.DB);

    const baseWhere = and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false));

    let rows: any[];

    switch (groupBy) {
      case 'extension': {
        rows = await db
          .select({
            ext: sql<string>`CASE WHEN INSTR(${files.name}, '.') > 0 THEN SUBSTR(${files.name}, INSTR(${files.name}, '.')) ELSE '' END`,
            cnt: count(),
            totalSize: sql<number>`SUM(${files.size})`,
          })
          .from(files)
          .where(baseWhere)
          .groupBy(
            sql`CASE WHEN INSTR(${files.name}, '.') > 0 THEN SUBSTR(${files.name}, INSTR(${files.name}, '.')) ELSE '' END`
          )
          .orderBy(desc(count()))
          .limit(topN)
          .all();
        break;
      }
      default: {
        rows = await db
          .select({
            mimeType: files.mimeType,
            cnt: count(),
            totalSize: sql<number>`SUM(${files.size})`,
          })
          .from(files)
          .where(baseWhere)
          .groupBy(files.mimeType)
          .orderBy(desc(count()))
          .limit(topN)
          .all();
      }
    }

    const totalSize = rows.reduce((sum, r) => sum + (r.totalSize || 0), 0);
    const totalCount = rows.reduce((sum, r) => sum + (Number(r.cnt) || 0), 0);

    return {
      groupBy,
      total: { count: totalCount, size: formatBytes(totalSize) },
      distribution: rows.map((r, idx) => ({
        rank: idx + 1,
        label: groupBy === 'extension' ? r.ext || '(无扩展名)' : r.mimeType || 'unknown',
        category: groupBy !== 'extension' ? getMimeTypeCategory(r.mimeType) : undefined,
        count: Number(r.cnt) || 0,
        percentage: totalCount > 0 ? ((Number(r.cnt) / totalCount) * 100).toFixed(1) + '%' : '0%',
        size: formatBytes(r.totalSize || 0),
        sizePercentage: totalSize > 0 ? (((r.totalSize || 0) / totalSize) * 100).toFixed(1) + '%' : '0%',
      })),
      _next_actions: [
        '如需找出某类型的具体文件，调用 filter_files 并传入对应 mimeTypePrefix',
        '如需查看重复文件，调用 search_duplicates',
      ],
    };
  }

  static async executeGetSharingStats(env: Env, userId: string, args: Record<string, unknown>) {
    const includeExpired = args.includeExpired === true;
    const db = getDb(env.DB);

    const conditions: any[] = [eq(shares.userId, userId)];
    if (!includeExpired) {
      conditions.push(or(isNull(shares.expiresAt), gte(shares.expiresAt, new Date().toISOString())));
    }

    const [totalShares, activeShares] = await Promise.all([
      db
        .select({ total: count() })
        .from(shares)
        .where(and(...conditions))
        .get(),

      db
        .select({
          shareId: shares.id,
          fileId: shares.fileId,
          expiresAt: shares.expiresAt,
          isUploadLink: shares.isUploadLink,
          downloadCount: shares.downloadCount,
          createdAt: shares.createdAt,
        })
        .from(shares)
        .where(and(...conditions))
        .orderBy(desc(shares.downloadCount))
        .limit(10)
        .all(),
    ]);

    return {
      total: Number(totalShares?.total) || 0,
      includeExpired,
      topShares: (activeShares || []).map((s) => ({
        id: s.shareId,
        fileId: s.fileId,
        isUploadLink: s.isUploadLink,
        downloads: Number(s.downloadCount) || 0,
        expiresAt: s.expiresAt,
        isActive: !s.expiresAt || new Date(s.expiresAt) > new Date(),
        createdAt: s.createdAt,
      })),
      _next_actions: [
        '如需管理具体分享链接，调用 list_shares 获取完整列表',
        '如需撤销某条分享，调用 revoke_share 并传入 shareId',
      ],
    };
  }
}
