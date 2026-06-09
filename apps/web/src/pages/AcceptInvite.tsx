/**
 * AcceptInvite.tsx — 团队邀请接受页面
 *
 * 流程：
 * 1. 公开获取邀请详情（GET /api/invite/:token）
 * 2. 未登录 → 提示登录（保留返回URL）
 * 3. 已登录 → 显示团队信息 + 接受按钮
 * 4. 接受成功 → 跳转到团队工作区
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/services/api-client';
import { teamsApi } from '@/services/collab';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useToast } from '@/components/ui/useToast';
import { Loader2, Users, UserPlus, CheckCircle, XCircle, Clock, AlertTriangle, Shield, Eye } from 'lucide-react';

interface InviteInfo {
  id: string;
  teamId: string;
  teamName: string;
  teamDescription: string | null;
  inviterName: string | null;
  inviterEmail: string | null;
  role: 'member' | 'guest';
  message: string | null;
  expiresAt: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'used';
  createdAt: string;
}

const roleLabels = {
  member: { label: '成员', icon: Shield, color: 'text-blue-500' },
  guest: { label: '访客', icon: Eye, color: 'text-gray-500' },
};

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // 获取邀请详情（公开接口，无需登录）
  const {
    data: invite,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['invite-info', token],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: InviteInfo }>(`/api/invite/${token}`);
      return res.data.data;
    },
    retry: false,
  });

  // 接受邀请 mutation
  const acceptMutation = useMutation({
    mutationFn: () => teamsApi.acceptInvite(invite!.teamId, token!),
    onSuccess: () => {
      toast({ title: '已加入团队', description: `你已成为「${invite!.teamName}」的${roleLabels[invite!.role].label}` });
      navigate(`/teams/${invite!.teamId}/workspace`, { replace: true });
    },
    onError: (e: any) => {
      toast({ title: '加入失败', description: e.response?.data?.error?.message || e.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">正在加载邀请信息...</p>
        </div>
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 flex flex-col items-center gap-3">
            <XCircle className="h-12 w-12 text-destructive" />
            <h2 className="text-lg font-semibold">邀请链接无效</h2>
            <p className="text-sm text-muted-foreground text-center">该邀请链接可能已被删除或不存在</p>
            <Button variant="outline" onClick={() => navigate('/')}>
              返回首页
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 非pending状态
  if (invite.status !== 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 flex flex-col items-center gap-3">
            {invite.status === 'accepted' || invite.status === 'used' ? (
              <>
                <CheckCircle className="h-12 w-12 text-green-500" />
                <h2 className="text-lg font-semibold">已接受</h2>
                <p className="text-sm text-muted-foreground text-center">你已经加入了「{invite.teamName}」</p>
              </>
            ) : invite.status === 'expired' ? (
              <>
                <Clock className="h-12 w-12 text-orange-500" />
                <h2 className="text-lg font-semibold">邀请已过期</h2>
                <p className="text-sm text-muted-foreground text-center">该邀请链接已过期，请联系管理员重新发送</p>
              </>
            ) : (
              <>
                <XCircle className="h-12 w-12 text-destructive" />
                <h2 className="text-lg font-semibold">邀请已失效</h2>
                <p className="text-sm text-muted-foreground text-center">该邀请已被撤销或使用过</p>
              </>
            )}
            <Button onClick={() => navigate(`/teams/${invite.teamId}/workspace`)}>前往团队空间</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const roleInfo = roleLabels[invite.role];
  const RoleIcon = roleInfo.icon;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
            <UserPlus className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-xl">团队邀请</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">你被邀请加入以下团队</p>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* 团队信息 */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate">{invite.teamName}</p>
                {invite.teamDescription && (
                  <p className="text-xs text-muted-foreground truncate">{invite.teamDescription}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded bg-muted/50 p-2">
                <p className="text-muted-foreground">邀请人</p>
                <p className="font-medium mt-0.5">{invite.inviterName || invite.inviterEmail || '-'}</p>
              </div>
              <div className="rounded bg-muted/50 p-2">
                <p className="text-muted-foreground">角色</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <RoleIcon className={`h-3.5 w-3.5 ${roleInfo.color}`} />
                  <p className="font-medium">{roleInfo.label}</p>
                </div>
              </div>
            </div>

            {invite.message && (
              <div className="rounded bg-muted/50 p-2 text-xs">
                <p className="text-muted-foreground">附言</p>
                <p className="mt-0.5">{invite.message}</p>
              </div>
            )}
          </div>

          {/* 操作区 */}
          {!isAuthenticated ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-amber-700 dark:text-amber-400">请先登录后再接受邀请</p>
              </div>
              <Button className="w-full" onClick={() => navigate(`/login?redirect=/invite/${token}`)}>
                登录并接受邀请
              </Button>
            </div>
          ) : (
            <Button
              className="w-full"
              size="lg"
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
            >
              {acceptMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              接受邀请 — 加入「{invite.teamName}」
            </Button>
          )}

          <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
