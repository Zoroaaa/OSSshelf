/**
 * features.ts
 * AI 文件处理功能模块（重构版）
 *
 * 功能:
 * - 文件摘要生成（支持自定义模型）
 * - 图片智能标签+描述（支持自定义模型）
 * - 智能重命名建议（支持自定义模型）
 * - 自动文件处理流程
 *
 * 改进:
 * - 统一使用 ModelGateway 调用模型
 * - 支持功能级模型配置
 * - 完善默认回退机制
 */

import type { Env } from '../../types/env';
import { getDb, files } from '../../db';
import { eq } from 'drizzle-orm';
import { getFileContent } from '../utils';
import { isEditableFile, logger, logAiError } from '@osshelf/shared';
import { indexFileVector, buildFileTextForVector } from '../vectorIndex';
import { ModelGateway } from './modelGateway';
import type { ChatCompletionRequest } from './types';

const SUMMARY_CONTENT_LIMIT = 8192;
const RENAME_CONTENT_LIMIT = 4096;

// 默认模型 ID（当用户未配置时使用）
const DEFAULT_MODELS = {
  summary: '@cf/meta/llama-3.1-8b-instruct',
  imageCaption: '@cf/llava-hf/llava-1.5-7b-hf',
  imageTag: '@cf/microsoft/resnet-50',
  rename: '@cf/meta/llama-3.1-8b-instruct',
} as const;

export interface SummaryResult {
  summary: string;
  cached: boolean;
}

export interface ImageTagResult {
  tags: string[];
  caption?: string;
}

export interface RenameSuggestion {
  suggestions: string[];
}

// 功能类型定义
export type AiFeatureType = 'summary' | 'imageCaption' | 'imageTag' | 'rename';

// 功能级模型配置接口
export interface FeatureModelConfig {
  summary?: string;      // 文件摘要模型 ID
  imageCaption?: string; // 图片描述模型 ID
  imageTag?: string;     // 图片标签模型 ID
  rename?: string;       // 智能重命名模型 ID
}

export function canGenerateSummary(mimeType: string | null, fileName: string): boolean {
  return isEditableFile(mimeType, fileName);
}

export function isImageFile(mimeType: string | null): boolean {
  return mimeType?.startsWith('image/') ?? false;
}

export function isAIConfigured(env: Env): boolean {
  return !!(env.AI && env.VECTORIZE);
}

/**
 * 获取用户的 功能级模型配置
 */
async function getFeatureModelConfig(env: Env, userId: string): Promise<FeatureModelConfig> {
  try {
    const configKey = `ai:feature-model-config:${userId}`;
    const cached = await env.KV.get(configKey, 'json');
    
    if (cached) {
      return cached as FeatureModelConfig;
    }
    
    return {};
  } catch (error) {
    logger.error('AI', 'Failed to get feature model config', { userId }, error);
    return {};
  }
}

/**
 * 通过 ModelGateway 调用聊天模型（统一入口）
 */
async function callChatModel(
  env: Env,
  userId: string,
  featureType: AiFeatureType,
  request: ChatCompletionRequest
): Promise<string> {
  const gateway = new ModelGateway(env);
  
  // 获取该功能的自定义模型配置
  const featureConfig = await getFeatureModelConfig(env, userId);
  const customModelId = featureConfig[featureType];
  
  try {
    // 尝试使用用户配置的自定义模型或默认活跃模型
    const response = await gateway.chatCompletion(userId, request, customModelId);
    return response.content;
  } catch (error) {
    // 如果失败，尝试使用 Workers AI 默认模型作为最终回退
    logger.warn('AI', 'Custom model failed, falling back to default', { featureType, error });
    
    const defaultModelId = DEFAULT_MODELS[featureType] || DEFAULT_MODELS.summary;
    
    // 直接调用 Workers AI（绕过 Gateway 的配置检查）
    if (env.AI) {
      const fallbackResponse = await (env.AI as any).run(defaultModelId, {
        messages: request.messages,
        max_tokens: request.maxTokens || 200,
        stream: false,
      });
      
      return (fallbackResponse as { response?: string }).response?.trim() || '';
    }
    
    throw error;
  }
}

/**
 * 调用图片理解模型（支持 vision 能力）
 */
async function callVisionModel(
  env: Env,
  userId: string,
  modelId: string,
  imageData: number[],
  prompt: string
): Promise<string> {
  const gateway = new ModelGateway(env);
  const featureConfig = await getFeatureModelConfig(env, userId);
  const customModelId = featureConfig.imageCaption;
  
  try {
    if (customModelId && env.AI) {
      // 使用用户配置的自定义 vision 模型
      const response = await (env.AI as any).run(customModelId, {
        image: imageData,
        prompt,
        max_tokens: 300,
      });
      
      return (response as { description?: string; response?: string }).description?.trim() 
        || (response as { response?: string }).response?.trim() 
        || '';
    }
    
    // 使用默认模型
    if (env.AI) {
      const response = await (env.AI as any).run(modelId, {
        image: imageData,
        prompt,
        max_tokens: 300,
      });
      
      return (response as { description?: string }).description?.trim() || '';
    }
    
    throw new Error('AI service not available');
  } catch (error) {
    logger.error('AI', 'Vision model call failed', { modelId }, error);
    throw error;
  }
}

