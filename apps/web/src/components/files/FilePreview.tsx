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
import {
  X,
  Download,
  Share2,
  FileText,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  MessageSquare,
  Edit3,
  History,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FileIcon } from '@/components/files/FileIcon';
import { filesApi, previewApi, aiApi } from '@/services/api';
import { getPresignedPreviewUrl } from '@/services/presignUpload';
import { formatBytes, formatDate, decodeFileName } from '@/utils';
import { isPreviewable } from '@/utils/fileTypes';
import type { FileItem } from '@osshelf/shared';
import { isEditableFile } from '@osshelf/shared';
import { cn } from '@/utils';
import { NotePanel } from '@/components/notes';
import { FileEditor } from '@/components/editor';
import { AISummaryCard, ImageTagsDisplay, SmartRenameDialog } from '@/components/ai';

import { ImagePreview } from './filepreview/ImagePreview';
import { VideoPreview } from './filepreview/VideoPreview';
import { AudioPreview } from './filepreview/AudioPreview';
import { PdfPreview } from './filepreview/PdfPreview';
import { MarkdownPreview } from './filepreview/MarkdownPreview';
import { CodePreview } from './filepreview/CodePreview';
import { OfficePreview } from './filepreview/OfficePreview';
import { CsvPreview } from './filepreview/CsvPreview';
import { ZipPreview } from './filepreview/ZipPreview';
import { FontPreview } from './filepreview/FontPreview';
import { EpubPreview } from './filepreview/EpubPreview';
import {
  WINDOW_SIZE_CONFIG,
  WindowSize,
  getLanguageFromExtension,
  isCodeFile,
} from './filepreview/previewUtils';

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
  onEdit?: (file: FileItem) => void;
  onVersionHistory?: (file: FileItem) => void;
}

