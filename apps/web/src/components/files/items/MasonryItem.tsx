/**
 * MasonryItem.tsx
 * 瀑布流视图文件项组件
 *
 * 功能:
 * - 瀑布流视图展示文件
 * - 图片自适应高度
 * - 选择操作
 */

import { useResponsive } from '@/hooks/useResponsive';
import { FileIcon } from '@/components/files/FileIcon';
import { FileTagsDisplay } from '@/components/files/tags';
import { filesApi } from '@/services/api';
import { formatBytes, decodeFileName } from '@/utils';
import { getFileCategory, getCategoryBg, formatAllowedMimeTypes } from '@/utils/fileTypes';
import { cn } from '@/utils';
import { CheckSquare, Square, Filter } from 'lucide-react';
import type { ItemProps } from '@/types/files';

export function MasonryItem({
  file,
  isSelected,
  token,
  tags,
  onClick,
  onToggleSelect,
  onDownload: _onDownload,
  onShare: _onShare,
  onDelete: _onDelete,
  onRename: _onRename,
  onPreview: _onPreview,
  onMove: _onMove,
  onContextMenu,
  onTagClick,
  onUploadLink: _onUploadLink,
  onDirectLink: _onDirectLink,
}: ItemProps) {
  const bg = getCategoryBg(getFileCategory(file.mimeType, file.isFolder));
  const isImage = file.mimeType?.startsWith('image/');
  const { isMobile } = useResponsive();
  const allowedTypes = file.isFolder ? formatAllowedMimeTypes((file as any).allowedMimeTypes) : null;

  return (
    <div
      className={cn(
        'masonry-item relative bg-card border rounded-lg overflow-hidden cursor-pointer group',
        isSelected && 'ring-2 ring-primary'
      )}
      onClick={() => onClick(file)}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <div className={cn('relative', !isImage && bg)}>
        {isImage ? (
          <img
            src={filesApi.previewUrl(file.id, token)}
            alt={decodeFileName(file.name)}
            className="w-full block object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex items-center justify-center p-8">
            <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="lg" />
          </div>
        )}
        <button
          className={cn(
            'absolute top-2 left-2 transition-opacity z-10',
            isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(file.id, file);
          }}
        >
          <div
            className={cn(
              'rounded w-5 h-5 flex items-center justify-center',
              isSelected ? 'bg-primary text-primary-foreground' : 'bg-black/40 text-white'
            )}
          >
            {isSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </div>
        </button>
      </div>
      <div className="px-2 py-1.5 border-t">
        <p className="text-xs font-medium truncate">{decodeFileName(file.name)}</p>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <p className="text-[10px] text-muted-foreground">{file.isFolder ? '文件夹' : formatBytes(file.size)}</p>
          {allowedTypes && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              <Filter className="h-2 w-2" />
              {allowedTypes.join('、')}
              {allowedTypes.length < JSON.parse((file as any).allowedMimeTypes).length && '…'}
            </span>
          )}
        </div>
        {tags && tags.length > 0 && (
          <FileTagsDisplay tags={tags} size="xs" className="mt-0.5" onTagClick={onTagClick} />
        )}
      </div>
    </div>
  );
}
