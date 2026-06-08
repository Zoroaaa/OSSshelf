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
import { getDb, files, storageBuckets, fileVersions } from '../../db';
import { eq, desc, and } from 'drizzle-orm';
import { getEncryptionKey } from '../crypto';
import { isEditableFile, logger, logAiError } from '@osshelf/shared';
import { indexFileVector, buildFileTextForVector } from './vectorIndex';
import { createTaskRecord } from './aiTaskQueue';
import { ModelGateway } from './modelGateway';
import type { ChatCompletionRequest } from './types';
import { decryptSecret } from '../s3client';
import { getAiConfigString, getAiConfigNumber, getAiConfigBoolean } from './aiConfigService';
import { uint8ArrayToBase64, fetchFileBuffer, buildVisionMessageContent } from './utils';
import type { AiFeatureType } from './types';
import type { TelegramBotConfig } from '../telegramClient';

const SUMMARY_PROMPTS: Record<string, string> = {
  default: '你是文件助手。请用简洁的中文（不超过3句话）概括文件主要内容。',
  code: '你是代码分析助手。请概括以下代码的功能、主要类/函数/接口、核心逻辑。（不超过4句话）',
  markdown: '你是技术文档助手。请概括 Markdown 文档的结构、主要章节和核心内容。（不超过3句话）',
  data: '你是数据分析助手。请概括数据/配置文件的结构、关键字段和主要内容。（不超过3句话）',
};

async function getSummaryPromptFromConfig(env: Env): Promise<Record<string, string>> {
  try {
    const defaultPrompt = await getAiConfigString(env, 'ai.summary.prompt.default', SUMMARY_PROMPTS.default);
    const codePrompt = await getAiConfigString(env, 'ai.summary.prompt.code', SUMMARY_PROMPTS.code);
    const markdownPrompt = await getAiConfigString(env, 'ai.summary.prompt.markdown', SUMMARY_PROMPTS.markdown);
    const dataPrompt = await getAiConfigString(env, 'ai.summary.prompt.data', SUMMARY_PROMPTS.data);

    return {
      default: defaultPrompt,
      code: codePrompt,
      markdown: markdownPrompt,
      data: dataPrompt,
    };
  } catch (error) {
    logger.warn('AI', 'Failed to load prompts from config, using defaults');
    return SUMMARY_PROMPTS;
  }
}

function getSummaryPrompt(mimeType: string | null, fileName: string, customPrompts?: Record<string, string>): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const codeExts = [
    'js',
    'jsx',
    'ts',
    'tsx',
    'py',
    'java',
    'go',
    'rs',
    'c',
    'cpp',
    'h',
    'hpp',
    'cs',
    'rb',
    'php',
    'swift',
    'kt',
    'scala',
    'r',
    'sql',
    'sh',
    'bash',
    'html',
    'htm',
    'css',
    'scss',
    'less',
    'vue',
    'svelte',
  ];

  const dataExts = ['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env'];

  const prompts = customPrompts || SUMMARY_PROMPTS;

  if (ext === 'md' || ext === 'markdown') {
    return prompts.markdown;
  }

  if (codeExts.includes(ext)) {
    return prompts.code;
  }

  if (dataExts.includes(ext)) {
    return prompts.data;
  }

  if (
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    mimeType?.includes('yaml')
  ) {
    return prompts.data;
  }

  if (mimeType?.startsWith('text/') && mimeType !== 'text/plain') {
    return prompts.code;
  }

  return prompts.default;
}

