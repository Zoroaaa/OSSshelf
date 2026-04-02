/**
 * ResetPassword.tsx
 * 重置密码页面
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/services/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { Lock, Eye, EyeOff, CheckCircle2, Loader2 } from 'lucide-react';

export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!token) {
      toast({
        title: '无效链接',
        description: '缺少重置Token，请重新申请',
        variant: 'destructive',
      });
      navigate('/forgot-password');
    }
  }, [token, navigate, toast]);

  const resetMutation = useMutation({
    mutationFn: () => authApi.resetPassword({ token: token!, newPassword }),
    onSuccess: () => {
      toast({
        title: '密码重置成功',
        description: '请使用新密码登录',
      });
      setTimeout(() => {
        navigate('/login');
      }, 1500);
    },
    onError: (error: any) => {
      toast({
        title: '重置失败',
        description: error.response?.data?.error?.message || '请重试',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 6) {
      toast({
        title: '密码格式错误',
        description: '密码至少需要6个字符',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: '密码不匹配',
        description: '两次输入的密码不一致',
        variant: 'destructive',
      });
      return;
    }

    resetMutation.mutate();
  };

  const pwStrength = (pw: string): { level: number; label: string; color: string } => {
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

  const strength = pwStrength(newPassword);

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="flex justify-center mb-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-primary" />
          </div>
        </div>
        <CardTitle>重置密码</CardTitle>
        <CardDescription>设置您的新密码</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="newPassword" className="text-sm font-medium">
              新密码
            </label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="至少6个字符"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {newPassword && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3].map((lvl) => (
                    <div
                      key={lvl}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        strength.level >= lvl ? strength.color : 'bg-secondary'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">密码强度：{strength.label}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              确认密码
            </label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="再次输入新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-destructive">两次输入的密码不一致</p>
            )}
            {newPassword && confirmPassword && newPassword === confirmPassword && (
              <p className="text-xs text-emerald-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> 密码一致
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full"
            disabled={!newPassword || !confirmPassword || newPassword !== confirmPassword || resetMutation.isPending}
          >
            {resetMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                重置中...
              </>
            ) : (
              '重置密码'
            )}
          </Button>
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground text-center">
            返回登录
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
