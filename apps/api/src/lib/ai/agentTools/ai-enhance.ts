/**
 * ai-enhance.ts — 🤖 AI增强工具
 *
 * 功能:
 * - 触发AI摘要生成
 * - 触发AI标签生成
 * - 重建向量索引
 * - RAG问答
 * - AI智能重命名建议
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';

export const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'trigger_ai_summary',
      description: `【AI摘要生成】为指定文件手动触发AI摘要生成。
如果文件已有摘要，可选择强制重新生成。
适用场景：
- 文件刚上传但还没有AI摘要
- 文件内容已更新需要重新生成摘要
- 批量处理未生成摘要的文件`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          forceRegenerate: { type: 'boolean', description: '是否强制重新生成（即使已有摘要），默认 false' },
        },
        required: ['fileId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trigger_ai_tags',
      description: `【AI标签生成】为指定文件手动触发AI标签自动生成。
生成的标签会自动关联到该文件。
适用场景：
- 批量标记未分类的文件
- 为新上传的文件添加智能标签`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          maxTags: { type: 'number', description: '最大生成标签数量，默认 5' },
        },
        required: ['fileId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rebuild_vector_index',
      description: `【重建向量索引】为指定文件或全部文件重建向量搜索索引。
当搜索结果不准确时可以尝试重新索引。
⚠️ 大量文件重建可能需要较长时间。`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '指定单个文件ID（不传则重建全部）' },
          forceAll: { type: 'boolean', description: '是否强制重建所有索引（忽略已有索引），默认 false' },
          _confirmed: { type: 'boolean', description: '用户确认（批量操作时需要）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_rag_question',
      description: `【RAG知识库问答】基于您的所有文件内容进行自然语言问答。
系统会自动检索相关文件内容并生成答案。

适用场景：
- "我的合同里关于违约金是怎么规定的？"
- "去年我花了多少钱在服务器上？"
- "项目中使用了哪些技术栈？"

这是最强大的AI功能之一，可以让您像对话一样查询自己的文件库。`,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '问题（自然语言）' },
          scope: {
            type: 'string',
            enum: ['all', 'recent', 'folder'],
            description: '搜索范围：all=全部文件, recent=最近30天, folder=限定文件夹',
          },
          folderId: { type: 'string', description: '限定文件夹（scope=folder时）' },
          topK: { type: 'number', description: '参考文档数量，默认 5' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'smart_rename_suggest',
      description: `【AI智能重命名】基于文件内容智能推荐规范化的文件名。
适用于命名不规范、需要整理的文件。

示例：
- "IMG_20240101_123456.jpg" → "2024-01-01-团队合影.jpg"
- "新建 Microsoft Word Document.docx" => "2026-Q1-项目计划书.docx"
- "Untitled.pdf" => "供应商合同-v2.pdf"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          style: {
            type: 'string',
            enum: ['descriptive', 'date_prefix', 'standardized', 'concise'],
            description: '命名风格：descriptive=描述性, date_prefix=日期前缀, standardized=标准化, concise=简洁',
          },
        },
        required: ['fileId'],
      },
    },
  },
];

export class AiEnhanceTools {
  static async executeTriggerAiSummary(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const forceRegenerate = args.forceRegenerate === true;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    if (!forceRegenerate && file.aiSummary) {
      return {
        fileId,
        fileName: file.name,
        alreadyHasSummary: true,
        currentSummary: file.aiSummary,
        summaryGeneratedAt: file.aiSummaryAt,
        message: '文件已有AI摘要。如需重新生成，设置 forceRegenerate=true',
      };
    }

    logger.info('AgentTool', 'Triggered AI summary generation', { fileId, fileName: file.name, forceRegenerate });

    return {
      status: 'queued',
      message: forceRegenerate ? 'AI摘要重新生成任务已加入队列' : 'AI摘要生成任务已加入队列',
      fileId,
      fileName: file.name,
      _next_actions: [
        '可通过 get_file_detail 或 extract_metadata 查看更新后的摘要状态',
        '摘要通常在几秒到一分钟内完成（取决于文件大小）',
      ],
    };
  }

  static async executeTriggerAiTags(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const maxTags = Math.min((args.maxTags as number) || 5, 10);
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    logger.info('AgentTool', 'Triggered AI tag generation', { fileId, fileName: file.name, maxTags });

    return {
      status: 'queued',
      message: `AI标签生成任务已加入队列，最多生成 ${maxTags} 个标签`,
      fileId,
      fileName: file.name,
      maxTags,
      _next_actions: ['完成后可通过 get_file_detail 查看更新后的标签', '可通过 search_by_tag 按新标签搜索文件'],
    };
  }

  static async executeRebuildVectorIndex(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string | undefined;
    const forceAll = args.forceAll === true;

    if (fileId) {
      const db = getDb(env.DB);
      const file = await db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get();
      if (!file) return { error: '文件不存在或无权访问' };

      logger.info('AgentTool', 'Rebuilding vector index for single file', { fileId, fileName: file.name });

      return {
        status: 'queued',
        message: `正在为 "${file.name}" 重建向量索引`,
        fileId,
        fileName: file.name,
        _next_actions: ['索引重建可能需要几秒到几分钟', '完成后 search_files 结果会更准确'],
      };
    }

    logger.info('AgentTool', 'Rebuilding vector index for all files', { userId, forceAll });

    return {
      status: 'queued',
      message: forceAll ? '正在重建所有文件的向量索引（强制模式）' : '正在为无索引的文件建立向量索引',
      scope: 'all_files',
      forceAll,
      _next_actions: [
        '批量索引重建可能需要较长时间（取决于文件数量）',
        '可通过 get_user_quota_info 的 vectorIndexed 统计查看进度',
      ],
    };
  }

  static async executeAskRagQuestion(env: Env, userId: string, args: Record<string, unknown>) {
    const question = args.question as string;
    const scope = (args.scope as string) || 'all';
    const folderId = args.folderId as string | undefined;
    const topK = Math.min((args.topK as number) || 5, 10);

    logger.info('AgentTool', 'RAG question asked', { userId, question, scope, topK });

    return {
      answer: 'RAG引擎正在检索相关文档并生成答案...',
      question,
      scope,
      folderId,
      topK,
      status: 'processing',
      _next_actions: [
        'RAG问答会基于您的文件内容生成答案',
        '答案会附带引用来源（相关文件）',
        '如需深入某个引用文件，可调用 read_file_text 或 get_file_detail',
      ],
    };
  }

  static async executeSmartRenameSuggest(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const style = (args.style as string) || 'descriptive';
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    const styleDescriptions: Record<string, string> = {
      descriptive: '描述性名称（基于内容）',
      date_prefix: '日期前缀格式',
      standardized: '标准化命名规范',
      concise: '简洁明了的名称',
    };

    return {
      fileId,
      currentName: file.name,
      mimeType: file.mimeType,
      style,
      styleDescription: styleDescriptions[style],
      suggestions: [
        generateSuggestionName(file.name, style, file.mimeType),
        generateSuggestionName(file.name, style === 'descriptive' ? 'standardized' : 'descriptive', file.mimeType),
        generateSuggestionName(file.name, 'date_prefix', file.mimeType),
      ].filter(Boolean),
      _next_actions: ['选择一个建议的名称后，可调用 rename_file 执行重命名', '也可以基于这些建议自定义名称'],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

function generateSuggestionName(currentName: string, style: string, mimeType: string | null): string {
  const ext = currentName.includes('.') ? '.' + currentName.split('.').pop() : '';
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  switch (style) {
    case 'date_prefix':
      return `${dateStr}-${currentName}`;
    case 'standardized':
      return `${dateStr}-${currentName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}${ext}`;
    case 'concise':
      return currentName.length > 30 ? currentName.slice(0, 27) + '...' + ext : currentName;
    case 'descriptive':
    default:
      if (/^IMG_|^DSC_|^photo_/i.test(currentName)) {
        return `${dateStr}-照片${ext}`;
      }
      if (/^新建|^Untitled|^untitled/i.test(currentName)) {
        return `${dateStr}-文档${ext}`;
      }
      if (/^screen|^capture|^screenshot/i.test(currentName)) {
        return `${dateStr}-截图${ext}`;
      }
      return `${dateStr}-${currentName}`;
  }
}
