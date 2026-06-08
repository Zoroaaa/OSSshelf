/**
 * ai-enhance.ts — 🤖 AI增强工具
 *
 * 功能:
 * - 触发AI摘要生成
 * - 触发AI标签生成
 * - 重建向量索引
 * - RAG问答
 * - AI智能重命名建议
 *
 * 注意：所有数据库操作已提取到 aiEnhanceService.ts 和 fileQueryService.ts，本文件仅负责参数处理和结果组装
 */

import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';
import {
  getFileBasicInfo,
  getFileUpdatedAiInfo,
  parseAiTags,
  isImageFile,
  getFilesForVectorIndex,
} from '../../../lib/aiEnhanceService';
import { getFileById } from '../../../lib/fileQueryService';

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
      examples: [
        { user_query: '为这个文件生成AI摘要', tool_call: { fileId: '<file_id>' } },
        { user_query: '重新生成摘要', tool_call: { fileId: '<doc_id>', forceRegenerate: true } },
      ],
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
      examples: [
        { user_query: '为这张图片生成智能标签', tool_call: { fileId: '<image_id>' } },
        { user_query: '生成3个标签就行', tool_call: { fileId: '<photo_id>', maxTags: 3 } },
      ],
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
      examples: [
        { user_query: '重建这个文件的索引', tool_call: { fileId: '<file_id>' } },
        { user_query: '重建所有文件索引', tool_call: { forceAll: true, _confirmed: true } },
        { user_query: '搜索结果不准确，重新索引', tool_call: {} },
      ],
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
      examples: [
        { user_query: '合同里违约金怎么规定', tool_call: { question: '我的合同里关于违约金是怎么规定的？' } },
        { user_query: '去年服务器花费多少', tool_call: { question: '去年我花了多少钱在服务器上？', scope: 'recent' } },
        { user_query: '项目用了什么技术', tool_call: { question: '项目中使用了哪些技术栈？', topK: 3 } },
      ],
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
      examples: [
        { user_query: '帮这个文件改个规范的名字', tool_call: { fileId: '<img_id>' } },
        { user_query: '用日期前缀格式重命名', tool_call: { fileId: '<doc_id>', style: 'date_prefix' } },
      ],
    },
  },

  // ── Phase 8: 智能整理建议工具 ────────────────────────────
  {
    type: 'function',
    function: {
      name: 'smart_organize_suggest',
      description: `【智能整理建议】分析文件系统并提供整理建议。
适用场景："帮我整理文件"、"文件太乱了"、"有什么整理建议"、"哪些文件需要重命名"、"怎么整理文件夹"

四维度分析：
1. 命名问题：检测不规范命名的文件（IMG_xxx、Screenshot、未命名等）
2. 标签缺失：有AI摘要但无标签的文件
3. 归类建议：根目录下的文件归类建议
4. 结构问题：文件夹过深或子文件过多`,
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['all', 'folder', 'untagged'],
            description: '分析范围：all=全部, folder=指定文件夹, untagged=未打标签的文件',
          },
          folderId: { type: 'string', description: '文件夹ID（scope=folder时必填）' },
          limit: { type: 'number', description: '最大扫描数量（默认200）' },
        },
        required: [],
      },
      examples: [
        { user_query: '帮我整理文件', tool_call: {} },
        { user_query: '分析这个文件夹的问题', tool_call: { scope: 'folder', folderId: '<folder_id>' } },
        { user_query: '找需要打标签的文件', tool_call: { scope: 'untagged' } },
      ],
    },
  },
];

