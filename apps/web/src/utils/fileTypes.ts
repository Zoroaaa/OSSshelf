/**
 * fileTypes.ts
 * 文件类型工具
 *
 * 功能:
 * - 文件类型分类（图片、视频、音频、文档等）
 * - MIME类型判断
 * - 文件图标映射
 * - 预览类型判断
 */

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'code'
  | 'archive'
  | 'installer'
  | 'text'
  | 'folder'
  | 'unknown';

export function getFileCategory(mimeType: string | null | undefined, isFolder?: boolean): FileCategory {
  if (isFolder) return 'folder';
  if (!mimeType) return 'unknown';

  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'text';

  const docTypes = [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
  ];
  if (docTypes.includes(mimeType)) return 'document';

  const sheetTypes = [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
  ];
  if (sheetTypes.includes(mimeType)) return 'spreadsheet';

  const pptTypes = [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation',
  ];
  if (pptTypes.includes(mimeType)) return 'presentation';

  const archiveTypes = [
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',
    'application/x-bzip2',
  ];
  if (archiveTypes.includes(mimeType)) return 'archive';

  const installerTypes = [
    'application/x-msdownload',
    'application/x-msi',
    'application/x-apple-diskimage',
    'application/x-newton-compatible-pkg',
    'application/vnd.debian.binary-package',
    'application/x-rpm',
    'application/vnd.android.package-archive',
    'application/x-executable',
  ];
  if (installerTypes.includes(mimeType)) return 'installer';

  const codeTypes = [
    'application/javascript',
    'application/typescript',
    'application/json',
    'application/xml',
    'application/x-sh',
    'application/x-python',
  ];
  if (codeTypes.includes(mimeType) || mimeType.includes('script')) return 'code';

  return 'unknown';
}

import { isPreviewableMimeType } from '@osshelf/shared';

export function isPreviewable(mimeType: string | null | undefined): boolean {
  return isPreviewableMimeType(mimeType);
}

/** Color class for each category */
export function getCategoryColor(category: FileCategory): string {
  const colors: Record<FileCategory, string> = {
    folder: 'text-amber-400',
    image: 'text-emerald-400',
    video: 'text-purple-400',
    audio: 'text-pink-400',
    pdf: 'text-red-400',
    document: 'text-blue-400',
    spreadsheet: 'text-green-400',
    presentation: 'text-orange-400',
    code: 'text-cyan-400',
    archive: 'text-yellow-400',
    installer: 'text-indigo-400',
    text: 'text-slate-400',
    unknown: 'text-muted-foreground',
  };
  return colors[category];
}

/** Background tint for grid cards */
export function getCategoryBg(category: FileCategory): string {
  const bgs: Record<FileCategory, string> = {
    folder: 'bg-amber-500/10',
    image: 'bg-emerald-500/10',
    video: 'bg-purple-500/10',
    audio: 'bg-pink-500/10',
    pdf: 'bg-red-500/10',
    document: 'bg-blue-500/10',
    spreadsheet: 'bg-green-500/10',
    presentation: 'bg-orange-500/10',
    code: 'bg-cyan-500/10',
    archive: 'bg-yellow-500/10',
    installer: 'bg-indigo-500/10',
    text: 'bg-slate-500/10',
    unknown: 'bg-muted/50',
  };
  return bgs[category];
}
