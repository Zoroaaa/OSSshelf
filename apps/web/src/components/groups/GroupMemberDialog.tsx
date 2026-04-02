/**
 * GroupMemberDialog.tsx
 * 组成员管理弹窗组件
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { groupsApi, permissionsApi, type GroupMember } from '@/services/api';
import { Loader2, X, UserPlus, Trash2, User, Shield, Crown } from 'lucide-react';
import { cn } from '@/utils';

interface GroupMemberDialogProps {
  groupId: string;
  onClose: () => void;
}

const GroupMemberDialog: React.FC<GroupMemberDialogProps> = ({ groupId, onClose }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<'member' | 'admin'>('member');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; email: string; name: string | null }>>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { data: groupData } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.get(groupId).then((r) => r.data.data),
  });

  const { data: members, isLoading } = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => groupsApi.getMembers(groupId).then((r) => r.data.data),
  });

  const addMemberMutation = useMutation({
    mutationFn: (data: { userId: string; role: 'member' | 'admin' }) =>
      groupsApi.addMember(groupId, data).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '成员已添加' });
      queryClient.invalidateQueries({ queryKey: ['group-members', groupId] });
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
    mutationFn: (userId: string) => groupsApi.removeMember(groupId, userId).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '成员已移除' });
      queryClient.invalidateQueries({ queryKey: ['group-members', groupId] });
    },
    onError: (e: any) => {
      toast({
        title: '移除失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const handleSearch = async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

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
  };

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

  const isOwner = groupData?.isOwner ?? false;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-card rounded-lg shadow-lg p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold">{groupData?.name}</h2>
            <p className="text-sm text-muted-foreground">管理组成员</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

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
                <Input
                  placeholder="输入邮箱搜索..."
                  value={searchEmail}
                  onChange={(e) => {
                    setSearchEmail(e.target.value);
                    handleSearch(e.target.value);
                  }}
                />
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
                  <button
                    onClick={() => setSelectedRole('member')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border',
                      selectedRole === 'member' ? 'bg-blue-500/10 text-blue-500 border-blue-500' : 'hover:bg-muted'
                    )}
                  >
                    <User className="h-3.5 w-3.5" />
                    普通成员
                  </button>
                  <button
                    onClick={() => setSelectedRole('admin')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border',
                      selectedRole === 'admin' ? 'bg-purple-500/10 text-purple-500 border-purple-500' : 'hover:bg-muted'
                    )}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    管理员
                  </button>
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

        <div className="flex-1 overflow-y-auto p-4">
          {!members || members.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">暂无成员</div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  isOwner={isOwner}
                  groupOwnerId={groupData?.ownerId}
                  onRemove={handleRemoveMember}
                  isRemoving={removeMemberMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t flex-shrink-0">
          <Button variant="outline" className="w-full" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
};

interface MemberCardProps {
  member: GroupMember;
  isOwner: boolean;
  groupOwnerId?: string;
  onRemove: (userId: string, userName: string) => void;
  isRemoving: boolean;
}

const MemberCard: React.FC<MemberCardProps> = ({ member, isOwner, groupOwnerId, onRemove, isRemoving }) => {
  const isGroupOwner = member.userId === groupOwnerId;

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
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
          isGroupOwner
            ? 'bg-amber-500/10 text-amber-500'
            : member.role === 'admin'
              ? 'bg-purple-500/10 text-purple-500'
              : 'bg-blue-500/10 text-blue-500'
        )}
      >
        {isGroupOwner ? (
          <>
            <Crown className="h-3 w-3" />
            所有者
          </>
        ) : member.role === 'admin' ? (
          <>
            <Shield className="h-3 w-3" />
            管理员
          </>
        ) : (
          <>
            <User className="h-3 w-3" />
            成员
          </>
        )}
      </div>
      {isOwner && !isGroupOwner && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(member.userId, member.name || member.email)}
          disabled={isRemoving}
        >
          {isRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  );
};

export default GroupMemberDialog;
