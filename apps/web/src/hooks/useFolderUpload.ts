/**
 * useFolderUpload.ts
 * 文件夹上传 Hook
 *
 * 功能:
 * - 支持拖拽整个文件夹
 * - 支持通过 input[webkitdirectory] 选择文件夹
 * - 解析webkitRelativePath重建目录结构
 * - 按正确顺序创建文件夹
 * - 批量上传文件
 *
 * 用法:
 *   const { uploadFolderEntries, uploadFilesWithRelativePath } = useFolderUpload({ ... });
 *   // 拖拽上传
 *   <div onDrop={(e) => uploadFolderEntries(e.dataTransfer.items)} />
 *   // input 选择文件夹
 *   <input webkitdirectory onChange={(e) => uploadFilesWithRelativePath(e.target.files)} />
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
  onAllDone?: (stats?: { uploaded: number; failed: number }) => void;
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

  const uploadFilesWithRelativePath = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const folderPaths = new Set<string>();
      const filesWithPaths: { file: File; relativePath: string }[] = [];

      for (const file of files) {
        const relativePath = (file as any).webkitRelativePath as string;
        if (!relativePath) {
          filesWithPaths.push({ file, relativePath: file.name });
          continue;
        }
        filesWithPaths.push({ file, relativePath });
        const parts = relativePath.split('/');
        for (let i = 1; i < parts.length; i++) {
          folderPaths.add(parts.slice(0, i).join('/'));
        }
      }

      const sortedFolderPaths = [...folderPaths].sort((a, b) => a.split('/').length - b.split('/').length);

      const folderIdMap = new Map<string, string>();

      for (const folderPath of sortedFolderPaths) {
        const parts = folderPath.split('/');
        const name = parts[parts.length - 1];
        if (!name) continue;

        const parentPath = parts.slice(0, -1).join('/');
        const parentId = parentPath
          ? (folderIdMap.get(parentPath) ?? currentFolderId ?? null)
          : (currentFolderId ?? null);

        try {
          const res = await filesApi.createFolder(name, parentId);
          const createdId = res.data.data?.id;
          if (createdId) {
            folderIdMap.set(folderPath, createdId);
            queryClient.invalidateQueries({ queryKey: ['files'] });
          }
        } catch (e: any) {
          console.warn(`创建文件夹 "${folderPath}" 失败:`, e?.response?.data?.error?.message);
        }
      }

      let uploadedCount = 0;
      let failedCount = 0;

      for (const { file, relativePath } of filesWithPaths) {
        const parts = relativePath.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        const parentId = parentPath
          ? (folderIdMap.get(parentPath) ?? currentFolderId ?? null)
          : (currentFolderId ?? null);

        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        onFileStart?.(file.name, key);

        try {
          await presignUpload({
            file,
            parentId,
            onProgress: (progress) => onFileProgress?.(key, progress),
          });
          uploadedCount++;
          onFileDone?.(key);
          queryClient.invalidateQueries({ queryKey: ['files'] });
        } catch (e: any) {
          failedCount++;
          onFileError?.(key, e);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      onAllDone?.({ uploaded: uploadedCount, failed: failedCount });
    },
    [currentFolderId, queryClient, onFileStart, onFileProgress, onFileDone, onFileError, onAllDone]
  );

  const uploadFolderEntriesDirect = useCallback(
    async (rootEntries: FileSystemEntry[]) => {
      const folderPaths = new Set<string>();
      const files: { file: File; relativePath: string }[] = [];

      const traverseEntry = (entry: FileSystemEntry, parentPath: string): Promise<void> => {
        const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

        if (entry.isFile) {
          return new Promise<void>((resolve) => {
            (entry as FileSystemFileEntry).file((f) => {
              files.push({ file: f, relativePath: fullPath });
              resolve();
            });
          });
        }

        if (entry.isDirectory) {
          folderPaths.add(fullPath);

          const dirReader = (entry as FileSystemDirectoryEntry).createReader();

          const readBatch = (): Promise<void> =>
            new Promise<void>((resolve, reject) => {
              dirReader.readEntries((entries) => {
                if (entries.length === 0) {
                  resolve();
                  return;
                }
                entries
                  .reduce((chain, e) => chain.then(() => traverseEntry(e, fullPath)), Promise.resolve())
                  .then(() => readBatch())
                  .then(resolve)
                  .catch(reject);
              }, reject);
            });

          return readBatch();
        }

        return Promise.resolve();
      };

      for (const entry of rootEntries) {
        await traverseEntry(entry, '');
      }

      if (files.length === 0 && folderPaths.size === 0) return;

      const sortedFolderPaths = [...folderPaths].sort((a, b) => a.split('/').length - b.split('/').length);

      const folderIdMap = new Map<string, string>();

      for (const folderPath of sortedFolderPaths) {
        const parts = folderPath.split('/');
        const name = parts[parts.length - 1];
        if (!name) continue;

        const parentPath = parts.slice(0, -1).join('/');
        const parentId = parentPath
          ? (folderIdMap.get(parentPath) ?? currentFolderId ?? null)
          : (currentFolderId ?? null);

        try {
          const res = await filesApi.createFolder(name, parentId);
          const createdId = res.data.data?.id;
          if (createdId) {
            folderIdMap.set(folderPath, createdId);
            queryClient.invalidateQueries({ queryKey: ['files'] });
          }
        } catch (e: any) {
          console.warn(`创建文件夹 "${folderPath}" 失败:`, e?.response?.data?.error?.message);
        }
      }

      for (const { file, relativePath } of files) {
        const parts = relativePath.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        const parentId = parentPath
          ? (folderIdMap.get(parentPath) ?? currentFolderId ?? null)
          : (currentFolderId ?? null);

        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        onFileStart?.(file.name, key);

        try {
          await presignUpload({
            file,
            parentId,
            onProgress: (progress) => onFileProgress?.(key, progress),
          });
          onFileDone?.(key);
          queryClient.invalidateQueries({ queryKey: ['files'] });
        } catch (e) {
          onFileError?.(key, e);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['files'] });
      onAllDone?.();
    },
    [currentFolderId, queryClient, onFileStart, onFileProgress, onFileDone, onFileError, onAllDone]
  );

  return { uploadFolderEntriesDirect, uploadFilesWithRelativePath };
}
