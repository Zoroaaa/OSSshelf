/**
 * api.ts
 * API服务层
 *
 * 功能:
 * - 封装所有后端API调用
 * - 统一请求/响应处理
 * - 自动注入认证令牌
 * - 错误处理与重试
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
      // 以下路径允许返回 401 而不触发全局登出：
      //   - 分享链接（需要密码时返回 401）
      //   - 登录/注册接口（凭证错误时返回 401）
      const isPublicEndpoint =
        url.includes('/api/share/') || url.includes('/api/auth/login') || url.includes('/api/auth/register');

      if (!isPublicEndpoint) {
        // 确认当前确实处于已认证状态才执行登出（避免未登录时循环跳转）
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
  deleteDevice: (deviceId: string) => api.delete<ApiResponse<{ message: string }>>(`/api/auth/devices/${encodeURIComponent(deviceId)}`),
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

export const filesApi = {
  list: (params?: Partial<FileListParams>) => api.get<ApiResponse<FileItem[]>>('/api/files', { params }),
  get: (id: string) => api.get<ApiResponse<FileItem>>(`/api/files/${id}`),
  createFolder: (name: string, parentId?: string | null, bucketId?: string | null) =>
    api.post<ApiResponse<FileItem>>('/api/files', { name, parentId, bucketId }),
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
  downloadUrl: (id: string) => `${import.meta.env.VITE_API_URL || ''}/api/files/${id}/download`,

  listTrash: () => api.get<ApiResponse<FileItem[]>>('/api/files/trash'),
  restoreTrash: (id: string) => api.post<ApiResponse<{ message: string }>>(`/api/files/trash/${id}/restore`),
  deleteTrash: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/files/trash/${id}`),
  emptyTrash: () => api.delete<ApiResponse<{ message: string }>>('/api/files/trash'),
};

export const shareApi = {
  create: (params: ShareCreateParams) => api.post<ApiResponse<Share>>('/api/share', params),
  list: () => api.get<ApiResponse<any[]>>('/api/share'),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/share/${id}`),
  get: (id: string, password?: string) => api.get<ApiResponse<any>>(`/api/share/${id}`, { params: { password } }),
  download: (id: string, password?: string) =>
    api.get(`/api/share/${id}/download`, { params: { password }, responseType: 'blob' }),
  downloadUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/download${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
  previewUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/preview${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
};

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
  minio: {
    label: 'MinIO',
    color: '#C72C41',
    icon: '🐘',
    endpointPlaceholder: 'http://your-minio-server:9000',
  },
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

export const telegramApi = {
  /** 测试临时 Bot Token / Chat ID（不保存） */
  test: (data: { botToken: string; chatId: string; apiBase?: string }) =>
    api.post<ApiResponse<{ connected: boolean; message: string; botName?: string; chatTitle?: string }>>(
      '/api/telegram/test',
      data
    ),
};

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

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  path: string;
  bucketId: string | null;
  createdAt: string;
}

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
  list: () => api.get<ApiResponse<UploadTask[]>>('/api/tasks/list'),
  delete: (taskId: string) => api.delete<ApiResponse<{ message: string }>>(`/api/tasks/${taskId}`),
  clear: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear'),
  clearCompleted: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear-completed'),
  clearFailed: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear-failed'),
  clearAll: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear-all'),
};

export const downloadsApi = {
  create: (data: { url: string; fileName?: string; parentId?: string | null; bucketId?: string | null }) =>
    api.post<ApiResponse<{ id: string; url: string; fileName: string; status: string }>>('/api/downloads/create', data),
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

export const searchApi = {
  query: (params: {
    query?: string;
    parentId?: string;
    recursive?: boolean;
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
};

export interface SearchableUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
}

export const permissionsApi = {
  grant: (data: { fileId: string; userId: string; permission: 'read' | 'write' | 'admin' }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/grant', data),
  revoke: (data: { fileId: string; userId: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/revoke', data),
  getFilePermissions: (fileId: string) =>
    api.get<
      ApiResponse<{
        isOwner: boolean;
        permissions: Array<{
          id: string;
          userId: string;
          permission: string;
          userName: string | null;
          userEmail: string;
          createdAt: string;
        }>;
      }>
    >(`/api/permissions/file/${fileId}`),
  checkAccess: (fileId: string) =>
    api.get<ApiResponse<{ hasAccess: boolean; permission: string | null; isOwner: boolean }>>(
      `/api/permissions/check/${fileId}`
    ),
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
};

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

export default api;
