/**
 * analytics.ts
 * 存储分析路由
 *
 * 功能:
 * - 存储空间分布统计
 * - 活跃度热力图
 * - 大文件列表
 * - 存储趋势分析
 */

import { Hono } from 'hono';
import { eq, and, isNull, sql, desc, gte, lte } from 'drizzle-orm';
import { getDb, files, users, storageBuckets, auditLogs } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

app.get('/storage-breakdown', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const userFiles = await db
    .select({
      mimeType: files.mimeType,
      size: files.size,
      isFolder: files.isFolder,
    })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const byType: Record<string, { count: number; size: number }> = {};
  const byMimeType: Record<string, { count: number; size: number }> = {};
  let totalSize = 0;
  let totalFiles = 0;
  let totalFolders = 0;

  for (const file of userFiles) {
    if (file.isFolder) {
      totalFolders++;
      continue;
    }
    totalFiles++;
    totalSize += file.size;

    const type = file.mimeType?.split('/')[0] || 'other';
    if (!byType[type]) byType[type] = { count: 0, size: 0 };
    byType[type].count++;
    byType[type].size += file.size;

    const mime = file.mimeType || 'unknown';
    if (!byMimeType[mime]) byMimeType[mime] = { count: 0, size: 0 };
    byMimeType[mime].count++;
    byMimeType[mime].size += file.size;
  }

  const typeList = Object.entries(byType)
    .map(([type, data]) => ({ type, ...data }))
    .sort((a, b) => b.size - a.size);

  const mimeTypeList = Object.entries(byMimeType)
    .map(([mimeType, data]) => ({ mimeType, ...data }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 20);

  const user = await db.select().from(users).where(eq(users.id, userId)).get();

  return c.json({
    success: true,
    data: {
      totalSize,
      totalFiles,
      totalFolders,
      quota: user?.storageQuota || 0,
      used: user?.storageUsed || 0,
      byType: typeList,
      byMimeType: mimeTypeList,
    },
  });
});

app.get('/activity-heatmap', async (c) => {
  const userId = c.get('userId')!;
  const days = parseInt(c.req.query('days') || '30', 10);
  const db = getDb(c.env.DB);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString();

  const activities = await db
    .select({
      action: auditLogs.action,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.userId, userId), gte(auditLogs.createdAt, startDateStr)))
    .all();

  const heatmap: Record<string, { uploads: number; downloads: number; deletes: number; others: number }> = {};

  for (const activity of activities) {
    const date = activity.createdAt.split('T')[0];
    if (!heatmap[date]) heatmap[date] = { uploads: 0, downloads: 0, deletes: 0, others: 0 };

    if (activity.action.includes('upload') || activity.action.includes('create')) {
      heatmap[date].uploads++;
    } else if (activity.action.includes('download')) {
      heatmap[date].downloads++;
    } else if (activity.action.includes('delete')) {
      heatmap[date].deletes++;
    } else {
      heatmap[date].others++;
    }
  }

  const result = Object.entries(heatmap)
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return c.json({
    success: true,
    data: {
      days,
      heatmap: result,
      summary: {
        totalUploads: result.reduce((sum, d) => sum + d.uploads, 0),
        totalDownloads: result.reduce((sum, d) => sum + d.downloads, 0),
        totalDeletes: result.reduce((sum, d) => sum + d.deletes, 0),
      },
    },
  });
});

app.get('/large-files', async (c) => {
  const userId = c.get('userId')!;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const db = getDb(c.env.DB);

  const largeFiles = await db
    .select({
      id: files.id,
      name: files.name,
      size: files.size,
      mimeType: files.mimeType,
      path: files.path,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
      bucketId: files.bucketId,
    })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .orderBy(desc(files.size))
    .limit(limit)
    .all();

  const bucketIds = [...new Set(largeFiles.map((f) => f.bucketId).filter(Boolean))] as string[];
  const bucketMap: Record<string, { id: string; name: string; provider: string }> = {};
  if (bucketIds.length > 0) {
    const bucketRows = await db
      .select({ id: storageBuckets.id, name: storageBuckets.name, provider: storageBuckets.provider })
      .from(storageBuckets)
      .where(sql`${storageBuckets.id} IN ${bucketIds}`)
      .all();
    for (const b of bucketRows) bucketMap[b.id] = b;
  }

  const items = largeFiles.map((f) => ({
    ...f,
    bucket: f.bucketId ? (bucketMap[f.bucketId] ?? null) : null,
  }));

  return c.json({
    success: true,
    data: items,
  });
});

app.get('/storage-trend', async (c) => {
  const userId = c.get('userId')!;
  const days = parseInt(c.req.query('days') || '30', 10);
  const db = getDb(c.env.DB);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString();

  const uploads = await db
    .select({
      date: sql<string>`date(${auditLogs.createdAt})`,
      totalSize: sql<number>`SUM(CAST(${auditLogs.details}->>'$.size' AS INTEGER))`,
      count: sql<number>`COUNT(*)`,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        gte(auditLogs.createdAt, startDateStr),
        sql`${auditLogs.action} LIKE '%upload%' OR ${auditLogs.action} LIKE '%create%'`
      )
    )
    .groupBy(sql`date(${auditLogs.createdAt})`)
    .all();

  const trend = uploads.map((u) => ({
    date: u.date,
    uploadedSize: u.totalSize || 0,
    uploadedCount: u.count || 0,
  }));

  return c.json({
    success: true,
    data: {
      days,
      trend,
    },
  });
});

app.get('/bucket-stats', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const buckets = await db.select().from(storageBuckets).where(eq(storageBuckets.userId, userId)).all();

  const stats = await Promise.all(
    buckets.map(async (bucket) => {
      const fileStats = await db
        .select({
          count: sql<number>`COUNT(*)`,
          totalSize: sql<number>`SUM(${files.size})`,
        })
        .from(files)
        .where(and(eq(files.bucketId, bucket.id), isNull(files.deletedAt), eq(files.isFolder, false)))
        .get();

      return {
        id: bucket.id,
        name: bucket.name,
        provider: bucket.provider,
        isActive: bucket.isActive,
        isDefault: bucket.isDefault,
        storageUsed: bucket.storageUsed,
        fileCount: bucket.fileCount,
        actualFileCount: fileStats?.count || 0,
        actualStorageUsed: fileStats?.totalSize || 0,
      };
    })
  );

  return c.json({
    success: true,
    data: stats,
  });
});

export default app;
