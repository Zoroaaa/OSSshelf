/**
 * core.ts
 *
 * 核心业务 API 服务层
 *
 * 包含模块：
 * - Auth：用户认证（登录/注册/登出/密码重置/邮箱验证/设备管理）
 * - Files：文件管理（CRUD/上传/下载/预览/回收站/星标/文件夹统计/ZIP打包/访问日志）
 * - Tasks：分片上传任务管理（创建/分片/完成/暂停/恢复/重试/清理）
 * - Downloads：离线下载任务管理（创建/批量/暂停/恢复/清理）
 * - Batch：批量操作（删除/移动/重命名/永久删除/还原/ZIP打包）
 * - Preview：文件预览（信息/原始内容/流媒体/缩略图URL）
 * - DirectLink：直链管理（创建/查询/更新/删除/各类URL生成）
 * - FileContent：文件内容编辑（读取原始内容/保存修改）
 * - Versions：版本历史（列表/恢复/下载/删除/版本设置）
 * - Notes：笔记管理（CRUD/置顶/历史/提及通知）
 */

import api from './api-client';
import type {
  User,
  FileItem,
  ApiResponse,
  AuthLoginParams,
  AuthRegisterParams,
  UploadedFile,
  AuthResponse,
  FileListParams,
  UserDevice,
  UploadTask,
  DownloadTask,
  BatchOperationResult,
} from '@osshelf/shared';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — Auth & Dashboard 相关
// ─────────────────────────────────────────────────────────────────────────────

/** 用户邮件通知偏好设置 */
export interface EmailPreferences {
  mention: boolean;
  share_received: boolean;
  quota_warning: boolean;
  ai_complete: boolean;
  system: boolean;
}

/** 存储桶统计信息（用于仪表盘） */
export interface BucketStats {
  id: string;
  name: string;
  provider: string;
  storageUsed: number;
  storageQuota: number | null;
  fileCount: number;
  isDefault: boolean;
}

/** 仪表盘统计数据 */
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
// 类型定义 — 文件相关
// ─────────────────────────────────────────────────────────────────────────────

/** 文件夹大小统计信息 */
export interface FolderSizeStats {
  folderId: string;
  totalSize: number;
  fileCount: number;
  folderCount: number;
  childFiles: Array<{ id: string; name: string; size: number }>;
  lastUpdated: string;
}

/** 文件访问日志响应 */
export interface FileAccessLogResponse {
  fileId: string;
  fileName: string;
  logs: Array<{
    id: string;
    userId: string | null;
    action: string;
    ipAddress: string | null;
    userAgent: string | null;
    status: 'success' | 'failed';
    errorMessage: string | null;
    details: string | null;
    createdAt: string;
    user: { name: string | null; email: string } | null;
  }>;
  stats: Array<{ action: string; count: number }>;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    totalPages: number;
  };
}

