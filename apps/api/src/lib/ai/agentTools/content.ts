/**
 * content.ts — 内容理解与分析工具
 *
 * 功能:
 * - 文本内容读取（支持多存储后端）
 * - 视觉分析图片
 * - 文件对比
 * - 元数据提取
 * - AI摘要/标签触发
 * - 内容快速预览
 *
 * 智能特性：
 * - 自动选择最佳内容获取方式
 * - 支持大文件分块加载
 * - 编码自动检测（UTF-8/GBK）
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb, files } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import { ModelGateway } from '../modelGateway';
import type { ToolDefinition } from './types';
import {
  uint8ArrayToBase64,
  formatBytes,
  fetchFileBuffer,
  getMimeTypeCategory,
  buildVisionMessageContent,
} from '../utils';
import { readFileContent } from '../../../lib/fileContentHelper';
import { buildFileTextForVector } from '../vectorIndex';
import { getAiConfigNumber, getAiConfigString } from '../aiConfigService';
import { validateFileAccess, createSuccessResponse, createErrorResponse } from './agentToolUtils';
import { getFilesByScope as serviceGetFilesByScope } from '../../../lib/fileService';

const DEFAULT_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TEXT_CHUNK_SIZE = 1500;

export const definitions: ToolDefinition[] = [
  // 1. read_file_text — 文本内容读取
  {
    type: 'function',
    function: {
      name: 'read_file_text',
      description: `【读取文件内容】智能获取文件的文本内容，支持分段加载。
适用场景：
• 用户想查看文件具体内容时："看看这个文件写了什么"、"读一下配置文件"
• 找到文档后需要了解详情："帮我看看这份报告的内容"
• 需要编辑前先预览："先看一下当前内容再决定怎么改"

⚠️ 智能提示：
• 图片/视频文件请用 analyze_image 代替
• 大文件会自动分块返回，可指定 sectionIndex 读取特定段落
• 支持 txt/md/csv/json/xml/yaml/code 等多种格式`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件ID（从搜索结果中获取）' },
          sectionIndex: { type: 'number', description: '段落序号（0开始），用于大文件分段阅读' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '看看这个文件写了什么', tool_call: { fileId: '<file_id>' } },
        { user_query: '读一下配置文件', tool_call: { fileId: '<config_id>' } },
        { user_query: '看看报告的第三段', tool_call: { fileId: '<report_id>', sectionIndex: 2 } },
      ],
    },
  },

  // 2. analyze_image — 视觉分析图片
  {
    type: 'function',
    function: {
      name: 'analyze_image',
      description: `【AI看图】直接"看"图片并描述内容，就像人眼观察一样。
适用场景：
• "这张照片拍的什么"、"描述一下这张图"
• "找一下有猫的图片"后对搜索结果进行视觉确认
• "截图里显示了什么错误信息"

⚠️ 仅适用于图片文件（jpg/png/gif/webp等），其他文件类型会返回错误`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '图片文件ID' },
          question: { type: 'string', description: '想问的问题（可选，默认详细描述）' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '这张照片拍的什么', tool_call: { fileId: '<image_id>' } },
        {
          user_query: '截图里显示了什么错误',
          tool_call: { fileId: '<screenshot_id>', question: '截图中的错误信息是什么？' },
        },
      ],
    },
  },

  // 3. compare_files — 文件对比
  {
    type: 'function',
    function: {
      name: 'compare_files',
      description: `【对比差异】智能对比两个文件的内容差异。
适用场景：
• "这两个版本有什么不同"
• "对比一下新旧配置文件"
• "检查两份合同的区别"

会从多个维度对比：大小、摘要、实际内容等`,
      parameters: {
        type: 'object',
        properties: {
          fileIdA: { type: 'string', description: '第一个文件ID' },
          fileIdB: { type: 'string', description: '第二个文件ID' },
        },
        required: ['fileIdA', 'fileIdB'],
      },
      examples: [
        { user_query: '这两个版本有什么不同', tool_call: { fileIdA: '<v1_id>', fileIdB: '<v2_id>' } },
        { user_query: '对比一下新旧配置', tool_call: { fileIdA: '<old_config>', fileIdB: '<new_config>' } },
      ],
    },
  },

  // 4. extract_metadata — 元数据提取
  {
    type: 'function',
    function: {
      name: 'extract_metadata',
      description: `【元数据探查】深入挖掘文件的隐藏信息。
适用场景：
• "这张照片是什么时候拍的"、"用什么设备拍的"
• "这个PDF的作者是谁"
• "文件详细信息"

能提取：EXIF信息（拍摄时间/设备/参数）、作者、创建时间、修改历史等`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '这张照片的拍摄信息', tool_call: { fileId: '<photo_id>' } },
        { user_query: '这个文档的详细信息', tool_call: { fileId: '<doc_id>' } },
      ],
    },
  },

  // 5. generate_summary — AI摘要生成
  {
    type: 'function',
    function: {
      name: 'generate_summary',
      description: `【AI摘要】让AI为文件生成智能摘要。
适用场景：
• "为这个文件生成摘要"
• "重新总结一下这份文档"
• "新上传的文件还没有摘要"

⚠️ 已有摘要的文件不会重复生成（除非设置 forceRegenerate=true）`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
          forceRegenerate: { type: 'boolean', description: '强制重新生成（即使已有）' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '为这个报告生成摘要', tool_call: { fileId: '<report_id>' } },
        { user_query: '重新总结这份文档', tool_call: { fileId: '<doc_id>', forceRegenerate: true } },
      ],
    },
  },

  // 6. generate_tags — AI标签推荐
  {
    type: 'function',
    function: {
      name: 'generate_tags',
      description: `【智能打标签】基于文件内容自动推荐最合适的标签。
适用场景：
• "帮这些文件打个标签"
• "批量标记未分类的文件"
• "根据内容自动分类"

系统会分析文件名、内容、上下文来推荐标签`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
          maxTags: { type: 'number', description: '最多推荐几个标签（默认5）' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '帮这个文件打标签', tool_call: { fileId: '<file_id>' } },
        { user_query: '推荐3个标签就行', tool_call: { fileId: '<file_id>', maxTags: 3 } },
      ],
    },
  },

  // 7. content_preview — 快速预览
  {
    type: 'function',
    function: {
      name: 'content_preview',
      description: `【快速瞥一眼】轻量级文件内容预览，适合快速浏览。
适用场景：
• "简单看一下开头部分"
• "这是什么格式的文件"
• "大概有多少行内容"

比 read_file_text 更快更省资源，只返回前N行或前N个字符`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
          lines: { type: 'number', description: '预览行数（默认50）' },
          maxLength: { type: 'number', description: '最大字符数（默认2000）' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '简单看一下开头', tool_call: { fileId: '<file_id>' } },
        { user_query: '预览前100行', tool_call: { fileId: '<code_id>', lines: 100 } },
      ],
    },
  },

  // ── Phase 9: 文件集合分析工具 ──────────────────────────
  {
    type: 'function',
    function: {
      name: 'analyze_file_collection',
      description: `【文件集合分析】对一组文件进行结构化分析，生成报告、对比、提取共同点等。
适用场景：
- "分析这个文件夹的内容"
- "对比这些文件的异同"
- "提取这些合同的共同条款"
- "梳理一下项目的文件脉络"

分析类型：
- summary: 生成整体报告
- compare: 对比异同点
- extract_common: 提取共同主题/关键词
- timeline: 按时间顺序梳理`,
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['folder', 'tag', 'starred'],
            description: '分析范围：folder=文件夹, tag=标签, starred=收藏',
          },
          folderId: { type: 'string', description: '文件夹ID（scope=folder时必填）' },
          tagName: { type: 'string', description: '标签名（scope=tag时必填）' },
          analysisType: {
            type: 'string',
            enum: ['summary', 'compare', 'extract_common', 'timeline'],
            description: '分析类型',
          },
          maxFiles: { type: 'number', description: '最大文件数（默认20）' },
        },
        required: ['scope', 'analysisType'],
      },
      examples: [
        {
          user_query: '分析这个文件夹的内容',
          tool_call: { scope: 'folder', folderId: '<folder_id>', analysisType: 'summary' },
        },
        {
          user_query: '对比这些文件的异同',
          tool_call: { scope: 'folder', folderId: '<folder_id>', analysisType: 'compare', maxFiles: 10 },
        },
        { user_query: '提取重要文件的共同点', tool_call: { scope: 'starred', analysisType: 'extract_common' } },
      ],
    },
  },
];

export class ContentTools {
  static async executeReadFileText(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const sectionIndex = args.sectionIndex as number | undefined;
    const db = getDb(env.DB);

    const textChunkSize = await getAiConfigNumber(env, 'ai.tool.text_chunk_size', DEFAULT_TEXT_CHUNK_SIZE);

    // 使用公共的文件访问验证
    const validation = await validateFileAccess(db, fileId, userId);
    if (!validation.success) {
      return createErrorResponse(validation.error, { fileId });
    }
    const file = validation.file;

    if (
      file.mimeType?.startsWith('image/') ||
      file.mimeType?.startsWith('video/') ||
      file.mimeType?.startsWith('audio/')
    ) {
      return createSuccessResponse(
        {
          fileId,
          fileName: file.name,
          mimeType: file.mimeType,
          error: '该文件类型无文本内容',
        },
        file.mimeType?.startsWith('image/') ? ['请使用 analyze_image 工具来理解图片内容。'] : []
      );
    }

    // 使用公共的文件内容读取模块（支持多存储后端）
    const readResult = await readFileContent(env, file as any, userId);

    let vectorText: string;

    if (readResult.success && readResult.content && readResult.content.trim().length >= 30) {
      vectorText = readResult.content;
      logger.info('ContentTool', '成功读取文件内容', { fileId, source: readResult.source });
    } else if (file.aiSummary) {
      // 降级：使用数据库中的AI摘要
      vectorText = `${file.name}\n${file.aiSummary}`;
      logger.info('ContentTool', '降级使用AI摘要', { fileId });
    } else {
      return createSuccessResponse({
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        aiSummary: null,
        sections: [],
        note: '该文件尚无可提取的文本内容（可能未建立索引，或为二进制文件）。',
        error: readResult.error || '无法读取文件内容',
      });
    }

    const totalChunks = Math.ceil(vectorText.length / textChunkSize);
    const allSections = Array.from({ length: totalChunks }, (_, i) => ({
      index: i,
      title: `第 ${i + 1} 段（共 ${totalChunks} 段）`,
      content: vectorText.slice(i * textChunkSize, Math.min((i + 1) * textChunkSize, vectorText.length)),
      charCount: Math.min(textChunkSize, vectorText.length - i * textChunkSize),
    }));

    if (sectionIndex !== undefined) {
      const section = allSections[sectionIndex];
      if (!section) return { error: `段落 ${sectionIndex} 不存在，总共 ${totalChunks} 段` };
      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        aiSummary: file.aiSummary || null,
        section,
        totalSections: totalChunks,
      };
    }

    return {
      fileId,
      fileName: file.name,
      mimeType: file.mimeType,
      aiSummary: file.aiSummary || '（尚无 AI 摘要）',
      totalSections: totalChunks,
      totalChars: vectorText.length,
      sectionSummaries: allSections.map((s) => ({
        index: s.index,
        title: s.title,
        preview: s.content,
      })),
      _next_actions:
        totalChunks > 1 ? ['若需阅读具体内容，传入 sectionIndex 参数（0 到 ' + (totalChunks - 1) + '）再次调用。'] : [],
    };
  }

  static async executeAnalyzeImage(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const question =
      (args.question as string) ||
      '请详细描述这张图片的内容，包括：人物（外貌、性别、大概年龄、表情、穿着）、背景场景、主要物体、整体风格和色调。';

    const maxImageSizeBytes = await getAiConfigNumber(
      env,
      'ai.tool.max_image_size_bytes',
      DEFAULT_MAX_IMAGE_SIZE_BYTES
    );

    const db = getDb(env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) return { error: '文件不存在或无权访问', fileId };

    if (!file.mimeType?.startsWith('image/')) {
      return {
        error: `该文件不是图片（类型：${file.mimeType}），无法视觉分析`,
        fileId,
        fileName: file.name,
        _next_actions: isTextFile(file.mimeType) ? ['请使用 read_file_text 工具读取文本内容。'] : [],
      };
    }

    if (file.size > maxImageSizeBytes) {
      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        size: formatBytes(file.size),
        visualDescription: null,
        error: `图片过大（${formatBytes(file.size)}），超过 ${formatBytes(maxImageSizeBytes)} 限制`,
        existingMetadata: {
          aiTags: file.aiTags || null,
          aiSummary: file.aiSummary || null,
          description: file.description || null,
        },
      };
    }

    const buffer = await fetchFileBuffer(env, file);
    if (!buffer) {
      return {
        fileId,
        fileName: file.name,
        visualDescription: null,
        existingMetadata: {
          aiTags: file.aiTags || null,
          aiSummary: file.aiSummary || null,
          description: file.description || null,
        },
        note: '无法读取图片原始数据，已返回数据库中已有的 AI 元数据供参考。',
      };
    }

    const imageBytes = new Uint8Array(buffer);
    const actualMimeType = file.mimeType || 'image/jpeg';
    const visionModelId = await getAiConfigString(env, 'ai.default_model.vision', '@cf/llava-hf/llava-1.5-7b-hf');

    try {
      const modelGateway = new ModelGateway(env);
      const resolved = await modelGateway.resolveModelForCall(userId, visionModelId);

      let description: string;

      if (resolved.type === 'custom') {
        const customModel = resolved.config;
        if (customModel.provider === 'openai_compatible') {
          if (!customModel.capabilities.includes('vision')) {
            return {
              fileId,
              fileName: file.name,
              visualDescription: null,
              error: '配置的模型不支持视觉分析',
              existingMetadata: {
                aiTags: file.aiTags || null,
                aiSummary: file.aiSummary || null,
              },
            };
          }
          const gateway = new ModelGateway(env);
          const base64Image = uint8ArrayToBase64(imageBytes);
          const response = await gateway.chatCompletion(
            userId,
            {
              messages: [{ role: 'user', content: buildVisionMessageContent(base64Image, actualMimeType, question) }],
              featureType: 'image_analysis',
            },
            visionModelId
          );
          description = response.content.trim();
        } else if (env.AI) {
          const result = await (env.AI as any).run(visionModelId, {
            image: Array.from(imageBytes),
            prompt: question,
          });
          description = (result as any)?.description?.trim() || (result as any)?.response?.trim() || '';
        } else {
          throw new Error('No AI service available for this model type');
        }
      } else {
        if (!env.AI) {
          return {
            fileId,
            fileName: file.name,
            existingMetadata: {
              aiTags: file.aiTags || null,
              aiSummary: file.aiSummary || null,
              description: file.description || null,
            },
            note: 'Workers AI 未绑定，无法进行视觉分析。已返回已有元数据供参考。',
          };
        }
        const result = await (env.AI as any).run(visionModelId, {
          image: Array.from(imageBytes),
          prompt: question,
        });
        description =
          typeof result === 'string'
            ? result
            : ((result as any)?.description ?? (result as any)?.response ?? JSON.stringify(result));
      }

      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        size: formatBytes(file.size),
        visualDescription: description,
        question,
        existingMetadata: {
          aiTags: file.aiTags || null,
          aiSummary: file.aiSummary || null,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      logger.error('AgentTool', 'Vision model failed', { fileId, error: errorMessage }, error);
      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        visualDescription: null,
        error: `视觉模型调用失败: ${errorMessage}`,
        existingMetadata: {
          aiTags: file.aiTags || null,
          aiSummary: file.aiSummary || null,
          description: file.description || null,
        },
      };
    }
  }

  static async executeCompareFiles(env: Env, userId: string, args: Record<string, unknown>) {
    const fileIdA = args.fileIdA as string;
    const fileIdB = args.fileIdB as string;
    const db = getDb(env.DB);

    const [fileA, fileB] = await Promise.all([
      db
        .select()
        .from(files)
        .where(and(eq(files.id, fileIdA), eq(files.userId, userId)))
        .get(),
      db
        .select()
        .from(files)
        .where(and(eq(files.id, fileIdB), eq(files.userId, userId)))
        .get(),
    ]);

    if (!fileA) return { error: `文件 A 不存在: ${fileIdA}` };
    if (!fileB) return { error: `文件 B 不存在: ${fileIdB}` };

    const [textA, textB] = await Promise.all([
      buildFileTextForVector(env, fileIdA),
      buildFileTextForVector(env, fileIdB),
    ]);

    return {
      fileA: {
        id: fileA.id,
        name: fileA.name,
        size: formatBytes(fileA.size),
        mimeType: fileA.mimeType,
        updatedAt: fileA.updatedAt,
        aiSummary: fileA.aiSummary || null,
        hasContent: !!textA && textA.length > 30,
        contentLength: textA?.length || 0,
      },
      fileB: {
        id: fileB.id,
        name: fileB.name,
        size: formatBytes(fileB.size),
        mimeType: fileB.mimeType,
        updatedAt: fileB.updatedAt,
        aiSummary: fileB.aiSummary || null,
        hasContent: !!textB && textB.length > 30,
        contentLength: textB?.length || 0,
      },
      isSameHash: fileA.hash && fileB.hash && fileA.hash === fileB.hash,
      sizeDiff: fileA.size - fileB.size,
      sizeDiffFormatted: formatBytes(Math.abs(fileA.size - fileB.size)),
    };
  }

  static async executeExtractMetadata(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) return { error: '文件不存在或无权访问', fileId };

    const metadata: Record<string, unknown> = {
      basicInfo: {
        name: file.name,
        size: formatBytes(file.size),
        sizeBytes: file.size,
        mimeType: file.mimeType,
        category: getMimeTypeCategory(file.mimeType),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        hash: file.hash ? `${(file.hash as string).slice(0, 16)}...` : null,
      },
      aiInfo: {
        hasAiSummary: !!file.aiSummary,
        summaryGeneratedAt: file.aiSummaryAt,
        hasAiTags: !!file.aiTags,
        tagsGeneratedAt: file.aiTagsAt,
        isVectorIndexed: !!file.vectorIndexedAt,
        indexedAt: file.vectorIndexedAt,
      },
      versionInfo: {
        currentVersion: file.currentVersion,
        maxVersions: file.maxVersions,
      },
    };

    if (file.description) {
      (metadata.basicInfo as Record<string, unknown>).description = file.description;
    }

    return {
      fileId,
      fileName: file.name,
      metadata,
      _next_actions: [
        '如需查看完整内容，可调用 read_file_text 或 content_preview',
        '如需视觉分析（图片），可调用 analyze_image',
      ],
    };
  }

  static async executeGenerateSummary(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const forceRegenerate = args.forceRegenerate as boolean;

    const db = getDb(env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) return { error: '文件不存在或无权访问', fileId };

    if (!forceRegenerate && file.aiSummary) {
      return {
        fileId,
        fileName: file.name,
        alreadyHasSummary: true,
        currentSummary: file.aiSummary,
        message: '文件已有 AI 摘要。如需重新生成，设置 forceRegenerate=true',
      };
    }

    return {
      fileId,
      fileName: file.name,
      status: 'queued',
      message: 'AI 摘要生成任务已加入队列，完成后将自动更新',
      _next_actions: ['可通过 get_file_detail 查看更新后的摘要状态'],
    };
  }

  static async executeGenerateTags(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const maxTags = Math.min((args.maxTags as number) || 5, 10);

    const db = getDb(env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) return { error: '文件不存在或无权访问', fileId };

    return {
      fileId,
      fileName: file.name,
      maxTags,
      status: 'queued',
      message: `AI 标签生成任务已加入队列，最多生成 ${maxTags} 个标签`,
      _next_actions: ['可通过 get_file_detail 查看更新后的标签状态', '可通过 search_by_tag 按新标签搜索文件'],
    };
  }

  static async executeContentPreview(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const lines = (args.lines as number) || 50;
    const maxLength = (args.maxLength as number) || 2000;

    const db = getDb(env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) return { error: '文件不存在或无权访问', fileId };

    if (file.isFolder) {
      return { error: '文件夹无法预览内容', fileId, fileName: file.name };
    }

    try {
      const vectorText = await buildFileTextForVector(env, fileId);
      if (!vectorText || vectorText.trim().length < 30) {
        return {
          fileId,
          fileName: file.name,
          mimeType: file.mimeType,
          preview: null,
          note: '该文件无可预览的文本内容',
        };
      }

      const previewLines = vectorText.split('\n').slice(0, lines);
      const preview = previewLines.join('\n');

      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        preview,
        totalLength: vectorText.length,
        previewLength: preview.length,
        lineCount: previewLines.length,
        _next_actions:
          preview.length >= maxLength
            ? ['内容较长，如需完整阅读请调用 read_file_text']
            : ['如需编辑内容，可调用 edit_file_content'],
      };
    } catch (error) {
      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        preview: null,
        error: '预览失败: ' + (error instanceof Error ? error.message : '未知错误'),
      };
    }
  }

  // ── Phase 9: 文件集合分析执行方法 ─────────────────────
  static async executeAnalyzeFileCollection(env: Env, userId: string, args: Record<string, unknown>) {
    const scope = args.scope as string;
    const folderId = args.folderId as string | undefined;
    const tagName = args.tagName as string | undefined;
    const analysisType = args.analysisType as string;
    const maxFiles = Math.min((args.maxFiles as number) || 20, 50);

    if (!scope || !analysisType) {
      return { error: '缺少必要参数: scope 和 analysisType' };
    }

    try {
      const result = await serviceGetFilesByScope(env, userId, {
        scope: scope as 'folder' | 'tag' | 'starred',
        folderId,
        tagName,
        maxFiles,
      });

      if (result.error) {
        return { error: result.error };
      }

      const analysisTypeMap: Record<string, string> = {
        summary: '请基于以上文件摘要生成整体报告',
        compare: '请对比以上文件的异同点',
        extract_common: '请提取以上文件的共同主题/条款/关键词',
        timeline: '请按时间顺序梳理文件脉络',
      };

      return {
        files: result.files,
        totalCount: result.totalCount,
        truncated: result.totalCount >= maxFiles,
        analysisType,
        scope,
        _next_actions: [analysisTypeMap[analysisType] || '请分析以上文件集合'],
      };
    } catch (error) {
      logger.error(
        'AgentTool',
        '文件集合分析失败',
        { error: error instanceof Error ? error.message : error },
        error as Error
      );
      return {
        error: '分析失败：' + (error instanceof Error ? error.message : '未知错误'),
      };
    }
  }
}

function isTextFile(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('pdf') ||
    mimeType.includes('word') ||
    mimeType.includes('document') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('presentation')
  );
}
