/**
 * auth.ts
 * 认证状态管理 Store
 *
 * 功能:
 * - 用户登录状态管理
 * - 令牌存储与验证
 * - 自动恢复登录状态
 * - 设备管理
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@osshelf/shared';
import { authApi } from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isInitialized: false,
      setAuth: (user, token) =>
        set({
          user,
          token,
          isAuthenticated: true,
          isInitialized: true,
        }),
      logout: () =>
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isInitialized: true,
        }),
      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
      initialize: async () => {
        const { token, isAuthenticated } = get();
        if (!token || !isAuthenticated) {
          set({ isInitialized: true });
          return;
        }
        try {
          const res = await authApi.me();
          if (res.data.data) {
            set({
              user: res.data.data,
              isAuthenticated: true,
              isInitialized: true,
            });
          } else {
            // 服务端返回成功但无用户数据，视为会话失效
            set({ user: null, token: null, isAuthenticated: false, isInitialized: true });
          }
        } catch (err: any) {
          // 仅在明确的 401（会话失效/令牌无效）时清除凭证
          // 网络错误、5xx 等临时故障保留 token，避免网络抖动导致用户被意外登出
          const status = err?.response?.status;
          if (status === 401) {
            set({ user: null, token: null, isAuthenticated: false, isInitialized: true });
          } else {
            // 网络错误或服务端错误：保持已有 token，标记已初始化
            set({ isInitialized: true });
          }
        }
      },
    }),
    {
      name: 'ossshelf-auth',
    }
  )
);