// 默认模型 ID（当用户未配置时使用）- 现在从配置表读取
async function getDefaultModels(env: Env): Promise<Record<string, string>> {
  try {
    return {
      summary: await getAiConfigString(env, 'ai.default_model.summary', '@cf/meta/llama-3.1-8b-instruct'),
      imageCaption: await getAiConfigString(env, 'ai.default_model.image_caption', '@cf/llava-hf/llava-1.5-7b-hf'),
      imageTag: await getAiConfigString(env, 'ai.default_model.image_tag', '@cf/llava-hf/llava-1.5-7b-hf'),
      rename: await getAiConfigString(env, 'ai.default_model.rename', '@cf/meta/llama-3.1-8b-instruct'),
    };
  } catch (error) {
    logger.warn('AI', 'Failed to load default models from config, using hardcoded fallback');
    return {
      summary: '@cf/meta/llama-3.1-8b-instruct',
      imageCaption: '@cf/llava-hf/llava-1.5-7b-hf',
      imageTag: '@cf/llava-hf/llava-1.5-7b-hf',
      rename: '@cf/meta/llama-3.1-8b-instruct',
    };
  }
}

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

// 功能级模型配置接口
export interface FeatureModelConfig {
  summary?: string;
  imageCaption?: string;
  imageTag?: string;
  rename?: string;
}

// AiFeatureType 到 FeatureModelConfig 键名的映射
function mapFeatureTypeToConfigKey(featureType: string): keyof FeatureModelConfig {
  const mapping: Record<string, keyof FeatureModelConfig> = {
    file_summary: 'summary',
    summary: 'summary',
    image_caption: 'imageCaption',
    image_tag: 'imageTag',
    image_analysis: 'imageCaption',
    chat: 'summary',
    rename: 'rename',
  };
  return mapping[featureType] || 'summary';
}

export function canGenerateSummary(mimeType: string | null, fileName: string): boolean {
  return isEditableFile(mimeType, fileName);
}

export function isImageFile(mimeType: string | null): boolean {
  return mimeType?.startsWith('image/') ?? false;
}

/**
 * 判断文件是否应该建立向量索引
 *
 * 核心原则：
 * 1. 向量索引通过 buildFileTextForVector() 构建文本，会自动降级到元数据
 * 2. 即使是图片/视频，如果有 AI 标签/摘要，索引也有意义
 * 3. 只排除明确无意义的情况：超大文件、压缩包、二进制可执行文件
 *
 * 使用场景：
 * - 文件上传时自动触发索引
 * - 批量手动索引时过滤无效文件
 */
export function shouldIndexFile(mimeType: string | null, fileSize?: number): boolean {
  // 注意：不做文件大小限制。
  // buildFileTextForVector 内部已对内容截断至 50000 字符，
  // 分块上限 20 块，实际送给 embedding 的 token 量是固定的，
  // 大文件不会增加嵌入成本。

  // 无 MIME 类型时允许尝试（依赖文件名和元数据）
  if (!mimeType) return true;

  // 压缩包 → 无法提取有意义的内容，且文件名通常无语义价值
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-rar-compressed' ||
    mimeType === 'application/x-7z-compressed' ||
    mimeType === 'application/x-tar' ||
    mimeType === 'application/gzip'
  ) {
    return false;
  }

  // 可执行文件 → 无语义价值
  if (mimeType === 'application/x-msdownload' || mimeType === 'application/x-dosexec') {
    return false;
  }

  // 其余类型都允许索引：
  // - text/*, application/json, PDF, 代码等 → 提取内容
  // - image/video/audio → 降级使用文件名 + AI 标签 + AI 摘要
  return true;
}

export function isAIConfigured(env: Env): boolean {
  return !!(env.AI || env.VECTORIZE);
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
 * 智能识别模型类型，支持自定义模型和 Workers AI
 */
async function callChatModel(
  env: Env,
  userId: string,
  featureType: AiFeatureType,
  request: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<string> {
  const gateway = new ModelGateway(env);
  const defaultModels = await getDefaultModels(env);
  const featureConfig = await getFeatureModelConfig(env, userId);
  const configKey = mapFeatureTypeToConfigKey(featureType);
  const customModelId = featureConfig[configKey];
  const effectiveModelId = customModelId || defaultModels[configKey] || defaultModels.summary;

  const resolved = await gateway.resolveModelForCall(userId, effectiveModelId);

  try {
    if (resolved.type === 'custom') {
      const response = await gateway.chatCompletion(userId, { ...request, featureType }, effectiveModelId, signal);
      return response.content;
    }

    if (env.AI) {
      const fallbackResponse = await (env.AI as any).run(effectiveModelId, {
        messages: request.messages,
        stream: false,
      });

      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      return (fallbackResponse as { response?: string }).response?.trim() || '';
    }

    throw new Error('AI service not available');
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw error;
    }

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }

    logger.error('AI', 'Chat model call failed', { featureType, modelId: effectiveModelId }, error);
    throw error;
  }
}

