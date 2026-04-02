/**
 * ResetPassword.tsx
 * 重置密码页面（6位验证码版本）
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/services/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { Lock, Eye, EyeOff, CheckCircle2, Loader2, ArrowLeft, RefreshCw } from 'lucide-react';

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const emailFromState = (location.state as { email?: string })?.email || '';
  const [email, setEmail] = useState(emailFromState);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!email) {
      toast({
        title: '缺少邮箱信息',
        description: '请先通过忘记密码页面获取验证码',
        variant: 'destructive',
      });
      navigate('/forgot-password');
    }
  }, [email, navigate, toast]);

  const resetMutation = useMutation({
    mutationFn: () =>
      authApi.resetPassword({
        email,
        code: code.join(''),
        newPassword,
      }),
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
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => authApi.forgotPassword({ email }),
    onSuccess: () => {
      toast({
        title: '发送成功',
        description: '新的验证码已发送到您的邮箱',
      });
      startCountdown(60);
    },
    onError: (error: any) => {
      toast({
        title: '发送失败',
        description: error.response?.data?.error?.message || '请稍后重试',
        variant: 'destructive',
      });
    },
  });

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast({
        title: '请输入邮箱',
        description: '请先获取验证码',
        variant: 'destructive',
      });
      return;
    }

    if (code.some((d) => !d)) {
      toast({
        title: '请输入完整验证码',
        description: '请输入6位数字验证码',
        variant: 'destructive',
      });
      return;
    }

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

  const handleResend = () => {
    resendMutation.mutate();
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
        <CardDescription>输入验证码并设置新密码</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">邮箱地址</label>
            <Input type="email" value={email} disabled className="bg-muted/50" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">验证码</label>
            <div className="flex gap-2 justify-center">
              {code.map((digit, index) => (
                <Input
                  key={index}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={index === 0 ? handlePaste : undefined}
                  className="w-12 h-12 text-center text-xl font-semibold"
                />
              ))}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">验证码有效期为10分钟</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-xs text-muted-foreground hover:text-primary"
                disabled={countdown > 0 || resendMutation.isPending}
                onClick={handleResend}
              >
                {resendMutation.isPending ? (
                  '发送中...'
                ) : countdown > 0 ? (
                  `${countdown}秒后重发`
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    重新发送
                  </>
                )}
              </Button>
            </div>
          </div>

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

          {resetMutation.isError && (
            <div className="flex items-center gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded-md">
              验证码错误或已过期，请重新获取
            </div>
          )}

          {resetMutation.isSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm p-3 bg-emerald-500/10 rounded-md">
              密码重置成功！正在跳转到登录页...
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="submit"
            className="w-full"
            disabled={
              !email ||
              code.some((d) => !d) ||
              !newPassword ||
              !confirmPassword ||
              newPassword !== confirmPassword ||
              resetMutation.isPending
            }
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
          <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground text-center flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" />
            返回忘记密码
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
