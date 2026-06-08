/**
 * presignUpload.ts
 *
 * 预签名上传服务层
 *
 * 职责：
 * - 小文件直接上传（≤100MB）：获取预签名 URL → PUT 到 S3 → 确认上传
 * - 大文件分片上传（>100MB）：初始化分片 → 逐片上传 → 完成合并
 * - 上传进度实时跟踪（0-100%）
 * - 断点续传支持（基于已有 taskId 恢复）
 * - CORS 错误自动回退到服务器代理模式
 * - Telegram Bot 代理上传支持（自动检测 isTelegramUpload 标志）
 *
 * 上传策略流程：
 * 1. 判断文件大小 → 选择单文件/分片模式
 * 2. 调用 /api/tasks/create 创建任务记录
 * 3. 若返回 useProxy 或检测到 CORS 错误 → 回退代理模式
 * 4. 若返回 isTelegramUpload → 自动走 Telegram 代理分片上传
 * 5. 正常模式：PUT 到预签名 URL / 分片模式：逐片 PUT + part-done
 * 6. 调用 /api/tasks/complete 完成上传（含 SHA-256 哈希去重）
 *
 * 导出：
 * - presignUpload()        — 主入口（自动选择上传策略）
 * - proxyUploadFile()       — 服务器代理上传（CORS 回退）
 * - telegramProxyUpload()   — Telegram Bot 代理上传
 * - getPresignedDownloadUrl() — 预签名下载 URL
 * - getPresignedPreviewUrl()  — 预签名预览 URL
 * - MULTIPART_THRESHOLD      — 分片阈值常量（100MB）
 * - PART_SIZE               — 分片大小常量（10MB）
 */

import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import { tasksApi } from './core';
import type { UploadedFile } from '@osshelf/shared';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ─────────────────────────────────────────────────────────────────────────────
// 常量定义
// ─────────────────────────────────────────────────────────────────────────────

/** 超过此大小使用分片上传（100 MB） */
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

/** 每个分片的大小（10 MB — S3 要求非末尾分片最小 5 MB） */
export const PART_SIZE = 10 * 1024 * 1024;

/** 最大并发分片上传数 */
const MAX_CONCURRENT_PARTS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// 内部类型定义
// ─────────────────────────────────────────────────────────────────────────────

/** 分片上传初始化响应 */
interface PresignMultipartInitResponse {
  useProxy?: boolean;
  uploadId?: string;
  fileId?: string;
  r2Key?: string;
  bucketId?: string;
  firstPartUrl?: string;
}

/** 单个分片的预签名响应 */
interface PresignPartResponse {
  partUrl: string;
  partNumber: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 认证 & API 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

/** 构建带 Token 的认证请求头 */
function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 封装 POST 请求（自动提取 data 字段并处理错误） */
async function apiPost<T>(path: string, data: unknown): Promise<T> {
  const res = await axios.post<{ success: boolean; data: T; error?: { message: string } }>(`${API_BASE}${path}`, data, {
    headers: authHeaders(),
  });
  if (!res.data.success) {
    throw new Error(res.data.error?.message || `API error at ${path}`);
  }
  return res.data.data;
}

/** 封装 GET 请求（自动提取 data 字段并处理错误） */
async function apiGet<T>(path: string): Promise<T> {
  const res = await axios.get<{ success: boolean; data: T; error?: { message: string } }>(`${API_BASE}${path}`, {
    headers: authHeaders(),
  });
  if (!res.data.success) {
    throw new Error(res.data.error?.message || `API error at ${path}`);
  }
  return res.data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// 主入口 — 预签名上传
// ─────────────────────────────────────────────────────────────────────────────

/** 预签名上传选项 */
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
  /** Existing task ID for resume upload (断点续传) */
  taskId?: string;
  /** Skip already uploaded parts (from server) */
  skipParts?: number[];
}

export async function presignUpload({
  file,
  parentId = null,
  bucketId = null,
  onProgress,
  onFallback,
  signal,
  taskId,
  skipParts,
}: PresignUploadOptions): Promise<UploadedFile> {
  const uploadCtx = { corsErrorDetected: false };
  if (file.size > MULTIPART_THRESHOLD) {
    return multipartUpload({ file, parentId, bucketId, onProgress, onFallback, signal, taskId, skipParts }, uploadCtx);
  }
  return singlePresignUpload({ file, parentId, bucketId, onProgress, onFallback, signal }, uploadCtx);
}

// ─────────────────────────────────────────────────────────────────────────────
// 单文件预签名 PUT 上传
// ─────────────────────────────────────────────────────────────────────────────

async function singlePresignUpload(
  { file, parentId, bucketId, onProgress, onFallback, signal }: PresignUploadOptions,
  uploadCtx: { corsErrorDetected: boolean }
): Promise<UploadedFile> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const init = await apiPost<{
    taskId: string;
    fileId: string;
    uploadId: string;
    r2Key: string;
    bucketId: string;
    uploadUrl?: string;
    isSmallFile?: boolean;
    useProxy?: boolean;
    isTelegramUpload?: boolean;
    totalParts?: number;
    partSize?: number;
  }>('/api/tasks/create', {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    parentId,
    bucketId,
  });

