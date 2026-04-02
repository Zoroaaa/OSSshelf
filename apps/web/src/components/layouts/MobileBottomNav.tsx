/**
 * MobileBottomNav.tsx
 * 移动端底部导航组件
 *
 * 功能:
 * - 底部导航栏
 * - 侧边抽屉菜单
 * - 当前页面高亮
 * - 退出登录功能
 */

import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import {
  LayoutDashboard,
  FolderOpen,
  Share2,
  Settings,
  Upload,
  Plus,
  Menu,
  X,
  Trash2,
  Database,
  LogOut,
  Download,
  Shield,
  ShieldCheck,
  ChevronRight,
  HardDrive,
  Star,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/utils';
import { useFileStore } from '@/stores/files';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { useState, useEffect } from 'react';
import { StorageBar } from '@/components/files/StorageBar';

const NAV_ITEMS = [
  { path: '/', label: '概览', icon: LayoutDashboard, exact: true },
  { path: '/files', label: '文件', icon: FolderOpen, exact: false },
  { path: '/shares', label: '分享', icon: Share2, exact: false },
  { path: '/downloads', label: '下载', icon: Download, exact: false },
];

const QUICK_ACTIONS = [
  { path: '/starred', label: '收藏', icon: Star },
  { path: '/tasks', label: '上传任务', icon: Upload },
  { path: '/analytics', label: '存储分析', icon: BarChart3 },
  { path: '/trash', label: '回收站', icon: Trash2, showBadge: true },
  { path: '/buckets', label: '存储桶', icon: Database },
  { path: '/permissions', label: '权限管理', icon: ShieldCheck },
  { path: '/settings', label: '设置', icon: Settings },
];

interface MobileBottomNavProps {
  onUpload?: () => void;
  onNewFolder?: () => void;
  onNavigate?: (e: React.MouseEvent, path: string) => void;
}

export function MobileBottomNav({ onUpload, onNewFolder, onNavigate }: MobileBottomNavProps) {
  const location = useLocation();
  const [showDrawer, setShowDrawer] = useState(false);
  const { selectedFiles } = useFileStore();
  const { user, logout } = useAuthStore();

  const { data: trashItems = [] } = useQuery({
    queryKey: ['trash'],
    queryFn: () => filesApi.listTrash().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });
  const trashCount = (trashItems as any[]).length;

  const isActive = (item: (typeof NAV_ITEMS)[0]) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  const isInFiles = location.pathname.startsWith('/files');

  useEffect(() => {
    if (showDrawer) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showDrawer]);

  return (
    <>
      <nav className="mobile-nav lg:hidden">
        <div className="flex items-center justify-around h-14">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const badge = item.path === '/files' && selectedFiles.length > 0 ? selectedFiles.length : null;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={(e) => onNavigate?.(e, item.path)}
                className={cn(
                  'flex flex-col items-center justify-center flex-1 h-full relative touch-target-sm',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {badge && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[10px] font-medium bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] mt-0.5">{item.label}</span>
              </NavLink>
            );
          })}

          <button
            onClick={() => setShowDrawer(true)}
            className="flex flex-col items-center justify-center flex-1 h-full text-muted-foreground touch-target-sm"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] mt-0.5">更多</span>
          </button>
        </div>
      </nav>

      {showDrawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="mobile-drawer-overlay animate-fade-in" onClick={() => setShowDrawer(false)} />
          <div className="mobile-drawer animate-slide-in-right flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">菜单</h3>
              <button
                onClick={() => setShowDrawer(false)}
                className="p-2 rounded-full hover:bg-accent touch-target-sm flex items-center justify-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="p-4">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                  <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-lg">
                    {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{user?.name || user?.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                </div>
              </div>

              <div className="px-4 pb-4">
                <div className="p-3 rounded-xl bg-muted/30 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <HardDrive className="h-4 w-4" />
                    <span>存储空间</span>
                  </div>
                  <StorageBar used={user?.storageUsed || 0} quota={user?.storageQuota || 10737418240} />
                </div>
              </div>

              {isInFiles && (
                <div className="px-4 pb-2">
                  <p className="text-xs text-muted-foreground px-1 mb-2">快捷操作</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setShowDrawer(false);
                        onUpload?.();
                      }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 text-primary active:bg-primary/20 transition-colors"
                    >
                      <Upload className="h-5 w-5" />
                      <span className="text-sm font-medium">上传文件</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowDrawer(false);
                        onNewFolder?.();
                      }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-muted hover:bg-accent transition-colors"
                    >
                      <Plus className="h-5 w-5" />
                      <span className="text-sm font-medium">新建文件夹</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="px-4 py-2">
                <p className="text-xs text-muted-foreground px-1 mb-2">功能</p>
                <div className="space-y-1">
                  {QUICK_ACTIONS.map((action) => {
                    const Icon = action.icon;
                    return (
                      <NavLink
                        key={action.path}
                        to={action.path}
                        onClick={() => setShowDrawer(false)}
                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-accent transition-colors"
                      >
                        <div className="relative">
                          <Icon className="h-5 w-5 text-muted-foreground" />
                          {action.showBadge && trashCount > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 text-[9px] font-medium bg-destructive text-destructive-foreground rounded-full flex items-center justify-center">
                              {trashCount > 99 ? '99+' : trashCount}
                            </span>
                          )}
                        </div>
                        <span className="flex-1 text-sm">{action.label}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </NavLink>
                    );
                  })}

                  {user?.role === 'admin' && (
                    <NavLink
                      to="/admin"
                      onClick={() => setShowDrawer(false)}
                      className="flex items-center gap-3 p-3 rounded-xl hover:bg-accent transition-colors"
                    >
                      <Shield className="h-5 w-5 text-muted-foreground" />
                      <span className="flex-1 text-sm">管理后台</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </NavLink>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t safe-bottom">
              <button
                onClick={() => {
                  setShowDrawer(false);
                  logout();
                }}
                className="w-full py-3 text-center text-sm text-red-500 bg-red-500/10 rounded-xl flex items-center justify-center gap-2 active:bg-red-500/20 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
