/**
 * StarredFiles.tsx
 * 收藏文件列表组件
 *
 * 功能:
 * - 显示用户收藏的文件列表
 * - 支持取消收藏
 * - 点击跳转文件详情
 */

import { useState, useEffect } from 'react';
import { Star, File, Folder, ExternalLink, Loader2 } from 'lucide-react';
import { filesApi } from '../../services/api';
import { formatBytes } from '../../utils';
import type { FileItem } from '@osshelf/shared';
import { StarButton } from './StarButton';

interface StarredFilesProps {
  onFileClick?: (file: FileItem) => void;
  className?: string;
}

export function StarredFiles({ onFileClick, className }: StarredFilesProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStarredFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await filesApi.list({ starred: 'true' });
      if (res.data.success && res.data.data) {
        setFiles(res.data.data);
      }
    } catch (err) {
      setError('加载收藏文件失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStarredFiles();
  }, []);

  const handleStarToggle = (fileId: string, isStarred: boolean) => {
    if (!isStarred) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        {error}
        <button onClick={fetchStarredFiles} className="ml-2 text-blue-500 hover:underline">
          重试
        </button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <Star className="h-12 w-12 mx-auto mb-2 opacity-30" />
        <p>暂无收藏文件</p>
        <p className="text-sm mt-1">点击文件旁的星星图标即可收藏</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Star className="h-5 w-5 text-yellow-500 fill-current" />
          收藏文件
          <span className="text-sm font-normal text-gray-500">({files.length})</span>
        </h3>
      </div>

      <div className="space-y-2">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-sm transition-shadow"
          >
            <div className="flex-shrink-0">
              {file.isFolder ? (
                <Folder className="h-8 w-8 text-blue-500" />
              ) : (
                <File className="h-8 w-8 text-gray-400" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="font-medium truncate cursor-pointer hover:text-blue-500"
                  onClick={() => onFileClick?.(file)}
                >
                  {file.name}
                </span>
                {file.path && (
                  <span className="text-xs text-gray-400 truncate" title={file.path}>
                    {file.path}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                {!file.isFolder && <span>{formatBytes(file.size)}</span>}
                <span>•</span>
                <span>{new Date(file.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onFileClick?.(file)}
                className="p-1.5 text-gray-400 hover:text-blue-500 rounded"
                title="打开"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
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
    </div>
  );
}
