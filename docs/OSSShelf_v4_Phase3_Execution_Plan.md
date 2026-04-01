# OSSShelf v4.0 第三批次执行计划

> 基于《OSSShelf v4.0 增强优化方案》Phase 3，目标：AI 智能化（Workers AI + 语义搜索 + 文件总结）
> 
> **状态：📋 计划中**
> **目标版本：3.7.0**

---

## 概述

**执行周期**：2 周
**核心目标**：集成 Cloudflare Workers AI，实现语义搜索、文件总结、图片标签、智能重命名等 AI 功能
**前置条件**：Phase 1、Phase 2 已完成

### 现状分析

| 模块 | 现状 | 目标 |
|------|------|------|
| AI 功能 | 无任何 AI 功能 | ✅ 集成 Workers AI，支持语义搜索、文件总结、图片标签 |
| 搜索 | LIKE 关键词搜索 | ✅ 支持向量语义搜索，混合排序 |
| 文件描述 | 有 description 字段但未使用 | ✅ AI 自动生成文件摘要 |
| 向量存储 | 无 | ✅ 使用 Vectorize 存储文件向量 |

---

## Week 7：Workers AI 接入与语义搜索

### 任务 7.1：配置 Workers AI 和 Vectorize

**重要说明**：AI 和 Vectorize 绑定是在 Cloudflare Dashboard 的 Worker 设置中**实时配置**的，而非 wrangler.toml 文件。这种方式更灵活，无需重新部署即可调整配置。

**步骤一：创建 Vectorize 索引**
```bash
# 创建向量索引（768 维，cosine 相似度）
npx wrangler vectorize create osshelf-files --dimensions=768 --metric=cosine
```

**步骤二：在 Cloudflare Dashboard 配置绑定**

1. 进入 Cloudflare Dashboard → Workers & Pages → 选择你的 Worker
2. 点击 Settings → Variables and Secrets
3. 添加 **AI Binding**：
   - Variable name: `AI`
   - Type: AI Binding
4. 添加 **Vectorize Binding**：
   - Variable name: `VECTORIZE`
   - Type: Vectorize Binding
   - Index: `ossshelf-files`

**修改文件**：`apps/api/src/types/env.ts`

```typescript
export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;
  KV: KVNamespace;
  AI?: Ai;                         // AI 绑定（可选，未配置时功能降级）
  VECTORIZE?: VectorizeIndex;      // Vectorize 绑定（可选）
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PUBLIC_URL?: string;
  CORS_ORIGINS?: string;
}
```

**实现要点**：
- AI 和 Vectorize 绑定设为可选，未配置时功能优雅降级
- AI binding 类型来自 `@cloudflare/workers-types`
- Vectorize binding 类型为 `VectorizeIndex`
- 在代码中检查绑定是否存在：`if (!env.AI || !env.VECTORIZE) { /* 降级处理 */ }`

---

### 任务 7.2：数据库迁移 - AI 功能字段

**文件**：`apps/api/migrations/0013_ai_features.sql`

**表结构修改**：
```sql
-- files 表新增 AI 相关字段
ALTER TABLE files ADD COLUMN ai_summary TEXT;           -- AI 生成的摘要
ALTER TABLE files ADD COLUMN ai_summary_at TEXT;        -- 摘要生成时间
ALTER TABLE files ADD COLUMN ai_tags TEXT;              -- AI 生成的标签（JSON 数组）
ALTER TABLE files ADD COLUMN ai_tags_at TEXT;           -- 标签生成时间
ALTER TABLE files ADD COLUMN vector_indexed_at TEXT;    -- 向量索引时间
ALTER TABLE files ADD COLUMN is_starred INTEGER DEFAULT 0;  -- 收藏标记（Phase 4 使用）

-- 创建索引
CREATE INDEX idx_files_vector_indexed ON files(userId, vector_indexed_at);
CREATE INDEX idx_files_ai_summary ON files(userId, ai_summary_at);
```

**修改文件**：`apps/api/src/db/schema.ts`

```typescript
export const files = sqliteTable(
  'files',
  {
    // ... 现有字段
    aiSummary: text('ai_summary'),
    aiSummaryAt: text('ai_summary_at'),
    aiTags: text('ai_tags'),
    aiTagsAt: text('ai_tags_at'),
    vectorIndexedAt: text('vector_indexed_at'),
    isStarred: integer('is_starred', { mode: 'boolean' }).default(false),
  },
  // ... 索引
);
```

---

### 任务 7.3：创建向量索引模块

**文件**：`apps/api/src/lib/vectorIndex.ts`

**功能**：
- `indexFileVector()` - 为文件生成向量并存储到 Vectorize
- `deleteFileVector()` - 从 Vectorize 删除文件向量
- `searchSimilarFiles()` - 语义相似文件搜索
- `batchIndexFiles()` - 批量索引文件