/**
 * 调用图片理解模型（支持 vision 能力）
 * 智能识别模型类型：
 * - 如果模型ID在用户的 ai_models 表中 → 通过 ModelGateway 调用
 * - 否则 → 假设是 Workers AI 模型，用 env.AI.run() 调用
 */
async function callVisionModel(
  env: Env,
  userId: string,
  defaultModelId: string,
  imageData: number[],
  prompt: string,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  const gateway = new ModelGateway(env);
  const featureConfig = await getFeatureModelConfig(env, userId);
  const effectiveModelId = featureConfig.imageCaption || defaultModelId;

  const resolved = await gateway.resolveModelForCall(userId, effectiveModelId);

  try {
    if (resolved.type === 'custom') {
      const customModel = resolved.config;
      if (customModel.provider === 'openai_compatible') {
        if (!customModel.capabilities.includes('vision')) {
          logger.warn('AI', 'Custom model does not support vision, falling back to Workers AI', {
            modelId: effectiveModelId,
            capabilities: customModel.capabilities,
          });
          return await callWorkersAiVision(env, defaultModelId, imageData, prompt);
        }
        const base64Image = uint8ArrayToBase64(imageData);
        const response = await gateway.chatCompletion(
          userId,
          {
            messages: [
              {
                role: 'user',
                content: buildVisionMessageContent(base64Image, mimeType, prompt),
              },
            ],
            featureType: 'image_caption',
          },
          effectiveModelId
        );
        return response.content.trim() || '';
      } else if (env.AI) {
        const uint8Array = new Uint8Array(imageData);
        const response = await (env.AI as any).run(effectiveModelId, {
          image: uint8Array,
          prompt,
        });
        return (
          (response as { description?: string; response?: string }).description?.trim() ||
          (response as { response?: string }).response?.trim() ||
          ''
        );
      }
    }

    return await callWorkersAiVision(env, effectiveModelId, imageData, prompt);
  } catch (error) {
    logger.error('AI', 'Vision model call failed', { modelId: effectiveModelId }, error);
    throw error;
  }
}

async function callWorkersAiVision(env: Env, modelId: string, imageData: number[], prompt: string): Promise<string> {
  if (!env.AI) {
    throw new Error('AI service not available');
  }
  const response = await (env.AI as any).run(modelId, {
    image: imageData,
    prompt,
  });
  return (response as { description?: string }).description?.trim() || '';
}

const IMAGE_TAG_PROMPT = `请分析这张图片，生成5-8个描述性标签。

要求：
1. 标签应该描述图片的主要内容、物体、场景、颜色、风格等
2. 每个标签2-6个字，使用中文
3. 只输出标签，用逗号分隔，不要其他任何内容
4. 示例格式：风景,山脉,日落,自然,户外,宁静`;

/**
 * 调用视觉模型生成图片标签
 * 智能识别模型类型，支持自定义模型和 Workers AI
 */
