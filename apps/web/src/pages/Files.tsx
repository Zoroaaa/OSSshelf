/**
 * Files.tsx
 * 文件管理页面
 *
 * 功能:
 * - 文件列表展示 (列表/网格/瀑布流)
 * - 右键菜单
 * - 键盘快捷键
 * - 批量操作
 * - 文件上传/下载
 * - 移动端触摸手势
 */

import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useFileStore, type ViewMode } from '@/stores/files';
import { useAuthStore } from '@/stores/auth';
import { filesApi, bucketsApi, permissionsApi, shareApi, searchApi, type StorageBucket } from '@/services/api';
import { getPresignedDownloadUrl, presignUpload } from '@/services/presignUpload';
import { useFileKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFolderUpload } from '@/hooks/useFolderUpload';
import { BreadcrumbNav, type BreadcrumbItem } from '@/components/ui/BreadcrumbNav';
import { FilePreview } from '@/components/files/FilePreview';
import { RenameDialog } from '@/components/files/dialogs';
import { MoveFolderPicker } from '@/components/files/dialogs';
import { FileTagsManager } from '@/components/files/tags';
import { FilePermissionManager } from '@/components/files/permissions';
import { FolderSettings } from '@/components/files/FolderSettings';
import { useToast } from '@/components/ui/useToast';
import { Button } from '@/components/ui/Button';
import {
  Upload,
  FolderPlus,
  FilePlus,
  Grid,
  List,
  Trash2,
  CheckSquare,
  SortAsc,
  SortDesc,
  Image as ImageIcon,
  FolderInput,
  RefreshCw,
  Columns,
  CheckCircle2,
  Tag,
  X,
  SlidersHorizontal,
  Search,
  History,
  Trash2 as TrashIcon,
} from 'lucide-react';
import type { FileItem } from '@osshelf/shared';
import { cn, decodeFileName } from '@/utils';

import { NewFolderDialog, NewFileDialog, FILE_TEMPLATES, ShareDialog, FileListContainer } from '@/components/files';
import { UploadLinkDialog } from '@/components/files/dialogs';
import { DirectLinkDialog } from '@/components/files/dialogs';
import { VersionHistory } from '@/components/files/VersionHistory';
import { FolderPickerDialog } from '@/components/files/dialogs';
import { MigrateBucketDialog } from '@/components/files/dialogs';
import { useFileMutations } from '@/hooks/useFileMutations';
import { useFileDragDrop } from '@/hooks/useFileDragDrop';
import { useFileSearch } from '@/hooks/useFileSearch';
import { useFileContextMenu } from '@/hooks/useFileContextMenu';
import { useFilesPageState } from '@/hooks/useFilesPageState';