**核心实现**：
```typescript
import type { Env } from '../types/env';
import { getDb, files, fileNotes } from '../db';
import { eq } from 'drizzle-orm';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const MAX_TEXT_LENGTH = 4096;

export interface VectorSearchResult {
  fileId: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export async function indexFileVector(
  env: Env,
  fileId: string,
  text: string
): Promise<void> {
  if (!env.AI || !env.VECTORIZE) {
    console.warn('AI or VECTORIZE not configured, skipping vector indexing');
    return;
  }

  const truncatedText = text.slice(0, MAX_TEXT_LENGTH);
  
  try {
    const { data } = await env.AI.run(EMBEDDING_MODEL, {
      text: [truncatedText],
    });

    if (!data || data.length === 0) {
      throw new Error('Failed to generate embedding');
    }

    const db = getDb(env.DB);
    const file = await db.select().from(files).where(eq(files.id, fileId)).get();
    
    if (!file) {
      throw new Error('File not found');
    }

    await env.VECTORIZE.upsert([
      {
        id: fileId,
        values: data[0],
        metadata: {
          userId: file.userId,
          name: file.name,
          mimeType: file.mimeType || '',
          isFolder: file.isFolder,
        },
      },
    ]);

    await db
      .update(files)
      .set({ vectorIndexedAt: new Date().toISOString() })
      .where(eq(files.id, fileId));
  } catch (error) {
    console.error(`Failed to index file ${fileId}:`, error);
    throw error;
  }
}

export async function deleteFileVector(env: Env, fileId: string): Promise<void> {
  if (!env.VECTORIZE) return;
  
  try {
    await env.VECTORIZE.deleteByIds([fileId]);
  } catch (error) {
    console.error(`Failed to delete vector for file ${fileId}:`, error);
  }
}

export async function searchSimilarFiles(
  env: Env,
  query: string,
  userId: string,
  options: {
    limit?: number;
    threshold?: number;
    mimeType?: string;
  } = {}
): Promise<VectorSearchResult[]> {
  const { limit = 20, threshold = 0.7, mimeType } = options;

  if (!env.AI || !env.VECTORIZE) {
    return [];
  }

  const { data } = await env.AI.run(EMBEDDING_MODEL, {
    text: [query.slice(0, MAX_TEXT_LENGTH)],
  });

  if (!data || data.length === 0) {
    return [];
  }

  const filter: VectorizeVectorMetadataFilter = { userId };
  if (mimeType) {
    filter.mimeType = { $startsWith: mimeType };
  }

  const results = await env.VECTORIZE.query(data[0], {
    topK: limit,
    filter,
    returnMetadata: 'all',
  });

  return results.matches
    .filter((m) => m.score >= threshold)
    .map((m) => ({
      fileId: m.id,
      score: m.score,
      metadata: m.metadata,
    }));
}

export async function buildFileTextForVector(
  env: Env,
  fileId: string
): Promise<string> {
  const db = getDb(env.DB);
  
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return '';

  const notes = await db
    .select({ content: fileNotes.content })
    .from(fileNotes)
    .where(eq(fileNotes.fileId, fileId))
    .limit(5)
    .all();

  const parts = [
    file.name,
    file.description || '',
    file.aiSummary || '',
    ...notes.map((n) => n.content),
  ].filter(Boolean);

  return parts.join('\n');
}
```

---

### 任务 7.4：创建 AI 功能模块

**文件**：`apps/api/src/lib/aiFeatures.ts`

**功能**：
- `generateFileSummary()` - 生成文件摘要
- `generateImageTags()` - 图片自动标签
- `suggestFileName()` - 智能重命名建议
- `extractTextFromFile()` - 从文件提取文本

