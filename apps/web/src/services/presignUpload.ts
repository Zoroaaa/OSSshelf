/**
 * presignUpload.ts — Direct-to-S3 upload service (Phase 5 P1)
 *
 * Strategy
 * ────────
 * 1. For files ≤ MULTIPART_THRESHOLD (100 MB):
 *    a. POST /api/presign/upload  → get a presigned PUT URL
 *    b. PUT directly to the S3 URL with XHR (for progress tracking)
 *    c. POST /api/presign/confirm → write DB record
 *    d. If step (a) returns { useProxy: true }, fall back to legacy /api/files/upload
 *
 * 2. For files > MULTIPART_THRESHOLD:
 *    a. POST /api/presign/multipart/init   → { uploadId, fileId, r2Key, firstPartUrl }
 *    b. For each PART_SIZE chunk:
 *         POST /api/presign/multipart/part → { partUrl }
 *         PUT chunk to partUrl
 *    c. POST /api/presign/multipart/complete → finalize
 *    d. On any error: POST /api/presign/multipart/abort (best-effort)
 *
 * The caller always gets the same `FileItem`-shaped object back regardless
 * of which path was taken.
 */

import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

/** Files larger than this use multipart upload (100 MB) */
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

/** Each multipart part is this size (10 MB — S3 minimum is 5 MB for non-last parts) */
export const PART_SIZE = 10 * 1024 * 1024;

/** Max concurrent part uploads */
const MAX_CONCURRENT_PARTS = 3;

// ── Typed API response helpers ─────────────────────────────────────────────

interface PresignUploadResponse {
  useProxy?: boolean;
  uploadUrl?: string;
  fileId?: string;
  r2Key?: string;
  bucketId?: string;
  expiresIn?: number;
}

interface PresignMultipartInitResponse {
  useProxy?: boolean;
  uploadId?: string;
  fileId?: string;
  r2Key?: string;
  bucketId?: string;
  firstPartUrl?: string;
}

interface PresignPartResponse {
  partUrl: string;
  partNumber: number;
}

// ── Auth header helper ─────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiPost<T>(path: string, data: unknown): Promise<T> {
  const res = await axios.post<{ success: boolean; data: T; error?: { message: string } }>(
    `${API_BASE}${path}`,
    data,
    { headers: authHeaders() },
  );
  if (!res.data.success) {
    throw new Error(res.data.error?.message || `API error at ${path}`);
  }
  return res.data.data;
}

// ── Main export ────────────────────────────────────────────────────────────

export interface PresignUploadOptions {
  file: File;
  parentId?: string | null;
  bucketId?: string | null;
  /** Called with 0–100 as the upload progresses */
  onProgress?: (percent: number) => void;
  /** Called if we fall back to the legacy proxy upload */
  onFallback?: () => void;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  path: string;
  bucketId: string | null;
  createdAt: string;
}

/**
 * Upload a file using presigned URLs (with multipart for large files).
 * Falls back to proxy upload if no S3 bucket is configured.
 */
export async function presignUpload({
  file,
  parentId = null,
  bucketId = null,
  onProgress,
  onFallback,
}: PresignUploadOptions): Promise<UploadedFile> {
  if (file.size > MULTIPART_THRESHOLD) {
    return multipartUpload({ file, parentId, bucketId, onProgress, onFallback });
  }
  return singlePresignUpload({ file, parentId, bucketId, onProgress, onFallback });
}

// ── Single presigned PUT upload ────────────────────────────────────────────

async function singlePresignUpload({
  file, parentId, bucketId, onProgress, onFallback,
}: PresignUploadOptions): Promise<UploadedFile> {
  // Step 1: Request presigned URL
  const presign = await apiPost<PresignUploadResponse>('/api/presign/upload', {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    parentId,
    bucketId,
  });

  // Fallback to proxy
  if (presign.useProxy) {
    onFallback?.();
    return proxyUpload({ file, parentId, bucketId, onProgress });
  }

  const { uploadUrl, fileId, r2Key, bucketId: resolvedBucketId } = presign;
  if (!uploadUrl || !fileId || !r2Key) {
    throw new Error('预签名上传：服务器返回了无效的响应');
  }

  // Step 2: Upload directly to S3
  await directPut(uploadUrl, file, file.type || 'application/octet-stream', onProgress);

  // Step 3: Confirm — write DB record
  const result = await apiPost<UploadedFile>('/api/presign/confirm', {
    fileId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    parentId,
    r2Key,
    bucketId: resolvedBucketId ?? null,
  });

  return result;
}

