/**
 * Login.tsx
 * 登录页面
 *
 * 功能:
 * - 用户登录
 * - 登录失败锁定提示
 * - 跳转注册页面
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth';
import { authApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { useToast } from '@/components/ui/useToast';

export default function Login() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: () => authApi.login({ email, password }),
    onSuccess: (response) => {
      if (response.data.success && response.data.data) {
        setAuth(response.data.data.user, response.data.data.token);
        navigate('/files');
      }
    },
    onError: (error: any) => {
      toast({
        title: '登录失败',
        description: error.response?.data?.error?.message || '请检查邮箱和密码',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate();
  };

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>登录</CardTitle>
        <CardDescription>输入您的邮箱和密码登录系统</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
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
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex items-center justify-end">
            <Link to="/forgot-password" className="text-sm text-primary hover:underline">
              忘记密码？
            </Link>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? '登录中...' : '登录'}
          </Button>
          <p className="text-sm text-muted-foreground">
            还没有账号？{' '}
            <Link to="/register" className="text-primary hover:underline">
              立即注册
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
