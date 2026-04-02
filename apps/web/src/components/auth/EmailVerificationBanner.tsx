/**
 * EmailVerificationBanner.tsx
 * 邮箱验证提示横幅
 */

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { AlertTriangle } from 'lucide-react';

export function EmailVerificationBanner() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [closed, setClosed] = useState(false);

  const resendMutation = useMutation({
    mutationFn: () => authApi.resendVerification({ email: user?.email || '' }),
    onSuccess: () => {
      toast({
        title: '验证邮件已发送',
        description: '请查收邮件并点击验证链接',
      });
    },
    onError: (error: any) => {
      toast({
        title: '发送失败',
        description: error.response?.data?.error?.message || '请稍后重试',
        variant: 'destructive',
      });
    },
  });

  if (!user || user.emailVerified || closed) {
    return null;
  }

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3">
      <div className="flex items-center justify-between max-w-7xl mx-auto gap-4">
        <div className="flex items-center gap-3 flex-1">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <span className="text-sm font-medium text-amber-900">邮箱未验证</span>
            <span className="text-xs text-amber-700">部分功能受限，请验证邮箱以解锁全部功能</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => resendMutation.mutate()}
            disabled={resendMutation.isPending}
            className="border-amber-600 text-amber-900 hover:bg-amber-600/20"
          >
            {resendMutation.isPending ? '发送中...' : '重发验证邮件'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setClosed(true)}
            className="text-amber-700 hover:text-amber-900"
          >
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
