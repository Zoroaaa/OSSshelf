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
import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb, files } from '../db';
import { authMiddleware } from '../middleware';
import { ERROR_CODES, logger } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

import {
  indexFileVector,
  deleteFileVector,
  buildFileTextForVector,
  isAIConfigured,
  searchAndFetchFiles,
} from '../lib/ai/vectorIndex';
import {
  generateFileSummary,
  generateImageTags,
  suggestFileName,
  suggestFileNameFromContent,
  canGenerateSummary,
} from '../lib/ai/features';
import { sendNotification } from '../lib/notificationUtils';
import { enqueueAiTasks, createTaskRecord, cancelTask, getLatestTaskByUserType } from '../lib/ai/aiTaskQueue';
import { ModelGateway } from '../lib/ai/modelGateway';
import { getAiConfigString } from '../lib/ai/aiConfigService';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

const searchSchema = z.object({
  query: z.string().min(0),
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

  if (!c.env.AI_TASKS_QUEUE) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'AI 任务队列未配置，请联系管理员',
        },
      },
      503
    );
  }

  const existingTask = await getLatestTaskByUserType(c.env, userId, 'index');
  if (existingTask && existingTask.status === 'running') {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message: '已有索引任务正在运行，请等待完成',
      },
    });
  }

  const db = getDb(c.env.DB);
  const allUnindexed = await db
    .select({ id: files.id, mimeType: files.mimeType, size: files.size })
    .from(files)
    .where(
      and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false), isNull(files.vectorIndexedAt))
    )
    .all();

  if (allUnindexed.length === 0) {
    return c.json({
      success: true,
      data: {
        message: '没有需要索引的文件',
        task: { status: 'completed', total: 0, processed: 0, failed: 0 },
      },
    });
  }

  // 不在此处过滤：shouldIndexFile 的判断在 enqueueAutoProcessFile 层统一执行，
  // 避免两处维护不同步，且大文件大小限制已从 shouldIndexFile 移除。
  const indexableFiles = allUnindexed;

  const task = await createTaskRecord(c.env, 'index', userId, indexableFiles.length);
  const fileIds = indexableFiles.map((f) => f.id);

  try {
    await enqueueAiTasks(c.env, 'index', fileIds, userId, task.id);

    return c.json({
      success: true,
      data: {
        message: `索引任务已启动，共 ${indexableFiles.length} 个文件`,
        task,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '启动任务失败';
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message } }, 500);
  }
});

app.get('/index/status', async (c) => {
  const userId = c.get('userId')!;
  const task = await getLatestTaskByUserType(c.env, userId, 'index');
  if (!task) {
    return c.json({ success: true, data: { id: '', status: 'idle', total: 0, processed: 0, failed: 0 } });
  }
  return c.json({ success: true, data: task });
});

app.delete('/index/task', async (c) => {
  const userId = c.get('userId')!;
  const task = await cancelTask(c.env, userId, 'index');
  if (!task) {
    return c.json({ success: true, data: { message: '没有需要取消的任务' } });
  }
  return c.json({ success: true, data: { message: '索引任务已取消', task } });
});

// 批量处理路由必须在 :fileId 参数路由之前
app.post('/summarize/batch', async (c) => {
  const userId = c.get('userId')!;

  if (!c.env.AI_TASKS_QUEUE) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'AI 任务队列未配置，请联系管理员',
        },
      },
      503
    );
  }

  const existingTask = await getLatestTaskByUserType(c.env, userId, 'summarize');
  if (existingTask && existingTask.status === 'running') {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message: '已有摘要生成任务正在运行，请等待完成',
      },
    });
  }

  const db = getDb(c.env.DB);
  const allFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false), isNull(files.aiSummary)))
    .all();

  const editableFiles = allFiles.filter((f) => canGenerateSummary(f.mimeType, f.name));

  if (editableFiles.length === 0) {
    return c.json({
      success: true,
      data: {
        message: '没有需要生成摘要的文件',
        task: { status: 'completed', total: 0, processed: 0, failed: 0 },
      },
    });
  }

  const task = await createTaskRecord(c.env, 'summary', userId, editableFiles.length);
  const fileIds = editableFiles.map((f) => f.id);

  try {
    await enqueueAiTasks(c.env, 'summary', fileIds, userId, task.id);

    return c.json({
      success: true,
      data: {
        message: `摘要生成任务已启动，共 ${editableFiles.length} 个文件`,
        task,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '启动任务失败';
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message } }, 500);
  }
});

app.get('/summarize/task', async (c) => {
  const userId = c.get('userId')!;
  const task = await getLatestTaskByUserType(c.env, userId, 'summarize');
  if (!task) {
    return c.json({ success: true, data: { id: '', status: 'idle', total: 0, processed: 0, failed: 0 } });
  }
  return c.json({ success: true, data: task });
});

