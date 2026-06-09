/**
 * FilePermissionsDialog.tsx
 * 文件权限管理对话框（增强版 — 支持用户/组/团队角色）
 *
 * 功能:
 * - 查看文件权限（含来源标签）
 * - 授予/撤销用户、组、团队权限
 * - 角色模板卡片选择
 * - 批量文件权限管理
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi, groupsApi, teamsApi, type SearchableUser, type UserGroup, type Team } from '@/services/collab';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import { Shield, X, Trash2, Crown, Eye, Edit, UserPlus, Loader2, User, Users, Building2, Check } from 'lucide-react';

interface FilePermissionsDialogProps {
  fileId: string;
  fileName: string;
  isFolder: boolean;
  onClose: () => void;
  /** 批量模式：传入多个 fileId 时启用批量操作 */
  fileIds?: string[];
}

const PERMISSION_LABELS: Record<string, { label: string; icon: typeof Eye; color: string }> = {
  read: { label: '只读', icon: Eye, color: 'text-blue-500' },
  write: { label: '读写', icon: Edit, color: 'text-amber-500' },
  admin: { label: '管理', icon: Crown, color: 'text-purple-500' },
};

const DEFAULT_PERMISSION = { label: '只读', icon: Eye, color: 'text-blue-500' };

const ROLE_TEMPLATES = [
  {
    key: 'viewer' as const,
    label: '查看者',
    desc: '可查看和下载',
    icon: Eye,
    color: 'text-blue-500',
    permission: 'read' as const,
  },
  {
    key: 'editor' as const,
    label: '编辑者',
    desc: '可上传、修改、删除',
    icon: Edit,
    color: 'text-amber-500',
    permission: 'write' as const,
  },
  {
    key: 'manager' as const,
    label: '管理者',
    desc: '可管理权限并可再授权',
    icon: Crown,
    color: 'text-purple-500',
    permission: 'admin' as const,
  },
];

