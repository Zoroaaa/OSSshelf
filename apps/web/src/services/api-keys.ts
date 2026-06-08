/**
 * api-keys.ts
 *
 * API 密钥管理服务层
 *
 * 职责：
 * - 管理用户的 API 密钥（CRUD 操作）
 * - 支持密钥作用域（scopes）和过期时间控制
 */

import api from './api-client';
import type { ApiResponse } from '@osshelf/shared';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

/** API 密钥条目 */
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

// ─────────────────────────────────────────────────────────────────────────────
// API Keys — 密钥管理
// ─────────────────────────────────────────────────────────────────────────────

export const apiKeysApi = {
  list: () => api.get<ApiResponse<ApiKey[]>>('/api/keys'),
  create: (data: { name: string; scopes: string[]; expiresAt?: string }) =>
    api.post<ApiResponse<ApiKey & { key: string; warning: string }>>('/api/keys', data),
  update: (id: string, data: { name?: string; scopes?: string[]; isActive?: boolean }) =>
    api.patch<ApiResponse<{ message: string }>>(`/api/keys/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/keys/${id}`),
};
