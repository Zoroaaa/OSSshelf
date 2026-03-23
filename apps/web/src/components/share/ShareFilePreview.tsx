/**
 * ShareFilePreview.tsx
 * 分享页面文件预览组件
 *
 * 功能:
 * - 图片/视频/音频预览
 * - PDF文档预览
 * - 文本/代码预览
 * - 支持单文件分享和文件夹分享中的子文件预览
 */

import { useEffect, useState, useRef } from 'react';
import { X, Download, FileText, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileIcon } from '@/components/ui/FileIcon';
import { shareApi } from '@/services/api';
import { formatBytes, decodeFileName } from '@/utils';
import { cn } from '@/utils';

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
  const overlayRef = useRef<HTMLDivElement>(null);

  const mimeType = file.mimeType;
  const isImage = mimeType?.startsWith('image/');
  const isVideo = mimeType?.startsWith('video/');
  const isAudio = mimeType?.startsWith('audio/');
  const isPdf = mimeType === 'application/pdf';
  const isText =
    mimeType?.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript';

  const canPreview = isImage || isVideo || isAudio || isPdf || isText;

  useEffect(() => {
    setLoadError(false);
    setTextContent(null);
    setPreviewInfo(null);
  }, [shareId, file.id, password]);

  useEffect(() => {
    if (!isText || !canPreview) return;

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
  }, [shareId, file.id, password, isText, canPreview, isChildFile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const getPreviewUrl = () => {
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
  };

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
              : isPdf
                ? 'w-[90vw] max-w-5xl h-[90vh]'
                : isText
                  ? 'w-[90vw] max-w-3xl max-h-[80vh]'
                  : 'w-full max-w-md'
        )}
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
          ) : isImage ? (
            <div className="flex items-center justify-center h-full">
              <img
                src={getPreviewUrl()}
                alt={decodeFileName(file.name)}
                className="max-w-full max-h-full object-contain"
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
