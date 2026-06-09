/**
 * TeamInviteDialog.tsx — 团队邀请对话框
 *
 * 生成邀请链接，支持通过邮件或链接邀请成员加入团队
 */

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { teamsApi } from '@/services/collab';
import { Loader2, X, Link, Copy, Check, Mail } from 'lucide-react';
import { cn } from '@/utils';

interface TeamInviteDialogProps {
  teamId: string;
  teamName: string;
  onClose: () => void;
}

const TeamInviteDialog: React.FC<TeamInviteDialogProps> = ({ teamId, teamName, onClose }) => {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<'member' | 'guest'>('member');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: () =>
      teamsApi
        .createInvite(teamId, {
          role,
          email: email.trim() || undefined,
          message: message.trim() || undefined,
          expiresInDays,
        })
        .then((r) => r.data.data),
    onSuccess: (data) => {
      setInviteUrl(data?.inviteUrl ?? '');
      toast({ title: '邀请已生成' });
    },
    onError: (e: any) => {
      const msg = e.response?.data?.error?.message;
      toast({ title: '生成邀请失败', description: msg, variant: 'destructive' });
    },
  });

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: '复制失败', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-md mx-4">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">邀请成员</h2>
            <p className="text-sm text-muted-foreground">{teamName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!inviteUrl ? (
          /* 表单 */
          <form
            onSubmit={(e) => {
              e.preventDefault();
              inviteMutation.mutate();
            }}
            className="p-4 space-y-4"
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> 邀请邮箱（可选）
              </label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="留空则生成通用邀请链接" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">角色</label>
              <div className="flex gap-2">
                {[
                  { value: 'member' as const, label: '成员' },
                  { value: 'guest' as const, label: '访客' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRole(opt.value)}
                    className={cn(
                      'flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border',
                      role === opt.value ? 'bg-primary/10 text-primary border-primary/30' : 'hover:bg-muted'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">有效期（天）</label>
              <div className="flex gap-2">
                {[1, 7, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setExpiresInDays(d)}
                    className={cn(
                      'flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border',
                      expiresInDays === d ? 'bg-primary/10 text-primary border-primary/30' : 'hover:bg-muted'
                    )}
                  >
                    {d === 1 ? '1天' : d === 7 ? '7天' : '30天'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">附言（可选）</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="给被邀请者的留言..."
                className="w-full min-h-[60px] px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                maxLength={200}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Link className="h-4 w-4 mr-1" />
                )}
                生成邀请
              </Button>
            </div>
          </form>
        ) : (
          /* 结果：显示邀请链接 */
          <div className="p-4 space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <p className="text-sm font-medium text-green-600">✓ 邀请已生成</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-background border rounded font-mono truncate"
                />
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                将此链接发送给受邀者，或通过邮件直接发送（如已填写邮箱）。
              </p>
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setInviteUrl(null);
                  setCopied(false);
                }}
              >
                再生成一个
              </Button>
              <Button variant="outline" onClick={onClose}>
                完成
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamInviteDialog;