export function FilePreview({ file, token, onClose, onDownload, onShare, onEdit, onVersionHistory }: FilePreviewProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [windowSize, setWindowSize] = useState<WindowSize>('medium');
  const [showNotes, setShowNotes] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showSmartRename, setShowSmartRename] = useState(false);
  const [showAIInfo, setShowAIInfo] = useState(true);
  const overlayRef = useRef<HTMLDivElement>(null);

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
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);

  const handleGenerateSummary = useCallback(async () => {
    if (!file.id) return;
    setIsGeneratingSummary(true);
    try {
      const res = await aiApi.summarize(file.id);
      if (res.data.data?.summary) {
        setAiSummary(res.data.data.summary);
        setAiSummaryAt(new Date().toISOString());
      }
    } catch (e: any) {
      console.error('Failed to generate summary:', e);
      const message = e?.response?.data?.error?.message || e?.message || '生成摘要失败';
      alert(message);
    } finally {
      setIsGeneratingSummary(false);
    }
  }, [file.id]);

  const handleGenerateTags = useCallback(async () => {
    if (!file.id) return;
    setIsGeneratingTags(true);
    try {
      const res = await aiApi.generateTags(file.id);
      if (res.data.data?.tags) setAiTags(res.data.data.tags);
      if (res.data.data?.caption) {
        setAiSummary(res.data.data.caption);
        setAiSummaryAt(new Date().toISOString());
      }
    } catch (e: any) {
      console.error('Failed to generate tags:', e);
      const message = e?.response?.data?.error?.message || e?.message || '生成标签失败';
      alert(message);
    } finally {
      setIsGeneratingTags(false);
    }
  }, [file.id]);

  const canGenerateSummary = isEditableFile(file.mimeType, file.name);
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
    setZoomLevel(100);
    setWindowSize('medium');

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
          <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sm">{decodeFileName(file.name)}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(file.size)} · {formatDate(file.updatedAt)}
              {previewInfo?.language && <span className="ml-2 opacity-60">({previewInfo.language})</span>}
            </p>
          </div>
          <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
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
            <Button variant="ghost" size="icon" className="h-8 w-8" title="笔记" onClick={() => setShowNotes(true)}>
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
          <div className="flex lg:hidden items-center gap-1 flex-shrink-0">
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
                <FileIcon mimeType={file.mimeType} size="lg" className="mx-auto" />
                <div>
                  <p className="font-medium">{decodeFileName(file.name)}</p>
                  <p className="text-sm text-muted-foreground mt-1">{formatBytes(file.size)}</p>
                  <p className="text-sm text-muted-foreground">{file.mimeType || '未知类型'}</p>
                </div>
                <div className="space-y-3 max-w-sm mx-auto">
                  <AISummaryCard
                    summary={aiSummary}
                    summaryAt={aiSummaryAt}
                    onGenerate={handleGenerateSummary}
                    isGenerating={isGeneratingSummary}
                    showGenerateButton={canGenerateSummary}
                  />
                  {file.mimeType?.startsWith('image/') && (
                    <ImageTagsDisplay
                      tags={aiTags}
                      onGenerate={handleGenerateTags}
                      isGenerating={isGeneratingTags}
                      showGenerateButton
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
            <ImagePreview
              resolvedUrl={resolvedUrl}
              fileName={file.name}
              zoomLevel={zoomLevel}
              onLoadError={() => setLoadError(true)}
              showAIInfo={showAIInfo}
              onToggleAIInfo={() => setShowAIInfo(!showAIInfo)}
              aiSummary={aiSummary}
              aiSummaryAt={aiSummaryAt}
              aiTags={aiTags}
              onGenerateSummary={handleGenerateSummary}
              onGenerateTags={handleGenerateTags}
              isGeneratingSummary={isGeneratingSummary}
              isGeneratingTags={isGeneratingTags}
            />
          ) : isVideo ? (
            <VideoPreview resolvedUrl={resolvedUrl} onLoadError={() => setLoadError(true)} />
          ) : isAudio ? (
            <AudioPreview resolvedUrl={resolvedUrl} fileName={file.name} onLoadError={() => setLoadError(true)} />
          ) : isPdf ? (
            <PdfPreview resolvedUrl={resolvedUrl} zoomLevel={zoomLevel} onLoadError={() => setLoadError(true)} />
          ) : isMarkdown ? (
            <MarkdownPreview
              textContent={textContent}
              zoomLevel={zoomLevel}
              showAIInfo={showAIInfo}
              onToggleAIInfo={() => setShowAIInfo(!showAIInfo)}
              aiSummary={aiSummary}
              aiSummaryAt={aiSummaryAt}
              onGenerateSummary={handleGenerateSummary}
              isGeneratingSummary={isGeneratingSummary}
            />
          ) : isCode ? (
            <CodePreview
              textContent={textContent}
              zoomLevel={zoomLevel}
              detectedLanguage={detectedLanguage}
              showAIInfo={showAIInfo}
              onToggleAIInfo={() => setShowAIInfo(!showAIInfo)}
              aiSummary={aiSummary}
              aiSummaryAt={aiSummaryAt}
              onGenerateSummary={handleGenerateSummary}
              isGeneratingSummary={isGeneratingSummary}
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
              resolvedUrl={resolvedUrl}
              fileName={file.name}
              mimeType={file.mimeType}
              zoomLevel={zoomLevel}
              onLoadError={() => setLoadError(true)}
              onDownload={() => onDownload(file)}
            />
          ) : isCsv ? (
            <CsvPreview resolvedUrl={resolvedUrl} onLoadError={() => setLoadError(true)} />
          ) : isZip ? (
            <ZipPreview resolvedUrl={resolvedUrl} onLoadError={() => setLoadError(true)} />
          ) : isFont ? (
            <FontPreview
              resolvedUrl={resolvedUrl}
              fileName={file.name}
              zoomLevel={zoomLevel}
              onLoadError={() => setLoadError(true)}
            />
          ) : isEpub ? (
            <EpubPreview resolvedUrl={resolvedUrl} onLoadError={() => setLoadError(true)} />
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

      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t safe-bottom">
        <div className="flex items-center justify-around h-14 px-2">
          {showZoomControls && (
            <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 rounded-md">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="缩小"
                onClick={handleZoomOut}
                disabled={zoomLevel <= 50}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs min-w-[36px] text-center font-medium">{zoomLevel}%</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="放大"
                onClick={handleZoomIn}
                disabled={zoomLevel >= 200}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-10 w-10" title="下载" onClick={() => onDownload(file)}>
            <Download className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10" title="分享" onClick={() => onShare(file.id)}>
            <Share2 className="h-5 w-5" />
          </Button>
          {isEditableFile(file.mimeType, file.name) && onEdit && (
            <Button variant="ghost" size="icon" className="h-10 w-10" title="编辑" onClick={() => setShowEditor(true)}>
              <Edit3 className="h-5 w-5" />
            </Button>
          )}
          {isEditableFile(file.mimeType, file.name) && onVersionHistory && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              title="版本历史"
              onClick={() => onVersionHistory(file)}
            >
              <History className="h-5 w-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-10 w-10" title="笔记" onClick={() => setShowNotes(true)}>
            <MessageSquare className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            title="智能重命名"
            onClick={() => setShowSmartRename(true)}
          >
            <Sparkles className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            title={windowSize === 'fullscreen' ? '退出全屏' : '全屏'}
            onClick={handleToggleFullscreen}
          >
            {windowSize === 'fullscreen' ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
