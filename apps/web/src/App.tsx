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
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import MainLayout from './components/layouts/MainLayout';
import AuthLayout from './components/layouts/AuthLayout';
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

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
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

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
