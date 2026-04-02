/**
 * Admin.tsx
 * 管理员面板页面
 *
 * 功能:
 * - 用户管理（列表、禁用、删除）
 * - 注册配置管理
 * - 邀请码管理
 * - 系统统计与审计日志
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type AdminUser } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { useToast } from '@/components/ui/useToast';
import { useResponsive } from '@/hooks/useResponsive';
import { formatBytes, formatDate } from '@/utils';
import { cn } from '@/utils';
import { EmailConfig } from '@/components/admin/EmailConfig';
import {
  Users,
  Shield,
  Trash2,
  Edit3,
  Save,
  X,
  Plus,
  Copy,
  Key,
  UserCheck,
  Server,
  Database,
  FileText,
  FolderOpen,
  AlertTriangle,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Mail,
  Clock,
} from 'lucide-react';

type TabKey = 'users' | 'registration' | 'email' | 'stats' | 'audit';

export default function Admin() {
  const { user: currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabKey>('users');

  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">需要管理员权限</h2>
            <p className="text-sm text-muted-foreground">您没有权限访问此页面</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'users', label: '用户管理', icon: Users },
    { key: 'registration', label: '注册控制', icon: Key },
    { key: 'email', label: '邮件配置', icon: Mail },
    { key: 'audit', label: '审计日志', icon: FileText },
    { key: 'stats', label: '系统统计', icon: Server },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold">管理员面板</h1>
        <p className="text-muted-foreground text-sm mt-0.5">系统管理与配置</p>
      </div>

      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg overflow-x-auto no-scrollbar w-full sm:w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0',
                activeTab === tab.key
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'registration' && <RegistrationTab />}
      {activeTab === 'email' && <EmailConfig />}
      {activeTab === 'audit' && <AuditLogTab />}
      {activeTab === 'stats' && <StatsTab />}
    </div>
  );
}

function UsersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser, updateUser } = useAuthStore();
  const { isMobile } = useResponsive();
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    role: 'admin' | 'user';
    storageQuota: string;
    newPassword: string;
  }>({ name: '', role: 'user', storageQuota: '', newPassword: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data ?? []),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof adminApi.patchUser>[1] }) =>
      adminApi.patchUser(id, data),
    onSuccess: (_, variables) => {
      toast({ title: '用户已更新' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (variables.id === currentUser?.id) {
        if (variables.data.storageQuota !== undefined) {
          updateUser({ storageQuota: variables.data.storageQuota });
        }
        if (variables.data.name !== undefined) {
          updateUser({ name: variables.data.name });
        }
      }
      setEditingUser(null);
    },
    onError: (e: any) =>
      toast({ title: '更新失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      toast({ title: '用户已删除' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setDeleteConfirm(null);
    },
    onError: (e: any) =>
      toast({ title: '删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const startEdit = (user: AdminUser) => {
    setEditingUser(user);
    setEditForm({
      name: user.name || '',
      role: user.role,
      storageQuota: user.storageQuota ? String(Math.round(user.storageQuota / 1024 ** 3)) : '',
      newPassword: '',
    });
  };

  const saveEdit = () => {
    if (!editingUser) return;
    const quotaGB = parseFloat(editForm.storageQuota);
    const trimmedPassword = editForm.newPassword.trim();
    const data: Parameters<typeof adminApi.patchUser>[1] = {
      name: editForm.name || undefined,
      role: editForm.role,
      storageQuota:
        !isNaN(quotaGB) && editForm.storageQuota.trim() !== '' ? Math.round(quotaGB * 1024 ** 3) : undefined,
      newPassword: trimmedPassword || undefined,
    };
    patchMutation.mutate({ id: editingUser.id, data });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Users className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <CardTitle className="text-base">用户列表</CardTitle>
            <CardDescription>管理系统中的所有用户</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">暂无用户</div>
        ) : (
          <div className="divide-y">
            {(users as AdminUser[]).map((user) => (
              <div key={user.id} className="py-4 first:pt-0 last:pb-0">
                {editingUser?.id === user.id ? (
                  <div className="space-y-3 bg-muted/30 p-4 rounded-lg">
                    <div className={cn('grid gap-3', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">昵称</label>
                        <Input
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder="显示名称"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">角色</label>
                        <select
                          value={editForm.role}
                          onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as 'admin' | 'user' }))}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                        >
                          <option value="user">普通用户</option>
                          <option value="admin">管理员</option>
                        </select>
                      </div>
                    </div>
                    <div className={cn('grid gap-3', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">存储配额 (GB)</label>
                        <Input
                          type="number"
                          value={editForm.storageQuota}
                          onChange={(e) => setEditForm((f) => ({ ...f, storageQuota: e.target.value }))}
                          placeholder="留空则不限制"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">新密码</label>
                        <Input
                          type="password"
                          value={editForm.newPassword}
                          onChange={(e) => setEditForm((f) => ({ ...f, newPassword: e.target.value }))}
                          placeholder="留空则不修改"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit} disabled={patchMutation.isPending}>
                        {patchMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <Save className="h-4 w-4 mr-1" />
                        )}
                        保存
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingUser(null)}>
                        <X className="h-4 w-4 mr-1" /> 取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={cn('flex items-center gap-3', isMobile && 'flex-col items-start')}>
                    <div className="flex items-center gap-3 flex-1 min-w-0 w-full">
                      <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm flex-shrink-0">
                        {(user.name || user.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{user.name || user.email}</span>
                          {user.role === 'admin' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                              管理员
                            </span>
                          )}
                        </div>
                        <div
                          className={cn(
                            'flex items-center gap-3 text-xs text-muted-foreground mt-0.5',
                            isMobile ? 'flex-wrap' : 'flex-nowrap'
                          )}
                        >
                          <span className="flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{user.email}</span>
                          </span>
                          <span className="flex-shrink-0">
                            {formatBytes(user.storageUsed)} /{' '}
                            {user.storageQuota ? formatBytes(user.storageQuota) : '无限制'}
                          </span>
                          <span className="flex-shrink-0">{user.fileCount} 文件</span>
                        </div>
                      </div>
                    </div>
                    <div className={cn('flex items-center gap-1', isMobile && 'w-full justify-end')}>
                      <Button variant="ghost" size="icon" onClick={() => startEdit(user)}>
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => setDeleteConfirm(user.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md shadow-xl">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                  </div>
                  <CardTitle className="text-base text-red-500">确认删除用户</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">此操作将永久删除该用户及其所有数据，且不可恢复。</p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => deleteMutation.mutate(deleteConfirm)}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    确认删除
                  </Button>
                  <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                    取消
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RegistrationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newCodeCount, setNewCodeCount] = useState(1);

  const { data: regConfig, isLoading } = useQuery({
    queryKey: ['admin', 'registration'],
    queryFn: () => adminApi.getRegistration().then((r) => r.data.data),
  });

  const setRegMutation = useMutation({
    mutationFn: (data: Parameters<typeof adminApi.setRegistration>[0]) => adminApi.setRegistration(data),
    onSuccess: () => {
      toast({ title: '设置已更新' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'registration'] });
    },
    onError: (e: any) =>
      toast({ title: '更新失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const genCodesMutation = useMutation({
    mutationFn: (count: number) => adminApi.generateCodes(count),
    onSuccess: (res) => {
      const codes = res.data.data?.codes ?? [];
      toast({ title: `已生成 ${codes.length} 个邀请码` });
      queryClient.invalidateQueries({ queryKey: ['admin', 'registration'] });
    },
    onError: (e: any) =>
      toast({ title: '生成失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const revokeCodeMutation = useMutation({
    mutationFn: (code: string) => adminApi.revokeCode(code),
    onSuccess: () => {
      toast({ title: '邀请码已撤销' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'registration'] });
    },
    onError: (e: any) =>
      toast({ title: '撤销失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: '已复制邀请码' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Key className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <CardTitle className="text-base">注册控制</CardTitle>
              <CardDescription>管理用户注册方式和邀请码</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              {regConfig?.open ? (
                <ToggleRight className="h-5 w-5 text-emerald-500" />
              ) : (
                <ToggleLeft className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">开放注册</p>
                <p className="text-xs text-muted-foreground">允许新用户注册账号</p>
              </div>
            </div>
            <Button
              variant={regConfig?.open ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRegMutation.mutate({ open: !regConfig?.open })}
              disabled={setRegMutation.isPending}
            >
              {regConfig?.open ? '已开放' : '已关闭'}
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              {regConfig?.requireInviteCode ? (
                <Shield className="h-5 w-5 text-amber-500" />
              ) : (
                <Shield className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">需要邀请码</p>
                <p className="text-xs text-muted-foreground">注册时必须提供有效邀请码</p>
              </div>
            </div>
            <Button
              variant={regConfig?.requireInviteCode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRegMutation.mutate({ requireInviteCode: !regConfig?.requireInviteCode })}
              disabled={setRegMutation.isPending || !regConfig?.open}
            >
              {regConfig?.requireInviteCode ? '已启用' : '已禁用'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Plus className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <CardTitle className="text-base">邀请码管理</CardTitle>
                <CardDescription>生成和管理注册邀请码</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={50}
                value={newCodeCount}
                onChange={(e) => setNewCodeCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                className="w-20"
              />
              <Button
                size="sm"
                onClick={() => genCodesMutation.mutate(newCodeCount)}
                disabled={genCodesMutation.isPending}
              >
                {genCodesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                生成
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!regConfig?.inviteCodes || regConfig.inviteCodes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">暂无邀请码</div>
          ) : (
            <div className="space-y-2">
              {regConfig.inviteCodes.map((item) => (
                <div key={item.code} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <code className="font-mono text-sm flex-1">{item.code}</code>
                  {item.usedBy ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <UserCheck className="h-3.5 w-3.5" /> 已使用
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-emerald-500">
                      <Clock className="h-3.5 w-3.5" /> 未使用
                    </span>
                  )}
                  {!item.usedBy && (
                    <>
                      <Button variant="ghost" size="icon" onClick={() => copyCode(item.code)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => revokeCodeMutation.mutate(item.code)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatsTab() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminApi.stats().then((r) => r.data.data),
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statCards = [
    { label: '用户总数', value: stats?.userCount ?? 0, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: '管理员', value: stats?.adminCount ?? 0, icon: Shield, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    {
      label: '文件总数',
      value: stats?.fileCount ?? 0,
      icon: FileText,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
    {
      label: '文件夹',
      value: stats?.folderCount ?? 0,
      icon: FolderOpen,
      color: 'text-purple-500',
      bg: 'bg-purple-500/10',
    },
    { label: '存储桶', value: stats?.bucketCount ?? 0, icon: Database, color: 'text-pink-500', bg: 'bg-pink-500/10' },
    {
      label: '总存储用量',
      value: formatBytes(stats?.totalStorageUsed ?? 0),
      icon: Server,
      color: 'text-cyan-500',
      bg: 'bg-cyan-500/10',
      isString: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-card border rounded-xl p-4">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-3', card.bg)}>
                <Icon className={cn('h-4 w-4', card.color)} />
              </div>
              <p className="text-xl font-bold tabular-nums">{card.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.label}</p>
            </div>
          );
        })}
      </div>

      {stats?.providerBreakdown && Object.keys(stats.providerBreakdown).length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <Database className="h-4 w-4 text-indigo-500" />
              </div>
              <div>
                <CardTitle className="text-base">存储厂商分布</CardTitle>
                <CardDescription>各存储厂商的使用情况</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(stats.providerBreakdown).map(([provider, data]) => (
                <div key={provider} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <span className="font-medium text-sm capitalize">{provider}</span>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{data.bucketCount} 个存储桶</span>
                    <span>{formatBytes(data.storageUsed)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AuditLogTab() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>('');
  const limit = 20;
  const { isMobile } = useResponsive();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-logs', page, actionFilter],
    queryFn: () => adminApi.auditLogs({ page, limit, action: actionFilter || undefined }).then((r) => r.data.data!),
  });

  const logs = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const ACTION_OPTIONS = [
    { value: '', label: '全部操作' },
    { value: 'user.login', label: '登录' },
    { value: 'user.logout', label: '登出' },
    { value: 'user.register', label: '注册' },
    { value: 'user.update', label: '更新用户' },
    { value: 'user.delete', label: '删除用户' },
    { value: 'file.upload', label: '文件上传' },
    { value: 'file.download', label: '文件下载' },
    { value: 'file.delete', label: '文件删除' },
    { value: 'file.move', label: '文件移动' },
    { value: 'file.rename', label: '文件重命名' },
    { value: 'folder.create', label: '创建文件夹' },
    { value: 'share.create', label: '创建分享' },
    { value: 'share.access', label: '访问分享' },
    { value: 'bucket.create', label: '创建存储桶' },
    { value: 'bucket.update', label: '更新存储桶' },
    { value: 'bucket.delete', label: '删除存储桶' },
    { value: 'admin.user_update', label: '管理用户' },
    { value: 'admin.config_change', label: '配置变更' },
    { value: 'admin.invite_code_generate', label: '生成邀请码' },
    { value: 'admin.invite_code_revoke', label: '撤销邀请码' },
  ];

  const ACTION_LABELS: Record<string, { label: string; color: string }> = {
    'user.login': { label: '登录', color: 'bg-blue-500/10 text-blue-500' },
    'user.logout': { label: '登出', color: 'bg-gray-500/10 text-gray-500' },
    'user.register': { label: '注册', color: 'bg-green-500/10 text-green-500' },
    'user.update': { label: '更新用户', color: 'bg-indigo-500/10 text-indigo-500' },
    'user.delete': { label: '删除用户', color: 'bg-red-500/10 text-red-500' },
    'file.upload': { label: '上传', color: 'bg-emerald-500/10 text-emerald-500' },
    'file.download': { label: '下载', color: 'bg-cyan-500/10 text-cyan-500' },
    'file.delete': { label: '删除', color: 'bg-red-500/10 text-red-500' },
    'file.move': { label: '移动', color: 'bg-amber-500/10 text-amber-500' },
    'file.rename': { label: '重命名', color: 'bg-purple-500/10 text-purple-500' },
    'folder.create': { label: '创建文件夹', color: 'bg-yellow-500/10 text-yellow-500' },
    'share.create': { label: '创建分享', color: 'bg-pink-500/10 text-pink-500' },
    'share.access': { label: '访问分享', color: 'bg-violet-500/10 text-violet-500' },
    'bucket.create': { label: '创建存储桶', color: 'bg-teal-500/10 text-teal-500' },
    'bucket.update': { label: '更新存储桶', color: 'bg-sky-500/10 text-sky-500' },
    'bucket.delete': { label: '删除存储桶', color: 'bg-rose-500/10 text-rose-500' },
    'admin.user_update': { label: '管理用户', color: 'bg-orange-500/10 text-orange-500' },
    'admin.config_change': { label: '配置变更', color: 'bg-slate-500/10 text-slate-500' },
    'admin.invite_code_generate': { label: '生成邀请码', color: 'bg-lime-500/10 text-lime-500' },
    'admin.invite_code_revoke': { label: '撤销邀请码', color: 'bg-red-500/10 text-red-500' },
  };

  return (
    <Card>
      <CardHeader>
        <div className={cn('flex items-center gap-3', isMobile && 'flex-col items-start')}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <FileText className="h-4 w-4 text-indigo-500" />
            </div>
            <div>
              <CardTitle className="text-base">审计日志</CardTitle>
              <CardDescription>系统操作记录</CardDescription>
            </div>
          </div>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className={cn('h-9 rounded-md border border-input bg-background px-3 py-1 text-sm', isMobile && 'w-full')}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">暂无审计日志</div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => {
              const actionInfo = ACTION_LABELS[log.action] || {
                label: log.action,
                color: 'bg-muted text-muted-foreground',
              };
              return (
                <div
                  key={log.id}
                  className={cn(
                    'flex items-center gap-4 p-3 rounded-lg border bg-muted/30',
                    isMobile && 'flex-col items-start'
                  )}
                >
                  <div className={cn('px-2 py-1 rounded text-xs font-medium flex-shrink-0', actionInfo.color)}>
                    {actionInfo.label}
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <p className={cn('text-sm', isMobile ? 'line-clamp-2' : 'truncate')}>{log.details || log.action}</p>
                    <div
                      className={cn(
                        'flex items-center gap-3 text-xs text-muted-foreground mt-0.5',
                        isMobile && 'flex-wrap'
                      )}
                    >
                      <span className="truncate">{log.userName || log.userEmail}</span>
                      {log.ipAddress && <span className="flex-shrink-0">· {log.ipAddress}</span>}
                      <span className="flex-shrink-0">· {formatDate(log.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              上一页
            </Button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              下一页
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
