import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Folder, ChevronRight, Home, Loader2 } from 'lucide-react';
import { cn } from '@/utils';
import type { FileItem } from '@osshelf/shared';

interface MoveFolderPickerProps {
  /** The file(s) being moved — we exclude them from the picker */
  excludeIds: string[];
  onConfirm: (targetParentId: string | null) => void;
  onCancel: () => void;
  isPending?: boolean;
}

interface FolderNodeProps {
  parentId: string | null;
  excludeIds: string[];
  selectedId: string | null | undefined; // undefined = not yet selected
  onSelect: (id: string | null) => void;
  depth: number;
}

function FolderNode({ parentId, excludeIds, selectedId, onSelect, depth }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);

  const { data: items = [], isLoading } = useQuery<FileItem[]>({
    queryKey: ['files', parentId],
    queryFn: () => filesApi.list({ parentId }).then((r) => r.data.data ?? []),
  });

  const folders = items.filter((f) => f.isFolder && !excludeIds.includes(f.id));

  if (isLoading && depth === 0) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground pl-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        加载中...
      </div>
    );
  }

  return (
    <div>
      {depth === 0 && (
        <button
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
            selectedId === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent'
          )}
          onClick={() => onSelect(null)}
        >
          <Home className="h-4 w-4 flex-shrink-0" />
          根目录
        </button>
      )}

      {folders.map((folder) => (
        <div key={folder.id}>
          <div
            className={cn(
              'flex items-center gap-1 rounded-md transition-colors',
              selectedId === folder.id ? 'bg-primary/10' : 'hover:bg-accent'
            )}
            style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
          >
            <button
              className="p-1 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
            </button>
            <button
              className={cn(
                'flex-1 flex items-center gap-2 py-2 pr-3 text-sm text-left',
                selectedId === folder.id ? 'text-primary font-medium' : ''
              )}
              onClick={() => onSelect(folder.id)}
            >
              <Folder className="h-4 w-4 flex-shrink-0 text-amber-400" />
              <span className="truncate">{folder.name}</span>
            </button>
          </div>
          {expanded && (
            <FolderNode
              parentId={folder.id}
              excludeIds={excludeIds}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function MoveFolderPicker({ excludeIds, onConfirm, onCancel, isPending }: MoveFolderPickerProps) {
  // undefined = nothing picked yet; null = root; string = folder id
  const [selected, setSelected] = useState<string | null | undefined>(undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[70vh]">
        <div className="px-5 py-4 border-b flex-shrink-0">
          <h2 className="text-base font-semibold">移动到…</h2>
          <p className="text-xs text-muted-foreground mt-0.5">选择目标文件夹</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          <FolderNode parentId={null} excludeIds={excludeIds} selectedId={selected} onSelect={setSelected} depth={0} />
        </div>

        {selected !== undefined && (
          <div className="px-4 py-3 border-t bg-muted/30 text-xs text-muted-foreground flex-shrink-0">
            目标：<span className="font-medium text-foreground">{selected === null ? '根目录' : '已选文件夹'}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 px-4 py-3 border-t flex-shrink-0">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={selected === undefined || isPending}
            onClick={() => selected !== undefined && onConfirm(selected)}
          >
            {isPending ? '移动中…' : '移动到这里'}
          </Button>
        </div>
      </div>
    </div>
  );
}
