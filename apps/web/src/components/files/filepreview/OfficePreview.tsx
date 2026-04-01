/**
 * OfficePreview.tsx
 * Office文档预览组件（Word/Excel/PPT）
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import { init as initPptxPreview } from 'pptx-preview';
import * as XLSX from 'xlsx';
import { Download, FileText, FileSpreadsheet, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import { decodeFileName } from '@/utils';

interface OfficePreviewProps {
  resolvedUrl: string;
  fileName: string;
  mimeType: string | null;
  zoomLevel: number;
  onLoadError: () => void;
  onDownload: () => void;
}

export function OfficePreview({
  resolvedUrl,
  fileName,
  mimeType,
  zoomLevel,
  onLoadError,
  onDownload,
}: OfficePreviewProps) {
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const [pptLoading, setPptLoading] = useState(false);
  const [officeUseOnlineViewer, setOfficeUseOnlineViewer] = useState(true);
  const [officeOnlineError, setOfficeOnlineError] = useState(false);
  const [pptUseOnlineViewer, setPptUseOnlineViewer] = useState(true);
  const [pptOnlineError, setPptOnlineError] = useState(false);

  const docxContainerRef = useRef<HTMLDivElement>(null);
  const pptxContainerRef = useRef<HTMLDivElement>(null);
  const pptxViewerRef = useRef<ReturnType<typeof initPptxPreview> | null>(null);
  const pptxLoadedRef = useRef(false);
  const excelContainerRef = useRef<HTMLDivElement>(null);

  const isWord =
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword';
  const isExcel =
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel';
  const isPpt =
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint';

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
          <p className="font-medium">{decodeFileName(fileName)}</p>
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
  }, [isWord, resolvedUrl]);

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
      onLoadError();
    } finally {
      setExcelLoading(false);
    }
  }, [isExcel, resolvedUrl, onLoadError]);

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

      container.innerHTML = '';
      pptxViewerRef.current = initPptxPreview(container, {
        width: 960,
        height: 540,
      });

      await pptxViewerRef.current.preview(arrayBuffer);
    } catch (err) {
      console.error('PPT preview error:', err);
      onLoadError();
      pptxLoadedRef.current = false;
    } finally {
      setPptLoading(false);
    }
  }, [isPpt, resolvedUrl, onLoadError]);

  const pptxContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    (pptxContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
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
    if (isPpt && !pptUseOnlineViewer && resolvedUrl && pptxContainerRef.current && !pptxLoadedRef.current) {
      loadPptPreview();
    }
  }, [isPpt, pptUseOnlineViewer, resolvedUrl, loadPptPreview]);

  return (
    <div className="w-full h-full flex flex-col relative">
      {officeUseOnlineViewer && resolvedUrl && !officeOnlineError && (isWord || isExcel) ? (
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
          <div ref={excelContainerRef} className="w-full h-full bg-white dark:bg-gray-900" />
        </div>
      ) : isPpt ? (
        <div className="w-full h-full relative">
          {pptLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-20">
              <div className="text-muted-foreground text-sm">正在加载幻灯片...</div>
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
  );
}
