/**
 * FolderPickerDialog.tsx
 * 文件夹选择对话框（统一入口）
 *
 * 复用场景通过 mode 区分语义，避免「移动到…」出现在选择保存目录的场景：
 * - move：移动已有文件/文件夹
 * - save：离线下载等选择保存位置
 * - upload：创建上传链接，必须选择具体文件夹
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AlertCircle, Folder, Home, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/utils';
import type { FileItem } from '@osshelf/shared';
import { FolderTree, type FolderSelection } from './FolderTree';

export type { FolderSelection };

export type FolderPickerMode = 'move' | 'save' | 'upload';

const MODE_CONFIG: Record<
  FolderPickerMode,
  { title: string; description: string; confirmLabel: string; pendingLabel: string; allowRoot: boolean }
> = {
  move: {
    title: '移动到…',
    description: '选择目标文件夹',
    confirmLabel: '移动到这里',
    pendingLabel: '移动中…',
    allowRoot: true,
  },
  save: {
    title: '选择保存位置',
    description: '下载完成后将保存到此文件夹',
    confirmLabel: '保存到这里',
    pendingLabel: '保存中…',
    allowRoot: true,
  },
  upload: {
    title: '选择目标文件夹',
    description: '选择上传文件将保存到的文件夹',
    confirmLabel: '确认选择',
    pendingLabel: '处理中…',
    allowRoot: false,
  },
};

const SEARCH_LIMIT = 100;

interface FolderPickerDialogProps {
  mode?: FolderPickerMode;
  /** 覆盖 mode 的默认标题 */
  title?: string;
  /** 覆盖 mode 的默认确认文案 */
  confirmLabel?: string;
  /** 打开时回显的当前目标 */
  initialSelection?: FolderSelection | null;
  /** 需要从列表中排除的文件/文件夹（移动场景排除自身） */
  excludeIds?: string[];
  isPending?: boolean;
  /** 源文件/文件夹的 bucketId，用于提示跨桶迁移 */
  sourceBucketId?: string;
  /** 是否只展示可写入目录，默认 true */
  writableOnly?: boolean;
  onConfirm: (selection: FolderSelection) => void;
  onCancel: () => void;
}

function isWritableFolder(folder: FileItem): boolean {
  if (folder.isOwner === undefined && folder.accessPermission === undefined) return true;
  if (folder.isOwner) return true;
  return folder.accessPermission === 'write' || folder.accessPermission === 'admin';
}

/** 只展开选中目录的祖先层级，选中目录本身保持收起 */
function getAncestorPathNames(selection: FolderSelection | null): string[] {
  if (!selection || selection.id === null) return [];
  const segments = selection.path.split('/').filter(Boolean);
  return segments.slice(0, -1);
}

export function FolderPickerDialog({
  mode = 'move',
  title,
  confirmLabel,
  initialSelection = null,
  excludeIds = [],
  isPending,
  sourceBucketId,
  writableOnly = true,
  onConfirm,
  onCancel,
}: FolderPickerDialogProps) {
  const config = MODE_CONFIG[mode];
  const [selected, setSelected] = useState<FolderSelection | null>(initialSelection);
  const [search, setSearch] = useState('');
  const [expandedPath, setExpandedPath] = useState<string[]>(() => getAncestorPathNames(initialSelection));

  const handleSelect = (selection: FolderSelection) => {
    setSelected(selection);
    setExpandedPath(getAncestorPathNames(selection));
  };

  const searchTerm = search.trim();
  const { data: searchResults = [], isFetching: isSearching } = useQuery<FileItem[]>({
    queryKey: ['files', 'picker-search', searchTerm],
    queryFn: () =>
      filesApi
        .list({
          search: searchTerm,
          scope: 'all',
          isFolder: true,
          limit: SEARCH_LIMIT,
          sortBy: 'name',
          sortOrder: 'asc',
        })
        .then((r) => r.data.data ?? []),
    enabled: searchTerm.length > 0,
    staleTime: 10_000,
  });

  const visibleSearchResults = searchResults.filter(
    (f) => f.isFolder && !excludeIds.includes(f.id) && (!writableOnly || isWritableFolder(f))
  );

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const dialogTitle = title ?? config.title;
  const confirmText = confirmLabel ?? config.confirmLabel;
  const canConfirm = !!selected && (config.allowRoot || selected.id !== null) && !isPending;
  const displayPath = selected?.path && selected.path !== '/' ? selected.path : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="flex max-h-[75vh] w-full max-w-md flex-col rounded-xl border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id="folder-picker-title" className="text-base font-semibold">
              {dialogTitle}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{config.description}</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="-mr-1.5 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-shrink-0 px-4 pb-2 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索文件夹名称"
              aria-label="搜索文件夹名称"
              className="h-9 pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                aria-label="清除搜索"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch('')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {searchTerm ? (
            <div className="space-y-0.5">
              {isSearching && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  搜索中…
                </div>
              )}
              {!isSearching && visibleSearchResults.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5" />
                  未找到可用的文件夹
                </div>
              )}
              {!isSearching &&
                visibleSearchResults.map((folder) => {
                  const isSelected = selected?.id === folder.id;
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      aria-pressed={isSelected}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors',
                        isSelected ? 'bg-primary/10' : 'hover:bg-accent'
                      )}
                      onClick={() => handleSelect({ id: folder.id, name: folder.name, path: folder.path ?? '' })}
                    >
                      <Folder className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-sm', isSelected && 'font-medium text-primary')}>
                          {folder.name}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {folder.path || '/'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              {!isSearching && visibleSearchResults.length >= SEARCH_LIMIT && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  仅显示前 {SEARCH_LIMIT} 个结果，请补充关键词
                </div>
              )}
            </div>
          ) : (
            <FolderTree
              excludeIds={excludeIds}
              selectedId={selected?.id}
              allowRoot={config.allowRoot}
              expandedPath={expandedPath}
              sourceBucketId={sourceBucketId}
              writableOnly={writableOnly}
              onSelect={handleSelect}
            />
          )}
        </div>

        <div className="flex-shrink-0 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {selected ? (
              selected.id === null ? (
                <>
                  <Home className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">根目录</span>
                </>
              ) : (
                <>
                  <Folder className="h-3.5 w-3.5 text-amber-500" />
                  <span className="truncate font-medium text-foreground">{selected.name}</span>
                </>
              )
            ) : (
              <span>尚未选择目标文件夹</span>
            )}
          </div>
          {displayPath && <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{displayPath}</p>}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" disabled={!canConfirm} onClick={() => canConfirm && selected && onConfirm(selected)}>
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {isPending ? config.pendingLabel : confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
