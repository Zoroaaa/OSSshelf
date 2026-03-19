/**
 * useFileMutations.ts
 * 文件相关 mutations Hook
 *
 * 功能:
 * - 文件夹创建
 * - 文件上传
 * - 文件删除
 * - 文件重命名
 * - 文件移动
 * - 文件分享
 * - 批量操作
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { filesApi, shareApi, batchApi, type StorageBucket } from '@/services/api';
import { uploadManager } from '@/services/uploadManager';
import { useToast } from '@/components/ui/use-toast';
import { useFileStore } from '@/stores/files';

const TG_MAX_FILE_SIZE = 50 * 1024 * 1024;

interface UploadMutationParams {
  file: File;
  parentId: string | null;
  key: string;
}

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

export function useFileMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { clearSelection, clearClipboard } = useFileStore();

  const createFolderMutation = useMutation({
    mutationFn: ({ name, parentId, bucketId }: { name: string; parentId: string | null; bucketId: string | null }) =>
      filesApi.createFolder(name, parentId, !parentId ? bucketId : null),
    onSuccess: (_, { parentId }) => {
      queryClient.invalidateQueries({ queryKey: ['files', parentId] });
      toast({ title: '创建成功' });
    },
    onError: (e: any) =>
      toast({ title: '创建失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ file, parentId }: Omit<UploadMutationParams, 'key'>) => {
      return uploadManager.startUpload(file, parentId, null, () => {});
    },
    onSuccess: (_, { parentId }) => {
      queryClient.invalidateQueries({ queryKey: ['files', parentId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast({ title: '上传成功' });
    },
    onError: (e: any) => {
      toast({
        title: '上传失败',
        description: e?.message || e?.response?.data?.error?.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => filesApi.delete(id),
    onSuccess: (_, id, context: any) => {
      const parentId = context?.parentId;
      queryClient.invalidateQueries({ queryKey: ['files', parentId] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      clearSelection();
      toast({ title: '已移入回收站' });
    },
    onError: (e: any) =>
      toast({ title: '删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id: _id, name }: RenameMutationParams) => filesApi.update(_id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({ title: '重命名成功' });
    },
    onError: (e: any) =>
      toast({ title: '重命名失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, targetParentId }: MoveMutationParams) => filesApi.move(id, targetParentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({ title: '移动成功' });
    },
    onError: (e: any) =>
      toast({ title: '移动失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
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
    onError: (e: any) =>
      toast({ title: '创建分享失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (fileIds: string[]) => batchApi.delete(fileIds),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      clearSelection();
      const data = res.data.data;
      toast({
        title: '批量删除完成',
        description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个`,
      });
    },
    onError: (e: any) =>
      toast({ title: '批量删除失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const batchMoveMutation = useMutation({
    mutationFn: ({ fileIds, targetParentId }: BatchMoveParams) => batchApi.move(fileIds, targetParentId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      clearClipboard();
      const data = res.data.data;
      toast({
        title: '批量移动完成',
        description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个`,
      });
    },
    onError: (e: any) =>
      toast({ title: '批量移动失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  const batchCopyMutation = useMutation({
    mutationFn: ({ fileIds, targetParentId }: BatchMoveParams) => batchApi.copy(fileIds, targetParentId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      clearClipboard();
      const data = res.data.data;
      toast({
        title: '批量复制完成',
        description: `成功 ${data?.success || 0} 个，失败 ${data?.failed || 0} 个`,
      });
    },
    onError: (e: any) =>
      toast({ title: '批量复制失败', description: e.response?.data?.error?.message, variant: 'destructive' }),
  });

  function checkTelegramLimit(file: File, bucket: StorageBucket | null): string | null {
    if (bucket?.provider === 'telegram' && file.size > TG_MAX_FILE_SIZE) {
      return `「${file.name}」超出 Telegram 存储桶 50MB 单文件限制（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB）`;
    }
    return null;
  }

  return {
    createFolderMutation,
    uploadMutation,
    deleteMutation,
    renameMutation,
    moveMutation,
    shareMutation,
    batchDeleteMutation,
    batchMoveMutation,
    batchCopyMutation,
    checkTelegramLimit,
  };
}
