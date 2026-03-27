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
import * as XLSX from 'xlsx';
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
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FileIcon } from '@/components/files/FileIcon';
import { filesApi, previewApi } from '@/services/api';
import { getPresignedPreviewUrl } from '@/services/presignUpload';
import { formatBytes, formatDate, decodeFileName } from '@/utils';
import { isPreviewable } from '@/utils/fileTypes';
import type { FileItem } from '@osshelf/shared';
import { cn } from '@/utils';

import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

interface PptSlide {
  title: string;
  content: string[];
  bulletPoints: string[];
  notes: string;
}

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

interface FilePreviewProps {
  file: FileItem;
  token: string;
  onClose: () => void;
  onDownload: (file: FileItem) => void;
  onShare: (fileId: string) => void;
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

export function FilePreview({ file, token, onClose, onDownload, onShare }: FilePreviewProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null);
  const [excelHtml, setExcelHtml] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [windowSize, setWindowSize] = useState<WindowSize>('medium');

  const [csvData, setCsvData] = useState<string[][] | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [zipContents, setZipContents] = useState<{ name: string; size: number; isDir: boolean }[]>([]);
  const [zipLoading, setZipLoading] = useState(false);
  const [fontPreview, setFontPreview] = useState<{ name: string; preview: string } | null>(null);
  const [fontLoading, setFontLoading] = useState(false);
  const [epubBook, setEpubBook] = useState<{ title: string; chapters: { href: string; label: string }[] } | null>(null);
  const [epubContent, setEpubContent] = useState<string>('');
  const [epubLoading, setEpubLoading] = useState(false);
  const [epubCurrentChapter, setEpubCurrentChapter] = useState(0);
  const [pptSlides, setPptSlides] = useState<PptSlide[]>([]);
  const [pptCurrentSlide, setPptCurrentSlide] = useState(0);
  const [pptLoading, setPptLoading] = useState(false);
  const [pptShowThumbnails, setPptShowThumbnails] = useState(true);
  const [pptUseOnlineViewer, setPptUseOnlineViewer] = useState(true);
  const [pptOnlineError, setPptOnlineError] = useState(false);

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
  const isZip = file.mimeType === 'application/zip' || file.name.endsWith('.zip');

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
    setEpubBook(null);
    setEpubContent('');
    setEpubLoading(false);
    setEpubCurrentChapter(0);
    setPptSlides([]);
    setPptCurrentSlide(0);
    setPptLoading(false);
    setPptShowThumbnails(true);
    setPptUseOnlineViewer(true);
    setPptOnlineError(false);

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
    if (!isExcel || !resolvedUrl) return;

    setExcelLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, {
        type: 'array',
        cellStyles: true,
        cellNF: true,
        cellDates: true,
      });
      setExcelWorkbook(workbook);
      const firstSheetName = workbook.SheetNames[0];
      if (firstSheetName) {
        setActiveSheetName(firstSheetName);
        const worksheet = workbook.Sheets[firstSheetName];
        if (worksheet) {
          const { html } = renderExcelSheetWithStyles(worksheet, workbook);
          setExcelHtml(html);
        }
      } else {
        setLoadError(true);
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
      if (result.data) {
        setCsvData(result.data);
      }
    } catch (err) {
      console.error('CSV preview error:', err);
      setLoadError(true);
    } finally {
      setCsvLoading(false);
    }
  }, [isCsv, resolvedUrl]);

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
      zip.forEach((relativePath, zipEntry) => {
        contents.push({
          name: relativePath,
          size: zipEntry.dir ? 0 : 0,
          isDir: zipEntry.dir,
        });
      });
      contents.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setZipContents(contents);
    } catch (err) {
      console.error('ZIP preview error:', err);
      setLoadError(true);
    } finally {
      setZipLoading(false);
    }
  }, [isZip, resolvedUrl]);

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
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      const containerXml = await zip.file('META-INF/container.xml')?.async('string');
      if (!containerXml) {
        throw new Error('无效的 EPUB 文件');
      }

      const rootfileMatch = containerXml.match(/full-path="([^"]+)"/);
      if (!rootfileMatch || !rootfileMatch[1]) {
        throw new Error('无法找到 EPUB 根文件');
      }
      const opfPath = rootfileMatch[1];
      const opfFile = zip.file(opfPath);
      const opfContent = opfFile ? await opfFile.async('string') : null;
      if (!opfContent) {
        throw new Error('无法读取 EPUB 内容');
      }

      const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
      const title = titleMatch && titleMatch[1] ? titleMatch[1] : file.name;

      const manifestMatches = opfContent.matchAll(
        /<item[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*media-type="([^"]+)"[^>]*\/>/gi
      );
      const spineItemMatches = opfContent.matchAll(/<itemref[^>]*idref="([^"]+)"[^>]*\/>/gi);

      const manifest: Record<string, { href: string; mediaType: string }> = {};
      for (const match of manifestMatches) {
        if (match[1] && match[2] && match[3]) {
          manifest[match[2]] = { href: match[1], mediaType: match[3] };
        }
      }

      const chapters: { href: string; label: string }[] = [];
      const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
      for (const match of spineItemMatches) {
        const idref = match[1];
        if (idref && manifest[idref]) {
          chapters.push({
            href: opfDir + manifest[idref].href,
            label: `第 ${chapters.length + 1} 章`,
          });
        }
      }

      setEpubBook({ title, chapters });

      if (chapters.length > 0 && chapters[0]) {
        const chapterFile = zip.file(chapters[0].href);
        const chapterContent = chapterFile ? await chapterFile.async('string') : null;
        if (chapterContent) {
          setEpubContent(chapterContent);
        }
      }
    } catch (err) {
      console.error('EPUB preview error:', err);
      setLoadError(true);
    } finally {
      setEpubLoading(false);
    }
  }, [isEpub, resolvedUrl, file.name]);

  const loadEpubChapter = useCallback(
    async (chapterIndex: number) => {
      if (!epubBook || !resolvedUrl || chapterIndex < 0 || chapterIndex >= epubBook.chapters.length) return;

      setEpubLoading(true);
      try {
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
          throw new Error(`文件加载失败: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const chapter = epubBook.chapters[chapterIndex];
        if (chapter) {
          const chapterFile = zip.file(chapter.href);
          const chapterContent = chapterFile ? await chapterFile.async('string') : null;
          if (chapterContent) {
            setEpubContent(chapterContent);
            setEpubCurrentChapter(chapterIndex);
          }
        }
      } catch (err) {
        console.error('EPUB chapter load error:', err);
      } finally {
        setEpubLoading(false);
      }
    },
    [epubBook, resolvedUrl]
  );

  const loadPptPreview = useCallback(async () => {
    if (!isPpt || !resolvedUrl) return;

    setPptLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      const slides: PptSlide[] = [];
      let slideIndex = 1;
      let slideFile = zip.file(`ppt/slides/slide${slideIndex}.xml`);
      
      while (slideFile) {
        const slideContent = await slideFile.async('string');
        
        const titleMatch = slideContent.match(/<p:sp[^>]*>[\s\S]*?<a:t>([^<]*)<\/a:t>[\s\S]*?<\/p:sp>/i);
        const title = titleMatch?.[1]?.trim() || `幻灯片 ${slideIndex}`;
        
        const textMatches = slideContent.matchAll(/<a:t>([^<]*)<\/a:t>/gi);
        const allTexts: string[] = [];
        for (const match of textMatches) {
          const text = match[1];
          if (text && text.trim()) {
            allTexts.push(text.trim());
          }
        }
        
        const bulletMatches = slideContent.matchAll(/<a:p[^>]*>[\s\S]*?<a:t>([^<]*)<\/a:t>[\s\S]*?<\/a:p>/gi);
        const bulletPoints: string[] = [];
        for (const match of bulletMatches) {
          const text = match[1]?.trim();
          if (text && text !== title && !bulletPoints.includes(text)) {
            bulletPoints.push(text);
          }
        }
        
        let notes = '';
        const notesFile = zip.file(`ppt/notesSlides/notesSlide${slideIndex}.xml`);
        if (notesFile) {
          const notesContent = await notesFile.async('string');
          const notesMatches = notesContent.matchAll(/<a:t>([^<]*)<\/a:t>/gi);
          const notesTexts: string[] = [];
          for (const match of notesMatches) {
            const text = match[1]?.trim();
            if (text) notesTexts.push(text);
          }
          notes = notesTexts.join(' ');
        }
        
        slides.push({
          title,
          content: allTexts,
          bulletPoints: bulletPoints.length > 0 ? bulletPoints : allTexts.slice(1),
          notes,
        });
        
        slideIndex++;
        slideFile = zip.file(`ppt/slides/slide${slideIndex}.xml`);
      }

      setPptSlides(slides);
    } catch (err) {
      console.error('PPT preview error:', err);
      setLoadError(true);
    } finally {
      setPptLoading(false);
    }
  }, [isPpt, resolvedUrl]);

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
    if (isWord && resolvedUrl) {
      loadDocxPreview();
    }
  }, [isWord, resolvedUrl, loadDocxPreview]);

  useEffect(() => {
    if (isExcel && resolvedUrl) {
      loadExcelPreview();
    }
  }, [isExcel, resolvedUrl, loadExcelPreview]);

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

  useEffect(() => {
    if (isPpt && resolvedUrl) {
      loadPptPreview();
    }
  }, [isPpt, resolvedUrl, loadPptPreview]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (isPpt && !pptUseOnlineViewer && pptSlides.length > 0) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          setPptCurrentSlide((prev) => Math.max(0, prev - 1));
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
          setPptCurrentSlide((prev) => Math.min(pptSlides.length - 1, prev + 1));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isPpt, pptUseOnlineViewer, pptSlides.length]);

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
            <div className="flex items-center justify-center h-full overflow-auto p-4">
              <img
                src={resolvedUrl}
                alt={decodeFileName(file.name)}
                className="max-w-full max-h-full object-contain"
                style={{ transform: `scale(${zoomLevel / 100})` }}
                onError={() => setLoadError(true)}
              />
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
            <iframe
              src={resolvedUrl}
              className="w-full h-full border-0"
              title={decodeFileName(file.name)}
              onError={() => setLoadError(true)}
            />
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
              {isWord ? (
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
                <>
                  {excelLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
                      <div className="text-muted-foreground text-sm">正在加载表格...</div>
                    </div>
                  )}
                  {loadError ? (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      {renderOfficeFallback('Excel 加载失败')}
                    </div>
                  ) : excelHtml ? (
                    <div
                      className="w-full h-full overflow-auto bg-white dark:bg-gray-900 p-4"
                      style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left' }}
                      dangerouslySetInnerHTML={{ __html: excelHtml }}
                    />
                  ) : null}
                </>
              ) : isPpt ? (
                <>
                  {pptLoading && !pptUseOnlineViewer && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
                      <div className="text-muted-foreground text-sm">正在加载幻灯片...</div>
                    </div>
                  )}
                  {loadError ? (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      {renderOfficeFallback('PowerPoint 加载失败')}
                    </div>
                  ) : pptUseOnlineViewer && resolvedUrl && !pptOnlineError ? (
                    <div className="w-full h-full flex flex-col bg-white dark:bg-gray-900">
                      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                        <span className="text-sm text-muted-foreground">
                          在线预览
                        </span>
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
                  ) : pptSlides.length > 0 ? (
                    <div className="w-full h-full flex bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
                      {pptShowThumbnails && pptSlides.length > 1 && (
                        <div className="w-48 border-r border-white/10 bg-black/20 flex flex-col">
                          <div className="p-2 text-xs text-white/50 border-b border-white/10">幻灯片</div>
                          <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {pptSlides.map((slide, index) => (
                              <button
                                key={index}
                                onClick={() => setPptCurrentSlide(index)}
                                className={cn(
                                  'w-full text-left p-3 rounded-lg transition-all duration-200',
                                  'border backdrop-blur-sm',
                                  pptCurrentSlide === index
                                    ? 'bg-white/20 border-white/30 text-white shadow-lg'
                                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                                )}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-white/20">
                                    {index + 1}
                                  </span>
                                  <span className="text-xs truncate flex-1">{slide.title}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex-1 flex flex-col min-w-0">
                        <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-black/20">
                          <div className="flex items-center gap-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPptShowThumbnails(!pptShowThumbnails)}
                              className="text-white/70 hover:text-white hover:bg-white/10"
                            >
                              {pptShowThumbnails ? '隐藏缩略图' : '显示缩略图'}
                            </Button>
                            {pptOnlineError || !resolvedUrl ? null : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPptUseOnlineViewer(true)}
                                className="text-white/70 hover:text-white hover:bg-white/10"
                              >
                                在线预览
                              </Button>
                            )}
                          </div>
                          <span className="text-sm text-white/60">
                            {pptCurrentSlide + 1} / {pptSlides.length}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
                              onClick={() => setPptCurrentSlide((prev) => Math.max(0, prev - 1))}
                              disabled={pptCurrentSlide <= 0}
                            >
                              <ChevronLeft className="h-5 w-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
                              onClick={() => setPptCurrentSlide((prev) => Math.min(pptSlides.length - 1, prev + 1))}
                              disabled={pptCurrentSlide >= pptSlides.length - 1}
                            >
                              <ChevronRight className="h-5 w-5" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
                          <div
                            className="w-full max-w-4xl aspect-video bg-white rounded-xl shadow-2xl overflow-hidden"
                            style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'center center' }}
                          >
                            <div className="h-full flex flex-col p-8 bg-gradient-to-br from-white to-gray-50">
                              <h2 className="text-2xl font-bold text-gray-800 mb-6 pb-4 border-b-2 border-blue-500">
                                {pptSlides[pptCurrentSlide]?.title || `幻灯片 ${pptCurrentSlide + 1}`}
                              </h2>
                              <div className="flex-1 overflow-auto">
                                {pptSlides[pptCurrentSlide]?.bulletPoints.length ? (
                                  <ul className="space-y-3">
                                    {pptSlides[pptCurrentSlide].bulletPoints.map((point, idx) => (
                                      <li key={idx} className="flex items-start gap-3 text-gray-700">
                                        <span className="mt-2 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                                        <span className="text-lg leading-relaxed">{point}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-gray-500 text-center py-12">此幻灯片无内容</p>
                                )}
                              </div>
                              {pptSlides[pptCurrentSlide]?.notes && (
                                <div className="mt-6 pt-4 border-t border-gray-200">
                                  <p className="text-xs text-gray-400 italic">
                                    备注: {pptSlides[pptCurrentSlide].notes}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    renderOfficeFallback('PowerPoint 无内容或格式不支持')
                  )}
                </>
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
              {csvData ? (
                <div className="w-full h-full overflow-auto bg-white dark:bg-gray-900 p-4">
                  <table className="w-full border-collapse text-sm" style={{ fontSize: `${zoomLevel}%` }}>
                    <tbody>
                      {csvData.map((row, rowIndex) => (
                        <tr key={rowIndex} className={rowIndex === 0 ? 'bg-muted/50 font-medium' : ''}>
                          {row.map((cell, cellIndex) => {
                            const Tag = rowIndex === 0 ? 'th' : 'td';
                            return (
                              <Tag key={cellIndex} className="border border-border px-3 py-2 text-left">
                                {cell}
                              </Tag>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
              {zipContents.length > 0 ? (
                <div className="w-full h-full overflow-auto bg-white dark:bg-gray-900 p-4">
                  <div className="text-sm mb-4 text-muted-foreground">共 {zipContents.length} 个文件/文件夹</div>
                  <div className="space-y-1">
                    {zipContents.map((item, index) => (
                      <div key={index} className="flex items-center gap-2 px-3 py-2 rounded hover:bg-muted/50">
                        {item.isDir ? (
                          <Folder className="h-4 w-4 text-amber-500" />
                        ) : (
                          <File className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="flex-1 truncate text-sm">{item.name}</span>
                        {!item.isDir && <span className="text-xs text-muted-foreground">{formatBytes(item.size)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
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
            <div className="w-full h-full flex flex-col relative">
              {epubLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
                  <div className="text-muted-foreground text-sm">正在加载电子书...</div>
                </div>
              )}
              {epubBook ? (
                <div className="w-full h-full flex flex-col bg-white dark:bg-gray-900">
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                    <span className="text-sm font-medium truncate">{epubBook.title}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => loadEpubChapter(epubCurrentChapter - 1)}
                        disabled={epubCurrentChapter <= 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {epubCurrentChapter + 1} / {epubBook.chapters.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => loadEpubChapter(epubCurrentChapter + 1)}
                        disabled={epubCurrentChapter >= epubBook.chapters.length - 1}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div
                    className="flex-1 overflow-auto p-6 prose dark:prose-invert max-w-none"
                    style={{ fontSize: `${zoomLevel}%` }}
                    dangerouslySetInnerHTML={{ __html: epubContent }}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
