import { logger } from '@osshelf/shared';
import type { Env } from '../../types/env';
import { getDb, telegramFileRefs } from '../../db';
import { eq } from 'drizzle-orm';
import { getFileContent } from '../utils';
import { resolveTgConfig } from './features';
import { tgDownloadFile } from '../telegramClient';
import { tgDownloadChunked, isChunkedFileId } from '../telegramChunked';
import type { AiFeatureType } from './types';

export function buildThinkingConfig(modelId: string, featureType: AiFeatureType = 'chat'): Record<string, unknown> | undefined {
  const vendor = detectModelVendor(modelId);
  const id = modelId.toLowerCase();
  
  const shouldEnableThinking = (feature: AiFeatureType): boolean => {
    switch (feature) {
      case 'chat':
        return true;
      case 'image_caption':
      case 'image_tag':
      case 'image_analysis':
      case 'file_summary':
        return false;
      default:
        return false;
    }
  };

  const enableThinking = shouldEnableThinking(featureType);
  
  if (vendor === 'zhipu') {
    if (id.includes('glm-4.5') || id.includes('glm-4.6') || id.includes('glm-4.7') || id.includes('glm-5')) {
      return { thinking: { type: enableThinking ? 'enabled' : 'disabled' } };
    }
  }
  
  if (vendor === 'deepseek' && id.includes('r1')) {
    return undefined;
  }
  
  return undefined;
}

/**
 * 将字节数组转换为 Base64 字符串（分块处理避免栈溢出）
 * @param bytes 字节数组（Uint8Array 或 number[]）
 * @returns Base64 编码字符串
 */
export function uint8ArrayToBase64(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunkSize = 24573; // 必须是 3 的倍数，确保 base64 编码对齐
  let result = '';

  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.subarray(i, i + chunkSize);
    let binary = '';
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
    result += btoa(binary);
  }

  return result;
}

/**
 * 格式化文件大小为人类可读字符串
 * @param bytes 字节数
 * @param decimals 小数位数
 * @returns 格式化后的字符串 (如 "1.5 MB")
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  if (!Number.isFinite(bytes)) return 'N/A';

  const k = 1024;
  const dm = Math.max(0, decimals);
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));

  if (i < 0 || i >= sizes.length) return `${bytes} Bytes`;

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 统一的文件内容获取函数（支持 S3/R2 和 Telegram 双存储）
 * @param env 环境变量
 * @param file 文件对象（至少包含 id, bucketId, r2Key）
 * @returns 文件的 ArrayBuffer，失败返回 null
 */
export async function fetchFileBuffer(
  env: Env,
  file: { id: string; bucketId: string | null; r2Key: string | null }
): Promise<ArrayBuffer | null> {
  if (!file.bucketId || !file.r2Key) return null;

  try {
    const db = getDb(env.DB);

    const tgRef = await db.select().from(telegramFileRefs).where(eq(telegramFileRefs.fileId, file.id)).get();

    if (tgRef) {
      const tgConfig = await resolveTgConfig(env, file.bucketId);
      if (!tgConfig) {
        logger.error('AI', 'Telegram 存储桶配置解析失败', { fileId: file.id, bucketId: file.bucketId });
        return null;
      }

      let stream: ReadableStream<Uint8Array> | null = null;
      if (isChunkedFileId(tgRef.tgFileId)) {
        stream = await tgDownloadChunked(tgConfig, tgRef.tgFileId, db);
      } else {
        const resp = await tgDownloadFile(tgConfig, tgRef.tgFileId);
        stream = resp.body;
      }

      if (!stream) {
        logger.error('AI', 'Telegram 文件流为空', { fileId: file.id, tgFileId: tgRef.tgFileId });
        return null;
      }

      return new Response(stream).arrayBuffer();
    }

    return await getFileContent(env, file.bucketId, file.r2Key);
  } catch (error) {
    logger.error('AI', 'fetchFileBuffer 获取文件内容失败', { fileId: file.id }, error);
    return null;
  }
}

/**
 * 根据 MIME 类型获取文件类别（中文）
 * @param mimeType MIME 类型字符串
 * @returns 文件类别中文名称
 */
export function getMimeTypeCategory(mimeType: string | null | undefined): string {
  if (!mimeType) return '其他';
  if (mimeType.startsWith('image/')) return '图片';
  if (mimeType.startsWith('video/')) return '视频';
  if (mimeType.startsWith('audio/')) return '音频';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('word') || mimeType.includes('document')) return '文档';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '表格';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '演示文稿';
  if (mimeType.startsWith('text/')) return '文本';
  if (mimeType.includes('json') || mimeType.includes('xml')) return '数据文件';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return '压缩包';
  return '其他';
}

export type VisionMessageContent = Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;

export type ModelVendor = 'openai' | 'anthropic' | 'zhipu' | 'deepseek' | 'alibaba' | 'google' | 'unknown';

export function detectModelVendor(modelId: string): ModelVendor {
  const id = modelId.toLowerCase();
  if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'openai';
  if (id.includes('claude')) return 'anthropic';
  if (id.includes('glm')) return 'zhipu';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('qwen') || id.includes('tongyi')) return 'alibaba';
  if (id.includes('gemini')) return 'google';
  return 'unknown';
}

export function buildVisionMessageContent(
  base64Image: string,
  mimeType: string,
  textPrompt: string
): VisionMessageContent {
  return [
    { type: 'text', text: textPrompt },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
  ];
}

export function supportsReasoningContent(modelId: string): boolean {
  const vendor = detectModelVendor(modelId);
  const id = modelId.toLowerCase();
  
  if (vendor === 'zhipu') {
    return id.includes('glm-4.5') || id.includes('glm-4.6') || id.includes('glm-4.7') || id.includes('glm-5');
  }
  
  if (vendor === 'deepseek') {
    return id.includes('r1');
  }
  
  if (vendor === 'alibaba') {
    return id.includes('qwq');
  }
  
  return false;
}
