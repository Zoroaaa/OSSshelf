/**
 * LocalFilePreviewDialog.tsx
 * 预览系统交给本应用的本地文件（file_handlers / launchQueue）
 *
 * 功能:
 * - 图片 / 视频 / 音频 / PDF 直接预览
 * - 文本 / Markdown 复用现有预览组件渲染
 * - 其他类型给出明确提示
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatBytes } from '@/utils';
import { MarkdownPreview } from './filepreview/MarkdownPreview';
import { CodePreview } from './filepreview/CodePreview';
import { getLanguageFromExtension, isCodeFile } from './filepreview/previewUtils';

interface LocalFilePreviewDialogProps {
  files: File[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

type LocalPreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text' | 'unsupported';

const TEXT_EXTENSIONS = new Set([
  'txt',
  'log',
  'json',
  'xml',
  'yml',
  'yaml',
  'ini',
  'toml',
  'csv',
  'html',
  'css',
  'md',
  'markdown',
]);

const noop = () => {};

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function detectPreviewType(file: File): LocalPreviewType {
  const type = file.type.toLowerCase();
  const ext = getExtension(file.name);

  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (type.startsWith('text/') || TEXT_EXTENSIONS.has(ext) || isCodeFile(file.name)) return 'text';

  return 'unsupported';
}

export function LocalFilePreviewDialog({ files, index, onIndexChange, onClose }: LocalFilePreviewDialogProps) {
  const file = files[index];
  const previewType = useMemo(() => (file ? detectPreviewType(file) : 'unsupported'), [file]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!file || (previewType !== 'text' && previewType !== 'markdown')) {
      setTextContent(null);
      return;
    }

    let cancelled = false;
    file
      .text()
      .then((content) => {
        if (!cancelled) setTextContent(content);
      })
      .catch(() => {
        if (!cancelled) setTextContent(null);
      });

    return () => {
      cancelled = true;
    };
  }, [file, previewType]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (event.key === 'ArrowRight' && index < files.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [index, files.length, onClose, onIndexChange]);

  if (!file) return null;

  const language = getLanguageFromExtension(file.name);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-white/60">{formatBytes(file.size)}</p>
        </div>

        {files.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-full p-2 transition-colors hover:bg-white/10 disabled:opacity-30"
              onClick={() => onIndexChange(index - 1)}
              disabled={index === 0}
              aria-label="上一个文件"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-xs text-white/60">
              {index + 1}/{files.length}
            </span>
            <button
              type="button"
              className="rounded-full p-2 transition-colors hover:bg-white/10 disabled:opacity-30"
              onClick={() => onIndexChange(index + 1)}
              disabled={index === files.length - 1}
              aria-label="下一个文件"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        <button
          type="button"
          className="rounded-full p-2 transition-colors hover:bg-white/10"
          onClick={onClose}
          aria-label="关闭预览"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {previewType === 'image' && objectUrl && (
          <div className="flex h-full items-center justify-center">
            <img src={objectUrl} alt={file.name} className="max-h-full max-w-full object-contain" />
          </div>
        )}

        {previewType === 'video' && objectUrl && (
          <div className="flex h-full items-center justify-center">
            <video src={objectUrl} controls className="max-h-full max-w-full" />
          </div>
        )}

        {previewType === 'audio' && objectUrl && (
          <div className="flex h-full items-center justify-center">
            <audio src={objectUrl} controls className="w-full max-w-xl" />
          </div>
        )}

        {previewType === 'pdf' && objectUrl && (
          <iframe title={file.name} src={objectUrl} className="h-full w-full rounded-lg bg-white" />
        )}

        {previewType === 'markdown' && (
          <div className="h-full overflow-hidden rounded-lg bg-background">
            <MarkdownPreview
              textContent={textContent}
              zoomLevel={100}
              showAIInfo={false}
              onToggleAIInfo={noop}
              aiSummary={null}
              aiSummaryAt={null}
              onGenerateSummary={noop}
              isGeneratingSummary={false}
            />
          </div>
        )}

        {previewType === 'text' && (
          <div className="h-full overflow-hidden rounded-lg bg-background">
            <CodePreview
              textContent={textContent}
              zoomLevel={100}
              detectedLanguage={language}
              showAIInfo={false}
              onToggleAIInfo={noop}
              aiSummary={null}
              aiSummaryAt={null}
              onGenerateSummary={noop}
              isGeneratingSummary={false}
            />
          </div>
        )}

        {previewType === 'unsupported' && (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-sm text-white/70">该文件类型暂不支持在应用内预览</p>
          </div>
        )}
      </div>
    </div>
  );
}
