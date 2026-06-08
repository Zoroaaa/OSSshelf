/**
 * Tags.tsx
 * 标签管理页面（独立路由 /tags）
 *
 * 功能:
 * - 查看所有标签及使用统计
 * - 搜索标签
 * - 新建标签
 * - 点击标签查看关联文件（分页，每页10条）
 * - 文件勾选 + 批量删除/批量移除标签
 * - 单条文件：删除、移除该标签、跳转预览
 * - 重命名 / 删除标签
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi, filesApi, batchApi } from '@/services/api';
import { FileIcon } from '@/components/files/FileIcon';
import { Pagination } from '@/components/files/Pagination';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { formatBytes, formatDate } from '@/utils';
import type { FileItem, FileTag } from '@osshelf/shared';
import {
  Tag,
  Loader2,
  FolderOpen,
  Search,
  Pencil,
  Trash2,
  X,
  Check,
  Files,
  ArrowLeft,
  CheckSquare,
  Square,
} from 'lucide-react';
import { cn } from '@/utils';

const TAG_PAGE_SIZE = 10;

interface PaginatedFilesResponse {
  data: FileItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function Tags() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // 分页状态
  const [page, setPage] = useState(1);

  // 勾选状态
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  // ── 查询 ──
  const { data: tags = [], isLoading: tagsLoading } = useQuery<FileTag[]>({
    queryKey: ['user-tags'],
    queryFn: () => permissionsApi.getUserTags().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  const { data: tagStats = [] } = useQuery<Array<{ name: string; count: number }>>({
    queryKey: ['tag-stats'],
    queryFn: () => permissionsApi.getTagStats().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  const { data: tagData, isLoading: filesLoading } = useQuery<PaginatedFilesResponse>({
    queryKey: ['tag-files', selectedTag, page],
    queryFn: () =>
      filesApi
        .list({ tags: [selectedTag!].join(',') as any, page, limit: TAG_PAGE_SIZE })
        .then((r) => ({
          data: (r.data.data as FileItem[]) ?? [],
          pagination: (r.data as any).pagination ?? { page, limit: TAG_PAGE_SIZE, total: 0, totalPages: 0 },
        })),
    enabled: !!selectedTag,
    staleTime: 30000,
  });

  const tagFiles = tagData?.data ?? [];
  const filePagination = tagData?.pagination ?? { page: 1, limit: TAG_PAGE_SIZE, total: 0, totalPages: 0 };

  // ── 切换标签时重置分页和选中 ──
  const handleSelectTag = (tagName: string) => {
    if (selectedTag === tagName) {
      setSelectedTag(null);
    } else {
      setSelectedTag(tagName);
      setPage(1);
      setSelectedFileIds(new Set());
    }
  };

  // ── 标签重命名 ──
  const renameMutation = useMutation({
    mutationFn: ({ oldName, newName }: { oldName: string; newName: string }) =>
      permissionsApi.renameTag({ oldName, newName }),
    onSuccess: () => {
      toast({ title: '标签已重命名' });
      queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      queryClient.invalidateQueries({ queryKey: ['tag-stats'] });
      if (selectedTag === editingTag) setSelectedTag(editName);
      setEditingTag(null);
      setEditName('');
    },
    onError: (e: any) =>
      toast({ title: '重命名失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  // ── 删除标签 ──
  const deleteMutation = useMutation({
    mutationFn: (tagName: string) => permissionsApi.deleteTag(tagName),
    onSuccess: () => {
      toast({ title: '标签已删除' });
      queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      queryClient.invalidateQueries({ queryKey: ['tag-stats'] });
      if (selectedTag === deleteConfirm) {
        setSelectedTag(null);
        setSelectedFileIds(new Set());
      }
      setDeleteConfirm(null);
    },
    onError: (e: any) =>
      toast({ title: '删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  // ── 单个文件移除当前标签 ──
  const removeTagFromFileMutation = useMutation({
    mutationFn: (fileId: string) => permissionsApi.removeTag({ fileId, tagName: selectedTag! }),
    onSuccess: () => {
      toast({ title: '已移除标签' });
      queryClient.invalidateQueries({ queryKey: ['tag-files'] });
      queryClient.invalidateQueries({ queryKey: ['tag-stats'] });
      queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      setSelectedFileIds((prev) => new Set(prev));
    },
    onError: (e: any) =>
      toast({ title: '移除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  // ── 单个文件删除 ──
  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) => filesApi.delete(fileId),
    onSuccess: () => {
      toast({ title: '已移入回收站' });
      queryClient.invalidateQueries({ queryKey: ['tag-files'] });
      queryClient.invalidateQueries({ queryKey: ['tag-stats'] });
      queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      setSelectedFileIds((prev) => new Set(prev));
    },
    onError: (e: any) =>
      toast({ title: '删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  // ── 批量删除文件 ──
  const batchDeleteMutation = useMutation({
    mutationFn: (fileIds: string[]) => batchApi.delete(fileIds),
    onSuccess: (res) => {
      const data = res.data.data;
      toast({ title: '批量删除完成', description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个` });
      queryClient.invalidateQueries({ queryKey: ['tag-files'] });
      queryClient.invalidateQueries({ queryKey: ['tag-stats'] });
      setSelectedFileIds(new Set());
    },
    onError: (e: any) =>
      toast({ title: '批量删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  // ── 批量移除标签 ──
  const batchRemoveTagMutation = useMutation({
    mutationFn: (fileIds: string[]) =>
      Promise.all(fileIds.map((fid) => permissionsApi.removeTag({ fileId: fid, tagName: selectedTag! }))),
    onSuccess: () => {
      toast({ title: `已从 ${selectedFileIds.size} 个文件移除标签「${selectedTag}」` });
      queryClient.invalidateQueries({ queryKey: ['tag-files'] });
      queryClient.invalidateQueries({ queryKey: ['tag-stats'] });
      queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      setSelectedFileIds(new Set());
    },
    onError: (e: any) =>
      toast({ title: '批量移除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  // ── 筛选 & 辅助方法 ──
  const filteredTags = searchQuery ? tags.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase())) : tags;

  const getTagCount = (tagName: string) => {
    const stat = tagStats.find((s) => s.name === tagName);
    return stat?.count || 0;
  };

  const toggleSelect = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      next.has(fileId) ? next.delete(fileId) : next.add(fileId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedFileIds.size === tagFiles.length && tagFiles.length > 0) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(tagFiles.map((f) => f.id)));
    }
  };

  const handleFileClick = (file: FileItem) => {
    if (file.isFolder) navigate(`/files/${file.id}`);
    else navigate(`/files?preview=${file.id}`);
  };

  const handleRenameConfirm = (oldName: string) => {
    if (!editName.trim() || editName.trim() === oldName) { setEditingTag(null); return; }
    renameMutation.mutate({ oldName, newName: editName.trim() });
  };

  const handlePageChange = (newPage: number) => { setPage(newPage); setSelectedFileIds(new Set()); };

  const allSelected = tagFiles.length > 0 && selectedFileIds.size === tagFiles.length;
  const hasSelection = selectedFileIds.size > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
            <Tag className="h-5 w-5 lg:h-6 lg:w-6 text-primary" />
            标签管理
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{tagsLoading ? '加载中…' : `${tags.length} 个标签`}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="搜索标签..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
      </div>

      <div className={cn('grid gap-6', selectedTag ? 'lg:grid-cols-[320px_1fr]' : 'lg:grid-cols-1')}>
        {/* ── 左侧：标签列表 ── */}
        <div className="space-y-3">
          {tagsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTags.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <Tag className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">{searchQuery ? '未找到匹配的标签' : '暂无标签'}</p>
              <p className="text-xs">在文件详情中添加标签</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredTags.map((tag) => {
                const count = getTagCount(tag.name);
                const isSelected = selectedTag === tag.name;
                const isEditing = editingTag === tag.name;
                const isDeleting = deleteConfirm === tag.name;

                return (
                  <div
                    key={tag.id}
                    className={cn(
                      'group flex items-center gap-3 p-3 rounded-lg border transition-colors',
                      isSelected ? 'bg-primary/10 border-primary/30' : 'bg-card hover:bg-accent/40 border-transparent'
                    )}
                  >
                    <button onClick={() => handleSelectTag(tag.name)} className="flex-1 flex items-center gap-2.5 min-w-0 text-left">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                      {isEditing ? (
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameConfirm(tag.name); if (e.key === 'Escape') setEditingTag(null); }}
                          className="h-7 text-sm flex-1"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          <span className="font-medium truncate text-sm">{tag.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">{count} 个文件</span>
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isEditing ? (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleRenameConfirm(tag.name); }}>
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setEditingTag(null); }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : isDeleting ? (
                        <>
                          <span className="text-xs text-destructive mr-1">确定?</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(tag.name); }} disabled={deleteMutation.isPending}>
                            {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-destructive" /> : <Check className="h-3.5 w-3.5 text-destructive" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setEditingTag(tag.name); setEditName(tag.name); }} title="重命名">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(tag.name); }} title="删除标签">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 右侧：选中标签的文件列表 ── */}
        {selectedTag && (
          <div className="space-y-4">
            {/* 工具栏 */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => { setSelectedTag(null); setSelectedFileIds(new Set()); }} className="text-muted-foreground">
                <ArrowLeft className="h-4 w-4 mr-1" />
                返回
              </Button>
              <div className="h-4 w-px bg-border" />
              <h2 className="font-semibold">「{selectedTag}」</h2>
              <span className="text-sm text-muted-foreground">共 {filePagination.total} 个文件</span>
            </div>

            {/* 批量操作栏 — 始终可见，无选中时禁用 */}
            {tagFiles.length > 0 && !filesLoading && (
              <div className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                hasSelection ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-transparent'
              )}>
                <button onClick={toggleSelectAll} className="flex items-center justify-center touch-target-sm" title={allSelected ? '取消全选' : '全选'}>
                  {allSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                </button>
                {hasSelection ? (
                  <>
                    <span className="text-sm font-medium">已选 <span className="text-primary">{selectedFileIds.size}</span> / {tagFiles.length} 项</span>
                    <div className="h-4 w-px bg-border" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => batchRemoveTagMutation.mutate(Array.from(selectedFileIds))}
                      disabled={batchRemoveTagMutation.isPending}
                    >
                      {batchRemoveTagMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                      移除标签
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => batchDeleteMutation.mutate(Array.from(selectedFileIds))}
                      disabled={batchDeleteMutation.isPending}
                    >
                      {batchDeleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                      删除
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedFileIds(new Set())}>
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">勾选文件后可批量操作</span>
                  </>
                )}
              </div>
            )}

            {/* 文件列表 */}
            {filesLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : tagFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Files className="h-10 w-10 opacity-20" />
                <p className="text-sm font-medium">暂无相关文件</p>
              </div>
            ) : (
              <div className="grid gap-1">
                {tagFiles.map((file) => {
                  const checked = selectedFileIds.has(file.id);
                  return (
                    <div
                      key={file.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/40 transition-colors group overflow-hidden',
                        checked && 'bg-primary/5 border-primary/20'
                      )}
                    >
                      <button onClick={(e) => { e.stopPropagation(); toggleSelect(file.id); }} className="flex-shrink-0 touch-target-sm">
                        {checked ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                      </button>

                      <div className="flex-1 min-w-0 overflow-hidden cursor-pointer" onClick={() => handleFileClick(file)}>
                        <div className="flex items-center gap-3">
                          <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate text-sm">{file.name}</p>
                            <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                              <p className="flex items-center gap-1.5 overflow-hidden">
                                {!file.isFolder && <span className="flex-shrink-0">{formatBytes(file.size)}</span>}
                                {!file.isFolder && <span className="flex-shrink-0">·</span>}
                                <span className="flex-shrink-0 truncate">{formatDate(file.updatedAt)}</span>
                              </p>
                              {file.path && (
                                <p className="flex items-center gap-1 overflow-hidden">
                                  <FolderOpen className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">{file.path}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={(e) => { e.stopPropagation(); removeTagFromFileMutation.mutate(file.id); }}
                          disabled={removeTagFromFileMutation.isPending}
                          title={`移除标签「${selectedTag}」`}
                        >
                          {removeTagFromFileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={(e) => { e.stopPropagation(); deleteFileMutation.mutate(file.id); }}
                          disabled={deleteFileMutation.isPending}
                          title="删除文件"
                        >
                          {deleteFileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-destructive" /> : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 分页 */}
            {!filesLoading && tagFiles.length > 0 && (
              <Pagination
                currentPage={filePagination.page}
                totalPages={filePagination.totalPages}
                totalItems={filePagination.total}
                pageSize={TAG_PAGE_SIZE as 20}
                onPageChange={handlePageChange}
                onPageSizeChange={() => {}}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
