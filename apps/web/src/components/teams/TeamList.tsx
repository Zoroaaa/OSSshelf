/**
 * TeamList.tsx
 * 团队列表主组件
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { teamsApi, type Team } from '@/services/collab';
import { Users, Plus, Trash2, UserPlus, Loader2, Settings, FolderOpen, Mountain, Clock } from 'lucide-react';
import { cn } from '@/utils';

import TeamCreateDialog from './TeamCreateDialog';
import TeamMemberDialog from './TeamMemberDialog';
import TeamResourceMountDialog from './TeamResourceMountDialog';
import TeamDetail from './TeamDetail';

interface TeamListProps {
  className?: string;
  mode?: 'default' | 'management';
}

const TeamList: React.FC<TeamListProps> = ({ className, mode = 'default' }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);
  const [isResourceDialogOpen, setIsResourceDialogOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const { data: teamsData, isLoading } = useQuery({
    queryKey: ['user-teams'],
    queryFn: () => teamsApi.list().then((r) => r.data.data),
  });

  const allTeams = teamsData ? [...(teamsData.owned || []), ...(teamsData.joined || [])] : [];

  const deleteMutation = useMutation({
    mutationFn: (teamId: string) => teamsApi.delete(teamId),
    onSuccess: () => {
      toast({ title: '团队已删除' });
      queryClient.invalidateQueries({ queryKey: ['user-teams'] });
    },
    onError: (e: any) => {
      toast({
        title: '删除失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const handleDelete = (teamId: string, teamName: string) => {
    if (!confirm(`确定要删除团队 "${teamName}" 吗？此操作不可撤销。所有成员将被移除，已挂载的资源将被卸载。`)) return;
    deleteMutation.mutate(teamId);
  };

  const handleManageMembers = (teamId: string) => {
    setSelectedTeamId(teamId);
    setIsMemberDialogOpen(true);
  };

  const handleManageResources = (teamId: string) => {
    setSelectedTeamId(teamId);
    setIsResourceDialogOpen(true);
  };

  const handleOpenDetail = (teamId: string) => {
    setSelectedTeamId(teamId);
    setIsDetailOpen(true);
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
          <h2 className="text-xl font-semibold">{mode === 'management' ? '团队管理' : '我的团队'}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === 'management' ? '管理所有团队的协作资源与成员' : '创建或加入团队以协作管理资源'}
          </p>
        </div>
        {mode === 'management' ? (
          <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            创建团队
          </Button>
        ) : (
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            创建团队
          </Button>
        )}
      </div>

      {!allTeams || allTeams.length === 0 ? (
        <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed">
          <Mountain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">暂无团队</p>
          <p className="text-sm text-muted-foreground mt-1">创建一个团队以便协作管理资源和成员</p>
          <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            创建第一个团队
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {allTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              mode={mode}
              onManageMembers={handleManageMembers}
              onManageResources={handleManageResources}
              onDelete={handleDelete}
              isDeleting={deleteMutation.isPending}
              onNavigateWorkspace={(teamId) => navigate(`/teams/${teamId}/workspace`)}
              onNavigateSettings={handleOpenDetail}
            />
          ))}
        </div>
      )}

      {isCreateOpen && (
        <TeamCreateDialog
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['user-teams'] });
          }}
        />
      )}

      {isMemberDialogOpen && selectedTeamId && (
        <TeamMemberDialog
          teamId={selectedTeamId}
          teamName={allTeams.find((t) => t.id === selectedTeamId)?.name ?? ''}
          onClose={() => {
            setIsMemberDialogOpen(false);
            setSelectedTeamId(null);
          }}
        />
      )}

      {isResourceDialogOpen && selectedTeamId && (
        <TeamResourceMountDialog
          teamId={selectedTeamId}
          teamName={allTeams.find((t) => t.id === selectedTeamId)?.name ?? ''}
          onClose={() => {
            setIsResourceDialogOpen(false);
            setSelectedTeamId(null);
          }}
        />
      )}

      {isDetailOpen && selectedTeamId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-5 flex-1 overflow-y-auto">
              <TeamDetail
                teamId={selectedTeamId}
                onClose={() => {
                  setIsDetailOpen(false);
                  setSelectedTeamId(null);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface TeamCardProps {
  team: Team;
  mode?: 'default' | 'management';
  onManageMembers: (teamId: string) => void;
  onManageResources: (teamId: string) => void;
  onDelete: (teamId: string, teamName: string) => void;
  isDeleting: boolean;
  onNavigateWorkspace: (teamId: string) => void;
  onNavigateSettings?: (teamId: string) => void;
}

const TeamCard: React.FC<TeamCardProps> = ({
  team,
  mode = 'default',
  onManageMembers,
  onManageResources,
  onDelete,
  isDeleting,
  onNavigateWorkspace,
  onNavigateSettings,
}) => {
  const isManagement = mode === 'management';

  return (
    <div
      className={cn('bg-card rounded-lg border p-4 hover:border-primary/50 transition-colors', isManagement && 'p-3')}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={cn('font-medium', isManagement && 'text-sm')}>{team.name}</h3>
            {team.isOwner ? (
              <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">所有者</span>
            ) : (
              isManagement && <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">成员</span>
            )}
          </div>
          {!isManagement && team.description && (
            <p className="text-sm text-muted-foreground mt-1">{team.description}</p>
          )}
          <div
            className={cn(
              'flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap',
              isManagement && 'gap-3'
            )}
          >
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {team.memberCount} 成员
            </span>
            {isManagement ? (
              <span className="flex items-center gap-1">
                <Settings className="h-3 w-3" />
                {team.userRole || '成员'}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                创建于 {new Date(team.createdAt).toLocaleDateString('zh-CN')}
              </span>
            )}
          </div>
        </div>
        <div className={cn('flex items-center gap-2 shrink-0', isManagement && 'gap-1')}>
          {isManagement ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => onNavigateWorkspace(team.id)} title="进入工作区">
                <FolderOpen className="h-4 w-4 mr-1" />
                工作区
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onManageMembers(team.id)} title="管理团队">
                <Settings className="h-4 w-4 mr-1" />
                管理
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => onManageMembers(team.id)} title="管理成员">
                <UserPlus className="h-4 w-4 mr-1" />
                成员
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onNavigateWorkspace(team.id)} title="工作区">
                <FolderOpen className="h-4 w-4 mr-1" />
                工作区
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onManageResources(team.id)} title="管理资源">
                <FolderOpen className="h-4 w-4 mr-1" />
                资源
              </Button>
              {team.isOwner && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    title="设置"
                    onClick={() => onNavigateSettings?.(team.id)}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-destructive hover:text-destructive"
                    onClick={() => onDelete(team.id, team.name)}
                    disabled={isDeleting}
                    title="删除团队"
                  >
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamList;