async function callVisionModelForTags(
  env: Env,
  userId: string,
  defaultModelId: string,
  imageData: number[],
  mimeType: string = 'image/jpeg'
): Promise<string[]> {
  const gateway = new ModelGateway(env);
  const featureConfig = await getFeatureModelConfig(env, userId);
  const effectiveModelId = featureConfig.imageTag || defaultModelId;
  const resolved = await gateway.resolveModelForCall(userId, effectiveModelId);

  try {
    if (resolved.type === 'custom') {
      const customModel = resolved.config;
      if (customModel.provider === 'openai_compatible') {
        if (!customModel.capabilities.includes('vision')) {
          logger.warn('AI', 'Custom model does not support vision for tags, falling back to Workers AI', {
            modelId: effectiveModelId,
            capabilities: customModel.capabilities,
          });
          return await callWorkersAiVisionForTags(env, defaultModelId, imageData);
        }
        const base64Image = uint8ArrayToBase64(imageData);
        const response = await gateway.chatCompletion(
          userId,
          {
            messages: [
              {
                role: 'user',
                content: buildVisionMessageContent(base64Image, mimeType, IMAGE_TAG_PROMPT),
              },
            ],
            featureType: 'image_tag',
          },
          effectiveModelId
        );
        return parseTagsFromText(response.content);
      } else if (env.AI) {
        const uint8Array = new Uint8Array(imageData);
        const response = await (env.AI as any).run(effectiveModelId, {
          image: uint8Array,
          prompt: IMAGE_TAG_PROMPT,
        });
        const text =
          (response as { description?: string; response?: string }).description?.trim() ||
          (response as { response?: string }).response?.trim() ||
          '';
        return parseTagsFromText(text);
      }
    }

    return await callWorkersAiVisionForTags(env, effectiveModelId, imageData);
  } catch (error) {
    logger.error('AI', 'Vision model for tags call failed', { modelId: effectiveModelId }, error);
    throw error;
  }
}

async function callWorkersAiVisionForTags(env: Env, modelId: string, imageData: number[]): Promise<string[]> {
  if (!env.AI) {
    throw new Error('AI service not available');
  }
  const response = await (env.AI as any).run(modelId, {
    image: imageData,
    prompt: IMAGE_TAG_PROMPT,
  });
  const text = (response as { description?: string }).description?.trim() || '';
  return parseTagsFromText(text);
}

/**
 * 从文本中解析标签
 */
function safeParseTags(aiTagsJson: string): string {
  try {
    const tags: string[] = JSON.parse(aiTagsJson);
    return tags.join(', ');
  } catch {
    return aiTagsJson;
  }
}

function parseTagsFromText(text: string): string[] {
  if (!text) return [];

  const tags = text
    .split(/[,，、\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 10)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !/^(标签|tag|tags)$/i.test(t));

  return [...new Set(tags)].slice(0, 8);
}