// ── Multipart upload ───────────────────────────────────────────────────────

let corsErrorDetected = false;

function isCorsError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('cors') || 
           msg.includes('network error') || 
           msg.includes('failed to fetch') ||
           msg.includes('网络错误');
  }
  return false;
}

async function multipartUpload({
  file, parentId, bucketId, onProgress, onFallback,
}: PresignUploadOptions): Promise<UploadedFile> {
  // Step 1: Init
  const init = await apiPost<PresignMultipartInitResponse>('/api/presign/multipart/init', {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    parentId,
    bucketId,
  });

  if (init.useProxy) {
    onFallback?.();
    return proxyUpload({ file, parentId, bucketId, onProgress });
  }

  const { uploadId, fileId, r2Key, bucketId: resolvedBucketId, firstPartUrl } = init;
  if (!uploadId || !fileId || !r2Key) {
    throw new Error('分片上传初始化：服务器返回了无效的响应');
  }

  const totalParts = Math.ceil(file.size / PART_SIZE);
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let uploadedBytes = 0;
  let useProxyMode = corsErrorDetected;

  // Abort helper (best-effort)
  const abort = async () => {
    try {
      await apiPost('/api/presign/multipart/abort', { r2Key, uploadId, bucketId: resolvedBucketId });
    } catch { /* ignore */ }
  };

  try {
    // Upload parts in batches of MAX_CONCURRENT_PARTS
    for (let batch = 0; batch < totalParts; batch += MAX_CONCURRENT_PARTS) {
      const batchParts = Array.from(
        { length: Math.min(MAX_CONCURRENT_PARTS, totalParts - batch) },
        (_, i) => batch + i + 1,
      );

      const batchResults = await Promise.all(
        batchParts.map(async (partNumber) => {
          const start = (partNumber - 1) * PART_SIZE;
          const end = Math.min(start + PART_SIZE, file.size);
          const chunk = file.slice(start, end);

          let etag: string;

          if (useProxyMode) {
            // 使用代理上传模式
            etag = await proxyUploadPart(r2Key, uploadId, partNumber, chunk, resolvedBucketId);
          } else {
            // 尝试直接上传
            let partUrl: string;
            if (partNumber === 1 && firstPartUrl) {
              partUrl = firstPartUrl;
            } else {
              const partData = await apiPost<PresignPartResponse>('/api/presign/multipart/part', {
                r2Key,
                uploadId,
                partNumber,
                bucketId: resolvedBucketId,
              });
              partUrl = partData.partUrl;
            }

            try {
              etag = await uploadPart(partUrl, chunk, (partBytes) => {
                uploadedBytes += partBytes;
                onProgress?.(Math.round((uploadedBytes / file.size) * 100));
              });
            } catch (error) {
              // 检测 CORS 错误，切换到代理模式
              if (isCorsError(error) && !useProxyMode) {
                console.warn('检测到 CORS 错误，切换到代理上传模式');
                corsErrorDetected = true;
                useProxyMode = true;
                etag = await proxyUploadPart(r2Key, uploadId, partNumber, chunk, resolvedBucketId);
              } else {
                throw error;
              }
            }
          }

          return { partNumber, etag };
        }),
      );

      parts.push(...batchResults);
      onProgress?.(Math.round(((batch + batchParts.length) / totalParts) * 100));
    }

    // Step 3: Complete
    const result = await apiPost<UploadedFile>('/api/presign/multipart/complete', {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      parentId,
      r2Key,
      uploadId,
      bucketId: resolvedBucketId ?? null,
      parts,
    });

    return result;
  } catch (err) {
    await abort();
    throw err;
  }
}

// ── Proxy upload part (for CORS-restricted storage) ─────────────────────────

