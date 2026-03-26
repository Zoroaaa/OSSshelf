/**
 * ShareFilePreview.tsx
 * 分享页面文件预览组件
 *
 * 功能:
 * - 图片/视频/音频预览
 * - PDF文档预览
 * - 文本/代码预览（带语法高亮）
 * - Markdown 渲染预览（带代码高亮、表格样式、架构图支持）
 * - Office文档预览（Word/Excel本地渲染，保留样式）
 * - 缩放控制和窗口尺寸切换
 * - 支持单文件分享和文件夹分享中的子文件预览
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
import {
  X,
  Download,
  FileText,
  Volume2,
  FileSpreadsheet,
  Presentation,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FileIcon } from '@/components/files/FileIcon';
import { shareApi } from '@/services/api';
import { formatBytes, decodeFileName } from '@/utils';
import { cn } from '@/utils';

import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

interface PreviewInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  previewType: string;
  canPreview: boolean;
}

interface ShareFilePreviewProps {
  shareId: string;
  file: {
    id: string;
    name: string;
    size: number;
    mimeType: string | null;
  };
  password?: string;
  isChildFile?: boolean;
  onClose: () => void;
  onDownload: () => void;
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
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'php', 'swift', 'kt', 'scala', 'r', 'sql', 'sh', 'bash', 'zsh', 'json',
  'xml', 'yaml', 'yml', 'css', 'scss', 'less', 'html', 'vue', 'dockerfile',
  'makefile', 'toml', 'ini', 'env'
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

function getExcelCellStyle(cell: XLSX.CellObject, workbook: XLSX.WorkBook): React.CSSProperties {
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
      const extraAttrs =
        rowSpan > 1 ? ` rowspan="${rowSpan}"` : '' + (colSpan > 1 ? ` colspan="${colSpan}"` : '');

      cells.push(`<${tag} style="${styleStr}"${extraAttrs}>${value || '&nbsp;'}</${tag}>`);
    }

    cells.push('</tr>');
    rows.push(cells.join(''));
  }

  rows.push('</table>');
  return { html: rows.join(''), merges };
}

export function ShareFilePreview({
  shareId,
  file,
  password,
  isChildFile = false,
  onClose,
  onDownload,
}: ShareFilePreviewProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [excelData, setExcelData] = useState<XLSX.WorkSheet | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null);
  const [excelHtml, setExcelHtml] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [windowSize, setWindowSize] = useState<WindowSize>('medium');

  const mimeType = file.mimeType;
  const isImage = mimeType?.startsWith('image/');
  const isVideo = mimeType?.startsWith('video/');
  const isAudio = mimeType?.startsWith('audio/');
  const isPdf = mimeType === 'application/pdf';
  const isMarkdown = mimeType === 'text/markdown' || file.name.endsWith('.md');
  const isPlainText = mimeType === 'text/plain' || file.name.endsWith('.txt');
  const isText =
    mimeType?.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript';
  const isWord =
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword';
  const isExcel =
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel';
  const isPpt =
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint';
  const isOffice = isWord || isExcel || isPpt;
  const isCode = isText && !isMarkdown && !isPlainText && isCodeFile(file.name);

  const canPreview = isImage || isVideo || isAudio || isPdf || isText || isMarkdown || isOffice;

  const detectedLanguage = useMemo(() => {
    return getLanguageFromExtension(file.name);
  }, [file.name]);

  useEffect(() => {
    setLoadError(false);
    setTextContent(null);
    setPreviewInfo(null);
    setOfficeLoading(false);
    setOfficeError(null);
    setExcelData(null);
    setExcelLoading(false);
    setExcelWorkbook(null);
    setActiveSheetName(null);
    setExcelHtml(null);
    setZoomLevel(100);
    setWindowSize('medium');
  }, [shareId, file.id, password]);

  useEffect(() => {
    if ((!isText && !isMarkdown) || !canPreview) return;

    const fetchTextContent = async () => {
      try {
        const res = isChildFile
          ? await shareApi.getChildRawContent(shareId, file.id, password)
          : await shareApi.getRawContent(shareId, password);
        if (res.data.data?.content) {
          setTextContent(res.data.data.content);
        }
      } catch {
        setLoadError(true);
      }
    };

    fetchTextContent();
  }, [shareId, file.id, password, isText, isMarkdown, canPreview, isChildFile]);

  const getPreviewUrl = useCallback(() => {
    if (isChildFile) {
      if (isVideo || isAudio) {
        return shareApi.childStreamUrl(shareId, file.id, password);
      }
      return shareApi.childPreviewUrl(shareId, file.id, password);
    }
    if (isVideo || isAudio) {
      return shareApi.streamUrl(shareId, password);
    }
    return shareApi.previewUrl(shareId, password);
  }, [isChildFile, isVideo, isAudio, shareId, file.id, password]);

  const loadDocxPreview = useCallback(async () => {
    if (!isWord || !docxContainerRef.current) return;

    setOfficeLoading(true);
    setOfficeError(null);

    try {
      const response = await fetch(getPreviewUrl());
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
  }, [isWord, shareId, file.id, password, isChildFile, getPreviewUrl]);

  const loadExcelPreview = useCallback(async () => {
    if (!isExcel) return;

    setExcelLoading(true);
    try {
      const response = await fetch(getPreviewUrl());
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
          setExcelData(worksheet);
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
  }, [isExcel, shareId, file.id, password, isChildFile, getPreviewUrl]);

  const handleSheetChange = useCallback(
    (sheetName: string) => {
      if (!excelWorkbook) return;
      setActiveSheetName(sheetName);
      const worksheet = excelWorkbook.Sheets[sheetName];
      if (worksheet) {
        setExcelData(worksheet);
        const { html } = renderExcelSheetWithStyles(worksheet, excelWorkbook);
        setExcelHtml(html);
      }
    },
    [excelWorkbook]
  );

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
    if (isWord) {
      loadDocxPreview();
    }
  }, [isWord, loadDocxPreview]);

  useEffect(() => {
    if (isExcel) {
      loadExcelPreview();
    }
  }, [isExcel, loadExcelPreview]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const getOfficeIcon = () => {
    if (!mimeType) return <FileText className="h-6 w-6" />;
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
        <Button onClick={onDownload}>
          <Download className="h-4 w-4 mr-2" />
          下载文件
        </Button>
      </div>
    </div>
  );

  const sizeConfig = WINDOW_SIZE_CONFIG[windowSize];
  const showZoomControls = isText || isMarkdown || isExcel || isWord;
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
          <FileIcon mimeType={mimeType} isFolder={false} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sm">{decodeFileName(file.name)}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(file.size)}
              {previewInfo?.previewType && previewInfo.previewType !== 'unknown' && (
                <span className="ml-2 opacity-60">({previewInfo.previewType})</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {showZoomControls && (
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
            <Button variant="ghost" size="icon" className="h-8 w-8" title="下载" onClick={onDownload}>
              <Download className="h-4 w-4" />
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
                <FileIcon mimeType={mimeType} size="lg" className="mx-auto" />
                <div>
                  <p className="font-medium">{decodeFileName(file.name)}</p>
                  <p className="text-sm text-muted-foreground mt-1">{formatBytes(file.size)}</p>
                  <p className="text-sm text-muted-foreground">{mimeType || '未知类型'}</p>
                </div>
                <Button onClick={onDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  下载文件
                </Button>
              </div>
            </div>
          ) : isImage ? (
            <div className="flex items-center justify-center h-full overflow-auto p-4">
              <img
                src={getPreviewUrl()}
                alt={decodeFileName(file.name)}
                className="max-w-full max-h-full object-contain"
                style={{ transform: `scale(${zoomLevel / 100})` }}
                onError={() => setLoadError(true)}
              />
            </div>
          ) : isVideo ? (
            <div className="flex items-center justify-center h-full">
              <video
                src={getPreviewUrl()}
                controls
                className="max-w-full max-h-full"
                onError={() => setLoadError(true)}
              />
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
                <audio src={getPreviewUrl()} controls className="w-full" onError={() => setLoadError(true)} />
              </div>
            </div>
          ) : isPdf ? (
            <iframe
              src={getPreviewUrl()}
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
            <div className="w-full h-full overflow-auto bg-white dark:bg-gray-900 p-4" style={{ fontSize: `${zoomLevel}%` }}>
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
                <iframe
                  src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resolvedUrl)}`}
                  className="w-full h-full border-0"
                  title={decodeFileName(file.name)}
                  onError={() => setLoadError(true)}
                />
              ) : (
                renderOfficeFallback()
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
