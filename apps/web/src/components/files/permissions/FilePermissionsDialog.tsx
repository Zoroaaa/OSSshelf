/**
 * FilePermissionsDialog.tsx
 * 文件权限管理对话框
 *
 * 功能:
 * - 查看文件权限
 * - 授予/撤销用户权限
 * - 查看权限列表
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi, type SearchableUser } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import { Shield, X, Trash2, Crown, Eye, Edit, UserPlus, Loader2, User } from 'lucide-react';

interface FilePermissionsDialogProps {
  fileId: string;
  fileName: string;
  isFolder: boolean;
  onClose: () => void;
}

const PERMISSION_LABELS: Record<string, { label: string; icon: typeof Eye; color: string }> = {
  read: { label: '只读', icon: Eye, color: 'text-blue-500' },
  write: { label: '读写', icon: Edit, color: 'text-amber-500' },
  admin: { label: '管理', icon: Crown, color: 'text-purple-500' },
};

const DEFAULT_PERMISSION = { label: '只读', icon: Eye, color: 'text-blue-500' };

export function FilePermissionsDialog({ fileId, fileName, isFolder, onClose }: FilePermissionsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [newPermission, setNewPermission] = useState<'read' | 'write' | 'admin'>('read');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchableUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { data: permissionsData, isLoading } = useQuery({
    queryKey: ['permissions', fileId],
    queryFn: () => permissionsApi.getFilePermissions(fileId).then((r) => r.data.data),
  });

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await permissionsApi.searchUsers(searchQuery);
        const users = res.data.data ?? [];
        const existingUserIds = new Set(
          (permissionsData?.permissions ?? []).filter((p: any) => p.subjectType === 'user').map((p: any) => p.userId)
        );
        setSearchResults(users.filter((u) => !existingUserIds.has(u.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, permissionsData]);

  const grantMutation = useMutation({
    mutationFn: (data: { userId: string; permission: 'read' | 'write' | 'admin' }) =>
      permissionsApi.grant({ fileId, ...data, subjectType: 'user' }),
    onSuccess: () => {
      toast({ title: '权限已授予' });
      queryClient.invalidateQueries({ queryKey: ['permissions', fileId] });
      setSearchQuery('');
      setSelectedUserId(null);
      setSearchResults([]);
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
      queryClient.invalidateQueries({ queryKey: ['permissions', fileId] });
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
    grantMutation.mutate({ userId: selectedUserId, permission: newPermission });
  };

  const isOwner = permissionsData?.isOwner;
  const permissions = permissionsData?.permissions ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold">权限管理</h2>
              <p className="text-xs text-muted-foreground truncate max-w-[280px]">{fileName}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {!isOwner && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-600 dark:text-amber-400">
                  您不是此{isFolder ? '文件夹' : '文件'}的所有者，无法修改权限
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-medium">当前权限</h3>
                {permissions.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">暂无其他用户权限</div>
                ) : (
                  <div className="space-y-2">
                    {permissions.map((perm: any) => {
                      const permInfo = PERMISSION_LABELS[perm.permission] ?? DEFAULT_PERMISSION;
                      const PermIcon = permInfo.icon;
                      return (
                        <div key={perm.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                            {(perm.userName || perm.userEmail).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{perm.userName || perm.userEmail}</p>
                            <p className="text-xs text-muted-foreground truncate">{perm.userEmail}</p>
                          </div>
                          <div className={cn('flex items-center gap-1 text-xs', permInfo.color)}>
                            <PermIcon className="h-3.5 w-3.5" />
                            {permInfo.label}
                          </div>
                          {isOwner && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500 hover:text-red-600"
                              onClick={() => perm.userId && revokeMutation.mutate(perm.userId)}
                              disabled={revokeMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {isOwner && (
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="text-sm font-medium">添加权限</h3>
                  <div className="space-y-2">
                    <Input
                      placeholder="输入用户邮箱搜索..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSelectedUserId(null);
                      }}
                    />
                    {isSearching && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        搜索中...
                      </div>
                    )}
                    {searchResults.length > 0 && (
                      <div className="max-h-32 overflow-y-auto space-y-1 border rounded-lg p-1">
                        {searchResults.slice(0, 5).map((user) => (
                          <button
                            key={user.id}
                            onClick={() => {
                              setSelectedUserId(user.id);
                              setSearchQuery(user.name || user.email);
                            }}
                            className={cn(
                              'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                              selectedUserId === user.id
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-muted'
                            )}
                          >
                            <User className="h-3.5 w-3.5" />
                            <span className="flex-1 truncate">{user.name || user.email}</span>
                            <span className="text-xs opacity-70">{user.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={newPermission}
                      onChange={(e) => setNewPermission(e.target.value as typeof newPermission)}
                      className="h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
                    >
                      <option value="read">只读</option>
                      <option value="write">读写</option>
                      <option value="admin">管理</option>
                    </select>
                    <Button
                      onClick={handleGrant}
                      disabled={!selectedUserId || grantMutation.isPending}
                    >
                      {grantMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <UserPlus className="h-4 w-4 mr-2" />
                      )}
                      授予权限
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
