/**
 * TeamResourceMountDialog.tsx
 * 挂载资源到团队的对话框
 *
 * 改进：
 * - 搜索文件名/文件夹名（替代手动输入文件ID）
 * - 可选目标挂载目录
 */

import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { teamsApi } from '@/services/collab';
import { filesApi } from '@/services/core';
import api from '@/services/api-client';
import { Loader2, X, FolderPlus, FolderOpen, Link2Off, Search, Check, ChevronRight, FolderTree } from 'lucide-react';
import { cn, formatBytes } from '@/utils';

interface TeamResourceMountDialogProps {
  teamId: string;
  teamName: string;
  onClose: () => void;
}

interface FileSearchResult {
  id: string;
  name: string;
  isFolder: boolean;
  size: number;
  mimeType: string | null;
}

interface FolderOption {
  id: string | null;
  name: string;
  path: string;
}

const TeamResourceMountDialog: React.FC<TeamResourceMountDialogProps> = ({ teamId, teamName, onClose }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showMountForm, setShowMountForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<FileSearchResult | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [penetrate, setPenetrate] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦搜索框
  useEffect(() => {
    if (showMountForm && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [showMountForm]);

  // ── 已挂载资源列表 ──
  const { data: resources, isLoading } = useQuery({
    queryKey: ['team-resources', teamId],
    queryFn: () => teamsApi.listResources(teamId).then((r) => r.data.data),
  });

  // ── 文件搜索（用户自己的文件）──
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['mount-file-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      const res = await filesApi.list({ search: searchQuery.trim(), limit: 20, scope: 'all' });
      return (res.data?.data ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        isFolder: f.isFolder,
        size: f.size,
        mimeType: f.mimeType,
      })) as FileSearchResult[];
    },
    enabled: showMountForm && searchQuery.trim().length > 0,
  });

  // ── 团队工作区目录列表（用于选择挂载目标）──
  const { data: teamFolders } = useQuery({
    queryKey: ['team-folders', teamId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { files: any[]; total: number } }>(
        `/api/teams/${teamId}/workspace/all-files`
      );
      const allFiles = res.data.data.files ?? [];
      return allFiles
        .filter((f: any) => f.isFolder)
        .map((f: any) => ({ id: f.fileId, name: f.fileName, path: f.filePath || '' })) as FolderOption[];
    },
    enabled: showMountForm,
  });

  // ── 挂载 mutation ──
  const mountMutation = useMutation({
    mutationFn: () => {
      if (!selectedFile) throw new Error('未选择文件');
      return teamsApi
        .mountResource(teamId, selectedFile.id, {
          targetFolderId: selectedFolderId,
          penetrate,
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      toast({ title: '资源已挂载' });
      queryClient.invalidateQueries({ queryKey: ['team-resources', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team-workspace-all', teamId] });
      resetForm();
    },
    onError: (e: any) => {
      toast({ title: '挂载失败', description: e.response?.data?.error?.message, variant: 'destructive' });
    },
  });

  // ── 卸载 mutation ──
  const unmountMutation = useMutation({
    mutationFn: (resourceId: string) => teamsApi.unmountResource(teamId, resourceId).then((r) => r.data),
    onSuccess: () => {
      toast({ title: '资源已卸载' });
      queryClient.invalidateQueries({ queryKey: ['team-resources', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team-workspace-all', teamId] });
    },
    onError: (e: any) => {
      toast({ title: '卸载失败', description: e.response?.data?.error?.message, variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setSelectedFile(null);
    setSearchQuery('');
    setSelectedFolderId(null);
    setShowMountForm(false);
  };

  const handleSelectFile = (file: FileSearchResult) => {
    setSelectedFile(file);
    setSearchQuery(file.name);
  };

  const handleMount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      toast({ title: '请先搜索并选择一个文件或文件夹', variant: 'destructive' });
      return;
    }
    mountMutation.mutate();
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
              {/* 文件搜索 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <Search className="h-3.5 w-3.5" />
                  搜索文件或文件夹
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      // 清空选择如果用户修改了搜索内容
                      if (selectedFile && e.target.value !== selectedFile.name) {
                        setSelectedFile(null);
                      }
                    }}
                    placeholder="输入文件名搜索..."
                    className="w-full pl-8 pr-8 h-9 text-sm border rounded-md bg-background outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {selectedFile && (
                    <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                  )}
                </div>

                {/* 搜索结果下拉 */}
                {isSearching ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : searchResults && searchResults.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto rounded-md border bg-background space-y-0.5">
                    {searchResults.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => handleSelectFile(file)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors',
                          selectedFile?.id === file.id && 'bg-primary/5 ring-1 ring-primary/20'
                        )}
                      >
                        <FolderOpen className={cn('h-4 w-4 shrink-0', file.isFolder ? 'text-amber-500' : 'hidden')} />
                        {!file.isFolder && <span className="w-4 shrink-0" />}
                        <span className="truncate flex-1 min-w-0">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {file.isFolder ? '-' : formatBytes(file.size)}
                        </span>
                        {selectedFile?.id === file.id && <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                      </button>
                    ))}
                  </div>
                ) : searchQuery.trim() ? (
                  <p className="text-xs text-muted-foreground text-center py-3">未找到匹配的文件</p>
                ) : null}
              </div>

              {/* 目标目录选择 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium flex items-center gap-1">
                  <FolderOpen className="h-3.5 w-3.5" />
                  挂载到目录（可选）
                </label>
                <div className="max-h-28 overflow-y-auto rounded-md border bg-background">
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(null)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors',
                      selectedFolderId === null && 'bg-primary/5'
                    )}
                  >
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    <span>根目录</span>
                    {selectedFolderId === null && <Check className="h-3.5 w-3.5 text-green-500 ml-auto" />}
                  </button>
                  {teamFolders?.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setSelectedFolderId(folder.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors border-t',
                        selectedFolderId === folder.id && 'bg-primary/5'
                      )}
                    >
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      <FolderOpen className="h-4 w-4 text-amber-500" />
                      <span className="truncate">{folder.name}</span>
                      {selectedFolderId === folder.id && <Check className="h-3.5 w-3.5 text-green-500 ml-auto" />}
                    </button>
                  ))}
                  {(!teamFolders || teamFolders.length === 0) && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">暂无子文件夹</p>
                  )}
                </div>
              </div>

              {/* 已选择的文件信息 */}
              {selectedFile && (
                <div className="flex items-center gap-2 p-2 rounded bg-background border text-xs">
                  <FolderOpen
                    className={cn(
                      'h-4 w-4 shrink-0',
                      selectedFile.isFolder ? 'text-amber-500' : 'text-muted-foreground'
                    )}
                  />
                  <span className="truncate font-medium">已选择：{selectedFile.name}</span>
                  <span className="text-muted-foreground ml-auto">
                    {selectedFile.isFolder ? '文件夹' : formatBytes(selectedFile.size)}
                  </span>
                </div>
              )}

              {/* 文件夹穿透选项 */}
              {selectedFile?.isFolder && (
                <label className="flex items-center gap-2 p-2 rounded-lg border bg-amber-500/5 border-amber-500/20 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={penetrate}
                    onChange={(e) => setPenetrate(e.target.checked)}
                    className="rounded"
                  />
                  <FolderTree className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="text-sm">同时挂载该文件夹内的所有子文件/子文件夹</span>
                </label>
              )}

              <Button type="submit" size="sm" className="w-full" disabled={!selectedFile || mountMutation.isPending}>
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
                <div key={resource.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 group">
                  <FolderOpen className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{resource.fileName}</p>
                      <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                        挂载
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      挂载于 {new Date(resource.mountedAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleUnmount(resource.fileId, resource.fileName)}
                    disabled={unmountMutation.isPending}
                    title="卸载资源"
                  >
                    {unmountMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link2Off className="h-4 w-4" />
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
