/**
 * TeamWorkspace.tsx — 团队工作区 V4（完整复用主文件管理能力）
 *
 * 复用自 Files.tsx 的核心能力：
 * - 文件图标按类型（FileIcon）
 * - 拖拽上传（useFileDragDrop）
 * - 上传进度条（per-file progress）
 * - 预签名上传/下载（presignUpload / getPresignedDownloadUrl）
 * - 文件预览（FilePreview）
 * - 右键菜单位置跟随鼠标
 * - 搜索、排序、分页、全选、重命名、键盘快捷键
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { teamsApi, type WorkspaceFile } from '@/services/collab';
import api from '@/services/api-client';
import { getPresignedDownloadUrl, presignUpload } from '@/services/presignUpload';
import { filesApi } from '@/services/api';
import { FilePreview } from '@/components/files/FilePreview';
import { FileIcon } from '@/components/files/FileIcon';
import { useAuthStore } from '@/stores/auth';
import { useFileDragDrop } from '@/hooks/useFileDragDrop';
import {
  FolderOpen,
  HardDrive,
  Users,
  Loader2,
  Grid,
  List,
  RefreshCw,
  Lock,
  Edit,
  Crown,
  Upload,
  Trash2,
  FolderPlus,
  Eye,
  Download,
  ChevronRight,
  Search,
  SortAsc,
  SortDesc,
  CheckSquare,
  X,
  Pencil,
  Link2Off,
} from 'lucide-react';
import { cn, formatBytes } from '@/utils';
import type { ViewMode } from '@/stores/files';
import TeamStorageBar from './TeamStorageBar';
import TeamActivityFeed from './TeamActivityFeed';

interface TeamWorkspaceProps {
  teamId: string;
  teamName: string;
  userRole: string;
  isOwner: boolean;
}

type WorkspaceTab = 'files' | 'activity';

type SortField = 'fileName' | 'size' | 'mountedAt';
type SortOrder = 'asc' | 'desc';

const TeamWorkspace: React.FC<TeamWorkspaceProps> = ({ teamId, teamName, userRole, isOwner }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('files');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [contextMenuFile, setContextMenuFile] = useState<WorkspaceFile | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 搜索 & 排序 ──
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('fileName');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // ── 分页 ──
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // ── 重命名 ──
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── 上传进度 ──
  const [uploadProgresses, setUploadProgresses] = useState<Record<string, number>>({});

  const canWrite = userRole === 'admin' || userRole === 'owner' || isOwner;
  const { token } = useAuthStore();

  // 切换目录时重置分页和选择
  useEffect(() => {
    setCurrentPage(1);
    setSelectedFileIds(new Set());
    setSearchInput('');
  }, [currentFolderId]);

  // ── 面包屑导航：动态查询父级文件夹链（带 5min 缓存避免重复请求）──
  interface BreadcrumbItem {
    id: string;
    name: string;
  }
  const { data: breadcrumbs = [] } = useQuery<BreadcrumbItem[]>({
    queryKey: ['team-breadcrumbs', teamId, currentFolderId],
    enabled: !!currentFolderId,
    staleTime: 5 * 60 * 1000, // 5 分钟缓存
    queryFn: async () => {
      const crumbs: BreadcrumbItem[] = [];
      let currentId: string | null = currentFolderId!;
      // 防止无限循环（最多查 10 级）
      let maxDepth = 10;
      while (currentId && maxDepth > 0) {
        const res = await filesApi.get(currentId);
        const folder = res.data.data;
        if (!folder) break;
        crumbs.unshift({ id: folder.id, name: folder.name });
        currentId = (folder as any).parentId ?? null;
        maxDepth--;
      }
      return crumbs;
    },
  });

  // ★ 使用 all-files 端点（合并挂载资源 + 团队自有文件）
  const {
    data: filesData,
    isLoading: isFilesLoading,
    refetch: refetchFiles,
  } = useQuery({
    queryKey: ['team-workspace-all', teamId, currentFolderId],
    queryFn: () =>
      api
        .get<{
          success: boolean;
          data: { files: (WorkspaceFile & { source: string })[]; total: number };
        }>(`/api/teams/${teamId}/workspace/all-files${currentFolderId ? `?folderId=${currentFolderId}` : ''}`)
        .then((r) => r.data.data),
  });

  const { data: storageData } = useQuery({
    queryKey: ['team-storage', teamId],
    queryFn: () => teamsApi.getStorageStats(teamId).then((r) => r.data.data),
  });

  const rawFiles = filesData?.files ?? [];
  const total = filesData?.total ?? 0;

  // ── 搜索过滤 ──
  const filteredFiles = rawFiles.filter(
    (f) => !searchInput || f.fileName.toLowerCase().includes(searchInput.toLowerCase())
  );

  // ── 排序 ──
  const sortedFiles = [...filteredFiles].sort((a, b) => {
    // 文件夹始终排在前面
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    let cmp = 0;
    switch (sortBy) {
      case 'fileName':
        cmp = a.fileName.localeCompare(b.fileName, 'zh-CN');
        break;
      case 'size':
        cmp = (a.size ?? 0) - (b.size ?? 0);
        break;
      case 'mountedAt':
        cmp = new Date(a.mountedAt).getTime() - new Date(b.mountedAt).getTime();
        break;
    }
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  // ── 分页 ──
  const totalPages = Math.ceil(sortedFiles.length / pageSize);
  const pagedFiles = sortedFiles.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const files = pagedFiles;

  // ── 拖拽上传 ──
  const { isDragActive, handleDragOver, handleDragLeave, handleDrop } = useFileDragDrop({
    folderId: currentFolderId ?? null,
    setUploadProgresses,
    teamId,
  });

  // 拖拽上传完成后刷新文件列表
  useEffect(() => {
    if (!isDragActive) refetchFiles();
  }, [isDragActive]);

  // ── 新建文件夹（传递当前目录 parentId）──
  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      api.post<{ success: boolean; data: { id: string; name: string }; error?: { message: string } }>(
        `/api/teams/${teamId}/workspace/folder`,
        { name, parentId: currentFolderId || null }
      ),
    onSuccess: (res) => {
      const body = res.data;
      if (!body.success) {
        toast({ title: '创建失败', description: body.error?.message || '未知错误', variant: 'destructive' });
        return;
      }
      toast({ title: '文件夹创建成功' });
      setIsCreatingFolder(false);
      setNewFolderName('');
      queryClient.invalidateQueries({ queryKey: ['team-workspace-all'] });
    },
    onError: (e: any) => {
      toast({ title: '创建失败', description: e.response?.data?.error?.message || e.message, variant: 'destructive' });
    },
  });

  // ── 删除文件 / 卸载挂载资源 ──
  const handleRemoveFile = (file: WorkspaceFile) => {
    const isMounted = (file as any).source === 'mounted';
    if (isMounted) {
      if (confirm(`确定卸载挂载资源「${file.fileName}」？（仅移除挂载，不删除原文件）`)) {
        unmountMutation.mutate(file.fileId);
      }
    } else {
      if (confirm(`确定删除「${file.fileName}」？`)) {
        deleteMutation.mutate(file.fileId);
      }
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) =>
      api.delete<{ success: boolean; error?: { message: string } }>(`/api/files/${fileId}`),
    onSuccess: (_res, fileId) => {
      const body = _res.data;
      if (!body.success) {
        toast({ title: '删除失败', description: body.error?.message, variant: 'destructive' });
        return;
      }
      toast({ title: '已删除' });
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      refetchFiles();
    },
    onError: (e: any) => {
      toast({ title: '删除失败', description: e.response?.data?.error?.message || e.message, variant: 'destructive' });
    },
  });

  // ── 卸载挂载资源（仅对 source='mounted' 的文件）──
  const unmountMutation = useMutation({
    mutationFn: (fileId: string) => teamsApi.unmountResource(teamId, fileId).then((r) => r.data),
    onSuccess: (_data, fileId) => {
      toast({ title: '已卸载' });
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      refetchFiles();
    },
    onError: (e: any) => {
      toast({ title: '卸载失败', description: e.response?.data?.error?.message || e.message, variant: 'destructive' });
    },
  });

  // ── 重命名 ──
  const renameMutation = useMutation({
    mutationFn: async ({ fileId, name }: { fileId: string; name: string }) => {
      // 挂载的资源不允许重命名（无权修改原始文件）
      const file = files.find((f) => f.fileId === fileId);
      if ((file as any)?.source === 'mounted') {
        throw new Error('挂载的资源不允许重命名');
      }
      await filesApi.update(fileId, { name });
    },
    onSuccess: () => {
      toast({ title: '重命名成功' });
      setRenamingFileId(null);
      setRenameValue('');
      refetchFiles();
    },
    onError: (e: any) => {
      toast({
        title: '重命名失败',
        description: e.response?.data?.error?.message || e.message,
        variant: 'destructive',
      });
    },
  });

  // ── 上传文件（使用 presignUpload，带进度）──
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    for (const file of Array.from(fileList)) {
      const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploadProgresses((p) => ({ ...p, [key]: 0 }));
      try {
        await presignUpload({
          file,
          parentId: currentFolderId || null,
          teamId,
          onProgress: (progress) => setUploadProgresses((prev) => ({ ...prev, [key]: progress })),
        });
        setUploadProgresses((p) => {
          const n = { ...p };
          delete n[key];
          return n;
        });
        toast({ title: `${file.name} 上传成功` });
      } catch (uploadErr: any) {
        setUploadProgresses((p) => {
          const n = { ...p };
          delete n[key];
          return n;
        });
        toast({ title: `${file.name} 上传失败`, description: uploadErr.message, variant: 'destructive' });
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    refetchFiles();
  };

  // ── 选择/取消选择 / 全选 ──
  const toggleSelect = useCallback((fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFileIds(new Set(files.map((f) => f.fileId)));
  }, [files]);

  const clearSelection = useCallback(() => setSelectedFileIds(new Set()), []);

  // ── 排序切换 ──
  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // ── 键盘快捷键 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 忽略输入框内的按键
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFileIds.size > 0 && canWrite) {
          const targetFiles = files.filter((f) => selectedFileIds.has(f.fileId));
          if (confirm(`确定对选中的 ${selectedFileIds.size} 个项目执行操作？（挂载资源将被卸载，团队文件将被删除）`)) {
            targetFiles.forEach((f) => handleRemoveFile(f));
          }
        }
      }
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        selectAll();
      }
      if (e.key === 'Escape') {
        clearSelection();
        setContextMenuFile(null);
        setIsPreviewOpen(false);
        setRenamingFileId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedFileIds, canWrite, files, selectAll, clearSelection]);

  const PermissionBadge = ({ permission }: { permission: string }) => {
    if (permission === 'admin') return <Crown className="h-3.5 w-3.5 text-purple-500" />;
    if (permission === 'write') return <Edit className="h-3.5 w-3.5 text-blue-500" />;
    return <Lock className="h-3.5 w-3.5 text-gray-400" />;
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolderMutation.mutate(newFolderName.trim());
  };

  const handleRenameStart = (file: WorkspaceFile) => {
    setRenamingFileId(file.fileId);
    setRenameValue(file.fileName);
  };

  const handleRenameConfirm = () => {
    if (!renameValue.trim() || !renamingFileId) return;
    renameMutation.mutate({ fileId: renamingFileId, name: renameValue.trim() });
  };

  // ── 下载文件（使用预签名 URL）──
  const handleDownload = async (file: WorkspaceFile) => {
    const forceBlobDownload = (blob: Blob, name: string) => {
      const forceBlob = new Blob([blob], { type: 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(forceBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    };

    try {
      const result = await getPresignedDownloadUrl(file.fileId);
      const { url, fileName } = result;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('download failed');
      const blob = await resp.blob();
      forceBlobDownload(blob, fileName || file.fileName);
    } catch {
      const dlToken = token || useAuthStore.getState().token;
      const dlUrl = `${import.meta.env.VITE_API_URL || ''}/api/files/${file.fileId}/download${dlToken ? `?token=${encodeURIComponent(dlToken)}` : ''}`;
      try {
        const resp = await fetch(dlUrl);
        if (!resp.ok) throw new Error('download failed');
        const blob = await resp.blob();
        forceBlobDownload(blob, file.fileName);
      } catch {
        toast({ title: '下载失败', variant: 'destructive' });
      }
    }
  };

  // ── 获取显示日期（优先 createdAt，fallback mountedAt）──
  const getFileDate = (file: WorkspaceFile) => {
    const ts = (file as any).createdAt || file.mountedAt;
    return ts ? new Date(ts).toLocaleDateString('zh-CN') : '-';
  };

  // 上传中的文件列表
  const activeUploads = Object.entries(uploadProgresses);

  return (
    <div
      className="space-y-4"
      onClick={() => setContextMenuFile(null)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽上传遮罩 */}
      {isDragActive && (
        <div className="fixed inset-0 z-50 bg-primary/10 flex items-center justify-center pointer-events-none">
          <div className="bg-card border-2 border-dashed border-primary rounded-xl p-12 text-center shadow-2xl">
            <Upload className="h-14 w-14 mx-auto mb-4 text-primary" />
            <p className="text-lg font-semibold">松开上传</p>
          </div>
        </div>
      )}

      {/* 头部信息 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{teamName}</h2>
            <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full flex items-center gap-1">
              <Users className="h-3 w-3" /> 工作区
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">团队共享空间 · {total} 个项目</p>
          {/* 面包屑导航 */}
          {currentFolderId && (
            <div className="flex items-center gap-1 text-sm mt-1 flex-wrap">
              <button
                onClick={() => setCurrentFolderId(undefined)}
                className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5" /> 根目录
              </button>
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  {idx === breadcrumbs.length - 1 ? (
                    <span className="text-foreground font-medium">{crumb.name}</span>
                  ) : (
                    <button
                      onClick={() => setCurrentFolderId(crumb.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {crumb.name}
                    </button>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {storageData && (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <HardDrive className="h-3.5 w-3.5" /> {storageData.usagePercent}%
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetchFiles()}>
            <RefreshCw className={cn('h-4 w-4', isFilesLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* 存储条 */}
      {storageData && <TeamStorageBar stats={storageData} />}

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b">
        {[
          { key: 'files' as WorkspaceTab, label: '文件', icon: <FolderOpen className="h-4 w-4" /> },
          { key: 'activity' as WorkspaceTab, label: '动态', icon: <Users className="h-4 w-4" /> },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.icon} {tab.label} {tab.key === 'files' && ` (${total})`}
          </button>
        ))}
      </div>

      {/* ====== 文件 Tab ====== */}
      {activeTab === 'files' && (
        <div className="space-y-3">
          {/* 工具栏 */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1">
              {/* 视图切换 */}
              <div className="flex border rounded-md overflow-hidden">
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="icon"
                  className={cn('rounded-none h-8 w-8', viewMode === 'list' && 'bg-accent')}
                  onClick={() => setViewMode('list')}
                  title="列表视图"
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="icon"
                  className={cn('rounded-none h-8 w-8', viewMode === 'grid' && 'bg-accent')}
                  onClick={() => setViewMode('grid')}
                  title="网格视图"
                >
                  <Grid className="h-4 w-4" />
                </Button>
              </div>

              {/* 搜索框 */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  className="pl-8 pr-7 h-8 w-40 sm:w-48 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="搜索文件..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                {searchInput && (
                  <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchInput('')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* 排序按钮 */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSort('fileName')}
                className="hidden sm:flex gap-1"
              >
                名称
                {sortBy === 'fileName' &&
                  (sortOrder === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)}
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleSort('size')} className="hidden sm:flex gap-1">
                大小
                {sortBy === 'size' &&
                  (sortOrder === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {/* 新建文件夹 */}
              {canWrite && (
                <>
                  {!isCreatingFolder ? (
                    <Button variant="outline" size="sm" onClick={() => setIsCreatingFolder(true)}>
                      <FolderPlus className="h-4 w-4 mr-1" /> 新建文件夹
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="文件夹名称"
                        className="w-40 h-8 text-sm"
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                        autoFocus
                      />
                      <Button size="sm" onClick={handleCreateFolder} disabled={createFolderMutation.isPending}>
                        {createFolderMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确定'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsCreatingFolder(false);
                          setNewFolderName('');
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* 上传文件 */}
              {canWrite && (
                <>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                  <Button variant="outline" size="sm" onClick={handleUploadClick}>
                    <Upload className="h-4 w-4 mr-1" /> 上传文件
                  </Button>
                </>
              )}

              {/* 全选 */}
              {files.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAll}
                  disabled={selectedFileIds.size === files.length}
                >
                  <CheckSquare className="h-4 w-4 mr-1" /> 全选
                </Button>
              )}

              {/* 批量删除 */}
              {selectedFileIds.size > 0 && canWrite && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const targetFiles = files.filter((f) => selectedFileIds.has(f.fileId));
                    if (
                      confirm(
                        `确定对选中的 ${selectedFileIds.size} 个项目执行操作？（挂载资源将被卸载，团队文件将被删除）`
                      )
                    ) {
                      targetFiles.forEach((f) => handleRemoveFile(f));
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> 删除 ({selectedFileIds.size})
                </Button>
              )}
            </div>
          </div>

          {/* 上传进度条 */}
          {activeUploads.length > 0 && (
            <div className="space-y-2">
              {activeUploads.map(([key, progress]) => (
                <div key={key} className="bg-card border rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate flex-1 min-w-0">
                      {key.split('-').slice(0, -2).join('-')}
                    </span>
                    <span className="text-sm text-muted-foreground ml-2">{progress}%</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 文件列表 */}
          {isFilesLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-16 bg-muted/20 rounded-lg border border-dashed">
              <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">
                {searchInput ? '没有匹配的文件' : currentFolderId ? '此文件夹为空' : '工作区暂无文件'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {!searchInput &&
                  (canWrite
                    ? currentFolderId
                      ? '在此文件夹中新建或上传文件'
                      : '新建文件夹或上传文件开始协作'
                    : '等待团队成员添加文件')}
              </p>
            </div>
          ) : viewMode === 'list' ? (
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
                <div className="col-span-6">
                  <input
                    type="checkbox"
                    checked={selectedFileIds.size === files.length && files.length > 0}
                    onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                    className="rounded"
                  />
                  <span className="ml-2 cursor-pointer select-none" onClick={() => handleSort('fileName')}>
                    名称 {sortBy === 'fileName' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </span>
                </div>
                <div className="col-span-1.5 cursor-pointer select-none" onClick={() => handleSort('size')}>
                  大小 {sortBy === 'size' && (sortOrder === 'asc' ? '↑' : '↓')}
                </div>
                <div className="col-span-1.5">权限</div>
                <div className="col-span-2">操作</div>
                <div className="col-span-1 cursor-pointer select-none" onClick={() => handleSort('mountedAt')}>
                  日期 {sortBy === 'mountedAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                </div>
              </div>
              {files.map((file) => (
                <div
                  key={file.fileId}
                  onDoubleClick={() => {
                    if (file.isFolder) {
                      setCurrentFolderId(file.fileId);
                    } else {
                      setPreviewFile(file);
                      setIsPreviewOpen(true);
                    }
                  }}
                  onClick={(e) => {
                    if (
                      (e.target as HTMLInputElement).type !== 'checkbox' &&
                      (e.target as HTMLElement).closest('button') === null &&
                      !(e.target as HTMLElement).closest('input[type="text"]')
                    ) {
                      toggleSelect(file.fileId);
                    }
                    setContextMenuFile(null);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuFile(file);
                    setContextMenuPos({ x: e.clientX, y: e.clientY });
                  }}
                  className={cn(
                    'grid grid-cols-12 gap-2 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 cursor-pointer transition-colors items-center group',
                    selectedFileIds.has(file.fileId) && 'bg-primary/5'
                  )}
                >
                  <div className="col-span-6 flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedFileIds.has(file.fileId)}
                      onChange={() => toggleSelect(file.fileId)}
                      className="rounded"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {renamingFileId === file.fileId ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="h-6 text-sm flex-1"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameConfirm();
                            if (e.key === 'Escape') setRenamingFileId(null);
                          }}
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRenameConfirm();
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="sm" />
                        <span className="truncate">{file.fileName}</span>
                        {/* 挂载资源视觉区分标识 */}
                        {(file as any).source === 'mounted' && (
                          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            挂载
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="col-span-1.5 text-sm text-muted-foreground">
                    {file.isFolder ? '-' : formatBytes(file.size)}
                  </div>
                  <div className="col-span-1.5">
                    <PermissionBadge permission={file.permission} />
                  </div>
                  <div className="col-span-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!file.isFolder && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewFile(file);
                            setIsPreviewOpen(true);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameStart(file);
                        }}
                        title="重命名"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canWrite &&
                      ((file as any).source === 'mounted' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`确定卸载挂载资源「${file.fileName}」？`)) unmountMutation.mutate(file.fileId);
                          }}
                          title="卸载（仅移除挂载，不删除原文件）"
                        >
                          <Link2Off className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`确定删除「${file.fileName}」？`)) deleteMutation.mutate(file.fileId);
                          }}
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ))}
                  </div>
                  <div className="col-span-1 text-xs text-muted-foreground">{getFileDate(file)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {files.map((file) => (
                <div
                  key={file.fileId}
                  onDoubleClick={() => {
                    if (file.isFolder) setCurrentFolderId(file.fileId);
                    else {
                      setPreviewFile(file);
                      setIsPreviewOpen(true);
                    }
                  }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button') === null) toggleSelect(file.fileId);
                    setContextMenuFile(null);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuFile(file);
                    setContextMenuPos({ x: e.clientX, y: e.clientY });
                  }}
                  className={cn(
                    'flex flex-col items-center p-4 rounded-lg border hover:border-primary/50 hover:bg-muted/30 cursor-pointer transition-colors relative group',
                    selectedFileIds.has(file.fileId) && 'border-primary bg-primary/5'
                  )}
                >
                  <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="lg" />
                  <span className="text-sm text-center truncate w-full mt-2">{file.fileName}</span>
                  {/* 挂载资源视觉区分标识 — 网格视图 */}
                  {(file as any).source === 'mounted' && (
                    <span className="text-[10px] font-medium rounded bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5">
                      挂载
                    </span>
                  )}
                  <PermissionBadge permission={file.permission} />
                  {/* 操作按钮 */}
                  <div className="flex items-center justify-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!file.isFolder && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewFile(file);
                            setIsPreviewOpen(true);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameStart(file);
                        }}
                        title="重命名"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ====== 动态 Tab ====== */}
      {activeTab === 'activity' && <TeamActivityFeed teamId={teamId} />}

      {/* 文件预览（复用主文件管理的 FilePreview 组件） */}
      {isPreviewOpen && previewFile && !previewFile.isFolder && (
        <FilePreview
          file={
            {
              id: previewFile.fileId,
              name: previewFile.fileName,
              size: previewFile.size,
              mimeType: previewFile.mimeType,
              isFolder: false,
            } as any
          }
          token={token || ''}
          onClose={() => setIsPreviewOpen(false)}
          onDownload={(_file) => {
            setIsPreviewOpen(false);
            handleDownload(previewFile!);
          }}
          onShare={(_fileId) => {
            /* 团队工作区暂不支持分享 */
          }}
        />
      )}

      {/* 右键菜单（位置跟随鼠标） */}
      {contextMenuFile && (
        <div
          className="fixed z-[100] bg-card rounded-lg shadow-xl border py-1 min-w-[160px]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
            onClick={() => {
              setContextMenuFile(null);
              setPreviewFile(contextMenuFile);
              setIsPreviewOpen(true);
            }}
          >
            <Eye className="h-4 w-4" /> 预览
          </button>
          {!contextMenuFile.isFolder && (
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
              onClick={() => {
                setContextMenuFile(null);
                handleDownload(contextMenuFile);
              }}
            >
              <Download className="h-4 w-4" /> 下载
            </button>
          )}
          {canWrite && (
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
              onClick={() => {
                setContextMenuFile(null);
                handleRenameStart(contextMenuFile);
              }}
            >
              <Pencil className="h-4 w-4" /> 重命名
            </button>
          )}
          {canWrite && (contextMenuFile as any).source === 'mounted' ? (
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-amber-600"
              onClick={() => {
                setContextMenuFile(null);
                if (confirm(`确定卸载挂载资源「${contextMenuFile.fileName}」？`))
                  unmountMutation.mutate(contextMenuFile.fileId);
              }}
            >
              <Link2Off className="h-4 w-4" /> 卸载资源
            </button>
          ) : canWrite ? (
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-destructive"
              onClick={() => {
                setContextMenuFile(null);
                handleRemoveFile(contextMenuFile);
              }}
            >
              <Trash2 className="h-4 w-4" /> 删除
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default TeamWorkspace;
