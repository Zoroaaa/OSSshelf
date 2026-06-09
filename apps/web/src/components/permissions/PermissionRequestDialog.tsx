/**
 * PermissionRequestDialog.tsx
 * 权限申请表单对话框
 *
 * 功能:
 * - 填写申请原因、选择权限级别、可选目标团队
 * - 提交后调用 API 创建申请
 */

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Eye, Edit, Crown, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import { permissionRequestsApi, teamsApi } from '@/services/collab';
import { useQuery } from '@tanstack/react-query';

interface PermissionRequestDialogProps {
  fileId: string;
  fileName: string;
  onClose: () => void;
}

const PERMISSION_OPTIONS = [
  {
    value: 'read' as const,
    label: '只读',
    icon: Eye,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    desc: '查看和下载文件',
  },
  {
    value: 'write' as const,
    label: '读写',
    icon: Edit,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    desc: '查看、编辑、上传文件',
  },
  {
    value: 'admin' as const,
    label: '管理',
    icon: Crown,
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    desc: '完整权限，含权限管理',
  },
];

export const PermissionRequestDialog: React.FC<PermissionRequestDialogProps> = ({ fileId, fileName, onClose }) => {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [selectedPermission, setSelectedPermission] = useState<'read' | 'write' | 'admin'>('read');
  const [targetTeamId, setTargetTeamId] = useState<string>('');

  const { data: teamsData } = useQuery({
    queryKey: ['teams-list'],
    queryFn: () => teamsApi.list().then((r) => r.data.data),
  });

  const allTeams = teamsData ? [...(teamsData.owned || []), ...(teamsData.joined || [])] : [];

  const createMutation = useMutation({
    mutationFn: () =>
      permissionRequestsApi.create({
        fileId,
        requestedPermission: selectedPermission,
        reason: reason || undefined,
        targetTeamId: targetTeamId || undefined,
      }),
    onSuccess: () => {
      toast({ title: '申请已提交，请等待审批' });
      onClose();
    },
    onError: (e: any) => {
      toast({
        title: '提交失败',
        description: e.response?.data?.error?.message || '请稍后重试',
        variant: 'destructive',
      });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-5 w-5 text-primary shrink-0" />
            <h2 className="text-lg font-semibold truncate">申请访问权限</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* 文件信息 */}
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <span className="text-muted-foreground">目标文件：</span>
            <span className="font-medium break-all">{fileName}</span>
          </div>

          {/* 权限级别选择 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">权限级别</label>
            <div className="grid grid-cols-3 gap-2">
              {PERMISSION_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = selectedPermission === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedPermission(opt.value)}
                    className={cn(
                      'relative flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors text-left',
                      isSelected ? `${opt.bg} ${opt.border} ${opt.color}` : 'hover:bg-muted/50 border-border'
                    )}
                  >
                    <Icon className={cn('h-5 w-5', isSelected ? '' : 'text-muted-foreground')} />
                    <span className={cn('text-xs font-semibold', isSelected ? '' : 'text-muted-foreground')}>
                      {opt.label}
                    </span>
                    <span className="text-[11px] text-center leading-tight opacity-70">{opt.desc}</span>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-current opacity-60" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 目标团队（可选） */}
          {allTeams.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">
                目标团队
                <span className="text-xs text-muted-foreground font-normal">（可选）</span>
              </label>
              <select
                value={targetTeamId}
                onChange={(e) => setTargetTeamId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-md bg-background"
              >
                <option value="">不指定团队</option>
                {allTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 申请原因 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1">
              申请原因
              <span className="text-xs text-muted-foreground font-normal">（可选）</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请说明您需要访问此文件的原因..."
              rows={3}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t shrink-0">
          <Button variant="outline" onClick={onClose} disabled={createMutation.isPending}>
            取消
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                提交中...
              </>
            ) : (
              '提交申请'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
