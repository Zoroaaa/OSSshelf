/**
 * ForgotPassword.tsx
 * 忘记密码页面（6位验证码版本）
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/services/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { Mail, ArrowLeft, Loader2 } from 'lucide-react';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const forgotMutation = useMutation({
    mutationFn: () => authApi.forgotPassword({ email }),
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (error: any) => {
      toast({
        title: '发送失败',
        description: error.response?.data?.error?.message || '请稍后重试',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({
        title: '请输入邮箱',
        description: '请输入您的注册邮箱地址',
        variant: 'destructive',
      });
      return;
    }
    forgotMutation.mutate();
  };

  const handleGoToReset = () => {
    navigate('/reset-password', { state: { email } });
  };

  if (submitted) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Mail className="h-6 w-6 text-white" />
            </div>
          </div>
          <CardTitle>验证码已发送</CardTitle>
          <CardDescription>如果邮箱存在，您将收到密码重置验证码</CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">请检查您的邮箱（包括垃圾邮件文件夹）</p>
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <p className="text-xs text-muted-foreground">发送到：</p>
            <p className="text-sm font-medium break-all">{email}</p>
            <p className="text-xs text-muted-foreground">验证码有效期为10分钟</p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button className="w-full" onClick={handleGoToReset}>
            输入验证码并重置密码
          </Button>
          <Link
            to="/login"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto"
          >
            <ArrowLeft className="h-3 w-3" />
            返回登录
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="flex justify-center mb-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Mail className="h-6 w-6 text-primary" />
          </div>
        </div>
        <CardTitle>忘记密码</CardTitle>
        <CardDescription>输入您的邮箱地址获取重置验证码</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              邮箱地址
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
          <p className="text-xs text-muted-foreground">我们将向您的注册邮箱发送6位数字验证码</p>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={forgotMutation.isPending}>
            {forgotMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                发送中...
              </>
            ) : (
              '发送验证码'
            )}
          </Button>
          <Link
            to="/login"
            className="text-sm text-muted-foreground hover:text-foreground text-center flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" />
            返回登录
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
