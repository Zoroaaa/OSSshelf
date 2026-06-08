/**
 * storage.ts
 *
 * 存储管理 API 服务层
 *
 * 包含模块：
 * - Buckets：存储桶管理（CRUD/测试连接/设默认/启停）
 * - Migrate：跨桶迁移（启动/查询/取消）
 * - Telegram：Telegram Bot 连接测试
 * - Analytics：存储分析（容量分布/活动热力图/大文件/趋势/桶统计）
 * - Search：文件搜索（语义搜索/高级搜索/建议/历史）
 */

import api from './api-client';
import type { ApiResponse, FileItem, FileSearchResult } from '@osshelf/shared';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 存储桶相关
// ─────────────────────────────────────────────────────────────────────────────

/** 存储桶实体 */
export interface StorageBucket {
  id: string;
  userId: string;
  name: string;
  provider: 'r2' | 's3' | 'oss' | 'cos' | 'obs' | 'b2' | 'minio' | 'custom' | 'telegram';
  bucketName: string;
  endpoint: string | null;
  region: string | null;
  accessKeyId: string;
  secretAccessKeyMasked: string;
  pathStyle: boolean;
  isDefault: boolean;
  isActive: boolean;
  storageUsed: number;
  storageQuota: number | null;
  fileCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 创建/更新存储桶的表单数据 */
export interface BucketFormData {
  name: string;
  provider: StorageBucket['provider'];
  bucketName: string;
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey?: string;
  pathStyle?: boolean;
  isDefault?: boolean;
  notes?: string;
  storageQuota?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 常量 — 存储提供商元信息
// ─────────────────────────────────────────────────────────────────────────────

/** 各存储提供商的元数据（标签、颜色、图标、区域列表、端点占位符） */
export const PROVIDER_META: Record<
  StorageBucket['provider'],
  {
    label: string;
    color: string;
    icon: string;
    regions?: string[];
    endpointPlaceholder?: string;
    regionRequired?: boolean;
  }
> = {
  r2: {
    label: 'Cloudflare R2',
    color: '#F6821F',
    icon: '☁️',
    endpointPlaceholder: 'https://<accountId>.r2.cloudflarestorage.com',
  },
  s3: {
    label: 'Amazon S3',
    color: '#FF9900',
    icon: '🪣',
    regions: [
      'us-east-1',
      'us-east-2',
      'us-west-1',
      'us-west-2',
      'ap-east-1',
      'ap-northeast-1',
      'ap-northeast-2',
      'ap-southeast-1',
      'ap-southeast-2',
      'eu-west-1',
      'eu-central-1',
      'sa-east-1',
    ],
    regionRequired: true,
  },
  oss: {
    label: 'Aliyun OSS',
    color: '#FF6A00',
    icon: '🌐',
    regions: [
      'cn-hangzhou',
      'cn-shanghai',
      'cn-beijing',
      'cn-shenzhen',
      'cn-hongkong',
      'ap-southeast-1',
      'ap-northeast-1',
      'us-west-1',
      'eu-central-1',
    ],
    regionRequired: true,
  },
  cos: {
    label: 'Tencent COS',
    color: '#1772F6',
    icon: '📦',
    regions: [
      'ap-guangzhou',
      'ap-shanghai',
      'ap-beijing',
      'ap-chengdu',
      'ap-chongqing',
      'ap-hongkong',
      'ap-singapore',
      'na-ashburn',
      'eu-frankfurt',
    ],
    regionRequired: true,
  },
  obs: {
    label: 'Huawei OBS',
    color: '#CF0A2C',
    icon: '🏔️',
    regions: ['cn-north-4', 'cn-east-3', 'cn-south-1', 'cn-southwest-2', 'ap-southeast-3'],
    regionRequired: true,
  },
  b2: {
    label: 'Backblaze B2',
    color: '#D01F2E',
    icon: '🔥',
    endpointPlaceholder: 'https://s3.us-west-004.backblazeb2.com',
  },
  minio: { label: 'MinIO', color: '#C72C41', icon: '🐘', endpointPlaceholder: 'http://your-minio-server:9000' },
  custom: {
    label: '自定义 S3 兼容',
    color: '#6B7280',
    icon: '⚙️',
    endpointPlaceholder: 'https://your-s3-endpoint.com',
  },
  telegram: {
    label: 'Telegram',
    color: '#26A5E4',
    icon: '✈️',
    endpointPlaceholder: 'https://api.telegram.org（可选，留空使用默认）',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Buckets — 存储桶管理
// ─────────────────────────────────────────────────────────────────────────────

export const bucketsApi = {
  list: () => api.get<ApiResponse<StorageBucket[]>>('/api/buckets'),
  providers: () => api.get<ApiResponse<Record<string, any>>>('/api/buckets/providers'),
  create: (data: BucketFormData) => api.post<ApiResponse<StorageBucket>>('/api/buckets', data),
  get: (id: string) => api.get<ApiResponse<StorageBucket>>(`/api/buckets/${id}`),
  update: (id: string, data: Partial<BucketFormData> & { storageQuota?: number | null }) =>
    api.put<ApiResponse<StorageBucket>>(`/api/buckets/${id}`, data),
  setDefault: (id: string) => api.post<ApiResponse<{ message: string }>>(`/api/buckets/${id}/set-default`),
  toggle: (id: string) => api.post<ApiResponse<{ isActive: boolean }>>(`/api/buckets/${id}/toggle`),
  test: (id: string) =>
    api.post<ApiResponse<{ connected: boolean; message: string; statusCode: number }>>(`/api/buckets/${id}/test`),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/buckets/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 迁移相关
// ─────────────────────────────────────────────────────────────────────────────

/** 迁移任务状态 */
export interface MigrationStatus {
  migrationId: string;
  userId: string;
  sourceBucketId: string;
  targetBucketId: string;
  targetFolderId: string | null;
  fileIds: string[];
  total: number;
  done: number;
  failed: number;
  results: Array<{
    fileId: string;
    fileName: string;
    status: 'pending' | 'done' | 'failed';
    error?: string;
    newR2Key?: string;
  }>;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migrate — 跨桶迁移
// ─────────────────────────────────────────────────────────────────────────────

export const migrateApi = {
  start: (params: {
    sourceBucketId: string;
    targetBucketId: string;
    fileIds?: string[];
    targetFolderId?: string | null;
    deleteSource?: boolean;
  }) =>
    api.post<ApiResponse<{ migrationId: string; total: number; status: string; message: string }>>(
      '/api/migrate/start',
      params
    ),
  get: (migrationId: string) => api.get<ApiResponse<MigrationStatus>>(`/api/migrate/${migrationId}`),
  cancel: (migrationId: string) => api.post<ApiResponse<{ message: string }>>(`/api/migrate/${migrationId}/cancel`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Telegram — Telegram Bot 连接
// ─────────────────────────────────────────────────────────────────────────────

export const telegramApi = {
  test: (data: { botToken: string; chatId: string; apiBase?: string }) =>
    api.post<ApiResponse<{ connected: boolean; message: string; botName?: string; chatTitle?: string }>>(
      '/api/telegram/test',
      data
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 分析统计相关
// ─────────────────────────────────────────────────────────────────────────────

/** 存储容量分解（按类型/MIME） */
export interface StorageBreakdown {
  totalSize: number;
  totalFiles: number;
  totalFolders: number;
  quota: number;
  used: number;
  byType: Array<{ type: string; count: number; size: number }>;
  byMimeType: Array<{ mimeType: string; count: number; size: number }>;
}

/** 活动热力图单日数据 */
export interface ActivityHeatmapItem {
  date: string;
  uploads: number;
  downloads: number;
  deletes: number;
  others: number;
}

/** 活动热力图响应 */
export interface ActivityHeatmap {
  days: number;
  heatmap: ActivityHeatmapItem[];
  summary: {
    totalUploads: number;
    totalDownloads: number;
    totalDeletes: number;
  };
}

/** 大文件条目 */
export interface LargeFileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  path: string | null;
  createdAt: string;
  updatedAt: string;
  bucketId: string | null;
  bucket: { id: string; name: string; provider: string } | null;
}

/** 存储趋势单日数据 */
export interface StorageTrendItem {
  date: string;
  uploadedSize: number;
  uploadedCount: number;
}

/** 存储趋势响应 */
export interface StorageTrend {
  days: number;
  trend: StorageTrendItem[];
}

/** 存储桶统计条目 */
export interface BucketStatItem {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
  isDefault: boolean;
  storageUsed: number;
  fileCount: number;
  actualFileCount: number;
  actualStorageUsed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics — 存储分析统计
// ─────────────────────────────────────────────────────────────────────────────

export const analyticsApi = {
  /** 获取存储容量分解（按类型和 MIME） */
  getStorageBreakdown: () => api.get<ApiResponse<StorageBreakdown>>('/api/analytics/storage-breakdown'),

  /** 获取活动热力图（上传/下载/删除） */
  getActivityHeatmap: (days = 30) =>
    api.get<ApiResponse<ActivityHeatmap>>('/api/analytics/activity-heatmap', { params: { days } }),

  /** 获取大文件列表 */
  getLargeFiles: (limit = 20) =>
    api.get<ApiResponse<LargeFileItem[]>>('/api/analytics/large-files', { params: { limit } }),

  /** 获取存储增长趋势 */
  getStorageTrend: (days = 30) =>
    api.get<ApiResponse<StorageTrend>>('/api/analytics/storage-trend', { params: { days } }),

  /** 获取各存储桶统计 */
  getBucketStats: () => api.get<ApiResponse<BucketStatItem[]>>('/api/analytics/bucket-stats'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Search — 文件搜索
// ─────────────────────────────────────────────────────────────────────────────

export const searchApi = {
  query: (params: {
    query?: string;
    parentId?: string;
    tags?: string[];
    mimeType?: string;
    minSize?: number;
    maxSize?: number;
    createdAfter?: string;
    createdBefore?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    isFolder?: boolean;
    bucketId?: string;
    sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
    semantic?: boolean;
    hybrid?: boolean;
    fts?: boolean;
  }) => api.get<ApiResponse<FileSearchResult>>('/api/search', { params }),

  advanced: (data: {
    conditions: Array<{
      field: 'name' | 'mimeType' | 'size' | 'createdAt' | 'updatedAt' | 'tags';
      operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
      value: string | number | string[];
    }>;
    logic?: 'and' | 'or';
    sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }) =>
    api.post<ApiResponse<{ items: FileItem[]; total: number; page: number; limit: number; totalPages: number }>>(
      '/api/search/advanced',
      data
    ),

  suggestions: (params: { q: string; type: 'name' | 'tags' | 'mime' }) =>
    api.get<ApiResponse<string[]>>('/api/search/suggestions', { params }),
  recent: () => api.get<ApiResponse<FileItem[]>>('/api/search/recent'),
  history: () => api.get<ApiResponse<Array<{ id: string; query: string; createdAt: string }>>>('/api/search/history'),
  deleteHistory: (id: string) => api.delete<ApiResponse<void>>(`/api/search/history/${id}`),
  clearHistory: () => api.delete<ApiResponse<void>>('/api/search/history'),
};
