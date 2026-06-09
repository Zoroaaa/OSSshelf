/**
 * collab.ts
 *
 * 协作分享 API 服务层
 *
 * 包含模块：
 * - Share：分享链接管理（创建/查询/下载/预览/上传链接/ZIP打包）
 * - Permissions：权限管理（授予/撤销/查询/标签/用户搜索）
 * - Groups：用户群组管理（CRUD/成员管理）
 * - Webhooks：Webhook 管理（CRUD/测试/事件列表）
 * - Notifications：通知管理（列表/已读/删除/SSE流）
 */

import api from './api-client';
import { useAuthStore } from '../stores/auth';
import type { ApiResponse, Share, ShareCreateParams, FileTag } from '@osshelf/shared';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 分享相关
// ─────────────────────────────────────────────────────────────────────────────

/** 分享链接下的子文件条目 */
export interface ShareChildFile {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  isFolder: boolean;
  updatedAt: string;
}

/** 分享信息详情 */
export interface ShareInfo {
  id: string;
  file: {
    id: string;
    name: string;
    size: number;
    mimeType: string | null;
    isFolder: boolean;
  };
  children: ShareChildFile[] | null;
  expiresAt: string | null;
  downloadLimit: number | null;
  downloadCount: number;
  hasPassword: boolean;
}

/** 分享文件夹内的子目录信息 */
export interface ShareFolderInfo {
  folder: { id: string; name: string; size: number; mimeType: string | null; isFolder: true };
  children: ShareChildFile[];
  path: Array<{ id: string; name: string; isFolder: true }>;
}

/** 分享文件预览信息 */
export interface SharePreviewInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  previewType: string;
  canPreview: boolean;
}

/** 上传链接信息 */
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

/** 创建上传链接的参数 */
export interface CreateUploadLinkParams {
  folderId: string;
  password?: string;
  expiresAt?: string;
  maxUploadSize?: number;
  allowedMimeTypes?: string[];
  maxUploadCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Share — 分享链接管理
// ─────────────────────────────────────────────────────────────────────────────

export const shareApi = {
  create: (params: ShareCreateParams) => api.post<ApiResponse<Share>>('/api/share', params),
  list: () => api.get<ApiResponse<any[]>>('/api/share'),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/share/${id}`),
  get: (id: string, password?: string) => api.get<ApiResponse<ShareInfo>>(`/api/share/${id}`, { params: { password } }),

  /** 获取分享文件夹下的子目录内容 */
  getFolder: (shareId: string, folderId: string, password?: string) =>
    api.get<ApiResponse<ShareFolderInfo>>(`/api/share/${shareId}/folder/${folderId}`, { params: { password } }),
  download: (id: string, password?: string) =>
    api.get(`/api/share/${id}/download`, { params: { password }, responseType: 'blob' }),
  downloadUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/download${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
  childDownloadUrl: (shareId: string, fileId: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/file/${fileId}/download${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,

  // ── ZIP 打包下载 ──
  zipUrl: (shareId: string, password?: string, fileIds?: string[]) => {
    const base = `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/zip`;
    const params = new URLSearchParams();
    if (password) params.set('password', password);
    if (fileIds?.length) params.set('fileIds', fileIds.join(','));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  },

  // ── 预览 & 流媒体 ──
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
    api.get<ApiResponse<SharePreviewInfo>>(`/api/share/${id}/preview-info`, { params: { password } }),

  // ── 子文件预览/流媒体/原始内容 ──
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

  // ── 上传链接 ──
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
  getUploadLink: (token: string, password?: string) =>
    api.get<ApiResponse<UploadLinkInfo>>(`/api/share/upload/${token}`, { params: { password } }),

  /** 通过上传链接上传文件（支持进度回调） */
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
// 类型定义 — 权限相关
// ─────────────────────────────────────────────────────────────────────────────

/** 全局权限条目 */
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

/** 权限解析结果 */
export interface ResolvedPermission {
  hasAccess: boolean;
  permission: string | null;
  source: 'explicit' | 'inherited' | 'owner';
  sourceFileId?: string;
  sourceFilePath?: string;
  expiresAt?: string;
}

/** 可搜索的用户（用于权限分配） */
export interface SearchableUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions — 文件权限管理
// ─────────────────────────────────────────────────────────────────────────────

export const permissionsApi = {
  grant: (data: {
    fileId: string;
    userId?: string;
    groupId?: string;
    teamId?: string;
    permission: 'read' | 'write' | 'admin';
    subjectType?: 'user' | 'group' | 'team';
    expiresAt?: string;
    inheritToChildren?: boolean;
  }) => api.post<ApiResponse<{ message: string }>>('/api/permissions/grant', data),
  revoke: (data: { fileId: string; userId?: string; groupId?: string; teamId?: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/revoke', data),

  /** 获取文件的完整权限列表（含继承关系） */
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

  /** 解析文件的最终有效权限（显式/继承/所有者） */
  resolvePermission: (fileId: string) => api.get<ApiResponse<ResolvedPermission>>(`/api/permissions/resolve/${fileId}`),

  searchUsers: (query: string) =>
    api.get<ApiResponse<SearchableUser[]>>('/api/permissions/users/search', { params: { q: query } }),

  // ── 标签管理 ──
  createTag: (data: { name: string; color: string }) =>
    api.post<ApiResponse<FileTag>>('/api/permissions/tags/create', data),
  addTag: (data: { fileId: string; name: string; color?: string }) =>
    api.post<ApiResponse<FileTag>>('/api/permissions/tags/add', data),
  removeTag: (data: { fileId: string; tagName: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/tags/remove', data),
  getFileTags: (fileId: string) => api.get<ApiResponse<FileTag[]>>(`/api/permissions/tags/file/${fileId}`),
  getUserTags: () => api.get<ApiResponse<FileTag[]>>('/api/permissions/tags/user'),
  getBatchFileTags: (fileIds: string[]) =>
    api.post<ApiResponse<Record<string, FileTag[]>>>('/api/permissions/tags/batch', { fileIds }),
  getTagStats: () => api.get<ApiResponse<Array<{ name: string; count: number }>>>('/api/permissions/tags/stats'),
  renameTag: (data: { oldName: string; newName: string }) =>
    api.put<ApiResponse<{ message: string }>>('/api/permissions/tags/rename', data),
  deleteTag: (tagName: string) =>
    api.delete<ApiResponse<{ message: string; affectedRows: number }>>(
      `/api/permissions/tags/${encodeURIComponent(tagName)}`
    ),

  // ── 全局权限视图 ──
  getAllPermissions: () => api.get<ApiResponse<{ permissions: GlobalPermission[] }>>('/api/permissions/all'),
  revokeById: (permissionId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/permissions/${permissionId}`),
  updatePermission: (permissionId: string, permission: 'read' | 'write' | 'admin', expiresAt?: string) =>
    api.patch<ApiResponse<{ message: string }>>(`/api/permissions/${permissionId}`, { permission, expiresAt }),

