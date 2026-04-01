/**
 * ZipPreview.tsx
 * ZIP压缩包预览组件
 */

import { useEffect, useState, useCallback } from 'react';
import JSZip from 'jszip';
import { Folder, File, FileText, Image as ImageIcon, Archive } from 'lucide-react';
import { formatBytes } from '@/utils';
import type { ZipTreeNode } from './previewUtils';

interface ZipPreviewProps {
  resolvedUrl: string;
  onLoadError: () => void;
}

export function ZipPreview({ resolvedUrl, onLoadError }: ZipPreviewProps) {
  const [zipLoading, setZipLoading] = useState(false);
  const [zipTree, setZipTree] = useState<ZipTreeNode[]>([]);
  const [zipStats, setZipStats] = useState<{
    totalFiles: number;
    totalDirs: number;
    totalSize: number;
    compressedSize: number;
  } | null>(null);

  const buildZipTree = (zip: JSZip): ZipTreeNode[] => {
    const root: ZipTreeNode[] = [];
    const map = new Map<string, ZipTreeNode>();

    zip.forEach((relativePath, zipEntry) => {
      const parts = relativePath.split('/').filter(Boolean);
      let currentPath = '';
      let currentLevel = root;
      const entryData = (zipEntry as any)._data;

      parts.forEach((part, index) => {
        currentPath += (currentPath ? '/' : '') + part;
        const isLast = index === parts.length - 1;
        const isDir = !isLast || zipEntry.dir;

        if (!map.has(currentPath)) {
          const node: ZipTreeNode = {
            name: part,
            path: currentPath,
            isDir,
            size: isDir ? 0 : entryData?.uncompressedSize || 0,
            compressedSize: isDir ? 0 : entryData?.compressedSize || 0,
            children: [],
            level: index,
          };
          map.set(currentPath, node);
          currentLevel.push(node);
          currentLevel = node.children;
        } else {
          currentLevel = map.get(currentPath)!.children;
        }
      });
    });

    return root;
  };

  const loadZipPreview = useCallback(async () => {
    setZipLoading(true);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`文件加载失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      let totalSize = 0;
      let compressedSize = 0;
      let fileCount = 0;
      let dirCount = 0;

      zip.forEach((relativePath, zipEntry) => {
        const entryData = (zipEntry as any)._data;
        const uncompressedSize = entryData?.uncompressedSize || 0;
        const compressedSz = entryData?.compressedSize || 0;
        if (!zipEntry.dir) {
          totalSize += uncompressedSize;
          compressedSize += compressedSz;
          fileCount++;
        } else {
          dirCount++;
        }
      });

      setZipStats({
        totalFiles: fileCount,
        totalDirs: dirCount,
        totalSize,
        compressedSize,
      });

      const tree = buildZipTree(zip);
      setZipTree(tree);
    } catch (err) {
      console.error('ZIP preview error:', err);
      onLoadError();
    } finally {
      setZipLoading(false);
    }
  }, [resolvedUrl, onLoadError]);

  const renderZipTreeNode = (node: ZipTreeNode, depth: number = 0): React.ReactNode => {
    const getFileIcon = (name: string, isDir: boolean) => {
      if (isDir) return <Folder className="h-4 w-4 text-amber-500 flex-shrink-0" />;
      const ext = name.split('.').pop()?.toLowerCase();
      switch (ext) {
        case 'pdf':
          return <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />;
        case 'doc':
        case 'docx':
          return <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />;
        case 'xls':
        case 'xlsx':
          return <FileText className="h-4 w-4 text-green-500 flex-shrink-0" />;
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'webp':
          return <ImageIcon className="h-4 w-4 text-purple-500 flex-shrink-0" />;
        case 'zip':
        case 'rar':
        case '7z':
          return <Archive className="h-4 w-4 text-yellow-600 flex-shrink-0" />;
        default:
          return <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
      }
    };

    return (
      <div key={node.path}>
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-default"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {getFileIcon(node.name, node.isDir)}
          <span className="flex-1 truncate text-sm">{node.name}</span>
          {!node.isDir && <span className="text-xs text-muted-foreground">{formatBytes(node.size)}</span>}
        </div>
        {node.children.map((child) => renderZipTreeNode(child, depth + 1))}
      </div>
    );
  };

  useEffect(() => {
    loadZipPreview();
  }, [loadZipPreview]);

  return (
    <div className="w-full h-full flex flex-col relative">
      {zipLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
          <div className="text-muted-foreground text-sm">正在读取压缩包...</div>
        </div>
      )}
      {zipTree.length > 0 ? (
        <>
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <span className="text-sm text-muted-foreground">压缩包内容</span>
            {zipStats && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{zipStats.totalFiles} 个文件</span>
                <span>{zipStats.totalDirs} 个文件夹</span>
                <span>原始: {formatBytes(zipStats.totalSize)}</span>
                <span>压缩: {formatBytes(zipStats.compressedSize)}</span>
                {zipStats.totalSize > 0 && (
                  <span className="text-green-600">
                    压缩率: {Math.round((1 - zipStats.compressedSize / zipStats.totalSize) * 100)}%
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto bg-white dark:bg-gray-900 p-2">
            {zipTree.map((node) => renderZipTreeNode(node))}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-center text-muted-foreground text-sm py-8">加载中...</p>
        </div>
      )}
    </div>
  );
}