  if (init.isTelegramUpload) {
    return telegramProxyUpload({
      file,
      taskId: init.taskId,
      totalParts: init.totalParts ?? 1,
      partSize: init.partSize ?? file.size,
      onProgress,
      signal,
    });
  }

  if (init.useProxy) {
    onFallback?.();
    return proxyUpload({ file, parentId, bucketId, onProgress, signal });
  }

  const { taskId, uploadUrl } = init;

  if (!uploadUrl) {
    throw new Error('预签名上传：服务器未返回上传 URL');
  }

  await tasksApi.start(taskId).catch(() => {});

  // 读取 buffer 并计算 SHA-256（用于服务端去重）
  const fileBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
  const fileHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    await directPut(uploadUrl, file, file.type || 'application/octet-stream', onProgress, signal);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
    if (isCorsError(error) && !uploadCtx.corsErrorDetected) {
      console.warn('检测到 CORS 错误，切换到代理上传模式');
      uploadCtx.corsErrorDetected = true;
      onFallback?.();
      return proxyUpload({ file, parentId, bucketId, onProgress, signal });
    }
    throw error;
  }

  const result = await apiPost<UploadedFile>('/api/tasks/complete', {
    taskId,
    parts: [{ partNumber: 1, etag: 'direct' }],
    hash: fileHash,
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 分片上传
// ─────────────────────────────────────────────────────────────────────────────

/** 判断是否为 CORS 相关错误 */
function isCorsError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('cors') ||
      msg.includes('network error') ||
      msg.includes('failed to fetch') ||
      msg.includes('网络错误')
    );
  }
  return false;
}

