/**
 * files.ts
 * 文件状态管理 Store
 *
 * 功能:
 * - 视图模式管理
 * - 选择状态管理
 * - 排序设置
 * - 搜索状态
 * - 剪贴板操作
 * - 导航历史
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FileItem } from '@osshelf/shared';

export type ViewMode = 'list' | 'grid';
export type SortField = 'name' | 'size' | 'createdAt' | 'updatedAt' | 'mimeType';
export type SortOrder = 'asc' | 'desc';

interface NavigationHistory {
  folderId: string | null;
  timestamp: number;
}

interface FileState {
  currentFolderId: string | null;
  selectedFiles: string[];
  selectedFileItems: FileItem[];
  viewMode: ViewMode;
  sortBy: SortField;
  sortOrder: SortOrder;
  searchQuery: string;
  navigationHistory: NavigationHistory[];
  historyIndex: number;
  focusedFileId: string | null;
  isSelectAll: boolean;

  setCurrentFolder: (folderId: string | null) => void;
  setSelectedFiles: (fileIds: string[], fileItems?: FileItem[]) => void;
  toggleFileSelection: (fileId: string, fileItem?: FileItem) => void;
  selectRange: (startId: string, endId: string, files: FileItem[]) => void;
  clearSelection: () => void;
  selectAll: (files: FileItem[]) => void;
  setViewMode: (mode: ViewMode) => void;
  setSort: (sortBy: SortField, sortOrder: SortOrder) => void;
  setSearchQuery: (query: string) => void;
  goBack: () => string | null;
  goForward: () => string | null;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  setFocusedFile: (fileId: string | null) => void;
  getNextFileId: (files: FileItem[], direction: 'up' | 'down') => string | null;
}

export const useFileStore = create<FileState>()(
  persist(
    (set, get) => ({
      currentFolderId: null,
      selectedFiles: [],
      selectedFileItems: [],
      viewMode: 'list',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      searchQuery: '',
      navigationHistory: [],
      historyIndex: -1,
      focusedFileId: null,
      isSelectAll: false,

      setCurrentFolder: (folderId) => {
        const { navigationHistory, historyIndex, currentFolderId } = get();

        const newHistory = navigationHistory.slice(0, historyIndex + 1);
        if (currentFolderId !== folderId) {
          newHistory.push({ folderId: currentFolderId, timestamp: Date.now() });
        }

        set({
          currentFolderId: folderId,
          selectedFiles: [],
          selectedFileItems: [],
          isSelectAll: false,
          focusedFileId: null,
          navigationHistory: newHistory,
          historyIndex: newHistory.length - 1,
        });
      },

      setSelectedFiles: (fileIds, fileItems = []) => {
        set({
          selectedFiles: fileIds,
          selectedFileItems: fileItems,
          isSelectAll: false,
        });
      },

      toggleFileSelection: (fileId, fileItem) => {
        const { selectedFiles, selectedFileItems } = get();
        const isSelected = selectedFiles.includes(fileId);

        if (isSelected) {
          set({
            selectedFiles: selectedFiles.filter((id) => id !== fileId),
            selectedFileItems: selectedFileItems.filter((f) => f.id !== fileId),
            isSelectAll: false,
          });
        } else {
          set({
            selectedFiles: [...selectedFiles, fileId],
            selectedFileItems: fileItem ? [...selectedFileItems, fileItem] : selectedFileItems,
            isSelectAll: false,
          });
        }
      },

      selectRange: (startId, endId, files) => {
        const startIndex = files.findIndex((f) => f.id === startId);
        const endIndex = files.findIndex((f) => f.id === endId);

        if (startIndex === -1 || endIndex === -1) return;

        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);

        const selectedFiles = files.slice(minIndex, maxIndex + 1);

        set({
          selectedFiles: selectedFiles.map((f) => f.id),
          selectedFileItems: selectedFiles,
          isSelectAll: false,
        });
      },

      clearSelection: () => {
        set({
          selectedFiles: [],
          selectedFileItems: [],
          isSelectAll: false,
          focusedFileId: null,
        });
      },

      selectAll: (files) => {
        set({
          selectedFiles: files.map((f) => f.id),
          selectedFileItems: files,
          isSelectAll: true,
        });
      },

      setViewMode: (mode) => set({ viewMode: mode }),

      setSort: (sortBy, sortOrder) => set({ sortBy, sortOrder }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      goBack: () => {
        const { navigationHistory, historyIndex } = get();
        if (historyIndex <= 0) return null;

        const newIndex = historyIndex - 1;
        const targetFolderId = navigationHistory[newIndex]?.folderId ?? null;

        set({
          historyIndex: newIndex,
          currentFolderId: targetFolderId,
          selectedFiles: [],
          selectedFileItems: [],
        });

        return targetFolderId;
      },

      goForward: () => {
        const { navigationHistory, historyIndex } = get();
        if (historyIndex >= navigationHistory.length - 1) return null;

        const newIndex = historyIndex + 1;
        const targetFolderId = navigationHistory[newIndex]?.folderId ?? null;

        set({
          historyIndex: newIndex,
          currentFolderId: targetFolderId,
          selectedFiles: [],
          selectedFileItems: [],
        });

        return targetFolderId;
      },

      canGoBack: () => {
        const { historyIndex } = get();
        return historyIndex > 0;
      },

      canGoForward: () => {
        const { navigationHistory, historyIndex } = get();
        return historyIndex < navigationHistory.length - 1;
      },

      setFocusedFile: (fileId) => set({ focusedFileId: fileId }),

      getNextFileId: (files, direction) => {
        const { focusedFileId } = get();
        if (files.length === 0) return null;

        if (!focusedFileId) {
          return files[0]!.id;
        }

        const currentIndex = files.findIndex((f) => f.id === focusedFileId);
        if (currentIndex === -1) {
          return files[0]!.id;
        }

        const nextIndex =
          direction === 'up' ? Math.max(0, currentIndex - 1) : Math.min(files.length - 1, currentIndex + 1);

        const nextFile = files[nextIndex];
        return nextFile ? nextFile.id : null;
      },
    }),
    {
      name: 'osshelf-file-store',
      partialize: (state) => ({
        viewMode: state.viewMode,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
      }),
    }
  )
);
