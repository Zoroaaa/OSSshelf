/**
 * FileListContainer.tsx
 * 文件列表容器组件
 *
 * 功能:
 * - 根据视图模式渲染不同的列表组件
 * - 处理空状态和加载状态
 * - 统一处理右键菜单
 */

import type { FileItem } from '@osshelf/shared';
import type { ViewMode } from '@/stores/files';
import { ListItem } from './items';
import { GridItem } from './items';
import { MasonryItem } from './items';
import { GalleryItem } from './items';
import { decodeFileName } from '@/utils';

interface FileListContainerProps {
  viewMode: ViewMode;
  galleryMode: boolean;
  displayFiles: FileItem[];
  imageFiles: FileItem[];
  isLoading: boolean;
  searchQuery: string;
  selectedFiles: string[];
  fileTagsMap: Record<string, any[]>;
  token: string;
  onFileClick: (file: FileItem) => void;
  onToggleSelect: (id: string, file?: FileItem) => void;
  onDownload: (file: FileItem) => void;
  onShare: (id: string) => void;
  onDelete: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onPreview: (file: FileItem) => void;
  onMove: (file: FileItem) => void;
  onContextMenu: (e: React.MouseEvent, file?: FileItem) => void;
  onTagClick: (tagName: string) => void;
  onUploadLink?: (file: FileItem) => void;
  onDirectLink?: (file: FileItem) => void;
  onVersionHistory?: (file: FileItem) => void;
}

export function FileListContainer({
  viewMode,
  galleryMode,
  displayFiles,
  imageFiles,
  isLoading,
  searchQuery,
  selectedFiles,
  fileTagsMap,
  token,
  onFileClick,
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
}: FileListContainerProps) {
  const hasImages = imageFiles.length > 0;

  if (isLoading) {
    return <div className="text-center py-16 text-muted-foreground">加载中...</div>;
  }

  if (displayFiles.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground space-y-2" onContextMenu={(e) => onContextMenu(e)}>
        <div className="text-6xl opacity-20">📂</div>
        <p className="font-medium">{searchQuery ? `没有找到 "${searchQuery}"` : '暂无文件'}</p>
        <p className="text-sm">{searchQuery ? '换个关键词试试' : '拖放文件或整个文件夹到这里上传'}</p>
      </div>
    );
  }

  if (galleryMode && hasImages) {
    return (
      <div className="masonry-grid">
        {imageFiles.map((file) => (
          <GalleryItem
            key={file.id}
            file={file}
            token={token}
            onClick={() => onPreview(file)}
            onDelete={() => confirm(`删除 "${decodeFileName(file.name)}"？`) && onDelete(file)}
            onContextMenu={(e) => onContextMenu(e, file)}
          />
        ))}
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="bg-card border rounded-xl overflow-hidden divide-y" onContextMenu={(e) => onContextMenu(e)}>
        {displayFiles.map((file) => (
          <ListItem
            key={file.id}
            file={file}
            isSelected={selectedFiles.includes(file.id)}
            tags={fileTagsMap[file.id]}
            onClick={onFileClick}
            onToggleSelect={onToggleSelect}
            onDownload={onDownload}
            onShare={onShare}
            onDelete={(f) => confirm(`将 "${decodeFileName(f.name)}" 移入回收站？`) && onDelete(f)}
            onRename={onRename}
            onPreview={onPreview}
            onMove={onMove}
            onContextMenu={onContextMenu}
            onTagClick={onTagClick}
            onUploadLink={onUploadLink}
            onDirectLink={onDirectLink}
            onVersionHistory={onVersionHistory}
          />
        ))}
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="file-grid" onContextMenu={(e) => onContextMenu(e)}>
        {displayFiles.map((file) => (
          <GridItem
            key={file.id}
            file={file}
            token={token}
            isSelected={selectedFiles.includes(file.id)}
            tags={fileTagsMap[file.id]}
            onClick={onFileClick}
            onToggleSelect={onToggleSelect}
            onDownload={onDownload}
            onShare={onShare}
            onDelete={(f) => confirm(`将 "${decodeFileName(f.name)}" 移入回收站？`) && onDelete(f)}
            onRename={onRename}
            onPreview={onPreview}
            onMove={onMove}
            onContextMenu={onContextMenu}
            onTagClick={onTagClick}
            onUploadLink={onUploadLink}
            onDirectLink={onDirectLink}
            onVersionHistory={onVersionHistory}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="masonry-grid" onContextMenu={(e) => onContextMenu(e)}>
      {displayFiles.map((file) => (
        <MasonryItem
          key={file.id}
          file={file}
          token={token}
          isSelected={selectedFiles.includes(file.id)}
          tags={fileTagsMap[file.id]}
          onClick={onFileClick}
          onToggleSelect={onToggleSelect}
          onDownload={onDownload}
          onShare={onShare}
          onDelete={(f) => confirm(`将 "${decodeFileName(f.name)}" 移入回收站？`) && onDelete(f)}
          onRename={onRename}
          onPreview={onPreview}
          onMove={onMove}
          onContextMenu={onContextMenu}
          onTagClick={onTagClick}
          onUploadLink={onUploadLink}
          onDirectLink={onDirectLink}
        />
      ))}
    </div>
  );
}
