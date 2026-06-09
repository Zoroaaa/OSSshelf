/**
 * TeamMemberDialog.tsx
 * 管理团队成员对话框
 */

import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { teamsApi, permissionsApi, type TeamMember } from '@/services/collab';
import { Loader2, X, UserPlus, Trash2, User, Shield, Crown, Pencil, EyeOff, Search } from 'lucide-react';
import { cn } from '@/utils';

interface TeamMemberDialogProps {
  teamId: string;
  teamName: string;
  onClose: () => void;
}

const roleColorMap: Record<string, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
  owner: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-500',
    label: '所有者',
    icon: <Crown className="h-3 w-3" />,
  },
  admin: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-500',
    label: '管理员',
    icon: <Shield className="h-3 w-3" />,
  },
  member: {
    bg: 'bg-gray-500/10',
    text: 'text-gray-500',
    label: '成员',
    icon: <User className="h-3 w-3" />,
  },
  guest: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    label: '访客',
    icon: <EyeOff className="h-3 w-3" />,
  },
};

type MemberRole = 'owner' | 'admin' | 'member' | 'guest';

const TeamMemberDialog: React.FC<TeamMemberDialogProps> = ({ teamId, teamName, onClose }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<MemberRole>('member');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; email: string; name: string | null }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: teamData } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId).then((r) => r.data.data),
  });

  const { data: members, isLoading } = useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => teamsApi.getMembers(teamId).then((r) => r.data.data),
  });

  const addMemberMutation = useMutation({
    mutationFn: (data: { userId: string; role?: MemberRole }) => teamsApi.addMember(teamId, data).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '成员已添加' });
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
      setShowAddForm(false);
      setSearchEmail('');
      setSelectedUserId(null);
    },
    onError: (e: any) => {
      toast({
        title: '添加失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => teamsApi.removeMember(teamId, userId).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '成员已移除' });
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
    },
    onError: (e: any) => {
      toast({
        title: '移除失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
      teamsApi.updateMemberRole(teamId, userId, role).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '角色已更新' });
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
    },
    onError: (e: any) => {
      toast({
        title: '更新失败',
        description: e.response?.data?.error?.message || '权限不足或网络错误',
        variant: 'destructive',
      });
    },
  });

  const handleSearch = async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    // 清除之前的定时器
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    // 防抖 300ms
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await permissionsApi.searchUsers(query);
        const users = res.data.data ?? [];
        const existingUserIds = new Set(members?.map((m) => m.userId) ?? []);
        setSearchResults(users.filter((u) => !existingUserIds.has(u.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  // 组件卸载时清除定时器
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const handleAddMember = () => {
    if (!selectedUserId) {
      toast({ title: '请选择用户', variant: 'destructive' });
      return;
    }
    addMemberMutation.mutate({ userId: selectedUserId, role: selectedRole });
  };

  const handleRemoveMember = (userId: string, userName: string) => {
    if (!confirm(`确定要移除成员 "${userName}" 吗？`)) return;
    removeMemberMutation.mutate(userId);
  };

  const isOwner = teamData?.isOwner ?? false;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-card rounded-lg shadow-lg p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const roleOptions: { value: MemberRole; label: string; icon: React.ReactNode }[] = [
    { value: 'member', label: '普通成员', icon: <User className="h-3.5 w-3.5" /> },
    { value: 'admin', label: '管理员', icon: <Shield className="h-3.5 w-3.5" /> },
    { value: 'guest', label: '访客', icon: <EyeOff className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold">{teamName}</h2>
            <p className="text-sm text-muted-foreground">管理团队成员</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 添加成员区域 */}
        <div className="p-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">成员列表</span>
            {isOwner && (
              <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                {showAddForm ? <X className="h-4 w-4 mr-1" /> : <UserPlus className="h-4 w-4 mr-1" />}
                {showAddForm ? '取消' : '添加成员'}
              </Button>
            )}
          </div>

          {showAddForm && (
            <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">搜索用户</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="输入邮箱搜索..."
                    value={searchEmail}
                    onChange={(e) => {
                      setSearchEmail(e.target.value);
                      handleSearch(e.target.value);
                    }}
                    className="pl-8"
                  />
                </div>
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
                <label className="text-xs font-medium">角色</label>
                <div className="flex gap-2">
                  {roleOptions.map((opt) => {
                    const colors = roleColorMap[opt.value as keyof typeof roleColorMap] ?? roleColorMap.member!;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setSelectedRole(opt.value)}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border',
                          selectedRole === opt.value ? `${colors.bg} ${colors.text} border-current` : 'hover:bg-muted'
                        )}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                size="sm"
                className="w-full"
                onClick={handleAddMember}
                disabled={!selectedUserId || addMemberMutation.isPending}
              >
                {addMemberMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                )}
                添加成员
              </Button>
            </div>
          )}
        </div>

        {/* 成员列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {!members || members.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">暂无成员</div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <TeamMemberCard
                  key={member.id}
                  member={member}
                  isOwner={isOwner}
                  teamOwnerId={teamData?.ownerId}
                  onRemove={handleRemoveMember}
                  onRoleChange={(userId, role) => updateRoleMutation.mutate({ userId, role })}
                  isRemoving={removeMemberMutation.isPending}
                  isUpdatingRole={updateRoleMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="p-4 border-t flex-shrink-0">
          <Button variant="outline" className="w-full" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
};

// ── 成员卡片 ──

interface TeamMemberCardProps {
  member: TeamMember;
  isOwner: boolean;
  teamOwnerId?: string;
  onRemove: (userId: string, userName: string) => void;
  onRoleChange?: (userId: string, role: MemberRole) => void;
  isRemoving: boolean;
  isUpdatingRole?: boolean;
}

const TeamMemberCard: React.FC<TeamMemberCardProps> = ({
  member,
  isOwner,
  teamOwnerId,
  onRemove,
  onRoleChange,
  isRemoving,
  isUpdatingRole,
}) => {
  const [isEditingRole, setIsEditingRole] = useState(false);
  const isTeamOwner = member.userId === teamOwnerId;
  const canEditRole = isOwner && !isTeamOwner && !!onRoleChange;

  const currentRole = (member.role as MemberRole) || 'member';
  const roleStyle = roleColorMap[currentRole as keyof typeof roleColorMap] ?? roleColorMap.member!;

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg border bg-muted/30">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <User className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{member.name || member.email}</p>
        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
      </div>
      <div
        className={cn('flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium', roleStyle.bg, roleStyle.text)}
      >
        {isEditingRole && canEditRole ? (
          <select
            value={currentRole}
            onChange={(e) => {
              const newRole = e.target.value as MemberRole;
              onRoleChange?.(member.userId, newRole);
              setIsEditingRole(false);
            }}
            onBlur={() => setIsEditingRole(false)}
            autoFocus
            className="bg-transparent border-none outline-none cursor-pointer font-medium"
          >
            <option value="admin">管理员</option>
            <option value="member">成员</option>
            <option value="guest">访客</option>
          </select>
        ) : (
          <>
            {roleStyle.icon}
            {roleStyle.label}
          </>
        )}
      </div>
      {canEditRole && !isEditingRole && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={() => setIsEditingRole(true)}
          title="更改角色"
          disabled={isUpdatingRole}
        >
          {isUpdatingRole ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
        </Button>
      )}
      {isOwner && !isTeamOwner && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(member.userId, member.name || member.email)}
          disabled={isRemoving}
          title="移除成员"
        >
          {isRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  );
};

export default TeamMemberDialog;
