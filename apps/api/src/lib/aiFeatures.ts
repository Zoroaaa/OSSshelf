/**
 * aiFeatures.ts
 * AI 功能模块
 */

import type { Env } from '../types/env';
import { getDb, files } from '../db';
import { eq } from 'drizzle-orm';
import { getFileContent } from './utils';

const SUMMARY_MODEL = '@cf/meta/llama-3.1-8b-instruct' as const;
// llava: 图片理解，返回字段为 description
const IMAGE_CAPTION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf' as const;
// resnet-50: 快速分类标签（英文），作为 llava 的补充
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

const TEXT_MIME_PREFIXES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
];

function isTextFile(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export async function generateFileSummary(
  env: Env,
  fileId: string,
  content?: string
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

  if (!textContent || textContent.length < 50) {
    return { summary: '', cached: false };
  }

  const truncatedContent = textContent.slice(0, 4096);

  try {
    const response = await (env.AI as any).run(SUMMARY_MODEL, {
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
      max_tokens: 200,
    });

    const summary = (response as { response?: string }).response?.trim() || '';

    await Promise.all([
      env.KV.put(cacheKey, summary, { expirationTtl: 86400 }),
      db
        .update(files)
        .set({ aiSummary: summary, aiSummaryAt: new Date().toISOString() })
        .where(eq(files.id, fileId)),
    ]);

    return { summary, cached: false };
  } catch (error) {
    console.error('Failed to generate summary:', error);
    throw error;
  }
}

export async function generateImageTags(
  env: Env,
  fileId: string,
  imageBuffer?: ArrayBuffer
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
    return { tags: [], caption: undefined };
  }

  const uint8Array = new Uint8Array(imageData);

  try {
    // 并发调用 llava（中文描述）和 resnet-50（分类标签）
    const [captionResult, tagResult] = await Promise.allSettled([
      (env.AI as any).run(IMAGE_CAPTION_MODEL, {
        image: Array.from(uint8Array),
        prompt: '用中文简要描述这张图片的主要内容，不超过20个字。',
        max_tokens: 100,
      }),
      (env.AI as any).run(IMAGE_TAG_MODEL, {
        image: Array.from(uint8Array),
      }),
    ]);

    // llava 返回字段是 description（不是 response）
    let caption = '';
    if (captionResult.status === 'fulfilled') {
      const r = captionResult.value as { description?: string };
      caption = r.description?.trim() || '';
    } else {
      console.warn('llava caption failed:', captionResult.reason);
    }

    let tags: string[] = [];
    if (tagResult.status === 'fulfilled') {
      tags = parseImageTags(tagResult.value);
    } else {
      console.warn('resnet-50 tagging failed:', tagResult.reason);
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

export async function suggestFileName(
  env: Env,
  fileId: string,
  content?: string
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

  // 文本文件：用实际内容；非文本文件：用文件名+mimeType 让 AI 猜
  let contextForAI: string;
  let isContentBased = false;

  if (isTextFile(file.mimeType)) {
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

async function extractTextFromFile(
  env: Env,
  file: typeof files.$inferSelect
): Promise<string> {
  if (!isTextFile(file.mimeType)) {
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

async function fetchFileContentAsBuffer(
  env: Env,
  file: typeof files.$inferSelect
): Promise<ArrayBuffer | null> {
  if (!file.bucketId || !file.r2Key) {
    return null;
  }

  try {
    return await getFileContent(env, file.bucketId, file.r2Key);
  } catch (error) {
    console.error('Failed to fetch file content:', error);
    return null;
  }
}

function parseImageTags(result: unknown): string[] {
  if (!result) return [];

  const tags: string[] = [];

  if (Array.isArray(result)) {
    for (const item of result) {
      if (
        item &&
        typeof item === 'object' &&
        'label' in item &&
        typeof item.label === 'string'
      ) {
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
