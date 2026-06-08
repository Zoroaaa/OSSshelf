/**
 * storageAuditService.ts
 * 存储桶与数据库文件一致性审计服务
 *
 * 功能:
 * - 反查S3/R2/B2存储桶所有文件（自动选择V1/V2 API）
 * - 与数据库files/fileVersions表记录对比
 * - 自动过滤Telegram存储桶（不参与S3兼容存储分析）
 * - 检测孤儿文件(存储有DB无)和丢失文件(DB有存储无)
 * - 生成数据分析报告与整改建议
 */

import { eq, and, isNull, inArray } from 'drizzle-orm';
import { getDb, files, fileVersions, storageBuckets } from '../db';
import { makeBucketConfigAsync } from './s3client';
import { s3ListObjects, type ListObjectsResult } from './s3client';
import { getEncryptionKey } from './crypto';
import { logger } from '@osshelf/shared';

export interface StorageMismatchItem {
  r2Key: string;
  bucketId: string;
  bucketName: string;
  size?: number;
  dbFileId?: string;
  dbFileName?: string;
  dbFileSize?: number;
  s3Size?: number;
}

export interface BucketAuditResult {
  bucketId: string;
  bucketName: string;
  provider: string;

  skipped: boolean;
  skipReason?: string;

  connected: boolean;
  errorMessage?: string;

  s3ObjectCount: number;
  s3TotalSizeBytes: number;

  dbFileCount: number;
  dbTotalSizeBytes: number;

  orphanFiles: StorageMismatchItem[];
  missingFiles: StorageMismatchItem[];
  sizeMismatchFiles: Array<StorageMismatchItem & { dbSize: number; s3Size: number; diffBytes: number }>;

  matchedFiles: number;
  consistencyRate: number;
}

export interface StorageAuditReport {
  auditId: string;
  executedAt: string;
  durationMs: number;

  totalBuckets: number;
  auditedBuckets: number;
  skippedBuckets: number;
  failedBuckets: number;

  totalS3Objects: number;
  totalS3SizeBytes: number;
  totalDbFiles: number;
  totalDbSizeBytes: number;

  totalOrphanFiles: number;
  totalOrphanSizeBytes: number;
  totalMissingFiles: number;
  totalMissingSizeBytes: number;
  totalSizeMismatches: number;

  overallConsistencyRate: number;
  buckets: BucketAuditResult[];

  summary: AuditSummary;
  recommendations: RemediationRecommendation[];
}

export interface RemediationRecommendation {
  id: string;
  category: 'orphan_cleanup' | 'missing_recovery' | 'size_sync' | 'db_repair' | 'bucket_config';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  affectedCount: number;
  affectedSizeBytes: number;
  action: string;
  riskLevel: 'safe' | 'caution' | 'dangerous';
  estimatedTime: string;
}

export interface AuditSummary {
  healthScore: number;
  status: 'healthy' | 'warning' | 'critical' | 'error';
  topIssues: string[];
  quickStats: {
    wasteRatio: number;
    dataLossRisk: boolean;
    lastAuditAge: string;
  };
}

const S3_COMPATIBLE_PROVIDERS = new Set(['s3', 'r2', 'b2', 'oss', 'cos', 'obs', 'minio']);
const NON_S3_PROVIDERS = new Set(['telegram']);
const TG_BUCKET_NAME_PATTERN = /^-?\d+$/;

function isTelegramBucket(bucket: typeof storageBuckets.$inferSelect): boolean {
  if (NON_S3_PROVIDERS.has(bucket.provider)) return true;
  if (TG_BUCKET_NAME_PATTERN.test(bucket.bucketName)) return true;
  return false;
}

