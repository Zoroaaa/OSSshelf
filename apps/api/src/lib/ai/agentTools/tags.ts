/**
 * tags.ts — 智能标签管理工具
 *
 * 功能:
 * - 标签CRUD操作
 * - 批量打标签
 * - 标签搜索与推荐
 * - 标签统计
 *
 * 智能特性：
 * - 自动识别相关标签
 * - 支持标签颜色/图标
 *
 * 注意：所有数据库操作已提取到 tagService.ts，本文件仅负责参数处理和结果组装
 */

import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';
import {
  addTagToFile,
  removeTagFromFile,
  getFileTags,
  getAllUserTags,
  getTagStats,
  batchAddTagsToFiles,
  getImageFilesForAutoTagging,
} from '../../../lib/tagService';
import { getFileById } from '../../../lib/fileQueryService';

export const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'add_tag',
      description: `【打标签】为文件添加一个或多个标签。
适用场景：
• "给这个文件加上'重要'标签"
• "标记为'待处理'"
• "批量标记这些文档"

💡 如果标签不存在会自动创建`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签名数组，如 ["重要", "工作", "2024"]',
          },
        },
        required: ['fileId', 'tags'],
      },
      examples: [
        { user_query: '给这个文件加上重要标签', tool_call: { fileId: '<file_id>', tags: ['重要'] } },
        { user_query: '标记为工作和待处理', tool_call: { fileId: '<doc_id>', tags: ['工作', '待处理'] } },
        { user_query: '批量标记这些文档', tool_call: { fileId: '<report_id>', tags: ['项目A', '2024Q4'] } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'remove_tag',
      description: `【去标签】移除文件的指定标签。
适用场景：
• "去掉'重要'标签"
• "取消这个文件的标记"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
          tagNames: {
            type: 'array',
            items: { type: 'string' },
            description: '要移除的标签名数组',
          },
        },
        required: ['fileId', 'tagNames'],
      },
      examples: [
        { user_query: '去掉重要标签', tool_call: { fileId: '<file_id>', tagNames: ['重要'] } },
        { user_query: '取消工作标记', tool_call: { fileId: '<doc_id>', tagNames: ['工作'] } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_file_tags',
      description: `【看标签】查看文件的所有标签。
适用场景：
• "这个文件有什么标签"
• "显示标签列表"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '这个文件有什么标签', tool_call: { fileId: '<file_id>' } },
        { user_query: '显示标签列表', tool_call: { fileId: '<doc_id>' } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_all_tags_for_management',
      description: `【标签库】查看所有可用的标签及其使用情况。
适用场景：
• "我有哪些标签"
• "哪些标签用得最多"
• "管理我的标签体系"

帮助用户了解整体标签使用情况`,
      parameters: {
        type: 'object',
        properties: {
          includeUsageCount: { type: 'boolean', description: '是否显示使用次数（默认true）' },
          sortBy: { type: 'string', enum: ['name', 'usage_count', 'created_at'], description: '排序方式' },
          limit: { type: 'number', description: '返回数量（默认50）' },
        },
      },
      examples: [
        { user_query: '我有哪些标签', tool_call: {} },
        { user_query: '按使用量排序显示标签', tool_call: { sortBy: 'usage_count', sortOrder: 'desc' } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'merge_tags',
      description: `【合并标签】将一个标签合并到另一个标签。
适用场景：
• "把'重要'和'紧急'合并"
• "整理重复标签"`,
      parameters: {
        type: 'object',
        properties: {
          sourceTag: { type: 'string', description: '要合并的源标签名' },
          targetTag: { type: 'string', description: '目标标签名' },
        },
        required: ['sourceTag', 'targetTag'],
      },
      examples: [
        { user_query: '把重要和紧急合并', tool_call: { sourceTag: '紧急', targetTag: '重要' } },
        { user_query: '整理重复标签', tool_call: { sourceTag: '项目-A', targetTag: '项目A' } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'tag_folder',
      description: `【文件夹打标签】为文件夹内所有文件批量打标签。
适用场景：
• "给这个文件夹所有文件加上'项目A'标签"
• "批量标记整个目录"`,
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: '文件夹ID' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '要添加的标签名数组',
          },
          recursive: { type: 'boolean', description: '是否递归处理子文件夹（默认false）' },
        },
        required: ['folderId', 'tags'],
      },
      examples: [
        { user_query: '给这个文件夹加上项目A标签', tool_call: { folderId: '<folder_id>', tags: ['项目A'] } },
        {
          user_query: '批量标记整个目录为2024',
          tool_call: { folderId: '<docs_id>', tags: ['2024', '归档'], recursive: true },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'auto_tag_files',
      description: `【智能打标签】基于文件内容自动生成并添加标签。
适用场景：
• "自动给这些文件打标签"
• "智能分类文档"

AI会分析文件名、内容、类型等信息生成合适的标签`,
      parameters: {
        type: 'object',
        properties: {
          fileIds: {
            type: 'array',
            items: { type: 'string' },
            description: '要处理的文件ID列表',
          },
          maxTags: { type: 'number', description: '每个文件最多添加的标签数（默认5）' },
        },
        required: ['fileIds'],
      },
      examples: [
        { user_query: '自动给这些图片打标签', tool_call: { fileIds: ['<img1_id>', '<img2_id>'] } },
        { user_query: '智能分类这批文档', tool_call: { fileIds: ['<doc1_id>', '<doc2_id>', '<doc3_id>'], maxTags: 3 } },
      ],
    },
  },
];

export class TagsTools {
  static async executeAddTag(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const tags = (args.tags as string[]) || [];

    const file = await getFileById(env, userId, fileId);
    if (!file) return { error: `文件不存在或无权访问: ${fileId}` };

    let addedCount = 0;
    const skippedTags: string[] = [];

    for (const tagName of tags) {
      if (!tagName) continue;

      const result = await addTagToFile(env, userId, { fileId, name: tagName });
      if (result.success) {
        addedCount++;
      } else {
        skippedTags.push(tagName);
      }
    }

    return {
      success: true,
      message: `已添加 ${addedCount} 个标签到 "${file.name}"`,
      fileId,
      fileName: file.name,
      addedTags: tags.filter((t) => !skippedTags.includes(t)).slice(0, addedCount),
      skippedTags,
    };
  }

  static async executeRemoveTag(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const tagNames = (args.tagNames as string[]) || (args.tags as string[]) || [];

    const file = await getFileById(env, userId, fileId);
    if (!file) return { error: `文件不存在或无权访问: ${fileId}` };

    let removedCount = 0;
    const removedTags: string[] = [];

    for (const tagName of tagNames) {
      if (!tagName) continue;
      const result = await removeTagFromFile(env, userId, fileId, tagName);
      if (result.success && result.removed) {
        removedCount++;
        removedTags.push(tagName);
      }
    }

    return {
      success: true,
      message: `已移除 ${removedCount} 个标签`,
      fileId,
      removedTags,
    };
  }

  static async executeGetFileTags(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;

    const file = await getFileById(env, userId, fileId);
    if (!file) return { error: `文件不存在或无权访问: ${fileId}` };

    const tags = await getFileTags(env, userId, fileId);

    return {
      fileId,
      fileName: file.name,
      tags,
      count: tags.length,
    };
  }

  static async executeListAllTags(env: Env, userId: string, args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) || 50, 100);

    const allTags = await getAllUserTags(env, userId, { limit });

    const stats = await getTagStats(env, userId);
    const statsMap = new Map(stats.map((s) => [s.name, s.count]));

    return {
      total: allTags.length,
      tags: allTags.map((t) => ({
        name: t.name,
        color: t.color,
        usageCount: statsMap.get(t.name) || 0,
        createdAt: t.createdAt,
      })),
    };
  }

  static async executeMergeTags(env: Env, userId: string, args: Record<string, unknown>) {
    const sourceTag = args.sourceTag as string;
    const targetTag = args.targetTag as string;

    if (sourceTag === targetTag) {
      return { error: '源标签和目标标签不能相同' };
    }

    const sourceRecords = await getAllUserTags(env, userId, { search: sourceTag, limit: 1000 });

    let migratedCount = 0;
    for (const record of sourceRecords) {
      if (record.name !== sourceTag) continue;

      const result = await addTagToFile(env, userId, {
        fileId: record.id.split('-')[0],
        name: targetTag,
      });

      if (result.success) {
        migratedCount++;
      }
    }

    logger.info('AgentTool', 'Merged tags', { sourceTag, targetTag, migratedCount });

    return {
      success: true,
      message: `已将 "${sourceTag}" 合并到 "${targetTag}"，迁移了 ${migratedCount} 个文件关联`,
      sourceTag,
      targetTag,
      migratedCount,
    };
  }

  static async executeAutoTagFiles(env: Env, userId: string, args: Record<string, unknown>) {
    const fileIds = (args.fileIds as string[]) || [];
    const maxTags = Math.min((args.maxTags as number) || (args.maxTagsPerFile as number) || 5, 10);

    if (!env.AI_TASKS_QUEUE) {
      return {
        error: 'AI任务队列未配置，无法执行批量标签生成。请联系管理员配置 Cloudflare Queue。',
        hint: '管理员需在 wrangler.toml 中配置 [[queues.producers]] 和 [[queues.consumers]]',
        code: 'QUEUE_NOT_CONFIGURED',
      };
    }

    if (fileIds.length === 0) {
      return { error: '未指定要处理的文件ID列表', code: 'NO_FILE_IDS' };
    }

    const validFiles = await getImageFilesForAutoTagging(env, userId, fileIds);

    if (validFiles.length === 0) {
      return {
        error: '没有找到有效的图片文件。注意：自动标签功能仅支持图片文件（mimeType: image/*）',
        code: 'NO_VALID_IMAGE_FILES',
        providedFileIds: fileIds,
        hint: '请使用 filter_files(mimeTypePrefix="image/") 先筛选出图片文件，再传入fileIds',
      };
    }

    try {
      const { createTaskRecord, enqueueAiTasks } = await import('../aiTaskQueue');
      const task = await createTaskRecord(env, 'tags', userId, validFiles.length);
      const validFileIds = validFiles.map((f) => f.id);

      await enqueueAiTasks(env, 'tags', validFileIds, userId, task.id);

      logger.info('AgentTool', 'Auto-tag task started via Agent tool', {
        userId,
        fileCount: validFiles.length,
        taskId: task.id,
        maxTags,
      });

      return {
        success: true,
        status: 'queued',
        message: `已启动AI智能标签生成任务，正在为 ${validFiles.length} 张图片分析内容并生成标签（每张最多${maxTags}个）`,
        taskId: task.id,
        fileCount: validFiles.length,
        supportedFiles: validFileIds,
        unsupportedFiles: fileIds.filter((id) => !validFileIds.includes(id)),
        maxTags,
        _next_actions: [
          `可通过 GET /api/ai/tags/task 查看任务进度（taskId: ${task.id}）`,
          '任务完成后，文件的 aiTags 字段将包含AI生成的智能标签',
          '可通过 search_by_tag 或 filter_files 按新标签搜索文件',
          '建议等待任务完成后使用 get_file_detail 查看具体标签内容',
        ],
      };
    } catch (queueError) {
      const errorMsg = queueError instanceof Error ? queueError.message : String(queueError);
      logger.error('AgentTool', 'Failed to enqueue auto-tag task', { userId, fileCount: fileIds.length }, queueError);
      return {
        error: `任务入队失败: ${errorMsg}`,
        code: 'QUEUE_ERROR',
        hint: '请检查 Cloudflare Queue 配置是否正确，或联系管理员',
      };
    }
  }

  static async executeTagFolder(env: Env, userId: string, args: Record<string, unknown>) {
    const folderId = args.folderId as string;
    const tags = (args.tags as string[]) || [];
    const recursive = args.recursive === true;

    const folder = await getFileById(env, userId, folderId);
    if (!folder || !folder.isFolder) return { error: '文件夹不存在或已被删除' };

    const filesInFolder = await getImageFilesForAutoTagging(env, userId);
    const filteredFiles = recursive
      ? filesInFolder.filter((f) => f.id.startsWith(folderId))
      : filesInFolder.slice(0, 20);

    const fileIdsInFolder = filteredFiles.map((f) => f.id);

    let totalAdded = 0;
    for (const tagName of tags) {
      const result = await batchAddTagsToFiles(env, userId, fileIdsInFolder, tagName);
      totalAdded += result.successCount;
    }

    return {
      success: true,
      message: `已为文件夹 "${folder.name}" 内的 ${fileIdsInFolder.length} 个文件添加标签`,
      folderId,
      folderName: folder.name,
      tagsAdded: totalAdded,
      fileCount: fileIdsInFolder.length,
      recursive,
    };
  }
}
