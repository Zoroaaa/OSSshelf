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
          const { authApi } = await import('@/services/api');
          const res = await authApi.me();
          if (res.data.data) {
            set({
              user: res.data.data,
              isAuthenticated: true,
              isInitialized: true,
            });
          } else {
            set({
              user: null,
              token: null,
              isAuthenticated: false,
              isInitialized: true,
            });
          }
        } catch {
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isInitialized: true,
          });
        }
      },
    }),
    {
      name: 'ossshelf-auth',
    }
  )
);
