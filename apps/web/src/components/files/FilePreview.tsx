/**
 * FilePreview.tsx
 * 文件预览组件
 *
 * 功能:
 * - 图片/视频/音频预览
 * - PDF文档预览
 * - 文本/代码预览（带语法高亮）
 * - Markdown 渲染预览（带代码高亮、表格样式、架构图支持）
 * - Office文档预览（Word/Excel本地渲染，保留样式）
 * - EPUB电子书预览
 * - 字体文件预览
 * - ZIP压缩包内容列表预览
 * - CSV表格预览
 * - PowerPoint幻灯片预览
 * - 预览信息展示
 *
 * ============================================================================
 * 【重要提醒】修改此文件后必须同步更新：
 *   - apps/web/src/components/share/ShareFilePreview.tsx  # 分享预览组件
 *   - packages/shared/src/constants/previewTypes.ts      # 预览类型配置
 * ============================================================================
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { renderAsync } from 'docx-preview';
import { init as initPptxPreview } from 'pptx-preview';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import ePub from 'epubjs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import hljs from 'highlight.js';
import Papa from 'papaparse';
import JSZip from 'jszip';
import {
  X,
  Download,
  Share2,
  FileText,
  Volume2,
  FileSpreadsheet,
  Presentation,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  Type,
  ChevronLeft,
  ChevronRight,
  Folder,
  File,
  Image as ImageIcon,
  Archive,
  MessageSquare,
  Edit3,
  History,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FileIcon } from '@/components/files/FileIcon';
import { filesApi, previewApi } from '@/services/api';
import { getPresignedPreviewUrl } from '@/services/presignUpload';
import { formatBytes, formatDate, decodeFileName } from '@/utils';
import { isPreviewable } from '@/utils/fileTypes';
import type { FileItem } from '@osshelf/shared';
import { isEditableFile } from '@osshelf/shared';
import { cn } from '@/utils';
import { NotePanel } from '@/components/notes';
import { FileEditor } from '@/components/editor';
import { AISummaryCard, ImageTagsDisplay, SmartRenameDialog } from '@/components/ai';

import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PreviewInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  previewable: boolean;
  previewType: string;
  language: string | null;
  extension: string;
  canPreview: boolean;
}

interface ZipTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  compressedSize: number;
  children: ZipTreeNode[];
  level: number;
}

interface FilePreviewProps {
  file: FileItem;
  token: string;
  onClose: () => void;
  onDownload: (file: FileItem) => void;
  onShare: (fileId: string) => void;
  onEdit?: (file: FileItem) => void;
  onVersionHistory?: (file: FileItem) => void;
}

type WindowSize = 'small' | 'medium' | 'large' | 'fullscreen';

const WINDOW_SIZE_CONFIG: Record<WindowSize, { width: string; height: string; maxWidth: string }> = {
  small: { width: '60vw', height: '70vh', maxWidth: '800px' },
  medium: { width: '80vw', height: '85vh', maxWidth: '1200px' },
  large: { width: '90vw', height: '90vh', maxWidth: '1600px' },
  fullscreen: { width: '100vw', height: '100vh', maxWidth: '100vw' },
};

const CODE_LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  r: 'r',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  vue: 'vue',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  toml: 'toml',
  ini: 'ini',
  env: 'bash',
};

const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'swift',
  'kt',
  'scala',
  'r',
  'sql',
  'sh',
  'bash',
  'zsh',
  'json',
  'xml',
  'yaml',
  'yml',
  'css',
  'scss',
  'less',
  'html',
  'vue',
  'dockerfile',
  'makefile',
  'toml',
  'ini',
  'env',
]);

function getLanguageFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return CODE_LANGUAGE_MAP[ext] || 'plaintext';
}

function isCodeFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return CODE_EXTENSIONS.has(ext);
}

function highlightCode(code: string, language: string): string {
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code;
  }
}

interface ExcelCellStyle {
  font?: {
    bold?: boolean;
    italic?: boolean;
    color?: { rgb?: string; theme?: number };
    sz?: number;
    name?: string;
  };
  fill?: {
    fgColor?: { rgb?: string; theme?: number };
    bgColor?: { rgb?: string; theme?: number };
    patternType?: string;
  };
  alignment?: {
    horizontal?: string;
    vertical?: string;
    wrapText?: boolean;
  };
  border?: {
    top?: { style?: string; color?: { rgb?: string } };
    bottom?: { style?: string; color?: { rgb?: string } };
    left?: { style?: string; color?: { rgb?: string } };
    right?: { style?: string; color?: { rgb?: string } };
  };
  numFmt?: string;
}

function rgbToHex(rgb: string | undefined): string | undefined {
  if (!rgb) return undefined;
  if (rgb.startsWith('#')) return rgb;
  if (rgb.length === 6 && /^[0-9A-Fa-f]{6}$/.test(rgb)) {
    return `#${rgb}`;
  }
  if (rgb.length === 8 && rgb.startsWith('FF')) {
    return `#${rgb.slice(2)}`;
  }
  return undefined;
}

const THEME_COLORS: Record<number, string> = {
  0: '#FFFFFF',
  1: '#000000',
  2: '#E7E6E6',
  3: '#44546A',
  4: '#5B9BD5',
  5: '#ED7D31',
  6: '#A5A5A5',
  7: '#FFC000',
  8: '#4472C4',
  9: '#70AD47',
};

function getThemeColor(theme?: number): string | undefined {
  if (theme === undefined) return undefined;
  return THEME_COLORS[theme];
}

function getExcelCellStyle(cell: XLSX.CellObject, _workbook: XLSX.WorkBook): React.CSSProperties {
  const styles: React.CSSProperties = {};
  if (!cell.s) return styles;

  const cellStyle = cell.s as ExcelCellStyle;

  if (cellStyle.font) {
    if (cellStyle.font.bold) styles.fontWeight = 'bold';
    if (cellStyle.font.italic) styles.fontStyle = 'italic';
    if (cellStyle.font.sz) styles.fontSize = `${cellStyle.font.sz}px`;
    if (cellStyle.font.name) styles.fontFamily = cellStyle.font.name;
    if (cellStyle.font.color?.rgb) {
      const color = rgbToHex(cellStyle.font.color.rgb);
      if (color) styles.color = color;
    } else if (cellStyle.font.color?.theme !== undefined) {
      const themeColor = getThemeColor(cellStyle.font.color.theme);
      if (themeColor) styles.color = themeColor;
    }
  }

  if (cellStyle.fill?.patternType && cellStyle.fill.patternType !== 'none') {
    if (cellStyle.fill.fgColor?.rgb) {
      const bgColor = rgbToHex(cellStyle.fill.fgColor.rgb);
      if (bgColor) {
        styles.backgroundColor = bgColor;
      }
    } else if (cellStyle.fill.fgColor?.theme !== undefined) {
      const themeColor = getThemeColor(cellStyle.fill.fgColor.theme);
      if (themeColor) {
        styles.backgroundColor = themeColor;
      }
    }
  }

  if (cellStyle.alignment) {
    if (cellStyle.alignment.horizontal) {
      styles.textAlign = cellStyle.alignment.horizontal as React.CSSProperties['textAlign'];
    }
    if (cellStyle.alignment.vertical) {
      styles.verticalAlign = cellStyle.alignment.vertical as React.CSSProperties['verticalAlign'];
    }
    if (cellStyle.alignment.wrapText) {
      styles.whiteSpace = 'pre-wrap';
      styles.wordBreak = 'break-word';
    }
  }

  return styles;
}

function formatExcelValue(cell: XLSX.CellObject): string {
  if (cell.v === undefined || cell.v === null) return '';
  if (typeof cell.v === 'number') {
    if (cell.w) return cell.w;
    return cell.v.toLocaleString();
  }
  if (cell.v instanceof Date) {
    return cell.v.toLocaleString();
  }
  return String(cell.v);
}

function renderExcelSheetWithStyles(
  worksheet: XLSX.WorkSheet,
  workbook: XLSX.WorkBook
): { html: string; merges: XLSX.Range[] } {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const merges = worksheet['!merges'] || [];

  const rows: string[] = [];
  rows.push(
    '<table style="border-collapse: collapse; width: 100%; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;">'
  );

  for (let row = range.s.r; row <= range.e.r; row++) {
    const cells: string[] = [];
    cells.push('<tr>');

    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];

      let isMerged = false;
      let rowSpan = 1;
      let colSpan = 1;

      for (const merge of merges) {
        if (row >= merge.s.r && row <= merge.e.r && col >= merge.s.c && col <= merge.e.c) {
          if (row === merge.s.r && col === merge.s.c) {
            rowSpan = merge.e.r - merge.s.r + 1;
            colSpan = merge.e.c - merge.s.c + 1;
          } else {
            isMerged = true;
          }
          break;
        }
      }

      if (isMerged) {
        continue;
      }

      const baseStyle: React.CSSProperties = {
        border: '1px solid #e5e7eb',
        padding: '6px 10px',
        textAlign: 'left',
        verticalAlign: 'top',
        minWidth: '60px',
        height: '24px',
      };

      const cellStyle = cell ? getExcelCellStyle(cell, workbook) : {};
      const mergedStyle = { ...baseStyle, ...cellStyle };

      const styleStr = Object.entries(mergedStyle)
        .map(([key, value]) => {
          const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
          return `${cssKey}: ${value}`;
        })
        .join('; ');

      const value = cell ? formatExcelValue(cell) : '';
      const tag = row === range.s.r ? 'th' : 'td';
      const extraAttrs = rowSpan > 1 ? ` rowspan="${rowSpan}"` : '' + (colSpan > 1 ? ` colspan="${colSpan}"` : '');

      cells.push(`<${tag} style="${styleStr}"${extraAttrs}>${value || '&nbsp;'}</${tag}>`);
    }

    cells.push('</tr>');
    rows.push(cells.join(''));
  }

  rows.push('</table>');
  return { html: rows.join(''), merges };
}

export function FilePreview({
  file,
  token,
  onClose,
  onDownload,
  onShare,
  onEdit,
  onVersionHistory,
}: FilePreviewProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null);
  const [excelHtml, setExcelHtml] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const pptxContainerRef = useRef<HTMLDivElement>(null);
  const pptxViewerRef = useRef<ReturnType<typeof initPptxPreview> | null>(null);
  const pptxLoadedRef = useRef(false);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pdfLoadedRef = useRef(false);
  const excelContainerRef = useRef<HTMLDivElement>(null);
  const epubViewerRef = useRef<ePub.Book | null>(null);
  const epubRenditionRef = useRef<ePub.Rendition | null>(null);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [windowSize, setWindowSize] = useState<WindowSize>('medium');

  const [csvData, setCsvData] = useState<string[][] | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvSortColumn, setCsvSortColumn] = useState<number | null>(null);
  const [csvSortAsc, setCsvSortAsc] = useState(true);
  const [csvSearchTerm, setCsvSearchTerm] = useState('');
  const [csvCurrentPage, setCsvCurrentPage] = useState(1);
  const [csvPageSize, setCsvPageSize] = useState(50);
  const [zipContents, setZipContents] = useState<{ name: string; size: number; isDir: boolean }[]>([]);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipTree, setZipTree] = useState<ZipTreeNode[]>([]);
  const [zipStats, setZipStats] = useState<{
    totalFiles: number;
    totalDirs: number;
    totalSize: number;
    compressedSize: number;
  } | null>(null);
  const [fontPreview, setFontPreview] = useState<{ name: string; preview: string } | null>(null);
  const [fontLoading, setFontLoading] = useState(false);
  const [epubLoading, setEpubLoading] = useState(false);
  const [epubCurrentPage, setEpubCurrentPage] = useState(0);
  const [epubTotalPages, setEpubTotalPages] = useState(0);
  const [epubToc, setEpubToc] = useState<{ href: string; label: string }[]>([]);
  const [epubShowToc, setEpubShowToc] = useState(true);
  const [pptLoading, setPptLoading] = useState(false);
  const [pptUseOnlineViewer, setPptUseOnlineViewer] = useState(true);
  const [pptOnlineError, setPptOnlineError] = useState(false);
  const [officeUseOnlineViewer, setOfficeUseOnlineViewer] = useState(true);
  const [officeOnlineError, setOfficeOnlineError] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [excelLoading, setExcelLoading] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showSmartRename, setShowSmartRename] = useState(false);
  // 从 file 对象读取已缓存的 AI 数据，避免每次打开都要重新生成
  const [aiSummary, setAiSummary] = useState<string | null>(file.aiSummary ?? null);
  const [aiSummaryAt, setAiSummaryAt] = useState<string | null>(file.aiSummaryAt ?? null);
  const [aiTags, setAiTags] = useState<string[]>(() => {
    if (!file.aiTags) return [];
    try {
      return JSON.parse(file.aiTags);
    } catch {
      return [];
    }
  });

  const canPreview = isPreviewable(file.mimeType);
  const isImage = file.mimeType?.startsWith('image/');
  const isVideo = file.mimeType?.startsWith('video/');
  const isAudio = file.mimeType?.startsWith('audio/');
  const isPdf = file.mimeType === 'application/pdf';
  const isMarkdown = file.mimeType === 'text/markdown' || file.name.endsWith('.md');
  const isPlainText = file.mimeType === 'text/plain' || file.name.endsWith('.txt');
  const isCsv = file.mimeType === 'text/csv' || file.name.endsWith('.csv');
  const isText =
    file.mimeType?.startsWith('text/') ||
    file.mimeType === 'application/json' ||
    file.mimeType === 'application/xml' ||
    previewInfo?.previewType === 'code';
  const isWord =
    file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.mimeType === 'application/msword';
  const isExcel =
    file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.mimeType === 'application/vnd.ms-excel';
  const isPpt =
    file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    file.mimeType === 'application/vnd.ms-powerpoint';
  const isOffice = isWord || isExcel || isPpt;
  const isCode = isText && !isMarkdown && !isPlainText && !isCsv && isCodeFile(file.name);
  const isEpub = file.mimeType === 'application/epub+zip' || file.name.endsWith('.epub');
  const isFont =
    file.mimeType?.startsWith('font/') ||
    ['.ttf', '.otf', '.woff', '.woff2'].some((ext) => file.name.toLowerCase().endsWith(ext));
  const isZip =
    file.mimeType === 'application/zip' ||
    file.mimeType === 'application/x-zip-compressed' ||
    file.mimeType === 'application/x-zip' ||
    file.name.toLowerCase().endsWith('.zip');

  const detectedLanguage = useMemo(() => {
    if (previewInfo?.language) return previewInfo.language;
    return getLanguageFromExtension(file.name);
  }, [file.name, previewInfo?.language]);

  useEffect(() => {
    let cancelled = false;
    setResolvedUrl(null);
    setLoadError(false);
    setTextContent(null);
    setPreviewInfo(null);
    setOfficeLoading(false);
    setOfficeError(null);
    setExcelLoading(false);
    setExcelWorkbook(null);
    setActiveSheetName(null);
    setExcelHtml(null);
    setZoomLevel(100);
    setWindowSize('medium');
    setCsvData(null);
    setCsvLoading(false);
    setZipContents([]);
    setZipLoading(false);
    setFontPreview(null);
    setFontLoading(false);
    setEpubLoading(false);
    setEpubCurrentPage(0);
    setEpubTotalPages(0);
    setEpubToc([]);
    setEpubShowToc(true);
    setPptLoading(false);
    setPptUseOnlineViewer(true);
    setPptOnlineError(false);
    pptxLoadedRef.current = false;
    setOfficeUseOnlineViewer(true);
    setOfficeOnlineError(false);
    setPdfLoading(false);
    setPdfCurrentPage(1);
    setPdfTotalPages(0);
    setExcelLoading(false);
    pdfLoadedRef.current = false;

    // 销毁上一个文件的 epub/pdf 资源
    if (epubRenditionRef.current) {
      try {
        epubRenditionRef.current.destroy();
      } catch {
        /* ignore */
      }
      epubRenditionRef.current = null;
    }
    if (epubViewerRef.current) {
      try {
        epubViewerRef.current.destroy();
      } catch {
        /* ignore */
      }
      epubViewerRef.current = null;
    }
    if (pdfDocRef.current) {
      try {
        pdfDocRef.current.destroy();
      } catch {
        /* ignore */
      }
      pdfDocRef.current = null;
    }
    pptxViewerRef.current = null;

    previewApi
      .getInfo(file.id)
      .then((res) => {
        if (!cancelled && res.data.data) {
          setPreviewInfo(res.data.data);
        }
      })
      .catch(() => {});
    getPresignedPreviewUrl(file.id)
      .then(({ url }) => {
        if (!cancelled) setResolvedUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedUrl(`${filesApi.previewUrl(file.id)}?token=${encodeURIComponent(token)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file.id, token]);

  useEffect(() => {
    if ((!isText && !isMarkdown && !isCsv) || !canPreview || !resolvedUrl) return;

    previewApi
      .getRaw(file.id)
      .then((res) => {
        if (res.data.data?.content) {
          setTextContent(res.data.data.content);
        }
      })
      .catch(() => {
        fetch(resolvedUrl)
          .then((r) => r.text())
          .then((t) => setTextContent(t))
          .catch(() => setLoadError(true));
      });
  }, [file.id, resolvedUrl, isText, isMarkdown, isCsv, canPreview]);

  const refreshTextContent = useCallback(async () => {
    if (!isText && !isMarkdown && !isCsv) return;
    try {
      const res = await previewApi.getRaw(file.id);
      if (res.data.success && res.data.data?.content) {
        setTextContent(res.data.data.content);
      }
    } catch (error) {
      console.error('Failed to refresh content:', error);
    }
  }, [file.id, isText, isMarkdown, isCsv]);

  const loadDocxPreview = useCallback(async () => {
    if (!isWord || !resolvedUrl || !docxContainerRef.current) {
      return;
    }

    setOfficeLoading(true);
    setOfficeError(null);

    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();

      if (!docxContainerRef.current) {
        throw new Error('容器不可用');
      }

      if (arrayBuffer.byteLength === 0) {
        throw new Error('文件内容为空');
      }

      docxContainerRef.current.innerHTML = '';

      await renderAsync(arrayBuffer, docxContainerRef.current, undefined, {
        className: 'docx-preview-wrapper',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      });

      const renderedContent = docxContainerRef.current.querySelector('.docx-preview-wrapper');
      if (!renderedContent || docxContainerRef.current.children.length === 0) {
        throw new Error('文档渲染结果为空');
      }
    } catch (err) {
      console.error('DOCX preview error:', err);
      setOfficeError(err instanceof Error ? err.message : '文档预览失败，请下载查看');
    } finally {
      setOfficeLoading(false);
    }
  }, [isWord, resolvedUrl, file.size]);

  const loadExcelPreview = useCallback(async () => {
    if (!isExcel || !resolvedUrl || !excelContainerRef.current) return;

    setExcelLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('Excel 文件无工作表');
      }

      const worksheet = workbook.Sheets[firstSheetName];
      if (!worksheet) {
        throw new Error('工作表不存在');
      }
      const html = XLSX.utils.sheet_to_html(worksheet, { editable: false });
      excelContainerRef.current.innerHTML = html;
      const table = excelContainerRef.current.querySelector('table');
      if (table) {
        table.className = 'w-full border-collapse text-sm';
        table.querySelectorAll('td, th').forEach((cell) => {
          cell.className = 'border border-border px-2 py-1 text-left';
        });
      }
    } catch (err) {
      console.error('Excel preview error:', err);
      setLoadError(true);
    } finally {
      setExcelLoading(false);
    }
  }, [isExcel, resolvedUrl]);

  const handleSheetChange = useCallback(
    (sheetName: string) => {
      if (!excelWorkbook) return;
      setActiveSheetName(sheetName);
      const worksheet = excelWorkbook.Sheets[sheetName];
      if (worksheet) {
        const { html } = renderExcelSheetWithStyles(worksheet, excelWorkbook);
        setExcelHtml(html);
      }
    },
    [excelWorkbook]
  );

  const loadCsvPreview = useCallback(async () => {
    if (!isCsv || !resolvedUrl) return;

    setCsvLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const text = await response.text();
      const result = Papa.parse<string[]>(text, {
        skipEmptyLines: true,
      });
      if (result.data && result.data.length > 0) {
        const headers = result.data[0] || [];
        const rows = result.data.slice(1);
        setCsvHeaders(headers);
        setCsvRows(rows);
        setCsvData(result.data);
        setCsvCurrentPage(1);
      }
    } catch (err) {
      console.error('CSV preview error:', err);
      setLoadError(true);
    } finally {
      setCsvLoading(false);
    }
  }, [isCsv, resolvedUrl]);

  const handleCsvSort = useCallback(
    (columnIndex: number) => {
      if (csvSortColumn === columnIndex) {
        setCsvSortAsc(!csvSortAsc);
      } else {
        setCsvSortColumn(columnIndex);
        setCsvSortAsc(true);
      }
    },
    [csvSortColumn, csvSortAsc]
  );

  const filteredCsvRows = useMemo(() => {
    if (!csvSearchTerm) return csvRows;
    return csvRows.filter((row) => row.some((cell) => cell.toLowerCase().includes(csvSearchTerm.toLowerCase())));
  }, [csvRows, csvSearchTerm]);

  const sortedCsvRows = useMemo(() => {
    if (csvSortColumn === null) return filteredCsvRows;
    return [...filteredCsvRows].sort((a, b) => {
      const aVal = a[csvSortColumn] || '';
      const bVal = b[csvSortColumn] || '';
      const comparison = aVal.localeCompare(bVal, undefined, { numeric: true });
      return csvSortAsc ? comparison : -comparison;
    });
  }, [filteredCsvRows, csvSortColumn, csvSortAsc]);

  const paginatedCsvRows = useMemo(() => {
    const start = (csvCurrentPage - 1) * csvPageSize;
    return sortedCsvRows.slice(start, start + csvPageSize);
  }, [sortedCsvRows, csvCurrentPage, csvPageSize]);

  const totalCsvPages = Math.ceil(sortedCsvRows.length / csvPageSize);

  const loadZipPreview = useCallback(async () => {
    if (!isZip || !resolvedUrl) return;

    setZipLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      const contents: { name: string; size: number; isDir: boolean }[] = [];
      let totalSize = 0;
      let compressedSize = 0;
      let fileCount = 0;
      let dirCount = 0;

      zip.forEach((relativePath, zipEntry) => {
        const entryData = (zipEntry as any)._data;
        const uncompressedSize = entryData?.uncompressedSize || 0;
        const compressedSz = entryData?.compressedSize || 0;
        contents.push({
          name: relativePath,
          size: zipEntry.dir ? 0 : uncompressedSize,
          isDir: zipEntry.dir,
        });
        if (!zipEntry.dir) {
          totalSize += uncompressedSize;
          compressedSize += compressedSz;
          fileCount++;
        } else {
          dirCount++;
        }
      });

      contents.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setZipContents(contents);
      setZipStats({
        totalFiles: fileCount,
        totalDirs: dirCount,
        totalSize,
        compressedSize,
      });

      const tree = buildZipTree(zip);
      setZipTree(tree);
    } catch (err) {
      console.error('ZIP preview error:', err);
      setLoadError(true);
    } finally {
      setZipLoading(false);
    }
  }, [isZip, resolvedUrl]);

  const buildZipTree = (zip: JSZip): ZipTreeNode[] => {
    const root: ZipTreeNode[] = [];
    const map = new Map<string, ZipTreeNode>();

    zip.forEach((relativePath, zipEntry) => {
      const parts = relativePath.split('/').filter(Boolean);
      let currentPath = '';
      let currentLevel = root;
      const entryData = (zipEntry as any)._data;

      parts.forEach((part, index) => {
        currentPath += (currentPath ? '/' : '') + part;
        const isLast = index === parts.length - 1;
        const isDir = !isLast || zipEntry.dir;

        if (!map.has(currentPath)) {
          const node: ZipTreeNode = {
            name: part,
            path: currentPath,
            isDir,
            size: isDir ? 0 : entryData?.uncompressedSize || 0,
            compressedSize: isDir ? 0 : entryData?.compressedSize || 0,
            children: [],
            level: index,
          };
          map.set(currentPath, node);
          currentLevel.push(node);
          currentLevel = node.children;
        } else {
          currentLevel = map.get(currentPath)!.children;
        }
      });
    });

    return root;
  };

  const renderZipTreeNode = (node: ZipTreeNode, depth: number = 0): React.ReactNode => {
    const getFileIcon = (name: string, isDir: boolean) => {
      if (isDir) return <Folder className="h-4 w-4 text-amber-500 flex-shrink-0" />;
      const ext = name.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'pdf':
          return <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />;
        case 'doc':
        case 'docx':
          return <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />;
        case 'xls':
        case 'xlsx':
          return <FileText className="h-4 w-4 text-green-500 flex-shrink-0" />;
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'webp':
          return <ImageIcon className="h-4 w-4 text-purple-500 flex-shrink-0" />;
        case 'zip':
        case 'rar':
        case '7z':
          return <Archive className="h-4 w-4 text-yellow-600 flex-shrink-0" />;
        default:
          return <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
      }
    };

    return (
      <div key={node.path}>
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-default"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {getFileIcon(node.name, node.isDir)}
          <span className="flex-1 truncate text-sm">{node.name}</span>
          {!node.isDir && <span className="text-xs text-muted-foreground">{formatBytes(node.size)}</span>}
        </div>
        {node.children.map((child) => renderZipTreeNode(child, depth + 1))}
      </div>
    );
  };

  const loadFontPreview = useCallback(async () => {
    if (!isFont || !resolvedUrl) return;

    setFontLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const ext = file.name.split('.').pop()?.toLowerCase() || 'ttf';
      let format = 'truetype';
      if (ext === 'woff') format = 'woff';
      else if (ext === 'woff2') format = 'woff2';
      else if (ext === 'otf') format = 'opentype';
      const fontFace = new FontFace('PreviewFont', `url(data:font/${format};base64,${base64})`);
      await fontFace.load();
      document.fonts.add(fontFace);
      setFontPreview({
        name: file.name,
        preview: 'PreviewFont',
      });
    } catch (err) {
      console.error('Font preview error:', err);
      setLoadError(true);
    } finally {
      setFontLoading(false);
    }
  }, [isFont, resolvedUrl, file.name]);

  const loadEpubPreview = useCallback(async () => {
    if (!isEpub || !resolvedUrl) return;

    setEpubLoading(true);
    try {
      const book = ePub(resolvedUrl);
      epubViewerRef.current = book;

      const rendition = book.renderTo('epub-viewer', {
        width: '100%',
        height: '100%',
        // 分页模式：避免内容横向溢出，支持左右翻页
        flow: 'paginated',
        spread: 'none',
        minSpreadWidth: 9999,
      });
      epubRenditionRef.current = rendition;

      await rendition.display();
      // display() resolve 后即可显示，不依赖 'rendered' 事件（epubjs 该事件不稳定）
      setEpubLoading(false);

      const locations = await book.locations.generate(1024);
      setEpubTotalPages(locations.length);

      const navigation = await book.loaded.navigation;
      const toc = navigation.toc.map((item: { href: string; label: string }) => ({
        href: item.href,
        label: item.label,
      }));
      setEpubToc(toc);

      rendition.on('relocated', (location: { start: { index: number } }) => {
        setEpubCurrentPage(location.start.index);
      });
    } catch (err) {
      console.error('EPUB preview error:', err);
      setLoadError(true);
      setEpubLoading(false);
    }
  }, [isEpub, resolvedUrl]);

  const epubPrevPage = useCallback(() => {
    epubRenditionRef.current?.prev();
  }, []);

  const epubNextPage = useCallback(() => {
    epubRenditionRef.current?.next();
  }, []);

  const epubGoTo = useCallback((href: string) => {
    epubRenditionRef.current?.display(href);
    setEpubShowToc(false);
  }, []);

  const renderPdfPage = useCallback(
    async (pageNum: number) => {
      if (!pdfDocRef.current || !pdfContainerRef.current) return;

      const page = await pdfDocRef.current.getPage(pageNum);
      const scale = zoomLevel / 100;
      const viewport = page.getViewport({ scale });

      pdfContainerRef.current.innerHTML = '';
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      canvas.className = 'mx-auto shadow-lg';
      pdfContainerRef.current.appendChild(canvas);

      await page.render({
        canvasContext: context,
        viewport,
      } as any).promise;
      setPdfCurrentPage(pageNum);
    },
    [zoomLevel]
  );

  const loadPdfPreview = useCallback(async () => {
    if (!isPdf || !resolvedUrl) return;
    const container = pdfContainerRef.current;
    if (!container) return;
    if (pdfLoadedRef.current) return;

    pdfLoadedRef.current = true;
    setPdfLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();

      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pdfDocRef.current = pdfDoc;
      setPdfTotalPages(pdfDoc.numPages);

      await renderPdfPage(1);
    } catch (err) {
      console.error('PDF preview error:', err);
      setLoadError(true);
      pdfLoadedRef.current = false;
    } finally {
      setPdfLoading(false);
    }
  }, [isPdf, resolvedUrl, renderPdfPage]);

  const pdfContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    (pdfContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, []);

  useEffect(() => {
    if (isPdf && resolvedUrl && pdfContainerRef.current && !pdfLoadedRef.current) {
      loadPdfPreview();
    }
  }, [isPdf, resolvedUrl, loadPdfPreview]);

  const pdfPrevPage = useCallback(() => {
    if (pdfCurrentPage > 1) {
      renderPdfPage(pdfCurrentPage - 1);
    }
  }, [pdfCurrentPage, renderPdfPage]);

  const pdfNextPage = useCallback(() => {
    if (pdfCurrentPage < pdfTotalPages) {
      renderPdfPage(pdfCurrentPage + 1);
    }
  }, [pdfCurrentPage, pdfTotalPages, renderPdfPage]);

  // zoomLevel 变化时重新渲染当前 PDF 页
  useEffect(() => {
    if (isPdf && pdfDocRef.current) {
      renderPdfPage(pdfCurrentPage);
    }
  }, [zoomLevel]);

  const loadPptPreview = useCallback(async () => {
    const container = pptxContainerRef.current;
    if (!isPpt || !resolvedUrl || !container) return;
    if (pptxLoadedRef.current) return;

    pptxLoadedRef.current = true;
    setPptLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();

      // 每次都重新初始化，避免容器被卸载重建后 viewer 指向旧引用
      container.innerHTML = '';
      pptxViewerRef.current = initPptxPreview(container, {
        width: 960,
        height: 540,
      });

      await pptxViewerRef.current.preview(arrayBuffer);
    } catch (err) {
      console.error('PPT preview error:', err);
      setLoadError(true);
      pptxLoadedRef.current = false;
    } finally {
      setPptLoading(false);
    }
  }, [isPpt, resolvedUrl]);

  const pptxContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    (pptxContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, []);

  useEffect(() => {
    if (isPpt && !pptUseOnlineViewer && resolvedUrl && pptxContainerRef.current && !pptxLoadedRef.current) {
      loadPptPreview();
    }
  }, [isPpt, pptUseOnlineViewer, resolvedUrl, loadPptPreview]);

  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => Math.min(prev + 25, 200));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => Math.max(prev - 25, 50));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoomLevel(100);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setWindowSize((prev) => (prev === 'fullscreen' ? 'medium' : 'fullscreen'));
  }, []);

  const cycleWindowSize = useCallback(() => {
    setWindowSize((prev) => {
      const sizes: WindowSize[] = ['small', 'medium', 'large', 'fullscreen'];
      const currentIndex = sizes.indexOf(prev);
      const nextIndex = (currentIndex + 1) % sizes.length;
      return sizes[nextIndex] as WindowSize;
    });
  }, []);

  useEffect(() => {
    if (isWord && resolvedUrl && !officeUseOnlineViewer) {
      loadDocxPreview();
    }
  }, [isWord, resolvedUrl, loadDocxPreview, officeUseOnlineViewer]);

  useEffect(() => {
    if (isExcel && resolvedUrl && !officeUseOnlineViewer) {
      loadExcelPreview();
    }
  }, [isExcel, resolvedUrl, loadExcelPreview, officeUseOnlineViewer]);

  useEffect(() => {
    if (isCsv && resolvedUrl) {
      loadCsvPreview();
    }
  }, [isCsv, resolvedUrl, loadCsvPreview]);

  useEffect(() => {
    if (isZip && resolvedUrl) {
      loadZipPreview();
    }
  }, [isZip, resolvedUrl, loadZipPreview]);

  useEffect(() => {
    if (isFont && resolvedUrl) {
      loadFontPreview();
    }
  }, [isFont, resolvedUrl, loadFontPreview]);

  useEffect(() => {
    if (isEpub && resolvedUrl) {
      loadEpubPreview();
    }
  }, [isEpub, resolvedUrl, loadEpubPreview]);

  // PPTX 本地预览：通过 ref callback 触发加载（见 pptxContainerCallbackRef）

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // EPUB 键盘翻页
      if (isEpub) {
        if (e.key === 'ArrowLeft') {
          epubPrevPage();
        } else if (e.key === 'ArrowRight') {
          epubNextPage();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isEpub, epubPrevPage, epubNextPage]);

  const getOfficeIcon = () => {
    const mimeType = file.mimeType || '';
    if (mimeType.includes('word') || mimeType.includes('document')) return <FileText className="h-6 w-6" />;
    if (mimeType.includes('excel') || mimeType.includes('sheet')) return <FileSpreadsheet className="h-6 w-6" />;
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation'))
      return <Presentation className="h-6 w-6" />;
    return <FileText className="h-6 w-6" />;
  };

  const getOfficeTypeName = () => {
    if (isWord) return 'Word 文档';
    if (isExcel) return 'Excel 表格';
    if (isPpt) return 'PowerPoint 演示文稿';
    return 'Office 文档';
  };

  const renderOfficeFallback = (message?: string) => (
    <div className="flex items-center justify-center h-full">
      <div className="text-center py-12 px-6 space-y-4">
        <div className="w-16 h-16 mx-auto rounded-xl bg-primary/10 flex items-center justify-center">
          {getOfficeIcon()}
        </div>
        <div>
          <p className="font-medium">{decodeFileName(file.name)}</p>
          <p className="text-sm text-muted-foreground mt-1">{getOfficeTypeName()}</p>
          <p className="text-xs text-muted-foreground mt-2">{message || '暂不支持在线预览，请下载查看'}</p>
        </div>
        <Button onClick={() => onDownload(file)}>
          <Download className="h-4 w-4 mr-2" />
          下载文件
        </Button>
      </div>
    </div>
  );

  const sizeConfig = WINDOW_SIZE_CONFIG[windowSize];
  const showZoomControls = isText || isMarkdown || isExcel || isWord || isCsv || isFont || isEpub || isPpt;
  const showSheetTabs = isExcel && excelWorkbook && excelWorkbook.SheetNames.length > 1;

  const highlightedCode = useMemo(() => {
    if (!textContent || !isCode) return null;
    return highlightCode(textContent, detectedLanguage);
  }, [textContent, isCode, detectedLanguage]);

  return (
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm',
        windowSize === 'fullscreen' ? 'p-0' : 'p-4'
      )}
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div
        className={cn(
          'relative flex flex-col bg-card border rounded-xl shadow-2xl overflow-hidden transition-all duration-300',
          windowSize === 'fullscreen' ? 'rounded-none' : ''
        )}
        style={{
          width: sizeConfig.width,
          height: sizeConfig.height,
          maxWidth: sizeConfig.maxWidth,
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0">
          <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sm">{decodeFileName(file.name)}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(file.size)} · {formatDate(file.updatedAt)}
              {previewInfo?.language && <span className="ml-2 opacity-60">({previewInfo.language})</span>}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {showZoomControls && (
              <>
                <div className="flex items-center gap-0.5 mr-2 px-2 py-1 bg-muted/50 rounded-md">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="缩小"
                    onClick={handleZoomOut}
                    disabled={zoomLevel <= 50}
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs min-w-[40px] text-center">{zoomLevel}%</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="放大"
                    onClick={handleZoomIn}
                    disabled={zoomLevel >= 200}
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" title="重置缩放" onClick={handleZoomReset}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={windowSize === 'fullscreen' ? '退出全屏' : '全屏'}
              onClick={handleToggleFullscreen}
            >
              {windowSize === 'fullscreen' ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="切换窗口大小" onClick={cycleWindowSize}>
              <span className="text-xs font-medium">
                {windowSize === 'small' ? 'S' : windowSize === 'medium' ? 'M' : windowSize === 'large' ? 'L' : 'F'}
              </span>
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="下载" onClick={() => onDownload(file)}>
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="分享" onClick={() => onShare(file.id)}>
              <Share2 className="h-4 w-4" />
            </Button>
            {isEditableFile(file.mimeType, file.name) && onEdit && (
              <Button variant="ghost" size="icon" className="h-8 w-8" title="编辑" onClick={() => setShowEditor(true)}>
                <Edit3 className="h-4 w-4" />
              </Button>
            )}
            {isEditableFile(file.mimeType, file.name) && onVersionHistory && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="版本历史"
                onClick={() => onVersionHistory(file)}
              >
                <History className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="笔记"
              onClick={() => setShowNotes(true)}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="智能重命名"
              onClick={() => setShowSmartRename(true)}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="关闭" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {showSheetTabs && (
          <div className="flex items-center gap-1 px-4 py-2 border-b bg-muted/30 overflow-x-auto flex-shrink-0">
            {excelWorkbook.SheetNames.map((name) => (
              <button
                key={name}
                onClick={() => handleSheetChange(name)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition-colors',
                  activeSheetName === name
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                )}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-auto min-h-0">
          {loadError ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center py-12 text-muted-foreground px-6">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>预览加载失败</p>
              </div>
            </div>
          ) : !canPreview ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center py-12 px-6 space-y-4">
                <FileIcon mimeType={file.mimeType} size="lg" className="mx-auto" />
                <div>
                  <p className="font-medium">{decodeFileName(file.name)}</p>
                  <p className="text-sm text-muted-foreground mt-1">{formatBytes(file.size)}</p>
                  <p className="text-sm text-muted-foreground">{file.mimeType || '未知类型'}</p>
                </div>
                <div className="space-y-3 max-w-sm mx-auto">
                  <AISummaryCard
                    fileId={file.id}
                    summary={aiSummary}
                    summaryAt={aiSummaryAt}
                    onSummaryGenerated={(summary) => {
                      setAiSummary(summary);
                      setAiSummaryAt(new Date().toISOString());
                    }}
                  />
                  {file.mimeType?.startsWith('image/') && (
                    <ImageTagsDisplay
                      fileId={file.id}
                      tags={aiTags}
                      onTagsGenerated={setAiTags}
                    />
                  )}
                </div>
                <Button onClick={() => onDownload(file)}>
                  <Download className="h-4 w-4 mr-2" />
                  下载文件
                </Button>
              </div>
            </div>
          ) : !resolvedUrl ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground text-sm py-12">加载中...</div>
            </div>
          ) : isImage ? (
            <div className="relative flex items-center justify-center h-full overflow-auto p-4">
              <img
                src={resolvedUrl}
                alt={decodeFileName(file.name)}
                className="max-w-full max-h-full object-contain"
                style={{ transform: `scale(${zoomLevel / 100})` }}
                onError={() => setLoadError(true)}
              />
              <div className="absolute bottom-4 left-4 right-4 max-w-md mx-auto">
                <div className="bg-background/95 backdrop-blur border rounded-lg p-3 space-y-2 shadow-lg">
                  <AISummaryCard
                    fileId={file.id}
                    summary={aiSummary}
                    summaryAt={aiSummaryAt}
                    onSummaryGenerated={(summary) => {
                      setAiSummary(summary);
                      setAiSummaryAt(new Date().toISOString());
                    }}
                  />
                  <ImageTagsDisplay
                    fileId={file.id}
                    tags={aiTags}
                    onTagsGenerated={setAiTags}
                  />
                </div>
              </div>
            </div>
          ) : isVideo ? (
            <div className="flex items-center justify-center h-full">
              <video src={resolvedUrl} controls className="max-w-full max-h-full" onError={() => setLoadError(true)} />
            </div>
          ) : isAudio ? (
            <div className="flex items-center justify-center h-full">
              <div className="p-8 w-full max-w-md space-y-4">
                <div className="flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <Volume2 className="h-10 w-10 text-primary" />
                  </div>
                </div>
                <p className="text-center font-medium">{decodeFileName(file.name)}</p>
                <audio src={resolvedUrl} controls className="w-full" onError={() => setLoadError(true)} />
              </div>
            </div>
          ) : isPdf ? (
            <div className="w-full h-full flex flex-col bg-gray-100 dark:bg-gray-800">
              <div className="flex items-center justify-between px-4 py-2 border-b bg-white dark:bg-gray-900 shadow-sm">
                <span className="text-sm text-muted-foreground">
                  PDF 文档 {pdfTotalPages > 0 && `- 第 ${pdfCurrentPage}/${pdfTotalPages} 页`}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={pdfPrevPage}
                    disabled={pdfCurrentPage <= 1}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={pdfNextPage}
                    disabled={pdfCurrentPage >= pdfTotalPages}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleZoomOut}
                    disabled={zoomLevel <= 50}
                    className="h-7 w-7 p-0"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground w-12 text-center">{zoomLevel}%</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleZoomIn}
                    disabled={zoomLevel >= 200}
                    className="h-7 w-7 p-0"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 relative">
                {pdfLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                    <div className="text-muted-foreground text-sm">正在加载 PDF...</div>
                  </div>
                )}
                <div ref={pdfContainerCallbackRef} className="flex flex-col items-center" />
              </div>
            </div>
          ) : isMarkdown ? (
            <div
              className="w-full h-full overflow-auto p-6 prose dark:prose-invert max-w-none prose-table:border-collapse prose-th:border prose-th:border-border prose-th:bg-muted prose-th:p-2 prose-td:border prose-td:border-border prose-td:p-2 prose-tr:even:bg-muted/30"
              style={{ fontSize: `${zoomLevel}%` }}
            >
              {textContent !== null ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeHighlight, rehypeKatex]}
                  components={{
                    pre: ({ children, ...props }) => {
                      return (
                        <pre
                          {...props}
                          className="overflow-x-auto bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                        >
                          {children}
                        </pre>
                      );
                    },
                    code: ({ className, children, ...props }) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const isInline = !match && !className?.includes('hljs');
                      if (isInline) {
                        return (
                          <code
                            className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm font-mono"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      }
                      return (
                        <code className={`${className || ''} text-gray-800 dark:text-gray-200`} {...props}>
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {textContent}
                </ReactMarkdown>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
                </div>
              )}
            </div>
          ) : isCode ? (
            <div
              className="w-full h-full overflow-auto bg-gray-50 dark:bg-gray-900"
              style={{ fontSize: `${zoomLevel}%` }}
            >
              {textContent !== null ? (
                <pre className="p-4 m-0 leading-relaxed">
                  <code
                    className={`language-${detectedLanguage} hljs text-gray-800 dark:text-gray-200`}
                    dangerouslySetInnerHTML={{ __html: highlightedCode || textContent }}
                  />
                </pre>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
                </div>
              )}
            </div>
          ) : isText ? (
            <div
              className="w-full h-full overflow-auto bg-white dark:bg-gray-900 p-4"
              style={{ fontSize: `${zoomLevel}%` }}
            >
              {textContent !== null ? (
                <pre className="text-sm font-mono whitespace-pre-wrap leading-relaxed text-gray-800 dark:text-gray-200">
                  {textContent}
                </pre>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
                </div>
              )}
            </div>
          ) : isOffice ? (
            <div className="w-full h-full flex flex-col relative">
              {officeUseOnlineViewer && resolvedUrl && !officeOnlineError ? (
                <>
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                    <span className="text-sm text-muted-foreground">在线预览</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOfficeUseOnlineViewer(false)}
                      className="text-xs"
                    >
                      切换到本地预览
                    </Button>
                  </div>
                  <iframe
                    src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resolvedUrl)}`}
                    className="flex-1 w-full border-0"
                    title="Office 文档预览"
                    onError={() => setOfficeOnlineError(true)}
                  />
                </>
              ) : isWord ? (
                <>
                  {officeLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
                      <div className="text-muted-foreground text-sm">正在渲染文档...</div>
                    </div>
                  )}
                  {officeError && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      {renderOfficeFallback(officeError)}
                    </div>
                  )}
                  {!officeUseOnlineViewer && !officeOnlineError && resolvedUrl && (
                    <div className="absolute top-2 right-2 z-20">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOfficeUseOnlineViewer(true)}
                        className="text-xs bg-white/80 dark:bg-gray-900/80"
                      >
                        在线预览
                      </Button>
                    </div>
                  )}
                  <div
                    ref={docxContainerRef}
                    className={cn(
                      'w-full h-full overflow-auto bg-white dark:bg-gray-900',
                      officeLoading || officeError ? 'opacity-0' : 'opacity-100'
                    )}
                    style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left' }}
                  />
                </>
              ) : isExcel ? (
                <div className="w-full h-full flex flex-col relative">
                  {excelLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
                      <div className="text-muted-foreground text-sm">正在加载表格...</div>
                    </div>
                  )}
                  {!officeUseOnlineViewer && !officeOnlineError && resolvedUrl && (
                    <div className="absolute top-2 right-2 z-20">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOfficeUseOnlineViewer(true)}
                        className="text-xs bg-white/80 dark:bg-gray-900/80"
                      >
                        在线预览
                      </Button>
                    </div>
                  )}
                  {loadError ? (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      {renderOfficeFallback('Excel 加载失败')}
                    </div>
                  ) : (
                    <div ref={excelContainerRef} className="w-full h-full bg-white dark:bg-gray-900" />
                  )}
                </div>
              ) : isPpt ? (
                <div className="w-full h-full relative">
                  {pptLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-20">
                      <div className="text-muted-foreground text-sm">正在加载幻灯片...</div>
                    </div>
                  )}
                  {loadError && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      {renderOfficeFallback('PowerPoint 加载失败')}
                    </div>
                  )}
                  {pptUseOnlineViewer && resolvedUrl && !pptOnlineError && (
                    <div className="w-full h-full flex flex-col bg-white dark:bg-gray-900">
                      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                        <span className="text-sm text-muted-foreground">在线预览</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPptUseOnlineViewer(false)}
                          className="text-xs"
                        >
                          切换到本地预览
                        </Button>
                      </div>
                      <iframe
                        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resolvedUrl)}`}
                        className="flex-1 w-full border-0"
                        title="PowerPoint 预览"
                        onError={() => setPptOnlineError(true)}
                      />
                    </div>
                  )}
                  <div
                    className={`w-full h-full flex flex-col relative ${pptUseOnlineViewer && !pptOnlineError ? 'hidden' : ''}`}
                  >
                    {!pptUseOnlineViewer && !pptOnlineError && resolvedUrl && (
                      <div className="absolute top-2 right-2 z-20">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPptUseOnlineViewer(true)}
                          className="text-xs bg-white/80 dark:bg-gray-900/80"
                        >
                          在线预览
                        </Button>
                      </div>
                    )}
                    <div
                      ref={pptxContainerCallbackRef}
                      className="w-full h-full overflow-auto bg-gray-100 dark:bg-gray-800 flex items-center justify-center"
                    />
                  </div>
                </div>
              ) : (
                renderOfficeFallback()
              )}
            </div>
          ) : isCsv ? (
            <div className="w-full h-full flex flex-col relative">
              {csvLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
                  <div className="text-muted-foreground text-sm">正在加载表格...</div>
                </div>
              )}
              {csvHeaders.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                    <span className="text-sm text-muted-foreground">CSV 表格 - {csvRows.length} 行数据</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="搜索..."
                        value={csvSearchTerm}
                        onChange={(e) => {
                          setCsvSearchTerm(e.target.value);
                          setCsvCurrentPage(1);
                        }}
                        className="h-7 w-40 px-2 text-xs border rounded bg-background"
                      />
                      <select
                        value={csvPageSize}
                        onChange={(e) => {
                          setCsvPageSize(Number(e.target.value));
                          setCsvCurrentPage(1);
                        }}
                        className="h-7 px-2 text-xs border rounded bg-background"
                      >
                        <option value={20}>20行/页</option>
                        <option value={50}>50行/页</option>
                        <option value={100}>100行/页</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto bg-white dark:bg-gray-900">
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                        <tr>
                          {csvHeaders.map((header, index) => (
                            <th
                              key={index}
                              onClick={() => handleCsvSort(index)}
                              className="border border-border px-3 py-2 text-left cursor-pointer hover:bg-muted/50 select-none"
                            >
                              <div className="flex items-center gap-1">
                                {header}
                                {csvSortColumn === index && <span className="text-xs">{csvSortAsc ? '↑' : '↓'}</span>}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedCsvRows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="hover:bg-muted/30">
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="border border-border px-3 py-2">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalCsvPages > 1 && (
                    <div className="flex items-center justify-center gap-2 px-4 py-2 border-t bg-muted/30">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCsvCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={csvCurrentPage <= 1}
                        className="h-7"
                      >
                        上一页
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {csvCurrentPage} / {totalCsvPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCsvCurrentPage((p) => Math.min(totalCsvPages, p + 1))}
                        disabled={csvCurrentPage >= totalCsvPages}
                        className="h-7"
                      >
                        下一页
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
                </div>
              )}
            </div>
          ) : isZip ? (
            <div className="w-full h-full flex flex-col relative">
              {zipLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
                  <div className="text-muted-foreground text-sm">正在读取压缩包...</div>
                </div>
              )}
              {zipTree.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                    <span className="text-sm text-muted-foreground">压缩包内容</span>
                    {zipStats && (
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{zipStats.totalFiles} 个文件</span>
                        <span>{zipStats.totalDirs} 个文件夹</span>
                        <span>原始: {formatBytes(zipStats.totalSize)}</span>
                        <span>压缩: {formatBytes(zipStats.compressedSize)}</span>
                        {zipStats.totalSize > 0 && (
                          <span className="text-green-600">
                            压缩率: {Math.round((1 - zipStats.compressedSize / zipStats.totalSize) * 100)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto bg-white dark:bg-gray-900 p-2">
                    {zipTree.map((node) => renderZipTreeNode(node))}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
                </div>
              )}
            </div>
          ) : isFont ? (
            <div className="w-full h-full flex flex-col relative">
              {fontLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
                  <div className="text-muted-foreground text-sm">正在加载字体...</div>
                </div>
              )}
              {fontPreview ? (
                <div className="w-full h-full overflow-auto bg-white dark:bg-gray-900 p-6">
                  <div className="text-center mb-8">
                    <Type className="h-12 w-12 mx-auto mb-4 text-primary" />
                    <h3 className="text-lg font-medium">{fontPreview.name}</h3>
                  </div>
                  <div className="space-y-6" style={{ fontFamily: fontPreview.preview, fontSize: `${zoomLevel}%` }}>
                    <div className="text-center">
                      <p className="text-4xl mb-2">AaBbCcDdEeFfGg</p>
                      <p className="text-2xl mb-2">abcdefghijklmnopqrstuvwxyz</p>
                      <p className="text-2xl mb-2">ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
                      <p className="text-2xl mb-2">0123456789</p>
                      <p className="text-xl mt-6">
                        敏捷的棕色狐狸跳过懒狗。The quick brown fox jumps over the lazy dog.
                      </p>
                    </div>
                    <div className="border-t pt-6">
                      <p className="text-lg leading-relaxed">
                        这是一段预览文本，用于展示字体的效果。字体预览可以帮助您了解字体在不同大小和样式下的表现。 This
                        is a preview text to demonstrate the font effect. Font preview helps you understand how the font
                        looks at different sizes and styles.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
                </div>
              )}
            </div>
          ) : isEpub ? (
            <div className="w-full h-full flex relative">
              {epubLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-20">
                  <div className="text-muted-foreground text-sm">正在加载电子书...</div>
                </div>
              )}
              {epubShowToc && epubToc.length > 0 && (
                <div className="w-56 border-r border-border bg-muted/30 flex flex-col flex-shrink-0">
                  <div className="p-3 border-b border-border">
                    <span className="text-sm font-medium">目录</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2">
                    {epubToc.map((item, index) => (
                      <button
                        key={index}
                        onClick={() => epubGoTo(item.href)}
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted transition-colors truncate"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 flex-shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setEpubShowToc(!epubShowToc)} className="text-xs">
                    {epubShowToc ? '隐藏目录' : '显示目录'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {epubTotalPages > 0 ? `位置 ${epubCurrentPage + 1} / ${epubTotalPages}` : ''}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={epubPrevPage}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={epubNextPage}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {/* 阅读区：左右点击区翻页 */}
                <div className="flex-1 relative overflow-hidden">
                  {/* 左侧点击区 */}
                  <button
                    onClick={epubPrevPage}
                    className="absolute left-0 top-0 h-full w-16 z-10 flex items-center justify-start pl-1 opacity-0 hover:opacity-100 transition-opacity group"
                    title="上一页"
                  >
                    <div className="bg-black/10 dark:bg-white/10 rounded-full p-1.5 group-hover:bg-black/20 dark:group-hover:bg-white/20 transition-colors">
                      <ChevronLeft className="h-5 w-5 text-foreground/60" />
                    </div>
                  </button>
                  {/* 右侧点击区 */}
                  <button
                    onClick={epubNextPage}
                    className="absolute right-0 top-0 h-full w-16 z-10 flex items-center justify-end pr-1 opacity-0 hover:opacity-100 transition-opacity group"
                    title="下一页"
                  >
                    <div className="bg-black/10 dark:bg-white/10 rounded-full p-1.5 group-hover:bg-black/20 dark:group-hover:bg-white/20 transition-colors">
                      <ChevronRight className="h-5 w-5 text-foreground/60" />
                    </div>
                  </button>
                  <div id="epub-viewer" className="w-full h-full" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {showNotes && <NotePanel fileId={file.id} isOpen={showNotes} onClose={() => setShowNotes(false)} />}

      {showSmartRename && (
        <SmartRenameDialog
          open={showSmartRename}
          onClose={() => setShowSmartRename(false)}
          fileId={file.id}
          currentName={file.name}
          onRenamed={(newName) => {
            file.name = newName;
            setShowSmartRename(false);
          }}
        />
      )}

      {showEditor && (
        <FileEditor
          fileId={file.id}
          fileName={file.name}
          mimeType={file.mimeType}
          onClose={() => setShowEditor(false)}
          onSaved={() => {
            setShowEditor(false);
            refreshTextContent();
          }}
        />
      )}
    </div>
  );
}
