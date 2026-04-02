/**
 * FilePermissionManager.tsx
 * 文件权限管理组件
 *
 * 功能:
 * - 查看文件权限
 * - 为用户/组授权/撤销权限
 * - 支持read/write/admin权限级别
 * - 支持设置过期时间
 * - 显示权限来源（显式/继承）
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi, groupsApi, type SearchableUser, type UserGroup } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import { Shield, Plus, X, Loader2, User, Crown, Edit, Eye, Trash2, Users, ArrowUpRight, Calendar } from 'lucide-react';

interface FilePermissionManagerProps {
  fileId: string;
  isOwner: boolean;
}

const PERMISSION_CONFIG = {
  read: { label: '只读', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  write: { label: '读写', icon: Edit, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  admin: { label: '管理', icon: Crown, color: 'text-purple-500', bg: 'bg-purple-500/10' },
};

interface PermissionItem {
  id: string;
  userId: string | null;
  groupId: string | null;
  permission: string;
  userName: string | null;
  userEmail: string;
  groupName?: string;
  subjectType: 'user' | 'group';
  expiresAt: string | null;
  scope: 'explicit' | 'inherited';
  sourceFilePath?: string;
  createdAt: string;
}

export function FilePermissionManager({ fileId, isOwner }: FilePermissionManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [subjectType, setSubjectType] = useState<'user' | 'group'>('user');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPermission, setSelectedPermission] = useState<'read' | 'write' | 'admin'>('read');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchableUser[]>([]);
  const [groupResults, setGroupResults] = useState<UserGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { data: permissionData, isLoading } = useQuery({
    queryKey: ['file-permissions', fileId],
    queryFn: () => permissionsApi.getFilePermissions(fileId).then((r) => r.data.data),
  });

  const { data: userGroups } = useQuery({
    queryKey: ['user-groups'],
    queryFn: () => groupsApi.list().then((r) => r.data.data),
  });

  useEffect(() => {
    if (!showAddForm || searchQuery.length < 2) {
      setSearchResults([]);
      setGroupResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        if (subjectType === 'user') {
          const res = await permissionsApi.searchUsers(searchQuery);
          const users = res.data.data ?? [];
          const existingUserIds = new Set(
            (permissionData?.permissions as PermissionItem[])
              ?.filter((p) => p.subjectType === 'user')
              .map((p) => p.userId) ?? []
          );
          setSearchResults(users.filter((u) => !existingUserIds.has(u.id)));
          setGroupResults([]);
        } else {
          const allGroups = userGroups ?? { owned: [], memberOf: [] };
          const allGroupsList = [...(allGroups.owned || []), ...(allGroups.memberOf || [])];
          const existingGroupIds = new Set(
            (permissionData?.permissions as PermissionItem[])
              ?.filter((p) => p.subjectType === 'group')
              .map((p) => p.groupId) ?? []
          );
          setGroupResults(
            allGroupsList.filter(
              (g) => !existingGroupIds.has(g.id) && g.name.toLowerCase().includes(searchQuery.toLowerCase())
            )
          );
          setSearchResults([]);
        }
      } catch {
        setSearchResults([]);
        setGroupResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, showAddForm, subjectType, permissionData, userGroups]);

  const grantMutation = useMutation({
    mutationFn: (data: {
      userId?: string;
      groupId?: string;
      permission: 'read' | 'write' | 'admin';
      subjectType: 'user' | 'group';
      expiresAt?: string;
    }) =>
      permissionsApi.grant({
        fileId,
        userId: data.subjectType === 'user' ? data.userId : undefined,
        groupId: data.subjectType === 'group' ? data.groupId : undefined,
        permission: data.permission,
        subjectType: data.subjectType,
        expiresAt: data.expiresAt || undefined,
      } as any),
    onSuccess: () => {
      toast({ title: '权限已授予' });
      queryClient.invalidateQueries({ queryKey: ['file-permissions', fileId] });
      setShowAddForm(false);
      resetForm();
    },
    onError: (e: any) =>
      toast({
        title: '授权失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: (data: { userId?: string; groupId?: string }) =>
      permissionsApi.revoke({ fileId, userId: data.userId, groupId: data.groupId } as any),
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

  const resetForm = () => {
    setSearchQuery('');
    setSelectedUserId(null);
    setSelectedGroupId(null);
    setSelectedPermission('read');
    setExpiresAt('');
    setSubjectType('user');
  };

  const handleGrant = () => {
    if (subjectType === 'user' && !selectedUserId) {
      toast({ title: '请选择用户', variant: 'destructive' });
      return;
    }
    if (subjectType === 'group' && !selectedGroupId) {
      toast({ title: '请选择用户组', variant: 'destructive' });
      return;
    }
    grantMutation.mutate({
      userId: selectedUserId ?? undefined,
      groupId: selectedGroupId ?? undefined,
      permission: selectedPermission,
      subjectType,
      expiresAt: expiresAt || undefined,
    });
  };

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  const permissions = (permissionData?.permissions ?? []) as PermissionItem[];

  return (
    <div className="space-y-4">
      {isOwner && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">您是此文件的所有者，拥有完整管理权限</p>
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? <X className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            {showAddForm ? '取消' : '授权'}
          </Button>
        </div>
      )}

      {showAddForm && isOwner && (
        <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">授权对象</label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSubjectType('user');
                  setSearchQuery('');
                  setSelectedGroupId(null);
                }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border',
                  subjectType === 'user' ? 'bg-primary/10 text-primary border-primary' : 'hover:bg-muted'
                )}
              >
                <User className="h-3.5 w-3.5" />
                用户
              </button>
              <button
                onClick={() => {
                  setSubjectType('group');
                  setSearchQuery('');
                  setSelectedUserId(null);
                }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border',
                  subjectType === 'group' ? 'bg-primary/10 text-primary border-primary' : 'hover:bg-muted'
                )}
              >
                <Users className="h-3.5 w-3.5" />
                用户组
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">{subjectType === 'user' ? '搜索用户' : '搜索用户组'}</label>
            <Input
              placeholder={subjectType === 'user' ? '输入邮箱搜索...' : '输入组名搜索...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {isSearching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              搜索中...
            </div>
          )}

          {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && groupResults.length === 0 && (
            <div className="text-sm text-muted-foreground py-2">
              未找到匹配的{subjectType === 'user' ? '用户' : '用户组'}
            </div>
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

          {groupResults.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-1 border rounded-lg p-1">
              {groupResults.slice(0, 5).map((group) => (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                    selectedGroupId === group.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  )}
                >
                  <Users className="h-3.5 w-3.5" />
                  <span className="flex-1 truncate">{group.name}</span>
                  <span className="text-xs opacity-70">{group.memberCount} 成员</span>
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

          <div className="space-y-1.5">
            <label className="text-xs font-medium flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              过期时间（可选）
            </label>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={handleGrant}
            disabled={
              (subjectType === 'user' && !selectedUserId) ||
              (subjectType === 'group' && !selectedGroupId) ||
              grantMutation.isPending
            }
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
            const isInherited = perm.scope === 'inherited';
            const isExpired = perm.expiresAt && new Date(perm.expiresAt) < new Date();

            return (
              <div
                key={perm.id}
                className={cn('flex items-center gap-3 p-2 rounded-lg border bg-muted/30', isExpired && 'opacity-50')}
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                    perm.subjectType === 'group' ? 'bg-purple-500/10' : 'bg-primary/10'
                  )}
                >
                  {perm.subjectType === 'group' ? (
                    <Users className="h-4 w-4 text-purple-500" />
                  ) : (
                    <User className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {perm.subjectType === 'group' ? perm.groupName : perm.userName || perm.userEmail}
                    </p>
                    {isInherited && (
                      <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                        <ArrowUpRight className="h-3 w-3" />
                        继承
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{perm.subjectType === 'group' ? '用户组' : perm.userEmail}</span>
                    {perm.expiresAt && (
                      <span className={cn(isExpired && 'text-destructive')}>
                        {isExpired ? '已过期' : `过期: ${new Date(perm.expiresAt).toLocaleDateString('zh-CN')}`}
                      </span>
                    )}
                  </div>
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
                {isOwner && !isInherited && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-500"
                    onClick={() =>
                      revokeMutation.mutate({
                        userId: perm.subjectType === 'user' ? perm.userId! : undefined,
                        groupId: perm.subjectType === 'group' ? perm.groupId! : undefined,
                      })
                    }
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
