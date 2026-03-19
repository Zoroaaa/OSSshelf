/**
 * GridItem.tsx
 * 网格视图文件项组件
 *
 * 功能:
 * - 网格视图展示文件
 * - 图片缩略图预览
 * - 选择、预览、下载等操作
 */

import { useResponsive } from '@/hooks/useResponsive';
import { FileIcon } from '@/components/ui/FileIcon';
import { FileTagsDisplay } from '@/components/ui/FileTagsDisplay';
import { ActionBtn } from './ActionBtn';
import { filesApi } from '@/services/api';
import { formatBytes } from '@/utils';
import { getFileCategory, getCategoryBg, isPreviewable } from '@/utils/fileTypes';
import { cn } from '@/utils';
import { CheckSquare, Square, Eye, Pencil, FolderInput, Download, Share2, Trash2, Database, User } from 'lucide-react';
import type { ItemProps } from '@/types/files';

export function GridItem({
  file,
  isSelected,
  token,
  tags,
  onClick,
  onToggleSelect,
  onDownload,
  onShare,
  onDelete,
  onRename,
  onPreview,
  onMove,
  onContextMenu,
  onTagClick,
}: ItemProps) {
  const bg = getCategoryBg(getFileCategory(file.mimeType, file.isFolder));
  const canPreview = !file.isFolder && isPreviewable(file.mimeType);
  const isImage = file.mimeType?.startsWith('image/');
  const { isMobile } = useResponsive();

  return (
    <div
      className={cn(
        'relative bg-card border rounded-xl overflow-hidden cursor-pointer group transition-all hover:shadow-md hover:-translate-y-0.5',
        isSelected && 'ring-2 ring-primary'
      )}
      onClick={() => onClick(file)}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <div className={cn('flex items-center justify-center h-28 relative', !isImage && bg)}>
        {isImage ? (
          <img
            src={filesApi.previewUrl(file.id, token)}
            alt={file.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as any).style.display = 'none';
            }}
          />
        ) : (
          <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="lg" />
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
      <div className="px-3 py-2 border-t">
        <p className="text-xs font-medium truncate">{file.name}</p>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <p className="text-xs text-muted-foreground">{file.isFolder ? '文件夹' : formatBytes(file.size)}</p>
          {(file as any).bucket && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-muted border">
              <Database className="h-2 w-2" />
              {(file as any).bucket.name}
            </span>
          )}
          {(file as any).owner && !(file as any).isOwner && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <User className="h-2 w-2" />
              {(file as any).owner.name || (file as any).owner.email}
            </span>
          )}
        </div>
        {tags && tags.length > 0 && <FileTagsDisplay tags={tags} size="xs" className="mt-1" onTagClick={onTagClick} />}
      </div>
      <div
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity flex items-center justify-center gap-1.5 rounded-xl',
          isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {canPreview && (
          <ActionBtn title="预览" onClick={() => onPreview(file)} light>
            <Eye className="h-3.5 w-3.5" />
          </ActionBtn>
        )}
        <ActionBtn title="重命名" onClick={() => onRename(file)} light>
          <Pencil className="h-3.5 w-3.5" />
        </ActionBtn>
        <ActionBtn title="移动" onClick={() => onMove(file)} light>
          <FolderInput className="h-3.5 w-3.5" />
        </ActionBtn>
        {!file.isFolder && (
          <ActionBtn title="下载" onClick={() => onDownload(file)} light>
            <Download className="h-3.5 w-3.5" />
          </ActionBtn>
        )}
        {!file.isFolder && (
          <ActionBtn title="分享" onClick={() => onShare(file.id)} light>
            <Share2 className="h-3.5 w-3.5" />
          </ActionBtn>
        )}
        <ActionBtn title="删除" onClick={() => onDelete(file)} danger light>
          <Trash2 className="h-3.5 w-3.5" />
        </ActionBtn>
      </div>
    </div>
  );
}