app.post('/tags/batch', async (c) => {
  const userId = c.get('userId')!;

  if (!c.env.AI_TASKS_QUEUE) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'AI 任务队列未配置，请联系管理员',
        },
      },
      503
    );
  }

  const existingTask = await getLatestTaskByUserType(c.env, userId, 'tags');
  if (existingTask && existingTask.status === 'running') {
    return c.json({
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message: '已有标签生成任务正在运行，请等待完成',
      },
    });
  }

  const db = getDb(c.env.DB);
  const allImages = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        isNull(files.deletedAt),
        eq(files.isFolder, false),
        isNull(files.aiTags),
        sql`${files.mimeType} LIKE 'image/%'`
      )
    )
    .all();

  if (allImages.length === 0) {
    return c.json({
      success: true,
      data: {
        message: '没有需要生成标签的图片',
        task: { status: 'completed', total: 0, processed: 0, failed: 0 },
      },
    });
  }

  const task = await createTaskRecord(c.env, 'tags', userId, allImages.length);
  const fileIds = allImages.map((f) => f.id);

  try {
    await enqueueAiTasks(c.env, 'tags', fileIds, userId, task.id);

    return c.json({
      success: true,
      data: {
        message: `标签生成任务已启动，共 ${allImages.length} 张图片`,
        task,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '启动任务失败';
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message } }, 500);
  }
});

// 取消摘要任务
app.delete('/summarize/batch', async (c) => {
  const userId = c.get('userId')!;
  const task = await cancelTask(c.env, userId, 'summarize');
  if (!task) {
    return c.json({ success: true, data: { message: '没有需要取消的任务' } });
  }
  return c.json({ success: true, data: { message: '摘要任务已取消', task } });
});

// 取消标签任务
app.delete('/tags/batch', async (c) => {
  const userId = c.get('userId')!;
  const task = await cancelTask(c.env, userId, 'tags');
  if (!task) {
    return c.json({ success: true, data: { message: '没有需要取消的任务' } });
  }
  return c.json({ success: true, data: { message: '标签任务已取消', task } });
});

app.get('/tags/task', async (c) => {
  const userId = c.get('userId')!;
  const task = await getLatestTaskByUserType(c.env, userId, 'tags');
  if (!task) {
    return c.json({ success: true, data: { id: '', status: 'idle', total: 0, processed: 0, failed: 0 } });
  }
  return c.json({ success: true, data: task });
});

const processSelectedSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
  types: z.array(z.enum(['summary', 'tags'])).min(1),
});

app.post('/process-selected', async (c) => {
  const userId = c.get('userId')!;

  if (!c.env.AI_TASKS_QUEUE) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'AI 任务队列未配置，请联系管理员',
        },
      },
      503
    );
  }

  const body = await c.req.json();
  const result = processSelectedSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { fileIds, types } = result.data;
  const db = getDb(c.env.DB);

  const validFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .all();

  const validIds = new Set(validFiles.map((f) => f.id));
  const filteredFiles = validFiles.filter((f) => validIds.has(f.id) && fileIds.includes(f.id));

  if (filteredFiles.length === 0) {
    return c.json({
      success: true,
      data: {
        message: '没有需要处理的文件',
        task: { status: 'completed', total: 0, processed: 0, failed: 0 },
      },
    });
  }

  const summaryFiles = types.includes('summary')
    ? filteredFiles.filter((f) => canGenerateSummary(f.mimeType, f.name))
    : [];

  const tagFiles = types.includes('tags') ? filteredFiles.filter((f) => f.mimeType?.startsWith('image/')) : [];

  const totalTasks = summaryFiles.length + tagFiles.length;

  if (totalTasks === 0) {
    return c.json({
      success: true,
      data: {
        message: '选中的文件没有可处理的内容',
        task: { status: 'completed', total: 0, processed: 0, failed: 0 },
      },
    });
  }

  const task = await createTaskRecord(c.env, 'summary', userId, totalTasks);

  try {
    if (summaryFiles.length > 0) {
      await enqueueAiTasks(
        c.env,
        'summary',
        summaryFiles.map((f) => f.id),
        userId,
        task.id
      );
    }

    if (tagFiles.length > 0) {
      await enqueueAiTasks(
        c.env,
        'tags',
        tagFiles.map((f) => f.id),
        userId,
        task.id
      );
    }

    return c.json({
      success: true,
      data: {
        message: `已提交 ${totalTasks} 个AI处理任务（摘要: ${summaryFiles.length}，标签: ${tagFiles.length}）`,
        task,
        summaryCount: summaryFiles.length,
        tagsCount: tagFiles.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '启动任务失败';
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message } }, 500);
  }
});

