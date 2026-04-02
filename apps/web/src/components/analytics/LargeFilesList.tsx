/**
 * LargeFilesList.tsx
 * 大文件列表组件
 */

import { File, ExternalLink, Trash2 } from 'lucide-react';
import type { LargeFileItem } from '../../services/api';
import { formatBytes } from '../../utils';
import { PROVIDER_META } from '../../services/api';

interface LargeFilesListProps {
  files: LargeFileItem[];
  onFileClick?: (file: LargeFileItem) => void;
  onDelete?: (file: LargeFileItem) => void;
}

export function LargeFilesList({ files, onFileClick, onDelete }: LargeFilesListProps) {
  if (files.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-8 border border-gray-200 dark:border-gray-700 text-center text-gray-500">
        <File className="h-12 w-12 mx-auto mb-2 opacity-30" />
        <p>暂无文件</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold">大文件 Top 20</h3>
        <p className="text-sm text-gray-500">占用存储空间最多的文件</p>
      </div>

      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {files.map((file, index) => {
          const provider = file.bucket?.provider
            ? PROVIDER_META[file.bucket.provider as keyof typeof PROVIDER_META]
            : null;
          return (
            <div
              key={file.id}
              className="flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex-shrink-0 w-8 text-center text-gray-400 font-medium">#{index + 1}</div>

              <div className="flex-shrink-0">
                <File className="h-8 w-8 text-gray-400" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="font-medium truncate cursor-pointer hover:text-blue-500"
                    onClick={() => onFileClick?.(file)}
                    title={file.name}
                  >
                    {file.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{formatBytes(file.size)}</span>
                  <span>•</span>
                  <span>{file.mimeType || '未知类型'}</span>
                  {file.bucket && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        {provider?.icon && <span>{provider.icon}</span>}
                        {file.bucket.name}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => onFileClick?.(file)}
                  className="p-1.5 text-gray-400 hover:text-blue-500 rounded transition-colors"
                  title="查看"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
                {onDelete && (
                  <button
                    onClick={() => onDelete(file)}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
