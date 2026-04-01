/**
 * files.ts
 * 文件页面相关类型定义
 *
 * 功能:
 * - 文件项组件 Props 类型
 * - 高级搜索条件类型
 * - 上传进度类型
 */

import type { FileItem } from '@osshelf/shared';

export interface ItemProps {
  file: FileItem;
  isSelected?: boolean;
  token?: string;
  tags?: any[];
  onClick: (f: FileItem) => void;
  onToggleSelect: (id: string, file?: FileItem) => void;
  onDownload: (f: FileItem) => void;
  onShare: (id: string) => void;
  onDelete: (f: FileItem) => void;
  onRename: (f: FileItem) => void;
  onPreview: (f: FileItem) => void;
  onMove: (f: FileItem) => void;
  onContextMenu: (e: React.MouseEvent, file?: FileItem) => void;
  onTagClick?: (tagName: string) => void;
  onUploadLink?: (f: FileItem) => void;
  onDirectLink?: (f: FileItem) => void;
  onVersionHistory?: (f: FileItem) => void;
}

export interface GalleryItemProps {
  file: FileItem;
  token?: string;
  onClick: () => void;
  onDelete: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export interface AdvancedSearchCondition {
  field: 'name' | 'mimeType' | 'size' | 'createdAt' | 'updatedAt' | 'tags';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: string | number | string[];
}

export type AdvancedSearchLogic = 'and' | 'or';

export interface UploadProgress {
  [key: string]: number;
}

export interface FileContextMenuCallbacks {
  onOpen: (file: FileItem) => void;
  onDownload: (file: FileItem) => void;
  onShare: (file: FileItem) => void;
  onTags: (file: FileItem) => void;
  onPermissions: (file: FileItem) => void;
  onFolderSettings: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onMove: (file: FileItem) => void;
  onCopy: (file: FileItem) => void;
  onCut: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
  /** 仅文件夹可用：创建上传链接 */
  onUploadLink?: (file: FileItem) => void;
  /** 仅文件可用：直链管理 */
  onDirectLink?: (file: FileItem) => void;
  /** 仅文件可用：版本历史 */
  onVersionHistory?: (file: FileItem) => void;
}

export interface BackgroundContextMenuCallbacks {
  onRefresh: () => void;
  onSelectAll: () => void;
  onUpload: () => void;
  onNewFolder: () => void;
  onNewFile?: () => void;
  onPaste: () => void;
  hasClipboard: boolean;
  clipboardCount: number;
}
