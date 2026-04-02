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
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import MainLayout from './components/layouts/MainLayout';
import AuthLayout from './components/layouts/AuthLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Files from './pages/Files';
import Shares from './pages/Shares';
import Settings from './pages/Settings';
import Trash from './pages/Trash';
import SharePage from './pages/SharePage';
import Buckets from './pages/Buckets';
import Admin from './pages/Admin';
import Tasks from './pages/Tasks';
import Downloads from './pages/Downloads';
import Permissions from './pages/Permissions';
import Analytics from './pages/Analytics';
import Starred from './pages/Starred';

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
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Public share page & upload link */}
      <Route path="/share/:shareId" element={<SharePage />} />
      <Route path="/upload/:uploadToken" element={<SharePage />} />

      {/* Protected */}
      <Route
        element={
          <PrivateRoute>
            <MainLayout />
          </PrivateRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/files" element={<Files />} />
        <Route path="/files/:folderId" element={<Files />} />
        <Route path="/shares" element={<Shares />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/buckets" element={<Buckets />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/permissions" element={<Permissions />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/starred" element={<Starred />} />
        <Route path="/admin" element={<Admin />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
