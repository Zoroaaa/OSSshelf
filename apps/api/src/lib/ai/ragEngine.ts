/**
 * ragEngine.ts
 * RAG (检索增强生成) 引擎
 *
 * 功能:
 * - 智能上下文组装
 * - Prompt模板管理
 * - 文件内容检索与优化
 * - 来源引用管理
 */

import type { Env } from '../../types/env';
import { searchAndFetchFiles, buildFileTextForVector } from './vectorIndex';
import { getDb, files, searchHistory } from '../../db';
import { eq, and, isNull, desc, sql, gte } from 'drizzle-orm';
import { logger } from '@osshelf/shared';
import { getMimeTypeCategory } from './utils';
import { getAiConfigNumber } from './aiConfigService';

export interface FileContext {
  id: string;
  name: string;
  mimeType: string | null;
  similarityScore: number;
  summary?: string;
  description?: string;
  content?: string;
}

export interface RagContext {
  query: string;
  relevantFiles: FileContext[];
  /** @deprecated Use messages instead. Kept for non-stream fallback. */
  assembledPrompt: string;
  /** Structured messages ready to be passed directly to the LLM */
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  totalTokens: number;
  timestamp: string;
}

export interface ChatRagRequest {
  query: string;
  userId: string;
  maxFiles?: number;
  maxContextLength?: number;
  includeFileContent?: boolean;
  conversationHistory?: Array<{ role: string; content: string }>;
}

const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_CONTEXT_LENGTH = 8000;

interface UserSearchPreferences {
  topQueries: string[];
  topMimeTypes: string[];
}

export type QueryIntent = 'file_stats' | 'file_search' | 'content_qa' | 'image_visual' | 'general';

const VISUAL_PATTERNS = [/照片|图片.*(找|搜)|找.*照片|photo|image/i, /描述|外观|颜色|样子|scene/i];

const VALID_INTENTS: QueryIntent[] = ['file_stats', 'file_search', 'content_qa', 'image_visual', 'general'];

const INTENT_CACHE_TTL_MS = 10 * 60 * 1000;
const PREFERENCE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class BoundedCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T): void {
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, { data, expiresAt: Date.now() + this.ttlMs });
  }
}

const envIntentCacheMap = new WeakMap<object, BoundedCache<QueryIntent>>();
const envPreferenceCacheMap = new WeakMap<object, BoundedCache<UserSearchPreferences>>();

function getIntentCache(env: Env): BoundedCache<QueryIntent> {
  let cache = envIntentCacheMap.get(env);
  if (!cache) {
    cache = new BoundedCache<QueryIntent>(MAX_CACHE_ENTRIES, INTENT_CACHE_TTL_MS);
    envIntentCacheMap.set(env, cache);
  }
  return cache;
}

function getPreferenceCache(env: Env): BoundedCache<UserSearchPreferences> {
  let cache = envPreferenceCacheMap.get(env);
  if (!cache) {
    cache = new BoundedCache<UserSearchPreferences>(MAX_CACHE_ENTRIES, PREFERENCE_CACHE_TTL_MS);
    envPreferenceCacheMap.set(env, cache);
  }
  return cache;
}

