/**
 * aiFeatures.ts
 * AI 功能模块
 *
 * 功能:
 * - 文件摘要生成（自动触发）
 * - 图片智能描述（自动触发）
 * - 智能重命名建议
 */

import type { Env } from '../types/env';
import { getDb, files } from '../db';
import { eq } from 'drizzle-orm';
import { getFileContent } from './utils';
import { isEditableFile } from '@osshelf/shared';
import { indexFileVector, buildFileTextForVector } from './vectorIndex';

const SUMMARY_MODEL = '@cf/meta/llama-3.1-8b-instruct' as const;
const IMAGE_CAPTION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf' as const;
const IMAGE_TAG_MODEL = '@cf/microsoft/resnet-50' as const;

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

export function canGenerateSummary(mimeType: string | null, fileName: string): boolean {
  return isEditableFile(mimeType, fileName);
}

export function isImageFile(mimeType: string | null): boolean {
  return mimeType?.startsWith('image/') ?? false;
}

export function isAIConfigured(env: Env): boolean {
  return !!(env.AI && env.VECTORIZE);
}

export async function generateFileSummary(env: Env, fileId: string, content?: string): Promise<SummaryResult> {
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

  const truncatedContent = textContent.slice(0, 4096);

  try {
    const response = await (env.AI as any).run(SUMMARY_MODEL, {
      messages: [
        {
          role: 'system',
          content: '你是文件助手。请用简洁的中文（不超过3句话）概括文件内容。如果内容是代码，请说明代码的主要功能。',
        },
        {
          role: 'user',
          content: truncatedContent,
        },
      ],
      max_tokens: 200,
    });

    const summary = (response as { response?: string }).response?.trim() || '';

    await Promise.all([
      env.KV.put(cacheKey, summary, { expirationTtl: 86400 }),
      db.update(files).set({ aiSummary: summary, aiSummaryAt: new Date().toISOString() }).where(eq(files.id, fileId)),
    ]);

    return { summary, cached: false };
  } catch (error) {
    console.error('Failed to generate summary:', error);
    throw error;
  }
}

export async function generateImageTags(env: Env, fileId: string, imageBuffer?: ArrayBuffer): Promise<ImageTagResult> {
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
      (env.AI as any).run(IMAGE_CAPTION_MODEL, {
        image: Array.from(uint8Array),
        prompt:
          'Describe this image in detail. If there is any text in the image, please transcribe it accurately. Respond in the same language as the text in the image, or in Chinese if no text is present.',
        max_tokens: 300,
      }),
      (env.AI as any).run(IMAGE_TAG_MODEL, {
        image: Array.from(uint8Array),
      }),
    ]);

    let caption = '';
    if (captionResult.status === 'fulfilled') {
      const r = captionResult.value as { description?: string };
      caption = r.description?.trim() || '';
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
        // caption 存入 aiSummary，供语义搜索使用
        ...(caption ? { aiSummary: caption, aiSummaryAt: now } : {}),
      })
      .where(eq(files.id, fileId));

    return { tags, caption };
  } catch (error) {
    console.error('Failed to generate image tags:', error);
    throw error;
  }
}

export async function suggestFileName(env: Env, fileId: string, content?: string): Promise<RenameSuggestion> {
  if (!env.AI) {
    throw new Error('AI service not configured');
  }

  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file) {
    throw new Error('File not found');
  }

  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';

  // 文本文件：用实际内容；非文本文件：用文件名+mimeType 让 AI 猜
  let contextForAI: string;
  let isContentBased = false;

  if (canGenerateSummary(file.mimeType, file.name)) {
    let textContent = content;
    if (!textContent) {
      textContent = await extractTextFromFile(env, file);
    }
    if (textContent && textContent.length >= 30) {
      contextForAI = `文件内容（前2000字）：\n${textContent.slice(0, 2000)}`;
      isContentBased = true;
    } else {
      contextForAI = `文件类型：${file.mimeType || '未知'}`;
    }
  } else {
    // 图片/PDF/视频等：用 mimeType + 已有 aiSummary/aiTags 辅助
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
    const response = await (env.AI as any).run(SUMMARY_MODEL, {
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
      max_tokens: 150,
    });

    const responseText = (response as { response?: string }).response || '';
    const suggestions = responseText
      .split('\n')
      .map((s: string) => s.trim())
      .filter((s: string) => {
        if (!s || s.length === 0) return false;
        // 过滤掉 AI 可能输出的解释性文字（不包含文件扩展名或太长）
        if (isContentBased && ext && !s.includes('.')) return false;
        return s.length <= 50;
      })
      .slice(0, 3);

    return { suggestions };
  } catch (error) {
    console.error('Failed to suggest file name:', error);
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
    return decoder.decode(content).slice(0, 4096);
  } catch {
    return '';
  }
}

async function fetchFileContentAsBuffer(env: Env, file: typeof files.$inferSelect): Promise<ArrayBuffer | null> {
  if (!file.bucketId || !file.r2Key) {
    return null;
  }

  try {
    return await getFileContent(env, file.bucketId, file.r2Key);
  } catch {
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

export async function autoProcessFile(env: Env, fileId: string): Promise<void> {
  if (!env.AI) {
    return;
  }

  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();

  if (!file || file.isFolder) {
    return;
  }

  const tasks: Promise<void>[] = [];

  if (isImageFile(file.mimeType)) {
    tasks.push(
      generateImageTags(env, fileId).then(
        () => {},
        (e) => {
          console.error(`Failed to generate image tags for ${fileId}:`, e);
        }
      )
    );
  }

  if (canGenerateSummary(file.mimeType, file.name)) {
    tasks.push(
      generateFileSummary(env, fileId).then(
        () => {},
        (e) => {
          console.error(`Failed to generate summary for ${fileId}:`, e);
        }
      )
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }

  if (env.VECTORIZE) {
    try {
      const text = await buildFileTextForVector(env, fileId);
      if (text && text.trim().length > 0) {
        await indexFileVector(env, fileId, text);
      }
    } catch (e) {
      console.error(`Failed to auto index vector for ${fileId}:`, e);
    }
  }
}