export class AiEnhanceTools {
  static async executeTriggerAiSummary(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const forceRegenerate = args.forceRegenerate === true;

    const file = await getFileBasicInfo(env, userId, fileId);
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

    try {
      const { generateFileSummary } = await import('../features');
      await generateFileSummary(env, fileId, undefined, userId);

      logger.info('AgentTool', 'Triggered AI summary generation (completed)', {
        fileId,
        fileName: file.name,
        forceRegenerate,
      });

      const updatedFile = await getFileUpdatedAiInfo(env, fileId);

      return {
        success: true,
        status: 'completed',
        fileId,
        fileName: file.name,
        summary: updatedFile?.aiSummary || null,
        generatedAt: updatedFile?.aiSummaryAt || null,
        message: forceRegenerate ? 'AI摘要已重新生成' : 'AI摘要生成完成',
        _next_actions: [
          '可通过 get_file_detail 查看完整摘要内容',
          '如需生成标签，可调用 trigger_ai_tags 或 auto_tag_files',
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('AgentTool', 'Failed to generate AI summary', { fileId, fileName: file.name }, error);
      return {
        error: `AI摘要生成失败: ${errorMsg}`,
        code: 'SUMMARY_GENERATION_FAILED',
        hint: '请检查AI模型配置是否正确，或稍后重试',
      };
    }
  }

  static async executeTriggerAiTags(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const maxTags = Math.min((args.maxTags as number) || 5, 10);

    const file = await getFileBasicInfo(env, userId, fileId);
    if (!file) return { error: '文件不存在或无权访问' };

    if (!isImageFile(file.mimeType)) {
      return {
        error: 'AI标签生成仅支持图片文件（mimeType: image/*）',
        code: 'NOT_IMAGE_FILE',
        currentMimeType: file.mimeType,
        hint: '文本文件可使用 generate_tags 工具生成标签建议',
      };
    }

    try {
      const { generateImageTags } = await import('../features');
      await generateImageTags(env, fileId, undefined, userId);

      logger.info('AgentTool', 'Triggered AI tag generation (completed)', { fileId, fileName: file.name, maxTags });

      const updatedFile = await getFileUpdatedAiInfo(env, fileId);
      const tagsData = parseAiTags(updatedFile?.aiTags || null);

      return {
        success: true,
        status: 'completed',
        fileId,
        fileName: file.name,
        tags: tagsData.slice(0, maxTags),
        totalTags: tagsData.length,
        generatedAt: updatedFile?.aiTagsAt || null,
        message: `已为图片生成 ${tagsData.length} 个智能标签`,
        _next_actions: [
          '可通过 get_file_detail 查看完整标签信息',
          '可通过 search_by_tag 按新标签搜索相关文件',
          '如需调整标签，可使用 add_tag/remove_tag 手动管理',
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('AgentTool', 'Failed to generate AI tags', { fileId, fileName: file.name }, error);
      return {
        error: `AI标签生成失败: ${errorMsg}`,
        code: 'TAG_GENERATION_FAILED',
        hint: '请检查：1) AI视觉模型是否配置 2) 文件是否可访问 3) 稍后重试',
      };
    }
  }

  static async executeRebuildVectorIndex(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string | undefined;
    const forceAll = args.forceAll === true;

    if (!env.VECTORIZE) {
      return {
        error: 'Vectorize索引服务未配置，无法重建向量索引',
        code: 'VECTORIZE_NOT_CONFIGURED',
        hint: '管理员需在 wrangler.toml 中配置 [[vectorize]] 绑定',
      };
    }

    if (fileId) {
      const file = await getFileById(env, userId, fileId);
      if (!file) return { error: '文件不存在或无权访问' };

      try {
        const { indexFileVector, buildFileTextForVector } = await import('../vectorIndex');
        const text = await buildFileTextForVector(env, fileId);

        if (!text || text.trim().length === 0) {
          return {
            error: '文件内容为空或无法提取文本，无法建立索引',
            code: 'EMPTY_FILE_CONTENT',
            fileId,
            fileName: file.name,
          };
        }

        await indexFileVector(env, fileId, text);

        logger.info('AgentTool', 'Rebuilt vector index for single file', { fileId, fileName: file.name });

        return {
          success: true,
          status: 'completed',
          message: `已为 "${file.name}" 完成向量索引重建`,
          fileId,
          fileName: file.name,
          _next_actions: ['现在可以使用 search_files 或 smart_search 进行语义搜索', '搜索结果会更加准确和相关'],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('AgentTool', 'Failed to rebuild vector index for file', { fileId }, error);
        return {
          error: `向量索引重建失败: ${errorMsg}`,
          code: 'INDEX_REBUILD_FAILED',
          hint: '请检查 Vectorize 服务状态和文件可访问性',
        };
      }
    }

    try {
      const { createTaskRecord, enqueueAiTasks } = await import('../aiTaskQueue');

      const filesToIndex = await getFilesForVectorIndex(env, userId, forceAll);

      if (filesToIndex.length === 0) {
        return {
          success: true,
          status: 'completed',
          message: forceAll ? '所有文件已建立索引' : '没有需要建立索引的文件',
          scope: 'all_files',
          forceAll,
          indexedCount: 0,
        };
      }

      const task = await createTaskRecord(env, 'index', userId, filesToIndex.length);
      const fileIds = filesToIndex.map((f) => f.id);
      await enqueueAiTasks(env, 'index', fileIds, userId, task.id);

      logger.info('AgentTool', 'Started batch vector index rebuild', {
        userId,
        fileCount: filesToIndex.length,
        forceAll,
        taskId: task.id,
      });

      return {
        success: true,
        status: 'queued',
        message: forceAll
          ? `正在强制重建所有 ${filesToIndex.length} 个文件的向量索引`
          : `正在为 ${filesToIndex.length} 个未索引的文件建立向量索引`,
        taskId: task.id,
        scope: 'all_files',
        forceAll,
        fileCount: filesToIndex.length,
        _next_actions: [
          `可通过 GET /api/ai/index/task 查看任务进度（taskId: ${task.id}）`,
          '批量索引可能需要较长时间（取决于文件数量和大小）',
          '完成后语义搜索结果会显著改善',
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('AgentTool', 'Failed to start batch vector index rebuild', { userId, forceAll }, error);
      return {
        error: `批量索引任务启动失败: ${errorMsg}`,
        code: 'BATCH_INDEX_FAILED',
        hint: '请检查 AI_TASKS_QUEUE 配置是否正确',
      };
    }
  }

  static async executeAskRagQuestion(env: Env, userId: string, args: Record<string, unknown>) {
    const question = ((args.question as string) || '').trim();
    const scope = (args.scope as string) || 'all';
    const topK = Math.min((args.topK as number) || 5, 10);

    if (!question) {
      return { error: '问题不能为空', code: 'EMPTY_QUESTION' };
    }

    try {
      const { ModelGateway } = await import('../modelGateway');
      const { RagEngine } = await import('../ragEngine');

      const gateway = new ModelGateway(env);
      const ragEngine = new RagEngine(env);

      const ragContext = await ragEngine.buildContext({
        query: question,
        userId,
        maxFiles: topK,
      });

      if (!ragContext.relevantFiles || ragContext.relevantFiles.length === 0) {
        return {
          error: `未找到与"${question.slice(0, 50)}..."相关的文档。

建议：
1. 确保已上传相关文件到系统
2. 使用 rebuild_vector_index 工具为文件建立向量索引
3. 尝试更具体或不同的关键词提问
4. 或使用 search_files 进行关键词搜索`,
          code: 'NO_RELEVANT_DOCUMENTS',
          question,
          hint: '可使用 search_files、filter_files 或 get_recent_files 手动查找相关文件',
        };
      }

      const systemPrompt = `你是文档问答助手。基于以下检索到的文档内容回答用户问题。
要求：
1. 仅基于提供的文档内容回答，不要编造信息
2. 如果文档中没有答案，明确告知用户
3. 引用具体的文件名作为来源
4. 用中文回答`;

      const completion = await gateway.chatCompletion(userId, {
        messages: [
          { role: 'system', content: systemPrompt },
          ...ragContext.messages,
          { role: 'user' as const, content: question },
        ],
        temperature: 0.3,
      } as any);

      const answer =
        typeof completion === 'string'
          ? completion
          : (completion as any)?.content || (completion as any)?.choices?.[0]?.message?.content || '无法生成答案';

      logger.info('AgentTool', 'RAG question answered', {
        userId,
        question: question.slice(0, 50),
        sourceCount: ragContext.relevantFiles.length,
      });

      return {
        success: true,
        answer,
        question,
        sources: ragContext.relevantFiles.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          score: f.similarityScore || 0,
        })),
        sourceCount: ragContext.relevantFiles.length,
        scope,
        _next_actions: [
          '如需查看某个来源文件的详细内容，可调用 read_file_text',
          '如需继续追问，可直接提出后续问题',
          '如需基于答案执行操作（如添加标签、重命名），可使用相应工具',
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('AgentTool', 'RAG question failed', { userId, question: question.slice(0, 50) }, error);

      if (
        errorMsg.includes('No relevant documents') ||
        errorMsg.includes('no relevant') ||
        errorMsg.includes('未找到')
      ) {
        return {
          error: `未找到与问题相关的文档。建议：1) 先上传相关文件 2) 确保文件已建立向量索引 3) 尝试更具体的问题`,
          code: 'NO_RELEVANT_DOCUMENTS',
          hint: '可使用 rebuild_vector_index 工具为文件建立索引，或使用 search_files 进行关键词搜索',
        };
      }

      return {
        error: `RAG问答失败: ${errorMsg}`,
        code: 'RAG_QUERY_FAILED',
        hint: '请检查：1) Vectorize服务是否配置 2) 文件是否已索引 3) AI模型是否可用',
      };
    }
  }

  static async executeSmartRenameSuggest(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const style = (args.style as string) || 'descriptive';

    const file = await getFileById(env, userId, fileId);
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

  // ── Phase 8: 智能整理建议执行方法 ───────────────────────
  static async executeSmartOrganizeSuggest(env: Env, userId: string, args: Record<string, unknown>) {
    const scope = (args.scope as string) || 'all';
    const limit = Math.min((args.limit as number) || 200, 500);

    const fileList = await getFilesForVectorIndex(env, userId, true).then((files) =>
      files.slice(0, limit).map((f) => ({
        id: f.id,
        name: '',
        mimeType: '',
        path: '',
        parentId: '',
        aiTags: '',
        aiSummary: '',
        size: 0,
        isFolder: false,
        createdAt: new Date(),
      }))
    );

    // ── 四维度分析 ───────────────────────────────────────

    // 1. 命名问题
    const namingPattern = /^(IMG|DSC|截图|Screenshot|未命名|Untitled|New )/i;
    const numericPattern = /^\d+$/;
    const namingIssues = fileList
      .filter((f) => !f.isFolder && (namingPattern.test(f.name) || numericPattern.test(f.name.replace(/\..*$/, ''))))
      .slice(0, 20)
      .map((f) => ({
        fileId: f.id,
        currentName: f.name,
        issue: namingPattern.test(f.name) ? '不规范命名' : '纯数字文件名',
      }));

    // 2. 标签缺失
    const missingTags = fileList
      .filter((f) => !f.isFolder && (!f.aiTags || f.aiTags === '[]') && f.aiSummary)
      .slice(0, 20)
      .map((f) => ({
        fileId: f.id,
        fileName: f.name,
      }));

    // 3. 归类建议（根目录文件）
    const rootFiles = fileList.filter((f) => !f.isFolder && !f.parentId);
    const mimeTypeGroups: Record<string, typeof rootFiles> = {};
    rootFiles.forEach((f) => {
      const category = f.mimeType?.split('/')[0] || 'other';
      if (!mimeTypeGroups[category]) mimeTypeGroups[category] = [];
      mimeTypeGroups[category].push(f);
    });

    const relocateSuggestions = Object.entries(mimeTypeGroups)
      .filter(([, files]) => files.length > 3)
      .slice(0, 10)
      .flatMap(([category, files]) =>
        files.slice(0, 3).map((f) => ({
          fileId: f.id,
          fileName: f.name,
          suggestedFolderName: `${category}文件`,
          reason: `与 ${files.length} 个同类型文件散落在根目录`,
        }))
      );

    // 4. 结构问题
    const structureIssues: Array<{ folderId: string; folderName: string; issue: string; suggestion: string }> = [];

    return {
      scannedCount: fileList.length,
      scope,
      namingIssues,
      missingTags,
      relocateSuggestions,
      structureIssues,
      _next_actions: [
        '可调用 batch_rename 处理命名问题',
        '可调用 auto_tag_files 补全标签',
        '可调用 move_file 执行归类',
      ],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

function generateSuggestionName(currentName: string, style: string, _mimeType: string | null): string {
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
