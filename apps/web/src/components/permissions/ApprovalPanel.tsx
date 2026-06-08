/**
 * ApprovalPanel.tsx
 * 待审批权限申请列表面板
 *
 * 功能:
 * - 展示所有待审批的权限申请
 * - 支持批准 / 拒绝操作（拒绝时可填写原因）
 * - 操作成功后自动刷新列表
 * - 支持 compact 模式（紧凑行内展示）
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Clock, AlertCircle, Loader2, FileText, Eye, Edit, Crown } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import {
  permissionRequestsApi,
  type PermissionRequest,
} from '@/services/collab';

interface ApprovalPanelProps {
  className?: string;
  compact?: boolean;
}

const PERMISSION_LABEL: Record<string, { label: string; icon: typeof Eye; color: string; bg: string }> = {
  read: { label: '只读', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  write: { label: '读写', icon: Edit, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  admin: { label: '管理', icon: Crown, color: 'text-purple-500', bg: 'bg-purple-500/10' },
};

export const ApprovalPanel: React.FC<ApprovalPanelProps> = ({ className, compact = false }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rejectCommentMap, setRejectCommentMap] = useState<Record<string, string>>({});
  const [expandedReject, setExpandedReject] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['permission-requests-pending'],
    queryFn: () =>
      permissionRequestsApi.listPending().then((r) => r.data.data?.items ?? []),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ requestId, action, comment }: { requestId: string; action: 'approve' | 'reject'; comment?: string }) =>
      permissionRequestsApi.review(requestId, { action, comment }),
    onSuccess: (_data, variables) => {
      toast({
        title: variables.action === 'approve' ? '已批准申请' : '已拒绝申请',
      });
      setRejectCommentMap((prev) => {
        const next = { ...prev };
        delete next[variables.requestId];
        return next;
      });
      setExpandedReject(null);
      queryClient.invalidateQueries({ queryKey: ['permission-requests-pending'] });
    },
    onError: (e: any) => {
      toast({
        title: '操作失败',
        description: e.response?.data?.error?.message || '请稍后重试',
        variant: 'destructive',
      });
    },
  });

  const requests: PermissionRequest[] = (data ?? []) as PermissionRequest[];

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className={cn('text-center py-12 bg-muted/30 rounded-lg border border-dashed', className)}>
        <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">暂无待审批的申请</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {!compact && (
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">待审批申请</h3>
          <span className="text-sm text-muted-foreground">{requests.length} 条待处理</span>
        </div>
      )}

      <div className={cn(compact ? 'space-y-1' : 'divide-y rounded-lg border')}>
        {requests.map((req) => {
          const permConfig = PERMISSION_LABEL[req.requestedPermission as keyof typeof PERMISSION_LABEL] ?? PERMISSION_LABEL.read!;
          const PermIcon = permConfig.icon;
          const isRejecting = expandedReject === req.id;

          if (compact) {
            /* ── compact 模式：单行紧凑展示 ── */
            return (
              <div
                key={req.id}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/30 transition-colors'
                )}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate flex-1 min-w-0" title={req.fileName}>
                  {req.fileName || req.fileId.slice(0, 8)}
                </span>
                <span className={cn('flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium', permConfig.bg, permConfig.color)}>
                  <PermIcon className="h-3 w-3" />
                  {permConfig.label}
                </span>

                {isRejecting ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={rejectCommentMap[req.id] ?? ''}
                      onChange={(e) =>
                        setRejectCommentMap((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      placeholder="拒绝原因（可选）"
                      className="w-32 h-6 px-1.5 text-xs border rounded bg-background"
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 px-1.5 text-xs"
                      onClick={() =>
                        reviewMutation.mutate({
                          requestId: req.id,
                          action: 'reject',
                          comment: rejectCommentMap[req.id] || undefined,
                        })
                      }
                      disabled={reviewMutation.isPending}
                    >
                      确认
                    </Button>
                    <button
                      onClick={() => setExpandedReject(null)}
                      className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-xs text-green-600 hover:text-green-700 hover:bg-green-500/10"
                      onClick={() => reviewMutation.mutate({ requestId: req.id, action: 'approve' })}
                      disabled={reviewMutation.isPending}
                    >
                      <Check className="h-3 w-3 mr-0.5" />
                      批准
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-500/10"
                      onClick={() => setExpandedReject(req.id)}
                      disabled={reviewMutation.isPending}
                    >
                      <X className="h-3 w-3 mr-0.5" />
                      拒绝
                    </Button>
                  </div>
                )}
              </div>
            );
          }

          /* ── 默认模式：完整卡片展示 ── */
          return (
            <div key={req.id} className="p-4 space-y-3 first:rounded-t-lg last:rounded-b-lg">
              {/* 文件名 + 权限标签 */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-medium truncate" title={req.fileName}>
                    {req.fileName || req.fileId}
                  </span>
                </div>
                <span
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0',
                    permConfig.bg,
                    permConfig.color
                  )}
                >
                  <PermIcon className="h-3 w-3" />
                  {permConfig.label}
                </span>
              </div>

              {/* 元信息行 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>申请人：{req.requesterId}</span>
                <span>{new Date(req.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>

              {/* 原因摘要 */}
              {req.reason && (
                <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded-md line-clamp-2">
                  {req.reason}
                </p>
              )}

              {/* 操作区 */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-green-600 border-green-300 hover:bg-green-500/10"
                  onClick={() => reviewMutation.mutate({ requestId: req.id, action: 'approve' })}
                  disabled={reviewMutation.isPending}
                >
                  {reviewMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  批准
                </Button>

                {!isRejecting ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-red-600 border-red-300 hover:bg-red-500/10"
                    onClick={() => setExpandedReject(req.id)}
                    disabled={reviewMutation.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                    拒绝
                  </Button>
                ) : (
                  <div className="flex-1 flex items-end gap-2">
                    <textarea
                      value={rejectCommentMap[req.id] ?? ''}
                      onChange={(e) =>
                        setRejectCommentMap((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      placeholder="请输入拒绝原因（可选）..."
                      rows={2}
                      className="flex-1 px-2 py-1.5 text-sm border rounded-md bg-background resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex gap-1 shrink-0 pb-0.5">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          reviewMutation.mutate({
                            requestId: req.id,
                            action: 'reject',
                            comment: rejectCommentMap[req.id] || undefined,
                          })
                        }
                        disabled={reviewMutation.isPending}
                      >
                        确认拒绝
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedReject(null)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