export default function Files() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { token } = useAuthStore();
  const {
    viewMode,
    setViewMode,
    selectedFiles,
    selectedFileItems,
    toggleFileSelection,
    clearSelection,
    selectAll,
    sortBy,
    sortOrder,
    setSort,
    clipboard,
    setClipboard,
    setFocusedFile,
    getNextFileId,
  } = useFileStore();

  const pageState = useFilesPageState();
  const {
    showNewFolderDialog,
    setShowNewFolderDialog,
    newFolderName,
    setNewFolderName,
    newFolderBucketId,
    setNewFolderBucketId,
    showNewFileDialog,
    setShowNewFileDialog,
    newFileName,
    setNewFileName,
    newFileContent,
    setNewFileContent,
    newFileExtension,
    setNewFileExtension,
    newFileParentId,
    setNewFileParentId,
    uploadProgresses,
    setUploadProgresses,
    shareFileId,
    setShareFileId,
    previewFile,
    setPreviewFile,
    renameFile,
    setRenameFile,
    moveFile,
    setMoveFile,
    galleryMode,
    setGalleryMode,
    tagsFile,
    setTagsFile,
    permissionFile,
    setPermissionFile,
    folderSettingsFile,
    setFolderSettingsFile,
    fileInputRef,
    folderInputRef,
    searchInputRef,
    resetNewFolderDialog,
    resetNewFileDialog,
  } = pageState;

  // ── Phase 6 new state ──────────────────────────────────────────────────
  const [uploadLinkFolder, setUploadLinkFolder] = useState<{ id: string; name: string } | null>(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [showMigrateDialog, setShowMigrateDialog] = useState(false);
  const [shareFileItem, setShareFileItem] = useState<{ id: string; isFolder: boolean } | null>(null);
  const [directLinkFile, setDirectLinkFile] = useState<{ id: string; name: string } | null>(null);

  // ── Phase 7.5: 版本历史 ────────────────────────────────────────────────────
  const [versionHistoryFile, setVersionHistoryFile] = useState<FileItem | null>(null);

  // ── Phase 7: 搜索历史 ────────────────────────────────────────────────────
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const { data: searchHistoryData, refetch: refetchHistory } = useQuery({
    queryKey: ['search-history'],
    queryFn: () => searchApi.history().then((r) => r.data.data ?? []),
    enabled: false, // 手动触发
  });

  const fileSearch = useFileSearch({ folderId });
  const {
    searchInput,
    setSearchInput,
    searchQuery,
    setSearchQuery,
    tagSearchQuery,
    setTagSearchQuery,
    showAdvancedSearch,
    setShowAdvancedSearch,
    advancedConditions,
    setAdvancedConditions,
    advancedLogic,
    setAdvancedLogic,
    searchSuggestions,
    showSuggestions,
    setShowSuggestions,
    searchResults,
    tagSearchResults,
    advancedSearchResults,
    handleSearchInput,
    handleSuggestionClick,
    handleTagClick,
    clearTagSearch,
  } = fileSearch;

  const { data: breadcrumbs = [] } = useQuery<BreadcrumbItem[]>({
    queryKey: ['breadcrumbs', folderId],
    enabled: !!folderId,
    queryFn: async () => {
      const crumbs: BreadcrumbItem[] = [];
      let currentId: string | null = folderId!;
      while (currentId) {
        const res = await filesApi.get(currentId);
        const folder = res.data.data;
        if (!folder) break;
        crumbs.unshift({ id: folder.id, name: folder.name });
        currentId = (folder as any).parentId ?? null;
      }
      return crumbs;
    },
  });

  const { data: allBuckets = [] } = useQuery<StorageBucket[]>({
    queryKey: ['buckets'],
    queryFn: () => bucketsApi.list().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  const { data: currentFolderInfo } = useQuery({
    queryKey: ['folder-info', folderId],
    enabled: !!folderId,
    queryFn: () => filesApi.get(folderId!).then((r) => r.data.data),
    staleTime: 30000,
  });

  const {
    data: files = [],
    isLoading,
    refetch,
  } = useQuery<FileItem[]>({
    queryKey: ['files', folderId],
    queryFn: () => filesApi.list({ parentId: folderId || null }).then((r) => r.data.data ?? []),
  });

  const fileIds = files.map((f) => f.id);
  const { data: fileTagsMap = {} } = useQuery<Record<string, any[]>>({
    queryKey: ['file-tags-batch', fileIds.sort().join(',')],
    queryFn: async () => {
      if (fileIds.length === 0) return {};
      const res = await permissionsApi.getBatchFileTags(fileIds);
      return res.data.data ?? {};
    },
    enabled: fileIds.length > 0,
    staleTime: 30000,
  });

  const displayFiles = tagSearchQuery
    ? (tagSearchResults ?? [])
    : showAdvancedSearch && advancedConditions.length > 0
      ? (advancedSearchResults ?? [])
      : searchQuery && searchResults
        ? (searchResults ?? [])
        : [...files]
            .filter((f) => !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .sort((a, b) => {
              if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
              const av = (a as any)[sortBy] ?? '',
                bv = (b as any)[sortBy] ?? '';
              return sortOrder === 'asc' ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
            });

  const imageFiles = displayFiles.filter((f) => f.mimeType?.startsWith('image/'));
  const hasImages = imageFiles.length > 0;

  const fileMutations = useFileMutations();
  const {
    createFolderMutation,
    createFileMutation,
    deleteMutation,
    renameMutation,
    moveMutation,
    shareMutation,
    batchDeleteMutation,
    batchMoveMutation,
    batchCopyMutation,
    checkTelegramLimit,
  } = fileMutations;

  // Upload link creation
  const createUploadLinkMutation = useMutation({
    mutationFn: (params: Parameters<typeof shareApi.createUploadLink>[0]) => shareApi.createUploadLink(params),
    onSuccess: (res) => {
      const d = res.data.data;
      if (d?.uploadToken) {
        const url = `${window.location.origin}/upload/${d.uploadToken}`;
        navigator.clipboard.writeText(url).then(() => toast({ title: '上传链接已复制', description: url }));
      }
      setUploadLinkFolder(null);
    },
    onError: () => toast({ title: '创建上传链接失败', variant: 'destructive' }),
  });

  function getEffectiveBucket(): StorageBucket | null {
    const folderBucketId = (currentFolderInfo as any)?.bucketId ?? null;
    if (folderBucketId) {
      return allBuckets.find((b) => b.id === folderBucketId) ?? null;
    }
    return allBuckets.find((b) => b.isDefault) ?? null;
  }

  const handleUpload = useCallback(
    async (file: File, key: string) => {
      const bucket = getEffectiveBucket();
      const limitErr = checkTelegramLimit(file, bucket);
      if (limitErr) {
        toast({ title: '上传失败', description: limitErr, variant: 'destructive' });
        return;
      }
      setUploadProgresses((p) => ({ ...p, [key]: 0 }));
      try {
        await presignUpload({
          file,
          parentId: folderId || null,
          bucketId: bucket?.id ?? null,
          onProgress: (progress) => setUploadProgresses((prev) => ({ ...prev, [key]: progress })),
        });
        setUploadProgresses((p) => {
          const n = { ...p };
          delete n[key];
          return n;
        });
        queryClient.invalidateQueries({ queryKey: ['files'] });
        queryClient.invalidateQueries({ queryKey: ['stats'] });
        toast({ title: '上传成功' });
      } catch (e: any) {
        setUploadProgresses((p) => {
          const n = { ...p };
          delete n[key];
          return n;
        });
        toast({
          title: '上传失败',
          description: e?.message || e?.response?.data?.error?.message,
          variant: 'destructive',
        });
      }
    },
    [folderId, queryClient, toast, setUploadProgresses, checkTelegramLimit]
  );

  const { isDragActive, handleDragOver, handleDragLeave, handleDrop } = useFileDragDrop({
    folderId: folderId ?? null,
    setUploadProgresses,
  });

  const { uploadFilesWithRelativePath } = useFolderUpload({
    currentFolderId: folderId ?? undefined,
    onFileStart: (name, key) => setUploadProgresses((p) => ({ ...p, [key]: 0 })),
    onFileProgress: (key, progress) => setUploadProgresses((p) => ({ ...p, [key]: progress })),
    onFileDone: (key) => {
      setUploadProgresses((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    },
    onFileError: (key, error) => {
      setUploadProgresses((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
      toast({
        title: '上传失败',
        description: error?.response?.data?.error?.message || error?.message,
        variant: 'destructive',
      });
    },
    onAllDone: (stats) => {
      if (stats) {
        if (stats.failed === 0) {
          toast({ title: '文件夹上传完成', description: `成功上传 ${stats.uploaded} 个文件` });
        } else {
          toast({
            title: '文件夹上传完成（部分失败）',
            description: `成功 ${stats.uploaded} 个，失败 ${stats.failed} 个`,
            variant: 'destructive',
          });
        }
      }
    },
  });

  const handleDownload = useCallback(
    async (file: FileItem) => {
      // 强制下载辅助函数：将 blob 以 octet-stream 强制触发下载，避免浏览器 inline 打开
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
        const result = await getPresignedDownloadUrl(file.id);
        const { url, fileName, useProxy } = result;

        // 统一使用 fetch + blob 方式下载，避免跨域时 <a download> 属性无效导致浏览器直接打开
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('download failed');
        const blob = await resp.blob();
        forceBlobDownload(blob, fileName || file.name);
      } catch {
        try {
          const downloadToken = token || useAuthStore.getState().token;
          const downloadUrl = filesApi.downloadUrl(file.id, downloadToken ?? undefined);
          const resp = await fetch(downloadUrl);
          if (!resp.ok) throw new Error('download failed');
          const blob = await resp.blob();
          forceBlobDownload(blob, file.name);
        } catch {
          toast({ title: '下载失败', variant: 'destructive' });
        }
      }
    },
    [toast, token]
  );

  const handleFileClick = useCallback(
    (file: FileItem) => {
      if (file.isFolder) {
        clearSelection();
        navigate(`/files/${file.id}`);
      } else setPreviewFile(file);
    },
    [clearSelection, navigate, setPreviewFile]
  );

  const handlePaste = useCallback(() => {
    if (!clipboard || clipboard.files.length === 0) return;
    const fileIds = clipboard.files.map((f) => f.id);
    if (clipboard.type === 'cut') {
      batchMoveMutation.mutate({ fileIds, targetParentId: folderId || null });
    } else {
      batchCopyMutation.mutate({ fileIds, targetParentId: folderId || null });
    }
  }, [clipboard, folderId, batchMoveMutation, batchCopyMutation]);

  const handleBatchDelete = useCallback(() => {
    if (!selectedFiles.length) return;
    if (!confirm(`确定将选中的 ${selectedFiles.length} 个项目移入回收站？`)) return;
    batchDeleteMutation.mutate(selectedFiles);
  }, [selectedFiles, batchDeleteMutation]);

  const handleSort = useCallback(
    (field: typeof sortBy) => setSort(field, sortBy === field ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc'),
    [sortBy, sortOrder, setSort]
  );

  const { ContextMenuComponent, handleContextMenu } = useFileContextMenu();

  const fileContextMenuCallbacks = {
    onOpen: handleFileClick,
    onDownload: handleDownload,
    onShare: (file: FileItem) => {
      setShareFileItem({ id: file.id, isFolder: file.isFolder });
      setShareFileId(file.id);
    },
    onUploadLink: (file: FileItem) => {
      if (file.isFolder) {
        setUploadLinkFolder({ id: file.id, name: file.name });
      }
    },
    onDirectLink: (file: FileItem) => {
      if (!file.isFolder) {
        setDirectLinkFile({ id: file.id, name: file.name });
      }
    },
    onVersionHistory: (file: FileItem) => {
      if (!file.isFolder) {
        setVersionHistoryFile(file);
      }
    },
    onTags: (file: FileItem) => setTagsFile(file),
    onPermissions: (file: FileItem) => setPermissionFile(file),
    onFolderSettings: (file: FileItem) => setFolderSettingsFile(file),
    onRename: (file: FileItem) => setRenameFile(file),
    onMove: (file: FileItem) => setMoveFile(file),
    onCopy: (file: FileItem) => {
      setClipboard('copy', [file], folderId || null);
      toast({ title: '已复制到剪贴板' });
    },
    onCut: (file: FileItem) => {
      setClipboard('cut', [file], folderId || null);
      toast({ title: '已剪切到剪贴板' });
    },
    onDelete: (file: FileItem) => {
      if (confirm(`将 "${decodeFileName(file.name)}" 移入回收站？`)) {
        deleteMutation.mutate(file.id);
      }
    },
  };

  const backgroundContextMenuCallbacks = {
    onRefresh: () => refetch(),
    onSelectAll: () => selectAll(displayFiles),
    onUpload: () => fileInputRef.current?.click(),
    onNewFolder: () => setShowNewFolderDialog(true),
    onNewFile: () => setShowNewFileDialog(true),
    onPaste: handlePaste,
    hasClipboard: !!clipboard && clipboard.files.length > 0,
    clipboardCount: clipboard?.files.length || 0,
  };

  const onContextMenu = useCallback(
    (e: React.MouseEvent, file?: FileItem) => {
      handleContextMenu(e, file, fileContextMenuCallbacks, backgroundContextMenuCallbacks);
    },
    [handleContextMenu, fileContextMenuCallbacks, backgroundContextMenuCallbacks]
  );

  useFileKeyboardShortcuts({
    onSelectAll: () => selectAll(displayFiles),
    onClearSelection: clearSelection,
    onDelete: handleBatchDelete,
    onRename: () => {
      const file = selectedFileItems[0];
      if (selectedFileItems.length === 1 && file) {
        setRenameFile(file);
      }
    },
    onOpen: () => {
      const file = selectedFileItems[0];
      if (selectedFileItems.length === 1 && file) {
        handleFileClick(file);
      }
    },
    onNavigateUp: () => {
      const nextId = getNextFileId(displayFiles, 'up');
      if (nextId) {
        setFocusedFile(nextId);
        toggleFileSelection(nextId);
      }
    },
    onNavigateDown: () => {
      const nextId = getNextFileId(displayFiles, 'down');
      if (nextId) {
        setFocusedFile(nextId);
        toggleFileSelection(nextId);
      }
    },
    onNewFolder: () => setShowNewFolderDialog(true),
    onUpload: () => fileInputRef.current?.click(),
    onToggleGridView: () => {
      setViewMode('grid');
      setGalleryMode(false);
    },
    onToggleListView: () => {
      setViewMode('list');
      setGalleryMode(false);
    },
    onFocusSearch: () => searchInputRef.current?.focus(),
    selectedCount: selectedFiles.length,
    hasFiles: displayFiles.length > 0,
  });

  const activeUploads = Object.entries(uploadProgresses);

  const viewModes: { mode: ViewMode; icon: typeof List; label: string }[] = [
    { mode: 'list', icon: List, label: '列表' },
    { mode: 'grid', icon: Grid, label: '网格' },
    { mode: 'masonry', icon: Columns, label: '瀑布流' },
  ];

  const handleShareConfirm = useCallback(
    (params: { password?: string; expiresAt?: string; downloadLimit?: number }) => {
      if (!shareFileId) return;
      shareMutation.mutate({ fileId: shareFileId, ...params }, { onSuccess: () => setShareFileId(null) });
    },
    [shareFileId, shareMutation, setShareFileId]
  );

  return (
    <div className="space-y-5" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <ContextMenuComponent />

      {isDragActive && (
        <div className="fixed inset-0 z-50 bg-primary/10 flex items-center justify-center pointer-events-none">
          <div className="bg-card border-2 border-dashed border-primary rounded-xl p-12 text-center shadow-2xl">
            <Upload className="h-14 w-14 mx-auto mb-4 text-primary" />
            <p className="text-lg font-semibold">松开上传（支持整个文件夹）</p>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-xl lg:text-2xl font-bold">文件管理</h1>
          <BreadcrumbNav items={breadcrumbs} />
        </div>

        <div className="flex items-center gap-2 flex-wrap md:hidden">
          <div className="relative w-full order-first">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="pl-8 pr-8 h-9 w-full rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder={tagSearchQuery ? `标签: ${tagSearchQuery}` : '搜索文件...'}
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
            />
            {(searchInput || tagSearchQuery) && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearchInput('');
                  setSearchQuery('');
                  setTagSearchQuery(null);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex border rounded-md overflow-hidden">
            {viewModes.map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                variant="ghost"
                size="icon"
                className={cn('rounded-none h-8 w-8', viewMode === mode && !galleryMode && 'bg-accent')}
                onClick={() => {
                  setViewMode(mode);
                  setGalleryMode(false);
                }}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
            {hasImages && (
              <Button
                variant="ghost"
                size="icon"
                className={cn('rounded-none h-8 w-8 border-l', galleryMode && 'bg-accent')}
                onClick={() => setGalleryMode(true)}
                title="图库"
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowNewFileDialog(true)}>
            <FilePlus className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowNewFolderDialog(true)}>
            <FolderPlus className="h-4 w-4" />
          </Button>
          <label className="inline-flex">
            <Button variant="outline" size="sm" asChild>
              <span>
                <Upload className="h-4 w-4" />
              </span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => {
                Array.from(e.target.files || []).forEach((file) => {
                  const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                  handleUpload(file, key);
                });
                e.target.value = '';
              }}
            />
          </label>
          <label className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              asChild
              disabled={!currentFolderInfo?.permissions?.some((p) => p.permission === 'write')}
            >
              <span>
                <FolderInput className="h-4 w-4" />
              </span>
            </Button>
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                const rootFolderName = (files[0] as any).webkitRelativePath?.split('/')[0] || '文件夹';
                toast({
                  title: `开始上传文件夹 "${rootFolderName}"`,
                  description: `${files.length} 个文件`,
                });
                uploadFilesWithRelativePath(files);
                e.target.value = '';
              }}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectAll(displayFiles)}
            disabled={displayFiles.length === 0}
          >
            <CheckSquare className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="hidden md:flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={searchInputRef}
              className={cn(
                'pl-8 pr-16 h-9 w-40 sm:w-52 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring',
                tagSearchQuery && 'border-primary ring-2 ring-primary/20'
              )}
              placeholder={tagSearchQuery ? `标签: ${tagSearchQuery}` : '搜索文件...'}
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              onBlur={() =>
                setTimeout(() => {
                  setShowSuggestions(false);
                  setShowSearchHistory(false);
                }, 200)
              }
              onFocus={() => {
                if (searchInput.length >= 2 && searchSuggestions.length > 0) {
                  setShowSuggestions(true);
                } else if (searchInput.length === 0) {
                  refetchHistory();
                  setShowSearchHistory(true);
                }
              }}
            />
            {(searchInput || tagSearchQuery) && (
              <button
                className="absolute right-9 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearchInput('');
                  setSearchQuery('');
                  setTagSearchQuery(null);
                  setShowSuggestions(false);
                  setShowSearchHistory(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              className={cn(
                'absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors',
                showAdvancedSearch ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
              title="高级搜索"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            {/* 自动补全建议 */}
            {showSuggestions && searchSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg z-50 max-h-48 overflow-auto">
                {searchSuggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
                    onMouseDown={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {/* 搜索历史下拉（仅输入框为空时显示） */}
            {showSearchHistory &&
              !showSuggestions &&
              searchInput.length === 0 &&
              (searchHistoryData?.length ?? 0) > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg z-50 max-h-56 overflow-auto">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <History className="h-3 w-3" />
                      搜索历史
                    </span>
                    <button
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      onMouseDown={async () => {
                        await searchApi.clearHistory();
                        refetchHistory();
                        setShowSearchHistory(false);
                      }}
                    >
                      清空
                    </button>
                  </div>
                  {searchHistoryData?.map((item) => (
                    <div key={item.id} className="flex items-center group hover:bg-muted/50 transition-colors">
                      <button
                        className="flex-1 px-3 py-2 text-left text-sm"
                        onMouseDown={() => {
                          handleSuggestionClick(item.query);
                          setShowSearchHistory(false);
                        }}
                      >
                        {item.query}
                      </button>
                      <button
                        className="px-2 py-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                        onMouseDown={async (e) => {
                          e.stopPropagation();
                          await searchApi.deleteHistory(item.id);
                          refetchHistory();
                        }}
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
          </div>

          {showAdvancedSearch && (
            <div className="flex items-center gap-2 p-2 bg-muted/30 border rounded-md">
              <select
                className="h-7 px-2 text-xs border rounded bg-background"
                value={advancedLogic}
                onChange={(e) => setAdvancedLogic(e.target.value as 'and' | 'or')}
              >
                <option value="and">且</option>
                <option value="or">或</option>
              </select>
              <button
                className="h-7 px-2 text-xs border rounded bg-background hover:bg-muted/50"
                onClick={() => {
                  setAdvancedConditions([...advancedConditions, { field: 'name', operator: 'contains', value: '' }]);
                }}
              >
                + 添加条件
              </button>
              {advancedConditions.length > 0 && (
                <button
                  className="h-7 px-2 text-xs border rounded bg-background hover:bg-muted/50"
                  onClick={() => setAdvancedConditions([])}
                >
                  清除
                </button>
              )}
            </div>
          )}

          {advancedConditions.map((condition, idx) => (
            <div key={idx} className="flex items-center gap-1 p-1.5 bg-muted/20 border rounded text-xs">
              <select
                className="h-6 px-1.5 border rounded bg-background"
                value={condition.field}
                onChange={(e) => {
                  const newConditions = [...advancedConditions];
                  newConditions[idx] = { ...condition, field: e.target.value as any };
                  setAdvancedConditions(newConditions);
                }}
              >
                <option value="name">文件名</option>
                <option value="mimeType">类型</option>
                <option value="size">大小</option>
                <option value="createdAt">创建时间</option>
                <option value="updatedAt">修改时间</option>
                <option value="tags">标签</option>
              </select>
              <select
                className="h-6 px-1.5 border rounded bg-background"
                value={condition.operator}
                onChange={(e) => {
                  const newConditions = [...advancedConditions];
                  newConditions[idx] = { ...condition, operator: e.target.value as any };
                  setAdvancedConditions(newConditions);
                }}
              >
                <option value="contains">包含</option>
                <option value="equals">等于</option>
                <option value="startsWith">开头是</option>
                <option value="endsWith">结尾是</option>
                {condition.field === 'size' && (
                  <>
                    <option value="gt">大于</option>
                    <option value="lt">小于</option>
                  </>
                )}
              </select>
              <input
                className="h-6 w-24 px-1.5 border rounded bg-background"
                value={condition.value as string}
                onChange={(e) => {
                  const newConditions = [...advancedConditions];
                  newConditions[idx] = { ...condition, value: e.target.value };
                  setAdvancedConditions(newConditions);
                }}
                placeholder="输入值..."
              />
              <button
                className="h-6 w-6 flex items-center justify-center hover:bg-muted/50 rounded"
                onClick={() => {
                  setAdvancedConditions(advancedConditions.filter((_, i) => i !== idx));
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {tagSearchQuery && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 border border-primary/20 rounded-md text-sm">
              <Tag className="h-3.5 w-3.5 text-primary" />
              <span className="text-primary font-medium">{tagSearchQuery}</span>
              <button onClick={clearTagSearch} className="ml-1 hover:bg-primary/20 rounded p-0.5">
                <X className="h-3 w-3 text-primary" />
              </button>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => handleSort('name')} className="hidden sm:flex gap-1">
            名称{' '}
            {sortBy === 'name' &&
              (sortOrder === 'asc' ? <SortAsc className="h-3.5 w-3.5" /> : <SortDesc className="h-3.5 w-3.5" />)}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleSort('size')} className="hidden sm:flex gap-1">
            大小{' '}
            {sortBy === 'size' &&
              (sortOrder === 'asc' ? <SortAsc className="h-3.5 w-3.5" /> : <SortDesc className="h-3.5 w-3.5" />)}
          </Button>

          <div className="flex border rounded-md overflow-hidden">
            {viewModes.map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                variant="ghost"
                size="icon"
                className={cn('rounded-none h-9 w-9', viewMode === mode && !galleryMode && 'bg-accent')}
                onClick={() => {
                  setViewMode(mode);
                  setGalleryMode(false);
                }}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
            {hasImages && (
              <Button
                variant="ghost"
                size="icon"
                className={cn('rounded-none h-9 w-9 border-l', galleryMode && 'bg-accent')}
                onClick={() => setGalleryMode(true)}
                title="图库"
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => selectAll(displayFiles)}
            disabled={displayFiles.length === 0}
          >
            <CheckSquare className="h-4 w-4 mr-1.5" />
            全选
          </Button>

          <Button variant="outline" size="sm" onClick={() => refetch()} title="刷新当前目录">
            <RefreshCw className="h-4 w-4" />
          </Button>

          <Button variant="outline" size="sm" onClick={() => setShowNewFileDialog(true)} className="hidden sm:flex">
            <FilePlus className="h-4 w-4 mr-1.5" />
            新建文件
          </Button>

          <Button variant="outline" size="sm" onClick={() => setShowNewFolderDialog(true)} className="hidden sm:flex">
            <FolderPlus className="h-4 w-4 mr-1.5" />
            新建文件夹
          </Button>

          <label className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              asChild
              disabled={!currentFolderInfo?.permissions?.some((p) => p.permission === 'write')}
            >
              <span>
                <Upload className="h-4 w-4 mr-1.5" />
                上传文件
              </span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => {
                Array.from(e.target.files || []).forEach((file) => {
                  const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                  handleUpload(file, key);
                });
                e.target.value = '';
              }}
            />
          </label>

          <label className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              asChild
              disabled={!currentFolderInfo?.permissions?.some((p) => p.permission === 'write')}
            >
              <span>
                <FolderInput className="h-4 w-4 mr-1.5" />
                上传文件夹
              </span>
            </Button>
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                const rootFolderName = (files[0] as any).webkitRelativePath?.split('/')[0] || '文件夹';
                const folderCount = new Set(
                  Array.from(files)
                    .map((f) => (f as any).webkitRelativePath?.split('/').slice(0, -1).join('/'))
                    .filter(Boolean)
                ).size;
                toast({
                  title: `开始上传文件夹 "${rootFolderName}"`,
                  description: `${folderCount} 个文件夹，${files.length} 个文件`,
                });
                uploadFilesWithRelativePath(files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-lg text-sm">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <span className="font-medium">已选中 {selectedFiles.length} 个</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={clearSelection}>
            <X className="h-3.5 w-3.5 mr-1" />
            取消
          </Button>
          <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={batchDeleteMutation.isPending}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            批量删除
          </Button>
        </div>
      )}

      {activeUploads.length > 0 && (
        <div className="space-y-2">
          {activeUploads.map(([key, progress]) => (
            <div key={key} className="bg-card border rounded-lg px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium truncate max-w-[200px]">
                  {decodeFileName(key.split('-').slice(0, -2).join('-'))}
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

      {showNewFolderDialog && (
        <NewFolderDialog
          isRoot={!folderId}
          name={newFolderName}
          bucketId={newFolderBucketId}
          onNameChange={setNewFolderName}
          onBucketChange={setNewFolderBucketId}
          onConfirm={() => {
            if (!newFolderName.trim()) return;
            createFolderMutation.mutate(
              {
                name: newFolderName.trim(),
                parentId: folderId || null,
                bucketId: newFolderBucketId,
              },
              {
                onSuccess: () => resetNewFolderDialog(),
              }
            );
          }}
          onCancel={resetNewFolderDialog}
          loading={createFolderMutation.isPending}
        />
      )}

      {showNewFileDialog && (
        <NewFileDialog
          isRoot={!folderId}
          name={newFileName}
          content={newFileContent}
          selectedExtension={newFileExtension}
          parentId={newFileParentId}
          onNameChange={setNewFileName}
          onContentChange={setNewFileContent}
          onExtensionChange={setNewFileExtension}
          onParentIdChange={setNewFileParentId}
          onConfirm={() => {
            if (!newFileName.trim()) return;
            const trimmedName = newFileName.trim();
            const finalName = trimmedName.includes('.') ? trimmedName : `${trimmedName}${newFileExtension}`;
            const selectedTemplate = FILE_TEMPLATES.find((t) => t.extension === newFileExtension);
            createFileMutation.mutate(
              {
                name: finalName,
                content: newFileContent,
                parentId: folderId || null,
                mimeType: selectedTemplate?.mimeType,
              },
              {
                onSuccess: () => resetNewFileDialog(),
              }
            );
          }}
          onCancel={resetNewFileDialog}
          loading={createFileMutation.isPending}
        />
      )}

      {shareFileId && (
        <ShareDialog
          fileId={shareFileId}
          isFolder={shareFileItem?.isFolder ?? false}
          isPending={shareMutation.isPending}
          onConfirm={handleShareConfirm}
          onCancel={() => {
            setShareFileId(null);
            setShareFileItem(null);
          }}
        />
      )}

      {/* Upload link folder picker */}
      {showFolderPicker && (
        <FolderPickerDialog
          onConfirm={(id, name) => {
            setUploadLinkFolder({ id, name });
            setShowFolderPicker(false);
          }}
          onCancel={() => setShowFolderPicker(false)}
        />
      )}

      {/* Upload link config dialog */}
      {uploadLinkFolder && (
        <UploadLinkDialog
          folderId={uploadLinkFolder.id}
          folderName={uploadLinkFolder.name}
          isPending={createUploadLinkMutation.isPending}
          onConfirm={(params) => createUploadLinkMutation.mutate({ folderId: uploadLinkFolder.id, ...params })}
          onCancel={() => setUploadLinkFolder(null)}
        />
      )}

      {/* Migrate bucket dialog */}
      {showMigrateDialog && <MigrateBucketDialog onClose={() => setShowMigrateDialog(false)} />}

      {/* Direct link dialog */}
      {directLinkFile && (
        <DirectLinkDialog
          fileId={directLinkFile.id}
          fileName={directLinkFile.name}
          onClose={() => setDirectLinkFile(null)}
        />
      )}

      {/* Version history dialog */}
      {versionHistoryFile && (
        <VersionHistory
          fileId={versionHistoryFile.id}
          fileName={versionHistoryFile.name}
          mimeType={versionHistoryFile.mimeType}
          onClose={() => setVersionHistoryFile(null)}
          onVersionRestored={() => {
            refetch();
            toast({ title: '版本已恢复' });
          }}
        />
      )}

      {renameFile && (
        <RenameDialog
          currentName={renameFile.name}
          isPending={renameMutation.isPending}
          onConfirm={(name) =>
            renameMutation.mutate({ id: renameFile.id, name }, { onSuccess: () => setRenameFile(null) })
          }
          onCancel={() => setRenameFile(null)}
        />
      )}

      {moveFile && (
        <MoveFolderPicker
          excludeIds={[moveFile.id]}
          isPending={moveMutation.isPending}
          onConfirm={(targetParentId) =>
            moveMutation.mutate({ id: moveFile.id, targetParentId }, { onSuccess: () => setMoveFile(null) })
          }
          onCancel={() => setMoveFile(null)}
        />
      )}

      {previewFile && (
        <FilePreview
          file={previewFile}
          token={token || ''}
          onClose={() => setPreviewFile(null)}
          onDownload={handleDownload}
          onShare={(id) => {
            setPreviewFile(null);
            setShareFileId(id);
          }}
        />
      )}

      {tagsFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">标签管理</h2>
              <button onClick={() => setTagsFile(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4 truncate">文件: {decodeFileName(tagsFile.name)}</p>
            <FileTagsManager fileId={tagsFile.id} />
            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={() => setTagsFile(null)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}

      {permissionFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">权限管理</h2>
              <button onClick={() => setPermissionFile(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4 truncate">文件: {decodeFileName(permissionFile.name)}</p>
            <FilePermissionManager fileId={permissionFile.id} isOwner={true} />
            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={() => setPermissionFile(null)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}

      {folderSettingsFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">文件夹设置</h2>
              <button
                onClick={() => setFolderSettingsFile(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4 truncate">
              文件夹: {decodeFileName(folderSettingsFile.name)}
            </p>
            <FolderSettings
              folderId={folderSettingsFile.id}
              folderName={decodeFileName(folderSettingsFile.name)}
              currentAllowedTypes={
                (folderSettingsFile as any).allowedMimeTypes
                  ? JSON.parse((folderSettingsFile as any).allowedMimeTypes)
                  : null
              }
              onClose={() => setFolderSettingsFile(null)}
            />
          </div>
        </div>
      )}

      <FileListContainer
        viewMode={viewMode}
        galleryMode={galleryMode}
        displayFiles={displayFiles}
        imageFiles={imageFiles}
        isLoading={isLoading}
        searchQuery={searchQuery}
        selectedFiles={selectedFiles}
        fileTagsMap={fileTagsMap}
        token={token || ''}
        onFileClick={handleFileClick}
        onToggleSelect={toggleFileSelection}
        onDownload={handleDownload}
        onShare={(id) => {
          // Find file in displayFiles to get isFolder
          const f = displayFiles.find((x) => x.id === id);
          setShareFileItem(f ? { id, isFolder: f.isFolder } : { id, isFolder: false });
          setShareFileId(id);
        }}
        onDelete={(file) => deleteMutation.mutate(file.id)}
        onRename={setRenameFile}
        onPreview={setPreviewFile}
        onMove={setMoveFile}
        onContextMenu={onContextMenu}
        onTagClick={handleTagClick}
        onUploadLink={(file) => {
          if (file.isFolder) {
            setUploadLinkFolder({ id: file.id, name: file.name });
          }
        }}
        onDirectLink={(file) => {
          if (!file.isFolder) {
            setDirectLinkFile({ id: file.id, name: file.name });
          }
        }}
        onVersionHistory={(file) => {
          if (!file.isFolder) {
            setVersionHistoryFile(file);
          }
        }}
      />
    </div>
  );
}
