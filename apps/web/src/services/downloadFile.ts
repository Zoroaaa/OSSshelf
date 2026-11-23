/**
 * downloadFile.ts
 * 统一的文件下载入口（Files 页与团队空间共用，避免两处实现漂移）。
 *
 * 策略：
 * - 预签名直链：交给浏览器原生流式下载，页面内存不随文件大小增长；
 * - 代理下载：必须带 Authorization 头（token 不进 URL），只能 fetch → Blob；
 *   超过 LARGE_FILE_BYTES 时在 fetch 前就拒绝并给出明确提示，避免大文件撑爆页面内存。
 */
import { getPresignedDownloadUrl } from '@/services/presignUpload';
import { useAuthStore } from '@/stores/auth';

/** 代理下载走 Blob 的体积上限（超过则提示改用直链/桌面客户端）。 */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;

export class DownloadTooLargeError extends Error {
  constructor(public readonly size: number) {
    super('文件较大，当前存储不支持直链下载，请使用 WebDAV 或桌面客户端下载');
    this.name = 'DownloadTooLargeError';
  }
}

function clickAnchor(href: string, name: string, extra?: (a: HTMLAnchorElement) => void) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  extra?.(a);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadFile(file: { id: string; name: string; size?: number | null }): Promise<void> {
  const result = await getPresignedDownloadUrl(file.id);
  const name = result.fileName || file.name;

  if (!result.useProxy) {
    clickAnchor(result.url, name, (a) => {
      a.rel = 'noopener';
    });
    return;
  }

  if ((file.size ?? 0) > LARGE_FILE_BYTES) {
    throw new DownloadTooLargeError(file.size ?? 0);
  }

  const token = useAuthStore.getState().token;
  const resp = await fetch(result.url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!resp.ok) throw new Error('download failed');
  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  clickAnchor(blobUrl, name);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}
