/**
 * App.tsx
 * 应用入口组件
 *
 * 功能:
 * - 路由配置
 * - 认证状态初始化
 * - 私有路由保护
 */

import { useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import MainLayout from './components/layouts/MainLayout';
import AuthLayout from './components/layouts/AuthLayout';
import { GlobalConfirmDialog } from './components/ui/GlobalConfirmDialog';
import {
  LazyLogin,
  LazyRegister,
  LazyVerifyEmail,
  LazyForgotPassword,
  LazyResetPassword,
  LazyDashboard,
  LazyFiles,
  LazyShares,
  LazySettings,
  LazyTrash,
  LazySharePage,
  LazyBuckets,
  LazyAdmin,
  LazyTasks,
  LazyDownloads,
  LazyPermissions,
  LazyAnalytics,
  LazyStarred,
  LazyTags,
  LazyAIChat,
  LazyAISettings,
  LazyTeams,
  LazyTeamWorkspace,
  LazyAcceptInvite,
  LazyWrapper,
} from './LazyComponents';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isInitialized } = useAuthStore();
  const location = useLocation();

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // 系统分享 token / 协议目录路径只挂在 URL 上，登录后需要回到原地址继续处理
    const params = new URLSearchParams(location.search);
    if (params.has('shareTarget') || params.has('path')) {
      const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
      return <Navigate to={`/login?redirect=${redirect}`} replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function App() {
  const initialize = useAuthStore((state) => state.initialize);
  const location = useLocation();

  useEffect(() => {
    initialize();
  }, [initialize]);

  // 路由级标题管理（审查报告 E-23）：让标签页/历史/读屏可区分当前页
  useEffect(() => {
    const path = location.pathname;
    const titleMap: Array<[RegExp, string]> = [
      [/^\/files/, '文件'],
      [/^\/starred/, '收藏'],
      [/^\/tags/, '标签'],
      [/^\/trash/, '回收站'],
      [/^\/shares/, '分享'],
      [/^\/share\//, '共享文件'],
      [/^\/downloads/, '下载任务'],
      [/^\/tasks/, '上传任务'],
      [/^\/buckets/, '存储桶'],
      [/^\/analytics/, '统计分析'],
      [/^\/admin/, '管理后台'],
      [/^\/settings/, '设置'],
      [/^\/permissions/, '权限管理'],
      [/^\/ai-chat/, 'AI 对话'],
      [/^\/ai-settings/, 'AI 配置'],
      [/^\/teams/, '团队'],
      [/^\/login/, '登录'],
      [/^\/register/, '注册'],
      [/^\/forgot-password/, '找回密码'],
      [/^\/reset-password/, '重置密码'],
      [/^\/verify-email/, '验证邮箱'],
      [/^\/accept-invite/, '接受邀请'],
    ];
    const match = titleMap.find(([re]) => re.test(path));
    document.title = `${match ? match[1] : '概览'} - OSSshelf`;
    // E-29 修复：路由切换后回到顶部，避免从长列表进入详情再返回时停留在错误滚动位置
    window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  return (
    <>
      <Routes>
        {/* Auth */}
        <Route element={<AuthLayout />}>
          <Route
            path="/login"
            element={
              <LazyWrapper>
                <LazyLogin />
              </LazyWrapper>
            }
          />
          <Route
            path="/register"
            element={
              <LazyWrapper>
                <LazyRegister />
              </LazyWrapper>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <LazyWrapper>
                <LazyForgotPassword />
              </LazyWrapper>
            }
          />
          <Route
            path="/reset-password"
            element={
              <LazyWrapper>
                <LazyResetPassword />
              </LazyWrapper>
            }
          />
        </Route>

        {/* Email verification (public) */}
        <Route
          path="/verify-email"
          element={
            <LazyWrapper>
              <LazyVerifyEmail />
            </LazyWrapper>
          }
        />

        {/* Public share page & upload link */}
        <Route
          path="/share/:shareId"
          element={
            <LazyWrapper>
              <LazySharePage />
            </LazyWrapper>
          }
        />
        <Route
          path="/upload/:uploadToken"
          element={
            <LazyWrapper>
              <LazySharePage />
            </LazyWrapper>
          }
        />

        {/* 公开：团队邀请接受页面（登录前后均可访问） */}
        <Route
          path="/invite/:token"
          element={
            <LazyWrapper>
              <LazyAcceptInvite />
            </LazyWrapper>
          }
        />

        {/* Protected - MainLayout 内 */}
        <Route
          element={
            <PrivateRoute>
              <MainLayout />
            </PrivateRoute>
          }
        >
          <Route
            path="/"
            element={
              <LazyWrapper>
                <LazyDashboard />
              </LazyWrapper>
            }
          />
          <Route
            path="/files"
            element={
              <LazyWrapper>
                <LazyFiles />
              </LazyWrapper>
            }
          />
          <Route
            path="/files/:folderId"
            element={
              <LazyWrapper>
                <LazyFiles />
              </LazyWrapper>
            }
          />
          <Route
            path="/shares"
            element={
              <LazyWrapper>
                <LazyShares />
              </LazyWrapper>
            }
          />
          <Route
            path="/shares/:tab"
            element={
              <LazyWrapper>
                <LazyShares />
              </LazyWrapper>
            }
          />
          <Route
            path="/trash"
            element={
              <LazyWrapper>
                <LazyTrash />
              </LazyWrapper>
            }
          />
          <Route
            path="/settings"
            element={
              <LazyWrapper>
                <LazySettings />
              </LazyWrapper>
            }
          />
          <Route
            path="/settings/:tab"
            element={
              <LazyWrapper>
                <LazySettings />
              </LazyWrapper>
            }
          />
          <Route
            path="/buckets"
            element={
              <LazyWrapper>
                <LazyBuckets />
              </LazyWrapper>
            }
          />
          <Route
            path="/tasks"
            element={
              <LazyWrapper>
                <LazyTasks />
              </LazyWrapper>
            }
          />
          <Route
            path="/downloads"
            element={
              <LazyWrapper>
                <LazyDownloads />
              </LazyWrapper>
            }
          />
          <Route
            path="/permissions"
            element={
              <LazyWrapper>
                <LazyPermissions />
              </LazyWrapper>
            }
          />
          <Route
            path="/permissions/:tab"
            element={
              <LazyWrapper>
                <LazyPermissions />
              </LazyWrapper>
            }
          />
          <Route
            path="/analytics"
            element={
              <LazyWrapper>
                <LazyAnalytics />
              </LazyWrapper>
            }
          />
          <Route
            path="/starred"
            element={
              <LazyWrapper>
                <LazyStarred />
              </LazyWrapper>
            }
          />
          <Route
            path="/tags"
            element={
              <LazyWrapper>
                <LazyTags />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin"
            element={
              <LazyWrapper>
                <LazyAdmin />
              </LazyWrapper>
            }
          />
          <Route
            path="/admin/:tab"
            element={
              <LazyWrapper>
                <LazyAdmin />
              </LazyWrapper>
            }
          />
          <Route
            path="/ai-settings"
            element={
              <LazyWrapper>
                <LazyAISettings />
              </LazyWrapper>
            }
          />
          <Route
            path="/ai-settings/:tab"
            element={
              <LazyWrapper>
                <LazyAISettings />
              </LazyWrapper>
            }
          />
          <Route
            path="/teams"
            element={
              <LazyWrapper>
                <LazyTeams />
              </LazyWrapper>
            }
          />
          <Route
            path="/teams/:teamId"
            element={
              <LazyWrapper>
                <LazyTeams />
              </LazyWrapper>
            }
          />
          <Route
            path="/teams/:teamId/workspace"
            element={
              <LazyWrapper>
                <LazyTeamWorkspace />
              </LazyWrapper>
            }
          />
        </Route>

        {/* Protected - 独立全屏页面（无侧边栏） */}
        <Route
          element={
            <PrivateRoute>
              <Outlet />
            </PrivateRoute>
          }
        >
          <Route
            path="/ai-chat"
            element={
              <LazyWrapper>
                <LazyAIChat />
              </LazyWrapper>
            }
          />
          <Route
            path="/ai-chat/:sessionId"
            element={
              <LazyWrapper>
                <LazyAIChat />
              </LazyWrapper>
            }
          />
        </Route>

        {/* E-28 修复：无效 URL 显示明确 404 页，而非静默重定向到概览页 */}
        <Route
          path="*"
          element={
            <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
              <p className="text-5xl font-bold text-primary">404</p>
              <div className="space-y-1">
                <h1 className="text-lg font-semibold">页面不存在</h1>
                <p className="text-sm text-muted-foreground">你访问的地址可能有误或已被移除。</p>
              </div>
              <a
                href="/"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                返回首页
              </a>
            </div>
          }
        />
      </Routes>
      <GlobalConfirmDialog />
    </>
  );
}

export default App;
