/**
 * ai.ts
 * AI 功能路由
 *
 * 功能:
 * - 向量索引管理
 * - 语义搜索
 * - 文件摘要生成
 * - 图片标签生成
 * - 智能重命名建议
 */

import { Hono } from 'hono';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import { getDb, files } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import {
  indexFileVector,
  deleteFileVector,
  buildFileTextForVector,
  isAIConfigured,
  searchAndFetchFiles,
} from '../lib/vectorIndex';
import { generateFileSummary, generateImageTags, suggestFileName } from '../lib/aiFeatures';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
  threshold: z.number().min(0).max(1).default(0.7),
  mimeType: z.string().optional(),
});

app.get('/status', async (c) => {
  const configured = await isAIConfigured(c.env);
  return c.json({
    success: true,
    data: {
      configured,
      features: {
        semanticSearch: configured,
        summary: !!c.env.AI,
        imageTags: !!c.env.AI,
        renameSuggest: !!c.env.AI,
      },
    },
  });
});

// ── 具体路径必须在 :fileId 参数路由之前，否则 Hono 会把 "batch"/"all"/"status" 当 fileId 匹配 ──

app.post('/index/batch', async (c) => {
  const userId = c.get('userId')!;
  const { fileIds } = await c.req.json();

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请提供文件ID列表' } }, 400);
  }

  const db = getDb(c.env.DB);
  const validFiles = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .all();

  const validIds = new Set(validFiles.map((f) => f.id));
  const filteredIds = fileIds.filter((id: string) => validIds.has(id));

  const results = [];
  for (const fileId of filteredIds) {
    try {
      const text = await buildFileTextForVector(c.env, fileId);
      await indexFileVector(c.env, fileId, text);
      results.push({ fileId, status: 'success' });
    } catch (error) {
      results.push({
        fileId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return c.json({ success: true, data: results });
});

app.post('/index/all', async (c) => {
  const userId = c.get('userId')!;

  const taskKey = `ai:index:task:${userId}`;
  const existingTask = await c.env.KV.get(taskKey, 'json');

  if (existingTask && (existingTask as Record<string, unknown>).status === 'running') {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message: '已有索引任务正在运行，请等待完成',
      },
    });
  }

  // total 由 runBatchIndexTask 内部快照确定，这里先用 0 占位
  const task = {
    id: crypto.randomUUID(),
    status: 'running',
    total: 0,
    processed: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await c.env.KV.put(taskKey, JSON.stringify(task), { expirationTtl: 86400 });

  c.executionCtx.waitUntil(runBatchIndexTask(c.env, userId, task));

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

app.delete('/index/task', async (c) => {
  const userId = c.get('userId')!;
  const taskKey = `ai:index:task:${userId}`;

  const existingTask = await c.env.KV.get(taskKey, 'json');

  if (!existingTask) {
    return c.json({
      success: true,
      data: { message: '没有需要取消的任务' },
    });
  }

  const task = existingTask as Record<string, unknown>;
  task.status = 'cancelled';
  task.completedAt = new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  task.error = '用户手动取消';

  await c.env.KV.put(taskKey, JSON.stringify(task), { expirationTtl: 86400 });

  return c.json({
    success: true,
    data: { message: '索引任务已取消', task },
  });
});

// :fileId 参数路由放在所有具体路径之后
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (file.isFolder) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '文件夹不支持向量化' } },
      400
    );
  }

  const text = await buildFileTextForVector(c.env, fileId);
  await indexFileVector(c.env, fileId, text);

  return c.json({ success: true, data: { message: '向量化完成' } });
});

app.delete('/index/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  await deleteFileVector(c.env, fileId);

  await db.update(files).set({ vectorIndexedAt: null }).where(eq(files.id, fileId));

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

  // searchAndFetchFiles 内部用 inArray 单次查询，避免全表扫描
  const items = await searchAndFetchFiles(c.env, query, userId, {
    limit,
    threshold,
    mimeType,
  });

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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  try {
    const result = await generateFileSummary(c.env, fileId);
    return c.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成摘要失败';
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message } }, 500);
  }
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  if (!file.mimeType?.startsWith('image/')) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '仅支持图片文件' } }, 400);
  }

  try {
    const result = await generateImageTags(c.env, fileId);
    return c.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成标签失败';
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message } }, 500);
  }
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
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  try {
    const result = await suggestFileName(c.env, fileId);
    return c.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成重命名建议失败';
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message } }, 500);
  }
});

app.get('/file/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const db = getDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();

  if (!file) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '文件不存在' } }, 404);
  }

  return c.json({
    success: true,
    data: {
      hasSummary: !!file.aiSummary,
      summary: file.aiSummary,
      summaryAt: file.aiSummaryAt,
      hasTags: !!file.aiTags,
      tags: file.aiTags ? JSON.parse(file.aiTags) : [],
      tagsAt: file.aiTagsAt,
      vectorIndexed: !!file.vectorIndexedAt,
      vectorIndexedAt: file.vectorIndexedAt,
    },
  });
});

async function runBatchIndexTask(env: Env, userId: string, task: Record<string, unknown>): Promise<void> {
  const db = getDb(env.DB);
  const taskKey = `ai:index:task:${userId}`;
  const concurrency = 5;

  try {
    const allUnindexed = await db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          isNull(files.deletedAt),
          eq(files.isFolder, false),
          isNull(files.vectorIndexedAt),
          isNotNull(files.aiSummary)
        )
      )
      .all();

    (task as any).total = allUnindexed.length;
    (task as any).processed = 0;
    (task as any).failed = 0;
    await env.KV.put(taskKey, JSON.stringify(task), { expirationTtl: 86400 });

    const indexFile = async (fileId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const text = await buildFileTextForVector(env, fileId);
        if (!text || text.trim().length === 0) {
          return { success: false, error: 'Empty text content' };
        }
        await indexFileVector(env, fileId, text);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    };

    for (let i = 0; i < allUnindexed.length; i += concurrency) {
      const batch = allUnindexed.slice(i, i + concurrency);
      const results = await Promise.allSettled(batch.map((f) => indexFile(f.id)));

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            (task as any).processed = ((task as any).processed || 0) + 1;
          } else {
            (task as any).failed = ((task as any).failed || 0) + 1;
          }
        } else {
          (task as any).failed = ((task as any).failed || 0) + 1;
        }
      }

      (task as any).updatedAt = new Date().toISOString();
      await env.KV.put(taskKey, JSON.stringify(task), { expirationTtl: 86400 });
    }

    (task as any).status = 'completed';
    (task as any).completedAt = new Date().toISOString();
    (task as any).updatedAt = new Date().toISOString();
  } catch (error) {
    (task as any).status = 'failed';
    (task as any).error = error instanceof Error ? error.message : String(error);
    (task as any).updatedAt = new Date().toISOString();
  }

  await env.KV.put(taskKey, JSON.stringify(task), { expirationTtl: 86400 });
}

export default app;
