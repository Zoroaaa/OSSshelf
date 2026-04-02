/**
 * VerifyEmail.tsx
 * 验证邮箱落地页
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { Card, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { isAuthenticated, initialize } = useAuthStore();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('缺少验证Token');
      return;
    }

    authApi
      .verifyEmail(token)
      .then(async (response) => {
        if (response.data.success) {
          setStatus('success');
          setMessage('邮箱验证成功！');

          // 如果用户已登录，刷新用户信息
          if (isAuthenticated) {
            await initialize();
          }

          setTimeout(() => {
            navigate(isAuthenticated ? '/' : '/login');
          }, 2000);
        } else {
          setStatus('error');
          setMessage(response.data.error?.message || '验证失败');
        }
      })
      .catch((error) => {
        setStatus('error');
        setMessage(error.response?.data?.error?.message || '验证失败，请重试');
      });
  }, [token, navigate, isAuthenticated, initialize]);

  return (
    <Card className="max-w-md mx-auto">
      <CardContent className="pt-6">
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">正在验证邮箱...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="text-center">验证成功</CardTitle>
            <CardDescription className="text-center">{message}</CardDescription>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="text-center">验证失败</CardTitle>
            <CardDescription className="text-center">{message}</CardDescription>
            <Button className="mt-4" onClick={() => navigate('/login')}>
              返回登录
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
