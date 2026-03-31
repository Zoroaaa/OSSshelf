/**
 * api.ts
 * API服务层 — Phase 6 更新
 *
 * 新增：
 * - shareApi：文件夹浏览、ZIP下载、子文件下载、上传链接（创建/信息/上传）
 * - migrateApi：存储桶迁移（启动/查询/取消）
 */

import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import type {
  User,
  FileItem,
  Share,
  ApiResponse,
  AuthLoginParams,
  AuthRegisterParams,
  UploadedFile,
  AuthResponse,
  FileListParams,
  ShareCreateParams,
  UploadTask,
  DownloadTask,
  BatchOperationResult,
  FileSearchResult,
  FileTag,
  UserDevice,
  AuditLog,
} from '@osshelf/shared';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url: string = error.config?.url || '';
      const isPublicEndpoint =
        url.includes('/api/share/') ||
        url.includes('/api/direct/') ||
        url.includes('/api/auth/login') ||
        url.includes('/api/auth/register');
      if (!isPublicEndpoint) {
        const { isAuthenticated } = useAuthStore.getState();
        if (isAuthenticated) {
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (params: AuthLoginParams) => api.post<ApiResponse<AuthResponse>>('/api/auth/login', params),
  register: (params: AuthRegisterParams) => api.post<ApiResponse<AuthResponse>>('/api/auth/register', params),
  logout: () => api.post<ApiResponse<{ message: string }>>('/api/auth/logout'),
  me: () => api.get<ApiResponse<User>>('/api/auth/me'),
  patchMe: (data: { name?: string; currentPassword?: string; newPassword?: string }) =>
    api.patch<ApiResponse<User>>('/api/auth/me', data),
  deleteMe: (password: string) => api.delete<ApiResponse<{ message: string }>>('/api/auth/me', { data: { password } }),
  stats: () => api.get<ApiResponse<DashboardStats>>('/api/auth/stats'),
  getRegistrationConfig: () =>
    api.get<ApiResponse<{ open: boolean; requireInviteCode: boolean }>>('/api/auth/registration-config'),
  devices: () => api.get<ApiResponse<UserDevice[]>>('/api/auth/devices'),
  deleteDevice: (deviceId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/auth/devices/${encodeURIComponent(deviceId)}`),
};

export interface BucketStats {
  id: string;
  name: string;
  provider: string;
  storageUsed: number;
  storageQuota: number | null;
  fileCount: number;
  isDefault: boolean;
}

export interface DashboardStats {
  fileCount: number;
  folderCount: number;
  trashCount: number;
  storageUsed: number;
  storageQuota: number;
  recentFiles: FileItem[];
  typeBreakdown: Record<string, number>;
  bucketBreakdown: BucketStats[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Files
// ─────────────────────────────────────────────────────────────────────────────
export const filesApi = {
  list: (params?: Partial<FileListParams>) => api.get<ApiResponse<FileItem[]>>('/api/files', { params }),
  get: (id: string) => api.get<ApiResponse<FileItem>>(`/api/files/${id}`),
  createFolder: (name: string, parentId?: string | null, bucketId?: string | null) =>
    api.post<ApiResponse<FileItem>>('/api/files', { name, parentId, bucketId }),
  createFile: (params: {
    name: string;
    content?: string;
    parentId?: string | null;
    bucketId?: string | null;
    mimeType?: string;
  }) => api.post<ApiResponse<FileItem>>('/api/files/create', params),
  update: (id: string, data: { name?: string; parentId?: string | null }) =>
    api.put<ApiResponse<{ message: string }>>(`/api/files/${id}`, data),
  updateSettings: (id: string, data: { allowedMimeTypes?: string[] | null }) =>
    api.put<ApiResponse<{ message: string; allowedMimeTypes?: string[] | null }>>(`/api/files/${id}/settings`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/files/${id}`),
  move: (id: string, targetParentId: string | null) =>
    api.post<ApiResponse<{ message: string }>>(`/api/files/${id}/move`, { targetParentId }),

  upload: (file: File, parentId?: string | null, onProgress?: (progress: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    if (parentId) formData.append('parentId', parentId);
    return api.post<ApiResponse<FileItem>>('/api/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300_000, // 5min for large files
      onUploadProgress: (e) => {
        if (e.total && onProgress) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    });
  },

  download: (id: string) => api.get(`/api/files/${id}/download`, { responseType: 'blob' }),
  preview: (id: string) => api.get(`/api/files/${id}/preview`, { responseType: 'blob' }),
  previewUrl: (id: string, token?: string) => {
    const baseUrl = `${import.meta.env.VITE_API_URL || ''}/api/files/${id}/preview`;
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  },
  downloadUrl: (id: string, token?: string) => {
    const baseUrl = `${import.meta.env.VITE_API_URL || ''}/api/files/${id}/download`;
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  },

  listTrash: () => api.get<ApiResponse<FileItem[]>>('/api/files/trash'),
  restoreTrash: (id: string) => api.post<ApiResponse<{ message: string }>>(`/api/files/trash/${id}/restore`),
  deleteTrash: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/files/trash/${id}`),
  emptyTrash: () => api.delete<ApiResponse<{ message: string }>>('/api/files/trash'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Share — 下载分享 + 文件夹浏览 + 上传链接
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareChildFile {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  isFolder: boolean;
  updatedAt: string;
}

export interface ShareInfo {
  id: string;
  file: {
    id: string;
    name: string;
    size: number;
    mimeType: string | null;
    isFolder: boolean;
  };
  /** 文件夹分享时，一级子文件列表（非递归） */
  children: ShareChildFile[] | null;
  expiresAt: string | null;
  downloadLimit: number | null;
  downloadCount: number;
  hasPassword: boolean;
}

export interface UploadLinkInfo {
  token: string;
  folderName: string;
  expiresAt: string | null;
  hasPassword: boolean;
  maxUploadSize: number;
  allowedMimeTypes: string[] | null;
  maxUploadCount: number | null;
  uploadCount: number;
}

export interface CreateUploadLinkParams {
  folderId: string;
  password?: string;
  expiresAt?: string;
  maxUploadSize?: number;
  allowedMimeTypes?: string[];
  maxUploadCount?: number;
}

export const shareApi = {
  // ── 下载分享（有账号）─────────────────────────────────────────────────
  create: (params: ShareCreateParams) => api.post<ApiResponse<Share>>('/api/share', params),
  list: () => api.get<ApiResponse<any[]>>('/api/share'),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/share/${id}`),

  // ── 公开分享信息（含文件夹子文件列表）─────────────────────────────────
  get: (id: string, password?: string) => api.get<ApiResponse<ShareInfo>>(`/api/share/${id}`, { params: { password } }),

  // ── 单文件下载（文件分享直接下载 / 文件夹内单文件下载）──────────────
  download: (id: string, password?: string) =>
    api.get(`/api/share/${id}/download`, { params: { password }, responseType: 'blob' }),
  downloadUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/download${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,

  // ── 文件夹内单文件下载 ────────────────────────────────────────────────
  childDownloadUrl: (shareId: string, fileId: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/file/${fileId}/download${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,

  // ── 文件夹 ZIP 打包下载 ───────────────────────────────────────────────
  zipUrl: (shareId: string, password?: string, fileIds?: string[]) => {
    const base = `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/zip`;
    const params = new URLSearchParams();
    if (password) params.set('password', password);
    if (fileIds?.length) params.set('fileIds', fileIds.join(','));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  },

  // ── 预览（图片/视频/音频/PDF/文本）────────────────────────────────────
  previewUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/preview${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,

  streamUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/stream${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,

  getRawContent: (id: string, password?: string) =>
    api.get<ApiResponse<{ content: string; mimeType: string }>>(`/api/share/${id}/raw`, { params: { password } }),

  getPreviewInfo: (id: string, password?: string) =>
    api.get<
      ApiResponse<{
        id: string;
        name: string;
        size: number;
        mimeType: string | null;
        previewType: string;
        canPreview: boolean;
      }>
    >(`/api/share/${id}/preview-info`, { params: { password } }),

  // ── 文件夹内子文件预览 ────────────────────────────────────────────────
  childPreviewUrl: (shareId: string, fileId: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/file/${fileId}/preview${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,

  childStreamUrl: (shareId: string, fileId: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/file/${fileId}/stream${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,

  getChildRawContent: (shareId: string, fileId: string, password?: string) =>
    api.get<ApiResponse<{ content: string; mimeType: string }>>(`/api/share/${shareId}/file/${fileId}/raw`, {
      params: { password },
    }),

  // ── 上传链接（有账号创建）────────────────────────────────────────────
  createUploadLink: (params: CreateUploadLinkParams) =>
    api.post<
      ApiResponse<{
        id: string;
        folderId: string;
        folderName: string;
        uploadToken: string;
        expiresAt: string;
        uploadUrl: string;
      }>
    >('/api/share/upload-link', params),

  // ── 上传链接公开端点（无账号）────────────────────────────────────────
  getUploadLink: (token: string, password?: string) =>
    api.get<ApiResponse<UploadLinkInfo>>(`/api/share/upload/${token}`, { params: { password } }),

  uploadViaLink: (token: string, file: File, password?: string, onProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    if (password) formData.append('password', password);
    return api.post<ApiResponse<{ id: string; name: string; size: number; mimeType: string; createdAt: string }>>(
      `/api/share/upload/${token}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
        onUploadProgress: (e) => {
          if (e.total && onProgress) onProgress(Math.round((e.loaded * 100) / e.total));
        },
      }
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Buckets
// ─────────────────────────────────────────────────────────────────────────────
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
// Migrate — 存储桶迁移
// ─────────────────────────────────────────────────────────────────────────────
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
// Telegram
// ─────────────────────────────────────────────────────────────────────────────
export const telegramApi = {
  test: (data: { botToken: string; chatId: string; apiBase?: string }) =>
    api.post<ApiResponse<{ connected: boolean; message: string; botName?: string; chatTitle?: string }>>(
      '/api/telegram/test',
      data
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────
export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  storageQuota: number;
  storageUsed: number;
  fileCount: number;
  bucketCount: number;
  createdAt: string;
  updatedAt: string;
}

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

export interface RegistrationConfig {
  open: boolean;
  requireInviteCode: boolean;
  inviteCodes: Array<{ code: string; usedBy: string | null; createdAt: string | null }>;
}

export const adminApi = {
  listUsers: () => api.get<ApiResponse<AdminUser[]>>('/api/admin/users'),
  getUser: (id: string) => api.get<ApiResponse<AdminUser>>(`/api/admin/users/${id}`),
  patchUser: (
    id: string,
    data: { name?: string; role?: 'admin' | 'user'; storageQuota?: number; newPassword?: string }
  ) => api.patch<ApiResponse<{ message: string }>>(`/api/admin/users/${id}`, data),
  deleteUser: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/admin/users/${id}`),
  getRegistration: () => api.get<ApiResponse<RegistrationConfig>>('/api/admin/registration'),
  setRegistration: (data: { open?: boolean; requireInviteCode?: boolean }) =>
    api.put<ApiResponse<RegistrationConfig>>('/api/admin/registration', data),
  generateCodes: (count = 1) =>
    api.post<ApiResponse<{ codes: string[]; createdAt: string }>>('/api/admin/registration/codes', { count }),
  revokeCode: (code: string) => api.delete<ApiResponse<{ message: string }>>(`/api/admin/registration/codes/${code}`),
  stats: () => api.get<ApiResponse<AdminStats>>('/api/admin/stats'),
  auditLogs: (params?: { userId?: string; action?: string; page?: number; limit?: number }) =>
    api.get<ApiResponse<{ items: AuditLog[]; total: number; page: number; limit: number }>>('/api/admin/audit-logs', {
      params,
    }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────────
export const tasksApi = {
  create: (data: {
    fileName: string;
    fileSize: number;
    mimeType?: string;
    parentId?: string | null;
    bucketId?: string | null;
  }) =>
    api.post<
      ApiResponse<{
        taskId: string;
        uploadId: string;
        r2Key: string;
        bucketId: string;
        totalParts: number;
        firstPartUrl: string;
      }>
    >('/api/tasks/create', data),
  get: (taskId: string) => api.get<ApiResponse<UploadTask>>(`/api/tasks/${taskId}`),
  part: (data: { taskId: string; partNumber: number }) =>
    api.post<ApiResponse<{ partUrl: string; partNumber: number; expiresIn: number }>>('/api/tasks/part', data),
  partProxy: (formData: FormData) =>
    api.post<ApiResponse<{ partNumber: number; etag: string }>>('/api/tasks/part-proxy', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  partDone: (data: { taskId: string; partNumber: number; etag: string }) =>
    api.post<ApiResponse<{ partNumber: number; etag: string; uploadedParts: number[] }>>('/api/tasks/part-done', data),
  complete: (data: { taskId: string; parts: Array<{ partNumber: number; etag: string }> }) =>
    api.post<ApiResponse<UploadedFile>>('/api/tasks/complete', data),
  abort: (taskId: string) => api.post<ApiResponse<{ message: string }>>('/api/tasks/abort', { taskId }),
  pause: (taskId: string) => api.post<ApiResponse<{ message: string }>>(`/api/tasks/${taskId}/pause`),
  resume: (taskId: string) => api.post<ApiResponse<{ message: string }>>(`/api/tasks/${taskId}/resume`),
  retry: (taskId: string) =>
    api.post<ApiResponse<{ taskId: string; uploadId: string; totalParts: number; uploadedParts: number[] }>>(
      `/api/tasks/${taskId}/retry`
    ),
  list: () => api.get<ApiResponse<UploadTask[]>>('/api/tasks/list'),
  delete: (taskId: string) => api.delete<ApiResponse<{ message: string }>>(`/api/tasks/${taskId}`),
  clear: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear'),
  clearCompleted: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear-completed'),
  clearFailed: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear-failed'),
  clearAll: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear-all'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Downloads
// ─────────────────────────────────────────────────────────────────────────────
export const downloadsApi = {
  create: (data: { url: string; fileName?: string; parentId?: string | null; bucketId?: string | null }) =>
    api.post<ApiResponse<{ id: string; url: string; fileName: string; status: string }>>('/api/downloads/create', data),
  batch: (data: { urls: string[]; parentId?: string | null; bucketId?: string | null }) =>
    api.post<ApiResponse<{ created: number; failed: number; failedItems: Array<{ url: string; error: string }> }>>(
      '/api/downloads/batch',
      data
    ),
  list: (params?: { status?: string; page?: number; limit?: number }) =>
    api.get<ApiResponse<{ items: DownloadTask[]; total: number; page: number; limit: number }>>('/api/downloads/list', {
      params,
    }),
  get: (taskId: string) => api.get<ApiResponse<DownloadTask>>(`/api/downloads/${taskId}`),
  update: (taskId: string, data: { fileName?: string; parentId?: string | null; bucketId?: string | null }) =>
    api.patch<ApiResponse<DownloadTask>>(`/api/downloads/${taskId}`, data),
  delete: (taskId: string) => api.delete<ApiResponse<{ message: string }>>(`/api/downloads/${taskId}`),
  retry: (taskId: string) => api.post<ApiResponse<{ message: string }>>(`/api/downloads/${taskId}/retry`),
  pause: (taskId: string) => api.post<ApiResponse<{ message: string }>>(`/api/downloads/${taskId}/pause`),
  resume: (taskId: string) => api.post<ApiResponse<{ message: string }>>(`/api/downloads/${taskId}/resume`),
  clearCompleted: () => api.delete<ApiResponse<{ message: string; count: number }>>('/api/downloads/completed'),
  clearFailed: () => api.delete<ApiResponse<{ message: string; count: number }>>('/api/downloads/failed'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Batch
// ─────────────────────────────────────────────────────────────────────────────
export const batchApi = {
  delete: (fileIds: string[]) => api.post<ApiResponse<BatchOperationResult>>('/api/batch/delete', { fileIds }),
  move: (fileIds: string[], targetParentId: string | null) =>
    api.post<ApiResponse<BatchOperationResult>>('/api/batch/move', { fileIds, targetParentId }),
  copy: (fileIds: string[], targetParentId: string | null, targetBucketId?: string | null) =>
    api.post<ApiResponse<BatchOperationResult>>('/api/batch/copy', { fileIds, targetParentId, targetBucketId }),
  rename: (items: Array<{ fileId: string; newName: string }>) =>
    api.post<ApiResponse<BatchOperationResult>>('/api/batch/rename', { items }),
  permanentDelete: (fileIds: string[]) =>
    api.post<ApiResponse<BatchOperationResult & { freedBytes: number }>>('/api/batch/permanent-delete', { fileIds }),
  restore: (fileIds: string[]) => api.post<ApiResponse<BatchOperationResult>>('/api/batch/restore', { fileIds }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Search
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

// ─────────────────────────────────────────────────────────────────────────────
// Permissions & Tags
// ─────────────────────────────────────────────────────────────────────────────
export interface GlobalPermission {
  id: string;
  subjectType: 'user' | 'group';
  subjectId: string | null;
  subjectName: string;
  fileId: string;
  fileName: string;
  filePath: string;
  isFolder: boolean;
  permission: 'read' | 'write' | 'admin';
  expiresAt: string | null;
  createdAt: string;
}

export interface SearchableUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
}

export const permissionsApi = {
  grant: (data: {
    fileId: string;
    userId?: string;
    groupId?: string;
    permission: 'read' | 'write' | 'admin';
    subjectType?: 'user' | 'group';
    expiresAt?: string;
  }) => api.post<ApiResponse<{ message: string }>>('/api/permissions/grant', data),
  revoke: (data: { fileId: string; userId?: string; groupId?: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/revoke', data),
  getFilePermissions: (fileId: string) =>
    api.get<
      ApiResponse<{
        isOwner: boolean;
        permissions: Array<{
          id: string;
          userId: string | null;
          groupId: string | null;
          permission: string;
          userName: string | null;
          userEmail: string;
          groupName?: string;
          subjectType: 'user' | 'group';
          expiresAt: string | null;
          scope: 'explicit' | 'inherited';
          createdAt: string;
        }>;
      }>
    >(`/api/permissions/file/${fileId}`),
  checkAccess: (fileId: string) =>
    api.get<ApiResponse<{ hasAccess: boolean; permission: string | null; isOwner: boolean }>>(
      `/api/permissions/check/${fileId}`
    ),
  resolvePermission: (fileId: string) =>
    api.get<
      ApiResponse<{
        hasAccess: boolean;
        permission: string | null;
        source: 'explicit' | 'inherited' | 'owner';
        sourceFileId?: string;
        sourceFilePath?: string;
        expiresAt?: string;
      }>
    >(`/api/permissions/resolve/${fileId}`),
  searchUsers: (query: string) =>
    api.get<ApiResponse<SearchableUser[]>>('/api/permissions/users/search', { params: { q: query } }),
  addTag: (data: { fileId: string; name: string; color?: string }) =>
    api.post<ApiResponse<FileTag>>('/api/permissions/tags/add', data),
  removeTag: (data: { fileId: string; tagName: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/tags/remove', data),
  getFileTags: (fileId: string) => api.get<ApiResponse<FileTag[]>>(`/api/permissions/tags/file/${fileId}`),
  getUserTags: () => api.get<ApiResponse<FileTag[]>>('/api/permissions/tags/user'),
  getBatchFileTags: (fileIds: string[]) =>
    api.post<ApiResponse<Record<string, FileTag[]>>>('/api/permissions/tags/batch', { fileIds }),
  getAllPermissions: () =>
    api.get<ApiResponse<{ permissions: GlobalPermission[] }>>('/api/permissions/all'),
  revokeById: (permissionId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/permissions/${permissionId}`),
  updatePermission: (permissionId: string, permission: 'read' | 'write' | 'admin', expiresAt?: string) =>
    api.patch<ApiResponse<{ message: string }>>(`/api/permissions/${permissionId}`, { permission, expiresAt }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────────────────
export const previewApi = {
  getInfo: (fileId: string) =>
    api.get<
      ApiResponse<{
        id: string;
        name: string;
        size: number;
        mimeType: string | null;
        previewable: boolean;
        previewType: string;
        language: string | null;
        extension: string;
        canPreview: boolean;
      }>
    >(`/api/preview/${fileId}/info`),
  getRaw: (fileId: string) =>
    api.get<ApiResponse<{ content: string; mimeType: string | null; name: string; size: number }>>(
      `/api/preview/${fileId}/raw`
    ),
  streamUrl: (fileId: string) => `${import.meta.env.VITE_API_URL || ''}/api/preview/${fileId}/stream`,
  thumbnailUrl: (fileId: string, width = 256, height = 256) =>
    `${import.meta.env.VITE_API_URL || ''}/api/preview/${fileId}/thumbnail?width=${width}&height=${height}`,
  getOffice: (fileId: string) =>
    api.get<ApiResponse<{ fileName: string; mimeType: string; base64Content: string; size: number }>>(
      `/api/preview/${fileId}/office`
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Direct Link (直链)
// ─────────────────────────────────────────────────────────────────────────────
export interface DirectLinkInfo {
  token: string;
  fileId: string;
  fileName: string;
  directUrl: string;
  expiresAt: string | null;
  isPermanent: boolean;
}

export const directLinkApi = {
  create: (fileId: string, expiresAt?: string | null) =>
    api.post<ApiResponse<DirectLinkInfo>>('/api/direct', { fileId, expiresAt }),
  get: (fileId: string) => api.get<ApiResponse<DirectLinkInfo | null>>(`/api/direct/file/${fileId}`),
  delete: (fileId: string) => api.delete<ApiResponse<{ message: string }>>(`/api/direct/${fileId}`),
  update: (fileId: string, expiresAt?: string | null) =>
    api.put<ApiResponse<DirectLinkInfo>>(`/api/direct/${fileId}`, { expiresAt }),
  directUrl: (token: string) => `${import.meta.env.VITE_API_URL || ''}/api/direct/${token}`,
  previewUrl: (token: string) => `${import.meta.env.VITE_API_URL || ''}/api/direct/${token}/preview`,
  infoUrl: (token: string) => `${import.meta.env.VITE_API_URL || ''}/api/direct/${token}/info`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Notes (笔记)
// ─────────────────────────────────────────────────────────────────────────────
export interface FileNote {
  id: string;
  fileId: string;
  userId: string;
  content: string;
  contentHtml: string | null;
  isPinned: boolean;
  version: number;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

export const notesApi = {
  list: (fileId: string, page = 1, limit = 20) =>
    api.get<ApiResponse<{ notes: FileNote[]; total: number; page: number; limit: number }>>(
      `/api/notes/${fileId}?page=${page}&limit=${limit}`
    ),
  create: (fileId: string, content: string, parentId?: string) =>
    api.post<ApiResponse<FileNote>>(`/api/notes/${fileId}`, { content, parentId }),
  update: (fileId: string, noteId: string, content: string) =>
    api.put<ApiResponse<FileNote>>(`/api/notes/${fileId}/${noteId}`, { content }),
  delete: (fileId: string, noteId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/notes/${fileId}/${noteId}`),
  pin: (fileId: string, noteId: string) =>
    api.post<ApiResponse<{ isPinned: boolean; message: string }>>(`/api/notes/${fileId}/${noteId}/pin`),
  history: (fileId: string, noteId: string) =>
    api.get<ApiResponse<{ current: { id: string; content: string; version: number }; history: Array<{ id: string; content: string; version: number; editedBy: string | null; createdAt: string }> }>>(
      `/api/notes/${fileId}/${noteId}/history`
    ),
  unreadMentions: () =>
    api.get<ApiResponse<Array<{ id: string; noteId: string; createdAt: string }>>>('/api/notes/mentions/unread'),
  markMentionRead: (mentionId: string) =>
    api.put<ApiResponse<{ message: string }>>(`/api/notes/mentions/${mentionId}/read`),
};

// ─────────────────────────────────────────────────────────────────────────────
// API Keys
// ─────────────────────────────────────────────────────────────────────────────
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export const apiKeysApi = {
  list: () => api.get<ApiResponse<ApiKey[]>>('/api/keys'),
  create: (data: { name: string; scopes: string[]; expiresAt?: string }) =>
    api.post<ApiResponse<ApiKey & { key: string; warning: string }>>('/api/keys', data),
  get: (id: string) => api.get<ApiResponse<ApiKey>>(`/api/keys/${id}`),
  update: (id: string, data: { name?: string; scopes?: string[]; isActive?: boolean }) =>
    api.patch<ApiResponse<{ message: string }>>(`/api/keys/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/keys/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// File Content (文件内容编辑)
// ─────────────────────────────────────────────────────────────────────────────
export const fileContentApi = {
  getRaw: (fileId: string) =>
    api.get<ApiResponse<{ content: string; mimeType: string; size: number; name: string }>>(`/api/files/${fileId}/raw`),
  update: (fileId: string, data: { content: string; changeSummary?: string }) =>
    api.put<ApiResponse<{ message: string; size: number; hash: string; versionCreated: boolean }>>(
      `/api/files/${fileId}/content`,
      data
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Groups (用户组)
// ─────────────────────────────────────────────────────────────────────────────
export interface UserGroup {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  isOwner: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: 'member' | 'admin';
  addedBy: string | null;
  createdAt: string;
  name: string | null;
  email: string;
}

export const groupsApi = {
  list: () =>
    api.get<ApiResponse<{ owned: UserGroup[]; memberOf: UserGroup[] }>>('/api/groups'),
  create: (data: { name: string; description?: string }) =>
    api.post<ApiResponse<UserGroup>>('/api/groups', data),
  get: (id: string) => api.get<ApiResponse<UserGroup>>(`/api/groups/${id}`),
  update: (id: string, data: { name?: string; description?: string }) =>
    api.put<ApiResponse<{ message: string }>>(`/api/groups/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/groups/${id}`),
  getMembers: (id: string) => api.get<ApiResponse<GroupMember[]>>(`/api/groups/${id}/members`),
  addMember: (groupId: string, data: { userId: string; role?: 'member' | 'admin' }) =>
    api.post<ApiResponse<GroupMember>>(`/api/groups/${groupId}/members`, data),
  removeMember: (groupId: string, userId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/groups/${groupId}/members/${userId}`),
  updateMemberRole: (groupId: string, userId: string, role: 'member' | 'admin') =>
    api.put<ApiResponse<{ message: string }>>(`/api/groups/${groupId}/members/${userId}/role`, { role }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Webhooks
// ─────────────────────────────────────────────────────────────────────────────
export interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastStatus: number | null;
  createdAt: string;
}

export interface WebhookEvent {
  value: string;
  label: string;
  description: string;
}

export const webhooksApi = {
  list: () => api.get<ApiResponse<Webhook[]>>('/api/webhooks'),
  create: (data: { url: string; events: string[]; secret?: string }) =>
    api.post<ApiResponse<Webhook & { secret: string; warning: string }>>('/api/webhooks', data),
  get: (id: string) => api.get<ApiResponse<Webhook>>(`/api/webhooks/${id}`),
  update: (id: string, data: { url?: string; events?: string[]; isActive?: boolean }) =>
    api.put<ApiResponse<{ message: string }>>(`/api/webhooks/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/webhooks/${id}`),
  test: (id: string) => api.post<ApiResponse<{ message: string }>>(`/api/webhooks/${id}/test`),
  getEvents: () => api.get<ApiResponse<WebhookEvent[]>>('/api/webhooks/events'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Global Permissions (全局权限管理)
// ─────────────────────────────────────────────────────────────────────────────
export interface GlobalPermission {
  id: string;
  subjectType: 'user' | 'group';
  subjectId: string | null;
  subjectName: string;
  fileId: string;
  fileName: string;
  filePath: string;
  isFolder: boolean;
  permission: 'read' | 'write' | 'admin';
  expiresAt: string | null;
  createdAt: string;
}

export const globalPermissionsApi = {
  getAll: () =>
    api.get<ApiResponse<{ permissions: GlobalPermission[] }>>('/api/permissions/all'),
  revokeById: (permissionId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/permissions/${permissionId}`),
  update: (permissionId: string, data: { permission: 'read' | 'write' | 'admin'; expiresAt?: string }) =>
    api.patch<ApiResponse<{ message: string }>>(`/api/permissions/${permissionId}`, data),
};

export default api;
