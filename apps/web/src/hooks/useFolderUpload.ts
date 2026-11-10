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
import { getErrorMessage, runWithConcurrency } from '@/utils';
import { useQueryClient } from '@tanstack/react-query';
import type { FileItem } from '@osshelf/shared';

/** 同时进行的上传数量上限，避免多文件整读内存导致 OOM */
const UPLOAD_CONCURRENCY = 3;

interface UseFolderUploadOptions {
  currentFolderId?: string;
  /** 目标存储桶 ID：非默认桶目录下必须传入，否则会落到默认桶 */
  bucketId?: string | null;
  /** 团队 ID：在团队工作区上传时传入 */
  teamId?: string | null;
  onFileStart?: (name: string, key: string) => void;
  onFileProgress?: (key: string, progress: number) => void;
  onFileDone?: (key: string) => void;
  onFileError?: (key: string, error: any) => void;
  onAllDone?: (stats?: { uploaded: number; failed: number }) => void;
}

export function useFolderUpload({
  currentFolderId,
  bucketId,
  teamId,
  onFileStart,
  onFileProgress,
  onFileDone,
  onFileError,
  onAllDone,
}: UseFolderUploadOptions) {
  const queryClient = useQueryClient();

  /**
   * 确保目录存在并返回其 id。
   * 同名目录已存在时 createFolder 会失败，此时必须复用已有目录的 id；
   * 否则调用方拿不到 parentId 会把文件放到上一级，造成层级错位。
   */
  const ensureFolder = useCallback(
    async (name: string, parentId: string | null): Promise<string | null> => {
      try {
        const res = await filesApi.createFolder(name, parentId, bucketId);
        const createdId = res.data.data?.id;
        if (createdId) return createdId;
      } catch (e) {
        console.warn(`创建文件夹 "${name}" 失败，尝试复用同名目录:`, getErrorMessage(e));
      }

      try {
        const res = await filesApi.list({
          parentId,
          search: name,
          isFolder: true,
          limit: 100,
          sortBy: 'name',
          sortOrder: 'asc',
        });
        const list = (res.data.data ?? []) as FileItem[];
        return list.find((f) => f.isFolder && f.name === name)?.id ?? null;
      } catch {
        return null;
      }
    },
    [bucketId]
  );

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
        const parentId = parentPath ? (folderIdMap.get(parentPath) ?? null) : (currentFolderId ?? null);
        // 上级目录未能创建/解析时，不能把当前目录建到根下，直接跳过；
        // 其下文件会在上传阶段因缺少 parentId 被记为失败。
        if (parentPath && !parentId) continue;

        const folderId = await ensureFolder(name, parentId);
        if (folderId) folderIdMap.set(folderPath, folderId);
      }

      let uploadedCount = 0;
      let failedCount = 0;

      await runWithConcurrency(filesWithPaths, UPLOAD_CONCURRENCY, async ({ file, relativePath }) => {
        const parts = relativePath.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        // 只有顶层文件允许落到当前目录；嵌套文件必须解析到对应子目录，
        // 解析失败就跳过，绝不回退到当前目录造成层级错位。
        const parentId = parentPath ? (folderIdMap.get(parentPath) ?? null) : (currentFolderId ?? null);

        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        onFileStart?.(file.name, key);

        if (parentPath && !parentId) {
          failedCount++;
          onFileError?.(key, new Error(`目标文件夹「${parentPath}」创建失败，已跳过该文件`));
          return;
        }

        try {
          await presignUpload({
            file,
            parentId,
            bucketId,
            teamId,
            onProgress: (progress) => onFileProgress?.(key, progress),
          });
          uploadedCount++;
          onFileDone?.(key);
        } catch (e: any) {
          failedCount++;
          onFileError?.(key, e);
        }
      });

      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      onAllDone?.({ uploaded: uploadedCount, failed: failedCount });
    },
    [
      currentFolderId,
      ensureFolder,
      bucketId,
      teamId,
      queryClient,
      onFileStart,
      onFileProgress,
      onFileDone,
      onFileError,
      onAllDone,
    ]
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
        const parentId = parentPath ? (folderIdMap.get(parentPath) ?? null) : (currentFolderId ?? null);
        if (parentPath && !parentId) continue;

        const folderId = await ensureFolder(name, parentId);
        if (folderId) folderIdMap.set(folderPath, folderId);
      }

      await runWithConcurrency(files, UPLOAD_CONCURRENCY, async ({ file, relativePath }) => {
        const parts = relativePath.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        const parentId = parentPath ? (folderIdMap.get(parentPath) ?? null) : (currentFolderId ?? null);

        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        onFileStart?.(file.name, key);

        if (parentPath && !parentId) {
          onFileError?.(key, new Error(`目标文件夹「${parentPath}」创建失败，已跳过该文件`));
          return;
        }

        try {
          await presignUpload({
            file,
            parentId,
            bucketId,
            teamId,
            onProgress: (progress) => onFileProgress?.(key, progress),
          });
          onFileDone?.(key);
        } catch (e) {
          onFileError?.(key, e);
        }
      });

      queryClient.invalidateQueries({ queryKey: ['files'] });
      onAllDone?.();
    },
    [
      currentFolderId,
      ensureFolder,
      bucketId,
      teamId,
      queryClient,
      onFileStart,
      onFileProgress,
      onFileDone,
      onFileError,
      onAllDone,
    ]
  );

  return { uploadFolderEntriesDirect, uploadFilesWithRelativePath };
}
