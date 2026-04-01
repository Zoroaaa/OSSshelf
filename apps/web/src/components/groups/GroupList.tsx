/**
 * GroupList.tsx
 * 用户组列表组件
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { groupsApi } from '@/services/api';
import { Users, Plus, Settings, Trash2, UserPlus, Loader2 } from 'lucide-react';
import GroupCreateDialog from './GroupCreateDialog';
import GroupMemberDialog from './GroupMemberDialog';

import { cn } from '@/utils';

interface GroupListProps {
  className?: string;
}

const GroupList: React.FC<GroupListProps> = ({ className }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);

  const { data: groupsData, isLoading } = useQuery({
    queryKey: ['user-groups'],
    queryFn: () => groupsApi.list().then((r) => r.data.data),
  });

  const allGroups = groupsData ? [...(groupsData.owned || []), ...(groupsData.memberOf || [])] : [];

  const deleteMutation = useMutation({
    mutationFn: (groupId: string) => groupsApi.delete(groupId),
    onSuccess: () => {
      toast({ title: '用户组已删除' });
      queryClient.invalidateQueries({ queryKey: ['user-groups'] });
    },
    onError: (e: any) => {
      toast({
        title: '删除失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const handleDelete = (groupId: string, groupName: string) => {
    if (!confirm(`确定要删除用户组 "${groupName}" 吗？此操作不可撤销。所有成员将被移除。`)) return;
    deleteMutation.mutate(groupId);
  };

  const handleManageMembers = (groupId: string) => {
    setSelectedGroupId(groupId);
    setIsMemberDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">用户组</h2>
          <p className="text-sm text-muted-foreground mt-1">创建用户组以便批量授权给多个用户</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          创建组
        </Button>
      </div>

      {!allGroups || allGroups.length === 0 ? (
        <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">暂无用户组</p>
          <p className="text-sm text-muted-foreground mt-1">创建一个用户组以便批量授权</p>
          <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            创建第一个组
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {allGroups.map((group) => (
            <div key={group.id} className="bg-card rounded-lg border p-4 hover:border-primary/50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{group.name}</h3>
                    {group.isOwner && (
                      <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">所有者</span>
                    )}
                  </div>
                  {group.description && <p className="text-sm text-muted-foreground mt-1">{group.description}</p>}
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {group.memberCount} 成员
                    </span>
                    <span>创建于 {new Date(group.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleManageMembers(group.id)}>
                    <UserPlus className="h-4 w-4 mr-1" />
                    管理成员
                  </Button>
                  {group.isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(group.id, group.name)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isCreateOpen && (
        <GroupCreateDialog
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['user-groups'] });
          }}
        />
      )}

      {isMemberDialogOpen && selectedGroupId && (
        <GroupMemberDialog
          groupId={selectedGroupId}
          onClose={() => {
            setIsMemberDialogOpen(false);
            setSelectedGroupId(null);
          }}
        />
      )}
    </div>
  );
};

export default GroupList;
