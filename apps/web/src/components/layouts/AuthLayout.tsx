/**
 * AuthLayout.tsx
 * 认证页面布局组件
 *
 * 功能:
 * - 登录/注册页面布局
 * - 居中卡片样式
 * - 渐变背景
 */

import { Outlet } from 'react-router-dom';
import { Toaster } from '@/components/ui/Toaster';

export default function AuthLayout() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary">OSSshelf</h1>
          <p className="text-muted-foreground mt-2">基于 Cloudflare 部署的多厂商 OSS 文件管理系统</p>
        </div>
        <Outlet />
      </div>
      <Toaster />
    </div>
  );
}