async function proxyUploadPart(
  r2Key: string,
  uploadId: string,
  partNumber: number,
  chunk: Blob,
  bucketId: string | undefined,
): Promise<string> {
  const formData = new FormData();
  formData.append('r2Key', r2Key);
  formData.append('uploadId', uploadId);
  formData.append('partNumber', String(partNumber));
  formData.append('chunk', chunk);
  if (bucketId) formData.append('bucketId', bucketId);

  const res = await axios.post<{ success: boolean; data: { partNumber: number; etag: string }; error?: { message: string } }>(
    `${API_BASE}/api/presign/multipart/part-proxy`,
    formData,
    { headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' } },
  );

  if (!res.data.success) {
    throw new Error(res.data.error?.message || '代理分片上传失败');
  }
  return res.data.data.etag;
}

// ── Low-level HTTP helpers ─────────────────────────────────────────────────

/**
 * PUT a body directly to a presigned URL using XHR (for progress).
 */
function directPut(
  url: string,
  body: Blob | ArrayBuffer,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`直传失败 (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
      }
    };

    xhr.onerror = () => reject(new Error('直传网络错误'));
    xhr.ontimeout = () => reject(new Error('直传请求超时'));
    xhr.timeout = 3600 * 1000; // 1 hour max per request

    xhr.send(body);
  });
}

/**
 * Upload a single multipart chunk. Returns the ETag from the response header.
 */
function uploadPart(
  url: string,
  chunk: Blob,
  onChunkProgress?: (bytes: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);

    let lastLoaded = 0;
    if (onChunkProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const delta = e.loaded - lastLoaded;
          lastLoaded = e.loaded;
          onChunkProgress(delta);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag') || '';
        resolve(etag.replace(/"/g, '')); // strip surrounding quotes
      } else {
        reject(new Error(`分片上传失败 (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('分片上传网络错误'));
    xhr.timeout = 3600 * 1000;
    xhr.ontimeout = () => reject(new Error('分片上传超时'));

    xhr.send(chunk);
  });
}

// ── Legacy proxy fallback ─────────────────────────────────────────────────

interface ProxyUploadOptions {
  file: File;
  parentId?: string | null;
  bucketId?: string | null;
  onProgress?: (percent: number) => void;
}

async function proxyUpload({ file, parentId, bucketId, onProgress }: ProxyUploadOptions): Promise<UploadedFile> {
  const formData = new FormData();
  formData.append('file', file);
  if (parentId) formData.append('parentId', parentId);
  if (bucketId) formData.append('bucketId', bucketId);

  const res = await axios.post<{ success: boolean; data: UploadedFile; error?: { message: string } }>(
    `${API_BASE}/api/files/upload`,
    formData,
    {
      headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    },
  );

  if (!res.data.success) {
    throw new Error(res.data.error?.message || '上传失败');
  }
  return res.data.data;
}

// ── Presigned download/preview URL helpers ─────────────────────────────────

export interface PresignDownloadResult {
  useProxy: boolean;
  url: string; // presigned URL or proxy URL
  fileName?: string;
  mimeType?: string | null;
}

export async function getPresignedDownloadUrl(fileId: string): Promise<PresignDownloadResult> {
  const data = await apiPost<{
    useProxy?: boolean;
    proxyUrl?: string;
    downloadUrl?: string;
    fileName?: string;
    mimeType?: string;
  }>(`/api/presign/download/${fileId}`, {}).catch(() => null);

  // Fall back gracefully
  if (!data || data.useProxy) {
    return { useProxy: true, url: `${API_BASE}/api/files/${fileId}/download` };
  }

  return {
    useProxy: false,
    url: data.downloadUrl!,
    fileName: data.fileName,
    mimeType: data.mimeType,
  };
}

// Presign for GET uses query-string auth so it's a GET endpoint on the API
export async function getPresignedPreviewUrl(fileId: string): Promise<PresignDownloadResult> {
  try {
    const token = useAuthStore.getState().token;
    const res = await axios.get<{ success: boolean; data: { useProxy?: boolean; proxyUrl?: string; previewUrl?: string; mimeType?: string } }>(
      `${API_BASE}/api/presign/preview/${fileId}`,
      { headers: authHeaders() },
    );
    if (res.data.success && res.data.data) {
      const d = res.data.data;
      if (d.useProxy) {
        return { useProxy: true, url: `${API_BASE}/api/files/${fileId}/preview?token=${token}` };
      }
      return { useProxy: false, url: d.previewUrl!, mimeType: d.mimeType };
    }
  } catch { /* fall through */ }

  const token = useAuthStore.getState().token;
  return { useProxy: true, url: `${API_BASE}/api/files/${fileId}/preview?token=${token}` };
}
