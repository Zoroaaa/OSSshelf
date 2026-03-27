/**
 * Register.tsx
 * 注册页面
 *
 * 功能:
 * - 用户注册
 * - 邀请码验证
 * - 注册配置检查
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { useToast } from '@/components/ui/useToast';
import { KeyRound, AlertTriangle, Loader2 } from 'lucide-react';

export default function Register() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [regError, setRegError] = useState<'closed' | 'invite_required' | 'invite_invalid' | 'invite_used' | null>(
    null
  );

  const { data: regConfig, isLoading: configLoading } = useQuery({
    queryKey: ['registration-config'],
    queryFn: () => authApi.getRegistrationConfig().then((r) => r.data.data),
    retry: false,
  });

  const registerMutation = useMutation({
    mutationFn: () =>
      authApi.register({
        email,
        password,
        name: name || undefined,
        inviteCode: inviteCode.trim().toUpperCase() || undefined,
      } as any),
    onSuccess: (response) => {
      if (response.data.success && response.data.data) {
        setAuth(response.data.data.user, response.data.data.token);
        navigate('/files');
      }
    },
    onError: (error: any) => {
      const code = error.response?.data?.error?.code;
      if (code === 'REGISTRATION_CLOSED') {
        setRegError('closed');
        return;
      }
      if (code === 'INVITE_CODE_REQUIRED') {
        setRegError('invite_required');
        return;
      }
      if (code === 'INVITE_CODE_INVALID') {
        setRegError('invite_invalid');
        return;
      }
      if (code === 'INVITE_CODE_USED') {
        setRegError('invite_used');
        return;
      }
      setRegError(null);
      toast({
        title: '注册失败',
        description: error.response?.data?.error?.message || '请检查输入信息',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: '密码不匹配', description: '请确保两次输入的密码一致', variant: 'destructive' });
      return;
    }
    if (regConfig?.requireInviteCode && !inviteCode.trim()) {
      setRegError('invite_required');
      return;
    }
    setRegError(null);
    registerMutation.mutate();
  };

  useEffect(() => {
    if (regConfig && !regConfig.open) {
      setRegError('closed');
    }
  }, [regConfig]);

  if (configLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (regError === 'closed' || regConfig?.open === false) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
          </div>
          <CardTitle>注册已关闭</CardTitle>
          <CardDescription>当前系统不开放新用户注册，请联系管理员获取访问权限。</CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-center">
          <Link to="/login" className="text-sm text-primary hover:underline">
            返回登录
          </Link>
        </CardFooter>
      </Card>
    );
  }

  const needsInviteCode = regConfig?.requireInviteCode || regError === 'invite_required';
  const showInviteCodeField = needsInviteCode || inviteCode;

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>注册</CardTitle>
        <CardDescription>创建一个新账号开始使用</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              昵称（可选）
            </label>
            <Input
              id="name"
              type="text"
              placeholder="您的昵称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              邮箱
            </label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              密码
            </label>
            <Input
              id="password"
              type="password"
              placeholder="至少6个字符"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              确认密码
            </label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="再次输入密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {showInviteCodeField && (
            <div className="space-y-2">
              <label htmlFor="inviteCode" className="text-sm font-medium flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                邀请码
                {needsInviteCode && <span className="text-destructive text-xs ml-1">（必填）</span>}
              </label>
              <Input
                id="inviteCode"
                type="text"
                placeholder="XXXX-XXXX-XXXX"
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value.toUpperCase());
                  setRegError(null);
                }}
                className={
                  regError === 'invite_required' || regError === 'invite_invalid' || regError === 'invite_used'
                    ? 'border-destructive'
                    : ''
                }
                autoFocus={needsInviteCode}
                maxLength={14}
                required={needsInviteCode}
              />
              {regError === 'invite_required' && (
                <p className="text-xs text-destructive">此系统需要邀请码才能注册，请向管理员获取</p>
              )}
              {regError === 'invite_invalid' && (
                <p className="text-xs text-destructive">邀请码无效或已过期，请检查后重试</p>
              )}
              {regError === 'invite_used' && (
                <p className="text-xs text-destructive">邀请码已被使用，请使用其他邀请码</p>
              )}
            </div>
          )}

          {!needsInviteCode && !showInviteCodeField && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => setInviteCode(' ')}
            >
              <KeyRound className="h-3 w-3" />
              我有邀请码
            </button>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
            {registerMutation.isPending ? '注册中...' : '注册'}
          </Button>
          <p className="text-sm text-muted-foreground">
            已有账号？{' '}
            <Link to="/login" className="text-primary hover:underline">
              立即登录
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
