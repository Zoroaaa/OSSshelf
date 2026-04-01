/**
 * WebhookCreateDialog.tsx
 * 创建 Webhook 弹窗组件
 */

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { webhooksApi, type WebhookEvent } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { Loader2, X, Check, Copy } from 'lucide-react';
import { cn } from '@/utils';

interface WebhookCreateDialogProps {
  events: WebhookEvent[];
  onClose: () => void;
  onCreated: () => void;
}

const WebhookCreateDialog: React.FC<WebhookCreateDialogProps> = ({ events, onClose, onCreated }) => {
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [customSecret, setCustomSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: { url: string; events: string[]; secret?: string }) =>
      webhooksApi.create(data).then((r) => r.data),
    onSuccess: (response) => {
      if (response.data?.secret) {
        setCreatedSecret(response.data.secret);
      } else {
        toast({ title: 'Webhook 已创建' });
        onCreated();
      }
    },
    onError: (e: any) => {
      const message = e.response?.data?.error?.message;
      if (message) {
        toast({ title: '创建失败', description: message, variant: 'destructive' });
      } else {
        toast({ title: '创建失败', variant: 'destructive' });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!url.trim()) {
      newErrors.url = 'URL 不能为空';
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
      newErrors.url = 'URL 必须以 http:// 或 https:// 开头';
    }

    if (selectedEvents.length === 0) {
      newErrors.events = '至少选择一个事件';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    createMutation.mutate({
      url: url.trim(),
      events: selectedEvents,
      secret: customSecret.trim() || undefined,
    });
  };

  const toggleEvent = (eventValue: string) => {
    setSelectedEvents((prev) => {
      if (eventValue === '*') {
        return prev.includes('*') ? [] : ['*'];
      }
      if (prev.includes('*')) {
        return [eventValue];
      }
      return prev.includes(eventValue) ? prev.filter((e) => e !== eventValue) : [...prev, eventValue];
    });
    setErrors((prev) => ({ ...prev, events: '' }));
  };

  const copySecret = () => {
    if (createdSecret) {
      navigator.clipboard.writeText(createdSecret);
      toast({ title: '已复制到剪贴板' });
    }
  };

  const handleDone = () => {
    toast({ title: 'Webhook 已创建' });
    onCreated();
  };

  if (createdSecret) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-card rounded-lg shadow-lg w-full max-w-md mx-4">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-lg font-semibold">Webhook 已创建</h2>
          </div>

          <div className="p-4 space-y-4">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <p className="text-sm font-medium text-amber-500 mb-2">请保存您的密钥</p>
              <p className="text-xs text-muted-foreground">
                此密钥仅显示一次。您需要用它来验证 Webhook 请求的签名。请妥善保存。
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Webhook 密钥</label>
              <div className="flex gap-2">
                <Input value={createdSecret} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copySecret}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="p-3 bg-muted/30 rounded-lg text-xs space-y-1">
              <p className="font-medium">验证签名示例：</p>
              <code className="block text-muted-foreground">X-Webhook-Signature = HMAC-SHA256(secret, body)</code>
            </div>
          </div>

          <div className="p-4 border-t">
            <Button className="w-full" onClick={handleDone}>
              <Check className="h-4 w-4 mr-1" />
              我已保存密钥
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">创建 Webhook</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              回调 URL <span className="text-destructive">*</span>
            </label>
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setErrors((prev) => ({ ...prev, url: '' }));
              }}
              placeholder="https://example.com/webhook"
              className={cn(errors.url && 'border-destructive')}
            />
            {errors.url && <p className="text-xs text-destructive">{errors.url}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              订阅事件 <span className="text-destructive">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {events.map((event) => (
                <button
                  key={event.value}
                  type="button"
                  onClick={() => toggleEvent(event.value)}
                  className={cn(
                    'flex flex-col items-start p-2 rounded-md border text-left transition-colors',
                    selectedEvents.includes(event.value) ? 'bg-primary/10 border-primary' : 'hover:bg-muted'
                  )}
                >
                  <span className="text-sm font-medium">{event.label}</span>
                  <span className="text-xs text-muted-foreground">{event.description}</span>
                </button>
              ))}
            </div>
            {errors.events && <p className="text-xs text-destructive">{errors.events}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">自定义密钥（可选）</label>
            <Input
              value={customSecret}
              onChange={(e) => setCustomSecret(e.target.value)}
              placeholder="留空将自动生成"
              type="password"
            />
            <p className="text-xs text-muted-foreground">密钥至少 8 个字符，用于验证请求签名</p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              创建
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WebhookCreateDialog;