**核心实现**：
```typescript
import type { Env } from '../types/env';
import { getDb, files } from '../db';
import { eq } from 'drizzle-orm';

const SUMMARY_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const IMAGE_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const IMAGE_TAG_MODEL = '@cf/microsoft/resnet-50';

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

export async function generateFileSummary(
  env: Env,
  fileId: string,
  content?: string
): Promise<SummaryResult> {
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

  const response = await env.AI.run(SUMMARY_MODEL, {
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

  const summary = (response as any).response?.trim() || '';

  await env.KV.put(cacheKey, summary, { expirationTtl: 86400 });

  await db
    .update(files)
    .set({
      aiSummary: summary,
      aiSummaryAt: new Date().toISOString(),
    })
    .where(eq(files.id, fileId));

  return { summary, cached: false };
}

export async function generateImageTags(
  env: Env,
  fileId: string,
  imageBuffer?: ArrayBuffer
): Promise<ImageTagResult> {
  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  
  if (!file) {
    throw new Error('File not found');
  }

  let imageData = imageBuffer;
  if (!imageData) {
    imageData = await fetchFileContent(env, file);
  }

  if (!imageData) {
    return { tags: [] };
  }

  const uint8Array = new Uint8Array(imageData);

  const tagResult = await env.AI.run(IMAGE_TAG_MODEL, {
    image: Array.from(uint8Array),
  });

  const tags = parseImageTags((tagResult as any));

  const captionResult = await env.AI.run(IMAGE_MODEL, {
    image: Array.from(uint8Array),
    prompt: '用中文简要描述这张图片的主要内容，用于文件管理系统的搜索标签。不超过20个字。',
  });

  const caption = (captionResult as any).description?.trim() || '';

  await db
    .update(files)
    .set({
      aiTags: JSON.stringify(tags),
      aiTagsAt: new Date().toISOString(),
      aiSummary: caption,
      aiSummaryAt: new Date().toISOString(),
    })
    .where(eq(files.id, fileId));

  return { tags, caption };
}

export async function suggestFileName(
  env: Env,
  fileId: string,
  content?: string
): Promise<RenameSuggestion> {
  const db = getDb(env.DB);
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  
  if (!file) {
    throw new Error('File not found');
  }

  let textContent = content;
  if (!textContent) {
    textContent = await extractTextFromFile(env, file);
  }

  const ext = file.name.split('.').pop() || '';

  const response = await env.AI.run(SUMMARY_MODEL, {
    messages: [
      {
        role: 'system',
        content: `你是文件命名助手。根据文件内容，建议3个简洁、有意义的中文文件名。
规则：
1. 每个文件名不超过20个字
2. 保留文件扩展名 .${ext}
3. 每行一个文件名，不要编号
4. 文件名要能反映文件的主要内容`,
      },
      {
        role: 'user',
        content: `原文件名：${file.name}\n文件内容：${textContent?.slice(0, 2000) || '（无内容）'}`,
      },
    ],
    max_tokens: 100,
  });

  const suggestions = ((response as any).response || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0 && s.includes('.'))
    .slice(0, 3);

  return { suggestions };
}

async function extractTextFromFile(env: Env, file: any): Promise<string> {
  if (!file.mimeType?.startsWith('text/') && 
      file.mimeType !== 'application/json' &&
      file.mimeType !== 'application/xml' &&
      !file.mimeType?.includes('javascript')) {
    return '';
  }

  try {
    const content = await fetchFileContent(env, file);
    if (!content) return '';
    
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(content).slice(0, 4096);
  } catch {
    return '';
  }
}

async function fetchFileContent(env: Env, file: any): Promise<ArrayBuffer | null> {
  // 实现从存储获取文件内容的逻辑
  // 根据 file.bucketId 和 file.r2Key 获取
  return null;
}

function parseImageTags(result: any): string[] {
  if (!result) return [];
  
  const tags: string[] = [];
  
  if (result.label) {
    tags.push(...result.label.split(',').map((t: string) => t.trim()));
  }
  
  return [...new Set(tags)].slice(0, 5);
}
```

---

### 任务 7.5：创建 AI 路由

**文件**：`apps/api/src/routes/ai.ts`

**路由设计**：
```
POST   /api/ai/index/:fileId        -- 手动触发单个文件向量化
POST   /api/ai/index/batch          -- 批量向量化（指定文件列表）
POST   /api/ai/index/all            -- 一键全量向量化（异步后台任务）
GET    /api/ai/index/status         -- 获取全量索引任务状态
DELETE /api/ai/index/:fileId        -- 删除向量索引
POST   /api/ai/search               -- 语义搜索
POST   /api/ai/summarize/:fileId    -- 生成文件摘要
POST   /api/ai/tags/:fileId         -- 生成图片标签
POST   /api/ai/rename-suggest/:fileId -- 智能重命名建议
GET    /api/ai/status/:fileId       -- 获取 AI 处理状态
```

