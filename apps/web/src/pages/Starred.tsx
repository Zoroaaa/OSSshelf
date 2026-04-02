/**
 * Starred.tsx
 * 收藏文件页面（独立路由 /starred）
 */

import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '@/services/api';
import { FileIcon } from '@/components/files/FileIcon';
import { StarButton } from '@/components/files/StarButton';
import { useToast } from '@/components/ui/useToast';
import { formatBytes, formatDate } from '@/utils';
import type { FileItem } from '@osshelf/shared';
import { Star, Loader2, FolderOpen } from 'lucide-react';

export default function Starred() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: files = [],
    isLoading,
  } = useQuery<FileItem[]>({
    queryKey: ['files', 'starred'],
    queryFn: () => filesApi.list({ starred: 'true' }).then((r) => r.data.data ?? []),
    staleTime: 30000,
  });

  const handleFileClick = (file: FileItem) => {
    if (file.isFolder) {
      navigate(`/files/${file.id}`);
    } else {
      navigate(`/files?preview=${file.id}`);
    }
  };

  const handleStarToggle = (_fileId: string, isStarred: boolean) => {
    if (!isStarred) {
      queryClient.invalidateQueries({ queryKey: ['files', 'starred'] });
      toast({ title: '已取消收藏' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
          <Star className="h-5 w-5 lg:h-6 lg:w-6 text-yellow-500 fill-yellow-500" />
          收藏
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">{isLoading ? '加载中…' : `${files.length} 个收藏文件`}</p>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Star className="h-10 w-10 lg:h-12 lg:w-12 opacity-20" />
          <p className="text-sm font-medium">暂无收藏文件</p>
          <p className="text-xs">在文件列表中点击 ☆ 即可收藏</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/40 transition-colors cursor-pointer group overflow-hidden"
              onClick={() => handleFileClick(file)}
            >
              <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="md" />

              <div className="flex-1 min-w-0 overflow-hidden">
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

              <div
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity touch-visible"
                onClick={(e) => e.stopPropagation()}
              >
                <StarButton
                  fileId={file.id}
                  isStarred={true}
                  size="sm"
                  onToggle={(isStarred) => handleStarToggle(file.id, isStarred)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
