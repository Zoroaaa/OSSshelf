/**
 * DeviceManager.tsx
 * 设备管理组件
 * 
 * 功能:
 * - 查看已登录设备
 * - 注销设备
 * - 显示设备信息
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/services/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/utils';
import { cn } from '@/utils';
import type { UserDevice } from '@osshelf/shared';
import {
  Monitor, Smartphone, Tablet, Laptop, Trash2, Loader2,
  CheckCircle2, AlertTriangle, MapPin, Clock,
} from 'lucide-react';

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

export function DeviceManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => authApi.devices().then((r) => r.data.data ?? []),
  });

  const deleteMutation = useMutation({
    mutationFn: (deviceId: string) => authApi.deleteDevice(deviceId),
    onSuccess: () => {
      toast({ title: '设备已注销' });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e: any) => toast({
      title: '注销失败',
      description: e.response?.data?.error?.message,
      variant: 'destructive',
    }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        暂无已登录设备
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {devices.map((device) => {
        const DeviceIcon = getDeviceIcon(device.userAgent || '');
        const browser = getBrowserName(device.userAgent || '');
        const os = getOSName(device.userAgent || '');
        const isCurrent = device.id === user?.id || device.lastActive === devices[0]?.lastActive;

        return (
          <div
            key={device.id}
            className={cn(
              'flex items-center gap-4 p-4 rounded-lg border transition-colors',
              isCurrent ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'
            )}
          >
            <div className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              isCurrent ? 'bg-primary/10' : 'bg-muted'
            )}>
              <DeviceIcon className={cn('h-5 w-5', isCurrent ? 'text-primary' : 'text-muted-foreground')} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  {browser} · {os}
                </span>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    当前设备
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
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
                    deleteMutation.mutate(device.id);
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                注销
              </Button>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <p className="text-xs text-amber-600 dark:text-amber-400">
          如果发现陌生设备登录，请立即修改密码并注销该设备
        </p>
      </div>
    </div>
  );
}
