/**
 * EpubPreview.tsx
 * EPUB电子书预览组件
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import ePub, { Book } from 'epubjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface EpubPreviewProps {
  resolvedUrl: string;
  onLoadError: () => void;
}

export function EpubPreview({ resolvedUrl, onLoadError }: EpubPreviewProps) {
  const epubViewerRef = useRef<Book | null>(null);
  const epubRenditionRef = useRef<ReturnType<Book['renderTo']> | null>(null);
  const [epubLoading, setEpubLoading] = useState(false);
  const [epubCurrentPage, setEpubCurrentPage] = useState(0);
  const [epubTotalPages, setEpubTotalPages] = useState(0);
  const [epubToc, setEpubToc] = useState<{ href: string; label: string }[]>([]);
  const [epubShowToc, setEpubShowToc] = useState(true);

  const loadEpubPreview = useCallback(async () => {
    setEpubLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();

      const book = ePub(arrayBuffer);
      epubViewerRef.current = book;

      const rendition = book.renderTo('epub-viewer', {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'none',
        minSpreadWidth: 9999,
      });
      epubRenditionRef.current = rendition;

      await rendition.display();
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
      onLoadError();
      setEpubLoading(false);
    }
  }, [resolvedUrl, onLoadError]);

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

  useEffect(() => {
    loadEpubPreview();
    return () => {
      if (epubRenditionRef.current) {
        try {
          epubRenditionRef.current.destroy();
        } catch {
          /* ignore */
        }
      }
      if (epubViewerRef.current) {
        try {
          epubViewerRef.current.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, [loadEpubPreview]);

  return (
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
        <div className="flex-1 relative overflow-hidden">
          <button
            onClick={epubPrevPage}
            className="absolute left-0 top-0 h-full w-16 z-10 flex items-center justify-start pl-1 opacity-0 hover:opacity-100 transition-opacity group"
            title="上一页"
          >
            <div className="bg-black/10 dark:bg-white/10 rounded-full p-1.5 group-hover:bg-black/20 dark:group-hover:bg-white/20 transition-colors">
              <ChevronLeft className="h-5 w-5 text-foreground/60" />
            </div>
          </button>
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
  );
}