async function getUserSearchPreferences(env: Env, userId: string): Promise<UserSearchPreferences> {
  const cacheKey = userId;
  const preferenceCache = getPreferenceCache(env);
  const cached = preferenceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const db = getDb(env.DB);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  try {
    const recent = await db
      .select({ query: searchHistory.query })
      .from(searchHistory)
      .where(and(eq(searchHistory.userId, userId), gte(searchHistory.createdAt, thirtyDaysAgo)))
      .orderBy(desc(searchHistory.createdAt))
      .limit(50)
      .all();

    const freq = new Map<string, number>();
    for (const r of recent) {
      const words = r.query.split(/[\s，。、,.\-_]+/).filter((w) => w.length >= 2);
      for (const w of words) {
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    const topQueries = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w);

    const recentFiles = await db
      .select({ mimeType: files.mimeType })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
      .orderBy(desc(files.updatedAt))
      .limit(30)
      .all();

    const mimeFreq = new Map<string, number>();
    for (const f of recentFiles) {
      if (f.mimeType) {
        const cat = getMimeTypeCategory(f.mimeType);
        mimeFreq.set(cat, (mimeFreq.get(cat) || 0) + 1);
      }
    }
    const topMimeTypes = [...mimeFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    const prefs: UserSearchPreferences = { topQueries, topMimeTypes };
    preferenceCache.set(cacheKey, prefs);
    return prefs;
  } catch (error) {
    logger.error('RAG', 'Failed to get user search preferences', { userId }, error);
    return { topQueries: [], topMimeTypes: [] };
  }
}

export async function classifyIntent(env: Env, query: string): Promise<QueryIntent> {
  const cacheKey = query.trim().toLowerCase();
  const intentCache = getIntentCache(env);
  const cached = intentCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let intent: QueryIntent;

  if (FILE_LIST_PATTERNS.some((p) => p.test(query))) {
    intent = 'file_stats';
  } else if (VISUAL_PATTERNS.some((p) => p.test(query))) {
    intent = 'image_visual';
  } else if (!env.AI) {
    intent = 'file_search';
  } else {
    try {
      const result = await Promise.race([
        (env.AI as any).run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            {
              role: 'system',
              content: `你是文件管理系统的意图分类器。将用户问题分类为以下之一，只输出分类词，不输出任何其他内容：

file_stats    - 询问文件数量、存储用量、配额、类型分布、重复文件等统计信息
file_search   - 寻找、定位、列出、整理、删除、移动、重命名特定文件或文件夹
content_qa    - 阅读文件内容、问答、对比、摘要、分析文件内容
image_visual  - 通过图片的视觉外观（颜色、场景、物体）查找图片
general       - 与文件系统无关的通用问题（如解释概念、闲聊）

示例（按格式严格输出）：
用户: 我有多少文件？ → file_stats
用户: 存储空间还剩多少？ → file_stats
用户: 有没有重复文件？ → file_stats
用户: 帮我找上周的会议纪要 → file_search
用户: 把所有PDF列出来 → file_search
用户: 帮我整理一下图库 → file_search
用户: 把重复的图片删掉 → file_search
用户: 把项目文件归类到对应文件夹 → file_search
用户: 这个合同里写了什么交货日期？ → content_qa
用户: 对比这两份报告的差异 → content_qa
用户: 帮我找一张有猫的照片 → image_visual
用户: 找颜色偏蓝的图片 → image_visual
用户: 什么是WebDAV协议？ → general
用户: 帮我删除这个文件 → file_search`,
            },
            { role: 'user', content: query },
          ],
          max_tokens: 15,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)),
      ]);

      const raw = ((result as any)?.response || '').trim().toLowerCase();
      // 从输出中提取有效分类词（兼容模型输出多余内容的情况）
      const matched = VALID_INTENTS.find((v) => raw.includes(v));
      intent = matched ?? 'file_search';
    } catch {
      intent = 'file_search';
    }
  }

  intentCache.set(cacheKey, intent);
  return intent;
}

