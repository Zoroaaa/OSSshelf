/**
 * EmailConfig.tsx
 * 管理面板 - 邮件服务配置
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/services/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { Loader2, Mail, Send, Save, TestTube, Users } from 'lucide-react';

export function EmailConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [apiKey, setApiKey] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [testEmail, setTestEmail] = useState('');

  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastFilter, setBroadcastFilter] = useState<'all' | 'admin' | 'user'>('all');

  const { data: configData, isLoading } = useQuery({
    queryKey: ['admin', 'email', 'config'],
    queryFn: () => adminApi.getEmailConfig(),
  });

  useEffect(() => {
    if (configData?.data.data) {
      setFromAddress(configData.data.data.fromAddress || '');
      setFromName(configData.data.data.fromName || '');
    }
  }, [configData]);

  const saveMutation = useMutation({
    mutationFn: () => adminApi.setEmailConfig({ apiKey, fromAddress, fromName }),
    onSuccess: () => {
      toast({ title: '保存成功', description: '邮件配置已更新' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'email', 'config'] });
    },
    onError: (error: any) => {
      toast({
        title: '保存失败',
        description: error.response?.data?.error?.message || '请检查配置',
        variant: 'destructive',
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => adminApi.testEmail({ to: testEmail || undefined }),
    onSuccess: () => {
      toast({ title: '测试邮件已发送', description: '请检查收件箱' });
    },
    onError: (error: any) => {
      toast({
        title: '发送失败',
        description: error.response?.data?.error?.message || '请检查配置',
        variant: 'destructive',
      });
    },
  });

  const broadcastMutation = useMutation({
    mutationFn: () =>
      adminApi.broadcastEmail({
        subject: broadcastSubject,
        body: broadcastBody,
        userFilter: broadcastFilter === 'all' ? undefined : { role: broadcastFilter },
      }),
    onSuccess: (data) => {
      const result = data.data.data;
      if (result) {
        toast({
          title: '群发完成',
          description: `成功: ${result.successCount}, 失败: ${result.failCount}`,
        });
      }
      setBroadcastSubject('');
      setBroadcastBody('');
    },
    onError: (error: any) => {
      toast({
        title: '群发失败',
        description: error.response?.data?.error?.message || '请重试',
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isConfigured = configData?.data?.data?.configured;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">邮件服务配置</h2>
        <p className="text-muted-foreground">配置Resend邮件服务，实现邮件验证、密码重置等功能</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Resend API 配置
          </CardTitle>
          <CardDescription>
            获取API Key:
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline ml-1"
            >
              https://resend.com/api-keys
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="apiKey" className="text-sm font-medium">
              API Key {isConfigured && <span className="text-emerald-600">(已配置)</span>}
            </label>
            <Input
              id="apiKey"
              type="password"
              placeholder="re_xxxxxxxxxxxx"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isConfigured ? '留空保持现有配置，输入新值将覆盖' : '从Resend控制台获取API Key'}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="fromAddress" className="text-sm font-medium">
              发件人地址
            </label>
            <Input
              id="fromAddress"
              type="email"
              placeholder="noreply@yourdomain.com"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">必须是在Resend中验证过的域名邮箱</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="fromName" className="text-sm font-medium">
              发件人名称
            </label>
            <Input
              id="fromName"
              placeholder="OSSShelf"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
          </div>

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || (!apiKey && !isConfigured) || !fromAddress}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                保存配置
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {isConfigured && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TestTube className="h-5 w-5" />
                发送测试邮件
              </CardTitle>
              <CardDescription>验证邮件服务是否正常工作</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="testEmail" className="text-sm font-medium">
                  收件人地址（可选）
                </label>
                <Input
                  id="testEmail"
                  type="email"
                  placeholder="留空则发送到当前管理员邮箱"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                />
              </div>

              <Button onClick={() => testMutation.mutate()} disabled={testMutation.isPending} variant="outline">
                {testMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    发送中...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    发送测试邮件
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                群发系统公告
              </CardTitle>
              <CardDescription>向所有用户或特定角色用户发送邮件通知</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="broadcastFilter" className="text-sm font-medium">
                  目标用户
                </label>
                <select
                  id="broadcastFilter"
                  value={broadcastFilter}
                  onChange={(e) => setBroadcastFilter(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  <option value="all">所有用户</option>
                  <option value="admin">仅管理员</option>
                  <option value="user">仅普通用户</option>
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="broadcastSubject" className="text-sm font-medium">
                  邮件主题
                </label>
                <Input
                  id="broadcastSubject"
                  placeholder="系统公告标题"
                  value={broadcastSubject}
                  onChange={(e) => setBroadcastSubject(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="broadcastBody" className="text-sm font-medium">
                  邮件内容
                </label>
                <textarea
                  id="broadcastBody"
                  placeholder="邮件正文内容..."
                  value={broadcastBody}
                  onChange={(e) => setBroadcastBody(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border rounded-md bg-background resize-none"
                />
              </div>

              <Button
                onClick={() => broadcastMutation.mutate()}
                disabled={broadcastMutation.isPending || !broadcastSubject || !broadcastBody}
                variant="outline"
              >
                {broadcastMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    发送中...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    发送群发邮件
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {!isConfigured && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-amber-900">邮件服务未配置</p>
                <p className="text-sm text-amber-700">
                  请先配置Resend API Key和发件人地址，然后保存配置。配置完成后即可使用：
                </p>
                <ul className="text-sm text-amber-700 list-disc list-inside space-y-1">
                  <li>注册邮箱验证</li>
                  <li>忘记密码重置</li>
                  <li>更换邮箱确认</li>
                  <li>系统通知邮件</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
