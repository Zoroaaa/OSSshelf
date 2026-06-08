/**
 * FileTagsManager.tsx
 * 文件标签管理组件
 *
 * 功能:
 * - 查看文件标签
 * - 添加/删除标签（点击+号展开标签选择器）
 * - 标签选择器：展示已有标签列表（最多10个）、搜索、快速选择、新建
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
import { Plus, X, Loader2, Search, Check } from 'lucide-react';

interface FileTagsManagerProps {
  fileId: string;
  onTagClick?: (tagName: string) => void;
}

export function FileTagsManager({ fileId, onTagClick }: FileTagsManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(true);
  const [tagSearch, setTagSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(TAG_COLORS[0] ?? '#6366f1');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // 当前文件的标签
  const { data: fileTags = [], isLoading: fileTagsLoading } = useQuery({
    queryKey: ['file-tags', fileId],
    queryFn: () => permissionsApi.getFileTags(fileId).then((r) => r.data.data ?? []),
  });

  // 用户所有已有标签（用于选择器）
  const { data: allTags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ['user-tags'],
    queryFn: () => permissionsApi.getUserTags().then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  // 过滤：排除已添加的 + 搜索匹配
  const availableTags = allTags.filter((t) => {
    const alreadyAdded = fileTags.some((ft) => ft.name === t.name);
    if (alreadyAdded) return false;
    if (!tagSearch) return true;
    return t.name.toLowerCase().includes(tagSearch.toLowerCase());
  });

  // 显示的标签：最多10个
  const displayTags = availableTags.slice(0, 10);

  // ── 添加已有标签到文件 ──
  const addTagMutation = useMutation({
    mutationFn: (data: { name: string; color?: string }) =>
      permissionsApi.addTag({ fileId, ...data }),
    onSuccess: () => {
      toast({ title: '标签已添加' });
      queryClient.invalidateQueries({ queryKey: ['file-tags', fileId] });
      queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      queryClient.invalidateQueries({ queryKey: ['tag-stats'] });
    },
    onError: (e: any) =>
      toast({ title: '添加失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  // ── 新建标签并添加到文件 ──
  const createAndAddMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) =>
      permissionsApi.createTag(data),
    onSuccess: (res) => {
      const tag = res.data.data;
      if (!tag) return;
      toast({ title: '标签已创建' });
      addTagMutation.mutate({ name: tag.name, color: tag.color });
      setNewTagName('');
      setShowCreateForm(false);
    },
    onError: (e: any) =>
      toast({ title: '创建失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const handleCreateAndAdd = () => {
    const name = newTagName.trim();
    if (!name) return;
    if (allTags.some((t) => t.name === name)) {
      toast({ title: '标签已存在，可直接选择', variant: 'destructive' });
      return;
    }
    createAndAddMutation.mutate({ name, color: selectedColor });
  };

  // ── 移除标签 ──
  const removeTagMutation = useMutation({
    mutationFn: (tagName: string) => permissionsApi.removeTag({ fileId, tagName }),
    onSuccess: () => {
      toast({ title: '标签已移除' });
      queryClient.invalidateQueries({ queryKey: ['file-tags', fileId] });
      queryClient.invalidateQueries({ queryKey: ['tag-stats'] });
    },
    onError: (e: any) =>
      toast({ title: '移除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  // 点击已有标签 → 直接添加
  const handleSelectExistingTag = (tag: { name: string; color: string }) => {
    addTagMutation.mutate({ name: tag.name, color: tag.color });
  };

  if (fileTagsLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="space-y-3">
      {/* 已有标签行 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {fileTags.map((tag) => (
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

        {/* 展开/收起 按钮 */}
        <button
          onClick={() => { setShowPicker(!showPicker); if (showPicker) { setTagSearch(''); } }}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors',
            showPicker ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-muted-foreground hover:bg-muted'
          )}
        >
          {showPicker ? <><Check className="h-3 w-3" /> 收起</> : <><Plus className="h-3 w-3" /> 标签</>}
        </button>
      </div>

      {/* ═══ 标签选择器面板（内联渲染，非 absolute）═══ */}
      {showPicker && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索已有标签..."
              value={tagSearch}
              onChange={(e) => { setTagSearch(e.target.value); setShowCreateForm(false); }}
              onKeyDown={(e) => { if (e.key === 'Escape') setShowPicker(false); }}
              className="pl-8 h-8 text-xs"
              autoFocus
            />
          </div>

          {/* 已有标签列表 / 新建表单 */}
          {!showCreateForm ? (
            <>
              {tagsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : displayTags.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto">
                  {displayTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => handleSelectExistingTag(tag)}
                      disabled={addTagMutation.isPending}
                      className={cn(
                        'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-sm transition-colors',
                        'hover:bg-accent disabled:opacity-50'
                      )}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="truncate">{tag.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-3">
                  {allTags.length === 0 ? '暂无标签' : '无匹配结果'}
                </p>
              )}

              {/* + 新建标签 按钮 */}
              <button
                onClick={() => setShowCreateForm(true)}
                className={cn(
                  'w-full mt-2 py-2 rounded-md border border-dashed text-xs text-muted-foreground',
                  'hover:border-primary/50 hover:text-primary transition-colors'
                )}
              >
                + 新建标签
              </button>
            </>
          ) : (
            /* ── 新建标签表单 ── */
            <div className="space-y-2 pt-1">
              <Input
                placeholder="输入标签名称..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAndAdd(); }}
                className="h-8 text-xs"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">颜色</span>
                <div className="flex gap-1.5 flex-wrap">
                  {TAG_COLORS.slice(0, 8).map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedColor(c)}
                      className={cn(
                        'w-5 h-5 rounded-full border-2 transition-transform',
                        selectedColor === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  disabled={!newTagName.trim() || createAndAddMutation.isPending}
                  onClick={handleCreateAndAdd}
                >
                  {createAndAddMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  创建并添加
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => { setShowCreateForm(false); setNewTagName(''); }}
                >
                  取消
                </Button>
              </div>
            </div>
          )}
        </div>
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
