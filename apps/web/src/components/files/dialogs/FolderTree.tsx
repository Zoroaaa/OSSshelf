/**
 * FolderTree.tsx
 * 文件夹选择器共用的树形列表。
 *
 * 设计要点：
 * - 展开状态属于「每个文件夹自己」，不是「父级列表」，避免一个父级展开导致所有兄弟一起展开
 * - 默认全部收起，只按 initialPath 逐级展开到当前选中目录
 * - 子节点只在展开时挂载并请求，避免打开弹窗就产生 N+1 请求
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { AlertCircle, ChevronRight, Folder, Home, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/utils';
import type { FileItem } from '@osshelf/shared';

const FOLDER_PAGE_SIZE = 100;
const MAX_INDENT_DEPTH = 8;

export interface FolderSelection {
  id: string | null;
  name: string;
  path: string;
}

interface FolderTreeProps {
  excludeIds?: string[];
  selectedId?: string | null;
  onSelect: (selection: FolderSelection) => void;
  allowRoot?: boolean;
  /** 逐级自动展开的目录名（不含根目录），用于打开时定位当前选中目录 */
  expandedPath?: string[];
  sourceBucketId?: string;
  /** 只展示当前用户可写入的目录 */
  writableOnly?: boolean;
}

interface NodeProps extends Omit<FolderTreeProps, 'allowRoot'> {
  parentId: string | null;
  depth: number;
}

function isWritableFolder(folder: FileItem): boolean {
  // 列表接口会返回 isOwner / accessPermission；若字段缺失则不额外限制，避免误隐藏
  if (folder.isOwner === undefined && folder.accessPermission === undefined) return true;
  if (folder.isOwner) return true;
  return folder.accessPermission === 'write' || folder.accessPermission === 'admin';
}

function indent(depth: number) {
  return `${Math.min(depth, MAX_INDENT_DEPTH) * 14 + 4}px`;
}

function useFolderChildren(parentId: string | null) {
  return useQuery<FileItem[]>({
    queryKey: ['files', 'picker', parentId],
    queryFn: () =>
      filesApi
        .list({ parentId, isFolder: true, limit: FOLDER_PAGE_SIZE, sortBy: 'name', sortOrder: 'asc' })
        .then((r) => r.data.data ?? []),
    staleTime: 30_000,
  });
}

function StatusRow({
  depth,
  children,
  tone = 'muted',
}: {
  depth: number;
  children: React.ReactNode;
  tone?: 'muted' | 'danger';
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-2 pr-3 text-xs',
        tone === 'danger' ? 'text-red-500' : 'text-muted-foreground'
      )}
      style={{ paddingLeft: indent(depth) }}
    >
      {children}
    </div>
  );
}

function FolderRow({
  folder,
  depth,
  excludeIds,
  selectedId,
  onSelect,
  expandedPath = [],
  sourceBucketId,
  writableOnly,
}: {
  folder: FileItem;
  depth: number;
} & Omit<FolderTreeProps, 'allowRoot'>) {
  const shouldAutoExpand = expandedPath.length > 0 && expandedPath[0] === folder.name;
  const [expanded, setExpanded] = useState(shouldAutoExpand);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shouldAutoExpand) setExpanded(true);
  }, [shouldAutoExpand]);

  useEffect(() => {
    if (selectedId === folder.id) {
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedId, folder.id, expanded]);

  const selected = selectedId === folder.id;
  const childPath = shouldAutoExpand ? expandedPath.slice(1) : [];

  return (
    <div>
      <div
        ref={rowRef}
        className={cn(
          'flex items-center gap-1 rounded-md transition-colors',
          selected ? 'bg-primary/10' : 'hover:bg-accent'
        )}
        style={{ paddingLeft: indent(depth) }}
      >
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'} ${folder.name}`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
        <button
          type="button"
          aria-pressed={selected}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left text-sm',
            selected ? 'font-medium text-primary' : ''
          )}
          onClick={() => onSelect({ id: folder.id, name: folder.name, path: folder.path ?? '' })}
        >
          <Folder className="h-4 w-4 flex-shrink-0 text-amber-400" />
          <span className="truncate">{folder.name}</span>
          {sourceBucketId && folder.bucketId && folder.bucketId !== sourceBucketId && (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              将跨桶迁移
            </span>
          )}
        </button>
      </div>
      {expanded && (
        <FolderNode
          parentId={folder.id}
          depth={depth + 1}
          excludeIds={excludeIds}
          selectedId={selectedId}
          onSelect={onSelect}
          expandedPath={childPath}
          sourceBucketId={sourceBucketId}
          writableOnly={writableOnly}
        />
      )}
    </div>
  );
}

function FolderNode({
  parentId,
  depth,
  excludeIds = [],
  selectedId,
  onSelect,
  expandedPath = [],
  sourceBucketId,
  writableOnly = true,
}: NodeProps) {
  const { data, isLoading, isError, refetch } = useFolderChildren(parentId);

  if (isLoading) {
    return (
      <StatusRow depth={depth}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        加载中…
      </StatusRow>
    );
  }

  if (isError) {
    return (
      <StatusRow depth={depth} tone="danger">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>加载失败</span>
        <button
          type="button"
          className="ml-1 inline-flex items-center gap-1 underline underline-offset-2 hover:text-red-600"
          onClick={() => refetch()}
        >
          <RefreshCw className="h-3 w-3" />
          重试
        </button>
      </StatusRow>
    );
  }

  const folders = (data ?? []).filter(
    (f) => f.isFolder && !excludeIds.includes(f.id) && (!writableOnly || isWritableFolder(f))
  );

  if (folders.length === 0) {
    return <StatusRow depth={depth}>{depth === 0 ? '暂无文件夹' : '无子文件夹'}</StatusRow>;
  }

  return (
    <>
      {folders.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          depth={depth}
          excludeIds={excludeIds}
          selectedId={selectedId}
          onSelect={onSelect}
          expandedPath={expandedPath}
          sourceBucketId={sourceBucketId}
          writableOnly={writableOnly}
        />
      ))}
      {folders.length >= FOLDER_PAGE_SIZE && (
        <StatusRow depth={depth}>仅显示前 {FOLDER_PAGE_SIZE} 个文件夹，请使用搜索定位</StatusRow>
      )}
    </>
  );
}

export function FolderTree({
  excludeIds = [],
  selectedId,
  onSelect,
  allowRoot = true,
  expandedPath = [],
  sourceBucketId,
  writableOnly = true,
}: FolderTreeProps) {
  const rootRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedId === null) rootRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <div role="group" aria-label="文件夹列表">
      {allowRoot && (
        <button
          ref={rootRef}
          type="button"
          aria-pressed={selectedId === null}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
            selectedId === null ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent'
          )}
          onClick={() => onSelect({ id: null, name: '根目录', path: '/' })}
        >
          <Home className="h-4 w-4 flex-shrink-0" />
          根目录
        </button>
      )}
      <FolderNode
        parentId={null}
        depth={0}
        excludeIds={excludeIds}
        selectedId={selectedId}
        onSelect={onSelect}
        expandedPath={expandedPath}
        sourceBucketId={sourceBucketId}
        writableOnly={writableOnly}
      />
    </div>
  );
}
