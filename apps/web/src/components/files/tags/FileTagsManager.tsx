/**
 * FileTagsManager.tsx
 * 文件标签管理组件
 *
 * 功能:
 * - 查看文件标签
 * - 添加/删除标签
 * - 标签颜色选择
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { permissionsApi } from '@/services/api';
import { TAG_COLORS } from '@osshelf/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import { Plus, X, Loader2 } from 'lucide-react';

interface FileTagsManagerProps {
  fileId: string;
  onTagClick?: (tagName: string) => void;
}

export function FileTagsManager({ fileId, onTagClick }: FileTagsManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['file-tags', fileId],
    queryFn: () => permissionsApi.getFileTags(fileId).then((r) => r.data.data ?? []),
  });

  const addTagMutation = useMutation({
    mutationFn: (data: { name: string; color?: string }) => permissionsApi.addTag({ fileId, ...data }),
    onSuccess: () => {
      toast({ title: '标签已添加' });
      queryClient.invalidateQueries({ queryKey: ['file-tags', fileId] });
      queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      setNewTagName('');
      setShowAddTag(false);
    },
    onError: (e: any) =>
      toast({
        title: '添加失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const removeTagMutation = useMutation({
    mutationFn: (tagName: string) => permissionsApi.removeTag({ fileId, tagName }),
    onSuccess: () => {
      toast({ title: '标签已移除' });
      queryClient.invalidateQueries({ queryKey: ['file-tags', fileId] });
    },
    onError: (e: any) =>
      toast({
        title: '移除失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const handleAddTag = () => {
    if (!newTagName.trim()) return;
    addTagMutation.mutate({ name: newTagName.trim(), color: selectedColor });
  };

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => onTagClick?.(tag.name)}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
            'hover:opacity-80'
          )}
          style={{ backgroundColor: tag.color + '20', color: tag.color }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
          {tag.name}
          <span
            role="button"
            tabIndex={0}
            className="ml-0.5 hover:bg-black/10 rounded-full p-0.5"
            onClick={(e) => {
              e.stopPropagation();
              removeTagMutation.mutate(tag.name);
            }}
          >
            <X className="h-2.5 w-2.5" />
          </span>
        </button>
      ))}

      {showAddTag ? (
        <div className="flex items-center gap-2 p-2 rounded-lg border bg-card">
          <Input
            placeholder="标签名称"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            className="h-7 w-24 text-xs"
            autoFocus
          />
          <div className="flex items-center gap-0.5">
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={cn(
                  'w-4 h-4 rounded-full border transition-transform',
                  selectedColor === color && 'scale-125 border-foreground'
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={handleAddTag}
            disabled={!newTagName.trim() || addTagMutation.isPending}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => {
              setShowAddTag(false);
              setNewTagName('');
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddTag(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-muted-foreground hover:bg-muted transition-colors"
        >
          <Plus className="h-3 w-3" />
          标签
        </button>
      )}
    </div>
  );
}

export function UserTagsList({ onTagClick }: { onTagClick?: (tagName: string) => void }) {
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['user-tags'],
    queryFn: () => permissionsApi.getUserTags().then((r) => r.data.data ?? []),
  });

  if (isLoading) return null;

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => onTagClick?.(tag.name)}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
            'hover:opacity-80 cursor-pointer'
          )}
          style={{ backgroundColor: tag.color + '20', color: tag.color }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
          {tag.name}
        </button>
      ))}
    </div>
  );
}
