/**
 * FolderPickerDialog.tsx
 * 文件夹选择器对话框
 *
 * 用途：创建上传链接时选择目标文件夹
 * 基于 MoveFolderPicker 的 FolderNode 逻辑，去除"根目录"选项
 * （上传链接必须指向一个具体文件夹）
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Folder, ChevronRight, Loader2, Upload } from 'lucide-react';
import { cn } from '@/utils';
import type { FileItem } from '@osshelf/shared';

interface FolderItemProps {
  folder: FileItem;
  selectedId: string | null;
  depth: number;
  onSelect: (id: string, name: string) => void;
}

function FolderItem({ folder, selectedId, depth, onSelect }: FolderItemProps) {
  const [subExpanded, setSubExpanded] = useState(false);
  const isSelected = selectedId === folder.id;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors',
          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
        )}
      >
        <button
          className="flex-shrink-0 p-0.5 text-muted-foreground hover:text-foreground rounded"
          onClick={(e) => {
            e.stopPropagation();
            setSubExpanded((v) => !v);
          }}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', subExpanded && 'rotate-90')} />
        </button>
        <button
          className="flex-1 flex items-center gap-2 text-sm text-left min-w-0"
          onClick={() => onSelect(folder.id, folder.name)}
          style={{ paddingLeft: depth * 8 }}
        >
          <Folder className="h-4 w-4 flex-shrink-0 text-amber-400" />
          <span className="truncate">{folder.name}</span>
        </button>
      </div>
      {subExpanded && (
        <div className="ml-4">
          <FolderNode
            parentId={folder.id}
            selectedId={selectedId}
            selectedName=""
            onSelect={onSelect}
            depth={depth + 1}
          />
        </div>
      )}
    </div>
  );
}

interface FolderNodeProps {
  parentId: string | null;
  selectedId: string | null;
  selectedName: string;
  onSelect: (id: string, name: string) => void;
  depth: number;
}

function FolderNode({ parentId, selectedId, depth, onSelect }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);

  const { data: items = [], isLoading } = useQuery<FileItem[]>({
    queryKey: ['files', parentId],
    queryFn: () => filesApi.list({ parentId }).then((r) => r.data.data ?? []),
  });

  const folders = items.filter((f) => f.isFolder);

  if (isLoading && depth === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground pl-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        加载中...
      </div>
    );
  }

  if (folders.length === 0 && depth === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">暂无文件夹，请先创建文件夹</div>;
  }

  if (!expanded && depth === 0) {
    return (
      <div className="p-2">
        <button className="text-sm text-primary hover:underline" onClick={() => setExpanded(true)}>
          点击加载文件夹列表
        </button>
      </div>
    );
  }

  return (
    <div>
      {folders.map((folder) => (
        <FolderItem key={folder.id} folder={folder} selectedId={selectedId} depth={depth} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface FolderPickerDialogProps {
  title?: string;
  confirmLabel?: string;
  onConfirm: (folderId: string, folderName: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function FolderPickerDialog({
  title = '选择目标文件夹',
  confirmLabel = '确认选择',
  onConfirm,
  onCancel,
  isPending,
}: FolderPickerDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState('');

  const handleSelect = (id: string, name: string) => {
    setSelectedId(id);
    setSelectedName(name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[70vh]">
        <div className="px-5 py-4 border-b flex-shrink-0 flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">选择上传文件将保存到的文件夹</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          <FolderNode
            parentId={null}
            selectedId={selectedId}
            selectedName={selectedName}
            onSelect={handleSelect}
            depth={0}
          />
        </div>

        {selectedId && (
          <div className="px-4 py-2.5 border-t bg-muted/30 text-xs text-muted-foreground flex-shrink-0">
            已选：<span className="font-medium text-foreground">{selectedName}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 px-4 py-3 border-t flex-shrink-0">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!selectedId || isPending}
            onClick={() => selectedId && onConfirm(selectedId, selectedName)}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
