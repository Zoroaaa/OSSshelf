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
      // 收集所有文件和文件夹，保留完整的相对路径
      // folderPaths: 所有需要创建的文件夹路径（含根文件夹、空文件夹）
      // files: 所有文件及其在目录树中的相对路径
      const folderPaths = new Set<string>();
      const files: { file: File; relativePath: string }[] = [];

      /**
       * 递归遍历 FileSystemEntry。
       * parentPath 是「当前 entry 的父路径」，不含 entry 自身名字。
       * 对目录：先把自己的完整路径记入 folderPaths，再递归子项。
       * 对文件：把完整路径记入 files。
       *
       * 注意：readEntries 的回调不能是 async，否则内部 await 不会被等待。
       * 用 Promise 链 + 递归 readAll 解决批量读取问题。
       */
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
          // 先注册自己（含根文件夹、空文件夹）
          folderPaths.add(fullPath);

          const dirReader = (entry as FileSystemDirectoryEntry).createReader();

          // readEntries 每次最多返回 100 条，需循环直到返回空数组
          const readBatch = (): Promise<void> =>
            new Promise<void>((resolve, reject) => {
              dirReader.readEntries(
                (entries) => {
                  if (entries.length === 0) {
                    resolve();
                    return;
                  }
                  // 串行处理本批次，再读下一批
                  entries
                    .reduce(
                      (chain, e) => chain.then(() => traverseEntry(e, fullPath)),
                      Promise.resolve()
                    )
                    .then(() => readBatch())
                    .then(resolve)
                    .catch(reject);
                },
                reject
              );
            });

          return readBatch();
        }

        return Promise.resolve();
      };

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || item.kind !== 'file') continue;
        const entry = item.webkitGetAsEntry?.();
        if (!entry) continue;
        await traverseEntry(entry, '');
      }

      if (files.length === 0 && folderPaths.size === 0) return;

      // 按深度从浅到深排序，保证父文件夹先于子文件夹创建
      const sortedFolderPaths = [...folderPaths].sort((a, b) => {
        return a.split('/').length - b.split('/').length;
      });

      // folderPath -> 服务端生成的文件夹 ID
      const folderIdMap = new Map<string, string>();

      // 依次创建文件夹
      for (const folderPath of sortedFolderPaths) {
        const parts = folderPath.split('/');
        const name = parts[parts.length - 1];
        if (!name) continue;

        const parentPath = parts.slice(0, -1).join('/');
        // 父路径为空 → 父级是当前页面目录（currentFolderId）
        const parentId = parentPath
          ? (folderIdMap.get(parentPath) ?? currentFolderId ?? null)
          : (currentFolderId ?? null);

        try {
          const res = await filesApi.createFolder(name, parentId);
          const createdId = res.data.data?.id;
          if (createdId) {
            folderIdMap.set(folderPath, createdId);
            // 文件夹创建后立即刷新父级目录
            queryClient.invalidateQueries({ queryKey: ['files', parentId ?? undefined] });
          }
        } catch (e: any) {
          console.warn(`Could not create folder "${folderPath}":`, e?.response?.data?.error?.message);
        }
      }

      // 上传文件到各自所属的文件夹
      for (const { file, relativePath } of files) {
        const parts = relativePath.split('/');
        const parentPath = parts.slice(0, -1).join('/');
        const parentId = parentPath
          ? (folderIdMap.get(parentPath) ?? currentFolderId ?? null)
          : (currentFolderId ?? null);

        const key = `${file.name}-${Date.now()}-${Math.random()}`;
        onFileStart?.(file.name, key);

        try {
          await presignUpload({
            file,
            parentId,
            onProgress: (progress) => onFileProgress?.(key, progress),
          });
          onFileDone?.(key);
          // 上传完后刷新该文件所在目录
          queryClient.invalidateQueries({ queryKey: ['files', parentId ?? undefined] });
        } catch (e) {
          onFileError?.(key, e);
        }
      }

      // 全部完成后刷新所有 files 查询
      queryClient.invalidateQueries({ queryKey: ['files'] });
      onAllDone?.();
    },
    [currentFolderId, queryClient, onFileStart, onFileProgress, onFileDone, onFileError, onAllDone]
  );

  return { uploadFolderEntries };
}
