/**
 * utils.ts
 * AI模块通用工具函数
 *
 * 功能:
 * - Thinking模式配置构建
 * - 模型供应商检测
 * - 文件内容读取辅助
 * - Base64编码转换
 * - Vision消息内容构建
 */

import { logger } from '@osshelf/shared';
import type { Env } from '../../types/env';
import { getDb, telegramFileRefs } from '../../db';
import { eq } from 'drizzle-orm';
import { getFileContent } from '../utils';
import { resolveTgConfig } from './features';
import { tgDownloadFile } from '../telegramClient';
import { tgDownloadChunked, isChunkedFileId } from '../telegramChunked';
import type { AiFeatureType, ModelConfig } from './types';

/**
 * 构建Thinking模式配置
 *
 * 完全由数据库模型配置驱动，不做任何模型名硬编码判断。
 *
 * @param featureType - 功能类型，默认为 'chat'
 * @param config - 数据库中的模型配置
 * @returns Thinking参数对象，如果不支持则返回undefined
 */
export function buildThinkingConfig(
  featureType: AiFeatureType = 'chat',
  config?: Pick<
    ModelConfig,
    | 'supportsThinking'
    | 'thinkingParamFormat'
    | 'thinkingParamName'
    | 'thinkingEnabledValue'
    | 'thinkingDisabledValue'
    | 'thinkingNestedKey'
    | 'disableThinkingForFeatures'
  >
): Record<string, unknown> | undefined {
  if (!config?.supportsThinking) {
    return undefined;
  }

  const { thinkingParamFormat, thinkingParamName, thinkingEnabledValue, thinkingDisabledValue, thinkingNestedKey } =
    config;

  if (!thinkingParamFormat || !thinkingParamName) {
    return undefined;
  }

  let disableThinkingFeatures: string[] = ['image_caption', 'image_tag', 'image_analysis', 'file_summary'];
  if (config.disableThinkingForFeatures) {
    try {
      disableThinkingFeatures = JSON.parse(config.disableThinkingForFeatures);
    } catch {
      // 使用默认值
    }
  }

  const enableThinking = !disableThinkingFeatures.includes(featureType);
  const enabledVal = thinkingEnabledValue ?? 'enabled';
  const disabledVal = thinkingDisabledValue ?? 'disabled';
  const value = enableThinking ? enabledVal : disabledVal;

  switch (thinkingParamFormat) {
    case 'boolean':
      return { [thinkingParamName]: value === 'true' || value === '1' };
    case 'string':
      return { [thinkingParamName]: value };
    case 'object':
      if (thinkingNestedKey) {
        return { [thinkingParamName]: { [thinkingNestedKey]: value } };
      }
      return { [thinkingParamName]: value };
    default:
      return undefined;
  }
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

/**
 * 构建Vision消息内容
 *
 * 将图片和文本提示词组合成Vision API所需的消息格式。
 * 用于图片标签、图片分析等视觉功能。
 *
 * @param base64Image - Base64编码的图片数据
 * @param mimeType - 图片MIME类型，如 'image/jpeg', 'image/png'
 * @param textPrompt - 文本提示词
 * @returns Vision消息内容数组
 *
 * @example
 * const content = buildVisionMessageContent(
 *   'iVBORw0KGgoAAAANSUhEUg...',
 *   'image/png',
 *   '请描述这张图片的内容'
 * );
 */
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

/**
 * 从模型响应中提取思考内容
 *
 * 某些模型（如 DeepSeek-R1）会在响应中使用 `` 标签包裹思考过程。
 * 此函数将思考内容提取出来，并返回分离后的思考和正文内容。
 *
 * @param content - 模型原始响应内容
 * @returns 包含 reasoning（思考内容）和 content（正文内容）的对象
 *
 * @example
 * const input = '<think>这是思考过程</think>这是正文内容';
 * const result = extractThinkingContent(input);
 * // result: { reasoning: '这是思考过程', content: '这是正文内容' }
 */
export function extractThinkingContent(content: string): {
  reasoning: string;
  content: string;
} {
  if (!content) return { reasoning: '', content: '' };

  const thinkingRegex = /<think>([\s\S]*?)<\/think>/g;
  let reasoning = '';
  let cleanedContent = content;

  // 提取所有 `` 标签内容
  let match;
  while ((match = thinkingRegex.exec(content)) !== null) {
    reasoning += match[1];
  }

  // 移除所有 `` 标签及其内容
  cleanedContent = content.replace(thinkingRegex, '').trim();

  return {
    reasoning: reasoning.trim(),
    content: cleanedContent,
  };
}

/**
 * 检查内容是否包含思考标签
 *
 * @param content - 要检查的内容
 * @returns 是否包含 `` 标签
 */
export function hasThinkingTags(content: string): boolean {
  return /<think>/.test(content) && /<\/think>/.test(content);
}
