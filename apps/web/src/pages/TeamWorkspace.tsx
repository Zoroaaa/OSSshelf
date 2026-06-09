/**
 * TeamWorkspace.tsx — 团队工作区页面容器
 * 路由: /teams/:teamId/workspace
 */

import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { teamsApi } from '@/services/collab';
import { Loader2 } from 'lucide-react';
import TeamWorkspace from '@/components/teams/TeamWorkspace';

const TeamWorkspacePage: React.FC = () => {
  const { teamId } = useParams<{ teamId: string }>();

  const { data: teamData, isLoading } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId!).then((r) => r.data.data),
    enabled: !!teamId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!teamData) return <Navigate to="/teams" replace />;

  return (
    <TeamWorkspace teamId={teamId!} teamName={teamData.name} userRole={teamData.userRole} isOwner={teamData.isOwner} />
  );
};

export default TeamWorkspacePage;