// 具体路径路由必须在 :fileId 参数路由之前
app.get('/index/stats', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const allFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .all();

  const stats = {
    editable: { total: 0, noSummary: 0, notIndexed: 0 },
    image: { total: 0, noTags: 0, notIndexed: 0 },
    other: { total: 0, notIndexed: 0 },
  };

  for (const file of allFiles) {
    const isEditable = canGenerateSummary(file.mimeType, file.name);
    const isImage = file.mimeType?.startsWith('image/') ?? false;

    if (isEditable) {
      stats.editable.total++;
      if (!file.aiSummary) stats.editable.noSummary++;
      if (!file.vectorIndexedAt) stats.editable.notIndexed++;
    } else if (isImage) {
      stats.image.total++;
      if (!file.aiTags) stats.image.noTags++;
      if (!file.vectorIndexedAt) stats.image.notIndexed++;
    } else {
      stats.other.total++;
      if (!file.vectorIndexedAt) stats.other.notIndexed++;
    }
  }

  return c.json({ success: true, data: stats });
});

app.get('/index/vectors', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '20');
  const search = c.req.query('search') || '';

  const allFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
    .all();

  const indexedFiles = allFiles
    .filter((f) => f.vectorIndexedAt)
    .filter((f) => !search || f.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(b.vectorIndexedAt!).getTime() - new Date(a.vectorIndexedAt!).getTime());

  const total = indexedFiles.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  const paginatedFiles = indexedFiles.slice(offset, offset + pageSize);

  const vectorsWithMetadata = paginatedFiles.map((file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    vectorIndexedAt: file.vectorIndexedAt,
    aiSummary: file.aiSummary,
    indexedTextLength: (file.name + (file.aiSummary || '') + (file.description || '')).length,
    indexedTextPreview: file.name + (file.aiSummary ? ` - ${file.aiSummary.slice(0, 100)}...` : ''),
  }));

  return c.json({
    success: true,
    data: {
      vectors: vectorsWithMetadata,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    },
  });
});


app.get('/index/sample/:fileId', async (c) => {
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

  const result = {
    file: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      vectorIndexedAt: file.vectorIndexedAt,
      aiSummary: file.aiSummary,
    },
    vectorize: null as {
      found: boolean;
      metadata: Record<string, unknown> | null;
    } | null,
    indexedText: '',
  };

  try {
    if (c.env.VECTORIZE) {
      const testVector = new Array(1024).fill(0).map(() => Math.random());
      const searchResult = await c.env.VECTORIZE.query(testVector, {
        topK: 1000,
        filter: { userId } as VectorizeVectorMetadataFilter,
        returnMetadata: 'all',
      });

      const found = searchResult.matches.find((m) => m.id === fileId);
      result.vectorize = {
        found: !!found,
        metadata: found ? (found.metadata as Record<string, unknown>) : null,
      };
    }
  } catch (error) {
    logger.error('AI', 'Failed to check vectorize', { fileId }, error);
  }

  try {
    const text = await buildFileTextForVector(c.env, fileId);
    result.indexedText = text.slice(0, 500) + (text.length > 500 ? '...' : '');
  } catch (error) {
    logger.error('AI', 'Failed to build text', { fileId }, error);
  }

  return c.json({ success: true, data: result });
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
    const result = await generateFileSummary(c.env, fileId, undefined, userId);

    sendNotification(c, {
      userId,
      type: 'ai_complete',
      title: 'AI 摘要生成完成',
      body: `文件「${file.name}」的摘要已生成`,
      data: {
        fileId,
        fileName: file.name,
        feature: 'summary',
      },
    });

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
    const result = await generateImageTags(c.env, fileId, undefined, userId);

    sendNotification(c, {
      userId,
      type: 'ai_complete',
      title: 'AI 标签生成完成',
      body: `图片「${file.name}」的标签已生成`,
      data: {
        fileId,
        fileName: file.name,
        feature: 'tags',
      },
    });

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
    const result = await suggestFileName(c.env, fileId, undefined, userId);
    return c.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成重命名建议失败';
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message } }, 500);
  }
});

const nameSuggestSchema = z.object({
  content: z.string().min(30, '文件内容至少需要30个字符'),
  mimeType: z.string().nullable().optional(),
  extension: z.string().optional(),
});

app.post('/name-suggest', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = nameSuggestSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { content, mimeType, extension } = result.data;

  try {
    const suggestions = await suggestFileNameFromContent(c.env, content, mimeType || null, extension || '', userId);
    return c.json({ success: true, data: suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成命名建议失败';
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

export default app;