/**
 * 语言感知 token 估算
 * 英文: 1 token ≈ 4 chars (0.25 tokens/char)
 * 中文: 1 token ≈ 1.5 chars (0.67 tokens/char)
 * 中文字符占比超 30% 时用中文系数，避免低估导致超窗口
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const chineseRatio = chineseChars / text.length;
  const tokensPerChar = chineseRatio > 0.3 ? 0.67 : 0.25;
  return Math.ceil(text.length * tokensPerChar);
}

// 中英文双语文件列表意图模式
const FILE_LIST_PATTERNS = [
  // 中文
  /我有(多少|哪些|什么)文件/,
  /文件(列表|清单|目录)/,
  /(列出|显示|查看)(所有|全部)?文件/,
  /最近(上传|添加|修改)的文件/,
  /文件统计/,
  /(多少个|几个)文件/,
  /存储(情况|空间|使用)/,
  /文件(总数|数量|个数)/,
  /总共.*文件/,
  /全部.*文件/,
  /所有.*文件/,
  /收藏(了|的)?(哪些|什么|哪些文件|哪些东西)/,
  /星标(文件|夹)?/,
  /(我的)?收藏(夹|列表|有哪些|有什么)/,
  /重要(的)?(文件|文档|资料)/,
  // 英文
  /how many files/i,
  /list (all |my )?files/i,
  /show (all |my )?files/i,
  /what files (do i have|are there)/i,
  /file (list|count|statistics|stats|overview)/i,
  /storage (usage|space|stats|status)/i,
  /recent(ly)? (uploaded|added|modified)/i,
  /all my files/i,
  /(my )?(favorites|starred|bookmarked) files/i,
  /which files (did|i )?(star|favorite|bookmark)/i,
];

const SYSTEM_PROMPTS = {
  default: `你是OSSshelf文件管理系统的智能助手。你的职责是帮助用户查询、分析和管理他们的文件。

核心能力：
1. 文件搜索和定位：根据用户描述找到相关文件
2. 内容摘要和分析：总结文件主要内容，提取关键信息
3. 智能问答：基于文件内容回答用户问题
4. 文件统计：回答关于文件数量、类型分布等问题

回答规则：
- 基于提供的文件信息回答问题，不要编造信息
- 如果文件信息不足以回答问题，请如实说明
- 在回答末尾用"来源：[序号]"注明引用了哪些文件（如果有）
- 回答要简洁准确，使用中文（除非用户使用其他语言）
- 对于技术文档，可以适当使用代码块展示关键内容`,

  file_expert: `你是文件分析专家。你擅长：
- 分析文档结构和内容
- 提取关键信息和数据
- 对比多个文件的异同
- 生成详细的文件报告

请根据提供的文件信息，给出专业、详细的分析。`,

  code_assistant: `你是编程助手。你擅长：
- 理释代码逻辑和功能
- 识别潜在问题和优化点
- 解释API接口和数据结构
- 提供代码改进建议

请基于代码文件给出专业的技术分析和建议。`,
};

export class RagEngine {
  private env: Env;
  private currentUserPreferences: UserSearchPreferences | null = null;

  constructor(env: Env) {
    this.env = env;
  }

  private isFileListQuery(query: string): boolean {
    return FILE_LIST_PATTERNS.some((pattern) => pattern.test(query));
  }

  async getFileStats(userId: string): Promise<{
    totalFiles: number;
    totalSize: number;
    byType: Array<{ type: string; count: number; size: number }>;
    recentFiles: Array<{ name: string; mimeType: string | null; size: number; createdAt: string }>;
  }> {
    const db = getDb(this.env.DB);

    const statsRow = await db
      .select({
        totalFiles: sql<number>`count(*)`,
        totalSize: sql<number>`coalesce(sum(${files.size}), 0)`,
      })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
      .get();

    const totalFiles = statsRow?.totalFiles ?? 0;
    const totalSize = statsRow?.totalSize ?? 0;

    const typeRows = await db
      .select({
        mimeType: files.mimeType,
        count: sql<number>`count(*)`,
        size: sql<number>`coalesce(sum(${files.size}), 0)`,
      })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
      .groupBy(files.mimeType)
      .all();

    const byType = typeRows
      .map((r) => ({ type: getMimeTypeCategory(r.mimeType), count: r.count, size: r.size }))
      .reduce(
        (acc, item) => {
          const existing = acc.find((a) => a.type === item.type);
          if (existing) {
            existing.count += item.count;
            existing.size += item.size;
          } else {
            acc.push({ ...item });
          }
          return acc;
        },
        [] as Array<{ type: string; count: number; size: number }>
      )
      .sort((a, b) => b.count - a.count);

    const recentFiles = await db
      .select({
        name: files.name,
        mimeType: files.mimeType,
        size: files.size,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
      .orderBy(desc(files.createdAt))
      .limit(10)
      .all();

    return { totalFiles, totalSize, byType, recentFiles };
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async buildContext(request: ChatRagRequest): Promise<RagContext> {
    const startTime = Date.now();

    const maxFiles = request.maxFiles || (await getAiConfigNumber(this.env, 'ai.rag.max_files', DEFAULT_MAX_FILES));
    const maxContextLength =
      request.maxContextLength ||
      (await getAiConfigNumber(this.env, 'ai.rag.max_context_length', DEFAULT_MAX_CONTEXT_LENGTH));

    try {
      const prefs = await getUserSearchPreferences(this.env, request.userId);
      this.currentUserPreferences = prefs;
      const prefHint =
        prefs.topQueries.length > 0
          ? `\n\n[用户偏好参考] 该用户近期常用搜索词：${prefs.topQueries.join('、')}；常用文件类型：${prefs.topMimeTypes.join('、')}。搜索结果匹配以上偏好时适当提升排序。`
          : '';

      const intent = await classifyIntent(this.env, request.query);
      const isFileList = intent === 'file_stats';
      let relevantFiles: FileContext[] = [];
      let statsContext = '';

      logger.info('RAG', 'Intent classified', { query: request.query.slice(0, 50), intent });

      if (intent === 'general') {
        const emptyPrompt = this.buildEmptyResponsePrompt(request.query);
        return {
          query: request.query,
          relevantFiles: [],
          assembledPrompt: emptyPrompt,
          messages: [
            {
              role: 'system',
              content: `${SYSTEM_PROMPTS.default}${prefHint}\n\n注意：这是一个通用问题，不涉及特定文件。请根据你的知识回答。`,
            },
            { role: 'user', content: request.query },
          ],
          totalTokens: 0,
          timestamp: new Date().toISOString(),
        };
      }

      if (intent === 'image_visual') {
        relevantFiles = await this.searchRelevantFiles(request.query, request.userId, maxFiles);
        if (relevantFiles.length > 0) {
          relevantFiles = relevantFiles.filter((f) => f.mimeType?.startsWith('image/'));
        }
      } else if (isFileList) {
        const stats = await this.getFileStats(request.userId);
        statsContext = this.formatStatsContext(stats);

        const db = getDb(this.env.DB);
        const recentFiles = await db
          .select()
          .from(files)
          .where(and(eq(files.userId, request.userId), isNull(files.deletedAt), eq(files.isFolder, false)))
          .orderBy(desc(files.createdAt))
          .limit(maxFiles + 5)
          .all();

        relevantFiles = recentFiles.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          similarityScore: 1.0,
          summary: f.aiSummary || undefined,
          description: f.description || undefined,
        }));
      } else {
        relevantFiles = await this.searchRelevantFiles(request.query, request.userId, maxFiles);

        if (relevantFiles.length === 0) {
          // No relevant files found — let the empty context handler deal with it
          // Don't inject random files with score=0.1 as they mislead the LLM
        }
      }

      if (relevantFiles.length === 0 && !statsContext) {
        const emptyPrompt = this.buildEmptyResponsePrompt(request.query);
        return {
          query: request.query,
          relevantFiles: [],
          assembledPrompt: emptyPrompt,
          messages: [
            {
              role: 'system',
              content:
                SYSTEM_PROMPTS.default +
                '\n\n注意：当前未找到与此问题相关的文件。如果这是一个关于文件管理的通用问题，你可以根据你的知识回答；如果是特定文件内容的询问，请告知用户需要先上传或索引相关文件。',
            },
            { role: 'user', content: request.query },
          ],
          totalTokens: 0,
          timestamp: new Date().toISOString(),
        };
      }

      const contextText = await this.assembleFileContext(
        relevantFiles,
        request.includeFileContent ?? false,
        maxContextLength
      );

      const fullContextText = statsContext ? `${statsContext}\n\n${contextText}` : contextText;
      const statsGuidance = statsContext
        ? `\n重要提示：用户询问的是文件统计信息，请优先根据上方的"用户文件统计信息"部分回答，那里包含了准确的文件总数、类型分布等统计数据。不要根据下方列出的示例文件数量来回答统计问题。`
        : '';

      const systemContent = `${SYSTEM_PROMPTS.default}${prefHint}\n\n== 相关文件信息 ==\n${fullContextText}\n== 文件信息结束 ==${statsGuidance}\n\n请根据以上文件信息回答用户的问题。`;

      // Build structured messages: system → history → current user query
      const structuredMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemContent },
      ];

      // Inject conversation history as real message turns (skip last user msg which is the current query)
      const history = request.conversationHistory || [];
      const historyWithoutCurrent = history.slice(0, -1); // last entry is the current user msg already
      for (const msg of historyWithoutCurrent.slice(-10)) {
        // last 10 turns max
        structuredMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }

      // Current user query
      structuredMessages.push({ role: 'user', content: request.query });

      // Keep assembledPrompt for backward compat (non-structured callers)
      const assembledPrompt = `${systemContent}\n\n用户问题：${request.query}`;
      const totalTokens = estimateTokens(assembledPrompt);

      logger.info('RAG', 'Context built', {
        query: request.query.slice(0, 50),
        fileCount: relevantFiles.length,
        contextLength: fullContextText.length,
        totalTimeMs: Date.now() - startTime,
        isFileListQuery: isFileList,
      });

      return {
        query: request.query,
        relevantFiles,
        assembledPrompt,
        messages: structuredMessages,
        totalTokens,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('RAG', 'Failed to build context', { query: request.query }, error);
      throw error;
    }
  }

  private formatStatsContext(stats: {
    totalFiles: number;
    totalSize: number;
    byType: Array<{ type: string; count: number; size: number }>;
    recentFiles: Array<{ name: string; mimeType: string | null; size: number; createdAt: string }>;
  }): string {
    const parts: string[] = ['=== 用户文件统计信息 ==='];

    parts.push(`总文件数：${stats.totalFiles} 个`);
    parts.push(`总存储空间：${this.formatFileSize(stats.totalSize)}`);

    if (stats.byType.length > 0) {
      parts.push('\n按类型分布：');
      for (const item of stats.byType.slice(0, 8)) {
        parts.push(`- ${item.type}：${item.count} 个，${this.formatFileSize(item.size)}`);
      }
    }

    if (stats.recentFiles.length > 0) {
      parts.push('\n最近添加的文件：');
      for (const file of stats.recentFiles.slice(0, 5)) {
        const date = new Date(file.createdAt).toLocaleDateString('zh-CN');
        parts.push(`- ${file.name} (${this.formatFileSize(file.size)}, ${date})`);
      }
    }

    parts.push('=== 统计信息结束 ===\n');
    return parts.join('\n');
  }

  async searchRelevantFiles(query: string, userId: string, limit: number = DEFAULT_MAX_FILES): Promise<FileContext[]> {
    try {
      const searchResults = await searchAndFetchFiles(this.env, query, userId, {
        limit,
        threshold: 0.3,
      });

      const results = searchResults.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        similarityScore: file.similarityScore,
        summary: file.aiSummary || undefined,
        description: file.description || undefined,
      }));

      if (this.currentUserPreferences && this.currentUserPreferences.topQueries.length > 0) {
        for (const result of results) {
          const isMatch = this.currentUserPreferences.topQueries.some(
            (keyword) =>
              result.name?.toLowerCase().includes(keyword.toLowerCase()) ||
              result.summary?.toLowerCase().includes(keyword.toLowerCase())
          );
          if (isMatch) {
            result.similarityScore = Math.min(1.0, result.similarityScore + 0.15);
          }
        }
        results.sort((a, b) => b.similarityScore - a.similarityScore);
      }

      return results;
    } catch (error) {
      logger.error('RAG', 'File search failed', { query, userId }, error);
      return [];
    }
  }

  private async assembleFileContext(files: FileContext[], includeContent: boolean, maxLength: number): Promise<string> {
    const parts: string[] = [];
    let currentLength = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileParts: string[] = [`[${i + 1}] 文件名：${file.name}`];

      if (file.mimeType) {
        fileParts.push(`类型：${file.mimeType}`);
      }

      fileParts.push(`相关度：${(file.similarityScore * 100).toFixed(1)}%`);

      if (file.summary) {
        fileParts.push(`摘要：${file.summary}`);
      }

      if (file.description) {
        fileParts.push(`描述：${file.description}`);
      }

      if (includeContent) {
        try {
          const content = await buildFileTextForVector(this.env, file.id);
          if (content && content.length > 0) {
            fileParts.push(`内容预览：\n${content}`);
          }
        } catch {
          continue;
        }
      }

      const fileText = fileParts.join('\n');

      if (currentLength + fileText.length > maxLength) {
        break;
      }

      parts.push(fileText);
      currentLength += fileText.length;
    }

    return parts.join('\n\n');
  }

  private formatConversationHistory(history: Array<{ role: string; content: string }>): string {
    if (history.length === 0) {
      return '';
    }

    const recentHistory = history.slice(-6);
    const formatted = recentHistory
      .map((msg) => {
        const role = msg.role === 'user' ? '用户' : '助手';
        return `${role}：${msg.content}`;
      })
      .join('\n');

    return `\n\n=== 历史对话 ===\n${formatted}\n=== 历史对话结束 ===\n`;
  }

  private assembleFinalPrompt(params: {
    systemPrompt: string;
    userQuery: string;
    contextText: string;
    conversationContext: string;
    hasStatsContext?: boolean;
  }): string {
    const { systemPrompt, userQuery, contextText, conversationContext, hasStatsContext } = params;

    const statsGuidance = hasStatsContext
      ? `\n重要提示：用户询问的是文件统计信息，请优先根据上方的"用户文件统计信息"部分回答，那里包含了准确的文件总数、类型分布等统计数据。不要根据下方列出的示例文件数量来回答统计问题。`
      : '';

    return `${systemPrompt}
${conversationContext}
== 相关文件信息 ==
${contextText}
== 文件信息结束 ==
${statsGuidance}

请根据以上文件信息回答用户的问题。

用户问题：${userQuery}`;
  }

  private buildEmptyResponsePrompt(query: string): string {
    return `${SYSTEM_PROMPTS.default}

用户问题：${query}

注意：当前未找到与此问题相关的文件。如果这是一个关于文件管理的通用问题，你可以根据你的知识回答；如果是特定文件内容的询问，请告知用户需要先上传或索引相关文件。`;
  }

  formatSourcesForResponse(files: FileContext[]): string {
    if (files.length === 0) {
      return '';
    }

    return (
      '\n\n---\n**参考来源：**\n' +
      files.map((f, i) => `${i + 1}. **${f.name}** (相关度: ${(f.similarityScore * 100).toFixed(0)}%)`).join('\n')
    );
  }

  getSystemPrompt(type: keyof typeof SYSTEM_PROMPTS = 'default'): string {
    return SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.default;
  }
}
