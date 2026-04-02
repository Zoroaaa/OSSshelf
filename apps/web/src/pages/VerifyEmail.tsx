/**
 * VerifyEmail.tsx
 * 邮箱验证码输入页面（6位验证码）
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { Mail, ArrowLeft, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';

export default function VerifyEmail() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { initialize } = useAuthStore();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [countdown, setCountdown] = useState(0);

  const verifyMutation = useMutation({
    mutationFn: () =>
      authApi.verifyCode({
        email,
        code: code.join(''),
        type: 'verify_email',
      }),
    onSuccess: async (response) => {
      if (response.data.success) {
        toast({
          title: '验证成功',
          description: '邮箱验证成功！',
        });
        await initialize();
        setTimeout(() => {
          navigate('/');
        }, 1500);
      }
    },
    onError: (error: any) => {
      toast({
        title: '验证失败',
        description: error.response?.data?.error?.message || '验证失败，请重试',
        variant: 'destructive',
      });
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => authApi.resendVerification({ email }),
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

    if (e.key === 'Enter' && code.every((d) => d)) {
      handleVerify();
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
    if (!email) {
      toast({
        title: '请输入邮箱',
        description: '请输入您的注册邮箱地址',
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

    verifyMutation.mutate();
  };

  const handleResend = () => {
    if (!email) {
      toast({
        title: '请输入邮箱',
        description: '请先输入您的邮箱地址',
        variant: 'destructive',
      });
      return;
    }
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

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Mail className="h-6 w-6 text-primary" />
          </div>
        </div>
        <CardTitle>验证邮箱</CardTitle>
        <CardDescription>请输入发送到您邮箱的6位验证码</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
                className="w-12 h-14 text-center text-xl font-semibold"
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">验证码有效期为10分钟</p>
        </div>

        {verifyMutation.isError && (
          <div className="flex items-center gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded-md">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            <span>验证码错误或已过期，请重新获取</span>
          </div>
        )}

        {verifyMutation.isSuccess && (
          <div className="flex items-center gap-2 text-emerald-600 text-sm p-3 bg-emerald-500/10 rounded-md">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            <span>邮箱验证成功！正在跳转...</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Button
          className="w-full"
          disabled={!email || code.some((d) => !d) || verifyMutation.isPending}
          onClick={handleVerify}
        >
          {verifyMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              验证中...
            </>
          ) : (
            '验证'
          )}
        </Button>

        <Button
          variant="outline"
          className="w-full"
          disabled={!email || countdown > 0 || resendMutation.isPending}
          onClick={handleResend}
        >
          {resendMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              发送中...
            </>
          ) : countdown > 0 ? (
            `${countdown}秒后重新发送`
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              重新发送验证码
            </>
          )}
        </Button>

        <button
          onClick={() => navigate('/login')}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto"
        >
          <ArrowLeft className="h-3 w-3" />
          返回登录
        </button>
      </CardFooter>
    </Card>
  );
}
