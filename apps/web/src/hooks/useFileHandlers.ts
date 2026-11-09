/**
 * useFileHandlers.ts
 * 接收系统「用本应用打开文件」交付的本地文件（manifest.json 的 file_handlers）。
 *
 * Chrome / Edge 通过 window.launchQueue 把文件句柄交给应用；
 * 不支持该 API 的浏览器直接跳过，不产生任何副作用。
 */

import { useEffect } from 'react';

interface LaunchParams {
  files?: FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void;
}

export function useFileHandlers(onFiles: (files: File[]) => void) {
  useEffect(() => {
    const launchQueue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    if (!launchQueue || typeof launchQueue.setConsumer !== 'function') return;

    launchQueue.setConsumer(async (params) => {
      const handles = params.files ?? [];
      if (handles.length === 0) return;

      const files = (
        await Promise.all(
          handles.map(async (handle) => {
            try {
              return await handle.getFile();
            } catch {
              return null;
            }
          })
        )
      ).filter((file): file is File => file !== null);

      if (files.length > 0) onFiles(files);
    });
  }, [onFiles]);
}
