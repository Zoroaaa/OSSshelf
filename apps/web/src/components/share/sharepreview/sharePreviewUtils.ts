/**
 * sharePreviewUtils.ts
 * 共享文件预览工具函数
 */

import { shareApi } from '@/services/api';

export function getSharePreviewUrl(
  shareId: string,
  fileId: string,
  password?: string,
  isChildFile?: boolean,
  isVideo?: boolean,
  isAudio?: boolean
): string {
  if (isChildFile) {
    if (isVideo || isAudio) {
      return shareApi.childStreamUrl(shareId, fileId, password);
    }
    return shareApi.childPreviewUrl(shareId, fileId, password);
  }
  if (isVideo || isAudio) {
    return shareApi.streamUrl(shareId, password);
  }
  return shareApi.previewUrl(shareId, password);
}

export async function fetchShareTextContent(
  shareId: string,
  fileId: string,
  password?: string,
  isChildFile?: boolean
): Promise<string | null> {
  try {
    const res = isChildFile
      ? await shareApi.getChildRawContent(shareId, fileId, password)
      : await shareApi.getRawContent(shareId, password);
    if (res.data.data?.content) {
      return res.data.data.content;
    }
    return null;
  } catch {
    return null;
  }
}
