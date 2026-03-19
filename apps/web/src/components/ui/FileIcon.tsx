/**
 * FileIcon.tsx
 * 文件图标组件
 *
 * 功能:
 * - 根据MIME类型显示对应图标
 * - 支持文件夹图标
 * - 支持多种尺寸
 * - 支持自定义颜色
 */

import {
  Folder,
  Image,
  Video,
  Music,
  FileText,
  FileSpreadsheet,
  Presentation,
  Code,
  Archive,
  File,
  FileType2,
  Package,
} from 'lucide-react';
import { getFileCategory, getCategoryColor, type FileCategory } from '@/utils/fileTypes';
import { cn } from '@/lib/utils';

interface FileIconProps {
  mimeType?: string | null;
  isFolder?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const iconMap: Record<FileCategory, React.ElementType> = {
  folder: Folder,
  image: Image,
  video: Video,
  audio: Music,
  pdf: FileType2,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  code: Code,
  archive: Archive,
  installer: Package,
  text: FileText,
  unknown: File,
};

const sizeMap = {
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function FileIcon({ mimeType, isFolder, className, size = 'md' }: FileIconProps) {
  const category = getFileCategory(mimeType, isFolder);
  const Icon = iconMap[category];
  const color = getCategoryColor(category);

  return <Icon className={cn(sizeMap[size], color, className)} />;
}
