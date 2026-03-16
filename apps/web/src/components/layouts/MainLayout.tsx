import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { StorageBar } from '@/components/ui/StorageBar';
import { Toaster } from '@/components/ui/toaster';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import {
  LayoutDashboard, FolderOpen, Share2, Settings, LogOut,
  Menu, X, HardDrive, Trash2, Database,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/utils';

const navItems = [
  { path: '/', label: '概览', icon: LayoutDashboard, exact: true },
  { path: '/files', label: '文件', icon: FolderOpen, exact: false },
  { path: '/shares', label: '分享', icon: Share2, exact: false },
  { path: '/trash', label: '回收站', icon: Trash2, exact: false },
  { path: '/buckets', label: '存储桶', icon: Database, exact: false },
  { path: '/settings', label: '设置', icon: Settings, exact: false },
];

export default function MainLayout() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: trashItems = [] } = useQuery({
    queryKey: ['trash'],
    queryFn: () => filesApi.listTrash().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });
  const trashCount = (trashItems as any[]).length;

  const isActive = (item: typeof navItems[0]) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <HardDrive className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold text-sm">R2Shelf</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-40 w-64 bg-card border-r flex flex-col transform transition-transform duration-200 ease-in-out lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="p-5 border-b hidden lg:flex items-center gap-2.5 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <HardDrive className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-none">R2Shelf</h1>
            <p className="text-xs text-muted-foreground mt-0.5">文件管理系统</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 mt-16 lg:mt-0 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const badge = item.path === '/trash' && trashCount > 0 ? trashCount : null;

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm',
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{item.label}</span>
                {badge && (
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded-full font-medium min-w-[20px] text-center',
                    active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t space-y-4 flex-shrink-0">
          <StorageBar
            used={user?.storageUsed || 0}
            quota={user?.storageQuota || 10737418240}
          />
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-xs flex-shrink-0 select-none">
              {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate leading-none">{user?.name || user?.email}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{user?.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={logout}>
            <LogOut className="h-3.5 w-3.5 mr-2" />
            退出登录
          </Button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <main className="lg:pl-64 pt-16 lg:pt-0">
        <div className="p-6 max-w-[1400px] mx-auto">
          <Outlet />
        </div>
      </main>

      <Toaster />
    </div>
  );
}
