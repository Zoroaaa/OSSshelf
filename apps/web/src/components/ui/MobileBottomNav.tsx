/**
 * MobileBottomNav.tsx
 * 移动端底部导航组件
 *
 * 功能:
 * - 底部导航栏
 * - 快捷操作按钮
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
} from 'lucide-react';
import { cn } from '@/utils';
import { useFileStore } from '@/stores/files';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { useState } from 'react';

const NAV_ITEMS = [
  { path: '/', label: '概览', icon: LayoutDashboard, exact: true },
  { path: '/files', label: '文件', icon: FolderOpen, exact: false },
  { path: '/shares', label: '分享', icon: Share2, exact: false },
  { path: '/downloads', label: '下载', icon: Download, exact: false },
];

interface MobileBottomNavProps {
  onUpload?: () => void;
  onNewFolder?: () => void;
  onNavigate?: (e: React.MouseEvent, path: string) => void;
}

export function MobileBottomNav({ onUpload, onNewFolder, onNavigate }: MobileBottomNavProps) {
  const location = useLocation();
  const [showQuickActions, setShowQuickActions] = useState(false);
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
                  'flex flex-col items-center justify-center flex-1 h-full relative',
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
            onClick={() => setShowQuickActions(true)}
            className="flex flex-col items-center justify-center flex-1 h-full text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] mt-0.5">更多</span>
          </button>
        </div>
      </nav>

      {showQuickActions && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowQuickActions(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-card border-t rounded-t-2xl animate-slide-up safe-bottom">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">快捷操作</h3>
              <button onClick={() => setShowQuickActions(false)} className="p-1 rounded-full hover:bg-accent">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4">
              <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-muted/50">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                  {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.name || user?.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                {isInFiles && (
                  <>
                    <QuickActionButton
                      icon={Upload}
                      label="上传"
                      onClick={() => {
                        setShowQuickActions(false);
                        onUpload?.();
                      }}
                    />
                    <QuickActionButton
                      icon={Plus}
                      label="新建文件夹"
                      onClick={() => {
                        setShowQuickActions(false);
                        onNewFolder?.();
                      }}
                    />
                  </>
                )}

                <NavLink
                  to="/tasks"
                  onClick={() => setShowQuickActions(false)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground">上传任务</span>
                </NavLink>

                <NavLink
                  to="/trash"
                  onClick={() => setShowQuickActions(false)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center relative">
                    <Trash2 className="h-5 w-5 text-muted-foreground" />
                    {trashCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[10px] font-medium bg-destructive text-destructive-foreground rounded-full flex items-center justify-center">
                        {trashCount > 99 ? '99+' : trashCount}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">回收站</span>
                </NavLink>

                <NavLink
                  to="/buckets"
                  onClick={() => setShowQuickActions(false)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <Database className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground">存储桶</span>
                </NavLink>

                <NavLink
                  to="/settings"
                  onClick={() => setShowQuickActions(false)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <Settings className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground">设置</span>
                </NavLink>

                {user?.role === 'admin' && (
                  <NavLink
                    to="/admin"
                    onClick={() => setShowQuickActions(false)}
                    className="flex flex-col items-center gap-1"
                  >
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                      <Shield className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <span className="text-xs text-muted-foreground">管理</span>
                  </NavLink>
                )}
              </div>
            </div>

            <div className="p-4 pt-0 space-y-2">
              <button
                onClick={() => {
                  setShowQuickActions(false);
                  logout();
                }}
                className="w-full py-3 text-center text-sm text-red-500 bg-red-500/10 rounded-lg flex items-center justify-center gap-2"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
              <button
                onClick={() => setShowQuickActions(false)}
                className="w-full py-3 text-center text-sm text-muted-foreground bg-muted rounded-lg"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function QuickActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Upload;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1">
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </button>
  );
}
