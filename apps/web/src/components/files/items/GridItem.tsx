/**
 * GridItem.tsx
 * 网格视图文件项组件
 *
 * 功能:
 * - 网格视图展示文件
 * - 图片缩略图预览
 * - 选择、预览、下载等操作
 * - 移动端简化布局
 */

import { useResponsive } from '@/hooks/useResponsive';
import { FileIcon } from '@/components/files/FileIcon';
import { FileTagsDisplay } from '@/components/files/tags';
import { ActionBtn } from '../ActionBtn';
import { formatBytes, decodeFileName } from '@/utils';
import { getFileCategory, getCategoryBg, isPreviewable, formatAllowedMimeTypes } from '@/utils/fileTypes';
import { cn } from '@/utils';
import {
  CheckSquare,
  Square,
  Eye,
  Pencil,
  FolderInput,
  Download,
  Share2,
  Trash2,
  Database,
  User,
  Upload,
  Link,
  History as HistoryIcon,
  MoreVertical,
  Filter,
} from 'lucide-react';
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
  onUploadLink,
  onDirectLink,
  onVersionHistory,
}: ItemProps) {
  const bg = getCategoryBg(getFileCategory(file.mimeType, file.isFolder));
  const canPreview = !file.isFolder && isPreviewable(file.mimeType);
  const isImage = file.mimeType?.startsWith('image/');
  const { isMobile } = useResponsive();
  const allowedTypes = file.isFolder ? formatAllowedMimeTypes((file as any).allowedMimeTypes) : null;

  if (isMobile) {
    return (
      <div
        className={cn(
          'relative bg-card border rounded-xl overflow-hidden cursor-pointer active:scale-[0.98] transition-transform',
          isSelected && 'ring-2 ring-primary'
        )}
        onClick={() => onClick(file)}
        onContextMenu={(e) => onContextMenu(e, file)}
      >
        <div className={cn('flex items-center justify-center relative', isImage ? 'h-24' : 'h-20', !isImage && bg)}>
          {isImage ? (
            <img
              src={`${import.meta.env.VITE_API_URL || ''}/api/files/${file.id}/preview${token ? `?token=${encodeURIComponent(token)}` : ''}`}
              alt={decodeFileName(file.name)}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as any).style.display = 'none';
              }}
            />
          ) : (
            <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="lg" />
          )}
          <button
            className="absolute top-1.5 left-1.5 z-10"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(file.id, file);
            }}
          >
            <div
              className={cn(
                'rounded-lg w-7 h-7 flex items-center justify-center backdrop-blur-sm',
                isSelected ? 'bg-primary text-primary-foreground' : 'bg-black/40 text-white'
              )}
            >
              {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </div>
          </button>
          <button
            className="absolute top-1.5 right-1.5 z-10"
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e as any, file);
            }}
          >
            <div className="rounded-lg w-7 h-7 flex items-center justify-center bg-black/40 text-white backdrop-blur-sm">
              <MoreVertical className="h-4 w-4" />
            </div>
          </button>
        </div>
        <div className="px-2.5 py-2 border-t">
          <p className="text-xs font-medium line-clamp-2 leading-tight">{decodeFileName(file.name)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {file.isFolder ? '文件夹' : formatBytes(file.size)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative bg-card border rounded-xl overflow-hidden cursor-pointer group transition-all hover:shadow-md hover:-translate-y-0.5',
        isSelected && 'ring-2 ring-primary'
      )}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <div className={cn('flex items-center justify-center h-28 relative', !isImage && bg)}>
        {isImage ? (
          <img
            src={`${import.meta.env.VITE_API_URL || ''}/api/files/${file.id}/preview${token ? `?token=${encodeURIComponent(token)}` : ''}`}
            alt={decodeFileName(file.name)}
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
        <div
          className={cn(
            'absolute top-2 right-2 flex flex-wrap gap-0.5 transition-opacity z-10 max-w-[calc(100%-3rem)]',
            isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {canPreview && (
            <ActionBtn title="预览" onClick={() => onPreview(file)}>
              <Eye className="h-3.5 w-3.5" />
            </ActionBtn>
          )}
          {file.isFolder && onUploadLink && (
            <ActionBtn title="创建上传链接" onClick={() => onUploadLink(file)}>
              <Upload className="h-3.5 w-3.5" />
            </ActionBtn>
          )}
          {file.isFolder && (
            <ActionBtn title="分享文件夹" onClick={() => onShare(file.id)}>
              <Share2 className="h-3.5 w-3.5" />
            </ActionBtn>
          )}
          {!file.isFolder && onDirectLink && (
            <ActionBtn title="直链管理" onClick={() => onDirectLink(file)}>
              <Link className="h-3.5 w-3.5" />
            </ActionBtn>
          )}
          {!file.isFolder && onVersionHistory && (
            <ActionBtn title="版本历史" onClick={() => onVersionHistory(file)}>
              <HistoryIcon className="h-3.5 w-3.5" />
            </ActionBtn>
          )}
          <ActionBtn title="重命名" onClick={() => onRename(file)}>
            <Pencil className="h-3.5 w-3.5" />
          </ActionBtn>
          <ActionBtn title="移动" onClick={() => onMove(file)}>
            <FolderInput className="h-3.5 w-3.5" />
          </ActionBtn>
          {!file.isFolder && (
            <ActionBtn title="下载" onClick={() => onDownload(file)}>
              <Download className="h-3.5 w-3.5" />
            </ActionBtn>
          )}
          {!file.isFolder && (
            <ActionBtn title="分享" onClick={() => onShare(file.id)}>
              <Share2 className="h-3.5 w-3.5" />
            </ActionBtn>
          )}
          <ActionBtn title="删除" onClick={() => onDelete(file)} danger>
            <Trash2 className="h-3.5 w-3.5" />
          </ActionBtn>
        </div>
      </div>
      <div className="px-3 py-2 border-t cursor-pointer" onClick={() => onClick(file)}>
        <p className={cn('text-xs font-medium', isMobile ? 'line-clamp-2' : 'truncate')}>{decodeFileName(file.name)}</p>
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <p className="text-xs text-muted-foreground">{file.isFolder ? '文件夹' : formatBytes(file.size)}</p>
          {allowedTypes && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              <Filter className="h-2 w-2" />
              {allowedTypes.join('、')}
              {allowedTypes.length < JSON.parse((file as any).allowedMimeTypes).length && '…'}
            </span>
          )}
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
    </div>
  );
}
