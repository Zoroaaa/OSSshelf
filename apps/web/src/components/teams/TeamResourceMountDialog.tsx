/**
 * TeamResourceMountDialog.tsx
 * 挂载资源到团队的对话框
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { teamsApi, type TeamResource } from '@/services/collab';
import { Loader2, X, FolderPlus, Trash2, FolderOpen, Link } from 'lucide-react';
import { cn } from '@/utils';

interface TeamResourceMountDialogProps {
  teamId: string;
  teamName: string;
  onClose: () => void;
}

const TeamResourceMountDialog: React.FC<TeamResourceMountDialogProps> = ({ teamId, teamName, onClose }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fileId, setFileId] = useState('');
  const [showMountForm, setShowMountForm] = useState(false);

  const { data: resources, isLoading } = useQuery({
    queryKey: ['team-resources', teamId],
    queryFn: () => teamsApi.listResources(teamId).then((r) => r.data.data),
  });

  const mountMutation = useMutation({
    mutationFn: (resourceFileId: string) =>
      teamsApi.mountResource(teamId, resourceFileId).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '资源已挂载' });
      queryClient.invalidateQueries({ queryKey: ['team-resources', teamId] });
      setFileId('');
      setShowMountForm(false);
    },
    onError: (e: any) => {
      toast({
        title: '挂载失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const unmountMutation = useMutation({
    mutationFn: (resourceId: string) =>
      teamsApi.unmountResource(teamId, resourceId).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '资源已卸载' });
      queryClient.invalidateQueries({ queryKey: ['team-resources', teamId] });
    },
    onError: (e: any) => {
      toast({
        title: '卸载失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const handleMount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileId.trim()) {
      toast({ title: '请输入文件 ID', variant: 'destructive' });
      return;
    }
    mountMutation.mutate(fileId.trim());
  };

  const handleUnmount = (resourceId: string, fileName: string) => {
    if (!confirm(`确定要卸载资源 "${fileName}" 吗？`)) return;
    unmountMutation.mutate(resourceId);
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-card rounded-lg shadow-lg p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold">{teamName}</h2>
            <p className="text-sm text-muted-foreground">管理团队资源</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 操作栏 */}
        <div className="p-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">已挂载资源</span>
            <Button size="sm" onClick={() => setShowMountForm(!showMountForm)}>
              {showMountForm ? <X className="h-4 w-4 mr-1" /> : <FolderPlus className="h-4 w-4 mr-1" />}
              {showMountForm ? '取消' : '挂载资源'}
            </Button>
          </div>

          {showMountForm && (
            <form onSubmit={handleMount} className="p-3 rounded-lg border bg-muted/30 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <Link className="h-3.5 w-3.5" />
                  文件 ID
                </label>
                <Input
                  value={fileId}
                  onChange={(e) => setFileId(e.target.value)}
                  placeholder="输入要挂载的文件 ID..."
                />
                <p className="text-xs text-muted-foreground">输入文件或文件夹的唯一标识符</p>
              </div>

              <Button
                type="submit"
                size="sm"
                className="w-full"
                disabled={!fileId.trim() || mountMutation.isPending}
              >
                {mountMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <FolderPlus className="h-4 w-4 mr-1" />
                )}
                确认挂载
              </Button>
            </form>
          )}
        </div>

        {/* 资源列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {!resources || resources.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
              暂无挂载资源
              <p className="mt-1">点击上方按钮挂载资源到团队</p>
            </div>
          ) : (
            <div className="space-y-2">
              {resources.map((resource) => (
                <div key={resource.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <FolderOpen className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{resource.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      挂载于 {new Date(resource.mountedAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleUnmount(resource.id, resource.fileName)}
                    disabled={unmountMutation.isPending}
                    title="卸载资源"
                  >
                    {unmountMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="p-4 border-t flex-shrink-0">
          <Button variant="outline" className="w-full" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TeamResourceMountDialog;