**核心实现**：
```typescript
import { Hono } from 'hono';
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm';
import { getDb, files } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import {
  indexFileVector,
  deleteFileVector,
  searchSimilarFiles,
  buildFileTextForVector,
} from '../lib/vectorIndex';
import {
  generateFileSummary,
  generateImageTags,
  suggestFileName,
} from '../lib/aiFeatures';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
  threshold: z.number().min(0).max(1).default(0.7),
  mimeType: z.string().optional(),
});

app.post('/index/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } },
      404
    );
  }

  const text = await buildFileTextForVector(c.env, fileId);
  await indexFileVector(c.env, fileId, text);

  return c.json({ success: true, data: { message: '向量化完成' } });
});

app.post('/index/batch', async (c) => {
  const userId = c.get('userId')!;
  const { fileIds } = await c.req.json();

  const results = [];
  for (const fileId of fileIds) {
    try {
      const text = await buildFileTextForVector(c.env, fileId);
      await indexFileVector(c.env, fileId, text);
      results.push({ fileId, status: 'success' });
    } catch (error) {
      results.push({ fileId, status: 'failed', error: String(error) });
    }
  }

  return c.json({ success: true, data: results });
});

app.post('/index/all', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const taskKey = `ai:index:task:${userId}`;
  const existingTask = await c.env.KV.get(taskKey, 'json');
  
  if (existingTask && (existingTask as any).status === 'running') {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message: '已有索引任务正在运行，请等待完成',
      },
    });
  }

  const unindexedCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(files)
    .where(and(
      eq(files.userId, userId),
      isNull(files.deletedAt),
      eq(files.isFolder, false),
      isNull(files.vectorIndexedAt)
    ))
    .get();

  const task = {
    id: crypto.randomUUID(),
    status: 'running',
    total: unindexedCount?.count || 0,
    processed: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await c.env.KV.put(taskKey, JSON.stringify(task), { expirationTtl: 86400 });

  c.executionCtx.waitUntil(
    runBatchIndexTask(c.env, userId, task)
  );

  return c.json({
    success: true,
    data: {
      message: '索引任务已启动，将在后台运行',
      task,
    },
  });
});

app.get('/index/status', async (c) => {
  const userId = c.get('userId')!;
  const taskKey = `ai:index:task:${userId}`;
  
  const task = await c.env.KV.get(taskKey, 'json');
  
  if (!task) {
    return c.json({
      success: true,
      data: {
        status: 'idle',
        message: '没有正在运行的索引任务',
      },
    });
  }

  return c.json({ success: true, data: task });
});

async function runBatchIndexTask(
  env: Env,
  userId: string,
  task: any
): Promise<void> {
  const db = getDb(env.DB);
  const taskKey = `ai:index:task:${userId}`;
  const batchSize = 10;

  try {
    let hasMore = true;
    let offset = 0;

    while (hasMore) {
      const unindexedFiles = await db
        .select({ id: files.id })
        .from(files)
        .where(and(
          eq(files.userId, userId),
          isNull(files.deletedAt),
          eq(files.isFolder, false),
          isNull(files.vectorIndexedAt)
        ))
        .limit(batchSize)
        .offset(offset)
        .all();

      if (unindexedFiles.length === 0) {
        hasMore = false;
        break;
      }

      for (const file of unindexedFiles) {
        try {
          const text = await buildFileTextForVector(env, file.id);
          await indexFileVector(env, file.id, text);
          task.processed++;
        } catch (error) {
          task.failed++;
          console.error(`Failed to index file ${file.id}:`, error);
        }
        
        task.updatedAt = new Date().toISOString();
        await env.KV.put(taskKey, JSON.stringify(task), { expirationTtl: 86400 });
      }

      offset += batchSize;
    }

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
  } catch (error) {
    task.status = 'failed';
    task.error = String(error);
    task.updatedAt = new Date().toISOString();
  }

  await env.KV.put(taskKey, JSON.stringify(task), { expirationTtl: 86400 });
}

app.delete('/index/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  await deleteFileVector(c.env, fileId);
  return c.json({ success: true });
});

app.post('/search', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = searchSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { query, limit, threshold, mimeType } = result.data;

  const searchResults = await searchSimilarFiles(c.env, query, userId, {
    limit,
    threshold,
    mimeType,
  });

  const db = getDb(c.env.DB);
  const fileIds = searchResults.map((r) => r.fileId);

  if (fileIds.length === 0) {
    return c.json({ success: true, data: [] });
  }

  const fileRecords = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .all();

  const fileMap = new Map(fileRecords.map((f) => [f.id, f]));

  const items = searchResults
    .filter((r) => fileMap.has(r.fileId))
    .map((r) => ({
      ...fileMap.get(r.fileId)!,
      similarityScore: r.score,
    }));

  return c.json({ success: true, data: items });
});

app.post('/summarize/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } },
      404
    );
  }

  const result = await generateFileSummary(c.env, fileId);

  return c.json({ success: true, data: result });
});

app.post('/tags/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } },
      404
    );
  }

  if (!file.mimeType?.startsWith('image/')) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '仅支持图片文件' } },
      400
    );
  }

  const result = await generateImageTags(c.env, fileId);

  return c.json({ success: true, data: result });
});

app.post('/rename-suggest/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } },
      404
    );
  }

  const result = await suggestFileName(c.env, fileId);

  return c.json({ success: true, data: result });
});

app.get('/status/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } },
      404
    );
  }

  return c.json({
    success: true,
    data: {
      hasSummary: !!file.aiSummary,
      summaryAt: file.aiSummaryAt,
      hasTags: !!file.aiTags,
      tagsAt: file.aiTagsAt,
      vectorIndexed: !!file.vectorIndexedAt,
      vectorIndexedAt: file.vectorIndexedAt,
    },
  });
});

export default app;
```

---

### 任务 7.6：集成向量化到文件上传流程

