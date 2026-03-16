/**
 * FILES.TSX — Phase 4 upgrade
 *
 * Key changes vs Phase 3:
 * 1. Import useFolderUpload hook
 * 2. onDrop now distinguishes folder-drop vs plain file drop
 *    - Folder drop → useFolderUpload.uploadFolderEntries(e.dataTransfer.items)
 *    - Plain files → existing uploadMutation path
 * 3. Delete confirmation copy updated: "移入回收站" is now the phrase
 * 4. Stats invalidation on delete
 *
 * The full Files.tsx is identical to Phase 3's version with the additions below.
 * Only the onDrop callback and a few imports change, so this file IS the
 * canonical Files.tsx for Phase 4.
 */

import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFileStore } from '@/stores/files';
import { useAuthStore } from '@/stores/auth';
import { filesApi, shareApi, bucketsApi, PROVIDER_META, type StorageBucket } from '@/services/api';
import { useFolderUpload } from '@/hooks/useFolderUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileIcon } from '@/components/ui/FileIcon';
import { BreadcrumbNav, type BreadcrumbItem } from '@/components/ui/BreadcrumbNav';
import { FilePreview } from '@/components/ui/FilePreview';
import { RenameDialog } from '@/components/ui/RenameDialog';
import { MoveFolderPicker } from '@/components/ui/MoveFolderPicker';
import { useToast } from '@/components/ui/use-toast';
import { formatBytes, formatDate } from '@/utils';
import { getFileCategory, getCategoryBg, isPreviewable } from '@/utils/fileTypes';
import {
  Upload, FolderPlus, Grid, List, Download, Trash2, Share2,
  Search, X, Pencil, Eye, CheckSquare, Square, SortAsc, SortDesc,
  Image as ImageIcon, FolderInput, Database, ChevronDown,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import type { FileItem } from '@r2shelf/shared';
import { cn } from '@/utils';


// ── NewFolderDialog ─────────────────────────────────────────────────────
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
  const {
    viewMode, setViewMode, selectedFiles, toggleFileSelection, clearSelection,
    sortBy, sortOrder, setSort, searchQuery, setSearchQuery,
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

  // ── Folder upload hook ────────────────────────────────────────────
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

  // ── Breadcrumbs ──────────────────────────────────────────────────
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

  // ── File list ────────────────────────────────────────────────────
  const { data: files = [], isLoading } = useQuery<FileItem[]>({
    queryKey: ['files', folderId],
    queryFn: () => filesApi.list({ parentId: folderId || null }).then((r) => r.data.data ?? []),
  });

  const displayFiles = [...files]
    .filter((f) => !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      const av = (a as any)[sortBy] ?? '', bv = (b as any)[sortBy] ?? '';
      return sortOrder === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

  const imageFiles = displayFiles.filter((f) => f.mimeType?.startsWith('image/'));
  const hasImages = imageFiles.length > 0;

  // ── Mutations ────────────────────────────────────────────────────
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
      filesApi.upload(file, parentId, (p) => setUploadProgresses((prev) => ({ ...prev, [key]: p }))),
    onSuccess: (_, { key }) => {
      queryClient.invalidateQueries({ queryKey: ['files', folderId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setUploadProgresses((p) => { const n = { ...p }; delete n[key]; return n; });
      toast({ title: '上传成功' });
    },
    onError: (e: any, { key }) => {
      setUploadProgresses((p) => { const n = { ...p }; delete n[key]; return n; });
      toast({ title: '上传失败', description: e.response?.data?.error?.message, variant: 'destructive' });
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

  // ── Dropzone — detects folders via dataTransfer.items ─────────────
  const onDrop = useCallback(
    (acceptedFiles: File[], _rejected: any[], event: any) => {
      const nativeEvent = event?.nativeEvent ?? event;
      const items = nativeEvent?.dataTransfer?.items as DataTransferItemList | undefined;

      // Check if any item is a directory
      const hasFolder = items
        ? Array.from(items).some((item) => {
            const entry = item.webkitGetAsEntry?.();
            return entry?.isDirectory;
          })
        : false;

      if (hasFolder && items) {
        // Use folder-aware upload
        uploadFolderEntries(items);
      } else {
        // Plain files
        acceptedFiles.forEach((file) => {
          const key = `${file.name}-${Date.now()}`;
          uploadMutation.mutate({ file, parentId: folderId || null, key });
        });
      }
    },
    [folderId, uploadMutation, uploadFolderEntries]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, noClick: true });

  // ── Handlers ─────────────────────────────────────────────────────
  const handleDownload = async (file: FileItem) => {
    try {
      const res = await filesApi.download(file.id);
      const url = window.URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click();
      window.URL.revokeObjectURL(url); a.remove();
    } catch { toast({ title: '下载失败', variant: 'destructive' }); }
  };

  const handleFileClick = (file: FileItem) => {
    if (file.isFolder) { clearSelection(); navigate(`/files/${file.id}`); }
    else setPreviewFile(file);
  };

  const handleBatchDelete = () => {
    if (!selectedFiles.length) return;
    if (!confirm(`确定将选中的 ${selectedFiles.length} 个文件移入回收站？`)) return;
    selectedFiles.forEach((id) => deleteMutation.mutate(id));
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

  const activeUploads = Object.entries(uploadProgresses);

  return (
    <div {...getRootProps()} className="space-y-5">
      <input {...getInputProps()} />

      {/* Drag overlay */}
      {isDragActive && (
        <div className="fixed inset-0 z-50 bg-primary/10 flex items-center justify-center pointer-events-none">
          <div className="bg-card border-2 border-dashed border-primary rounded-xl p-12 text-center shadow-2xl">
            <Upload className="h-14 w-14 mx-auto mb-4 text-primary" />
            <p className="text-lg font-semibold">松开上传（支持整个文件夹）</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">文件管理</h1>
          <BreadcrumbNav items={breadcrumbs} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input className="pl-8 pr-8 h-9 w-40 sm:w-52 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="搜索文件..." value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setSearchQuery(e.target.value); }} />
            {searchInput && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => { setSearchInput(''); setSearchQuery(''); }}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => handleSort('name')} className="hidden sm:flex gap-1">
            名称 {sortBy === 'name' && (sortOrder === 'asc' ? <SortAsc className="h-3.5 w-3.5" /> : <SortDesc className="h-3.5 w-3.5" />)}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleSort('size')} className="hidden sm:flex gap-1">
            大小 {sortBy === 'size' && (sortOrder === 'asc' ? <SortAsc className="h-3.5 w-3.5" /> : <SortDesc className="h-3.5 w-3.5" />)}
          </Button>
          <div className="flex border rounded-md overflow-hidden">
            <Button variant="ghost" size="icon" className={cn('rounded-none h-9 w-9', viewMode === 'list' && !galleryMode && 'bg-accent')} onClick={() => { setViewMode('list'); setGalleryMode(false); }} title="列表"><List className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className={cn('rounded-none h-9 w-9 border-x', viewMode === 'grid' && !galleryMode && 'bg-accent')} onClick={() => { setViewMode('grid'); setGalleryMode(false); }} title="网格"><Grid className="h-4 w-4" /></Button>
            {hasImages && <Button variant="ghost" size="icon" className={cn('rounded-none h-9 w-9', galleryMode && 'bg-accent')} onClick={() => setGalleryMode(true)} title="图库"><ImageIcon className="h-4 w-4" /></Button>}
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowNewFolderDialog(true)}><FolderPlus className="h-4 w-4 mr-1.5" />新建文件夹</Button>
          <label>
            <Button asChild size="sm"><span><Upload className="h-4 w-4 mr-1.5" />上传文件</span></Button>
            <input type="file" className="hidden" multiple onChange={(e) => {
              Array.from(e.target.files || []).forEach((file) => {
                const key = `${file.name}-${Date.now()}`;
                uploadMutation.mutate({ file, parentId: folderId || null, key });
              });
              e.target.value = '';
            }} />
          </label>
        </div>
      </div>

      {/* Batch actions */}
      {selectedFiles.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-lg text-sm">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="font-medium">已选中 {selectedFiles.length} 个</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={clearSelection}><Square className="h-3.5 w-3.5 mr-1" />取消</Button>
          <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={deleteMutation.isPending}><Trash2 className="h-3.5 w-3.5 mr-1" />批量删除</Button>
        </div>
      )}

      {/* Upload progress */}
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

      {/* Dialogs */}
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

      {/* File list */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">加载中...</div>
      ) : displayFiles.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground space-y-2">
          <div className="text-6xl opacity-20">📂</div>
          <p className="font-medium">{searchQuery ? `没有找到 "${searchQuery}"` : '暂无文件'}</p>
          <p className="text-sm">{searchQuery ? '换个关键词试试' : '拖放文件或整个文件夹到这里上传'}</p>
        </div>
      ) : galleryMode && hasImages ? (
        <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-3">
          {imageFiles.map((file) => (
            <GalleryItem key={file.id} file={file} onClick={() => setPreviewFile(file)} onDelete={() => confirm(`删除 "${file.name}"？`) && deleteMutation.mutate(file.id)} />
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <div className="bg-card border rounded-xl overflow-hidden divide-y">
          {displayFiles.map((file) => (
            <ListItem key={file.id} file={file} isSelected={selectedFiles.includes(file.id)}
              onClick={handleFileClick} onToggleSelect={toggleFileSelection}
              onDownload={handleDownload} onShare={setShareFileId}
              onDelete={(f) => confirm(`将 "${f.name}" 移入回收站？`) && deleteMutation.mutate(f.id)}
              onRename={setRenameFile} onPreview={setPreviewFile} onMove={setMoveFile}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {displayFiles.map((file) => (
            <GridItem key={file.id} file={file} token={token || ''} isSelected={selectedFiles.includes(file.id)}
              onClick={handleFileClick} onToggleSelect={toggleFileSelection}
              onDownload={handleDownload} onShare={setShareFileId}
              onDelete={(f) => confirm(`将 "${f.name}" 移入回收站？`) && deleteMutation.mutate(f.id)}
              onRename={setRenameFile} onPreview={setPreviewFile} onMove={setMoveFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface ItemProps {
  file: FileItem; isSelected?: boolean; token?: string;
  onClick: (f: FileItem) => void; onToggleSelect: (id: string) => void;
  onDownload: (f: FileItem) => void; onShare: (id: string) => void;
  onDelete: (f: FileItem) => void; onRename: (f: FileItem) => void;
  onPreview: (f: FileItem) => void; onMove: (f: FileItem) => void;
}

function ListItem({ file, isSelected, onClick, onToggleSelect, onDownload, onShare, onDelete, onRename, onPreview, onMove }: ItemProps) {
  const canPreview = !file.isFolder && isPreviewable(file.mimeType);
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors cursor-pointer group', isSelected && 'bg-primary/5')}>
      {!file.isFolder
        ? <button className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); onToggleSelect(file.id); }}>
            {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
          </button>
        : <div className="w-4 flex-shrink-0" />}
      <div className="flex-shrink-0" onClick={() => onClick(file)}><FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="md" /></div>
      <div className="flex-1 min-w-0" onClick={() => onClick(file)}>
        <p className="font-medium truncate text-sm">{file.name}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
          {file.isFolder ? '文件夹' : formatBytes(file.size)} · {formatDate(file.updatedAt)}
          {file.mimeType && !file.isFolder && <span className="opacity-40">{file.mimeType}</span>}
          {(file as any).bucket && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted border">
              <Database className="h-2.5 w-2.5" />
              {(file as any).bucket.name}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
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

function GridItem({ file, isSelected, onClick, onToggleSelect, onDownload, onShare, onDelete, onRename, onPreview, onMove }: ItemProps) {
  const bg = getCategoryBg(getFileCategory(file.mimeType, file.isFolder));
  const canPreview = !file.isFolder && isPreviewable(file.mimeType);
  const isImage = file.mimeType?.startsWith('image/');
  return (
    <div className={cn('relative bg-card border rounded-xl overflow-hidden cursor-pointer group transition-all hover:shadow-md hover:-translate-y-0.5', isSelected && 'ring-2 ring-primary')} onClick={() => onClick(file)}>
      <div className={cn('flex items-center justify-center h-28 relative', !isImage && bg)}>
        {isImage ? <img src={filesApi.previewUrl(file.id)} alt={file.name} className="w-full h-full object-cover" onError={(e) => { (e.target as any).style.display = 'none'; }} /> : <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="lg" />}
        {!file.isFolder && (
          <button className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity z-10" onClick={(e) => { e.stopPropagation(); onToggleSelect(file.id); }}>
            <div className={cn('rounded w-5 h-5 flex items-center justify-center', isSelected ? 'bg-primary text-primary-foreground' : 'bg-black/40 text-white')}>
              {isSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </div>
          </button>
        )}
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
        </div>
      </div>
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 rounded-xl" onClick={(e) => e.stopPropagation()}>
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

function GalleryItem({ file, onClick, onDelete }: { file: FileItem; onClick: () => void; onDelete: () => void }) {
  return (
    <div className="relative mb-3 rounded-lg overflow-hidden group cursor-pointer break-inside-avoid" onClick={onClick}>
      <img src={filesApi.previewUrl(file.id)} alt={file.name} className="w-full block object-cover" loading="lazy" />
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
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
