/**
 * uploadManager.ts
 * 全局上传任务管理器
 * 
 * 功能:
 * - 跟踪所有上传任务
 * - 支持暂停/继续上传
 * - 支持断点续传
 * - 离开页面时提示用户
 */

import { presignUpload, MULTIPART_THRESHOLD, PART_SIZE } from './presignUpload';
import { tasksApi } from './api';
import { useAuthStore } from '../stores/auth';

export interface UploadJob {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  parentId: string | null;
  bucketId: string | null;
  status: 'pending' | 'uploading' | 'paused' | 'completed' | 'failed' | 'aborted';
  progress: number;
  uploadedBytes: number;
  error?: string;
  taskId?: string;
  abortController?: AbortController;
  startTime?: number;
}

type UploadJobListener = (jobs: Map<string, UploadJob>) => void;

class UploadManager {
  private jobs: Map<string, UploadJob> = new Map();
  private listeners: Set<UploadJobListener> = new Set();
  private hasActiveUploads = false;

  subscribe(listener: UploadJobListener): () => void {
    this.listeners.add(listener);
    listener(this.jobs);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l(new Map(this.jobs)));
    this.updateBeforeUnload();
  }

  private updateBeforeUnload() {
    const activeJobs = Array.from(this.jobs.values()).filter(
      (j) => j.status === 'uploading' || j.status === 'pending'
    );
    this.hasActiveUploads = activeJobs.length > 0;
  }

  getHasActiveUploads(): boolean {
    return this.hasActiveUploads;
  }

  getJobs(): Map<string, UploadJob> {
    return new Map(this.jobs);
  }

  async startUpload(
    file: File,
    parentId: string | null = null,
    bucketId: string | null = null,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    const jobId = crypto.randomUUID();
    const job: UploadJob = {
      id: jobId,
      file,
      fileName: file.name,
      fileSize: file.size,
      parentId,
      bucketId,
      status: 'pending',
      progress: 0,
      uploadedBytes: 0,
      startTime: Date.now(),
    };

    this.jobs.set(jobId, job);
    this.notify();

    try {
      job.status = 'uploading';
      job.abortController = new AbortController();
      this.notify();

      const result = await presignUpload({
        file,
        parentId,
        bucketId,
        onProgress: (p) => {
          job.progress = p;
          job.uploadedBytes = Math.round((file.size * p) / 100);
          this.notify();
          onProgress?.(p);
        },
        signal: job.abortController.signal,
      });

      job.status = 'completed';
      job.progress = 100;
      job.uploadedBytes = file.size;
      job.taskId = result.id;
      this.notify();

      return jobId;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        job.status = 'aborted';
        job.error = '上传已取消';
      } else {
        job.status = 'failed';
        job.error = error.message || '上传失败';
      }
      this.notify();
      throw error;
    }
  }

  pauseUpload(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'uploading') return false;

    job.abortController?.abort();
    job.status = 'paused';
    this.notify();
    return true;
  }

  async resumeUpload(jobId: string, onProgress?: (percent: number) => void): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') return false;

    try {
      job.status = 'uploading';
      job.abortController = new AbortController();
      this.notify();

      const result = await presignUpload({
        file: job.file,
        parentId: job.parentId,
        bucketId: job.bucketId,
        onProgress: (p) => {
          job.progress = p;
          job.uploadedBytes = Math.round((job.fileSize * p) / 100);
          this.notify();
          onProgress?.(p);
        },
        signal: job.abortController.signal,
      });

      job.status = 'completed';
      job.progress = 100;
      job.uploadedBytes = job.fileSize;
      job.taskId = result.id;
      this.notify();
      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        job.status = 'paused';
      } else {
        job.status = 'failed';
        job.error = error.message || '上传失败';
      }
      this.notify();
      return false;
    }
  }

  abortUpload(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.abortController?.abort();
    job.status = 'aborted';
    job.error = '上传已取消';
    this.notify();
    return true;
  }

  removeJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'uploading' || job.status === 'pending') {
      job.abortController?.abort();
    }

    this.jobs.delete(jobId);
    this.notify();
    return true;
  }

  clearCompleted() {
    Array.from(this.jobs.entries())
      .filter(([, job]) => job.status === 'completed' || job.status === 'failed' || job.status === 'aborted')
      .forEach(([id]) => this.jobs.delete(id));
    this.notify();
  }
}

export const uploadManager = new UploadManager();

let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

export function setupBeforeUnloadWarning() {
  if (beforeUnloadHandler) return;

  beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (uploadManager.getHasActiveUploads()) {
      e.preventDefault();
      e.returnValue = '有文件正在上传，离开页面会导致上传中断。确定要离开吗？';
      return e.returnValue;
    }
  };

  window.addEventListener('beforeunload', beforeUnloadHandler);
}

export function removeBeforeUnloadWarning() {
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}
