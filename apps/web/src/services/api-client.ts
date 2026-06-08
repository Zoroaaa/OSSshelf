/**
 * api-client.ts
 *
 * API 基础设施层 — axios 实例与拦截器配置
 *
 * 职责：
 * - 创建预配置的 axios 实例（baseURL、timeout）
 * - 请求拦截器：自动注入 Bearer Token
 * - 响应拦截器：401 自动登出并跳转登录页（排除公开端点）
 */

import axios from 'axios';
import { useAuthStore } from '../stores/auth';

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

export default api;
