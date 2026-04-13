/**
 * useFileMutations.ts
 * 文件相关 mutations Hook — Phase 6 更新
 *
 * 更新：
 * - Telegram 文件大小限制从 50MB 提升到 500MB（分片支持）
 * - shareMutation 支持文件夹分享
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi, shareApi, batchApi, type StorageBucket } from '@/services/api';
import { useToast } from '@/components/ui/useToast';
import { useFileStore } from '@/stores/files';
import { getErrorMessage } from '@/utils';

// 与后端 TG_MAX_CHUNKED_FILE_SIZE 保持一致（500MB）
const TG_MAX_FILE_SIZE = 500 * 1024 * 1024;

interface MoveMutationParams {
  id: string;
  targetParentId: string | null;
}
interface RenameMutationParams {
  id: string;
  name: string;
}
interface ShareMutationParams {
  fileId: string;
  password?: string;
  expiresAt?: string;
  downloadLimit?: number;
}
interface BatchMoveParams {
  fileIds: string[];
  targetParentId: string | null;
}

interface CreateFileParams {
  name: string;
  content?: string;
  parentId?: string | null;
  bucketId?: string | null;
  mimeType?: string;
}

export function useFileMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { clearSelection } = useFileStore();

  const createFolderMutation = useMutation({
    mutationFn: ({ name, parentId, bucketId }: { name: string; parentId: string | null; bucketId: string | null }) =>
      filesApi.createFolder(name, parentId, !parentId ? bucketId : null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast({ title: '创建成功' });
    },
    onError: (e) => toast({ title: '创建失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  const createFileMutation = useMutation({
    mutationFn: (params: CreateFileParams) => filesApi.createFile(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast({ title: '文件创建成功' });
    },
    onError: (e) => toast({ title: '文件创建失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => filesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      clearSelection();
      toast({ title: '已移入回收站' });
    },
    onError: (e) => toast({ title: '删除失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: RenameMutationParams) => filesApi.update(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({ title: '重命名成功' });
    },
    onError: (e) => toast({ title: '重命名失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, targetParentId }: MoveMutationParams) => filesApi.move(id, targetParentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({ title: '移动成功' });
    },
    onError: (e) => toast({ title: '移动失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  const shareMutation = useMutation({
    mutationFn: ({ fileId, password, expiresAt, downloadLimit }: ShareMutationParams) =>
      shareApi.create({ fileId, password, expiresAt, downloadLimit }),
    onSuccess: (res) => {
      const shareId = res.data.data?.id;
      if (shareId) {
        const url = `${window.location.origin}/share/${shareId}`;
        navigator.clipboard.writeText(url).then(() => toast({ title: '分享链接已复制', description: url }));
      }
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    },
    onError: (e) => toast({ title: '创建分享失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (fileIds: string[]) => batchApi.delete(fileIds),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      clearSelection();
      const data = res.data.data;
      toast({ title: '批量删除完成', description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个` });
    },
    onError: (e) => toast({ title: '批量删除失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  const batchMoveMutation = useMutation({
    mutationFn: ({ fileIds, targetParentId }: BatchMoveParams) => batchApi.move(fileIds, targetParentId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      const data = res.data.data;
      toast({ title: '批量移动完成', description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个` });
    },
    onError: (e) => toast({ title: '批量移动失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  const batchZipMutation = useMutation({
    mutationFn: ({ fileIds, zipName }: { fileIds: string[]; zipName?: string }) => batchApi.zip(fileIds, zipName),
    onSuccess: () => {
      clearSelection();
      toast({ title: '批量下载成功', description: 'ZIP文件已开始下载' });
    },
    onError: (e) => toast({ title: '批量下载失败', description: getErrorMessage(e), variant: 'destructive' }),
  });

  /** 检查 Telegram 存储桶文件大小限制（500MB，分片上传）*/
  function checkTelegramLimit(file: File, bucket: StorageBucket | null): string | null {
    if (bucket?.provider === 'telegram' && file.size > TG_MAX_FILE_SIZE) {
      return `「${file.name}」超出 Telegram 存储桶 500MB 上限（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB）`;
    }
    return null;
  }

  return {
    createFolderMutation,
    createFileMutation,
    deleteMutation,
    renameMutation,
    moveMutation,
    shareMutation,
    batchDeleteMutation,
    batchMoveMutation,
    batchZipMutation,
    checkTelegramLimit,
  };
}
