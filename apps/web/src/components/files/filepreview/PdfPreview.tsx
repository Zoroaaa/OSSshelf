/**
 * PdfPreview.tsx
 * PDF预览组件
 *
 * 功能:
 * - PDF文档预览
 * - 分页导航
 * - 缩放支持
 * - 内存管理（组件卸载时清理资源）
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PdfPreviewProps {
  resolvedUrl: string;
  zoomLevel: number;
  onLoadError: () => void;
}

export function PdfPreview({ resolvedUrl, zoomLevel, onLoadError }: PdfPreviewProps) {
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pdfLoadedRef = useRef(false);
  const isMountedRef = useRef(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);

  const renderPdfPage = useCallback(
    async (pageNum: number) => {
      if (!pdfDocRef.current || !pdfContainerRef.current || !isMountedRef.current) return;

      const page = await pdfDocRef.current.getPage(pageNum);
      if (!isMountedRef.current) return;

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
        canvas,
      }).promise;

      if (isMountedRef.current) {
        setPdfCurrentPage(pageNum);
      }
    },
    [zoomLevel]
  );

  const loadPdfPreview = useCallback(async () => {
    const container = pdfContainerRef.current;
    if (!container || !isMountedRef.current) return;
    if (pdfLoadedRef.current) return;

    pdfLoadedRef.current = true;
    setPdfLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();

      if (!isMountedRef.current) return;

      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pdfDocRef.current = pdfDoc;

      if (!isMountedRef.current) return;

      setPdfTotalPages(pdfDoc.numPages);
      await renderPdfPage(1);
    } catch (err) {
      console.error('PDF preview error:', err);
      if (isMountedRef.current) {
        onLoadError();
        pdfLoadedRef.current = false;
      }
    } finally {
      if (isMountedRef.current) {
        setPdfLoading(false);
      }
    }
  }, [resolvedUrl, renderPdfPage, onLoadError]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy().catch((err) => {
          console.warn('PDF document cleanup warning:', err);
        });
        pdfDocRef.current = null;
      }
      pdfLoadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (pdfContainerRef.current && !pdfLoadedRef.current && isMountedRef.current) {
      loadPdfPreview();
    }
  }, [loadPdfPreview]);

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

  useEffect(() => {
    if (pdfDocRef.current && isMountedRef.current) {
      renderPdfPage(pdfCurrentPage);
    }
  }, [zoomLevel, pdfCurrentPage, renderPdfPage]);

  return (
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
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 relative">
        {pdfLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="text-muted-foreground text-sm">正在加载 PDF...</div>
          </div>
        )}
        <div ref={pdfContainerRef} className="flex flex-col items-center" />
      </div>
    </div>
  );
}
