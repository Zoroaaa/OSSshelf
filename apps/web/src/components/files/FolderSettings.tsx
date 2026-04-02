/**
 * FolderSettings.tsx
 * 文件夹设置组件
 *
 * 功能:
 * - 设置文件夹上传文件类型限制
 * - 支持预设类型和自定义类型
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/useToast';
import { cn } from '@/utils';
import {
  Settings,
  X,
  Loader2,
  Check,
  Image,
  FileVideo,
  FileAudio,
  FileText,
  Archive,
  FileCode,
  File,
  Plus,
  BookOpen,
  Type,
} from 'lucide-react';

interface FolderSettingsProps {
  folderId: string;
  folderName: string;
  currentAllowedTypes?: string[] | null;
  onClose: () => void;
}

const PRESET_TYPES = [
  { id: 'image/*', label: '图片', icon: Image, color: 'text-pink-500', bg: 'bg-pink-500/10' },
  { id: 'video/*', label: '视频', icon: FileVideo, color: 'text-red-500', bg: 'bg-red-500/10' },
  { id: 'audio/*', label: '音频', icon: FileAudio, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { id: 'application/pdf', label: 'PDF', icon: FileText, color: 'text-red-600', bg: 'bg-red-600/10' },
  {
    id: 'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/rtf',
    label: 'Word',
    icon: FileText,
    color: 'text-blue-600',
    bg: 'bg-blue-600/10',
  },
  {
    id: 'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet',
    label: 'Excel',
    icon: FileText,
    color: 'text-green-600',
    bg: 'bg-green-600/10',
  },
  {
    id: 'application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.presentation',
    label: 'PPT',
    icon: FileText,
    color: 'text-orange-600',
    bg: 'bg-orange-600/10',
  },
  {
    id: 'application/zip,application/x-rar-compressed,application/x-7z-compressed,application/x-tar,application/gzip,application/x-bzip2,application/x-xz',
    label: '压缩包',
    icon: Archive,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  {
    id: 'text/*,application/json,application/xml,application/javascript,application/typescript,application/x-sh,application/x-python,application/sql,application/toml',
    label: '文本/代码',
    icon: FileCode,
    color: 'text-cyan-500',
    bg: 'bg-cyan-500/10',
  },
  {
    id: 'application/epub+zip,application/epub,application/x-epub+zip',
    label: '电子书',
    icon: BookOpen,
    color: 'text-teal-500',
    bg: 'bg-teal-500/10',
  },
  {
    id: 'font/ttf,font/otf,font/woff,font/woff2,application/vnd.ms-fontobject',
    label: '字体',
    icon: Type,
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
  },
];

export function FolderSettings({
  folderId,
  folderName: _folderName,
  currentAllowedTypes,
  onClose,
}: FolderSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTypes, setSelectedTypes] = useState<string[]>(currentAllowedTypes || []);
  const [customType, setCustomType] = useState('');
  const [customTypes, setCustomTypes] = useState<string[]>([]);

  useEffect(() => {
    if (currentAllowedTypes) {
      const presetIds = PRESET_TYPES.map((p) => p.id);
      const custom = currentAllowedTypes.filter((t) => !presetIds.includes(t));
      setCustomTypes(custom);
    }
  }, [currentAllowedTypes]);

  const updateMutation = useMutation({
    mutationFn: (allowedMimeTypes: string[] | null) => filesApi.updateSettings(folderId, { allowedMimeTypes }),
    onSuccess: () => {
      toast({ title: '设置已保存' });
      queryClient.invalidateQueries({ queryKey: ['files'] });
      onClose();
    },
    onError: (e: any) =>
      toast({
        title: '保存失败',
        description: e.response?.data?.error?.message,
        variant: 'destructive',
      }),
  });

  const togglePreset = (presetId: string) => {
    setSelectedTypes((prev) => {
      if (prev.includes(presetId)) {
        return prev.filter((t) => t !== presetId);
      }
      return [...prev, presetId];
    });
  };

  const addCustomType = () => {
    if (!customType.trim()) return;
    const mimePattern = /^[\w*]+\/[\w*.-]+$/;
    if (!mimePattern.test(customType.trim())) {
      toast({
        title: '格式错误',
        description: '请输入有效的 MIME 类型，如 image/png 或 image/*',
        variant: 'destructive',
      });
      return;
    }
    if (!customTypes.includes(customType.trim())) {
      setCustomTypes((prev) => [...prev, customType.trim()]);
    }
    setCustomType('');
  };

  const removeCustomType = (type: string) => {
    setCustomTypes((prev) => prev.filter((t) => t !== type));
  };

  const handleSave = () => {
    const allTypes = [...selectedTypes, ...customTypes];
    updateMutation.mutate(allTypes.length > 0 ? allTypes : null);
  };

  const handleClear = () => {
    setSelectedTypes([]);
    setCustomTypes([]);
    updateMutation.mutate(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Settings className="h-4 w-4" />
        <span className="text-sm">设置此文件夹允许上传的文件类型</span>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium">预设类型</label>
        <div className="flex flex-wrap gap-2">
          {PRESET_TYPES.map((preset) => {
            const Icon = preset.icon;
            const isSelected = selectedTypes.includes(preset.id);
            return (
              <button
                key={preset.id}
                onClick={() => togglePreset(preset.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border',
                  isSelected
                    ? `${preset.bg} ${preset.color} border-current`
                    : 'bg-muted/50 border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {preset.label}
                {isSelected && <Check className="h-3 w-3" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium">自定义类型</label>
        <div className="flex gap-2">
          <input
            className="flex-1 h-9 px-3 rounded-md border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="输入 MIME 类型，如 image/png"
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustomType()}
          />
          <Button size="sm" variant="outline" onClick={addCustomType}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {customTypes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customTypes.map((type) => (
              <span key={type} className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted rounded text-xs">
                <File className="h-3 w-3" />
                {type}
                <button onClick={() => removeCustomType(type)} className="ml-0.5 hover:text-red-500">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleClear}
          disabled={updateMutation.isPending}
          className="text-muted-foreground"
        >
          清除限制
        </Button>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
