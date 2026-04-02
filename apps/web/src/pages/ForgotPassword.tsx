/**
 * ForgotPassword.tsx
 * 忘记密码页面
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/services/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { Mail, ArrowLeft } from 'lucide-react';

export default function ForgotPassword() {
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

  if (submitted) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Mail className="h-6 w-6 text-white" />
            </div>
          </div>
          <CardTitle>邮件已发送</CardTitle>
          <CardDescription>如果邮箱存在，您将收到重置密码邮件</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground mb-4">请检查您的邮箱（包括垃圾邮件文件夹）</p>
          <p className="text-xs text-muted-foreground">邮件链接有效期为1小时</p>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Link to="/login" className="text-sm text-primary hover:underline">
            返回登录
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>忘记密码</CardTitle>
        <CardDescription>输入您的邮箱地址</CardDescription>
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
          <p className="text-xs text-muted-foreground">我们将向您的注册邮箱发送密码重置链接</p>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={forgotMutation.isPending}>
            {forgotMutation.isPending ? '发送中...' : '发送重置邮件'}
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
