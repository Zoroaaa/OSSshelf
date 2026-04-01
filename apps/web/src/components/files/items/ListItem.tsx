/**
 * ListItem.tsx
 * 列表视图文件项组件
 *
 * 功能:
 * - 列表视图展示文件
 * - 选择、预览、下载等操作
 * - 显示标签、存储桶、权限等信息
 * - 移动端简化布局
 */

import { useResponsive } from '@/hooks/useResponsive';
import { FileIcon } from '@/components/files/FileIcon';
import { FileTagsDisplay } from '@/components/files/tags';
import { ActionBtn } from '../ActionBtn';
import { formatBytes, formatDate, decodeFileName } from '@/utils';
import { isPreviewable } from '@/utils/fileTypes';
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
  FolderOpen,
  Link,
  History as HistoryIcon,
  MoreVertical,
} from 'lucide-react';
import type { ItemProps } from '@/types/files';
import { useState, useRef } from 'react';

export function ListItem({
  file,
  isSelected,
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
  const canPreview = !file.isFolder && isPreviewable(file.mimeType);
  const { isMobile } = useResponsive();
  const [showActions, setShowActions] = useState(false);
  const actionBtnRef = useRef<HTMLDivElement>(null);

  if (isMobile) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-3 active:bg-accent/40 transition-colors cursor-pointer border-b last:border-b-0',
          isSelected && 'bg-primary/5'
        )}
        onClick={() => onClick(file)}
        onContextMenu={(e) => onContextMenu(e, file)}
      >
        <button
          className="flex-shrink-0 p-1 -ml-1 touch-target-sm flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(file.id, file);
          }}
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-primary" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground" />
          )}
        </button>

        <div className="flex-shrink-0">
          <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="md" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate pr-2">{decodeFileName(file.name)}</p>
          <p className="text-xs text-muted-foreground truncate">
            {file.isFolder ? '文件夹' : formatBytes(file.size)} · {formatDate(file.updatedAt)}
          </p>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {canPreview && (
            <button
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground active:bg-accent transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onPreview(file);
              }}
            >
              <Eye className="h-4 w-4" />
            </button>
          )}
          <button
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground active:bg-accent transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e as any, file);
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors cursor-pointer group',
        isSelected && 'bg-primary/5'
      )}
      onClick={() => onClick(file)}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <button
        className="flex-shrink-0 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(file.id, file);
        }}
      >
        {isSelected ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <div className="flex-shrink-0">
        <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="md" />
      </div>
      <div className="flex-[3] min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{decodeFileName(file.name)}</p>
          {tags && tags.length > 0 && <FileTagsDisplay tags={tags} size="xs" onTagClick={onTagClick} />}
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
          {(file as any).folderPath && (file as any).folderPath !== '/' && (
            <span className="inline-flex items-center gap-0.5 text-primary/70">
              <FolderOpen className="h-2.5 w-2.5" />
              <span className="truncate max-w-[120px] sm:max-w-[200px]">{(file as any).folderPath}</span>
              <span className="opacity-40">·</span>
            </span>
          )}
          {file.isFolder ? '文件夹' : formatBytes(file.size)} · {formatDate(file.updatedAt)}
          {file.mimeType && !file.isFolder && <span className="opacity-40 hidden sm:inline">{file.mimeType}</span>}
          {(file as any).bucket && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted border">
              <Database className="h-2.5 w-2.5" />
              {(file as any).bucket.name}
            </span>
          )}
          {(file as any).owner && !(file as any).isOwner && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <User className="h-2.5 w-2.5" />
              {(file as any).owner.name || (file as any).owner.email}
            </span>
          )}
          {(file as any).accessPermission && !(file as any).isOwner && (
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
                (file as any).accessPermission === 'admin'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800'
                  : (file as any).accessPermission === 'write'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800'
              }`}
            >
              {(file as any).accessPermission === 'admin'
                ? '管理'
                : (file as any).accessPermission === 'write'
                  ? '读写'
                  : '只读'}
            </span>
          )}
        </p>
      </div>
      <div
        className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity"
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
        <ActionBtn title="重命名" onClick={() => onRename(file)}>
          <Pencil className="h-3.5 w-3.5" />
        </ActionBtn>
        <ActionBtn title="移动到…" onClick={() => onMove(file)}>
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
        <ActionBtn title="移入回收站" onClick={() => onDelete(file)} danger>
          <Trash2 className="h-3.5 w-3.5" />
        </ActionBtn>
      </div>
    </div>
  );
}
