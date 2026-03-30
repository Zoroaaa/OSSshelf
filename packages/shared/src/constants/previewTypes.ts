/**
 * previewTypes.ts
 * 文件预览类型统一配置
 *
 * ============================================================================
 * 【重要提醒】修改此文件后必须同步更新以下文件：
 * ============================================================================
 *
 * 后端:
 *   - apps/api/src/routes/preview.ts          # isPreviewable 函数
 *
 * 前端 - 文件管理:
 *   - apps/web/src/components/files/FilePreview.tsx      # 预览组件
 *
 * 前端 - 分享页面:
 *   - apps/web/src/components/share/ShareFilePreview.tsx # 分享预览组件
 *
 * 前端 - 工具函数:
 *   - apps/web/src/utils/fileTypes.ts        # getFileCategory 函数
 *   - apps/web/src/components/files/FileIcon.tsx        # 图标映射
 *
 * ============================================================================
 */

/** 图片类型 MIME 前缀 */
export const IMAGE_MIME_PREFIX = 'image/';

/** 视频类型 MIME 前缀 */
export const VIDEO_MIME_PREFIX = 'video/';

/** 音频类型 MIME 前缀 */
export const AUDIO_MIME_PREFIX = 'audio/';

/** PDF MIME 类型 */
export const PDF_MIME_TYPE = 'application/pdf';

/** Markdown MIME 类型 */
export const MARKDOWN_MIME_TYPE = 'text/markdown';

/** CSV MIME 类型 */
export const CSV_MIME_TYPE = 'text/csv';

/** 文本类型 MIME 前缀 */
export const TEXT_MIME_PREFIX = 'text/';

/** JSON MIME 类型 */
export const JSON_MIME_TYPE = 'application/json';

/** XML MIME 类型 */
export const XML_MIME_TYPE = 'application/xml';

/** Office 文档 MIME 类型 */
export const OFFICE_MIME_TYPES = {
  word: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  excel: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  powerpoint: [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
} as const;

/** EPUB 电子书 MIME 类型 */
export const EPUB_MIME_TYPES = ['application/epub+zip', 'application/epub', 'application/x-epub+zip'] as const;

/** 字体文件 MIME 类型 */
export const FONT_MIME_TYPES = ['font/ttf', 'font/otf', 'font/woff', 'font/woff2'] as const;

/** ZIP 压缩包 MIME 类型 */
export const ARCHIVE_PREVIEW_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
] as const;

/** 所有 Office MIME 类型列表 */
export const ALL_OFFICE_MIME_TYPES = [
  ...OFFICE_MIME_TYPES.word,
  ...OFFICE_MIME_TYPES.excel,
  ...OFFICE_MIME_TYPES.powerpoint,
] as const;

/** 所有可预览的 MIME 类型 */
export const PREVIEWABLE_MIME_TYPES = [
  IMAGE_MIME_PREFIX,
  VIDEO_MIME_PREFIX,
  AUDIO_MIME_PREFIX,
  PDF_MIME_TYPE,
  TEXT_MIME_PREFIX,
  JSON_MIME_TYPE,
  XML_MIME_TYPE,
  ...ALL_OFFICE_MIME_TYPES,
  ...EPUB_MIME_TYPES,
  ...FONT_MIME_TYPES,
  ...ARCHIVE_PREVIEW_MIME_TYPES,
] as const;

/** 预览类型枚举 */
export type PreviewType =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'markdown'
  | 'csv'
  | 'text'
  | 'code'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'epub'
  | 'font'
  | 'archive'
  | 'unknown';

/** 文件扩展名到预览类型的映射 */
export const EXTENSION_PREVIEW_MAP: Record<string, PreviewType> = {
  '.epub': 'epub',
  '.ttf': 'font',
  '.otf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
  '.zip': 'archive',
  '.csv': 'csv',
  '.md': 'markdown',
  '.doc': 'word',
  '.docx': 'word',
  '.xls': 'excel',
  '.xlsx': 'excel',
  '.ppt': 'powerpoint',
  '.pptx': 'powerpoint',
};

/**
 * 根据文件名扩展名获取预览类型
 */
export function getPreviewTypeByExtension(fileName: string): PreviewType | null {
  const ext = '.' + (fileName.split('.').pop()?.toLowerCase() || '');
  return EXTENSION_PREVIEW_MAP[ext] || null;
}

