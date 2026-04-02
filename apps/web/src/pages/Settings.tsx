/**
 * Settings.tsx
 * 设置页面
 *
 * 功能:
 * - 个人信息管理
 * - 密码修改
 * - 设备管理
 * - 登录安全
 * - 存储空间
 * - WebDAV 配置
 */

import { useState, useRef } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, type EmailPreferences } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { StorageBar } from '@/components/files/StorageBar';
import { useToast } from '@/components/ui/useToast';
import { formatBytes, formatDate } from '@/utils';
import { cn } from '@/utils';
import {
  User,
  Lock,
  Trash2,
  Server,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Globe,
  Shield,
  Monitor,
  Smartphone,
  Tablet,
  Laptop,
  Trash2 as TrashIcon,
  Clock,
  MapPin,
  Loader2,
  Sparkles,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { AISettings } from '@/components/ai';

type SettingsTab = 'profile' | 'email' | 'security' | 'ai';

function getDeviceIcon(userAgent: string): typeof Monitor {
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    if (/tablet|ipad/i.test(ua)) return Tablet;
    return Smartphone;
  }
  if (/tablet|ipad/i.test(ua)) return Tablet;
  if (/laptop|notebook/i.test(ua)) return Laptop;
  return Monitor;
}

function getBrowserName(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('chrome/')) return 'Chrome';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('safari/') && !ua.includes('chrome')) return 'Safari';
  if (ua.includes('opera') || ua.includes('opr/')) return 'Opera';
  return '浏览器';
}

function getOSName(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac os')) return 'macOS';
  if (ua.includes('linux')) return 'Linux';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'iOS';
  return '未知系统';
}

