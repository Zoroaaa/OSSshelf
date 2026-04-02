/**
 * ShareFilePreview.tsx
 * 分享页面文件预览组件
 *
 * 功能:
 * - 图片/视频/音频预览
 * - PDF文档预览（分页）
 * - 文本/代码预览（带语法高亮）
 * - Markdown 渲染预览（带代码高亮、表格样式）
 * - Office文档预览（Word/Excel本地渲染，保留样式）
 * - EPUB电子书预览
 * - 字体文件预览
 * - ZIP压缩包内容列表预览
 * - CSV表格预览
 * - PowerPoint幻灯片预览
 * - 缩放控制和窗口尺寸切换
 * - 支持单文件分享和文件夹分享中的子文件预览
 *
 * ============================================================================
 * 【重要提醒】修改此文件后必须同步更新：
 *   - apps/web/src/components/files/FilePreview.tsx  # 文件管理预览组件
 *   - packages/shared/src/constants/previewTypes.ts  # 预览类型配置
 * ============================================================================
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { X, Download, FileText, ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FileIcon } from '@/components/files/FileIcon';
import { formatBytes, decodeFileName } from '@/utils';
import { cn } from '@/utils';

import { ImagePreview } from '../files/filepreview/ImagePreview';
import { VideoPreview } from '../files/filepreview/VideoPreview';
import { AudioPreview } from '../files/filepreview/AudioPreview';
import { PdfPreview } from '../files/filepreview/PdfPreview';
import { MarkdownPreview } from '../files/filepreview/MarkdownPreview';
import { CodePreview } from '../files/filepreview/CodePreview';
import { OfficePreview } from '../files/filepreview/OfficePreview';
import { CsvPreview } from '../files/filepreview/CsvPreview';
import { ZipPreview } from '../files/filepreview/ZipPreview';
import { FontPreview } from '../files/filepreview/FontPreview';
import { EpubPreview } from '../files/filepreview/EpubPreview';
import {
  WINDOW_SIZE_CONFIG,
  WindowSize,
  getLanguageFromExtension,
  isCodeFile,
} from '../files/filepreview/previewUtils';
import { getSharePreviewUrl, fetchShareTextContent } from './sharepreview/sharePreviewUtils';

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
  const [zoomLevel, setZoomLevel] = useState(100);
  const [windowSize, setWindowSize] = useState<WindowSize>('medium');
  const overlayRef = useRef<HTMLDivElement>(null);

  const mimeType = file.mimeType;
  const isImage = mimeType?.startsWith('image/');
  const isVideo = mimeType?.startsWith('video/');
  const isAudio = mimeType?.startsWith('audio/');
  const isPdf = mimeType === 'application/pdf';
  const isMarkdown = mimeType === 'text/markdown' || file.name.endsWith('.md');
  const isPlainText = mimeType === 'text/plain' || file.name.endsWith('.txt');
  const isCsv = mimeType === 'text/csv' || file.name.endsWith('.csv');
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
  const isCode = isText && !isMarkdown && !isPlainText && !isCsv && isCodeFile(file.name);
  const isEpub = mimeType === 'application/epub+zip' || file.name.endsWith('.epub');
  const isFont =
    mimeType?.startsWith('font/') ||
    ['.ttf', '.otf', '.woff', '.woff2'].some((ext) => file.name.toLowerCase().endsWith(ext));
  const isZip =
    mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed' ||
    mimeType === 'application/x-zip' ||
    file.name.toLowerCase().endsWith('.zip');

  const canPreview =
    isImage || isVideo || isAudio || isPdf || isText || isMarkdown || isOffice || isEpub || isFont || isZip || isCsv;

  const detectedLanguage = useMemo(() => {
    return getLanguageFromExtension(file.name);
  }, [file.name]);

  const previewUrl = useMemo(() => {
    return getSharePreviewUrl(shareId, file.id, password, isChildFile, isVideo, isAudio);
  }, [shareId, file.id, password, isChildFile, isVideo, isAudio]);

  useEffect(() => {
    setLoadError(false);
    setTextContent(null);
    setPreviewInfo(null);
    setZoomLevel(100);
    setWindowSize('medium');
  }, [shareId, file.id, password]);

  useEffect(() => {
    if ((!isText && !isMarkdown && !isCsv) || !canPreview) return;

    const fetchContent = async () => {
      const content = await fetchShareTextContent(shareId, file.id, password, isChildFile);
      if (content) {
        setTextContent(content);
      } else {
        setLoadError(true);
      }
    };

    fetchContent();
  }, [shareId, file.id, password, isText, isMarkdown, isCsv, canPreview, isChildFile]);

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
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const sizeConfig = WINDOW_SIZE_CONFIG[windowSize];
  const showZoomControls = isText || isMarkdown || isExcel || isWord || isCsv || isFont || isEpub || isPpt;

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
          ) : !previewUrl ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground text-sm py-12">加载中...</div>
            </div>
          ) : isImage ? (
            <ImagePreview
              resolvedUrl={previewUrl}
              fileName={file.name}
              zoomLevel={zoomLevel}
              onLoadError={() => setLoadError(true)}
              showAIInfo={false}
              onToggleAIInfo={() => {}}
              aiSummary={null}
              aiSummaryAt={null}
              aiTags={[]}
              onGenerateSummary={() => {}}
              onGenerateTags={() => {}}
              isGeneratingSummary={false}
              isGeneratingTags={false}
            />
          ) : isVideo ? (
            <VideoPreview resolvedUrl={previewUrl} onLoadError={() => setLoadError(true)} />
          ) : isAudio ? (
            <AudioPreview resolvedUrl={previewUrl} fileName={file.name} onLoadError={() => setLoadError(true)} />
          ) : isPdf ? (
            <PdfPreview resolvedUrl={previewUrl} zoomLevel={zoomLevel} onLoadError={() => setLoadError(true)} />
          ) : isMarkdown ? (
            <MarkdownPreview
              textContent={textContent}
              zoomLevel={zoomLevel}
              showAIInfo={false}
              onToggleAIInfo={() => {}}
              aiSummary={null}
              aiSummaryAt={null}
              onGenerateSummary={() => {}}
              isGeneratingSummary={false}
            />
          ) : isCode ? (
            <CodePreview
              textContent={textContent}
              zoomLevel={zoomLevel}
              detectedLanguage={detectedLanguage}
              showAIInfo={false}
              onToggleAIInfo={() => {}}
              aiSummary={null}
              aiSummaryAt={null}
              onGenerateSummary={() => {}}
              isGeneratingSummary={false}
            />
          ) : isText ? (
            <div className="relative w-full h-full">
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
            </div>
          ) : isOffice ? (
            <OfficePreview
              resolvedUrl={previewUrl}
              fileName={file.name}
              mimeType={mimeType}
              zoomLevel={zoomLevel}
              onLoadError={() => setLoadError(true)}
              onDownload={onDownload}
            />
          ) : isCsv ? (
            <CsvPreview resolvedUrl={previewUrl} onLoadError={() => setLoadError(true)} />
          ) : isZip ? (
            <ZipPreview resolvedUrl={previewUrl} onLoadError={() => setLoadError(true)} />
          ) : isFont ? (
            <FontPreview
              resolvedUrl={previewUrl}
              fileName={file.name}
              zoomLevel={zoomLevel}
              onLoadError={() => setLoadError(true)}
            />
          ) : isEpub ? (
            <EpubPreview resolvedUrl={previewUrl} onLoadError={() => setLoadError(true)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
