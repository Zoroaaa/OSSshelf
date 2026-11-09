/**
 * index.ts
 * 工具函数集合
 *
 * 功能:
 * - 类名合并（cn）
 * - 字节格式化
 * - 日期格式化
 * - 错误消息提取
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return '—';
  let d: Date;
  if (typeof date === 'string') {
    // 处理不带时区信息的时间字符串
    // SQLite CURRENT_TIMESTAMP 返回 UTC 时间但不带 Z 后缀
    // 例如: "2024-01-01 12:00:00" 应该被解析为 UTC 时间
    let normalized = date;
    if (!date.endsWith('Z') && !date.includes('+') && !date.includes('GMT')) {
      // ISO 格式但无 Z 后缀，或 SQLite 格式，假设为 UTC 时间
      normalized = date.replace(' ', 'T') + 'Z';
    }
    d = new Date(normalized);
  } else {
    d = date;
  }
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getErrorMessage(error: unknown, fallback = '操作失败'): string {
  const err = error as any;
  return err?.response?.data?.error?.message || err?.message || fallback;
}

/**
 * 以固定并发上限执行异步任务。
 * 用于上传等多文件场景，避免一次性并发全部请求导致内存与带宽打满。
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;

  const workers = Math.min(Math.max(1, limit), items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        await task(items[index] as T, index);
      }
    })
  );
}

export function decodeFileName(name: string): string {
  if (!name) return name;
  try {
    const decoded = decodeURIComponent(name);
    if (decoded !== name && !decoded.includes('%')) {
      return decoded;
    }
    return name;
  } catch {
    return name;
  }
}
