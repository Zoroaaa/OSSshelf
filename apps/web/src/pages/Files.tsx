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

import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFileStore, type ViewMode } from '@/stores/files';
import { useAuthStore } from '@/stores/auth';
import { filesApi, shareApi, bucketsApi, PROVIDER_META, type StorageBucket, permissionsApi, searchApi, batchApi } from '@/services/api';
import { presignUpload } from '@/services/presignUpload';
import { useFolderUpload } from '@/hooks/useFolderUpload';
import { useFileKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useResponsive } from '@/hooks/useResponsive';
import { useContextMenuState, ContextMenuItem } from '@/components/ui/ContextMenu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileIcon } from '@/components/ui/FileIcon';
import { BreadcrumbNav, type BreadcrumbItem } from '@/components/ui/BreadcrumbNav';
import { FilePreview } from '@/components/ui/FilePreview';
import { RenameDialog } from '@/components/ui/RenameDialog';
import { MoveFolderPicker } from '@/components/ui/MoveFolderPicker';
import { FileTagsManager } from '@/components/ui/FileTagsManager';
import { FileTagsDisplay } from '@/components/ui/FileTagsDisplay';
import { FilePermissionManager } from '@/components/ui/FilePermissionManager';
import { FolderSettings } from '@/components/ui/FolderSettings';
import { useToast } from '@/components/ui/use-toast';
import { formatBytes, formatDate } from '@/utils';
import { getFileCategory, getCategoryBg, isPreviewable } from '@/utils/fileTypes';
import { uploadManager, setupBeforeUnloadWarning, removeBeforeUnloadWarning } from '@/services/uploadManager';
import {
  Upload, FolderPlus, Grid, List, Download, Trash2, Share2,
  Search, X, Pencil, Eye, CheckSquare, Square, SortAsc, SortDesc,
  Image as ImageIcon, FolderInput, Database, MoreVertical,
  Copy, Scissors, Clipboard, RefreshCw, Columns, LayoutGrid,
  CheckCircle2, Tag, AlertTriangle, Shield, Settings, SlidersHorizontal,
  User,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import type { FileItem } from '@osshelf/shared';
import { cn } from '@/utils';

function NewFolderDialog({
  isRoot, name, bucketId, onNameChange, onBucketChange, onConfirm, onCancel, loading,
}: {
  isRoot: boolean;
  name: string;
  bucketId: string | null;
  onNameChange: (v: string) => void;
  onBucketChange: (v: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  const { data: buckets = [] } = useQuery({
    queryKey: ['buckets'],
    queryFn: () => bucketsApi.list().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  const selected = (buckets as StorageBucket[]).find((b) => b.id === bucketId);
  const defaultBucket = (buckets as StorageBucket[]).find((b) => b.isDefault);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4">
        <h2 className="text-lg font-semibold">新建文件夹</h2>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">文件夹名称</label>
          <Input
            placeholder="输入文件夹名称"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onConfirm()}
            autoFocus
          />
        </div>

        {isRoot && (buckets as StorageBucket[]).length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              绑定存储桶
            </label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-lg border divide-y">
              <button
                type="button"
                onClick={() => onBucketChange(null)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
                  !bucketId ? 'bg-primary/5 text-primary font-medium' : 'hover:bg-muted/50 text-muted-foreground'
                )}
              >
                <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0', !bucketId ? 'border-primary' : 'border-muted-foreground/30')}>
                  {!bucketId && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <span className="flex-1">
                  使用默认桶{defaultBucket ? `（${defaultBucket.name}）` : ''}
                </span>
              </button>
              {(buckets as StorageBucket[]).filter((b) => b.isActive).map((b) => {
                const meta = PROVIDER_META[b.provider];
                const isSelected = bucketId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onBucketChange(b.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors',
                      isSelected ? 'bg-primary/5 text-primary font-medium' : 'hover:bg-muted/50'
                    )}
                  >
                    <div className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0', isSelected ? 'border-primary' : 'border-muted-foreground/30')}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <span className="text-base">{meta.icon}</span>
                    <span className="flex-1 truncate">{b.name}</span>
                    {b.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">默认</span>
                    )}
                  </button>
                );
              })}
            </div>
            {selected && (
              <p className="text-xs text-muted-foreground">
                此文件夹及其中的文件将存储到「{selected.name}」
              </p>
            )}
            {!bucketId && (
              <p className="text-xs text-muted-foreground">
                未指定时使用默认存储桶
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCancel} disabled={loading}>取消</Button>
          <Button onClick={onConfirm} disabled={loading || !name.trim()}>
            {loading ? '创建中…' : '创建'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Files() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { token } = useAuthStore();
  const { isMobile } = useResponsive();
  const {
    viewMode, setViewMode, selectedFiles, selectedFileItems,
    toggleFileSelection, clearSelection, selectAll,
    sortBy, sortOrder, setSort, searchQuery, setSearchQuery,
    clipboard, setClipboard, clearClipboard,
    focusedFileId, setFocusedFile, getNextFileId,
  } = useFileStore();

  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderBucketId, setNewFolderBucketId] = useState<string | null>(null);
  const [uploadProgresses, setUploadProgresses] = useState<Record<string, number>>({});
  const [shareFileId, setShareFileId] = useState<string | null>(null);
  const [sharePassword, setSharePassword] = useState('');
  const [shareExpiresDays, setShareExpiresDays] = useState<number | ''>('');
  const [shareDownloadLimit, setShareDownloadLimit] = useState<number | ''>('');
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [galleryMode, setGalleryMode] = useState(false);
  const [tagsFile, setTagsFile] = useState<FileItem | null>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState<string | null>(null);
  const [permissionFile, setPermissionFile] = useState<FileItem | null>(null);
  const [recursiveSearch, setRecursiveSearch] = useState(false);
  const [folderSettingsFile, setFolderSettingsFile] = useState<FileItem | null>(null);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [advancedConditions, setAdvancedConditions] = useState<Array<{
    field: 'name' | 'mimeType' | 'size' | 'createdAt' | 'updatedAt' | 'tags';
    operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
    value: string | number | string[];
  }>>([]);
  const [advancedLogic, setAdvancedLogic] = useState<'and' | 'or'>('and');
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { openContextMenu, closeContextMenu, ContextMenuComponent } = useContextMenuState();

  const { uploadFolderEntries } = useFolderUpload({
    currentFolderId: folderId,
    onFileStart: (name, key) => setUploadProgresses((p) => ({ ...p, [key]: 0 })),
    onFileProgress: (key, progress) => setUploadProgresses((p) => ({ ...p, [key]: progress })),
    onFileDone: (key) => {
      setUploadProgresses((p) => { const n = { ...p }; delete n[key]; return n; });
      toast({ title: '上传成功' });
    },
    onFileError: (key, e: any) => {
      setUploadProgresses((p) => { const n = { ...p }; delete n[key]; return n; });
      toast({ title: '上传失败', description: e?.response?.data?.error?.message, variant: 'destructive' });
    },
    onAllDone: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

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

  const { data: files = [], isLoading, refetch } = useQuery<FileItem[]>({
    queryKey: ['files', folderId],
    queryFn: () => filesApi.list({ parentId: folderId || null }).then((r) => r.data.data ?? []),
  });

  const { data: tagSearchResults, isLoading: isTagSearchLoading } = useQuery<FileItem[]>({
    queryKey: ['tag-search', tagSearchQuery],
    queryFn: async () => {
      if (!tagSearchQuery) return [];
      const res = await searchApi.query({ tags: [tagSearchQuery] });
      return res.data.data?.items ?? [];
    },
    enabled: !!tagSearchQuery,
  });

  const { data: recursiveSearchResults, isLoading: isRecursiveSearchLoading } = useQuery<FileItem[]>({
    queryKey: ['recursive-search', folderId, searchQuery],
    queryFn: async () => {
      if (!searchQuery || !recursiveSearch) return [];
      const res = await searchApi.query({
        query: searchQuery,
        parentId: folderId || undefined,
        recursive: true,
      });
      return res.data.data?.items ?? [];
    },
    enabled: !!searchQuery && recursiveSearch,
  });

  const { data: advancedSearchResults, isLoading: isAdvancedSearchLoading } = useQuery<FileItem[]>({
    queryKey: ['advanced-search', advancedConditions, advancedLogic],
    queryFn: async () => {
      if (advancedConditions.length === 0) return [];
      const res = await searchApi.advanced({
        conditions: advancedConditions,
        logic: advancedLogic,
      });
      return res.data.data?.items ?? [];
    },
    enabled: advancedConditions.length > 0 && showAdvancedSearch,
  });

  const handleSearchInput = useCallback(async (value: string) => {
    setSearchInput(value);
    setSearchQuery(value);
    if (tagSearchQuery) setTagSearchQuery(null);
    
    if (value.length >= 2) {
      try {
        const res = await searchApi.suggestions({ q: value, type: 'name' });
        setSearchSuggestions(res.data.data ?? []);
        setShowSuggestions(true);
      } catch {
        setSearchSuggestions([]);
      }
    } else {
      setSearchSuggestions([]);
      setShowSuggestions(false);
    }
  }, [tagSearchQuery]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setSearchInput(suggestion);
    setSearchQuery(suggestion);
    setShowSuggestions(false);
  }, []);

  const handleTagClick = useCallback((tagName: string) => {
    setTagSearchQuery(tagName);
    setSearchQuery(tagName);
    setSearchInput(tagName);
  }, []);

  const clearTagSearch = useCallback(() => {
    setTagSearchQuery(null);
    setSearchQuery('');
    setSearchInput('');
  }, []);

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
      : recursiveSearch && recursiveSearchResults
        ? (recursiveSearchResults ?? [])
        : [...files]
            .filter((f) => !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .sort((a, b) => {
              if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
              const av = (a as any)[sortBy] ?? '', bv = (b as any)[sortBy] ?? '';
              return sortOrder === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
            });

  const imageFiles = displayFiles.filter((f) => f.mimeType?.startsWith('image/'));
  const hasImages = imageFiles.length > 0;

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => filesApi.createFolder(name, folderId, !folderId ? newFolderBucketId : null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', folderId] });
      setShowNewFolderDialog(false); setNewFolderName(''); setNewFolderBucketId(null);
      toast({ title: '创建成功' });
    },
    onError: (e: any) => toast({ title: '创建失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ file, parentId, key }: { file: File; parentId: string | null; key: string }) =>
      presignUpload({
        file,
        parentId,
        onProgress: (p) => setUploadProgresses((prev) => ({ ...prev, [key]: p })),
        onFallback: () => {},
      }),
    onSuccess: (_, { key }) => {
      queryClient.invalidateQueries({ queryKey: ['files', folderId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setUploadProgresses((p) => { const n = { ...p }; delete n[key]; return n; });
      toast({ title: '上传成功' });
    },
    onError: (e: any, { key }) => {
      setUploadProgresses((p) => { const n = { ...p }; delete n[key]; return n; });
      toast({ title: '上传失败', description: e?.message || e?.response?.data?.error?.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => filesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', folderId] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      clearSelection();
      toast({ title: '已移入回收站' });
    },
    onError: (e: any) => toast({ title: '删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => filesApi.update(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', folderId] });
      setRenameFile(null);
      toast({ title: '重命名成功' });
    },
    onError: (e: any) => toast({ title: '重命名失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, targetParentId }: { id: string; targetParentId: string | null }) =>
      filesApi.move(id, targetParentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      setMoveFile(null);
      toast({ title: '移动成功' });
    },
    onError: (e: any) => toast({ title: '移动失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const shareMutation = useMutation({
    mutationFn: ({ fileId, password, expiresAt, downloadLimit }: {
      fileId: string; password?: string; expiresAt?: string; downloadLimit?: number;
    }) => shareApi.create({ fileId, password, expiresAt, downloadLimit }),
    onSuccess: (res) => {
      const shareId = res.data.data?.id;
      if (shareId) {
        const url = `${window.location.origin}/share/${shareId}`;
        navigator.clipboard.writeText(url).then(() => toast({ title: '分享链接已复制', description: url }));
      }
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      setShareFileId(null); setSharePassword(''); setShareExpiresDays(''); setShareDownloadLimit('');
    },
    onError: (e: any) => toast({ title: '创建分享失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const onDrop = useCallback(
    (acceptedFiles: File[], _rejected: any[], event: any) => {
      const nativeEvent = event?.nativeEvent ?? event;
      const items = nativeEvent?.dataTransfer?.items as DataTransferItemList | undefined;

      const hasFolder = items
        ? Array.from(items).some((item) => {
            const entry = item.webkitGetAsEntry?.();
            return entry?.isDirectory;
          })
        : false;

      if (hasFolder && items) {
        uploadFolderEntries(items);
      } else {
        acceptedFiles.forEach((file) => {
          const key = `${file.name}-${Date.now()}`;
          uploadMutation.mutate({ file, parentId: folderId || null, key });
        });
      }
    },
    [folderId, uploadMutation, uploadFolderEntries]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, noClick: true });

  const handleDownload = async (file: FileItem) => {
    try {
      const { url, fileName } = await import('@/services/presignUpload').then(m =>
        m.getPresignedDownloadUrl(file.id)
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || file.name;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      try {
        const res = await filesApi.download(file.id);
        const url = window.URL.createObjectURL(res.data as Blob);
        const a = document.createElement('a');
        a.href = url; a.download = file.name;
        document.body.appendChild(a); a.click();
        window.URL.revokeObjectURL(url); a.remove();
      } catch {
        toast({ title: '下载失败', variant: 'destructive' });
      }
    }
  };

  const handleFileClick = (file: FileItem) => {
    if (file.isFolder) { clearSelection(); navigate(`/files/${file.id}`); }
    else setPreviewFile(file);
  };

  const batchDeleteMutation = useMutation({
    mutationFn: (fileIds: string[]) => batchApi.delete(fileIds),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['files', folderId] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      clearSelection();
      const data = res.data.data;
      toast({ 
        title: '批量删除完成', 
        description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个` 
      });
    },
    onError: (e: any) => toast({ title: '批量删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const batchMoveMutation = useMutation({
    mutationFn: ({ fileIds, targetParentId }: { fileIds: string[]; targetParentId: string | null }) =>
      batchApi.move(fileIds, targetParentId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      clearClipboard();
      const data = res.data.data;
      toast({ 
        title: '批量移动完成', 
        description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个` 
      });
    },
    onError: (e: any) => toast({ title: '批量移动失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const batchCopyMutation = useMutation({
    mutationFn: ({ fileIds, targetParentId }: { fileIds: string[]; targetParentId: string | null }) =>
      batchApi.copy(fileIds, targetParentId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      clearClipboard();
      const data = res.data.data;
      toast({ 
        title: '批量复制完成', 
        description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个` 
      });
    },
    onError: (e: any) => toast({ title: '批量复制失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const handlePaste = useCallback(() => {
    if (!clipboard || clipboard.files.length === 0) return;
    const fileIds = clipboard.files.map(f => f.id);
    if (clipboard.type === 'cut') {
      batchMoveMutation.mutate({ fileIds, targetParentId: folderId || null });
    } else {
      batchCopyMutation.mutate({ fileIds, targetParentId: folderId || null });
    }
  }, [clipboard, folderId, batchMoveMutation, batchCopyMutation]);

  const handleBatchDelete = () => {
    if (!selectedFiles.length) return;
    if (!confirm(`确定将选中的 ${selectedFiles.length} 个项目移入回收站？`)) return;
    batchDeleteMutation.mutate(selectedFiles);
  };

  const handleSort = (field: typeof sortBy) =>
    setSort(field, sortBy === field ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc');

  const handleShare = () => {
    if (!shareFileId) return;
    const expiresAt = shareExpiresDays
      ? new Date(Date.now() + Number(shareExpiresDays) * 86400000).toISOString()
      : undefined;
    shareMutation.mutate({ fileId: shareFileId, password: sharePassword || undefined, expiresAt, downloadLimit: shareDownloadLimit ? Number(shareDownloadLimit) : undefined });
  };

  const getFileContextMenuItems = useCallback((file: FileItem): ContextMenuItem[] => {
    const canPreview = !file.isFolder && isPreviewable(file.mimeType);
    
    return [
      {
        id: 'open',
        label: file.isFolder ? '打开文件夹' : '打开',
        icon: <Eye className="h-4 w-4" />,
        action: () => handleFileClick(file),
      },
      { id: 'divider1', label: '', divider: true },
      {
        id: 'download',
        label: '下载',
        icon: <Download className="h-4 w-4" />,
        action: () => handleDownload(file),
        disabled: file.isFolder,
      },
      {
        id: 'share',
        label: '分享',
        icon: <Share2 className="h-4 w-4" />,
        action: () => setShareFileId(file.id),
        disabled: file.isFolder,
      },
      {
        id: 'tags',
        label: '标签管理',
        icon: <Tag className="h-4 w-4" />,
        action: () => setTagsFile(file),
      },
      {
        id: 'permissions',
        label: '权限管理',
        icon: <Shield className="h-4 w-4" />,
        action: () => setPermissionFile(file),
      },
      {
        id: 'folderSettings',
        label: '文件夹设置',
        icon: <Settings className="h-4 w-4" />,
        action: () => setFolderSettingsFile(file),
        disabled: !file.isFolder,
      },
      { id: 'divider2', label: '', divider: true },
      {
        id: 'rename',
        label: '重命名',
        icon: <Pencil className="h-4 w-4" />,
        shortcut: 'F2',
        action: () => setRenameFile(file),
      },
      {
        id: 'move',
        label: '移动到...',
        icon: <FolderInput className="h-4 w-4" />,
        action: () => setMoveFile(file),
      },
      {
        id: 'copy',
        label: '复制',
        icon: <Copy className="h-4 w-4" />,
        shortcut: 'Ctrl+C',
        action: () => {
          setClipboard('copy', [file], folderId || null);
          toast({ title: '已复制到剪贴板' });
        },
      },
      {
        id: 'cut',
        label: '剪切',
        icon: <Scissors className="h-4 w-4" />,
        shortcut: 'Ctrl+X',
        action: () => {
          setClipboard('cut', [file], folderId || null);
          toast({ title: '已剪切到剪贴板' });
        },
      },
      { id: 'divider3', label: '', divider: true },
      {
        id: 'delete',
        label: '移入回收站',
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        action: () => {
          if (confirm(`将 "${file.name}" 移入回收站？`)) {
            deleteMutation.mutate(file.id);
          }
        },
      },
    ];
  }, [folderId, deleteMutation, setClipboard, toast]);

  const getBackgroundContextMenuItems = useCallback((): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: 'refresh',
        label: '刷新',
        icon: <RefreshCw className="h-4 w-4" />,
        action: () => refetch(),
      },
      { id: 'divider1', label: '', divider: true },
      {
        id: 'selectAll',
        label: '全选',
        icon: <CheckSquare className="h-4 w-4" />,
        shortcut: 'Ctrl+A',
        action: () => selectAll(displayFiles),
      },
      {
        id: 'upload',
        label: '上传文件',
        icon: <Upload className="h-4 w-4" />,
        shortcut: 'Ctrl+U',
        action: () => fileInputRef.current?.click(),
      },
      {
        id: 'newFolder',
        label: '新建文件夹',
        icon: <FolderPlus className="h-4 w-4" />,
        shortcut: 'Ctrl+Shift+N',
        action: () => setShowNewFolderDialog(true),
      },
    ];

    if (clipboard && clipboard.files.length > 0) {
      items.push(
        { id: 'divider2', label: '', divider: true },
        {
          id: 'paste',
          label: `粘贴 (${clipboard.files.length} 个项目)`,
          icon: <Clipboard className="h-4 w-4" />,
          shortcut: 'Ctrl+V',
          action: handlePaste,
        }
      );
    }

    return items;
  }, [refetch, clipboard, toast, selectAll, displayFiles, handlePaste]);

  const handleContextMenu = (e: React.MouseEvent, file?: FileItem) => {
    if (file) {
      openContextMenu(e, getFileContextMenuItems(file));
    } else {
      openContextMenu(e, getBackgroundContextMenuItems());
    }
  };

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
    onToggleGridView: () => { setViewMode('grid'); setGalleryMode(false); },
    onToggleListView: () => { setViewMode('list'); setGalleryMode(false); },
    onFocusSearch: () => searchInputRef.current?.focus(),
    selectedCount: selectedFiles.length,
    hasFiles: displayFiles.length > 0,
  });

  const activeUploads = Object.entries(uploadProgresses);
  const hasActiveUploads = activeUploads.length > 0;

  useEffect(() => {
    if (hasActiveUploads) {
      setupBeforeUnloadWarning();
    } else {
      removeBeforeUnloadWarning();
    }
    return () => {
      removeBeforeUnloadWarning();
    };
  }, [hasActiveUploads]);

  const viewModes: { mode: ViewMode; icon: typeof List; label: string }[] = [
    { mode: 'list', icon: List, label: '列表' },
    { mode: 'grid', icon: Grid, label: '网格' },
    { mode: 'masonry', icon: Columns, label: '瀑布流' },
  ];

  return (
    <div {...getRootProps()} className="space-y-5">
      <input {...getInputProps()} />
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
        
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={searchInputRef}
              className={cn(
                "pl-8 pr-16 h-9 w-40 sm:w-52 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring",
                tagSearchQuery && "border-primary ring-2 ring-primary/20"
              )}
              placeholder={tagSearchQuery ? `标签: ${tagSearchQuery}` : "搜索文件..."}
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              onFocus={() => searchInput.length >= 2 && searchSuggestions.length > 0 && setShowSuggestions(true)}
            />
            {(searchInput || tagSearchQuery) && (
              <button className="absolute right-9 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => { setSearchInput(''); setSearchQuery(''); setTagSearchQuery(null); setShowSuggestions(false); }}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors",
                showAdvancedSearch ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
              title="高级搜索"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
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
          
          <button
            onClick={() => setRecursiveSearch(!recursiveSearch)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors border",
              recursiveSearch
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-muted/50 border-transparent text-muted-foreground hover:text-foreground"
            )}
            title={recursiveSearch ? "当前：递归搜索子目录" : "点击启用递归搜索子目录"}
          >
            <FolderInput className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">递归</span>
          </button>
          
          <Button variant="outline" size="sm" onClick={() => handleSort('name')} className="hidden sm:flex gap-1">
            名称 {sortBy === 'name' && (sortOrder === 'asc' ? <SortAsc className="h-3.5 w-3.5" /> : <SortDesc className="h-3.5 w-3.5" />)}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleSort('size')} className="hidden sm:flex gap-1">
            大小 {sortBy === 'size' && (sortOrder === 'asc' ? <SortAsc className="h-3.5 w-3.5" /> : <SortDesc className="h-3.5 w-3.5" />)}
          </Button>
          
          <div className="flex border rounded-md overflow-hidden">
            {viewModes.map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                variant="ghost"
                size="icon"
                className={cn('rounded-none h-9 w-9', viewMode === mode && !galleryMode && 'bg-accent')}
                onClick={() => { setViewMode(mode); setGalleryMode(false); }}
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
          
          <Button variant="outline" size="sm" onClick={() => selectAll(displayFiles)} disabled={displayFiles.length === 0}>
            <CheckSquare className="h-4 w-4 mr-1.5" />全选
          </Button>
          
          <Button variant="outline" size="sm" onClick={() => setShowNewFolderDialog(true)} className="hidden sm:flex">
            <FolderPlus className="h-4 w-4 mr-1.5" />新建
          </Button>
          
          <label>
            <Button asChild size="sm"><span><Upload className="h-4 w-4 mr-1.5" />上传</span></Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => {
                Array.from(e.target.files || []).forEach((file) => {
                  const key = `${file.name}-${Date.now()}`;
                  uploadMutation.mutate({ file, parentId: folderId || null, key });
                });
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
            <X className="h-3.5 w-3.5 mr-1" />取消
          </Button>
          <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={batchDeleteMutation.isPending}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />批量删除
          </Button>
        </div>
      )}

      {activeUploads.length > 0 && (
        <div className="space-y-2">
          {activeUploads.map(([key, progress]) => (
            <div key={key} className="bg-card border rounded-lg px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium truncate max-w-[200px]">{key.split('-').slice(0, -2).join('-')}</span>
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
          onConfirm={() => newFolderName.trim() && createFolderMutation.mutate(newFolderName.trim())}
          onCancel={() => { setShowNewFolderDialog(false); setNewFolderName(''); setNewFolderBucketId(null); }}
          loading={createFolderMutation.isPending}
        />
      )}

      {shareFileId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">创建分享链接</h2>
            <div className="space-y-3">
              <div className="space-y-1.5"><label className="text-sm font-medium">访问密码（可选）</label><Input placeholder="留空则不设密码" value={sharePassword} onChange={(e) => setSharePassword(e.target.value)} /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">有效天数（可选）</label><Input type="number" min={1} placeholder="留空则使用默认" value={shareExpiresDays} onChange={(e) => setShareExpiresDays(e.target.value ? Number(e.target.value) : '')} /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">下载次数限制（可选）</label><Input type="number" min={1} placeholder="留空则不限次数" value={shareDownloadLimit} onChange={(e) => setShareDownloadLimit(e.target.value ? Number(e.target.value) : '')} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => { setShareFileId(null); setSharePassword(''); setShareExpiresDays(''); setShareDownloadLimit(''); }}>取消</Button>
              <Button onClick={handleShare} disabled={shareMutation.isPending}>{shareMutation.isPending ? '创建中...' : '创建并复制链接'}</Button>
            </div>
          </div>
        </div>
      )}

      {renameFile && <RenameDialog currentName={renameFile.name} isPending={renameMutation.isPending} onConfirm={(name) => renameMutation.mutate({ id: renameFile.id, name })} onCancel={() => setRenameFile(null)} />}
      {moveFile && <MoveFolderPicker excludeIds={[moveFile.id]} isPending={moveMutation.isPending} onConfirm={(targetParentId) => moveMutation.mutate({ id: moveFile.id, targetParentId })} onCancel={() => setMoveFile(null)} />}
      {previewFile && <FilePreview file={previewFile} token={token || ''} onClose={() => setPreviewFile(null)} onDownload={handleDownload} onShare={(id) => { setPreviewFile(null); setShareFileId(id); }} />}
      
      {tagsFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">标签管理</h2>
              <button onClick={() => setTagsFile(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4 truncate">
              文件: {tagsFile.name}
            </p>
            <FileTagsManager fileId={tagsFile.id} />
            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={() => setTagsFile(null)}>关闭</Button>
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
            <p className="text-sm text-muted-foreground mb-4 truncate">
              文件: {permissionFile.name}
            </p>
            <FilePermissionManager fileId={permissionFile.id} isOwner={true} />
            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={() => setPermissionFile(null)}>关闭</Button>
            </div>
          </div>
        </div>
      )}

      {folderSettingsFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">文件夹设置</h2>
              <button onClick={() => setFolderSettingsFile(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4 truncate">
              文件夹: {folderSettingsFile.name}
            </p>
            <FolderSettings
              folderId={folderSettingsFile.id}
              folderName={folderSettingsFile.name}
              currentAllowedTypes={(folderSettingsFile as any).allowedMimeTypes ? JSON.parse((folderSettingsFile as any).allowedMimeTypes) : null}
              onClose={() => setFolderSettingsFile(null)}
            />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">加载中...</div>
      ) : displayFiles.length === 0 ? (
        <div
          className="text-center py-16 text-muted-foreground space-y-2"
          onContextMenu={(e) => handleContextMenu(e)}
        >
          <div className="text-6xl opacity-20">📂</div>
          <p className="font-medium">{searchQuery ? `没有找到 "${searchQuery}"` : '暂无文件'}</p>
          <p className="text-sm">{searchQuery ? '换个关键词试试' : '拖放文件或整个文件夹到这里上传'}</p>
        </div>
      ) : galleryMode && hasImages ? (
        <div className="masonry-grid">
          {imageFiles.map((file) => (
            <GalleryItem
              key={file.id}
              file={file}
              token={token || ''}
              onClick={() => setPreviewFile(file)}
              onDelete={() => confirm(`删除 "${file.name}"？`) && deleteMutation.mutate(file.id)}
              onContextMenu={(e) => handleContextMenu(e, file)}
            />
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <div
          className="bg-card border rounded-xl overflow-hidden divide-y"
          onContextMenu={(e) => handleContextMenu(e)}
        >
          {displayFiles.map((file) => (
            <ListItem
              key={file.id}
              file={file}
              isSelected={selectedFiles.includes(file.id)}
              tags={fileTagsMap[file.id]}
              onClick={handleFileClick}
              onToggleSelect={toggleFileSelection}
              onDownload={handleDownload}
              onShare={setShareFileId}
              onDelete={(f) => confirm(`将 "${f.name}" 移入回收站？`) && deleteMutation.mutate(f.id)}
              onRename={setRenameFile}
              onPreview={setPreviewFile}
              onMove={setMoveFile}
              onContextMenu={handleContextMenu}
              onTagClick={handleTagClick}
            />
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        <div
          className="file-grid"
          onContextMenu={(e) => handleContextMenu(e)}
        >
          {displayFiles.map((file) => (
            <GridItem
              key={file.id}
              file={file}
              token={token || ''}
              isSelected={selectedFiles.includes(file.id)}
              tags={fileTagsMap[file.id]}
              onClick={handleFileClick}
              onToggleSelect={toggleFileSelection}
              onDownload={handleDownload}
              onShare={setShareFileId}
              onDelete={(f) => confirm(`将 "${f.name}" 移入回收站？`) && deleteMutation.mutate(f.id)}
              onRename={setRenameFile}
              onPreview={setPreviewFile}
              onMove={setMoveFile}
              onContextMenu={handleContextMenu}
              onTagClick={handleTagClick}
            />
          ))}
        </div>
      ) : (
        <div
          className="masonry-grid"
          onContextMenu={(e) => handleContextMenu(e)}
        >
          {displayFiles.map((file) => (
            <MasonryItem
              key={file.id}
              file={file}
              token={token || ''}
              isSelected={selectedFiles.includes(file.id)}
              tags={fileTagsMap[file.id]}
              onClick={handleFileClick}
              onToggleSelect={toggleFileSelection}
              onDownload={handleDownload}
              onShare={setShareFileId}
              onDelete={(f) => confirm(`将 "${f.name}" 移入回收站？`) && deleteMutation.mutate(f.id)}
              onRename={setRenameFile}
              onPreview={setPreviewFile}
              onMove={setMoveFile}
              onContextMenu={handleContextMenu}
              onTagClick={handleTagClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ItemProps {
  file: FileItem;
  isSelected?: boolean;
  token?: string;
  tags?: any[];
  onClick: (f: FileItem) => void;
  onToggleSelect: (id: string, file?: FileItem) => void;
  onDownload: (f: FileItem) => void;
  onShare: (id: string) => void;
  onDelete: (f: FileItem) => void;
  onRename: (f: FileItem) => void;
  onPreview: (f: FileItem) => void;
  onMove: (f: FileItem) => void;
  onContextMenu: (e: React.MouseEvent, file?: FileItem) => void;
  onTagClick?: (tagName: string) => void;
}

function ListItem({ file, isSelected, tags, onClick, onToggleSelect, onDownload, onShare, onDelete, onRename, onPreview, onMove, onContextMenu, onTagClick }: ItemProps) {
  const canPreview = !file.isFolder && isPreviewable(file.mimeType);
  const { isMobile } = useResponsive();
  
  return (
    <div
      className={cn('flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors cursor-pointer group', isSelected && 'bg-primary/5')}
      onClick={() => onClick(file)}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <button 
        className="flex-shrink-0 transition-opacity" 
        onClick={(e) => { e.stopPropagation(); onToggleSelect(file.id, file); }}
      >
        {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
      </button>
      <div className="flex-shrink-0"><FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="md" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate text-sm">{file.name}</p>
          {tags && tags.length > 0 && (
            <FileTagsDisplay tags={tags} size="xs" onTagClick={onTagClick} />
          )}
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
          {file.isFolder ? '文件夹' : formatBytes(file.size)} · {formatDate(file.updatedAt)}
          {file.mimeType && !file.isFolder && <span className="opacity-40 hidden sm:inline">{file.mimeType}</span>}
          {(file as any).bucket && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted border">
              <Database className="h-2.5 w-2.5" />
              {(file as any).bucket.name}
            </span>
          )}
          {(file as any).owner && !(file as any).isOwner && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <User className="h-2.5 w-2.5" />
              {(file as any).owner.name || (file as any).owner.email}
            </span>
          )}
          {(file as any).accessPermission && !(file as any).isOwner && (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
              (file as any).accessPermission === 'admin' 
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800'
                : (file as any).accessPermission === 'write'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800'
            }`}>
              {(file as any).accessPermission === 'admin' ? '管理' : (file as any).accessPermission === 'write' ? '读写' : '只读'}
            </span>
          )}
        </p>
      </div>
      <div className={cn(
        "flex items-center gap-0.5 transition-opacity",
        isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )} onClick={(e) => e.stopPropagation()}>
        {canPreview && <ActionBtn title="预览" onClick={() => onPreview(file)}><Eye className="h-3.5 w-3.5" /></ActionBtn>}
        <ActionBtn title="重命名" onClick={() => onRename(file)}><Pencil className="h-3.5 w-3.5" /></ActionBtn>
        <ActionBtn title="移动到…" onClick={() => onMove(file)}><FolderInput className="h-3.5 w-3.5" /></ActionBtn>
        {!file.isFolder && <ActionBtn title="下载" onClick={() => onDownload(file)}><Download className="h-3.5 w-3.5" /></ActionBtn>}
        {!file.isFolder && <ActionBtn title="分享" onClick={() => onShare(file.id)}><Share2 className="h-3.5 w-3.5" /></ActionBtn>}
        <ActionBtn title="移入回收站" onClick={() => onDelete(file)} danger><Trash2 className="h-3.5 w-3.5" /></ActionBtn>
      </div>
    </div>
  );
}

function GridItem({ file, isSelected, token, tags, onClick, onToggleSelect, onDownload, onShare, onDelete, onRename, onPreview, onMove, onContextMenu, onTagClick }: ItemProps) {
  const bg = getCategoryBg(getFileCategory(file.mimeType, file.isFolder));
  const canPreview = !file.isFolder && isPreviewable(file.mimeType);
  const isImage = file.mimeType?.startsWith('image/');
  const { isMobile } = useResponsive();
  
  return (
    <div
      className={cn('relative bg-card border rounded-xl overflow-hidden cursor-pointer group transition-all hover:shadow-md hover:-translate-y-0.5', isSelected && 'ring-2 ring-primary')}
      onClick={() => onClick(file)}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <div className={cn('flex items-center justify-center h-28 relative', !isImage && bg)}>
        {isImage ? <img src={filesApi.previewUrl(file.id, token)} alt={file.name} className="w-full h-full object-cover" onError={(e) => { (e.target as any).style.display = 'none'; }} /> : <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="lg" />}
        <button 
          className={cn(
            "absolute top-2 left-2 transition-opacity z-10",
            isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )} 
          onClick={(e) => { e.stopPropagation(); onToggleSelect(file.id, file); }}
        >
          <div className={cn('rounded w-5 h-5 flex items-center justify-center', isSelected ? 'bg-primary text-primary-foreground' : 'bg-black/40 text-white')}>
            {isSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </div>
        </button>
      </div>
      <div className="px-3 py-2 border-t">
        <p className="text-xs font-medium truncate">{file.name}</p>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <p className="text-xs text-muted-foreground">{file.isFolder ? '文件夹' : formatBytes(file.size)}</p>
          {(file as any).bucket && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-muted border">
              <Database className="h-2 w-2" />
              {(file as any).bucket.name}
            </span>
          )}
          {(file as any).owner && !(file as any).isOwner && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <User className="h-2 w-2" />
              {(file as any).owner.name || (file as any).owner.email}
            </span>
          )}
        </div>
        {tags && tags.length > 0 && (
          <FileTagsDisplay tags={tags} size="xs" className="mt-1" onTagClick={onTagClick} />
        )}
      </div>
      <div className={cn(
        "absolute inset-0 bg-black/50 transition-opacity flex items-center justify-center gap-1.5 rounded-xl",
        isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )} onClick={(e) => e.stopPropagation()}>
        {canPreview && <ActionBtn title="预览" onClick={() => onPreview(file)} light><Eye className="h-3.5 w-3.5" /></ActionBtn>}
        <ActionBtn title="重命名" onClick={() => onRename(file)} light><Pencil className="h-3.5 w-3.5" /></ActionBtn>
        <ActionBtn title="移动" onClick={() => onMove(file)} light><FolderInput className="h-3.5 w-3.5" /></ActionBtn>
        {!file.isFolder && <ActionBtn title="下载" onClick={() => onDownload(file)} light><Download className="h-3.5 w-3.5" /></ActionBtn>}
        {!file.isFolder && <ActionBtn title="分享" onClick={() => onShare(file.id)} light><Share2 className="h-3.5 w-3.5" /></ActionBtn>}
        <ActionBtn title="删除" onClick={() => onDelete(file)} danger light><Trash2 className="h-3.5 w-3.5" /></ActionBtn>
      </div>
    </div>
  );
}

function MasonryItem({ file, isSelected, token, tags, onClick, onToggleSelect, onDownload, onShare, onDelete, onRename, onPreview, onMove, onContextMenu, onTagClick }: ItemProps) {
  const bg = getCategoryBg(getFileCategory(file.mimeType, file.isFolder));
  const isImage = file.mimeType?.startsWith('image/');
  const { isMobile } = useResponsive();
  
  return (
    <div
      className={cn('masonry-item relative bg-card border rounded-lg overflow-hidden cursor-pointer group', isSelected && 'ring-2 ring-primary')}
      onClick={() => onClick(file)}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <div className={cn('relative', !isImage && bg)}>
        {isImage ? (
          <img src={filesApi.previewUrl(file.id, token)} alt={file.name} className="w-full block object-cover" loading="lazy" />
        ) : (
          <div className="flex items-center justify-center p-8">
            <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="lg" />
          </div>
        )}
        <button 
          className={cn(
            "absolute top-2 left-2 transition-opacity z-10",
            isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )} 
          onClick={(e) => { e.stopPropagation(); onToggleSelect(file.id, file); }}
        >
          <div className={cn('rounded w-5 h-5 flex items-center justify-center', isSelected ? 'bg-primary text-primary-foreground' : 'bg-black/40 text-white')}>
            {isSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </div>
        </button>
      </div>
      <div className="px-2 py-1.5 border-t">
        <p className="text-xs font-medium truncate">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{file.isFolder ? '文件夹' : formatBytes(file.size)}</p>
        {tags && tags.length > 0 && (
          <FileTagsDisplay tags={tags} size="xs" className="mt-0.5" onTagClick={onTagClick} />
        )}
      </div>
    </div>
  );
}

function GalleryItem({ file, token, onClick, onDelete, onContextMenu }: { file: FileItem; token?: string; onClick: () => void; onDelete: () => void; onContextMenu: (e: React.MouseEvent) => void }) {
  const { isMobile } = useResponsive();
  
  return (
    <div
      className="masonry-item relative rounded-lg overflow-hidden group cursor-pointer"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <img src={filesApi.previewUrl(file.id, token)} alt={file.name} className="w-full block object-cover" loading="lazy" />
      <div className={cn(
        "absolute inset-0 bg-black/40 transition-opacity flex flex-col justify-end p-2",
        isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}>
        <p className="text-white text-xs font-medium truncate">{file.name}</p>
        <div className="flex gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
          <ActionBtn title="删除" onClick={onDelete} danger light><Trash2 className="h-3 w-3" /></ActionBtn>
        </div>
      </div>
    </div>
  );
}

interface ActionBtnProps { title: string; onClick: () => void; danger?: boolean; light?: boolean; children: React.ReactNode; }
function ActionBtn({ title, onClick, danger, light, children }: ActionBtnProps) {
  return (
    <button title={title} onClick={onClick} className={cn('h-7 w-7 rounded-md flex items-center justify-center transition-colors',
      light
        ? danger ? 'bg-white/10 hover:bg-red-500/80 text-white' : 'bg-white/10 hover:bg-white/25 text-white'
        : danger ? 'hover:bg-red-500/10 hover:text-red-500 text-muted-foreground' : 'hover:bg-accent text-muted-foreground hover:text-foreground'
    )}>
      {children}
    </button>
  );
}