/**
 * 调用图片分类模型（生成标签）
 */
async function callClassificationModel(
  env: Env,
  modelId: string,
  imageData: number[]
): Promise<unknown> {
  if (!env.AI) {
    throw new Error('AI service not configured');
  }

  return await (env.AI as any).run(modelId, {
    image: imageData,
  });
}

export async function generateFileSummary(
  env: Env,
  fileId: string,
  content?: string,
  userId?: string
): Promise<SummaryResult> {
  if (!env.AI) {
    throw new Error('AI service not configured');
  }

  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file) {
    throw new Error('File not found');
  }

  const cacheKey = `ai:summary:${fileId}:${file.hash || file.updatedAt}`;
  const cached = await env.KV.get(cacheKey);

  if (cached) {
    return { summary: cached, cached: true };
  }

  let textContent = content;
  if (!textContent) {
    textContent = await extractTextFromFile(env, file);
  }

  if (!textContent) {
    throw new Error('无法获取文件内容，请检查文件存储配置');
  }

  if (textContent.length < 50) {
    throw new Error('文件内容太短（少于50字符），无法生成摘要');
  }

  const truncatedContent = textContent.slice(0, SUMMARY_CONTENT_LIMIT);

  try {
    const summary = await callChatModel(
      env,
      userId || file.userId || 'default',
      'summary',
      {
        messages: [
          {
            role: 'system',
            content:
              '你是文件助手。请用简洁的中文（不超过3句话）概括文件内容。如果内容是代码，请说明代码的主要功能。',
          },
          {
            role: 'user',
            content: truncatedContent,
          },
        ],
        maxTokens: 200,
      }
    );

    await Promise.all([
      env.KV.put(cacheKey, summary, { expirationTtl: 86400 }),
      db.update(files).set({ aiSummary: summary, aiSummaryAt: new Date().toISOString() }).where(eq(files.id, fileId)),
    ]);

    return { summary, cached: false };
  } catch (error) {
    logAiError('生成摘要', fileId, error);
    throw error;
  }
}

export async function generateImageTags(
  env: Env,
  fileId: string,
  imageBuffer?: ArrayBuffer,
  userId?: string
): Promise<ImageTagResult> {
  if (!env.AI) {
    throw new Error('AI service not configured');
  }

  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file) {
    throw new Error('File not found');
  }

  let imageData = imageBuffer;
  if (!imageData) {
    imageData = (await fetchFileContentAsBuffer(env, file)) ?? undefined;
  }

  if (!imageData) {
    throw new Error('无法获取图片数据，请检查文件存储配置');
  }

  const uint8Array = new Uint8Array(imageData);

  try {
    const [captionResult, tagResult] = await Promise.allSettled([
      callVisionModel(
        env,
        userId || file.userId || 'default',
        DEFAULT_MODELS.imageCaption,
        Array.from(uint8Array),
        'Describe this image in detail. If there is any text in the image, please transcribe it accurately. Respond in the same language as the text in the image, or in Chinese if no text is present.'
      ),
      callClassificationModel(env, DEFAULT_MODELS.imageTag, Array.from(uint8Array)),
    ]);

    let caption = '';
    if (captionResult.status === 'fulfilled') {
      caption = captionResult.value;
    }

    let tags: string[] = [];
    if (tagResult.status === 'fulfilled') {
      tags = parseImageTags(tagResult.value);
    }

    const now = new Date().toISOString();
    await db
      .update(files)
      .set({
        aiTags: JSON.stringify(tags),
        aiTagsAt: now,
        ...(caption ? { aiSummary: caption, aiSummaryAt: now } : {}),
      })
      .where(eq(files.id, fileId));

    return { tags, caption };
  } catch (error) {
    logAiError('生成图片标签', fileId, error);
    throw error;
  }
}

