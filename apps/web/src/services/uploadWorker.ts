/**
 * uploadWorker.ts
 * Web Worker 后台上传服务
 *
 * 功能:
 * - 在后台线程中执行上传任务
 * - 支持分片上传和进度追踪
 * - 页面切换时继续上传
 */

const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;
const MAX_CONCURRENT_PARTS = 3;

interface UploadTask {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  parentId: string | null;
  bucketId: string | null;
  fileBuffer: ArrayBuffer;
}

interface PartUploadResult {
  partNumber: number;
  etag: string;
}

let API_BASE = '';
let AUTH_TOKEN = '';

function setAuthHeaders(): Record<string, string> {
  return AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};
}

async function apiPost<T>(path: string, data: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...setAuthHeaders(),
    },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message || `API error at ${path}`);
  }
  return json.data;
}

async function uploadPart(partUrl: string, chunk: ArrayBuffer, contentType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', partUrl);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag') || '';
        resolve(etag.replace(/"/g, ''));
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

async function proxyUploadPart(taskId: string, partNumber: number, chunk: ArrayBuffer): Promise<string> {
  const formData = new FormData();
  formData.append('taskId', taskId);
  formData.append('partNumber', String(partNumber));
  formData.append('chunk', new Blob([chunk]));

  const res = await fetch(`${API_BASE}/api/tasks/part-proxy`, {
    method: 'POST',
    headers: setAuthHeaders(),
    body: formData,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message || '代理分片上传失败');
  }
  return json.data.etag;
}

async function multipartUpload(
  task: UploadTask,
  onProgress: (percent: number, uploadedBytes: number) => void
): Promise<{ fileId: string; fileName: string }> {
  const totalParts = Math.ceil(task.fileSize / PART_SIZE);

  // 创建上传任务
  const init = await apiPost<{
    taskId: string;
    uploadId: string;
    r2Key: string;
    bucketId: string;
    totalParts: number;
    firstPartUrl?: string;
  }>('/api/tasks/create', {
    fileName: task.fileName,
    fileSize: task.fileSize,
    mimeType: task.mimeType,
    parentId: task.parentId,
    bucketId: task.bucketId,
  });

  const { taskId, firstPartUrl } = init;
  const parts: PartUploadResult[] = [];
  let uploadedBytes = 0;

  // 上传分片
  for (let batch = 0; batch < totalParts; batch += MAX_CONCURRENT_PARTS) {
    const batchParts = Array.from(
      { length: Math.min(MAX_CONCURRENT_PARTS, totalParts - batch) },
      (_, i) => batch + i + 1
    );

    const batchResults = await Promise.all(
      batchParts.map(async (partNumber) => {
        const start = (partNumber - 1) * PART_SIZE;
        const end = Math.min(start + PART_SIZE, task.fileSize);
        const chunk = task.fileBuffer.slice(start, end);

        let partUrl: string;
        if (partNumber === 1 && firstPartUrl) {
          partUrl = firstPartUrl;
        } else {
          const partData = await apiPost<{ partUrl: string }>('/api/tasks/part', {
            taskId,
            partNumber,
          });
          partUrl = partData.partUrl;
        }

        let etag: string;
        try {
          etag = await uploadPart(partUrl, chunk, task.mimeType);
          // 通知服务器分片上传完成
          await apiPost('/api/tasks/part-done', { taskId, partNumber, etag });
        } catch {
          // 尝试代理模式
          etag = await proxyUploadPart(taskId, partNumber, chunk);
        }

        uploadedBytes += end - start;
        onProgress(Math.round((uploadedBytes / task.fileSize) * 100), uploadedBytes);

        return { partNumber, etag };
      })
    );

    parts.push(...batchResults);
  }

  // 完成上传
  const result = await apiPost<{ id: string; name: string }>('/api/tasks/complete', {
    taskId,
    parts,
  });

  return { fileId: result.id, fileName: result.name };
}

async function singleUpload(
  task: UploadTask,
  onProgress: (percent: number, uploadedBytes: number) => void
): Promise<{ fileId: string; fileName: string }> {
  // 通过 tasks/create 创建任务，并获取预签名 PUT URL（小文件路径）
  const init = await apiPost<{
    taskId: string;
    fileId: string;
    uploadId: string;
    r2Key: string;
    bucketId: string;
    uploadUrl?: string;
    isSmallFile?: boolean;
    isTelegramUpload?: boolean;
    proxyUploadUrl?: string;
  }>('/api/tasks/create', {
    fileName: task.fileName,
    fileSize: task.fileSize,
    mimeType: task.mimeType,
    parentId: task.parentId,
    bucketId: task.bucketId,
  });

  const { taskId, isTelegramUpload, proxyUploadUrl } = init;

  // ── Telegram 上传路径 ──────────────────────────────────────────────────
  if (isTelegramUpload && proxyUploadUrl) {
    onProgress(10, Math.round(task.fileSize * 0.1));

    const formData = new FormData();
    formData.append('taskId', taskId);
    formData.append('file', new Blob([task.fileBuffer], { type: task.mimeType }), task.fileName);

    const res = await fetch(`${API_BASE}${proxyUploadUrl}`, {
      method: 'POST',
      headers: setAuthHeaders(),
      body: formData,
    });

    const json = await res.json() as any;
    if (!json.success) {
      throw new Error(json.error?.message || 'Telegram 上传失败');
    }

    onProgress(100, task.fileSize);
    return { fileId: json.data.id, fileName: json.data.name };
  }

  // ── 普通预签名上传路径 ─────────────────────────────────────────────────
  const { uploadUrl } = init;

  if (!uploadUrl) {
    throw new Error('小文件上传初始化失败：服务器未返回上传 URL');
  }

  // 用预签名 PUT URL 直传
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', task.mimeType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100, task.fileSize);
        resolve();
      } else {
        reject(new Error(`上传失败 (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('上传网络错误'));
    xhr.timeout = 3600 * 1000;
    xhr.ontimeout = () => reject(new Error('上传超时'));
    xhr.send(task.fileBuffer);
  });

  // 通知服务端上传完成（小文件直接入库，不需要 S3 合并）
  const result = await apiPost<{ id: string; name: string }>('/api/tasks/complete', {
    taskId,
    parts: [{ partNumber: 1, etag: 'direct' }],
  });

  return { fileId: result.id, fileName: result.name };
}

// Worker 消息处理
self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'init': {
      API_BASE = payload.apiBase || '';
      AUTH_TOKEN = payload.authToken || '';
      self.postMessage({ type: 'ready' });
      break;
    }

    case 'upload': {
      const task: UploadTask = payload.task;
      const isLargeFile = task.fileSize > MULTIPART_THRESHOLD;

      try {
        self.postMessage({
          type: 'progress',
          payload: { taskId: task.id, percent: 0, uploadedBytes: 0 },
        });

        const result = isLargeFile
          ? await multipartUpload(task, (percent, uploadedBytes) => {
              self.postMessage({
                type: 'progress',
                payload: { taskId: task.id, percent, uploadedBytes },
              });
            })
          : await singleUpload(task, (percent, uploadedBytes) => {
              self.postMessage({
                type: 'progress',
                payload: { taskId: task.id, percent, uploadedBytes },
              });
            });

        self.postMessage({
          type: 'complete',
          payload: { taskId: task.id, fileId: result.fileId, fileName: result.fileName },
        });
      } catch (error: any) {
        self.postMessage({
          type: 'error',
          payload: { taskId: task.id, error: error.message || '上传失败' },
        });
      }
      break;
    }

    case 'setToken': {
      AUTH_TOKEN = payload.token;
      break;
    }
  }
};

export {};