function EmailChangeForm() {
  const { toast } = useToast();
  const [step, setStep] = useState<'input' | 'verify' | 'done'>('input');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [countdown, setCountdown] = useState(0);

  const sendCodeMutation = useMutation({
    mutationFn: () => authApi.changeEmail({ newEmail, password }),
    onSuccess: () => {
      toast({ title: '验证码已发送', description: `6位验证码已发送到 ${newEmail}` });
      setStep('verify');
      startCountdown(60);
    },
    onError: (e: any) => {
      toast({
        title: '发送失败',
        description: e.response?.data?.error?.message || '请检查输入',
        variant: 'destructive',
      });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => authApi.verifyCode({ email: newEmail, code: code.join(''), type: 'change_email' }),
    onSuccess: () => {
      toast({ title: '邮箱更换成功', description: '您的邮箱已成功更换' });
      setStep('done');
      setNewEmail('');
      setPassword('');
      setCode(['', '', '', '', '', '']);
    },
    onError: (e: any) => {
      toast({
        title: '验证失败',
        description: e.response?.data?.error?.message || '验证码错误或已过期',
        variant: 'destructive',
      });
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    },
  });

  const handleSendCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !password) {
      toast({ title: '请填写完整信息', variant: 'destructive' });
      return;
    }
    sendCodeMutation.mutate();
  };

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter' && code.every((d) => d)) {
      verifyMutation.mutate();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData.length > 0) {
      const newCode = [...code];
      pastedData.split('').forEach((char, i) => {
        if (i < 6) newCode[i] = char;
      });
      setCode(newCode);
      const nextIndex = Math.min(pastedData.length, 5);
      inputRefs.current[nextIndex]?.focus();
    }
  };

  const handleVerify = () => {
    if (code.some((d) => !d)) {
      toast({ title: '请输入完整验证码', variant: 'destructive' });
      return;
    }
    verifyMutation.mutate();
  };

  const handleResend = () => {
    sendCodeMutation.mutate();
  };

  const startCountdown = (seconds: number) => {
    setCountdown(seconds);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleReset = () => {
    setStep('input');
    setCode(['', '', '', '', '', '']);
    setPassword('');
  };

  if (step === 'done') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-emerald-600 bg-emerald-500/10 p-3 rounded-md">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">邮箱更换成功！</span>
        </div>
        <Button size="sm" variant="outline" onClick={handleReset}>
          继续更换邮箱
        </Button>
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div className="space-y-4">
        <div className="bg-muted/50 rounded-lg p-3 space-y-1">
          <p className="text-xs text-muted-foreground">验证码发送至：</p>
          <p className="text-sm font-medium break-all">{newEmail}</p>
          <p className="text-xs text-muted-foreground">验证码有效期为10分钟</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">输入6位验证码</label>
          <div className="flex gap-2 justify-center">
            {code.map((digit, index) => (
              <Input
                key={index}
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleCodeChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={index === 0 ? handlePaste : undefined}
                className="w-10 h-11 text-center text-lg font-semibold"
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleVerify}
            disabled={code.some((d) => !d) || verifyMutation.isPending}
            className="flex-1"
          >
            {verifyMutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                验证中...
              </>
            ) : (
              '确认更换'
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={countdown > 0 || sendCodeMutation.isPending}
            onClick={handleResend}
          >
            {sendCodeMutation.isPending ? (
              '发送中...'
            ) : countdown > 0 ? (
              `${countdown}s`
            ) : (
              <>
                <RefreshCw className="h-3 w-3 mr-1" />
                重发
              </>
            )}
          </Button>
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          返回修改
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSendCode} className="space-y-3">
      <Input type="email" placeholder="新邮箱地址" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
      <Input type="password" placeholder="当前密码" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" size="sm" disabled={sendCodeMutation.isPending}>
        {sendCodeMutation.isPending ? (
          <>
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            发送中...
          </>
        ) : (
          '发送验证码'
        )}
      </Button>
    </form>
  );
}

function EmailPreferencesForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery({
    queryKey: ['email-preferences'],
    queryFn: () => authApi.getEmailPreferences().then((r) => r.data.data),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<EmailPreferences>) => authApi.setEmailPreferences(data),
    onSuccess: () => {
      toast({ title: '偏好已保存' });
      queryClient.invalidateQueries({ queryKey: ['email-preferences'] });
    },
    onError: (e: any) => {
      toast({
        title: '保存失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const handleToggle = (key: keyof EmailPreferences) => {
    if (!preferences) return;
    updateMutation.mutate({ [key]: !preferences[key] });
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">加载中...</div>;
  }

  const preferenceItems = [
    { key: 'mention' as const, label: '@提及通知', desc: '当有人在文件或评论中@您时发送邮件' },
    { key: 'share_received' as const, label: '分享接收通知', desc: '当他人分享文件给您时发送邮件' },
    { key: 'quota_warning' as const, label: '配额警告', desc: '存储空间即将用尽时发送警告邮件' },
    { key: 'ai_complete' as const, label: 'AI处理完成', desc: 'AI摘要或标签处理完成时发送邮件' },
    { key: 'system' as const, label: '系统通知', desc: '重要的系统更新和安全提醒' },
  ];

  return (
    <div className="space-y-3">
      {preferenceItems.map((item) => (
        <div key={item.key} className="flex items-start justify-between gap-4 p-3 rounded-lg border">
          <div className="flex-1">
            <p className="text-sm font-medium">{item.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
          </div>
          <button
            onClick={() => handleToggle(item.key)}
            disabled={updateMutation.isPending}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              preferences?.[item.key] ? 'bg-primary' : 'bg-muted'
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                preferences?.[item.key] ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Settings() {
  const { user, updateUser, logout } = useAuthStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [name, setName] = useState(user?.name || '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const apiBase = import.meta.env.VITE_API_URL || '';
  const webdavUrl = `${apiBase}/dav`;

  const {
    data: devices = [],
    isLoading: devicesLoading,
    refetch: refetchDevices,
  } = useQuery({
    queryKey: ['devices'],
    queryFn: () => authApi.devices().then((r) => r.data.data ?? []),
    select: (data) => data.slice(0, 10),
  });

  const updateNameMutation = useMutation({
    mutationFn: () => authApi.patchMe({ name: name.trim() || undefined }),
    onSuccess: (res) => {
      const updated = res.data.data;
      if (updated) updateUser(updated);
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast({ title: '昵称已更新' });
    },
    onError: (e: unknown) =>
      toast({
        title: '更新失败',
        description: (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const updatePasswordMutation = useMutation({
    mutationFn: () => authApi.patchMe({ currentPassword: currentPw, newPassword: newPw }),
    onSuccess: () => {
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      toast({ title: '密码已更新，请重新登录', variant: 'default' });
      setTimeout(() => logout(), 1500);
    },
    onError: (e: unknown) =>
      toast({
        title: '修改密码失败',
        description: (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: () => authApi.deleteMe(deletePw),
    onSuccess: () => {
      toast({ title: '账户已注销' });
      logout();
    },
    onError: (e: unknown) =>
      toast({
        title: '注销失败',
        description: (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: (deviceId: string) => authApi.deleteDevice(deviceId),
    onSuccess: () => {
      toast({ title: '设备已注销' });
      refetchDevices();
    },
    onError: (e: unknown) =>
      toast({
        title: '注销失败',
        description: (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const pwStrength = (pw: string): { level: 0 | 1 | 2 | 3; label: string; color: string } => {
    if (!pw) return { level: 0, label: '', color: '' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 1) return { level: 1, label: '弱', color: 'bg-red-500' };
    if (score === 2) return { level: 2, label: '中', color: 'bg-amber-500' };
    return { level: 3, label: '强', color: 'bg-emerald-500' };
  };
  const strength = pwStrength(newPw);
  const pwMatch = newPw && confirmPw && newPw !== confirmPw;

  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text).then(() => toast({ title: msg }));
  };

  const currentDeviceId = devices.find(
    (d) =>
      d.lastActive === devices.reduce((a, b) => (new Date(a.lastActive) > new Date(b.lastActive) ? a : b)).lastActive
  )?.id;

  const tabs: { id: SettingsTab; label: string; icon: typeof User }[] = [
    { id: 'profile', label: '个人信息', icon: User },
    { id: 'email', label: '邮箱设置', icon: Mail },
    { id: 'security', label: '安全设置', icon: Shield },
    { id: 'ai', label: 'AI 功能', icon: Sparkles },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold">设置</h1>
        <p className="text-muted-foreground text-sm mt-0.5">管理您的账户与偏好</p>
      </div>

      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 lg:px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0',
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'profile' && (
        <>
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">个人信息</CardTitle>
                  <CardDescription>更新您的显示名称</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">邮箱</label>
                <Input value={user?.email || ''} disabled className="bg-muted/50" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">昵称</label>
                <div className="flex gap-2">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="输入昵称（留空则使用邮箱）"
                    onKeyDown={(e) => e.key === 'Enter' && updateNameMutation.mutate()}
                  />
                  <Button
                    onClick={() => updateNameMutation.mutate()}
                    disabled={updateNameMutation.isPending || name === (user?.name || '')}
                    size="sm"
                    className="flex-shrink-0"
                  >
                    {updateNameMutation.isPending ? '保存中…' : '保存'}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                注册于 {user?.createdAt ? formatDate(user.createdAt) : '—'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Server className="h-4 w-4 text-emerald-500" />
                </div>
                <div>
                  <CardTitle className="text-base">存储空间</CardTitle>
                  <CardDescription>您当前的存储使用情况</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <StorageBar used={user?.storageUsed || 0} quota={user?.storageQuota || 10737418240} />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-muted/40 rounded-lg px-4 py-3">
                  <p className="text-muted-foreground text-xs mb-1">已使用</p>
                  <p className="font-semibold">{formatBytes(user?.storageUsed || 0)}</p>
                </div>
                <div className="bg-muted/40 rounded-lg px-4 py-3">
                  <p className="text-muted-foreground text-xs mb-1">总配额</p>
                  <p className="font-semibold">{formatBytes(user?.storageQuota || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Globe className="h-4 w-4 text-purple-500" />
                </div>
                <div>
                  <CardTitle className="text-base">WebDAV 访问</CardTitle>
                  <CardDescription>使用 WebDAV 客户端挂载文件系统</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">WebDAV 地址</label>
                <div className="flex gap-2">
                  <Input value={webdavUrl} readOnly className="font-mono text-sm bg-muted/50" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(webdavUrl, '已复制 WebDAV 地址')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-4 space-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>用户名</span>
                  <div className="flex items-center gap-1">
                    <code className="text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">{user?.email}</code>
                    <button onClick={() => copyToClipboard(user?.email || '', '已复制邮箱')}>
                      <Copy className="h-3.5 w-3.5 hover:text-foreground transition-colors" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>密码</span>
                  <span className="text-xs">您的登录密码</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                支持 macOS Finder、Windows 资源管理器、Cyberduck、Mountain Duck 等客户端
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === 'email' && (
        <>
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Mail className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <CardTitle className="text-base">邮箱设置</CardTitle>
                  <CardDescription>管理您的邮箱地址和通知偏好</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">当前邮箱</label>
                <div className="flex items-center gap-2">
                  <Input value={user?.email || ''} disabled className="flex-1" />
                  {user?.emailVerified ? (
                    <span className="text-xs text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> 已验证
                    </span>
                  ) : (
                    <span className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> 未验证
                    </span>
                  )}
                </div>
              </div>

              {!user?.emailVerified && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <p className="text-sm text-amber-900">
                    您的邮箱尚未验证，部分功能受限。
                    <button
                      onClick={() => {
                        authApi
                          .resendVerification({ email: user?.email || '' })
                          .then(() => toast({ title: '验证邮件已发送' }))
                          .catch((e) =>
                            toast({
                              title: '发送失败',
                              description: e.response?.data?.error?.message,
                              variant: 'destructive',
                            })
                          );
                      }}
                      className="text-primary hover:underline ml-1"
                    >
                      重发验证邮件
                    </button>
                  </p>
                </div>
              )}

              <div className="pt-4 border-t">
                <h4 className="text-sm font-medium mb-3">更换邮箱</h4>
                <p className="text-xs text-muted-foreground mb-3">更换邮箱后需要重新验证，新邮箱将作为登录账号</p>
                <EmailChangeForm />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Mail className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-base">邮件通知偏好</CardTitle>
                  <CardDescription>选择您希望接收的邮件通知类型</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <EmailPreferencesForm />
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === 'security' && (
        <>
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Lock className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <CardTitle className="text-base">修改密码</CardTitle>
                  <CardDescription>定期更换密码以保证账户安全</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">当前密码</label>
                <div className="relative">
                  <Input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    placeholder="输入当前密码"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCurrentPw((v) => !v)}
                  >
                    {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">新密码</label>
                <div className="relative">
                  <Input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="至少 6 个字符"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowNewPw((v) => !v)}
                  >
                    {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {newPw && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3].map((lvl) => (
                        <div
                          key={lvl}
                          className={cn(
                            'h-1 flex-1 rounded-full transition-colors',
                            strength.level >= lvl ? strength.color : 'bg-secondary'
                          )}
                        />
                      ))}
                    </div>
                    <p className={cn('text-xs', strength.color.replace('bg-', 'text-'))}>密码强度：{strength.label}</p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">确认新密码</label>
                <Input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="再次输入新密码"
                  className={cn(pwMatch && 'border-red-500 focus-visible:ring-red-500')}
                />
                {pwMatch && <p className="text-xs text-red-500">两次输入的密码不一致</p>}
                {newPw && confirmPw && !pwMatch && (
                  <p className="text-xs text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> 密码一致
                  </p>
                )}
              </div>

              <Button
                onClick={() => updatePasswordMutation.mutate()}
                disabled={
                  !currentPw ||
                  !newPw ||
                  !confirmPw ||
                  !!pwMatch ||
                  newPw.length < 6 ||
                  updatePasswordMutation.isPending
                }
              >
                {updatePasswordMutation.isPending ? '更新中…' : '更新密码'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Shield className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <CardTitle className="text-base">登录设备</CardTitle>
                  <CardDescription>管理已登录的设备</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {devicesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : devices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">暂无已登录设备</div>
              ) : (
                <div className="space-y-3">
                  {devices.map((device) => {
                    const DeviceIcon = getDeviceIcon(device.userAgent || '');
                    const browser = getBrowserName(device.userAgent || '');
                    const os = getOSName(device.userAgent || '');
                    const isCurrent = device.id === currentDeviceId;

                    return (
                      <div
                        key={device.id}
                        className={cn(
                          'flex items-center gap-4 p-4 rounded-lg border transition-colors',
                          isCurrent ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'
                        )}
                      >
                        <div
                          className={cn(
                            'w-10 h-10 rounded-lg flex items-center justify-center',
                            isCurrent ? 'bg-primary/10' : 'bg-muted'
                          )}
                        >
                          <DeviceIcon className={cn('h-5 w-5', isCurrent ? 'text-primary' : 'text-muted-foreground')} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {browser} · {os}
                            </span>
                            {isCurrent && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                                当前设备
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            {device.ipAddress && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {device.ipAddress}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(device.lastActive)}
                            </span>
                          </div>
                        </div>

                        {!isCurrent && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                            onClick={() => {
                              if (confirm('确定要注销此设备吗？')) {
                                deleteDeviceMutation.mutate(device.id);
                              }
                            }}
                            disabled={deleteDeviceMutation.isPending}
                          >
                            <TrashIcon className="h-4 w-4 mr-1" />
                            注销
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mt-4">
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  如果发现陌生设备登录，请立即修改密码并注销该设备
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-500/30">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                <div>
                  <CardTitle className="text-base text-red-500">危险区域</CardTitle>
                  <CardDescription>不可撤销的操作，请谨慎</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!deleteConfirmOpen ? (
                <div className="flex items-center justify-between p-4 border border-red-500/20 rounded-lg bg-red-500/5">
                  <div>
                    <p className="text-sm font-medium">注销账户</p>
                    <p className="text-xs text-muted-foreground mt-0.5">永久删除账户及所有文件，此操作不可撤销</p>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteConfirmOpen(true)}>
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    注销账户
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 p-4 border border-red-500/30 rounded-lg bg-red-500/5">
                  <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <p>此操作将永久删除您的账户、所有文件和分享链接，且不可恢复。请输入密码确认。</p>
                  </div>
                  <Input
                    type="password"
                    placeholder="输入密码确认注销"
                    value={deletePw}
                    onChange={(e) => setDeletePw(e.target.value)}
                    className="border-red-500/50 focus-visible:ring-red-500"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDeleteConfirmOpen(false);
                        setDeletePw('');
                      }}
                    >
                      取消
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!deletePw || deleteAccountMutation.isPending}
                      onClick={() => deleteAccountMutation.mutate()}
                    >
                      {deleteAccountMutation.isPending ? '注销中…' : '确认永久注销'}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === 'ai' && (
        <Card>
          <CardContent className="pt-6">
            <AISettings />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