export function FilePermissionsDialog({ fileId, fileName, isFolder, onClose, fileIds }: FilePermissionsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── 批量模式判断 ──
  const isBatchMode = (fileIds?.length ?? 0) > 1;
  const effectiveFileIds = isBatchMode ? fileIds! : [fileId];

  // ── 用户搜索状态 ──
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchableUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // ── Tab & 角色模板状态 ──
  const [activeTab, setActiveTab] = useState<'user' | 'group' | 'team'>('user');
  const [selectedRoleTemplate, setSelectedRoleTemplate] = useState<'viewer' | 'editor' | 'manager'>('viewer');

  // ── 组/团队选择状态 ──
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  // ── 数据查询 ──
  const { data: permissionsData, isLoading } = useQuery({
    queryKey: ['permissions', fileId],
    queryFn: () => permissionsApi.getFilePermissions(fileId).then((r) => r.data.data),
    enabled: !isBatchMode,
  });

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list().then((r) => r.data.data),
  });

  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.list().then((r) => r.data.data),
  });

  // ── 用户搜索 debounce ──
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

  // ── Mutations ──
  const grantMutation = useMutation({
    mutationFn: (data: {
      userId?: string;
      groupId?: string;
      teamId?: string;
      permission: 'read' | 'write' | 'admin';
      subjectType: 'user' | 'group' | 'team';
    }): Promise<any> => {
      if (isBatchMode) {
        return permissionsApi.batchGrant({
          fileIds: effectiveFileIds,
          targetUserId: data.userId,
          targetGroupId: data.groupId,
          targetTeamId: data.teamId,
          permission: data.permission,
          subjectType: data.subjectType,
        });
      }
      // 统一使用 permissionsApi.grant（已支持 team subjectType）
      return permissionsApi.grant({
        fileId,
        userId: data.userId,
        groupId: data.groupId,
        teamId: data.teamId,
        subjectType: data.subjectType,
        permission: data.permission,
      });
    },
    onSuccess: () => {
      toast({ title: '权限已授予' });
      queryClient.invalidateQueries({ queryKey: ['permissions'] });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: (data: { perm: any; subjectType: string }): Promise<any> => {
      if (isBatchMode) {
        return permissionsApi.batchRevoke({
          fileIds: effectiveFileIds,
          targetUserId: data.perm.userId,
          targetGroupId: data.perm.groupId,
          targetTeamId: data.perm.teamId,
          subjectType: data.perm.subjectType as 'user' | 'group' | 'team',
        });
      }
      return permissionsApi.revoke({
        fileId,
        userId: data.perm.userId,
        groupId: data.perm.groupId,
        teamId: data.perm.teamId,
      });
    },
    onSuccess: () => {
      toast({ title: '权限已撤销' });
      queryClient.invalidateQueries({ queryKey: ['permissions'] });
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
    setSearchResults([]);
    setSelectedGroupId('');
    setSelectedTeamId('');
    setSelectedRoleTemplate('viewer');
  };

  const handleGrant = () => {
    const permission = ROLE_TEMPLATES.find((t) => t.key === selectedRoleTemplate)?.permission ?? 'read';

    if (activeTab === 'user') {
      if (!selectedUserId) {
        toast({ title: '请选择用户', variant: 'destructive' });
        return;
      }
      grantMutation.mutate({ userId: selectedUserId, permission, subjectType: 'user' });
    } else if (activeTab === 'group') {
      if (!selectedGroupId) {
        toast({ title: '请选择用户组', variant: 'destructive' });
        return;
      }
      grantMutation.mutate({ groupId: selectedGroupId, permission, subjectType: 'group' });
    } else if (activeTab === 'team') {
      if (!selectedTeamId) {
        toast({ title: '请选择团队', variant: 'destructive' });
        return;
      }
      grantMutation.mutate({ teamId: selectedTeamId, permission, subjectType: 'team' });
    }
  };

  // ── 权限来源标签渲染 ──
  const renderSourceLabel = (perm: any) => {
    const parts: string[] = [];
    if (perm.scope === 'inherited') parts.push('继承');
    if (perm.subjectType === 'group' && perm.groupName) parts.push(`通过组: ${perm.groupName}`);
    else if (perm.subjectType === 'team' && perm.teamName) parts.push(`通过团队: ${perm.teamName}`);
    else if (perm.subjectType === 'user') parts.push('直接授予');
    return parts.length > 0 ? (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{parts.join(' · ')}</span>
    ) : null;
  };

  const isOwner = permissionsData?.isOwner;
  const permissions = permissionsData?.permissions ?? [];

  // 合并所有组和团队列表
  const allGroups = [...(groupsData?.owned ?? []), ...(groupsData?.memberOf ?? [])];
  const allTeams = [...(teamsData?.owned ?? []), ...(teamsData?.joined ?? [])];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
        {/* ── 头部 ── */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold">
                {isBatchMode ? `批量权限管理 (${effectiveFileIds.length} 个文件)` : '权限管理'}
              </h2>
              {!isBatchMode && <p className="text-xs text-muted-foreground truncate max-w-[280px]">{fileName}</p>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* ── 内容区 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading && !isBatchMode ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {!isOwner && !isBatchMode && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-600 dark:text-amber-400">
                  您不是此{isFolder ? '文件夹' : '文件'}的所有者，无法修改权限
                </div>
              )}

              {/* ── 当前权限列表（非批量模式显示） ── */}
              {!isBatchMode && (
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
                              {(perm.userName || perm.userEmail || perm.groupName || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">
                                  {perm.userName || perm.userEmail || perm.groupName || '未知'}
                                </p>
                                {renderSourceLabel(perm)}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                {perm.userEmail || perm.groupName || ''}
                              </p>
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
                                onClick={() => revokeMutation.mutate({ perm, subjectType: perm.subjectType })}
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
              )}

              {/* ── 批量模式提示 ── */}
              {isBatchMode && (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-sm text-blue-600 dark:text-blue-400">
                  批量模式下仅可添加权限，已授权的详细列表请逐个文件查看
                </div>
              )}

              {/* ── 添加权限区 ── */}
              {(isOwner || isBatchMode) && (
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="text-sm font-medium">添加权限</h3>

                  {/* ── Tab 切换 ── */}
                  <div className="flex gap-1 p-1 bg-muted rounded-lg mb-3">
                    {(['user', 'group', 'team'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          'flex-1 px-3 py-1.5 text-sm rounded-md transition-colors',
                          activeTab === tab
                            ? 'bg-background shadow-sm font-medium'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {tab === 'user' ? (
                          <span className="flex items-center justify-center gap-1.5">
                            <User className="h-3.5 w-3.5" />
                            用户
                          </span>
                        ) : tab === 'group' ? (
                          <span className="flex items-center justify-center gap-1.5">
                            <Users className="h-3.5 w-3.5" />
                            用户组
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5" />
                            团队角色
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* ── Tab 内容：用户搜索 ── */}
                  {activeTab === 'user' && (
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
                  )}

                  {/* ── Tab 内容：组选择 ── */}
                  {activeTab === 'group' && (
                    <select
                      value={selectedGroupId}
                      onChange={(e) => setSelectedGroupId(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    >
                      <option value="">— 选择用户组 —</option>
                      {allGroups.map((g: UserGroup) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.memberCount} 人)
                        </option>
                      ))}
                    </select>
                  )}

                  {/* ── Tab 内容：团队选择 ── */}
                  {activeTab === 'team' && (
                    <select
                      value={selectedTeamId}
                      onChange={(e) => setSelectedTeamId(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    >
                      <option value="">— 选择团队 —</option>
                      {allTeams.map((t: Team) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.memberCount} 人)
                        </option>
                      ))}
                    </select>
                  )}

                  {/* ── 角色模板卡片 ── */}
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">选择角色模板</p>
                    <div className="grid grid-cols-3 gap-2">
                      {ROLE_TEMPLATES.map((template) => {
                        const Icon = template.icon;
                        const isSelected = selectedRoleTemplate === template.key;
                        return (
                          <button
                            key={template.key}
                            onClick={() => setSelectedRoleTemplate(template.key)}
                            className={cn(
                              'relative flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-left',
                              isSelected
                                ? 'border-primary bg-primary/5 shadow-sm'
                                : 'border-transparent bg-muted/50 hover:border-muted-foreground/20 hover:bg-muted'
                            )}
                          >
                            {isSelected && <Check className="absolute top-1.5 right-1.5 h-3.5 w-3.5 text-primary" />}
                            <Icon className={cn('h-5 w-5', template.color)} />
                            <span className="text-sm font-medium">{template.label}</span>
                            <span className="text-[11px] text-muted-foreground text-center leading-tight">
                              {template.desc}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── 授予权限按钮 ── */}
                  <Button
                    onClick={handleGrant}
                    disabled={
                      grantMutation.isPending ||
                      (activeTab === 'user' && !selectedUserId) ||
                      (activeTab === 'group' && !selectedGroupId) ||
                      (activeTab === 'team' && !selectedTeamId)
                    }
                    className="w-full"
                  >
                    {grantMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <UserPlus className="h-4 w-4 mr-2" />
                    )}
                    授予权限{isBatchMode ? ` (${effectiveFileIds.length} 个文件)` : ''}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