  // ── 团队协作扩展 ──
  grantWithTemplate: (data: {
    fileId: string;
    targetUserId?: string;
    targetGroupId?: string;
    targetTeamId?: string;
    roleTemplate: 'viewer' | 'editor' | 'manager';
    expiresAt?: string;
  }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/grant', {
      ...data,
      // 将 roleTemplate 映射为 permission: viewer→read, editor→write, manager→admin
      permission: data.roleTemplate === 'viewer' ? 'read' : data.roleTemplate === 'editor' ? 'write' : 'admin',
      subjectType: data.targetTeamId ? 'team' : data.targetGroupId ? 'group' : 'user',
    }),

  batchGrant: (data: {
    fileIds: string[];
    targetUserId?: string;
    targetGroupId?: string;
    targetTeamId?: string;
    permission: 'read' | 'write' | 'admin';
    subjectType?: 'user' | 'group' | 'team';
  }) =>
    api.post<ApiResponse<{ succeeded: number; failed: number; errors: string[] }>>(
      '/api/permissions/batch-grant',
      data
    ),

  batchRevoke: (data: {
    fileIds: string[];
    targetUserId?: string;
    targetGroupId?: string;
    targetTeamId?: string;
    subjectType?: 'user' | 'group' | 'team';
  }) => api.post<ApiResponse<{ succeeded: number; failed: number }>>('/api/permissions/batch-revoke', data),
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 群组相关
// ─────────────────────────────────────────────────────────────────────────────

/** 用户群组 */
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

/** 群组成员 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Groups — 用户群组管理
// ─────────────────────────────────────────────────────────────────────────────

export const groupsApi = {
  list: () => api.get<ApiResponse<{ owned: UserGroup[]; memberOf: UserGroup[] }>>('/api/groups'),
  create: (data: { name: string; description?: string }) => api.post<ApiResponse<UserGroup>>('/api/groups', data),
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
// 类型定义 — Webhook 相关
// ─────────────────────────────────────────────────────────────────────────────

/** Webhook 条目 */
export interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastStatus: number | null;
  createdAt: string;
}

