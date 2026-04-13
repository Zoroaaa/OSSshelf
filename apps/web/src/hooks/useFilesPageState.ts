/**
 * useFilesPageState.ts
 * 文件页面状态管理 Hook
 *
 * 功能:
 * - 管理对话框显示状态
 * - 管理预览、重命名、移动等状态
 * - 管理上传进度
 */

import { useState, useCallback, useRef } from 'react';
import type { FileItem } from '@osshelf/shared';
import type { UploadProgress } from '@/types/files';

export function useFilesPageState() {
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderBucketId, setNewFolderBucketId] = useState<string | null>(null);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [newFileExtension, setNewFileExtension] = useState('.txt');
  const [newFileParentId, setNewFileParentId] = useState<string | null>(null);
  const [uploadProgresses, setUploadProgresses] = useState<UploadProgress>({});
  const [shareFileId, setShareFileId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);
  const [tagsFile, setTagsFile] = useState<FileItem | null>(null);
  const [permissionFile, setPermissionFile] = useState<FileItem | null>(null);
  const [folderSettingsFile, setFolderSettingsFile] = useState<FileItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const resetNewFolderDialog = useCallback(() => {
    setShowNewFolderDialog(false);
    setNewFolderName('');
    setNewFolderBucketId(null);
  }, []);

  const resetNewFileDialog = useCallback(() => {
    setShowNewFileDialog(false);
    setNewFileName('');
    setNewFileContent('');
    setNewFileExtension('.txt');
    setNewFileParentId(null);
  }, []);

  const resetShareDialog = useCallback(() => {
    setShareFileId(null);
  }, []);

  const openNewFolderDialog = useCallback(() => {
    setShowNewFolderDialog(true);
  }, []);

  const openNewFileDialog = useCallback(() => {
    setShowNewFileDialog(true);
  }, []);

  const openShareDialog = useCallback((fileId: string) => {
    setShareFileId(fileId);
  }, []);

  return {
    showNewFolderDialog,
    setShowNewFolderDialog,
    newFolderName,
    setNewFolderName,
    newFolderBucketId,
    setNewFolderBucketId,
    showNewFileDialog,
    setShowNewFileDialog,
    newFileName,
    setNewFileName,
    newFileContent,
    setNewFileContent,
    newFileExtension,
    setNewFileExtension,
    newFileParentId,
    setNewFileParentId,
    uploadProgresses,
    setUploadProgresses,
    shareFileId,
    setShareFileId,
    previewFile,
    setPreviewFile,
    renameFile,
    setRenameFile,
    moveFile,
    setMoveFile,
    tagsFile,
    setTagsFile,
    permissionFile,
    setPermissionFile,
    folderSettingsFile,
    setFolderSettingsFile,
    fileInputRef,
    folderInputRef,
    searchInputRef,
    resetNewFolderDialog,
    resetNewFileDialog,
    resetShareDialog,
    openNewFolderDialog,
    openNewFileDialog,
    openShareDialog,
  };
}
