/**
 * TeamActivityFeed.tsx — 团队活动时间线
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { teamsApi } from '@/services/collab';
import {
  UserPlus,
  UserMinus,
  Shield,
  FolderPlus,
  FolderMinus,
  Upload,
  Trash2,
  MessageSquare,
  Link as LinkIcon,
  Mail,
  Settings,
  Loader2,
  Clock,
} from 'lucide-react';
import { cn } from '@/utils';

interface TeamActivityFeedProps {
  teamId: string;
}

const ACTION_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  member_joined: { icon: <UserPlus className="h-4 w-4" />, color: 'text-green-500', label: '加入' },
  member_left: { icon: <UserMinus className="h-4 w-4" />, color: 'text-gray-400', label: '离开' },
  role_changed: { icon: <Shield className="h-4 w-4" />, color: 'text-amber-500', label: '角色变更' },
  file_mounted: { icon: <FolderPlus className="h-4 w-4" />, color: 'text-blue-500', label: '挂载文件' },
  file_unmounted: { icon: <FolderMinus className="h-4 w-4" />, color: 'text-orange-500', label: '卸载文件' },
  file_uploaded: { icon: <Upload className="h-4 w-4" />, color: 'text-cyan-500', label: '上传' },
  file_deleted: { icon: <Trash2 className="h-4 w-4" />, color: 'text-red-400', label: '删除' },
  comment_added: { icon: <MessageSquare className="h-4 w-4" />, color: 'text-purple-500', label: '评论' },
  team_created: { icon: <Settings className="h-4 w-4" />, color: 'text-primary', label: '创建团队' },
  team_settings_updated: { icon: <Settings className="h-4 w-4" />, color: 'text-gray-400', label: '更新设置' },
  invite_sent: { icon: <LinkIcon className="h-4 w-4" />, color: 'text-blue-400', label: '发送邀请' },
  invite_accepted: { icon: <Mail className="h-4 w-4" />, color: 'text-green-400', label: '接受邀请' },
};

const TeamActivityFeed: React.FC<TeamActivityFeedProps> = ({ teamId }) => {
  const { data: activityData, isLoading } = useQuery({
    queryKey: ['team-activities', teamId],
    queryFn: () => teamsApi.getActivities(teamId, { limit: 30 }).then((r) => r.data.data),
  });

  const items = activityData?.items ?? [];

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  if (items.length === 0)
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" /> 暂无活动记录
      </div>
    );

  return (
    <div className="space-y-1 max-h-[500px] overflow-y-auto">
      {items.map((item) => {
        const config = ACTION_CONFIG[item.action] || {
          icon: <Clock className="h-4 w-4" />,
          color: 'text-gray-400',
          label: item.action,
        };
        return (
          <div
            key={item.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors"
          >
            <div className={cn('mt-0.5 p-1.5 rounded-full bg-muted flex-shrink-0', config.color)}>{config.icon}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-medium">{item.userName || '某人'}</span>{' '}
                <span className="text-muted-foreground">{config.label}</span>
                {item.details && Object.keys(item.details).length > 0 && (
                  <span className="text-muted-foreground"> {formatDetail(item.action, item.details)}</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeTime(item.createdAt)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

function formatDetail(action: string, details: Record<string, unknown>): string {
  if (!details) return '';
  switch (action) {
    case 'member_joined':
      return details.targetUserName ? `— 欢迎 ${details.targetUserName as string} 加入` : '';
    case 'role_changed':
      return `→ ${(details.newRole as string) || ''}`;
    case 'file_mounted':
    case 'file_unmounted':
    case 'file_uploaded':
    case 'file_deleted':
      return `「${(details.fileName as string) || ''}」`;
    case 'invite_sent':
      return `→ ${(details.targetEmail as string) || (details.targetCode as string) || ''}`;
    default:
      return '';
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN');
}

export default TeamActivityFeed;