**修改文件**：`apps/api/src/routes/files.ts`

**实现要点**：
- 在文件上传完成后，使用 `c.executionCtx.waitUntil()` 异步触发向量化
- 在文件内容更新后，重新生成向量
- 在文件删除时，删除向量索引

**关键代码位置**：
```typescript
// 文件上传完成后
import { indexFileVector, buildFileTextForVector } from '../lib/vectorIndex';

// 在文件创建成功后添加
c.executionCtx.waitUntil(
  (async () => {
    try {
      const text = await buildFileTextForVector(c.env, file.id);
      await indexFileVector(c.env, file.id, text);
    } catch (error) {
      console.error('Failed to index file vector:', error);
    }
  })()
);
```

---

### 任务 7.7：增强搜索路由支持语义搜索

**修改文件**：`apps/api/src/routes/search.ts`

**新增参数**：
- `semantic: boolean` - 是否启用语义搜索
- `hybrid: boolean` - 是否混合搜索（关键词 + 语义）

**实现方案**：
```typescript
// 在搜索路由中添加语义搜索支持
if (searchParams.semantic && searchParams.query) {
  const semanticResults = await searchSimilarFiles(c.env, searchParams.query, userId, {
    limit: searchParams.limit || 50,
    threshold: 0.6,
  });

  if (searchParams.hybrid) {
    // 混合搜索：合并关键词和语义结果
    // 关键词结果权重 0.4，语义结果权重 0.6
  } else {
    // 纯语义搜索
    return semanticResults;
  }
}
```

---

### 任务 7.8：前端语义搜索组件

**目录**：`apps/web/src/components/ai/`

**组件清单**：
```
├── SemanticSearchBar.tsx      -- 语义搜索输入框
├── SemanticSearchResults.tsx  -- 语义搜索结果展示
├── SearchModeToggle.tsx       -- 搜索模式切换（关键词/语义/混合）
└── index.ts                   -- 导出入口
```

**SemanticSearchBar.tsx 关键实现**：
```typescript
import { useState } from 'react';
import { Search, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { aiApi } from '@/services/api';

interface SemanticSearchBarProps {
  onSearch: (query: string, mode: 'keyword' | 'semantic' | 'hybrid') => void;
  isLoading?: boolean;
}

export function SemanticSearchBar({ onSearch, isLoading }: SemanticSearchBarProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'keyword' | 'semantic' | 'hybrid'>('hybrid');

  const handleSearch = () => {
    if (query.trim()) {
      onSearch(query.trim(), mode);
    }
  };

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="输入自然语言描述搜索文件..."
          className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2"
        />
      </div>
      
      <div className="flex gap-1 border rounded-lg p-1">
        <Button
          variant={mode === 'keyword' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setMode('keyword')}
        >
          关键词
        </Button>
        <Button
          variant={mode === 'semantic' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setMode('semantic')}
        >
          <Sparkles className="h-4 w-4 mr-1" />
          语义
        </Button>
        <Button
          variant={mode === 'hybrid' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setMode('hybrid')}
        >
          混合
        </Button>
      </div>

      <Button onClick={handleSearch} disabled={isLoading}>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
      </Button>
    </div>
  );
}
```

---

## Week 8：AI 功能扩展

### 任务 8.1：前端 AI 摘要卡片组件

**文件**：`apps/web/src/components/ai/AISummaryCard.tsx`

**功能**：
- 显示 AI 生成的文件摘要
- 支持手动触发摘要生成
- 显示摘要生成时间

**实现**：
```typescript
import { useState } from 'react';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { aiApi } from '@/services/api';
import { formatDate } from '@/utils';

interface AISummaryCardProps {
  fileId: string;
  summary?: string;
  summaryAt?: string;
  onSummaryGenerated?: (summary: string) => void;
}

export function AISummaryCard({
  fileId,
  summary,
  summaryAt,
  onSummaryGenerated,
}: AISummaryCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [localSummary, setLocalSummary] = useState(summary);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await aiApi.summarize(fileId);
      if (response.success) {
        setLocalSummary(response.data.summary);
        onSummaryGenerated?.(response.data.summary);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium">AI 摘要</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {localSummary ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{localSummary}</p>
          {summaryAt && (
            <p className="text-xs text-muted-foreground">
              生成于 {formatDate(summaryAt)}
            </p>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          点击刷新按钮生成 AI 摘要
        </div>
      )}
    </div>
  );
}
```

---

### 任务 8.2：智能重命名对话框

**文件**：`apps/web/src/components/ai/SmartRenameDialog.tsx`

**功能**：
- 显示 AI 生成的重命名建议
- 支持一键采纳建议
- 支持手动编辑

