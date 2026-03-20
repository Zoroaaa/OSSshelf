/**
 * FilePreview.tsx
 * 文件预览组件
 *
 * 功能:
 * - 图片/视频/音频预览
 * - PDF文档预览
 * - 文本/代码预览
 * - Office文档预览（Word本地渲染）
 * - 预览信息展示
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import { X, Download, Share2, FileText, Volume2, FileSpreadsheet, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileIcon } from '@/components/ui/FileIcon';
import { filesApi, previewApi } from '@/services/api';
import { getPresignedPreviewUrl } from '@/services/presignUpload';
import { formatBytes, formatDate } from '@/utils';
import { isPreviewable } from '@/utils/fileTypes';
import type { FileItem } from '@osshelf/shared';
import { cn } from '@/utils';

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

export function FilePreview({ file, token, onClose, onDownload, onShare }: FilePreviewProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  const canPreview = isPreviewable(file.mimeType);
  const isImage = file.mimeType?.startsWith('image/');
  const isVideo = file.mimeType?.startsWith('video/');
  const isAudio = file.mimeType?.startsWith('audio/');
  const isPdf = file.mimeType === 'application/pdf';
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

  useEffect(() => {
    let cancelled = false;
    setResolvedUrl(null);
    setLoadError(false);
    setTextContent(null);
    setPreviewInfo(null);
    setOfficeLoading(false);
    setOfficeError(null);

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
    if (!isText || !canPreview || !resolvedUrl) return;

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
  }, [file.id, resolvedUrl, isText, canPreview]);

  const loadDocxPreview = useCallback(async () => {
    if (!isWord || !resolvedUrl || !docxContainerRef.current) {
      console.log('DOCX preview skipped:', {
        isWord,
        resolvedUrl: !!resolvedUrl,
        container: !!docxContainerRef.current,
      });
      return;
    }

    setOfficeLoading(true);
    setOfficeError(null);

    console.log('DOCX preview starting, file size:', file.size, 'bytes');

    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();

      console.log('DOCX file loaded, buffer size:', arrayBuffer.byteLength);

      if (!docxContainerRef.current) {
        throw new Error('容器不可用');
      }

      if (arrayBuffer.byteLength === 0) {
        throw new Error('文件内容为空');
      }

      docxContainerRef.current.innerHTML = '';

      console.log('DOCX rendering started...');

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

      console.log('DOCX rendering completed, children:', docxContainerRef.current.children.length);

      const renderedContent = docxContainerRef.current.querySelector('.docx-preview-wrapper');
      if (!renderedContent || docxContainerRef.current.children.length === 0) {
        throw new Error('文档渲染结果为空');
      }

      console.log('DOCX preview successful');
    } catch (err) {
      console.error('DOCX preview error:', err);
      setOfficeError(err instanceof Error ? err.message : '文档预览失败，请下载查看');
    } finally {
      setOfficeLoading(false);
    }
  }, [isWord, resolvedUrl, file.size]);

  useEffect(() => {
    if (isWord && resolvedUrl) {
      loadDocxPreview();
    }
  }, [isWord, resolvedUrl, loadDocxPreview]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

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
          <p className="font-medium">{file.name}</p>
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

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div
        className={cn(
          'relative flex flex-col bg-card border rounded-xl shadow-2xl overflow-hidden',
          isImage || isVideo
            ? 'w-[90vw] max-w-5xl max-h-[90vh]'
            : isAudio
              ? 'w-full max-w-md'
              : isPdf || isOffice
                ? 'w-[90vw] max-w-5xl h-[90vh]'
                : isText
                  ? 'w-[90vw] max-w-3xl max-h-[80vh]'
                  : 'w-full max-w-md'
        )}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0">
          <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sm">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(file.size)} · {formatDate(file.updatedAt)}
              {previewInfo?.language && <span className="ml-2 opacity-60">({previewInfo.language})</span>}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
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
                  <p className="font-medium">{file.name}</p>
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
            <div className="flex items-center justify-center h-full">
              <img
                src={resolvedUrl}
                alt={file.name}
                className="max-w-full max-h-full object-contain"
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
                <p className="text-center font-medium">{file.name}</p>
                <audio src={resolvedUrl} controls className="w-full" onError={() => setLoadError(true)} />
              </div>
            </div>
          ) : isPdf ? (
            <iframe
              src={resolvedUrl}
              className="w-full h-full border-0"
              title={file.name}
              onError={() => setLoadError(true)}
            />
          ) : isText ? (
            <div className="w-full h-full overflow-auto p-4">
              {textContent !== null ? (
                <pre
                  className={cn(
                    'text-xs font-mono whitespace-pre-wrap leading-relaxed',
                    previewInfo?.previewType === 'code' ? 'text-green-600 dark:text-green-400' : 'text-foreground/80'
                  )}
                >
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
                  />
                </>
              ) : isExcel ? (
                renderOfficeFallback('Excel 表格暂不支持在线预览')
              ) : isPpt ? (
                renderOfficeFallback('PowerPoint 暂不支持在线预览')
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
