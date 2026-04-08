import { logger } from '@osshelf/shared';
import type { Env } from '../../types/env';
import { getDb, telegramFileRefs } from '../../db';
import { eq } from 'drizzle-orm';
import { getFileContent } from '../utils';
import { resolveTgConfig } from './features';
import { tgDownloadFile } from '../telegramClient';
import { tgDownloadChunked, isChunkedFileId } from '../telegramChunked';
import type { AiFeatureType, ThinkingParamFormat } from './types';
import { getVendorConfig, getModelConfig } from './vendorConfig';

export interface ModelThinkingConfig {
  supportsThinking?: boolean;
  thinkingParamFormat?: ThinkingParamFormat;
  thinkingParamName?: string;
  thinkingEnabledValue?: string;
  thinkingDisabledValue?: string;
  thinkingNestedKey?: string;
  disableThinkingForFeatures?: string;
}

export function buildThinkingConfig(
  modelId: string,
  featureType: AiFeatureType = 'chat',
  customConfig?: ModelThinkingConfig
): Record<string, unknown> | undefined {
  const vendor = detectModelVendor(modelId);

  let disableThinkingFeatures: string[] = ['image_caption', 'image_tag', 'image_analysis', 'file_summary'];

  if (customConfig?.disableThinkingForFeatures) {
    try {
      disableThinkingFeatures = JSON.parse(customConfig.disableThinkingForFeatures);
    } catch {
      // 使用默认值
    }
  }

  const shouldEnableThinking = (feature: AiFeatureType): boolean => {
    return !disableThinkingFeatures.includes(feature);
  };

  const enableThinking = shouldEnableThinking(featureType);

  if (customConfig) {
    if (!customConfig.supportsThinking) {
      return undefined;
    }

    const { thinkingParamFormat, thinkingParamName, thinkingEnabledValue, thinkingDisabledValue, thinkingNestedKey } =
      customConfig;

    if (!thinkingParamFormat || !thinkingParamName) {
      return undefined;
    }

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
          return {
            [thinkingParamName]: {
              [thinkingNestedKey]: value,
            },
          };
        }
        return { [thinkingParamName]: value };

      default:
        return undefined;
    }
  }

  const vendorConfig = getVendorConfig(vendor);
  if (!vendorConfig || !vendorConfig.thinkingConfig) {
    return undefined;
  }

  const modelConfig = getModelConfig(vendor, modelId);
  if (!modelConfig || !modelConfig.thinking) {
    return undefined;
  }

  const thinkingConfig = vendorConfig.thinkingConfig;
  const { paramFormat, paramName, nestedKey, enabledValue, disabledValue } = thinkingConfig;

  const value = enableThinking ? enabledValue : disabledValue;

  switch (paramFormat) {
    case 'boolean':
      return { [paramName]: value };

    case 'string':
      return { [paramName]: value };

    case 'object':
      if (nestedKey) {
        return {
          [paramName]: {
            [nestedKey]: value,
          },
        };
      }
      return { [paramName]: value };

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

export type ModelVendor =
  | 'openai'
  | 'anthropic'
  | 'zhipu'
  | 'deepseek'
  | 'alibaba'
  | 'google'
  | 'volcengine'
  | 'baidu'
  | 'tencent'
  | 'moonshot'
  | 'minimax'
  | 'mistral'
  | 'xai'
  | 'groq'
  | 'perplexity'
  | 'siliconflow'
  | 'openrouter'
  | 'unknown';

export function detectModelVendor(modelId: string): ModelVendor {
  const id = modelId.toLowerCase();

  if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'openai';
  if (id.includes('claude')) return 'anthropic';
  if (id.includes('glm')) return 'zhipu';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('qwen') || id.includes('qwq') || id.includes('tongyi')) return 'alibaba';
  if (id.includes('gemini')) return 'google';
  if (id.includes('doubao') || id.includes('seed')) return 'volcengine';
  if (id.includes('ernie') || id.includes('x1')) return 'baidu';
  if (id.includes('hunyuan') || id.includes('hy-') || id.startsWith('hy')) return 'tencent';
  if (id.includes('kimi') || id.includes('moonshot')) return 'moonshot';
  if (id.includes('minimax')) return 'minimax';
  if (id.includes('mistral') || id.includes('codestral')) return 'mistral';
  if (id.includes('grok')) return 'xai';
  if (id.includes('llama-3') && id.includes('sonar')) return 'perplexity';
  if (id.includes('llama-3') || id.includes('mixtral') || id.includes('gemma')) {
    if (id.includes('groq')) return 'groq';
  }
  if (id.includes('siliconflow') || id.includes('silicon-flow')) return 'siliconflow';
  if (id.includes('openrouter') || id.includes('anthropic/') || id.includes('openai/') || id.includes('google/')) {
    return 'openrouter';
  }

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

export function supportsReasoningContent(modelId: string, customConfig?: ModelThinkingConfig): boolean {
  if (customConfig) {
    return customConfig.supportsThinking ?? false;
  }

  const vendor = detectModelVendor(modelId);
  const modelConfig = getModelConfig(vendor, modelId);

  return modelConfig?.thinking ?? false;
}

export interface VendorSpecificParams {
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
  thinking_budget?: number;
  enable_thinking?: boolean;
  thinking?: { type: 'enabled' | 'disabled' | 'auto' };
}

export function buildVendorSpecificParams(
  modelId: string,
  options?: {
    enableThinking?: boolean;
    thinkingBudget?: number;
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  }
): VendorSpecificParams | undefined {
  const vendor = detectModelVendor(modelId);
  const id = modelId.toLowerCase();
  const params: VendorSpecificParams = {};

  const enableThinking = options?.enableThinking ?? true;
  const thinkingBudget = options?.thinkingBudget;
  const reasoningEffort = options?.reasoningEffort ?? 'medium';

  if (vendor === 'volcengine') {
    if (id.includes('doubao-seed-1-6-251015')) {
      params.reasoning_effort = reasoningEffort;
    }
  }

  if (vendor === 'alibaba') {
    if (id.includes('qwq') || id.includes('qwen3')) {
      if (thinkingBudget !== undefined) {
        params.thinking_budget = thinkingBudget;
      }
    }
  }

  if (vendor === 'minimax') {
    if (id.includes('m2') && thinkingBudget !== undefined) {
      params.thinking_budget = thinkingBudget;
    }
  }

  return Object.keys(params).length > 0 ? params : undefined;
}
