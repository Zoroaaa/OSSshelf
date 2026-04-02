/**
 * MainLayout.tsx
 * 主布局组件
 *
 * 功能:
 * - 响应式侧边栏（仅桌面端）
 * - 移动端底部导航
 * - PWA 安装提示
 * - 快捷键支持
 */

import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { useFileStore } from '@/stores/files';
import { useThemeStore } from '@/stores/theme';
import { Button } from '@/components/ui/Button';
import { StorageBar } from '@/components/files/StorageBar';
import { Toaster } from '@/components/ui/Toaster';
import { MobileBottomNav } from '@/components/layouts/MobileBottomNav';
import { PWAPrompt } from '@/components/ui/PWAInstallPrompt';
import { NotificationBell } from '@/components/notifications';
import { EmailVerificationBanner } from '@/components/auth/EmailVerificationBanner';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import {
  LayoutDashboard,
  FolderOpen,
  Share2,
  Settings,
  LogOut,
  HardDrive,
  Trash2,
  Database,
  Shield,
  ShieldCheck,
  ChevronLeft,
  Keyboard,
  Upload,
  Download,
  Sun,
  Moon,
  Monitor,
  BarChart3,
  Star,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/utils';
import { KeyboardShortcutsDialog } from '@/components/ui/KeyboardShortcutsDialog';

const baseNavItems = [
  { path: '/', label: '概览', icon: LayoutDashboard, exact: true },
  { path: '/files', label: '文件', icon: FolderOpen, exact: false },
  { path: '/starred', label: '收藏', icon: Star, exact: false },
  { path: '/shares', label: '分享', icon: Share2, exact: false },
  { path: '/tasks', label: '上传任务', icon: Upload, exact: false },
  { path: '/downloads', label: '离线下载', icon: Download, exact: false },
  { path: '/analytics', label: '存储分析', icon: BarChart3, exact: false },
  { path: '/trash', label: '回收站', icon: Trash2, exact: false },
  { path: '/buckets', label: '存储桶', icon: Database, exact: false },
  { path: '/permissions', label: '权限管理', icon: ShieldCheck, exact: false },
  { path: '/settings', label: '设置', icon: Settings, exact: false },
];

const adminNavItem = { path: '/admin', label: '管理', icon: Shield, exact: false };

export default function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const navItems = user?.role === 'admin' ? [...baseNavItems, adminNavItem] : baseNavItems;

  const cycleTheme = () => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const currentTheme = theme || 'system';
    const currentIndex = themes.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    if (nextTheme) {
      setTheme(nextTheme);
    }
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return Sun;
      case 'dark':
        return Moon;
      default:
        return Monitor;
    }
  };

  const ThemeIcon = getThemeIcon();

  const { data: trashItems = [] } = useQuery({
    queryKey: ['trash'],
    queryFn: () => filesApi.listTrash().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });
  const trashCount = (trashItems as any[]).length;

  const { canGoBack, goBack, goForward } = useFileStore();

  const isActive = (item: (typeof navItems)[0]) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        const targetFolderId = goBack();
        if (targetFolderId !== null) {
          navigate(targetFolderId ? `/files/${targetFolderId}` : '/files');
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        const targetFolderId = goForward();
        if (targetFolderId !== null) {
          navigate(targetFolderId ? `/files/${targetFolderId}` : '/files');
        }
      }

      if (e.key === '?' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goBack, goForward, navigate]);

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      console.log('Selected files:', files);
    }
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-background">
      <EmailVerificationBanner />
      {/* 移动端顶部栏 - 精简版 */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-b px-3 py-2.5 flex items-center justify-between safe-top">
        <div className="flex items-center gap-2">
          {location.pathname.startsWith('/files') && canGoBack() && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 -ml-1"
              onClick={() => {
                const targetFolderId = goBack();
                if (targetFolderId !== null) {
                  navigate(targetFolderId ? `/files/${targetFolderId}` : '/files');
                }
              }}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <HardDrive className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-sm">OSSshelf</span>
        </div>

        <div className="flex items-center gap-1">
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 touch-target-sm"
            onClick={cycleTheme}
            title={`当前主题: ${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}`}
          >
            <ThemeIcon className="h-4.5 w-4.5" />
          </Button>
        </div>
      </div>

      {/* 桌面端侧边栏 */}
      <aside
        className={cn(
          'hidden lg:flex fixed inset-y-0 left-0 z-40 bg-card border-r flex-col transform transition-all duration-200 ease-in-out',
          isCollapsed ? 'w-16' : 'w-64',
          isHovering && isCollapsed && 'w-64'
        )}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <div
          className={cn(
            'p-5 border-b flex items-center gap-2.5 flex-shrink-0',
            isCollapsed && !isHovering && 'justify-center px-3'
          )}
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm flex-shrink-0">
            <HardDrive className="h-4 w-4 text-primary-foreground" />
          </div>
          {(!isCollapsed || isHovering) && (
            <div className="overflow-hidden">
              <h1 className="text-base font-bold leading-none whitespace-nowrap">OSSshelf</h1>
              <p className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap">文件管理系统</p>
            </div>
          )}
        </div>

        <nav className={cn('flex-1 p-3 space-y-0.5 overflow-y-auto', isCollapsed && !isHovering && 'px-2')}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const badge = item.path === '/trash' && trashCount > 0 ? trashCount : null;
            const showLabel = !isCollapsed || isHovering;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 rounded-lg transition-colors text-sm',
                  showLabel ? 'px-3 py-2.5' : 'px-2 py-2.5 justify-center',
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                title={!showLabel ? item.label : undefined}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {showLabel && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {badge && (
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded-full font-medium min-w-[20px] text-center',
                          active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        <div className={cn('p-4 border-t space-y-4 flex-shrink-0', isCollapsed && !isHovering && 'px-2')}>
          {(!isCollapsed || isHovering) && (
            <StorageBar used={user?.storageUsed || 0} quota={user?.storageQuota || 10737418240} />
          )}

          {(!isCollapsed || isHovering) && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-xs flex-shrink-0 select-none">
                {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <p className="text-xs font-medium truncate leading-none">{user?.name || user?.email}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{user?.email}</p>
              </div>
              <NotificationBell align="left" direction="up" className="flex-shrink-0" />
            </div>
          )}

          {isCollapsed && !isHovering && (
            <div className="flex justify-center">
              <NotificationBell align="left" direction="up" />
            </div>
          )}

          <div className={cn('flex gap-2', isCollapsed && !isHovering && 'flex-col')}>
            {(!isCollapsed || isHovering) && (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={cycleTheme}
                title={`当前主题: ${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}`}
              >
                <ThemeIcon className="h-3.5 w-3.5 mr-1.5" />
                {theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '系统'}
              </Button>
            )}

            {(!isCollapsed || isHovering) && (
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => setShowShortcuts(true)}>
                <Keyboard className="h-3.5 w-3.5 mr-1.5" />
                快捷键
              </Button>
            )}

            {isCollapsed && !isHovering && (
              <Button
                variant="ghost"
                size="icon"
                className="w-full px-2"
                onClick={cycleTheme}
                title={`当前主题: ${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}`}
              >
                <ThemeIcon className="h-4 w-4" />
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className={cn('flex-1', isCollapsed && !isHovering && 'w-full px-2')}
              onClick={logout}
            >
              <LogOut className={cn('h-3.5 w-3.5', (!isCollapsed || isHovering) && 'mr-1.5')} />
              {(!isCollapsed || isHovering) && '退出'}
            </Button>
          </div>
        </div>

        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-card border rounded-full items-center justify-center shadow-sm hover:bg-accent transition-colors"
        >
          <ChevronLeft className={cn('h-3 w-3 transition-transform', isCollapsed && 'rotate-180')} />
        </button>
      </aside>

      <main
        className={cn(
          'transition-all duration-200',
          isCollapsed ? 'lg:pl-16' : 'lg:pl-64',
          'pt-16 lg:pt-0 pb-20 lg:pb-0 min-h-[calc(100vh-4rem)]'
        )}
      >
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
          <Outlet />
        </div>
      </main>

      <MobileBottomNav
        onUpload={handleUpload}
        onNewFolder={() => {
          if (location.pathname.startsWith('/files')) {
            console.log('New folder');
          }
        }}
      />

      <PWAPrompt />
      <Toaster />

      <KeyboardShortcutsDialog isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  );
}