/**
 * 判断 MIME 类型是否可预览
 * @param mimeType 文件 MIME 类型
 * @param fileName 可选的文件名，用于扩展名判断
 */
export function isPreviewableMimeType(mimeType: string | null | undefined, fileName?: string): boolean {
  if (!mimeType) {
    if (fileName) {
      const extType = getPreviewTypeByExtension(fileName);
      return extType !== null;
    }
    return false;
  }

  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return true;
  if (mimeType.startsWith(VIDEO_MIME_PREFIX)) return true;
  if (mimeType.startsWith(AUDIO_MIME_PREFIX)) return true;
  if (mimeType === PDF_MIME_TYPE) return true;
  if (mimeType.startsWith(TEXT_MIME_PREFIX)) return true;
  if (mimeType === JSON_MIME_TYPE) return true;
  if (mimeType === XML_MIME_TYPE) return true;
  if (ALL_OFFICE_MIME_TYPES.includes(mimeType as (typeof ALL_OFFICE_MIME_TYPES)[number])) return true;
  if (EPUB_MIME_TYPES.includes(mimeType as (typeof EPUB_MIME_TYPES)[number])) return true;
  if (FONT_MIME_TYPES.includes(mimeType as (typeof FONT_MIME_TYPES)[number])) return true;
  if (ARCHIVE_PREVIEW_MIME_TYPES.includes(mimeType as (typeof ARCHIVE_PREVIEW_MIME_TYPES)[number])) {
    if (fileName && fileName.toLowerCase().endsWith('.epub')) return true;
    return true;
  }

  return false;
}

/**
 * 根据 MIME 类型和文件名获取预览类型
 */
export function getPreviewType(mimeType: string | null | undefined, fileName: string): PreviewType {
  if (!mimeType) {
    return getPreviewTypeByExtension(fileName) || 'unknown';
  }

  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return 'image';
  if (mimeType.startsWith(VIDEO_MIME_PREFIX)) return 'video';
  if (mimeType.startsWith(AUDIO_MIME_PREFIX)) return 'audio';
  if (mimeType === PDF_MIME_TYPE) return 'pdf';
  if (mimeType === MARKDOWN_MIME_TYPE || fileName.endsWith('.md')) return 'markdown';
  if (mimeType === CSV_MIME_TYPE || fileName.endsWith('.csv')) return 'csv';
  if (mimeType.startsWith(TEXT_MIME_PREFIX)) return 'text';
  if (mimeType === JSON_MIME_TYPE || mimeType === XML_MIME_TYPE) return 'code';

  if (OFFICE_MIME_TYPES.word.includes(mimeType as (typeof OFFICE_MIME_TYPES.word)[number])) return 'word';
  if (OFFICE_MIME_TYPES.excel.includes(mimeType as (typeof OFFICE_MIME_TYPES.excel)[number])) return 'excel';
  if (OFFICE_MIME_TYPES.powerpoint.includes(mimeType as (typeof OFFICE_MIME_TYPES.powerpoint)[number])) {
    return 'powerpoint';
  }

  if (EPUB_MIME_TYPES.includes(mimeType as (typeof EPUB_MIME_TYPES)[number])) return 'epub';
  if (FONT_MIME_TYPES.includes(mimeType as (typeof FONT_MIME_TYPES)[number])) return 'font';
  if (ARCHIVE_PREVIEW_MIME_TYPES.includes(mimeType as (typeof ARCHIVE_PREVIEW_MIME_TYPES)[number])) {
    if (fileName.toLowerCase().endsWith('.epub')) return 'epub';
    return 'archive';
  }

  const extType = getPreviewTypeByExtension(fileName);
  if (extType) return extType;

  return 'unknown';
}

/** 预览器依赖信息 - 用于提醒开发者安装依赖 */
export const PREVIEW_DEPENDENCIES = {
  docx: 'docx-preview',
  xlsx: 'xlsx',
  markdown: 'react-markdown, remark-gfm, rehype-highlight, remark-math, rehype-katex',
  code: 'highlight.js',
  csv: 'papaparse',
  archive: 'jszip',
  epub: 'jszip',
  font: '浏览器原生 FontFace API',
  powerpoint: 'jszip',
} as const;