**实现**：
```typescript
import { useState, useEffect } from 'react';
import { Sparkles, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { aiApi, filesApi } from '@/services/api';

interface SmartRenameDialogProps {
  open: boolean;
  onClose: () => void;
  fileId: string;
  currentName: string;
  onRenamed?: (newName: string) => void;
}

export function SmartRenameDialog({
  open,
  onClose,
  fileId,
  currentName,
  onRenamed,
}: SmartRenameDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState('');

  useEffect(() => {
    if (open) {
      loadSuggestions();
    }
  }, [open, fileId]);

  const loadSuggestions = async () => {
    setIsLoading(true);
    try {
      const response = await aiApi.suggestRename(fileId);
      if (response.success) {
        setSuggestions(response.data.suggestions);
        if (response.data.suggestions.length > 0) {
          setSelectedName(response.data.suggestions[0]);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRename = async () => {
    if (!selectedName) return;

    try {
      await filesApi.rename(fileId, selectedName);
      onRenamed?.(selectedName);
      onClose();
    } catch (error) {
      console.error('Failed to rename:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            智能重命名
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            当前名称：{currentName}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">AI 建议：</label>
              {suggestions.map((name) => (
                <div
                  key={name}
                  className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedName === name
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => setSelectedName(name)}
                >
                  <span>{name}</span>
                  {selectedName === name && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">自定义名称：</label>
            <input
              type="text"
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleRename} disabled={!selectedName}>
              确认重命名
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

### 任务 8.3：图片标签显示组件

**文件**：`apps/web/src/components/ai/ImageTagsDisplay.tsx`

**功能**：
- 显示 AI 生成的图片标签
- 支持手动触发生成
- 标签可点击筛选

**实现**：
```typescript
import { useState } from 'react';
import { Tag, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { aiApi } from '@/services/api';

interface ImageTagsDisplayProps {
  fileId: string;
  tags?: string[];
  tagsAt?: string;
  onTagsGenerated?: (tags: string[]) => void;
  onTagClick?: (tag: string) => void;
}

export function ImageTagsDisplay({
  fileId,
  tags,
  tagsAt,
  onTagsGenerated,
  onTagClick,
}: ImageTagsDisplayProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [localTags, setLocalTags] = useState<string[]>(tags || []);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await aiApi.generateTags(fileId);
      if (response.success) {
        setLocalTags(response.data.tags);
        onTagsGenerated?.(response.data.tags);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI 标签</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {localTags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {localTags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
              onClick={() => onTagClick?.(tag)}
            >
              {tag}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          点击刷新按钮生成 AI 标签
        </p>
      )}
    </div>
  );
}
```

---

### 任务 8.4：集成 AI 组件到文件预览

**修改文件**：`apps/web/src/components/files/FilePreview.tsx`

**集成点**：
1. 在文件预览侧边栏添加 AI 摘要卡片
2. 对于图片文件，显示 AI 标签
3. 在文件操作菜单添加"智能重命名"选项

**关键改动**：
```typescript
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { ImageTagsDisplay } from '@/components/ai/ImageTagsDisplay';
import { SmartRenameDialog } from '@/components/ai/SmartRenameDialog';

// 在 FilePreviewProps 中添加
interface FilePreviewProps {
  // ... 现有属性
  aiSummary?: string;
  aiSummaryAt?: string;
  aiTags?: string[];
  aiTagsAt?: string;
}

// 在组件中添加状态
const [showSmartRename, setShowSmartRename] = useState(false);

// 在侧边栏添加 AI 组件
<div className="space-y-4">
  <AISummaryCard
    fileId={file.id}
    summary={aiSummary}
    summaryAt={aiSummaryAt}
    onSummaryGenerated={(summary) => {
      // 更新文件信息
    }}
  />
  
  {file.mimeType?.startsWith('image/') && (
    <ImageTagsDisplay
      fileId={file.id}
      tags={aiTags}
      tagsAt={aiTagsAt}
      onTagClick={(tag) => {
        // 跳转到标签搜索
      }}
    />
  )}
</div>

// 在操作菜单添加智能重命名
<Button variant="outline" onClick={() => setShowSmartRename(true)}>
  <Sparkles className="h-4 w-4 mr-2" />
  智能重命名
</Button>

<SmartRenameDialog
  open={showSmartRename}
  onClose={() => setShowSmartRename(false)}
  fileId={file.id}
  currentName={file.name}
  onRenamed={(newName) => {
    // 更新文件名
  }}
/>
```

---

### 任务 8.5：创建 AI API 服务

**文件**：`apps/web/src/services/api/ai.ts`

**实现**：
```typescript
import { apiClient } from './client';

export const aiApi = {
  search: async (query: string, options?: {
    limit?: number;
    threshold?: number;
    mimeType?: string;
  }) => {
    return apiClient.post('/api/ai/search', { query, ...options });
  },

  summarize: async (fileId: string) => {
    return apiClient.post(`/api/ai/summarize/${fileId}`);
  },

  generateTags: async (fileId: string) => {
    return apiClient.post(`/api/ai/tags/${fileId}`);
  },

  suggestRename: async (fileId: string) => {
    return apiClient.post(`/api/ai/rename-suggest/${fileId}`);
  },

  indexFile: async (fileId: string) => {
    return apiClient.post(`/api/ai/index/${fileId}`);
  },

  indexBatch: async (fileIds: string[]) => {
    return apiClient.post('/api/ai/index/batch', { fileIds });
  },

  indexAll: async () => {
    return apiClient.post('/api/ai/index/all');
  },

  getIndexStatus: async () => {
    return apiClient.get('/api/ai/index/status');
  },

  getStatus: async (fileId: string) => {
    return apiClient.get(`/api/ai/status/${fileId}`);
  },
};
```

---

### 任务 8.6：添加 AI 功能设置页面

**文件**：`apps/web/src/components/settings/AISettings.tsx`

**功能**：
- 显示 AI 功能状态（是否已配置）
- 一键生成全量向量索引（带警告提示）
- 实时显示索引任务进度
- 查看 AI 功能使用统计

**实现**：
```typescript
import { useState, useEffect } from 'react';
import { Sparkles, Database, RefreshCw, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Progress } from '@/components/ui/Progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog';
import { aiApi } from '@/services/api';
import { formatDate } from '@/utils';

interface IndexTask {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'idle';
  total: number;
  processed: number;
  failed: number;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  error?: string;
}

export function AISettings() {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [task, setTask] = useState<IndexTask | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchTaskStatus();
    const interval = setInterval(fetchTaskStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchTaskStatus = async () => {
    try {
      const response = await aiApi.getIndexStatus();
      if (response.success) {
        setTask(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch task status:', error);
    }
  };

  const handleStartIndex = async () => {
    setIsLoading(true);
    try {
      const response = await aiApi.indexAll();
      if (response.success) {
        setTask(response.data.task);
        setShowConfirmDialog(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const renderTaskStatus = () => {
    if (!task || task.status === 'idle') {
      return (
        <p className="text-sm text-muted-foreground">
          当前没有正在运行的索引任务
        </p>
      );
    }

    const progress = task.total > 0 ? (task.processed / task.total) * 100 : 0;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {task.status === 'running' && (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm font-medium">正在索引...</span>
            </>
          )}
          {task.status === 'completed' && (
            <>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">索引完成</span>
            </>
          )}
          {task.status === 'failed' && (
            <>
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium">索引失败</span>
            </>
          )}
        </div>

        <Progress value={progress} className="h-2" />

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>已处理: {task.processed} / {task.total}</span>
          {task.failed > 0 && <span className="text-red-500">失败: {task.failed}</span>}
        </div>

        {task.startedAt && (
          <p className="text-xs text-muted-foreground">
            开始时间: {formatDate(task.startedAt)}
          </p>
        )}
        {task.completedAt && (
          <p className="text-xs text-muted-foreground">
            完成时间: {formatDate(task.completedAt)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI 功能
        </h3>
        <p className="text-sm text-muted-foreground">
          配置 Cloudflare Workers AI 功能
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">启用 AI 功能</p>
            <p className="text-sm text-muted-foreground">
              开启后将自动为文件生成摘要和标签
            </p>
          </div>
          <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">语义搜索索引</p>
              <p className="text-sm text-muted-foreground">
                为文件建立向量索引以支持语义搜索
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(true)}
              disabled={task?.status === 'running'}
            >
              <Database className="h-4 w-4 mr-2" />
              一键生成索引
            </Button>
          </div>

          {renderTaskStatus()}
        </div>
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              确认生成全量索引
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <p className="text-sm">
                此操作将为所有未建立索引的文件生成向量索引，用于语义搜索功能。
              </p>
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  ⚠️ 重要提示：
                </p>
                <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1 list-disc list-inside">
                  <li>此操作将处理您的所有文件数据</li>
                  <li>任务将在后台异步执行，可能需要较长时间</li>
                  <li>大量文件可能消耗 AI API 配额</li>
                  <li>索引期间请勿关闭浏览器，可随时查看进度</li>
                </ul>
              </div>
              <p className="text-sm text-muted-foreground">
                确认后，系统将在后台自动处理所有文件，您可以继续使用其他功能。
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              取消
            </Button>
            <Button onClick={handleStartIndex} disabled={isLoading}>
              {isLoading ? '启动中...' : '确认开始'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

---

### 任务 8.7：更新 V1 API 支持 AI 功能

**修改文件**：`apps/api/src/routes/v1/search.ts`

**新增路由**：
```typescript
// 语义搜索路由
const semanticSearchRoute = createRoute({
  method: 'post',
  path: '/semantic',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            query: z.string().min(1),
            limit: z.number().int().min(1).max(50).default(20),
            threshold: z.number().min(0).max(1).default(0.7),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: FileListResponse,
        },
      },
      description: '语义搜索结果',
    },
  },
  tags: ['Search'],
  summary: '语义搜索',
  description: '使用 AI 向量进行语义搜索',
});
```

---

## 执行顺序与依赖关系

```
Week 7: Workers AI 接入与语义搜索
├── 7.1 配置 AI 和 Vectorize 绑定（Dashboard 配置，独立）
├── 7.2 数据库迁移 0013_ai_features.sql（独立）
├── 7.3 创建 vectorIndex.ts（依赖 7.1、7.2）
├── 7.4 创建 aiFeatures.ts（依赖 7.1）
├── 7.5 创建 ai.ts 路由（依赖 7.3、7.4）
│   └── 包含一键全量索引 API 和异步后台任务
├── 7.6 集成向量化到上传流程（依赖 7.3）
├── 7.7 增强搜索路由（依赖 7.3）
└── 7.8 前端语义搜索组件（依赖 7.5）

Week 8: AI 功能扩展
├── 8.1 AI 摘要卡片组件（依赖 7.5）
├── 8.2 智能重命名对话框（依赖 7.5）
├── 8.3 图片标签显示组件（依赖 7.5）
├── 8.4 集成到文件预览（依赖 8.1、8.2、8.3）
├── 8.5 创建 AI API 服务（依赖 7.5）
├── 8.6 AI 功能设置页面（依赖 8.5）
│   └── 包含一键生成索引、警告提示、进度显示
└── 8.7 更新 V1 API（依赖 7.5）
```

---

## 验收标准

### Workers AI 配置
- [ ] AI 和 Vectorize 绑定在 Dashboard 正确配置
- [ ] Vectorize 索引创建成功
- [ ] Env 类型定义正确（可选绑定）
- [ ] 未配置绑定时功能优雅降级

### 向量索引
- [ ] 文件上传后自动生成向量索引
- [ ] 向量索引可正常查询
- [ ] 文件删除后向量索引同步删除
- [ ] 批量索引功能正常工作
- [ ] 一键全量索引 API 正常工作
- [ ] 索引任务在后台异步执行
- [ ] 索引进度可实时查询

### 语义搜索
- [ ] 语义搜索返回相关结果
- [ ] 混合搜索正确合并结果
- [ ] 搜索结果按相似度排序
- [ ] 前端搜索组件正常显示

### AI 摘要
- [ ] 文本文件可生成摘要
- [ ] 摘要缓存机制正常工作
- [ ] 摘要显示在文件预览中
- [ ] 可手动触发重新生成

### 图片标签
- [ ] 图片上传后自动生成标签
- [ ] 标签显示在文件预览中
- [ ] 标签可点击筛选

### 智能重命名
- [ ] 可生成重命名建议
- [ ] 建议列表正常显示
- [ ] 一键采纳功能正常

### AI 设置页面
- [ ] 显示 AI 功能状态
- [ ] 一键生成索引按钮正常
- [ ] 警告提示正确显示
- [ ] 索引进度实时更新

---

## 风险与注意事项

1. **Workers AI 配额限制**：
   - 免费计划有请求限制
   - 需要监控使用量
   - 考虑添加降级策略
   - 一键全量索引可能消耗大量配额

2. **Vectorize 索引大小**：
   - 免费计划有存储限制
   - 需要定期清理无用向量
   - 大量文件可能需要分批索引

3. **AI 响应延迟**：
   - AI 模型响应可能较慢（1-5秒）
   - 需要使用 waitUntil 异步处理
   - 前端需要显示加载状态

4. **内容提取**：
   - 非文本文件需要特殊处理
   - 大文件需要截断
   - 编码问题需要注意

5. **成本控制**：
   - AI 调用产生费用
   - 需要考虑缓存策略
   - 避免重复处理同一文件

6. **错误处理**：
   - AI 服务可能不可用
   - 需要优雅降级
   - 记录错误日志

7. **异步任务管理**：
   - 使用 KV 存储任务状态
   - 任务 TTL 设为 24 小时
   - 防止重复启动任务
   - 需要处理任务中断恢复

8. **一键索引警告**：
   - 需要明确告知用户影响范围
   - 提示可能消耗 AI 配额
   - 显示预计处理时间
   - 支持取消正在运行的任务（可选）

---

## 后续批次预告

- **Phase 4**（📋 计划中）：体验完善（FTS5 搜索、通知系统、收藏夹、2FA、存储分析 Dashboard）

---

> **当前版本：3.6.0**
> 
> **已完成**：Phase 1（版本控制修复 + 备忘录基础 + API Key + 文件编辑）和 Phase 2（权限系统 v2 + RESTful v1 API + OpenAPI 文档 + Webhook）
> 
> **下一步**：Phase 3（AI 智能化）将大幅提升用户体验，语义搜索是最具差异化的功能。
