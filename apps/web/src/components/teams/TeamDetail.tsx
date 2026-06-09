/**
 * TeamDetail.tsx
 * 团队详情面板
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { teamsApi, type TeamMember, type TeamResource } from '@/services/collab';
import TeamActivityFeed from './TeamActivityFeed';
import TeamInviteRecords from './TeamInviteRecords';
import {
  Users,
  FolderOpen,
  Loader2,
  X,
  Shield,
  Settings,
  Trash2,
  Pencil,
  Crown,
  User,
  EyeOff,
  Clock,
  Mail,
} from 'lucide-react';
import { cn, formatBytes } from '@/utils';

interface TeamDetailProps {
  teamId: string;
  onClose?: () => void;
}

type TabType = 'members' | 'invites' | 'resources' | 'activity' | 'settings';

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

const TeamDetail: React.FC<TeamDetailProps> = ({ teamId, onClose }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('members');
  const [showInviteRecords, setShowInviteRecords] = useState(false);

  const { data: teamData, isLoading: isTeamLoading } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId).then((r) => r.data.data),
  });

  const { data: members, isLoading: isMembersLoading } = useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => teamsApi.getMembers(teamId).then((r) => r.data.data),
    enabled: activeTab === 'members',
  });

  const { data: resources, isLoading: isResourcesLoading } = useQuery({
    queryKey: ['team-resources', teamId],
    queryFn: () => teamsApi.listResources(teamId).then((r) => r.data.data),
    enabled: activeTab === 'resources',
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string; storageQuota?: number; defaultMemberRole?: string }) =>
      teamsApi.update(teamId, data).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '团队信息已更新' });
      queryClient.invalidateQueries({ queryKey: ['team', teamId] });
      queryClient.invalidateQueries({ queryKey: ['user-teams'] });
    },
    onError: (e: any) => {
      toast({
        title: '更新失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => teamsApi.delete(teamId).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '团队已删除' });
      queryClient.invalidateQueries({ queryKey: ['user-teams'] });
      onClose?.();
    },
    onError: (e: any) => {
      toast({
        title: '删除失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const unmountMutation = useMutation({
    mutationFn: (fileId: string) => teamsApi.unmountResource(teamId, fileId).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '资源已卸载' });
      queryClient.invalidateQueries({ queryKey: ['team-resources', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team-workspace-all', teamId] });
    },
    onError: () => {
      toast({ title: '卸载失败', variant: 'destructive' });
    },
  });

  const isOwner = teamData?.isOwner ?? false;

  if (isTeamLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'members', label: '成员', icon: <Users className="h-4 w-4" /> },
    { key: 'invites', label: '邀请记录', icon: <Mail className="h-4 w-4" /> },
    { key: 'resources', label: '资源', icon: <FolderOpen className="h-4 w-4" /> },
    { key: 'activity', label: '动态', icon: <Clock className="h-4 w-4" /> },
  ];

  if (isOwner) {
    tabs.push({ key: 'settings', label: '设置', icon: <Settings className="h-4 w-4" /> });
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {onClose && (
              <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            )}
            <h2 className="text-xl font-semibold">{teamData?.name}</h2>
            {teamData?.isOwner && (
              <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">所有者</span>
            )}
          </div>
          {teamData?.description && <p className="text-sm text-muted-foreground mt-1">{teamData.description}</p>}
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {teamData?.memberCount ?? 0} 成员
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              创建于 {teamData?.createdAt ? new Date(teamData.createdAt).toLocaleDateString('zh-CN') : '-'}
            </span>
          </div>
          <Button size="sm" variant="default" onClick={() => navigate(`/teams/${teamId}/workspace`)} className="mt-2">
            <FolderOpen className="h-4 w-4 mr-1" /> 进入工作区
          </Button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {activeTab === 'members' && (
        <MembersSection members={members} isLoading={isMembersLoading} teamId={teamId} isOwner={isOwner} />
      )}

      {activeTab === 'invites' && (
        <div className="rounded-lg border bg-muted/30 p-4 text-center">
          <p className="text-sm text-muted-foreground mb-3">查看和管理团队邀请记录</p>
          <Button
            size="sm"
            onClick={() => {
              // 使用状态或直接渲染 TeamInviteRecords 组件
              setShowInviteRecords(true);
            }}
          >
            <Mail className="h-4 w-4 mr-1" /> 打开邀请记录面板
          </Button>
        </div>
      )}

      {showInviteRecords && (
        <TeamInviteRecords
          teamId={teamId}
          teamName={teamData?.name || ''}
          userRole={teamData?.userRole || ''}
          onClose={() => setShowInviteRecords(false)}
        />
      )}

      {activeTab === 'resources' && (
        <ResourcesSection
          resources={resources}
          isLoading={isResourcesLoading}
          teamId={teamId}
          isOwner={isOwner}
          onUnmount={(id) => unmountMutation.mutate(id)}
        />
      )}

      {activeTab === 'activity' && <TeamActivityFeed teamId={teamId} />}

      {activeTab === 'settings' && isOwner && (
        <SettingsSection
          teamData={teamData!}
          onUpdate={(data) => updateMutation.mutate(data)}
          onDelete={() => {
            if (!confirm(`确定要删除团队 "${teamData?.name}" 吗？此操作不可撤销。`)) return;
            deleteMutation.mutate();
          }}
          isUpdating={updateMutation.isPending}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
};

// ── 成员列表 Section ──

interface MembersSectionProps {
  members?: TeamMember[];
  isLoading: boolean;
  teamId: string;
  isOwner: boolean;
}

const MembersSection: React.FC<MembersSectionProps> = ({ members, isLoading, teamId: _teamId, isOwner: _isOwner }) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!members || members.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
        暂无成员
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {members.map((member) => {
        const roleStyle = roleColorMap[member.role as keyof typeof roleColorMap] ?? roleColorMap.member!;
        return (
          <div key={member.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{member.name || member.email}</p>
              <p className="text-xs text-muted-foreground truncate">{member.email}</p>
            </div>
            <span
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
                roleStyle.bg,
                roleStyle.text
              )}
            >
              {roleStyle.icon}
              {roleStyle.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ── 资源列表 Section ──

interface ResourcesSectionProps {
  resources?: TeamResource[];
  isLoading: boolean;
  teamId: string;
  isOwner: boolean;
  onUnmount?: (resourceId: string) => void;
}

const ResourcesSection: React.FC<ResourcesSectionProps> = ({
  resources,
  isLoading,
  teamId: _teamId,
  isOwner,
  onUnmount,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!resources || resources.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
        暂无挂载资源
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {resources?.map((resource) => (
        <div key={resource.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 group">
          <FolderOpen className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{resource.fileName}</p>
            <p className="text-xs text-muted-foreground">
              挂载于 {new Date(resource.mountedAt).toLocaleDateString('zh-CN')}
            </p>
          </div>
          {isOwner && onUnmount && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (confirm(`确定要卸载「${resource.fileName}」吗？团队成员将失去访问权限。`)) {
                  onUnmount(resource.fileId);
                }
              }}
              title="卸载资源"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {!resources?.length && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
          暂无挂载资源
        </div>
      )}
    </div>
  );
};

// ── 设置 Section ──

interface SettingsSectionProps {
  teamData: { id: string; name: string; description: string | null; storageQuota?: number; defaultMemberRole?: string };
  onUpdate: (data: { name?: string; description?: string; storageQuota?: number; defaultMemberRole?: string }) => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDeleting: boolean;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({ teamData, onUpdate, onDelete, isUpdating, isDeleting }) => {
  const { data: storageStats } = useQuery({
    queryKey: ['team-storage-settings', teamData.id],
    queryFn: () => teamsApi.getStorageStats(teamData.id).then((r) => r.data.data),
  });

  const [name, setName] = useState(teamData.name);
  const [description, setDescription] = useState(teamData.description ?? '');
  // 优先使用 storageStats（从存储统计API获取的最新值），其次用 teamData，最后默认5GB
  const effectiveQuota = storageStats?.storageQuota ?? teamData?.storageQuota ?? 5368709120;
  const [storageQuotaMB, setStorageQuotaMB] = useState(Math.round(effectiveQuota / 1024 / 1024));
  const [defaultMemberRole, setDefaultMemberRole] = useState(teamData?.defaultMemberRole || 'member');

  // 当 storageStats 异步加载完成后，同步最新配额值
  useEffect(() => {
    if (storageStats?.storageQuota) {
      setStorageQuotaMB(Math.round(storageStats.storageQuota / 1024 / 1024));
    }
  }, [storageStats?.storageQuota]);

  return (
    <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
      <h3 className="font-medium flex items-center gap-2">
        <Settings className="h-4 w-4" />
        团队设置
      </h3>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">团队名称</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入团队名称" />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="输入团队描述..."
            className="w-full min-h-[80px] px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
            maxLength={200}
          />
        </div>

        {/* 存储配额 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">存储配额</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={Math.round(storageQuotaMB || 0)}
              onChange={(e) => setStorageQuotaMB(Number(e.target.value))}
              placeholder="单位: MB"
              min={50}
              max={1048576}
              className="w-32"
            />
            <span className="text-sm text-muted-foreground">
              MB ({formatBytes((storageQuotaMB || 0) * 1024 * 1024)})
            </span>
          </div>
          <p className="text-xs text-muted-foreground">范围: 50MB ~ 1TB，修改后立即生效</p>
        </div>

        {/* 默认成员角色 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">默认成员角色</label>
          <div className="flex gap-2">
            {(['member', 'guest', 'admin'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDefaultMemberRole(r)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors border',
                  defaultMemberRole === r ? 'bg-primary/10 text-primary border-primary/30' : 'hover:bg-muted'
                )}
              >
                {r === 'member' ? '成员' : r === 'guest' ? '访客' : '管理员'}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">新成员加入时的默认角色</p>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting}>
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
            删除团队
          </Button>
          <Button
            size="sm"
            onClick={() =>
              onUpdate({
                name: name.trim(),
                description: description.trim() || undefined,
                storageQuota: (storageQuotaMB || 0) * 1024 * 1024,
                defaultMemberRole,
              })
            }
            disabled={
              isUpdating ||
              (name.trim() === teamData.name &&
                (description.trim() || null) === teamData.description &&
                (storageQuotaMB || 0) * 1024 * 1024 === (teamData.storageQuota ?? 5368709120) &&
                defaultMemberRole === (teamData.defaultMemberRole || 'member'))
            }
          >
            {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Pencil className="h-4 w-4 mr-1" />}
            保存更改
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TeamDetail;
