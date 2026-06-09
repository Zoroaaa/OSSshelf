/**
 * TeamInviteRecords.tsx — 团队邀请记录管理
 *
 * 功能：
 * - 查看团队所有邀请记录（支持状态筛选）
 * - 显示邀请状态（待定/已接受/已过期/已撤销）
 * - 权限管控：只有团队成员可查看
 * - 管理员可撤销待定邀请
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import api from '@/services/api-client';
import {
  Loader2,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  Filter,
  Mail,
  User,
  Calendar,
  Shield,
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/utils';

interface TeamInviteRecordsProps {
  teamId: string;
  teamName: string;
  userRole: string; // 用于权限控制
  onClose: () => void;
}

type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

interface InviteRecord {
  id: string;
  inviteToken: string;
  inviteCode: string | null;
  email: string | null;
  role: string;
  message: string | null;
  status: InviteStatus;
  inviterName: string | null;
  inviterEmail: string | null;
  expiresAt: string | null;
  createdAt: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  acceptedUserName: string | null;
}

const STATUS_CONFIG: Record<
  InviteStatus,
  { label: string; icon: React.ElementType; color: string; bgColor: string }
> = {
  pending: {
    label: '待接受',
    icon: Clock,
    color: 'text-amber-600',
    bgColor: 'bg-amber-500/10 border-amber-500/20',
  },
  accepted: {
    label: '已接受',
    icon: CheckCircle2,
    color: 'text-green-600',
    bgColor: 'bg-green-500/10 border-green-500/20',
  },
  expired: {
    label: '已过期',
    icon: XCircle,
    color: 'text-gray-500',
    bgColor: 'bg-gray-500/10 border-gray-500/20',
  },
  revoked: {
    label: '已撤销',
    icon: Ban,
    color: 'text-red-600',
    bgColor: 'bg-red-500/10 border-red-500/20',
  },
};

const TeamInviteRecords: React.FC<TeamInviteRecordsProps> = ({
  teamId,
  teamName,
  userRole,
  onClose,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<InviteStatus | 'all'>('all');

  // 获取邀请记录
  const {
    data: invites,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['team-invite-records', teamId, statusFilter],
    queryFn: async () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const res = await api.get<{
        success: boolean;
        data: { invites: InviteRecord[] };
      }>(`/api/teams/${teamId}/invites/all${params}`);
      return res.data.data.invites ?? [];
    },
  });

  // 撤销邀请
  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) =>
      api.delete(`/api/teams/${teamId}/invites/${inviteId}`).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '邀请已撤销' });
      queryClient.invalidateQueries({ queryKey: ['team-invite-records', teamId] });
    },
    onError: (e: any) => {
      toast({
        title: '撤销失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  // 判断当前用户是否可以管理邀请
  const canManageInvites = userRole === 'admin' || userRole === 'owner';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold">邀请记录</h2>
            <p className="text-sm text-muted-foreground">{teamName} · 管理和追踪邀请</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 状态筛选栏 */}
        <div className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" /> 筛选:
            </span>
            {(['all', 'pending', 'accepted', 'expired', 'revoked'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                  statusFilter === status
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'hover:bg-muted border-transparent'
                )}
              >
                {status === 'all' ? '全部' : STATUS_CONFIG[status].label}
                {status !== 'all' && invites && (
                  <span className="ml-1 text-[10px] opacity-70">
                    ({invites.filter((i) => i.status === status).length})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 邀请记录列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !invites || invites.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Mail className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{statusFilter === 'all' ? '暂无邀请记录' : '该状态下暂无记录'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {invites.map((invite) => {
                const config = STATUS_CONFIG[invite.status];
                const StatusIcon = config.icon;

                return (
                  <div
                    key={invite.id}
                    className={cn(
                      'rounded-lg border p-4 space-y-3 transition-colors',
                      invite.status === 'pending' && 'hover:border-amber-500/30'
                    )}
                  >
                    {/* 第一行：状态 + 邀请人 + 时间 */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <StatusIcon className={cn('h-4 w-4 shrink-0', config.color)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={cn(
                                'px-1.5 py-0.5 text-xs font-medium rounded border',
                                config.bgColor,
                                config.color
                              )}
                            >
                              {config.label}
                            </span>
                            {invite.email && (
                              <span className="text-sm font-medium truncate">{invite.email}</span>
                            )}
                            {!invite.email && <span className="text-sm text-muted-foreground">通用邀请链接</span>}
                            {invite.inviteCode && (
                              <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                #{invite.inviteCode}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      {invite.status === 'pending' && canManageInvites && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            if (confirm('确定撤销此邀请？')) {
                              revokeMutation.mutate(invite.id);
                            }
                          }}
                          disabled={revokeMutation.isPending}
                        >
                          {revokeMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Ban className="h-3.5 w-3.5 mr-1" />
                          )}
                          撤销
                        </Button>
                      )}
                    </div>

                    {/* 第二行：详细信息 */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pl-6">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        邀请人: {invite.inviterName || invite.inviterEmail || '未知'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Shield className="h-3 w-3" />
                        角色: {invite.role === 'member' ? '成员' : '访客'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        创建于 {new Date(invite.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                      {invite.expiresAt && (
                        <span
                          className={cn(
                            'flex items-center gap-1',
                            invite.status === 'pending' &&
                              new Date(invite.expiresAt) < new Date() &&
                              'text-red-500'
                          )}
                        >
                          <Clock className="h-3 w-3" />
                          过期时间: {new Date(invite.expiresAt).toLocaleDateString('zh-CN')}
                        </span>
                      )}

                      {/* 已接受信息 */}
                      {invite.status === 'accepted' && invite.acceptedUserName && (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-3 w-3" />
                          接受人: {invite.acceptedUserName}
                          {invite.acceptedAt &&
                            ` · ${new Date(invite.acceptedAt).toLocaleDateString('zh-CN')}`}
                        </span>
                      )}
                    </div>

                    {/* 附言 */}
                    {invite.message && (
                      <p className="text-xs text-muted-foreground pl-6 italic bg-muted/30 rounded px-2 py-1">
                        "{invite.message}"
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部统计 + 关闭按钮 */}
        <div className="p-4 border-t flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            {invites && invites.length > 0 && (
              <span>
                共 {invites.length} 条记录
                {' · '}
                待处理:{' '}
                {invites.filter((i) => i.status === 'pending').length} | 已接受:{' '}
                {invites.filter((i) => i.status === 'accepted').length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <Loader2 className={cn('h-3.5 w-3.5 mr-1', isLoading && 'animate-spin')} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamInviteRecords;
