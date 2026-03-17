/**
 * useFolderUpload.ts
 * 文件夹上传 Hook
 * 
 * 功能:
 * - 支持拖拽整个文件夹
 * - 解析webkitRelativePath重建目录结构
 * - 按正确顺序创建文件夹
 * - 批量上传文件
 * 
 * 用法:
 *   const { uploadFolderEntries } = useFolderUpload({ currentFolderId, onProgress, onDone });
 *   <div onDrop={(e) => uploadFolderEntries(e.dataTransfer.items)} />
 */

import { useCallback } from 'react';
import { filesApi } from '@/services/api';
import { presignUpload } from '@/services/presignUpload';
import { useQueryClient } from '@tanstack/react-query';

interface UseFolderUploadOptions {
  currentFolderId?: string;
  onFileStart?: (name: string, key: string) => void;
  onFileProgress?: (key: string, progress: number) => void;
  onFileDone?: (key: string) => void;
  onFileError?: (key: string, error: any) => void;
  onAllDone?: () => void;
}

interface FolderNode {
  name: string;
  parentPath: string;
  id?: string; // resolved after creation
}

export function useFolderUpload({
  currentFolderId,
  onFileStart,
  onFileProgress,
  onFileDone,
  onFileError,
  onAllDone,
}: UseFolderUploadOptions) {
  const queryClient = useQueryClient();

  const uploadFolderEntries = useCallback(
    async (items: DataTransferItemList) => {
      // Collect all File objects from the drop, preserving relative paths
      const files: { file: File; relativePath: string }[] = [];

      const traverseEntry = async (entry: FileSystemEntry, path: string) => {
        if (entry.isFile) {
          await new Promise<void>((resolve) => {
            (entry as FileSystemFileEntry).file((f) => {
              files.push({ file: f, relativePath: path ? `${path}/${f.name}` : f.name });
              resolve();
            });
          });
        } else if (entry.isDirectory) {
          const dirReader = (entry as FileSystemDirectoryEntry).createReader();
          await new Promise<void>((resolve) => {
            const readAll = () => {
              dirReader.readEntries(async (entries) => {
                if (entries.length === 0) { resolve(); return; }
                for (const e of entries) {
                  await traverseEntry(e, path ? `${path}/${entry.name}` : entry.name);
                }
                readAll(); // readEntries may return partial batches
              });
            };
            readAll();
          });
        }
      };

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || item.kind !== 'file') continue;
        const entry = item.webkitGetAsEntry?.();
        if (!entry) continue;
        await traverseEntry(entry, '');
      }

      if (files.length === 0) return;

      // Build the unique folder paths we need to create, sorted by depth
      const folderPaths = new Set<string>();
      for (const { relativePath } of files) {
        const parts = relativePath.split('/');
        for (let i = 1; i < parts.length; i++) {
          folderPaths.add(parts.slice(0, i).join('/'));
        }
      }

      const sortedFolderPaths = [...folderPaths].sort((a, b) => {
        const da = a.split('/').length;
        const db = b.split('/').length;
        return da - db;
      });

      // Map from folder path -> created folder id
      const folderIdMap = new Map<string, string>();

      // Create all required folders
      for (const folderPath of sortedFolderPaths) {
        const parts = folderPath.split('/');
        const name = parts[parts.length - 1];
        if (!name) continue;
        const parentPath = parts.slice(0, -1).join('/');
        const parentId = parentPath
          ? folderIdMap.get(parentPath) ?? currentFolderId ?? null
          : currentFolderId ?? null;

        try {
          const res = await filesApi.createFolder(name, parentId);
          const folderId = res.data.data?.id;
          if (folderId) folderIdMap.set(folderPath, folderId);
        } catch (e: any) {
          // Folder may already exist — try to get it from the listing
          // For simplicity, skip; files will still be uploaded to root if folder creation fails
          console.warn(`Could not create folder ${folderPath}:`, e?.response?.data?.error?.message);
        }
      }

      // Upload each file to its resolved parent folder
      for (const { file, relativePath } of files) {
        const parts = relativePath.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        const parentId = parentPath
          ? folderIdMap.get(parentPath) ?? currentFolderId ?? null
          : currentFolderId ?? null;

        const key = `${file.name}-${Date.now()}-${Math.random()}`;
        onFileStart?.(file.name, key);

        try {
          await presignUpload({
            file,
            parentId,
            onProgress: (progress) => onFileProgress?.(key, progress),
          });
          onFileDone?.(key);
        } catch (e) {
          onFileError?.(key, e);
        }
      }

      // Invalidate all file queries to refresh the view
      queryClient.invalidateQueries({ queryKey: ['files'] });
      onAllDone?.();
    },
    [currentFolderId, queryClient, onFileStart, onFileProgress, onFileDone, onFileError, onAllDone]
  );

  return { uploadFolderEntries };
}
