/**
 * admin.ts
 *
 * 管理员功能 API 服务层
 *
 * 包含模块：
 * - 用户管理：查看/编辑/删除用户、修改角色/配额/密码
 * - 注册配置：开放注册开关、邀请码管理（生成/撤销）
 * - 全局统计：用户数/文件数/存储量/提供商分布
 * - 审计日志：分页查询操作记录
 * - 邮件服务：SMTP 配置/测试邮件/群发通知
 * - AI 追踪：AI 对话调用记录列表与详情
 * - 存储审计：S3 vs DB 一致性校验、孤立对象清理、缺失文件处理
 */

import api from './api-client';
import type { ApiResponse, AuditLog } from '@osshelf/shared';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 用户 & 统计 & 注册配置
// ─────────────────────────────────────────────────────────────────────────────

/** 管理员视角的用户信息 */
export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  storageQuota: number | null;
  storageUsed: number;
  fileCount: number;
  bucketCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 全局统计数据 */
export interface AdminStats {
  userCount: number;
  adminCount: number;
  fileCount: number;
  folderCount: number;
  bucketCount: number;
  totalStorageUsed: number;
  totalStorageQuota: number;
  providerBreakdown: Record<string, { bucketCount: number; storageUsed: number }>;
}

/** 注册配置 */
export interface RegistrationConfig {
  open: boolean;
  requireInviteCode: boolean;
  inviteCodes: Array<{ code: string; usedBy: string | null; createdAt: string | null }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — AI 追踪相关
// ─────────────────────────────────────────────────────────────────────────────

/** AI 追踪条目 */
export interface AITraceItem {
  id: string;
  traceId: string;
  userId: string;
  userName?: string;
  sessionId: string;
  query: string;
  modelId: string;
  status: 'running' | 'completed' | 'error' | 'aborted';
  toolCallCount: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
  createdAt: string;
  hasPlan: boolean;
}

/** AI 追踪详情（含工具调用和计划） */
export interface AITraceDetail extends AITraceItem {
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    durationMs: number;
    status: 'success' | 'error';
    timestamp: string;
  }>;
  plan?: { goal: string; steps: Array<{ id: string; description: string; status: string }> };
  reasoning?: string;
  memoryRecalled?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 存储审计相关
// ─────────────────────────────────────────────────────────────────────────────

/** 存储不匹配条目（孤立/缺失/大小不一致） */
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

/** 单个存储桶的审计结果 */
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

/** 修复建议 */
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

/** 审计摘要 */
export interface AuditSummary {
  healthScore: number;
  status: 'healthy' | 'warning' | 'critical' | 'error';
  topIssues: string[];
  quickStats: { wasteRatio: number; dataLossRisk: boolean; lastAuditAge: string };
}

/** 完整的存储审计报告 */
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
  cacheInfo?: { cached: boolean; ageMinutes: number };
}

/** 缺失文件详情 */
export interface MissingFileDetail {
  fileId: string;
  name: string;
  r2Key: string;
  size: number;
  parentId: string | null;
  path: string | null;
  mimeType: string | null;
  createdAt: string;
  folderPath: string | null;
}

/** 缺失文件详情响应 */
export interface MissingFileDetailResponse {
  bucketId: string;
  bucketName: string;
  provider: string;
  missingCount: number;
  files: MissingFileDetail[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — 管理员 API
// ─────────────────────────────────────────────────────────────────────────────

export const adminApi = {
  // ── 用户管理 ──
  getUser: (id: string) => api.get<ApiResponse<AdminUser>>(`/api/admin/users/${id}`),
  listUsers: () => api.get<ApiResponse<AdminUser[]>>('/api/admin/users'),
  patchUser: (
    id: string,
    data: { name?: string; role?: 'admin' | 'user'; storageQuota?: number | null; newPassword?: string }
  ) => api.patch<ApiResponse<{ message: string }>>(`/api/admin/users/${id}`, data),
  deleteUser: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/admin/users/${id}`),

  // ── 注册配置 ──
  getRegistration: () => api.get<ApiResponse<RegistrationConfig>>('/api/admin/registration'),
  setRegistration: (data: { open?: boolean; requireInviteCode?: boolean }) =>
    api.put<ApiResponse<RegistrationConfig>>('/api/admin/registration', data),
  generateCodes: (count = 1) =>
    api.post<ApiResponse<{ codes: string[]; createdAt: string }>>('/api/admin/registration/codes', { count }),
  revokeCode: (code: string) => api.delete<ApiResponse<{ message: string }>>(`/api/admin/registration/codes/${code}`),

  // ── 统计 & 审计日志 ──
  stats: () => api.get<ApiResponse<AdminStats>>('/api/admin/stats'),
  auditLogs: (params?: { userId?: string; action?: string; page?: number; limit?: number }) =>
    api.get<ApiResponse<{ items: AuditLog[]; total: number; page: number; limit: number }>>('/api/admin/audit-logs', {
      params,
    }),

  // ── 邮件服务 ──
  getEmailConfig: () =>
    api.get<ApiResponse<{ apiKey?: string; fromAddress?: string; fromName?: string; configured?: boolean } | null>>(
      '/api/admin/email/config'
    ),
  setEmailConfig: (data: { apiKey: string; fromAddress: string; fromName: string }) =>
    api.put<ApiResponse<{ message: string }>>('/api/admin/email/config', data),
  testEmail: (data?: { to?: string }) => api.post<ApiResponse<{ message: string }>>('/api/admin/email/test', data),
  broadcastEmail: (data: { subject: string; body: string; userFilter?: { role?: string; active?: boolean } }) =>
    api.post<ApiResponse<{ message: string; total: number; successCount: number; failCount: number }>>(
      '/api/admin/email/broadcast',
      data
    ),

  // ── AI 追踪 ──
  aiTraceList: (params?: { userId?: string; sessionId?: string; modelId?: string; page?: number; limit?: number }) =>
    api.get<ApiResponse<{ items: AITraceItem[]; total: number; page: number; limit: number }>>('/api/admin/ai/traces', {
      params,
    }),
  aiTraceDetail: (traceId: string) => api.get<ApiResponse<AITraceDetail>>(`/api/admin/ai/traces/${traceId}`),

  // ── 存储审计 ──
  storageAudit: () => api.get<ApiResponse<StorageAuditReport>>('/api/admin/storage-audit'),
  storageAuditForce: () => api.post<ApiResponse<StorageAuditReport>>('/api/admin/storage-audit/force'),

  /** 清理孤立对象 */
  cleanupOrphans: (data: { bucketId: string; keys?: string[]; mode?: 'all' | 'selected' }) =>
    api.post<
      ApiResponse<{
        deletedCount: number;
        deletedKeys: string[];
        failedKeys: Array<{ key: string; error: string }>;
        totalSizeBytes: number;
      }>
    >('/api/admin/storage-audit/cleanup-orphans', data),

  /** 获取缺失文件详情 */
  getMissingFiles: (bucketId: string) =>
    api.get<ApiResponse<MissingFileDetailResponse>>(`/api/admin/storage-audit/missing-files/${bucketId}`),
};
