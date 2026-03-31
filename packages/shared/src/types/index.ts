/**
 * index.ts
 * 共享类型定义
 *
 * 功能:
 * - 用户类型定义
 * - 文件类型定义
 * - API响应类型
 * - 常量定义
 *
 * 前后端共用，确保类型一致性
 */

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  storageQuota: number;
  storageUsed: number;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'admin' | 'user';

export interface FileItem {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  path: string;
  type: FileType;
  size: number;
  r2Key: string;
  mimeType: string | null;
  hash: string | null;
  isFolder: boolean;
  allowedMimeTypes?: string | null;
  bucketId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tags?: FileTag[];
  permissions?: FilePermission[];
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  path: string;
  bucketId: string | null;
  createdAt: string;
}

export type FileType = 'file' | 'folder';

export interface FileTag {
  id: string;
  fileId: string;
  userId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface FilePermission {
  id: string;
  fileId: string;
  userId: string;
  permission: PermissionLevel;
  grantedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type PermissionLevel = 'read' | 'write' | 'admin';

export interface Share {
  id: string;
  fileId: string;
  userId: string;
  password: string | null;
  expiresAt: string | null;
  downloadLimit: number | null;
  downloadCount: number;
  createdAt: string;
}

export interface WebDAVSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  userName?: string | null;
  userEmail?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: 'success' | 'failed';
  errorMessage: string | null;
  createdAt: string;
}

export type AuditAction =
  | 'user.login'
  | 'user.logout'
  | 'user.register'
  | 'user.update'
  | 'user.delete'
  | 'file.upload'
  | 'file.download'
  | 'file.delete'
  | 'file.move'
  | 'file.rename'
  | 'file.update'
  | 'folder.create'
  | 'share.create'
  | 'share.access'
  | 'share.delete'
  | 'bucket.create'
  | 'bucket.update'
  | 'bucket.delete'
  | 'permission.grant'
  | 'permission.revoke'
  | 'permission.update'
  | 'permission.delete'
  | 'group.create'
  | 'group.update'
  | 'group.delete'
  | 'group.member.add'
  | 'group.member.remove'
  | 'group.member.role_change'
  | 'webhook.create'
  | 'webhook.update'
  | 'webhook.delete'
  | 'admin.user_update'
  | 'admin.config_change'
  | 'admin.invite_code_generate'
  | 'admin.invite_code_revoke';

export interface LoginAttempt {
  id: string;
  email: string;
  ipAddress: string;
  success: boolean;
  userAgent: string | null;
  createdAt: string;
}

export interface UserDevice {
  id: string;
  userId: string;
  deviceId: string;
  deviceName: string | null;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  ipAddress: string | null;
  userAgent: string | null;
  lastActive: string;
  createdAt: string;
}

export interface UploadTask {
  id: string;
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string | null;
  parentId: string | null;
  bucketId: string | null;
  r2Key: string;
  uploadId: string;
  totalParts: number;
  uploadedParts: number[];
  status: UploadTaskStatus;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type UploadTaskStatus = 'pending' | 'uploading' | 'paused' | 'completed' | 'failed' | 'expired' | 'aborted';

export interface DownloadTask {
  id: string;
  userId: string;
  url: string;
  fileName: string | null;
  fileSize: number | null;
  totalSize: number | null;
  downloadedSize: number | null;
  parentId: string | null;
  bucketId: string | null;
  status: DownloadTaskStatus;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type DownloadTaskStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'failed';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FileUploadParams {
  file: File;
  parentId: string | null;
  onProgress?: (progress: number) => void;
}

export interface FileListParams extends PaginationParams {
  parentId: string | null;
  sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  search?: string;
  tags?: string[];
  mimeType?: string;
  minSize?: number;
  maxSize?: number;
  createdAfter?: string;
  createdBefore?: string;
}

export interface ShareCreateParams {
  fileId: string;
  password?: string;
  expiresAt?: string;
  downloadLimit?: number;
}

export interface AuthLoginParams {
  email: string;
  password: string;
  deviceId?: string;
  deviceName?: string;
}

export interface AuthRegisterParams extends AuthLoginParams {
  name?: string;
  inviteCode?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  deviceId?: string;
}

export interface BatchOperationResult {
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

export interface FileSearchResult {
  items: FileItem[];
  total: number;
  aggregations?: {
    types: Record<string, number>;
    mimeTypes: Record<string, number>;
    tags: Record<string, number>;
    sizeRange: { min: number; max: number };
  };
}