export async function generateFileSummary(
  env: Env,
  fileId: string,
  content?: string,
  userId?: string,
  signal?: AbortSignal
): Promise<SummaryResult> {
  if (!env.AI) {
    throw new Error('AI service not configured');
  }

  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file) {
    throw new Error('File not found');
  }

  const cacheKey = `ai:summary:${fileId}:${file.hash || 'unknown'}`;
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

  try {
    const customPrompts = await getSummaryPromptFromConfig(env);
    const summary = await callChatModel(
      env,
      userId || file.userId || 'default',
      'summary',
      {
        messages: [
          {
            role: 'system',
            content: getSummaryPrompt(file.mimeType, file.name, customPrompts),
          },
          {
            role: 'user',
            content: textContent,
          },
        ],
      },
      signal
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
    imageData = (await fetchFileBuffer(env, file)) ?? undefined;
  }

  if (!imageData) {
    throw new Error('无法获取图片数据，请检查文件存储配置');
  }

  const uint8Array = new Uint8Array(imageData);
  const effectiveUserId = userId || file.userId || 'default';
  const defaultModels = await getDefaultModels(env);
  const actualMimeType = file.mimeType || 'image/jpeg';

  try {
    const [captionResult, tagResult] = await Promise.allSettled([
      callVisionModel(
        env,
        effectiveUserId,
        defaultModels.imageCaption,
        Array.from(uint8Array),
        '请详细描述这张图片的内容，包括画面主体、颜色、构图等。如果有文字请准确转录。使用中文回答。',
        actualMimeType
      ),
      callVisionModelForTags(env, effectiveUserId, defaultModels.imageTag, Array.from(uint8Array), actualMimeType),
    ]);

    let caption = '';
    if (captionResult.status === 'fulfilled') {
      caption = captionResult.value;
    }

    let tags: string[] = [];
    if (tagResult.status === 'fulfilled') {
      tags = tagResult.value;
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
      contextForAI = `文件内容：\n${textContent}`;
      isContentBased = true;
    } else {
      contextForAI = `文件类型：${file.mimeType || '未知'}`;
    }
  } else {
    const hints = [
      `文件类型：${file.mimeType || '未知'}`,
      file.aiSummary ? `AI描述：${file.aiSummary}` : '',
      file.aiTags ? `AI标签：${safeParseTags(file.aiTags)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    contextForAI = hints;
  }

  try {
    const responseText = await callChatModel(env, userId || file.userId || 'default', 'rename', {
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
    });

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
    const responseText = await callChatModel(env, userId || 'default', 'rename', {
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
          content: `文件类型：${mimeType || '未知'}\n文件内容：\n${content}`,
        },
      ],
    });

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
    const content = await fetchFileBuffer(env, file);
    if (!content) return '';

    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(content);
    // 截断超长文本，避免大文件（如小说）token 爆炸导致超时
    // 8000字符 ≈ 2000~3000 tokens，足够生成高质量摘要
    const MAX_CHARS = 8000;
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  } catch (error) {
    logger.error('AI', '提取文件文本失败', { fileId: file.id }, error);
    return '';
  }
}

export async function resolveTgConfig(env: Env, bucketId: string): Promise<TelegramBotConfig | null> {
  const db = getDb(env.DB);
  const bucket = await db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId)).get();
  if (!bucket || bucket.provider !== 'telegram') return null;
  const encKey = getEncryptionKey(env);
  const botToken = await decryptSecret(bucket.accessKeyId, encKey);
  return { botToken, chatId: bucket.bucketName, apiBase: bucket.endpoint || undefined };
}

export async function autoProcessFile(env: Env, fileId: string, userId?: string): Promise<void> {
  await enqueueAutoProcessFile(env, fileId, userId);
}

/**
 * 将文件上传后的自动AI处理任务入队（推荐方式）
 * 根据文件类型自动判断需要执行的任务：
 * - 图片文件：tags（标签生成）+ summary（图片描述）
 * - 可编辑文本文件：summary（摘要生成）
 * - 所有已处理文件：index（向量索引，需 VECTORIZE 配置）
 *
 * 优先使用 Queue 异步执行（独立 Worker、自动重试、不受请求 CPU 时间限制），
 * 无队列配置时降级为同步直接执行。
 */
export async function enqueueAutoProcessFile(env: Env, fileId: string, userId?: string): Promise<void> {
  if (!isAIConfigured(env)) {
    return;
  }

  const autoProcessEnabled = await getAiConfigBoolean(env, 'ai.feature.auto_process_enabled', true);
  if (!autoProcessEnabled) {
    logger.debug('AI', '自动处理功能已禁用', { fileId });
    return;
  }

  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file || file.isFolder) {
    return;
  }

  const effectiveUserId = userId || file.userId || 'default';

  const taskTypes: Array<'index' | 'summary' | 'tags'> = [];

  if (isImageFile(file.mimeType)) {
    taskTypes.push('tags');
  }

  if (canGenerateSummary(file.mimeType, file.name)) {
    taskTypes.push('summary');
  }

  // 向量索引：独立判断是否需要索引
  // 即使不需要 summary/tags，只要文件内容可提取就应该建立索引
  const vectorIndexEnabled = await getAiConfigBoolean(env, 'ai.feature.vector_index_enabled', true);
  if (env.VECTORIZE && vectorIndexEnabled) {
    // 检查文件是否适合建立向量索引
    if (shouldIndexFile(file.mimeType, file.size)) {
      taskTypes.push('index');
    }
  }

  if (taskTypes.length === 0) {
    return;
  }

  if (env.AI_TASKS_QUEUE) {
    try {
      // 分离内容任务和索引任务
      const contentTaskTypes = taskTypes.filter((t) => t !== 'index') as Array<'summary' | 'tags'>;
      const hasIndexOnly = contentTaskTypes.length === 0 && taskTypes.includes('index');

      // 纯索引任务：直接创建 index 任务并入队
      if (hasIndexOnly) {
        const task = await createTaskRecord(env, 'index', effectiveUserId, 1);
        await (env.AI_TASKS_QUEUE as any).send({
          body: {
            type: 'index',
            fileId,
            userId: effectiveUserId,
            taskId: task.id,
          },
        });
        logger.info('AI', '文件向量索引任务已入队（纯索引）', { fileId, userId: effectiveUserId });
        return;
      }

      // 混合任务：先执行 summary/tags，完成后自动触发 index
      const task = await createTaskRecord(env, contentTaskTypes[0], effectiveUserId, contentTaskTypes.length);
      const taskId = task.id;
      const needIndex = taskTypes.includes('index');

      const messages = contentTaskTypes.map((type, index) => ({
        body: {
          type,
          fileId,
          userId: effectiveUserId,
          taskId,
          // 只有最后一个任务且需要索引时才触发（避免重复索引）
          triggerIndexOnComplete: needIndex && index === contentTaskTypes.length - 1,
        } as import('../../types/env').AiTaskMessage,
      }));

      await env.AI_TASKS_QUEUE.sendBatch(messages);
      logger.info('AI', '文件AI处理任务已入队', {
        fileId,
        taskTypes: contentTaskTypes,
        needIndex,
        userId: effectiveUserId,
      });
      return;
    } catch (error) {
      logger.warn('AI', '队列发送失败，降级为同步处理', { fileId }, error);
    }
  }

  await autoProcessFileDirect(env, file, effectiveUserId);
}

async function autoProcessFileDirect(env: Env, file: typeof files.$inferSelect, userId: string): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (isImageFile(file.mimeType)) {
    tasks.push(
      generateImageTags(env, file.id, undefined, userId)
        .then(() => {})
        .catch((error) => {
          logAiError('自动图片标签', file.id, error);
        })
    );
  }

  if (canGenerateSummary(file.mimeType, file.name)) {
    tasks.push(
      generateFileSummary(env, file.id, undefined, userId)
        .then(() => {})
        .catch((error) => {
          logAiError('自动摘要', file.id, error);
        })
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);

    if (env.VECTORIZE) {
      try {
        const text = await buildFileTextForVector(env, file.id);
        if (text && text.trim().length > 0) {
          await indexFileVector(env, file.id, text);
        }
      } catch (error) {
        logAiError('自动向量索引', file.id, error);
      }
    }
  }
}

export async function generateVersionSummary(
  env: Env,
  fileId: string,
  newVersionId: string,
  userId?: string
): Promise<void> {
  const db = getDb(env.DB);

  const versions = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.version))
    .limit(2)
    .all();

  if (versions.length < 2) return;

  const [newVer, oldVer] = versions;
  if (!canGenerateSummary(newVer.mimeType, newVer.r2Key || '')) return;

  try {
    const newText = await buildFileTextForVector(env, fileId);
    if (!newText || newText.length < 50) return;

    const summary = await callChatModel(env, userId || 'default', 'summary', {
      messages: [
        {
          role: 'system',
          content: '你是文件变更分析助手。用 1-2 句话描述这次文件更新的主要变化。只关注内容变化，不提文件名或时间。',
        },
        {
          role: 'user',
          content: `版本：v${oldVer.version} → v${newVer.version}\n当前内容摘要：\n${newText.slice(0, 2000)}`,
        },
      ],
    });

    if (summary && summary.trim().length > 0) {
      await db.update(fileVersions).set({ aiChangeSummary: summary.trim() }).where(eq(fileVersions.id, newVersionId));
      logger.info('AI', '版本摘要生成成功', { fileId, versionId: newVersionId });
    }
  } catch (error) {
    logger.error('AI', '版本摘要生成失败', { fileId, newVersionId }, error);
  }
}
