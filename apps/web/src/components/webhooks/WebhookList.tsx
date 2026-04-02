/**
 * WebhookList.tsx
 * Webhook 列表组件
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { webhooksApi } from '@/services/api';
import { useToast } from '@/components/ui/useToast';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import {
  Webhook,
  Plus,
  Trash2,
  Play,
  Power,
  PowerOff,
  Loader2,
  ExternalLink,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import WebhookCreateDialog from './WebhookCreateDialog';

const WebhookList: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);

  const { data: webhooks, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => webhooksApi.list().then((r) => r.data.data),
  });

  const { data: events } = useQuery({
    queryKey: ['webhook-events'],
    queryFn: () => webhooksApi.getEvents().then((r) => r.data.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => webhooksApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Webhook 已删除' });
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (e: any) => {
      toast({
        title: '删除失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => webhooksApi.update(id, { isActive }),
    onSuccess: () => {
      toast({ title: '状态已更新' });
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => webhooksApi.test(id),
    onSuccess: () => {
      toast({ title: '测试事件已发送' });
      setTestId(null);
    },
    onError: (e: any) => {
      toast({
        title: '测试失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
      setTestId(null);
    },
  });

  const handleDelete = (id: string, url: string) => {
    if (!confirm(`确定要删除此 Webhook 吗？\n${url}`)) return;
    deleteMutation.mutate(id);
  };

  const handleToggle = (id: string, currentStatus: boolean) => {
    toggleMutation.mutate({ id, isActive: !currentStatus });
  };

  const handleTest = (id: string) => {
    setTestId(id);
    testMutation.mutate(id);
  };

  const getEventLabel = (eventValue: string): string => {
    if (eventValue === '*') return '所有事件';
    const event = events?.find((e) => e.value === eventValue);
    return event?.label ?? eventValue;
  };

  const getStatusIcon = (status: number | null) => {
    if (status === null) return <span className="text-muted-foreground">-</span>;
    if (status >= 200 && status < 300) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Webhooks</h2>
          <p className="text-sm text-muted-foreground mt-1">配置 Webhook 以接收文件系统事件通知</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          创建 Webhook
        </Button>
      </div>

      {!webhooks || webhooks.length === 0 ? (
        <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed">
          <Webhook className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">暂无 Webhook</p>
          <p className="text-sm text-muted-foreground mt-1">创建 Webhook 以接收事件通知</p>
          <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            创建第一个 Webhook
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((hook) => (
            <div
              key={hook.id}
              className={cn('bg-card rounded-lg border p-4 transition-colors', !hook.isActive && 'opacity-60')}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={hook.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline flex items-center gap-1"
                    >
                      {hook.url}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {!hook.isActive && (
                      <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">已禁用</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {hook.events.map((event) => (
                      <span key={event} className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">
                        {getEventLabel(event)}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {getStatusIcon(hook.lastStatus)}
                      上次状态: {hook.lastStatus ?? '未发送'}
                    </span>
                    <span>创建于 {new Date(hook.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest(hook.id)}
                    disabled={testMutation.isPending && testId === hook.id}
                  >
                    {testMutation.isPending && testId === hook.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggle(hook.id, hook.isActive)}
                    disabled={toggleMutation.isPending}
                  >
                    {hook.isActive ? (
                      <PowerOff className="h-4 w-4 text-amber-500" />
                    ) : (
                      <Power className="h-4 w-4 text-green-500" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(hook.id, hook.url)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isCreateOpen && (
        <WebhookCreateDialog
          events={events ?? []}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['webhooks'] });
          }}
        />
      )}
    </div>
  );
};

export default WebhookList;