/** 直链信息 */
export interface DirectLinkInfo {
  token: string;
  fileId: string;
  fileName: string;
  directUrl: string;
  expiresAt: string | null;
  isPermanent: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 笔记 & 版本相关
// ─────────────────────────────────────────────────────────────────────────────

/** 文件笔记 */
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

/** 单个版本信息 */
export interface VersionInfo {
  id: string;
  version: number;
  size: number;
  mimeType: string | null;
  changeSummary: string | null;
  aiChangeSummary: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** 笔记历史响应 */
export interface NoteHistoryResponse {
  current: { id: string; content: string; version: number };
  history: Array<{ id: string; content: string; version: number; editedBy: string | null; createdAt: string }>;
}

/** 版本列表响应数据 */
export interface VersionsListData {
  versions: VersionInfo[];
  currentVersion: number;
  maxVersions: number;
  versionRetentionDays: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth — 用户认证
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
  verifyCode: (params: { email: string; code: string; type: 'verify_email' | 'reset_password' | 'change_email' }) =>
    api.post<ApiResponse<{ message: string; verified?: boolean; resetTokenId?: string }>>(
      '/api/auth/verify-code',
      params
    ),
  resendVerification: (params: { email: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/auth/resend-verification', params),
  forgotPassword: (params: { email: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/auth/forgot-password', params),
  resetPassword: (params: { email: string; code: string; newPassword: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/auth/reset-password', params),
  changeEmail: (params: { newEmail: string; password: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/auth/change-email', params),
  getEmailPreferences: () => api.get<ApiResponse<EmailPreferences>>('/api/auth/email-preferences'),
  setEmailPreferences: (data: Partial<EmailPreferences>) =>
    api.put<ApiResponse<EmailPreferences>>('/api/auth/email-preferences', data),
};

// ─────────────────────────────────────────────────────────────────────────────
// Files — 文件管理
// ─────────────────────────────────────────────────────────────────────────────

export const filesApi = {
  list: (params?: Partial<FileListParams>) => api.get<ApiResponse<FileItem[]>>('/api/files', { params }),
  get: (id: string) => api.get<ApiResponse<FileItem>>(`/api/files/${id}`),

  /** 获取文件完整详情（Phase 4） */
  getFileDetail: (id: string) => api.get<any>(`/api/files/${id}/detail`),

  /** 更改文件夹存储桶（级联子文件夹） */
  changeFolderBucket: (folderId: string, bucketId: string) =>
    api.put<ApiResponse<{ message: string; updatedCount: number }>>(`/api/files/${folderId}/bucket`, { bucketId }),

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

  // ── 回收站 ──
  listTrash: () => api.get<ApiResponse<FileItem[]>>('/api/files/trash'),
  restoreTrash: (id: string) => api.post<ApiResponse<{ message: string }>>(`/api/files/trash/${id}/restore`),
  deleteTrash: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/files/trash/${id}`),
  emptyTrash: () => api.delete<ApiResponse<{ message: string }>>('/api/files/trash'),

  // ── 星标 ──
  star: (id: string) => api.post<ApiResponse<{ message: string; isStarred: boolean }>>(`/api/files/${id}/star`),
  unstar: (id: string) => api.delete<ApiResponse<{ message: string; isStarred: boolean }>>(`/api/files/${id}/star`),

  // ── 文件夹大小统计（批量）──
  /** 批量获取文件夹大小统计 */
  getFoldersSize: (folderIds: string[]) =>
    api.post<ApiResponse<Record<string, FolderSizeStats>>>('/api/files/folders/size', { folderIds }),

  // ── 文件夹 Zip 下载 ──
  /** 文件夹打包下载为 ZIP */
  downloadFolderAsZip: (folderId: string, fileIds?: string[]) => {
    const params = fileIds ? `?fileIds=${fileIds.join(',')}` : '';
    return api.get(`/api/files/${folderId}/zip${params}`, { responseType: 'blob' });
  },

  // ── 文件访问日志 ──
  /** 获取文件的访问日志（分页） */
  getFileLogs: (fileId: string, params?: { limit?: number; offset?: number; action?: string }) =>
    api.get<ApiResponse<FileAccessLogResponse>>(`/api/files/${fileId}/logs`, { params }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Tasks — 分片上传任务管理
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
  start: (taskId: string) => api.post<ApiResponse<{ message: string }>>('/api/tasks/start', { taskId }),
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
  clearCompleted: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear-completed'),
  clearFailed: () => api.delete<ApiResponse<{ message: string }>>('/api/tasks/clear-failed'),
  telegramPart: (formData: FormData) =>
    api.post<ApiResponse<{ partNumber: number; etag: string }>>('/api/tasks/telegram-part', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Downloads — 离线下载任务管理
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
// Batch — 批量操作
// ─────────────────────────────────────────────────────────────────────────────

export const batchApi = {
  delete: (fileIds: string[]) => api.post<ApiResponse<BatchOperationResult>>('/api/batch/delete', { fileIds }),
  move: (fileIds: string[], targetParentId: string | null) =>
    api.post<ApiResponse<BatchOperationResult>>('/api/batch/move', { fileIds, targetParentId }),
  rename: (items: Array<{ fileId: string; newName: string }>) =>
    api.post<ApiResponse<BatchOperationResult>>('/api/batch/rename', { items }),
  permanentDelete: (fileIds: string[]) =>
    api.post<ApiResponse<BatchOperationResult & { freedBytes: number }>>('/api/batch/permanent-delete', { fileIds }),
  restore: (fileIds: string[]) => api.post<ApiResponse<BatchOperationResult>>('/api/batch/restore', { fileIds }),
  zip: (fileIds: string[], zipName?: string) =>
    api.post('/api/batch/zip', { fileIds, zipName }, { responseType: 'blob' }).then((res) => {
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${zipName || 'download'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Preview — 文件预览
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
};

// ─────────────────────────────────────────────────────────────────────────────
// Direct Link (直链)
// ─────────────────────────────────────────────────────────────────────────────

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
// Versions (版本历史)
// ─────────────────────────────────────────────────────────────────────────────

export const versionsApi = {
  getList: (fileId: string) => api.get<ApiResponse<VersionsListData>>(`/api/versions/${fileId}/versions`),
  restore: (fileId: string, version: number) =>
    api.post<ApiResponse<{ message: string }>>(`/api/versions/${fileId}/versions/${version}/restore`),
  download: (fileId: string, version: number) =>
    api.get<Blob>(`/api/versions/${fileId}/versions/${version}/download`, { responseType: 'blob' }),
  delete: (fileId: string, version: number) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/versions/${fileId}/versions/${version}`),
  updateVersionSettings: (fileId: string, data: { maxVersions?: number; versionRetentionDays?: number }) =>
    api.patch<ApiResponse<{ message: string; maxVersions: number; versionRetentionDays: number }>>(
      `/api/versions/${fileId}/version-settings`,
      data
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Notes (笔记)
// ─────────────────────────────────────────────────────────────────────────────

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
};
