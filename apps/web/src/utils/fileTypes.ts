/**
 * fileTypes.ts
 * 文件类型工具
 *
 * 功能:
 * - 文件类型分类（图片、视频、音频、文档等）
 * - MIME类型判断
 * - 文件图标映射
 * - 预览类型判断
 *
 * ============================================================================
 * 【重要提醒】修改此文件后必须同步更新：
 *   - packages/shared/src/constants/previewTypes.ts      # 预览类型配置
 *   - apps/web/src/components/files/FileIcon.tsx        # 文件图标
 * ============================================================================
 */

import {
  IMAGE_MIME_PREFIX,
  VIDEO_MIME_PREFIX,
  AUDIO_MIME_PREFIX,
  PDF_MIME_TYPE,
  TEXT_MIME_PREFIX,
  OFFICE_MIME_TYPES,
  EPUB_MIME_TYPES,
  FONT_MIME_TYPES,
  isPreviewableMimeType,
} from '@osshelf/shared';

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
  | 'epub'
  | 'font'
  | 'unknown';

export function getFileCategory(
  mimeType: string | null | undefined,
  isFolder?: boolean,
  fileName?: string
): FileCategory {
  if (isFolder) return 'folder';
  if (!mimeType) {
    if (fileName) {
      const ext = '.' + (fileName.split('.').pop()?.toLowerCase() || '');
      if (ext === '.epub') return 'epub';
      if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) return 'font';
    }
    return 'unknown';
  }

  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return 'image';
  if (mimeType.startsWith(VIDEO_MIME_PREFIX)) return 'video';
  if (mimeType.startsWith(AUDIO_MIME_PREFIX)) return 'audio';
  if (mimeType === PDF_MIME_TYPE) return 'pdf';
  if (mimeType.startsWith(TEXT_MIME_PREFIX)) return 'text';
  if (EPUB_MIME_TYPES.includes(mimeType as (typeof EPUB_MIME_TYPES)[number])) return 'epub';
  if (FONT_MIME_TYPES.includes(mimeType as (typeof FONT_MIME_TYPES)[number])) return 'font';

  if (OFFICE_MIME_TYPES.word.includes(mimeType as (typeof OFFICE_MIME_TYPES.word)[number])) return 'document';
  if (OFFICE_MIME_TYPES.excel.includes(mimeType as (typeof OFFICE_MIME_TYPES.excel)[number])) return 'spreadsheet';
  if (OFFICE_MIME_TYPES.powerpoint.includes(mimeType as (typeof OFFICE_MIME_TYPES.powerpoint)[number])) {
    return 'presentation';
  }

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

export function isPreviewable(mimeType: string | null | undefined): boolean {
  return isPreviewableMimeType(mimeType);
}

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
    epub: 'text-teal-400',
    font: 'text-rose-400',
    unknown: 'text-muted-foreground',
  };
  return colors[category];
}

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
    epub: 'bg-teal-500/10',
    font: 'bg-rose-500/10',
    unknown: 'bg-muted/50',
  };
  return bgs[category];
}