function isS3CompatibleBucket(bucket: typeof storageBuckets.$inferSelect): boolean {
  if (isTelegramBucket(bucket)) return false;
  if (S3_COMPATIBLE_PROVIDERS.has(bucket.provider)) return true;
  if (bucket.endpoint && bucket.endpoint.length > 0) return true;
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function calculateConsistencyRate(
  s3Count: number,
  dbCount: number,
  orphanCount: number,
  missingCount: number,
  sizeMismatchCount: number
): number {
  if (s3Count === 0 && dbCount === 0) return 100;
  const totalUnique = s3Count + dbCount - Math.min(s3Count, dbCount);
  if (totalUnique === 0) return 100;
  const matched = Math.min(s3Count, dbCount) - Math.max(orphanCount, missingCount) - sizeMismatchCount;
  return Math.max(0, Math.min(100, (matched / totalUnique) * 100));
}

function generateHealthScore(report: StorageAuditReport): number {
  const totalFiles = report.totalS3Objects + report.totalDbFiles;
  if (totalFiles === 0) return 100;

  let score = 100;
  score -= report.totalOrphanFiles * 2;
  score -= report.totalMissingFiles * 10;
  score -= report.totalSizeMismatches * 3;
  score -= report.failedBuckets * 15;

  const inconsistencyRatio =
    (report.totalOrphanFiles + report.totalMissingFiles + report.totalSizeMismatches) / Math.max(totalFiles, 1);
  score -= inconsistencyRatio * 20;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function generateRecommendations(report: StorageAuditReport): RemediationRecommendation[] {
  const recommendations: RemediationRecommendation[] = [];

  if (report.totalOrphanFiles > 0) {
    recommendations.push({
      id: 'rec-001',
      category: 'orphan_cleanup',
      severity: report.totalOrphanFiles > 100 ? 'high' : report.totalOrphanFiles > 10 ? 'medium' : 'low',
      title: `清理 ${report.totalOrphanFiles} 个孤儿文件`,
      description: `发现 ${report.totalOrphanFiles} 个存在于存储桶但数据库中无记录的文件，占用空间 ${formatBytes(report.totalOrphanSizeBytes)}。这些可能是上传中断、删除操作未完成或数据迁移遗留的文件。`,
      affectedCount: report.totalOrphanFiles,
      affectedSizeBytes: report.totalOrphanSizeBytes,
      action: '使用提供的清理API批量删除孤儿文件，或在确认无业务影响后手动清理',
      riskLevel: 'dangerous',
      estimatedTime: `${Math.ceil(report.totalOrphanFiles / 50)} 分钟`,
    });
  }

  if (report.totalMissingFiles > 0) {
    recommendations.push({
      id: 'rec-002',
      category: 'missing_recovery',
      severity: report.totalMissingFiles > 50 ? 'critical' : report.totalMissingFiles > 10 ? 'high' : 'medium',
      title: `恢复 ${report.totalMissingFiles} 个丢失文件`,
      description: `发现 ${report.totalMissingFiles} 个在数据库中有记录但存储桶中不存在的文件（共 ${formatBytes(report.totalMissingSizeBytes)}）。这可能导致用户无法下载文件，属于数据完整性问题。`,
      affectedCount: report.totalMissingFiles,
      affectedSizeBytes: report.totalMissingSizeBytes,
      action: '检查是否有备份可恢复，确认后更新数据库状态或将文件标记为已损坏',
      riskLevel: 'caution',
      estimatedTime: `${Math.ceil(report.totalMissingFiles / 20)} 分钟`,
    });
  }

  if (report.totalSizeMismatches > 0) {
    recommendations.push({
      id: 'rec-003',
      category: 'size_sync',
      severity: 'medium',
      title: `同步 ${report.totalSizeMismatches} 个大小不一致的文件`,
      description: `发现 ${report.totalSizeMismatches} 个文件的数据库记录大小与存储实际大小不匹配。这可能导致存储配额计算不准确。`,
      affectedCount: report.totalSizeMismatches,
      affectedSizeBytes: 0,
      action: '以存储桶实际大小为准更新数据库记录，或重新校验文件哈希值',
      riskLevel: 'safe',
      estimatedTime: `${Math.ceil(report.totalSizeMismatches / 30)} 分钟`,
    });
  }

  if (report.failedBuckets > 0) {
    recommendations.push({
      id: 'rec-004',
      category: 'bucket_config',
      severity: 'critical',
      title: `修复 ${report.failedBuckets} 个无法连接的存储桶`,
      description: `有 ${report.failedBuckets} 个S3兼容存储桶连接失败，请检查凭证、Endpoint配置和网络连通性。`,
      affectedCount: report.failedBuckets,
      affectedSizeBytes: 0,
      action: '验证存储桶凭证有效性、检查区域配置、测试网络连接（注意：B2需要使用S3兼容API密钥）',
      riskLevel: 'safe',
      estimatedTime: '5-10 分钟/桶',
    });
  }

  if (report.overallConsistencyRate < 95 && report.overallConsistencyRate >= 80 && report.totalMissingFiles === 0) {
    recommendations.push({
      id: 'rec-005',
      category: 'db_repair',
      severity: 'low',
      title: '建议定期执行存储审计',
      description: `当前一致性率为 ${report.overallConsistencyRate.toFixed(1)}%，建议设置定期审计任务以持续监控数据一致性。`,
      affectedCount: 0,
      affectedSizeBytes: 0,
      action: '配置Cron Trigger定期执行审计，建议频率：每周一次',
      riskLevel: 'safe',
      estimatedTime: '一次性配置',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: 'rec-000',
      category: 'db_repair',
      severity: 'info',
      title: '存储数据完全一致',
      description: '所有S3兼容存储桶文件与数据库记录完全匹配，无需整改操作。',
      affectedCount: 0,
      affectedSizeBytes: 0,
      action: '继续保持当前运维规范，建议定期执行审计以预防问题',
      riskLevel: 'safe',
      estimatedTime: '-',
    });
  }

  return recommendations;
}

export async function performStorageAudit(env: {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
}): Promise<StorageAuditReport> {
  const startTime = Date.now();
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const db = getDb(env.DB);
  const encKey = getEncryptionKey(env);

  const allBuckets = await db.select().from(storageBuckets).where(eq(storageBuckets.isActive, true)).all();

  const s3Buckets = allBuckets.filter((b) => isS3CompatibleBucket(b));
  const tgBuckets = allBuckets.filter((b) => isTelegramBucket(b));

  logger.info('STORAGE_AUDIT', '开始存储审计', {
    totalBuckets: allBuckets.length,
    s3Buckets: s3Buckets.length,
    tgBucketsSkipped: tgBuckets.length,
    auditId,
  });

  const bucketResults: BucketAuditResult[] = [];
  let failedBucketCount = 0;
  let skippedBucketCount = 0;
  let totalS3Objects = 0;
  let totalS3Size = 0;
  let totalDbFiles = 0;
  let totalDbSize = 0;
  let totalOrphans = 0;
  let totalOrphanSize = 0;
  let totalMissing = 0;
  let totalMissingSize = 0;
  let totalSizeMismatches = 0;

  for (const tgBucket of tgBuckets) {
    bucketResults.push({
      bucketId: tgBucket.id,
      bucketName: tgBucket.bucketName,
      provider: tgBucket.provider,

      skipped: true,
      skipReason: 'Telegram存储桶不参与S3兼容存储分析',

      connected: false,
      s3ObjectCount: 0,
      s3TotalSizeBytes: 0,
      dbFileCount: 0,
      dbTotalSizeBytes: 0,
      orphanFiles: [],
      missingFiles: [],
      sizeMismatchFiles: [],
      matchedFiles: 0,
      consistencyRate: 100,
    });
    skippedBucketCount++;
  }

  for (const bucket of s3Buckets) {
    const bucketResult = await auditSingleBucket(db, bucket, encKey);
    bucketResults.push(bucketResult);

    if (!bucketResult.connected) {
      failedBucketCount++;
    }

    totalS3Objects += bucketResult.s3ObjectCount;
    totalS3Size += bucketResult.s3TotalSizeBytes;
    totalDbFiles += bucketResult.dbFileCount;
    totalDbSize += bucketResult.dbTotalSizeBytes;
    totalOrphans += bucketResult.orphanFiles.length;
    totalOrphanSize += bucketResult.orphanFiles.reduce((sum, f) => sum + (f.s3Size || 0), 0);
    totalMissing += bucketResult.missingFiles.length;
    totalMissingSize += bucketResult.missingFiles.reduce((sum, f) => sum + (f.dbFileSize || 0), 0);
    totalSizeMismatches += bucketResult.sizeMismatchFiles.length;
  }

  const durationMs = Date.now() - startTime;
  const overallConsistencyRate = calculateConsistencyRate(
    totalS3Objects,
    totalDbFiles,
    totalOrphans,
    totalMissing,
    totalSizeMismatches
  );

  const report: StorageAuditReport = {
    auditId,
    executedAt: new Date().toISOString(),
    durationMs,

    totalBuckets: allBuckets.length,
    auditedBuckets: s3Buckets.length - failedBucketCount,
    skippedBuckets: skippedBucketCount,
    failedBuckets: failedBucketCount,

    totalS3Objects,
    totalS3SizeBytes: totalS3Size,
    totalDbFiles,
    totalDbSizeBytes: totalDbSize,

    totalOrphanFiles: totalOrphans,
    totalOrphanSizeBytes: totalOrphanSize,
    totalMissingFiles: totalMissing,
    totalMissingSizeBytes: totalMissingSize,
    totalSizeMismatches,

    overallConsistencyRate,
    buckets: bucketResults,

    summary: {
      healthScore: 0,
      status: 'healthy' as const,
      topIssues: [],
      quickStats: { wasteRatio: 0, dataLossRisk: false, lastAuditAge: '' },
    },
    recommendations: [],
  };

  const finalSummary = generateSummary(report);
  report.summary = finalSummary;
  report.recommendations = generateRecommendations(report);

  logger.info('STORAGE_AUDIT', '存储审计完成', {
    auditId,
    durationMs,
    overallConsistencyRate: report.overallConsistencyRate.toFixed(2),
    s3Buckets: s3Buckets.length,
    failedBuckets: failedBucketCount,
    skippedTg: skippedBucketCount,
    totalOrphans,
    totalMissing,
    totalSizeMismatches,
  });

  try {
    await env.KV.put(`audit:last_report`, JSON.stringify(report), { expirationTtl: 86400 * 7 });
  } catch (cacheError) {
    logger.warn('STORAGE_AUDIT', '缓存审计报告失败', {}, cacheError);
  }

  return report;
}

async function auditSingleBucket(
  db: ReturnType<typeof getDb>,
  bucketRow: typeof storageBuckets.$inferSelect,
  encKey: string
): Promise<BucketAuditResult> {
  const bucketId = bucketRow.id;
  const bucketName = bucketRow.bucketName;
  const provider = bucketRow.provider;

  let s3Result: ListObjectsResult = { objects: [], isTruncated: false, objectCount: 0, totalSizeBytes: 0 };
  let connectionError: string | null = null;

  try {
    const config = await makeBucketConfigAsync(bucketRow, encKey, db);

    logger.info('STORAGE_AUDIT', `正在列出存储桶 ${bucketName} 文件`, {
      bucketId,
      provider,
      endpoint: config.endpoint || '(auto)',
    });

    s3Result = await s3ListObjects(config);
  } catch (error) {
    connectionError = (error as Error).message || String(error);
    logger.error('STORAGE_AUDIT', `存储桶 ${bucketName} 列表获取失败`, { bucketId, provider }, error);
  }

  const dbFiles = await db
    .select({ id: files.id, name: files.name, r2Key: files.r2Key, size: files.size, bucketId: files.bucketId })
    .from(files)
    .where(and(eq(files.bucketId, bucketId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .all();

  const bucketFileIds = dbFiles.map((f) => f.id);

  const BATCH_SIZE = 100;
  const dbVersionFiles: Array<{
    id: string;
    fileId: string;
    r2Key: string | null;
    size: number;
  }> = [];

  if (bucketFileIds.length > 0) {
    logger.info('STORAGE_AUDIT', `查询文件版本记录`, {
      bucketId,
      totalFileIds: bucketFileIds.length,
      batchCount: Math.ceil(bucketFileIds.length / BATCH_SIZE),
    });

    for (let i = 0; i < bucketFileIds.length; i += BATCH_SIZE) {
      const batch = bucketFileIds.slice(i, i + BATCH_SIZE);
      try {
        const batchResults = await db
          .select({
            id: fileVersions.id,
            fileId: fileVersions.fileId,
            r2Key: fileVersions.r2Key,
            size: fileVersions.size,
          })
          .from(fileVersions)
          .where(inArray(fileVersions.fileId, batch))
          .all();
        dbVersionFiles.push(...batchResults);
      } catch (batchError) {
        logger.error(
          'STORAGE_AUDIT',
          `文件版本批次查询失败 (batch ${i}-${i + batch.length}, size=${batch.length})`,
          { bucketId, batchStart: i, batchSize: batch.length },
          batchError
        );
        throw new Error(`文件版本查询超出D1限制，当前桶文件数过多(${bucketFileIds.length}个)，建议分批审计`);
      }
    }

    logger.info('STORAGE_AUDIT', `文件版本查询完成`, { totalVersions: dbVersionFiles.length });
  }

  const allDbR2Keys = new Map<string, { fileId: string; fileName: string; fileSize: number }>();
  for (const f of dbFiles) {
    if (f.r2Key) {
      allDbR2Keys.set(f.r2Key, { fileId: f.id, fileName: f.name, fileSize: f.size });
    }
  }
  for (const v of dbVersionFiles) {
    if (v.r2Key && !allDbR2Keys.has(v.r2Key)) {
      allDbR2Keys.set(v.r2Key, { fileId: v.fileId, fileName: `[版本]${v.fileId}`, fileSize: v.size });
    }
  }

  const s3KeySet = new Set<string>();
  for (const obj of s3Result.objects) {
    s3KeySet.add(obj.key);
  }

  const orphanFiles: StorageMismatchItem[] = [];
  const missingFiles: StorageMismatchItem[] = [];
  const sizeMismatchFiles: Array<StorageMismatchItem & { dbSize: number; s3Size: number; diffBytes: number }> = [];

  for (const obj of s3Result.objects) {
    if (!allDbR2Keys.has(obj.key)) {
      orphanFiles.push({
        r2Key: obj.key,
        bucketId,
        bucketName,
        size: obj.size,
        s3Size: obj.size,
      });
    } else {
      const dbRecord = allDbR2Keys.get(obj.key)!;
      if (dbRecord.fileSize !== obj.size && dbRecord.fileSize !== 0) {
        sizeMismatchFiles.push({
          r2Key: obj.key,
          bucketId,
          bucketName,
          dbFileId: dbRecord.fileId,
          dbFileName: dbRecord.fileName,
          dbFileSize: dbRecord.fileSize,
          s3Size: obj.size,
          dbSize: dbRecord.fileSize,
          diffBytes: Math.abs(dbRecord.fileSize - obj.size),
        });
      }
    }
  }

  for (const [r2Key, dbRecord] of allDbR2Keys) {
    if (!s3KeySet.has(r2Key)) {
      missingFiles.push({
        r2Key,
        bucketId,
        bucketName,
        dbFileId: dbRecord.fileId,
        dbFileName: dbRecord.fileName,
        dbFileSize: dbRecord.fileSize,
      });
    }
  }

  const matchedFiles = s3Result.objects.length - orphanFiles.length - sizeMismatchFiles.length;
  const consistencyRate = calculateConsistencyRate(
    s3Result.objects.length,
    dbFiles.length + dbVersionFiles.length,
    orphanFiles.length,
    missingFiles.length,
    sizeMismatchFiles.length
  );

  return {
    bucketId,
    bucketName,
    provider,

    skipped: false,

    connected: connectionError === null,
    errorMessage: connectionError ?? undefined,

    s3ObjectCount: s3Result.objects.length,
    s3TotalSizeBytes: s3Result.totalSizeBytes,

    dbFileCount: dbFiles.length + dbVersionFiles.length,
    dbTotalSizeBytes: dbFiles.reduce((sum, f) => sum + f.size, 0) + dbVersionFiles.reduce((sum, v) => sum + v.size, 0),

    orphanFiles,
    missingFiles,
    sizeMismatchFiles,

    matchedFiles: Math.max(0, matchedFiles),
    consistencyRate,
  };
}

function generateSummary(report: StorageAuditReport): AuditSummary {
  const healthScore = generateHealthScore(report);

  let status: 'healthy' | 'warning' | 'critical' | 'error' = 'healthy';
  if (healthScore >= 90) status = 'healthy';
  else if (healthScore >= 70) status = 'warning';
  else if (healthScore >= 40) status = 'critical';
  else status = 'error';

  const topIssues: string[] = [];

  if (report.totalMissingFiles > 0) {
    topIssues.push(`${report.totalMissingFiles} 个文件在存储中丢失（数据完整性风险）`);
  }
  if (report.totalOrphanFiles > 0) {
    topIssues.push(`${report.totalOrphanFiles} 个孤儿文件占用 ${formatBytes(report.totalOrphanSizeBytes)} 空间`);
  }
  if (report.failedBuckets > 0) {
    topIssues.push(`${report.failedBuckets} 个存储桶连接失败（S3/R2/B2读取异常）`);
  }
  if (report.skippedBuckets > 0) {
    topIssues.push(`${report.skippedBuckets} 个Telegram存储桶已跳过（非S3兼容）`);
  }
  if (topIssues.length === 0) {
    topIssues.push('所有S3兼容存储桶数据一致');
  }

  const totalStorage = report.totalS3SizeBytes + report.totalDbSizeBytes;
  const wasteRatio = totalStorage > 0 ? (report.totalOrphanSizeBytes / totalStorage) * 100 : 0;

  return {
    healthScore,
    status,
    topIssues: topIssues.slice(0, 5),
    quickStats: {
      wasteRatio: Math.round(wasteRatio * 100) / 100,
      dataLossRisk: report.totalMissingFiles > 0,
      lastAuditAge: '刚刚',
    },
  };
}

export async function getLastAuditReport(kv: KVNamespace): Promise<StorageAuditReport | null> {
  try {
    const cached = await kv.get('audit:last_report');
    if (!cached) return null;
    return JSON.parse(cached) as StorageAuditReport;
  } catch {
    return null;
  }
}