export async function suggestFileName(
  env: Env,
  fileId: string,
  content?: string,
  userId?: string
): Promise<RenameSuggestion> {
  if (!env.AI) {
    throw new Error('AI service not configured');
  }

  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file) {
    throw new Error('File not found');
  }

  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';

  let contextForAI: string;
  let isContentBased = false;

  if (canGenerateSummary(file.mimeType, file.name)) {
    let textContent = content;
    if (!textContent) {
      textContent = await extractTextFromFile(env, file);
    }
    if (textContent && textContent.length >= 30) {
      contextForAI = `文件内容（前${RENAME_CONTENT_LIMIT}字）：\n${textContent.slice(0, RENAME_CONTENT_LIMIT)}`;
      isContentBased = true;
    } else {
      contextForAI = `文件类型：${file.mimeType || '未知'}`;
    }
  } else {
    const hints = [
      `文件类型：${file.mimeType || '未知'}`,
      file.aiSummary ? `AI描述：${file.aiSummary}` : '',
      file.aiTags ? `AI标签：${JSON.parse(file.aiTags).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    contextForAI = hints;
  }

  try {
    const responseText = await callChatModel(
      env,
      userId || file.userId || 'default',
      'rename',
      {
        messages: [
          {
            role: 'system',
            content: `你是文件命名助手。根据提供的信息，建议3个简洁、有意义的中文文件名。
规则：
1. 每个文件名不超过20个字
2. 保留文件扩展名 ${ext || '（无扩展名）'}
3. 每行一个文件名，不加编号、不加解释
4. 文件名要能反映文件主要内容
5. 只输出文件名，不输出其他任何内容`,
          },
          {
            role: 'user',
            content: `原文件名：${file.name}\n${contextForAI}`,
          },
        ],
        maxTokens: 150,
      }
    );

    const suggestions = responseText
      .split('\n')
      .map((s: string) => s.trim())
      .filter((s: string) => {
        if (!s || s.length === 0) return false;
        if (isContentBased && ext && !s.includes('.')) return false;
        return s.length <= 50;
      })
      .slice(0, 3);

    return { suggestions };
  } catch (error) {
    logAiError('智能重命名', fileId, error);
    throw error;
  }
}

export async function suggestFileNameFromContent(
  env: Env,
  content: string,
  mimeType: string | null,
  extension: string,
  userId?: string
): Promise<RenameSuggestion> {
  if (!env.AI) {
    throw new Error('AI service not configured');
  }

  if (!content || content.trim().length < 30) {
    throw new Error('文件内容太短（少于30字符），无法生成命名建议');
  }

  const ext = extension || '';

  try {
    const responseText = await callChatModel(
      env,
      userId || 'default',
      'rename',
      {
        messages: [
          {
            role: 'system',
            content: `你是文件命名助手。根据提供的文件内容，建议3个简洁、有意义的中文文件名。
规则：
1. 每个文件名不超过20个字
2. 保留文件扩展名 ${ext || '（无扩展名）'}
3. 每行一个文件名，不加编号、不加解释
4. 文件名要能反映文件主要内容
5. 只输出文件名，不输出其他任何内容`,
          },
          {
            role: 'user',
            content: `文件类型：${mimeType || '未知'}\n文件内容（前${RENAME_CONTENT_LIMIT}字）：\n${content.slice(0, RENAME_CONTENT_LIMIT)}`,
          },
        ],
        maxTokens: 150,
      }
    );

    const suggestions = responseText
      .split('\n')
      .map((s: string) => s.trim())
      .filter((s: string) => {
        if (!s || s.length === 0) return false;
        return s.length <= 50;
      })
      .slice(0, 3);

    return { suggestions };
  } catch (error) {
    logAiError('智能命名', 'new-file', error);
    throw error;
  }
}

async function extractTextFromFile(env: Env, file: typeof files.$inferSelect): Promise<string> {
  if (!canGenerateSummary(file.mimeType, file.name)) {
    return '';
  }

  try {
    const content = await fetchFileContentAsBuffer(env, file);
    if (!content) return '';

    const decoder = new TextDecoder('utf-8');
    return decoder.decode(content).slice(0, SUMMARY_CONTENT_LIMIT);
  } catch (error) {
    logger.error('AI', '提取文件文本失败', { fileId: file.id }, error);
    return '';
  }
}

async function fetchFileContentAsBuffer(env: Env, file: typeof files.$inferSelect): Promise<ArrayBuffer | null> {
  if (!file.bucketId || !file.r2Key) {
    return null;
  }

  try {
    return await getFileContent(env, file.bucketId, file.r2Key);
  } catch (error) {
    logger.error('AI', '获取文件内容失败', { fileId: file.id, r2Key: file.r2Key }, error);
    return null;
  }
}

function parseImageTags(result: unknown): string[] {
  if (!result) return [];

  const tags: string[] = [];

  if (Array.isArray(result)) {
    for (const item of result) {
      if (item && typeof item === 'object' && 'label' in item && typeof item.label === 'string') {
        tags.push(item.label.trim());
      }
    }
  } else if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;
    if (typeof obj.label === 'string') {
      tags.push(...obj.label.split(',').map((t: string) => t.trim()));
    }
  }

  return [...new Set(tags)].slice(0, 5);
}

export async function autoProcessFile(env: Env, fileId: string, userId?: string): Promise<void> {
  if (!env.AI) {
    return;
  }

  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file || file.isFolder) {
    return;
  }

  const effectiveUserId = userId || file.userId || 'default';
  const tasks: Promise<void>[] = [];

  if (isImageFile(file.mimeType)) {
    tasks.push(
      generateImageTags(env, fileId, undefined, effectiveUserId)
        .then(() => {})
        .catch((error) => {
          logAiError('自动图片标签', fileId, error);
        })
    );
  }

  if (canGenerateSummary(file.mimeType, file.name)) {
    tasks.push(
      generateFileSummary(env, fileId, undefined, effectiveUserId)
        .then(() => {})
        .catch((error) => {
          logAiError('自动摘要', fileId, error);
        })
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);

    if (env.VECTORIZE) {
      try {
        const text = await buildFileTextForVector(env, fileId);
        if (text && text.trim().length > 0) {
          await indexFileVector(env, fileId, text);
        }
      } catch (error) {
        logAiError('自动向量索引', fileId, error);
      }
    }
  }
}
