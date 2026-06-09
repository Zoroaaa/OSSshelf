/**
 * Teams.tsx — 团队中心 V3（工作区优先）
 *
 * 打开即工作区，支持多团队切换
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { teamsApi } from '@/services/collab';
import TeamWorkspace from '@/components/teams/TeamWorkspace';
import TeamInviteDialog from '@/components/teams/TeamInviteDialog';
import TeamCreateDialog from '@/components/teams/TeamCreateDialog';
import TeamMemberDialog from '@/components/teams/TeamMemberDialog';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Users, Plus, ChevronDown, UserPlus, Settings } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';

const Teams: React.FC = () => {
  const queryClient = useQueryClient();
  // 所有团队列表（用于切换器）
  const { data: teamsData, isLoading } = useQuery({
    queryKey: ['user-teams'],
    queryFn: () => teamsApi.list().then((r) => r.data.data),
  });

  const allTeams = teamsData ? [...(teamsData.owned || []), ...(teamsData.joined || [])] : [];

  // 当前选中的团队 ID（默认第一个）
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isMemberOpen, setIsMemberOpen] = useState(false);

  // 当团队列表加载完成后，自动选中第一个
  const currentTeam = activeTeamId ? allTeams.find((t) => t.id === activeTeamId) : (allTeams[0] ?? null);

  React.useEffect(() => {
    if (!activeTeamId && allTeams.length > 0) {
      setActiveTeamId(allTeams[0]!.id);
    }
  }, [allTeams, activeTeamId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentTeam && !isCreateOpen) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-medium">暂无团队</h2>
        <p className="text-sm text-muted-foreground mt-1">创建一个团队以开始协作</p>
        <Button size="sm" className="mt-4" onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> 创建团队
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* ── 工作区顶栏：团队切换 + 操作 ── */}
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-3">
          {/* 团队切换器 */}
          {allTeams.length > 1 ? (
            <div className="relative group">
              <button
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border hover:border-primary/50 transition-colors bg-card'
                )}
              >
                <span className="font-semibold">{currentTeam?.name}</span>
                {currentTeam?.isOwner && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary rounded">所有者</span>
                )}
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
              {/* 下拉菜单：其他团队列表 */}
              <div className="absolute top-full left-0 mt-1 w-64 rounded-lg border bg-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1 max-h-[320px] overflow-y-auto">
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">切换团队</div>
                {allTeams.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => setActiveTeamId(team.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors',
                      team.id === currentTeam?.id && 'bg-primary/5 text-primary font-medium'
                    )}
                  >
                    <span className="truncate flex-1">{team.name}</span>
                    {team.isOwner ? (
                      <span className="text-[10px] text-muted-foreground">所有者</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">{team.userRole}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{currentTeam?.name}</h1>
              {currentTeam?.isOwner && (
                <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">所有者</span>
              )}
            </div>
          )}

          <span className="text-xs text-muted-foreground">{currentTeam?.memberCount} 成员</span>
        </div>

        {/* 操作按钮组 */}
        <div className="flex items-center gap-2">
          {(currentTeam?.userRole === 'admin' || currentTeam?.userRole === 'owner' || currentTeam?.isOwner) && (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsInviteOpen(true)}>
                <UserPlus className="h-4 w-4 mr-1" /> 邀请成员
              </Button>
              <Button variant="outline" size="sm" onClick={() => setIsMemberOpen(true)}>
                <Settings className="h-4 w-4 mr-1" /> 成员管理
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> 新建团队
          </Button>
        </div>
      </div>

      {/* ── 工作区主体 ── */}
      {currentTeam && (
        <TeamWorkspace
          teamId={currentTeam.id}
          teamName={currentTeam.name}
          userRole={currentTeam.userRole}
          isOwner={currentTeam.isOwner}
        />
      )}

      {/* ── 邀请对话框 ── */}
      {isInviteOpen && currentTeam && (
        <TeamInviteDialog teamId={currentTeam.id} teamName={currentTeam.name} onClose={() => setIsInviteOpen(false)} />
      )}

      {/* ── 创建团队对话框 ── */}
      {isCreateOpen && (
        <TeamCreateDialog
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['user-teams'] });
          }}
        />
      )}

      {/* ── 成员管理对话框 ── */}
      {isMemberOpen && currentTeam && (
        <TeamMemberDialog teamId={currentTeam.id} teamName={currentTeam.name} onClose={() => setIsMemberOpen(false)} />
      )}
    </div>
  );
};

export default Teams;