/** Webhook 事件类型 */
export interface WebhookEvent {
  value: string;
  label: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhooks — Webhook 管理
// ─────────────────────────────────────────────────────────────────────────────

export const webhooksApi = {
  list: () => api.get<ApiResponse<Webhook[]>>('/api/webhooks'),
  create: (data: { url: string; events: string[]; secret?: string }) =>
    api.post<ApiResponse<Webhook & { secret: string; warning: string }>>('/api/webhooks', data),
  update: (id: string, data: { url?: string; events?: string[]; isActive?: boolean }) =>
    api.put<ApiResponse<{ message: string }>>(`/api/webhooks/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/webhooks/${id}`),
  test: (id: string) => api.post<ApiResponse<{ message: string }>>(`/api/webhooks/${id}/test`),
  getEvents: () => api.get<ApiResponse<WebhookEvent[]>>('/api/webhooks/events'),
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 通知相关
// ─────────────────────────────────────────────────────────────────────────────

/** 通知条目 */
export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  isRead: boolean;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications — 通知管理
// ─────────────────────────────────────────────────────────────────────────────

export const notificationsApi = {
  list: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    api.get<ApiResponse<{ items: Notification[]; total: number; page: number; limit: number; totalPages: number }>>(
      '/api/notifications',
      { params }
    ),
  getUnreadCount: () => api.get<ApiResponse<{ count: number }>>('/api/notifications/unread-count'),
  markRead: (id: string) => api.put<ApiResponse<{ message: string }>>(`/api/notifications/${id}/read`),
  markAllRead: () => api.put<ApiResponse<{ message: string }>>('/api/notifications/read-all'),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/notifications/${id}`),
  clearRead: () => api.delete<ApiResponse<{ message: string }>>('/api/notifications/read'),

  /** SSE 实时通知流 */
  stream: (options?: { signal?: AbortSignal }) =>
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/notifications/stream`, {
      method: 'GET',
      headers: {
        Authorization: useAuthStore.getState().token ? `Bearer ${useAuthStore.getState().token}` : '',
        Accept: 'text/event-stream',
      },
      credentials: 'include',
      signal: options?.signal,
    }),
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 团队相关
// ─────────────────────────────────────────────────────────────────────────────

/** 团队 */
export interface Team {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  settings: string;
  storageQuota?: number;
  memberCount: number;
  userRole: string;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 团队成员 */
export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  addedBy: string | null;
  createdAt: string;
  name: string | null;
  email: string;
}

/** 团队资源 */
export interface TeamResource {
  id: string;
  teamId: string;
  fileId: string;
  fileName: string;
  filePath: string | null;
  isFolder: boolean;
  mimeType: string | null;
  size: number;
  mountedBy: string;
  mountedAt: string;
}

/** 角色模板 */
export interface RoleTemplate {
  id: string;
  name: string;
  slug: string;
  permissions: string[];
  isBuiltin: boolean;
  description: string | null;
}

/** 权限申请 */
export interface PermissionRequest {
  id: string;
  fileId: string;
  fileName?: string;
  requesterId: string;
  targetTeamId: string | null;
  requestedPermission: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
}

/** 工作区文件条目 */
export interface WorkspaceFile {
  fileId: string;
  fileName: string;
  filePath: string | null;
  fileType: string | null;
  mimeType: string | null;
  size: number;
  isFolder: boolean;
  mountedAt: string;
  permission: 'read' | 'write' | 'admin';
}

/** 邀请信息（创建后返回） */
export interface TeamInvite {
  id: string;
  teamId: string;
  teamName: string;
  inviterName: string | null;
  inviterEmail: string | null;
  role: string;
  message: string | null;
  expiresAt: string | null;
  inviteUrl: string;
  inviteCode: string | null;
}

/** 待定邀请条目 */
export interface PendingInvite {
  id: string;
  inviteToken: string;
  inviteCode: string | null;
  email: string | null;
  role: string;
  message: string | null;
  inviterName: string | null;
  inviterEmail: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** 活动条目 */
export interface TeamActivity {
  id: string;
  userId: string;
  userName: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/** 团队存储统计 */
export interface TeamStorageStats {
  storageQuota: number;
  storageUsed: number;
  usagePercent: number;
  fileCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Teams — 团队管理
// ─────────────────────────────────────────────────────────────────────────────

export const teamsApi = {
  list: () => api.get<ApiResponse<{ owned: Team[]; joined: Team[] }>>('/api/teams'),
  create: (data: { name: string; description?: string }) => api.post<ApiResponse<Team>>('/api/teams', data),
  get: (id: string) => api.get<ApiResponse<Team>>(`/api/teams/${id}`),
  update: (
    id: string,
    data: { name?: string; description?: string; storageQuota?: number; defaultMemberRole?: string }
  ) => api.put<ApiResponse<{ message: string }>>(`/api/teams/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/teams/${id}`),
  getMembers: (id: string) => api.get<ApiResponse<TeamMember[]>>(`/api/teams/${id}/members`),
  addMember: (teamId: string, data: { userId: string; role?: string }) =>
    api.post<ApiResponse<Record<string, unknown>>>(`/api/teams/${teamId}/members`, data),
  removeMember: (teamId: string, userId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/teams/${teamId}/members/${userId}`),
  updateMemberRole: (teamId: string, userId: string, role: string) =>
    api.put<ApiResponse<{ message: string }>>(`/api/teams/${teamId}/members/${userId}/role`, { role }),
  mountResource: (teamId: string, fileId: string, options?: { targetFolderId?: string | null; penetrate?: boolean }) =>
    api.post<ApiResponse<Record<string, unknown>>>(`/api/teams/${teamId}/resources`, { fileId, ...options }),
  unmountResource: (teamId: string, fileId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/teams/${teamId}/resources/${fileId}`),
  listResources: (teamId: string) => api.get<ApiResponse<TeamResource[]>>(`/api/teams/${teamId}/resources/list`),

  // ── 工作区文件 ─-

  /** 获取团队工作区文件列表 */
  getWorkspaceFiles: (teamId: string, params?: { folderId?: string; limit?: number; offset?: number }) =>
    api.get<ApiResponse<{ files: WorkspaceFile[]; total: number }>>(`/api/teams/${teamId}/workspace/files`, {
      params: params ?? {},
    }),

  // ── 邀请管理 ─-

  /** 创建邀请链接 */
  createInvite: (
    teamId: string,
    data: {
      role?: 'member' | 'guest';
      email?: string;
      message?: string;
      expiresInDays?: number;
    }
  ) => api.post<ApiResponse<TeamInvite>>(`/api/teams/${teamId}/invites`, data),

  /** 列出待定邀请 */
  listInvites: (teamId: string) => api.get<ApiResponse<{ invites: PendingInvite[] }>>(`/api/teams/${teamId}/invites`),

  /** 撤销邀请 */
  revokeInvite: (teamId: string, inviteId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/teams/${teamId}/invites/${inviteId}`),

  /** 接受邀请 */
  acceptInvite: (teamId: string, token: string) =>
    api.post<ApiResponse<{ teamId: string; teamName: string; role: string }>>(
      `/api/teams/${teamId}/invites/${token}/accept`
    ),

  // ── 活动流 ─-

  /** 获取团队活动时间线 */
  getActivities: (teamId: string, params?: { limit?: number; offset?: number }) =>
    api.get<ApiResponse<{ items: TeamActivity[]; total: number }>>(`/api/teams/${teamId}/activities`, {
      params: params ?? {},
    }),

  // ── 存储统计 ─-

  /** 获取团队存储统计 */
  getStorageStats: (teamId: string) => api.get<ApiResponse<TeamStorageStats>>(`/api/teams/${teamId}/storage`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Roles — 角色模板管理
// ─────────────────────────────────────────────────────────────────────────────

export const rolesApi = {
  getTemplates: () => api.get<ApiResponse<RoleTemplate[]>>('/api/permissions/roles/templates'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Permission Requests — 权限申请管理
// ─────────────────────────────────────────────────────────────────────────────

export const permissionRequestsApi = {
  create: (data: {
    fileId: string;
    requestedPermission: 'read' | 'write' | 'admin';
    reason?: string;
    targetTeamId?: string;
  }) => api.post<ApiResponse<Record<string, unknown>>>('/api/permissions/requests', data),

  listMy: (params?: { page?: number; limit?: number }) =>
    api.get<ApiResponse<{ items: PermissionRequest[]; total: number; page: number; totalPages: number }>>(
      '/api/permissions/requests/my',
      { params }
    ),

  listPending: (params?: { page?: number; limit?: number }) =>
    api.get<ApiResponse<{ items: PermissionRequest[]; total: number; page: number; totalPages: number }>>(
      '/api/permissions/requests/pending',
      { params }
    ),

  review: (requestId: string, data: { action: 'approve' | 'reject'; comment?: string }) =>
    api.put<ApiResponse<Record<string, unknown>>>(`/api/permissions/requests/${requestId}/review`, data),
};
