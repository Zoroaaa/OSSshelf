import { lazy, Suspense } from 'react';

const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
  </div>
);

export const LazyLogin = lazy(() => import('./pages/Login'));
export const LazyRegister = lazy(() => import('./pages/Register'));
export const LazyVerifyEmail = lazy(() => import('./pages/VerifyEmail'));
export const LazyForgotPassword = lazy(() => import('./pages/ForgotPassword'));
export const LazyResetPassword = lazy(() => import('./pages/ResetPassword'));
export const LazyDashboard = lazy(() => import('./pages/Dashboard'));
export const LazyFiles = lazy(() => import('./pages/Files'));
export const LazyShares = lazy(() => import('./pages/Shares'));
export const LazySettings = lazy(() => import('./pages/Settings'));
export const LazyTrash = lazy(() => import('./pages/Trash'));
export const LazySharePage = lazy(() => import('./pages/SharePage'));
export const LazyBuckets = lazy(() => import('./pages/Buckets'));
export const LazyAdmin = lazy(() => import('./pages/Admin'));
export const LazyTasks = lazy(() => import('./pages/Tasks'));
export const LazyDownloads = lazy(() => import('./pages/Downloads'));
export const LazyPermissions = lazy(() => import('./pages/Permissions'));
export const LazyAnalytics = lazy(() => import('./pages/Analytics'));
export const LazyStarred = lazy(() => import('./pages/Starred'));
export const LazyAIChat = lazy(() => import('./pages/AIChat').then((m) => ({ default: m.AIChat })));
export const LazyAISettings = lazy(() => import('./pages/AISettings').then((m) => ({ default: m.AISettings })));

interface LazyWrapperProps {
  children: React.ReactNode;
}

export function LazyWrapper({ children }: LazyWrapperProps) {
  return <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>;
}
