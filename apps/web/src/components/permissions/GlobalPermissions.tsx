/**
 * GlobalPermissions.tsx
 * 全局授权管理组件
 *
 * 功能:
 * - 显示所有授权信息
 * - 支持对用户组/用户进行文件夹/文件的授权
 * - 支持多文件夹/多文件授权
 * - 授权完可以编辑、删除
 * - 可以看到每个用户组/用户的授权范围
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi, groupsApi, searchApi, type SearchableUser, type UserGroup } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import {
  Plus,
  X,
  Loader2,
  User,
  Users,
  Shield,
  Eye,
  Edit,
  Crown,
  Trash2,
  Folder,
  FileText,
  Search,
  Calendar,
  ArrowUpRight,
} from 'lucide-react';

interface PermissionRecord {
  id: string;
  subjectType: 'user' | 'group';
  subjectId: string | null;
  subjectName: string;
  fileId: string;
  fileName: string;
  filePath: string;
  isFolder: boolean;
  permission: 'read' | 'write' | 'admin';
  expiresAt: string | null;
  createdAt: string;
}

const PERMISSION_CONFIG = {
  read: { label: '只读', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  write: { label: '读写', icon: Edit, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  admin: { label: '管理', icon: Crown, color: 'text-purple-500', bg: 'bg-purple-500/10' },
};

const GlobalPermissions: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [searchFileQuery, setSearchFileQuery] = useState('');
  const [selectedSubjectType, setSelectedSubjectType] = useState<'user' | 'group'>('user');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedPermission, setSelectedPermission] = useState<'read' | 'write' | 'admin'>('read');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [userSearchResults, setUserSearchResults] = useState<SearchableUser[]>([]);
  const [fileSearchResults, setFileSearchResults] = useState<any[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [isSearchingFiles, setIsSearchingFiles] = useState(false);
  const [filterSubject, setFilterSubject] = useState<'all' | 'user' | 'group'>('all');
  const [filterPermission, setFilterPermission] = useState<'all' | 'read' | 'write' | 'admin'>('all');

  const { data: permissionsData, isLoading } = useQuery({
    queryKey: ['global-permissions'],
    queryFn: () => permissionsApi.getAllPermissions().then((r) => r.data.data),
  });

  const { data: groupsData } = useQuery({
    queryKey: ['user-groups'],
    queryFn: () => groupsApi.list().then((r) => r.data.data),
  });

  useEffect(() => {
    if (!searchUserQuery || searchUserQuery.length < 2) {
      setUserSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingUsers(true);
      try {
        const res = await permissionsApi.searchUsers(searchUserQuery);
        setUserSearchResults(res.data.data ?? []);
      } catch {
        setUserSearchResults([]);
      } finally {
        setIsSearchingUsers(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchUserQuery]);

  useEffect(() => {
    if (!searchFileQuery || searchFileQuery.length < 2) {
      setFileSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingFiles(true);
      try {
        const res = await searchApi.query({ query: searchFileQuery, limit: 10 });
        setFileSearchResults(res.data.data?.items ?? []);
      } catch {
        setFileSearchResults([]);
      } finally {
        setIsSearchingFiles(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchFileQuery]);

  const grantMutation = useMutation({
    mutationFn: async () => {
      const grants = selectedFileIds.map((fileId) =>
        permissionsApi.grant({
          fileId,
          userId: selectedSubjectType === 'user' ? selectedUserId! : undefined,
          groupId: selectedSubjectType === 'group' ? selectedGroupId! : undefined,
          permission: selectedPermission,
          subjectType: selectedSubjectType,
          expiresAt: expiresAt || undefined,
        } as any)
      );
      return Promise.all(grants);
    },
    onSuccess: () => {
      toast({ title: '授权成功' });
      queryClient.invalidateQueries({ queryKey: ['global-permissions'] });
      resetForm();
    },
    onError: (e: any) => {
      toast({
        title: '授权失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (data: { permissionId: string }) => permissionsApi.revokeById(data.permissionId),
    onSuccess: () => {
      toast({ title: '权限已撤销' });
      queryClient.invalidateQueries({ queryKey: ['global-permissions'] });
    },
    onError: (e: any) => {
      toast({
        title: '撤销失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { permissionId: string; permission: 'read' | 'write' | 'admin'; expiresAt?: string }) =>
      permissionsApi.updatePermission(data.permissionId, data.permission, data.expiresAt),
    onSuccess: () => {
      toast({ title: '权限已更新' });
      queryClient.invalidateQueries({ queryKey: ['global-permissions'] });
    },
    onError: (e: any) => {
      toast({
        title: '更新失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setShowGrantForm(false);
    setSearchUserQuery('');
    setSearchFileQuery('');
    setSelectedUserId(null);
    setSelectedGroupId(null);
    setSelectedFileIds([]);
    setSelectedPermission('read');
    setExpiresAt('');
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds((prev) => (prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]));
  };

  const handleGrant = () => {
    if (selectedSubjectType === 'user' && !selectedUserId) {
      toast({ title: '请选择用户', variant: 'destructive' });
      return;
    }
    if (selectedSubjectType === 'group' && !selectedGroupId) {
      toast({ title: '请选择用户组', variant: 'destructive' });
      return;
    }
    if (selectedFileIds.length === 0) {
      toast({ title: '请选择至少一个文件或文件夹', variant: 'destructive' });
      return;
    }
    grantMutation.mutate();
  };

  const allGroups = groupsData ? [...(groupsData.owned || []), ...(groupsData.memberOf || [])] : [];

  const permissions = (permissionsData?.permissions ?? []) as PermissionRecord[];

  const filteredPermissions = permissions.filter((p) => {
    if (filterSubject !== 'all' && p.subjectType !== filterSubject) return false;
    if (filterPermission !== 'all' && p.permission !== filterPermission) return false;
    return true;
  });

  const groupedBySubject = filteredPermissions.reduce(
    (acc, p) => {
      const key = `${p.subjectType}-${p.subjectId}`;
      if (!acc[key]) {
        acc[key] = {
          subjectType: p.subjectType,
          subjectId: p.subjectId,
          subjectName: p.subjectName,
          permissions: [],
        };
      }
      acc[key].permissions.push(p);
      return acc;
    },
    {} as Record<
      string,
      { subjectType: string; subjectId: string | null; subjectName: string; permissions: PermissionRecord[] }
    >
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">授权管理</h2>
          <p className="text-sm text-muted-foreground mt-1">查看和管理所有文件/文件夹的授权信息</p>
        </div>
        <Button onClick={() => setShowGrantForm(!showGrantForm)}>
          {showGrantForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          {showGrantForm ? '取消' : '新增授权'}
        </Button>
      </div>

      {showGrantForm && (
        <div className="p-4 rounded-lg border bg-muted/30 space-y-4">
          <h3 className="font-medium">新增授权</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">授权对象</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedSubjectType('user');
                      setSelectedGroupId(null);
                    }}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border',
                      selectedSubjectType === 'user' ? 'bg-primary/10 text-primary border-primary' : 'hover:bg-muted'
                    )}
                  >
                    <User className="h-3.5 w-3.5" />
                    用户
                  </button>
                  <button
                    onClick={() => {
                      setSelectedSubjectType('group');
                      setSelectedUserId(null);
                    }}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border',
                      selectedSubjectType === 'group' ? 'bg-primary/10 text-primary border-primary' : 'hover:bg-muted'
                    )}
                  >
                    <Users className="h-3.5 w-3.5" />
                    用户组
                  </button>
                </div>
              </div>

              {selectedSubjectType === 'user' ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">搜索用户</label>
                  <Input
                    placeholder="输入邮箱搜索..."
                    value={searchUserQuery}
                    onChange={(e) => setSearchUserQuery(e.target.value)}
                  />
                  {isSearchingUsers && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      搜索中...
                    </div>
                  )}
                  {userSearchResults.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 border rounded-lg p-1">
                      {userSearchResults.slice(0, 5).map((user) => (
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
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">选择用户组</label>
                  <div className="max-h-40 overflow-y-auto space-y-1 border rounded-lg p-1">
                    {allGroups.map((group) => (
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
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">搜索文件/文件夹</label>
                <Input
                  placeholder="输入名称搜索..."
                  value={searchFileQuery}
                  onChange={(e) => setSearchFileQuery(e.target.value)}
                />
                {isSearchingFiles && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    搜索中...
                  </div>
                )}
                {fileSearchResults.length > 0 && (
                  <div className="max-h-32 overflow-y-auto space-y-1 border rounded-lg p-1">
                    {fileSearchResults.slice(0, 10).map((file) => (
                      <button
                        key={file.id}
                        onClick={() => toggleFileSelection(file.id)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                          selectedFileIds.includes(file.id) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                        )}
                      >
                        {file.isFolder ? <Folder className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                        <span className="flex-1 truncate">{file.name}</span>
                        {selectedFileIds.includes(file.id) && <span className="text-xs">已选</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedFileIds.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">已选择 {selectedFileIds.length} 项</label>
                  <div className="flex flex-wrap gap-1">
                    {selectedFileIds.slice(0, 5).map((id) => (
                      <span key={id} className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">
                        {id.slice(0, 8)}...
                      </span>
                    ))}
                    {selectedFileIds.length > 5 && (
                      <span className="px-2 py-0.5 text-xs bg-muted rounded">+{selectedFileIds.length - 5} 更多</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">权限级别</label>
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
              <label className="text-sm font-medium flex items-center gap-1">
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
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetForm}>
              取消
            </Button>
            <Button
              onClick={handleGrant}
              disabled={
                (selectedSubjectType === 'user' && !selectedUserId) ||
                (selectedSubjectType === 'group' && !selectedGroupId) ||
                selectedFileIds.length === 0 ||
                grantMutation.isPending
              }
            >
              {grantMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Shield className="h-4 w-4 mr-1" />
              )}
              授权 ({selectedFileIds.length} 项)
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">筛选:</span>
          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value as any)}
            className="px-2 py-1 text-sm border rounded-md bg-background"
          >
            <option value="all">全部对象</option>
            <option value="user">用户</option>
            <option value="group">用户组</option>
          </select>
          <select
            value={filterPermission}
            onChange={(e) => setFilterPermission(e.target.value as any)}
            className="px-2 py-1 text-sm border rounded-md bg-background"
          >
            <option value="all">全部权限</option>
            <option value="read">只读</option>
            <option value="write">读写</option>
            <option value="admin">管理</option>
          </select>
        </div>
        <span className="text-sm text-muted-foreground">共 {filteredPermissions.length} 条授权记录</span>
      </div>

      {Object.keys(groupedBySubject).length === 0 ? (
        <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">暂无授权记录</p>
          <p className="text-sm text-muted-foreground mt-1">点击"新增授权"开始授权</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.values(groupedBySubject).map((group) => (
            <div key={`${group.subjectType}-${group.subjectId}`} className="border rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 p-3 bg-muted/50 border-b">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center',
                    group.subjectType === 'group' ? 'bg-purple-500/10' : 'bg-primary/10'
                  )}
                >
                  {group.subjectType === 'group' ? (
                    <Users className="h-4 w-4 text-purple-500" />
                  ) : (
                    <User className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{group.subjectName}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.subjectType === 'group' ? '用户组' : '用户'} · {group.permissions.length} 条授权
                  </p>
                </div>
              </div>
              <div className="divide-y">
                {group.permissions.map((perm) => {
                  const config = PERMISSION_CONFIG[perm.permission as keyof typeof PERMISSION_CONFIG];
                  const Icon = config.icon;
                  const isExpired = perm.expiresAt && new Date(perm.expiresAt) < new Date();

                  return (
                    <div
                      key={perm.id}
                      className={cn(
                        'flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors',
                        isExpired && 'opacity-50'
                      )}
                    >
                      <div className="w-8 h-8 rounded flex items-center justify-center bg-muted">
                        {perm.isFolder ? (
                          <Folder className="h-4 w-4 text-amber-500" />
                        ) : (
                          <FileText className="h-4 w-4 text-blue-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{perm.fileName}</p>
                          {perm.filePath && perm.filePath !== '/' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                              <ArrowUpRight className="h-3 w-3" />
                              {perm.filePath}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>授权于 {new Date(perm.createdAt).toLocaleDateString('zh-CN')}</span>
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
                      <div className="flex items-center gap-1">
                        <select
                          value={perm.permission}
                          onChange={(e) =>
                            updateMutation.mutate({
                              permissionId: perm.id,
                              permission: e.target.value as any,
                            })
                          }
                          className="px-2 py-1 text-xs border rounded bg-background"
                          disabled={updateMutation.isPending}
                        >
                          <option value="read">只读</option>
                          <option value="write">读写</option>
                          <option value="admin">管理</option>
                        </select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (confirm('确定要撤销此权限吗？')) {
                              revokeMutation.mutate({ permissionId: perm.id });
                            }
                          }}
                          disabled={revokeMutation.isPending}
                        >
                          {revokeMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GlobalPermissions;
