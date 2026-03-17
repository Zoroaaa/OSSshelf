/**
 * presignUpload.ts
 * 预签名上传服务
 * 
 * 功能:
 * - 小文件直接上传（≤100MB）
 * - 大文件分片上传（>100MB）
 * - 上传进度跟踪
 * - 断点续传支持
 * - CORS代理回退
 * 
 * 上传策略:
 * 1. 小文件：获取预签名URL -> 直接PUT到S3 -> 确认上传
 * 2. 大文件：初始化分片 -> 逐片上传 -> 完成上传
 * 3. 若S3不支持CORS，自动回退到服务器代理模式
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
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
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
  signal,
}: PresignUploadOptions): Promise<UploadedFile> {
  if (file.size > MULTIPART_THRESHOLD) {
    return multipartUpload({ file, parentId, bucketId, onProgress, onFallback, signal });
  }
  return singlePresignUpload({ file, parentId, bucketId, onProgress, onFallback, signal });
}

// ── Single presigned PUT upload ────────────────────────────────────────────

async function singlePresignUpload({
  file, parentId, bucketId, onProgress, onFallback, signal,
}: PresignUploadOptions): Promise<UploadedFile> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const presign = await apiPost<PresignUploadResponse>('/api/presign/upload', {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    parentId,
    bucketId,
  });

  if (presign.useProxy) {
    onFallback?.();
    return proxyUpload({ file, parentId, bucketId, onProgress, signal });
  }

  const { uploadUrl, fileId, r2Key, bucketId: resolvedBucketId } = presign;
  if (!uploadUrl || !fileId || !r2Key) {
    throw new Error('预签名上传：服务器返回了无效的响应');
  }

  try {
    await directPut(uploadUrl, file, file.type || 'application/octet-stream', onProgress, signal);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
    if (isCorsError(error) && !corsErrorDetected) {
      console.warn('检测到 CORS 错误，切换到代理上传模式');
      corsErrorDetected = true;
      onFallback?.();
      return proxyUpload({ file, parentId, bucketId, onProgress, signal });
    }
    throw error;
  }

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
  file, parentId, bucketId, onProgress, onFallback, signal,
}: PresignUploadOptions): Promise<UploadedFile> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const totalParts = Math.ceil(file.size / PART_SIZE);
  
  // 使用 /api/tasks/create 创建任务记录，这样可以在任务页面追踪
  const init = await apiPost<PresignMultipartInitResponse & { taskId?: string }>('/api/tasks/create', {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    parentId,
    bucketId,
  });

  // 检查是否返回了 useProxy（兼容旧逻辑）
  if ('useProxy' in init && init.useProxy) {
    onFallback?.();
    return proxyUpload({ file, parentId, bucketId, onProgress, signal });
  }

  const { uploadId, fileId, r2Key, bucketId: resolvedBucketId, firstPartUrl, taskId } = init as any;
  if (!uploadId || !fileId || !r2Key) {
    throw new Error('分片上传初始化：服务器返回了无效的响应');
  }
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let uploadedBytes = 0;
  let useProxyMode = corsErrorDetected;

  // Abort helper (best-effort)
  const abort = async () => {
    try {
      if (taskId) {
        await apiPost('/api/tasks/abort', { taskId });
      } else {
        await apiPost('/api/presign/multipart/abort', { r2Key, uploadId, bucketId: resolvedBucketId });
      }
    } catch { /* ignore */ }
  };

  try {
    // Upload parts in batches of MAX_CONCURRENT_PARTS
    for (let batch = 0; batch < totalParts; batch += MAX_CONCURRENT_PARTS) {
      if (signal?.aborted) {
        await abort();
        throw new DOMException('Upload aborted', 'AbortError');
      }

      const batchParts = Array.from(
        { length: Math.min(MAX_CONCURRENT_PARTS, totalParts - batch) },
        (_, i) => batch + i + 1,
      );

      const batchResults = await Promise.all(
        batchParts.map(async (partNumber) => {
          if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

          const start = (partNumber - 1) * PART_SIZE;
          const end = Math.min(start + PART_SIZE, file.size);
          const chunk = file.slice(start, end);

          let etag: string;

          if (useProxyMode) {
            // 使用代理上传模式
            etag = await proxyUploadPartForTask(taskId, partNumber, chunk, signal);
          } else {
            // 尝试直接上传
            let partUrl: string;
            if (partNumber === 1 && firstPartUrl) {
              partUrl = firstPartUrl;
            } else {
              const partData = await apiPost<PresignPartResponse>('/api/tasks/part', {
                taskId,
                partNumber,
              });
              partUrl = partData.partUrl;
            }

            try {
              etag = await uploadPart(partUrl, chunk, (partBytes) => {
                uploadedBytes += partBytes;
                onProgress?.(Math.round((uploadedBytes / file.size) * 100));
              }, signal);
            } catch (error) {
              if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
              // 检测 CORS 错误，切换到代理模式
              if (isCorsError(error) && !useProxyMode) {
                console.warn('检测到 CORS 错误，切换到代理上传模式');
                corsErrorDetected = true;
                useProxyMode = true;
                etag = await proxyUploadPartForTask(taskId, partNumber, chunk, signal);
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

    // Step 3: Complete - 使用 /api/tasks/complete
    const result = await apiPost<UploadedFile>('/api/tasks/complete', {
      taskId: taskId || uploadId,
      parts,
    });

    return result;
  } catch (err) {
    if (signal?.aborted) {
      await abort();
    }
    throw err;
  }
}

// ── Proxy upload part for task API ─────────────────────────────────────────

async function proxyUploadPartForTask(
  taskId: string,
  partNumber: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const formData = new FormData();
  formData.append('taskId', taskId);
  formData.append('partNumber', String(partNumber));
  formData.append('chunk', chunk);

  const res = await axios.post<{ success: boolean; data: { partNumber: number; etag: string }; error?: { message: string } }>(
    `${API_BASE}/api/tasks/part-proxy`,
    formData,
    { 
      headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' },
      signal,
    },
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
  signal?: AbortSignal,
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

    xhr.onerror = () => reject(new Error('直传网络错误（可能是 CORS 问题）'));
    xhr.ontimeout = () => reject(new Error('直传请求超时'));
    xhr.timeout = 3600 * 1000;

    // Handle abort signal
    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

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
  signal?: AbortSignal,
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
        const cleanEtag = etag.replace(/"/g, '');
        if (!cleanEtag) {
          console.error('Upload part missing ETag header:', {
            status: xhr.status,
            headers: xhr.getAllResponseHeaders(),
          });
          reject(new Error('分片上传失败：服务器未返回 ETag'));
          return;
        }
        resolve(cleanEtag);
      } else {
        reject(new Error(`分片上传失败 (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('分片上传网络错误'));
    xhr.timeout = 3600 * 1000;
    xhr.ontimeout = () => reject(new Error('分片上传超时'));

    // Handle abort signal
    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    xhr.send(chunk);
  });
}

// ── Legacy proxy fallback ─────────────────────────────────────────────────

interface ProxyUploadOptions {
  file: File;
  parentId?: string | null;
  bucketId?: string | null;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

async function proxyUpload({ file, parentId, bucketId, onProgress, signal }: ProxyUploadOptions): Promise<UploadedFile> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const formData = new FormData();
  formData.append('file', file);
  if (parentId) formData.append('parentId', parentId);
  if (bucketId) formData.append('bucketId', bucketId);

  const res = await axios.post<{ success: boolean; data: UploadedFile; error?: { message: string } }>(
    `${API_BASE}/api/files/upload`,
    formData,
    {
      headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' },
      signal,
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