async function multipartUpload(
  {
    file,
    parentId,
    bucketId,
    onProgress,
    onFallback,
    signal,
    taskId: existingTaskId,
    skipParts = [],
  }: PresignUploadOptions,
  uploadCtx: { corsErrorDetected: boolean }
): Promise<UploadedFile> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const totalParts = Math.ceil(file.size / PART_SIZE);

  let taskId: string;
  let uploadId: string;
  let r2Key: string;
  let firstPartUrl: string | undefined;

  // 如果提供了现有任务ID，使用断点续传模式
  if (existingTaskId) {
    taskId = existingTaskId;
    // 获取任务详情以获取 uploadId 和 r2Key
    const taskInfo = await apiGet<{
      uploadId: string;
      r2Key: string;
      bucketId: string;
      totalParts: number;
      uploadedParts: number[];
      parts?: Array<{ partNumber: number; etag: string }>;
    }>(`/api/tasks/${existingTaskId}`);
    uploadId = taskInfo.uploadId;
    r2Key = taskInfo.r2Key;
    // 合并服务器返回的已上传分片
    skipParts = [...new Set([...skipParts, ...taskInfo.uploadedParts])];
  } else {
    // 使用 /api/tasks/create 创建任务记录，这样可以在任务页面追踪
    const init = await apiPost<PresignMultipartInitResponse & { taskId?: string; isTelegramUpload?: boolean }>(
      '/api/tasks/create',
      {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        parentId,
        bucketId,
      }
    );

    // Telegram 上传走专门的分片端点
    if ((init as any).isTelegramUpload) {
      return telegramProxyUpload({
        file,
        taskId: (init as any).taskId,
        totalParts: (init as any).totalParts ?? 1,
        partSize: (init as any).partSize ?? file.size,
        onProgress,
        signal,
      });
    }

    // 检查是否返回了 useProxy（兼容旧逻辑）
    if ('useProxy' in init && init.useProxy) {
      onFallback?.();
      return proxyUpload({ file, parentId, bucketId, onProgress, signal });
    }

    const initData = init as any;
    uploadId = initData.uploadId;
    r2Key = initData.r2Key;
    firstPartUrl = initData.firstPartUrl;
    taskId = initData.taskId;
    if (!uploadId || !r2Key) {
      throw new Error('分片上传初始化：服务器返回了无效的响应');
    }
  }

  const parts: Array<{ partNumber: number; etag: string }> = [];
  let uploadedBytes = 0;
  let useProxyMode = uploadCtx.corsErrorDetected;

  // 计算已上传的字节数（用于进度显示）
  const alreadyUploadedBytes = skipParts.reduce((sum, partNum) => {
    const start = (partNum - 1) * PART_SIZE;
    const end = Math.min(start + PART_SIZE, file.size);
    return sum + (end - start);
  }, 0);
  uploadedBytes = alreadyUploadedBytes;

  // Abort helper (best-effort)
  const abort = async () => {
    try {
      if (taskId) {
        await apiPost('/api/tasks/abort', { taskId });
      }
    } catch {
      /* ignore */
    }
  };

  try {
    // 需要上传的分片列表（排除已上传的）
    const partsToUpload = Array.from({ length: totalParts }, (_, i) => i + 1).filter(
      (partNum) => !skipParts.includes(partNum)
    );

    // Upload parts in batches of MAX_CONCURRENT_PARTS
    for (let batch = 0; batch < partsToUpload.length; batch += MAX_CONCURRENT_PARTS) {
      if (signal?.aborted) {
        await abort();
        throw new DOMException('Upload aborted', 'AbortError');
      }

      const batchParts = partsToUpload.slice(batch, batch + MAX_CONCURRENT_PARTS);

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
            if (partNumber === 1 && firstPartUrl && !skipParts.includes(1)) {
              partUrl = firstPartUrl;
            } else {
              const partData = await apiPost<PresignPartResponse>('/api/tasks/part', {
                taskId,
                partNumber,
              });
              partUrl = partData.partUrl;
            }

            try {
              etag = await uploadPart(
                partUrl,
                chunk,
                (partBytes) => {
                  uploadedBytes += partBytes;
                  onProgress?.(Math.round((uploadedBytes / file.size) * 100));
                },
                signal
              );
              // 通知服务器分片上传完成，更新进度
              await apiPost('/api/tasks/part-done', { taskId, partNumber, etag });
            } catch (error) {
              if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
              // 检测 CORS 错误，切换到代理模式
              if (isCorsError(error) && !useProxyMode) {
                console.warn('检测到 CORS 错误，切换到代理上传模式');
                uploadCtx.corsErrorDetected = true;
                useProxyMode = true;
                etag = await proxyUploadPartForTask(taskId, partNumber, chunk, signal);
              } else {
                throw error;
              }
            }
          }

          return { partNumber, etag };
        })
      );

      parts.push(...batchResults);
      onProgress?.(Math.round((uploadedBytes / file.size) * 100));
    }

    // 合并断点续传中已记录的分片（服务端 DB 缓存，含 etag）与本次新上传的分片
    // taskInfo.parts 在断点续传模式下由服务端返回，已包含完整的 etag
    const existingParts: Array<{ partNumber: number; etag: string }> = existingTaskId
      ? await apiGet<{ parts?: Array<{ partNumber: number; etag: string }> }>(`/api/tasks/${taskId}`)
          .then((d) => d.parts ?? [])
          .catch(() => [])
      : [];
    const allParts = [...existingParts, ...parts]
      .filter((p) => p.etag) // 过滤掉无 etag 的条目
      .sort((a, b) => a.partNumber - b.partNumber)
      // 去重：同一分片以后出现的（新上传的）为准
      .reduce<Array<{ partNumber: number; etag: string }>>((acc, p) => {
        const idx = acc.findIndex((x) => x.partNumber === p.partNumber);
        if (idx === -1) acc.push(p);
        else acc[idx] = p;
        return acc;
      }, []);

    // Step 3: Complete - 使用 /api/tasks/complete
    const result = await apiPost<UploadedFile>('/api/tasks/complete', {
      taskId: taskId || uploadId,
      parts: allParts,
      hash: await computeFileHash(file),
    });

    return result;
  } catch (err) {
    if (signal?.aborted) {
      await abort();
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 代理分片上传（CORS 回退模式）
// ─────────────────────────────────────────────────────────────────────────────

/** 通过服务器代理上传单个分片 */
async function proxyUploadPartForTask(
  taskId: string,
  partNumber: number,
  chunk: Blob,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const formData = new FormData();
  formData.append('taskId', taskId);
  formData.append('partNumber', String(partNumber));
  formData.append('chunk', chunk);

  const res = await axios.post<{
    success: boolean;
    data: { partNumber: number; etag: string };
    error?: { message: string };
  }>(`${API_BASE}/api/tasks/part-proxy`, formData, {
    headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' },
    signal,
  });

  if (!res.data.success) {
    throw new Error(res.data.error?.message || '代理分片上传失败');
  }
  return res.data.data.etag;
}

// ─────────────────────────────────────────────────────────────────────────────
// 底层 HTTP 工具（XHR 直传 / 分片上传）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 使用 XHR 将 body 直接 PUT 到预签名 URL（支持进度回调）
 */
function directPut(
  url: string,
  body: Blob | ArrayBuffer,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
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
 * 上传单个分片到预签名 URL，返回响应头中的 ETag
 */
function uploadPart(
  url: string,
  chunk: Blob,
  onChunkProgress?: (bytes: number) => void,
  signal?: AbortSignal
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

// ─────────────────────────────────────────────────────────────────────────────
// 旧版代理回退上传（CORS 不兼容时使用）
// ─────────────────────────────────────────────────────────────────────────────

/** 代理上传选项（fallback 模式） */
interface ProxyUploadOptions {
  file: File;
  parentId?: string | null;
  bucketId?: string | null;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

async function proxyUpload({
  file,
  parentId,
  bucketId,
  onProgress,
  signal,
}: ProxyUploadOptions): Promise<UploadedFile> {
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
    }
  );

  if (!res.data.success) {
    throw new Error(res.data.error?.message || '上传失败');
  }
  return res.data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Bot 代理上传
// ─────────────────────────────────────────────────────────────────────────────

/** Telegram 代理上传选项 */
interface TelegramProxyUploadOptions {
  file: File;
  taskId: string;
  totalParts: number;
  partSize: number;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

async function telegramProxyUpload({
  file,
  taskId,
  totalParts,
  partSize,
  onProgress,
  signal,
}: TelegramProxyUploadOptions): Promise<UploadedFile> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  await apiPost('/api/tasks/start', { taskId }).catch(() => {});

  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

    const start = (partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);

    // 与 /part-proxy 完全一致的 multipart/form-data 格式
    const formData = new FormData();
    formData.append('taskId', taskId);
    formData.append('partNumber', String(partNumber));
    formData.append('chunk', chunk, file.name);

    const res = await axios.post<{ success: boolean; error?: { message: string } }>(
      `${API_BASE}/api/tasks/telegram-part`,
      formData,
      {
        headers: { ...authHeaders() },
        signal,
        onUploadProgress: (e) => {
          if (e.total && onProgress) {
            const partProgress = e.loaded / e.total;
            const overall = Math.round(((partNumber - 1 + partProgress) / totalParts) * 100);
            onProgress(Math.min(overall, 99));
          }
        },
      }
    );

    if (!res.data.success) {
      throw new Error(res.data.error?.message || `分片 ${partNumber} 上传失败`);
    }
  }

  // 全部分片完成，调 /complete 写入 files + telegramFileRefs
  const completeRes = await apiPost<{
    id: string;
    name: string;
    size: number;
    mimeType?: string | null;
    path: string;
    bucketId: string;
    createdAt: string;
  }>('/api/tasks/complete', {
    taskId,
    parts: [],
  });

  onProgress?.(100);
  return {
    id: completeRes.id || taskId,
    name: completeRes.name || file.name,
    size: completeRes.size || file.size,
    mimeType: completeRes.mimeType || file.type || 'application/octet-stream',
    path: completeRes.path || '',
    bucketId: completeRes.bucketId || '',
    createdAt: completeRes.createdAt || new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 预签名下载/预览 URL 辅助
// ─────────────────────────────────────────────────────────────────────────────

/** 预签名下载结果 */
export interface PresignDownloadResult {
  useProxy: boolean;
  url: string; // presigned URL or proxy URL
  fileName?: string;
  mimeType?: string | null;
}

export async function getPresignedDownloadUrl(fileId: string): Promise<PresignDownloadResult> {
  // /api/presign/download/:id 是 GET 接口，不应使用 POST
  const data = await apiGet<{
    useProxy?: boolean;
    proxyUrl?: string;
    downloadUrl?: string;
    fileName?: string;
    mimeType?: string;
  }>(`/api/presign/download/${fileId}`).catch(() => null);

  // Fall back gracefully
  if (!data || data.useProxy) {
    const token = useAuthStore.getState().token;
    const proxyUrl = token
      ? `${API_BASE}/api/files/${fileId}/download?token=${encodeURIComponent(token)}`
      : `${API_BASE}/api/files/${fileId}/download`;
    return { useProxy: true, url: proxyUrl };
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
    const res = await axios.get<{
      success: boolean;
      data: { useProxy?: boolean; proxyUrl?: string; previewUrl?: string; mimeType?: string };
    }>(`${API_BASE}/api/presign/preview/${fileId}`, { headers: authHeaders() });
    if (res.data.success && res.data.data) {
      const d = res.data.data;
      if (d.useProxy) {
        return { useProxy: true, url: `${API_BASE}/api/files/${fileId}/preview?token=${token}` };
      }
      return { useProxy: false, url: d.previewUrl!, mimeType: d.mimeType };
    }
  } catch {
    /* fall through */
  }

  const token = useAuthStore.getState().token;
  return { useProxy: true, url: `${API_BASE}/api/files/${fileId}/preview?token=${token}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 文件哈希计算工具
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 计算 SHA-256 哈希值
 * 用于上传完成时服务端去重。
 * 注意：大文件会阻塞主线程，生产环境可改为 Web Worker。
 */
async function computeFileHash(file: File): Promise<string | undefined> {
  try {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return undefined;
  }
}
