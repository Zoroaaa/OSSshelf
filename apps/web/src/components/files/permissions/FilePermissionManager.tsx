/**
 * FilePermissionManager.tsx
 * 文件权限管理组件
 *
 * 功能:
 * - 查看文件权限
 * - 为用户授权/撤销权限
 * - 支持read/write/admin权限级别
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi, type SearchableUser } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import { Shield, Plus, X, Loader2, User, Crown, Edit, Eye, Trash2 } from 'lucide-react';

interface FilePermissionManagerProps {
  fileId: string;
  isOwner: boolean;
}

const PERMISSION_CONFIG = {
  read: { label: '只读', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  write: { label: '读写', icon: Edit, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  admin: { label: '管理', icon: Crown, color: 'text-purple-500', bg: 'bg-purple-500/10' },
};

export function FilePermissionManager({ fileId, isOwner }: FilePermissionManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [selectedPermission, setSelectedPermission] = useState<'read' | 'write' | 'admin'>('read');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchableUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { data: permissionData, isLoading } = useQuery({
    queryKey: ['file-permissions', fileId],
    queryFn: () => permissionsApi.getFilePermissions(fileId).then((r) => r.data.data),
  });

  // 使用新的用户搜索接口
  useEffect(() => {
    if (!showAddForm || searchEmail.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await permissionsApi.searchUsers(searchEmail);
        const users = res.data.data ?? [];
        // 过滤掉已有权限的用户
        const existingUserIds = new Set(permissionData?.permissions?.map((p) => p.userId) ?? []);
        setSearchResults(users.filter((u) => !existingUserIds.has(u.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchEmail, showAddForm, permissionData?.permissions]);

  const grantMutation = useMutation({
    mutationFn: (data: { userId: string; permission: 'read' | 'write' | 'admin' }) =>
      permissionsApi.grant({ fileId, ...data }),
    onSuccess: () => {
      toast({ title: '权限已授予' });
      queryClient.invalidateQueries({ queryKey: ['file-permissions', fileId] });
      setShowAddForm(false);
      setSearchEmail('');
      setSelectedUserId(null);
    },
    onError: (e: any) =>
      toast({
        title: '授权失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) => permissionsApi.revoke({ fileId, userId }),
    onSuccess: () => {
      toast({ title: '权限已撤销' });
      queryClient.invalidateQueries({ queryKey: ['file-permissions', fileId] });
    },
    onError: (e: any) =>
      toast({
        title: '撤销失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const handleGrant = () => {
    if (!selectedUserId) {
      toast({ title: '请选择用户', variant: 'destructive' });
      return;
    }
    grantMutation.mutate({ userId: selectedUserId, permission: selectedPermission });
  };

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  const permissions = permissionData?.permissions ?? [];

  return (
    <div className="space-y-4">
      {isOwner && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">您是此文件的所有者，拥有完整管理权限</p>
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? <X className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            {showAddForm ? '取消' : '添加用户'}
          </Button>
        </div>
      )}

      {showAddForm && isOwner && (
        <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">搜索用户</label>
            <Input placeholder="输入邮箱搜索..." value={searchEmail} onChange={(e) => setSearchEmail(e.target.value)} />
          </div>

          {isSearching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              搜索中...
            </div>
          )}

          {!isSearching && searchEmail.length >= 2 && searchResults.length === 0 && (
            <div className="text-sm text-muted-foreground py-2">未找到匹配的用户</div>
          )}

          {searchResults.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-1 border rounded-lg p-1">
              {searchResults.slice(0, 5).map((user) => (
                <button
                  key={user.id}
                  onClick={() => setSelectedUserId(user.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                    selectedUserId === user.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  )}
                >
                  <User className="h-3.5 w-3.5" />
                  <span className="flex-1 truncate">{user.name || user.email}</span>
                  <span className="text-xs opacity-70">{user.email}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium">权限级别</label>
            <div className="flex gap-1">
              {(Object.keys(PERMISSION_CONFIG) as Array<keyof typeof PERMISSION_CONFIG>).map((perm) => {
                const config = PERMISSION_CONFIG[perm];
                const Icon = config.icon;
                return (
                  <button
                    key={perm}
                    onClick={() => setSelectedPermission(perm)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border',
                      selectedPermission === perm ? `${config.bg} ${config.color} border-current` : 'hover:bg-muted'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={handleGrant}
            disabled={!selectedUserId || grantMutation.isPending}
          >
            {grantMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Shield className="h-3.5 w-3.5 mr-1" />
            )}
            授权
          </Button>
        </div>
      )}

      {permissions.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground text-sm">暂无其他用户权限</div>
      ) : (
        <div className="space-y-2">
          {permissions.map((perm) => {
            const config =
              PERMISSION_CONFIG[perm.permission as keyof typeof PERMISSION_CONFIG] || PERMISSION_CONFIG.read;
            const Icon = config.icon;
            return (
              <div key={perm.id} className="flex items-center gap-3 p-2 rounded-lg border bg-muted/30">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{perm.userName || perm.userEmail}</p>
                  <p className="text-xs text-muted-foreground truncate">{perm.userEmail}</p>
                </div>
                <div
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
                    config.bg,
                    config.color
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {config.label}
                </div>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-500"
                    onClick={() => revokeMutation.mutate(perm.userId)}
                    disabled={revokeMutation.isPending}
                  >
                    {revokeMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
