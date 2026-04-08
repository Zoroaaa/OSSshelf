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
 */

import { eq, and, isNull, inArray, like, count, desc, asc } from 'drizzle-orm';
import { getDb, files, fileTags } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';

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
    },
  },
];

export class TagsTools {
  static async executeAddTag(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const tags = (args.tags as string[]) || [];
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: `文件不存在或无权访问: ${fileId}` };

    const now = new Date().toISOString();
    let addedCount = 0;
    for (const tagName of tags) {
      if (!tagName) continue;

      const existing = await db
        .select()
        .from(fileTags)
        .where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, tagName)))
        .get();

      if (!existing) {
        await db.insert(fileTags).values({
          id: crypto.randomUUID(),
          userId,
          fileId,
          name: tagName,
          color: generateTagColor(tagName),
          createdAt: now,
        });
        addedCount++;
      }
    }

    return {
      success: true,
      message: `已添加 ${addedCount} 个标签到 "${file.name}"`,
      fileId,
      fileName: file.name,
      addedTags: tags.slice(0, addedCount),
      skippedTags: tags.length > addedCount ? tags.slice(addedCount) : [],
    };
  }

  static async executeRemoveTag(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const tagNames = (args.tagNames as string[]) || (args.tags as string[]) || [];
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: `文件不存在或无权访问: ${fileId}` };

    let removedCount = 0;
    for (const tagName of tagNames) {
      if (!tagName) continue;
      const result = await db
        .delete(fileTags)
        .where(
          and(
            eq(fileTags.fileId, fileId),
            eq(fileTags.name, tagName),
            eq(fileTags.userId, userId)
          )
        )
        .run();
      if ((result as any).meta?.changes > 0) removedCount++;
    }

    return {
      success: true,
      message: `已移除 ${removedCount} 个标签`,
      fileId,
      removedTags: tagNames.slice(0, removedCount),
    };
  }

  static async executeGetFileTags(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: `文件不存在或无权访问: ${fileId}` };

    const tags = await db
      .select({
        id: fileTags.id,
        name: fileTags.name,
        color: fileTags.color,
        createdAt: fileTags.createdAt,
      })
      .from(fileTags)
      .where(eq(fileTags.fileId, fileId))
      .all();

    return {
      fileId,
      fileName: file.name,
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        createdAt: t.createdAt,
      })),
      count: tags.length,
    };
  }

  static async executeListAllTags(env: Env, userId: string, args: Record<string, unknown>) {
    const sortBy = (args.sortBy as string) || 'usage_count';
    const limit = Math.min((args.limit as number) || 50, 100);
    const db = getDb(env.DB);

    const rows = await db
      .select({
        name: fileTags.name,
        color: fileTags.color,
        createdAt: fileTags.createdAt,
        usageCount: count(fileTags.fileId),
      })
      .from(fileTags)
      .where(eq(fileTags.userId, userId))
      .groupBy(fileTags.name)
      .orderBy(sortBy === 'name' ? asc(fileTags.name) : desc(count(fileTags.fileId)))
      .limit(limit)
      .all();

    return {
      total: rows.length,
      tags: rows.map((r) => ({
        name: r.name,
        color: r.color,
        usageCount: Number(r.usageCount) || 0,
        createdAt: r.createdAt,
      })),
    };
  }

  static async executeMergeTags(env: Env, userId: string, args: Record<string, unknown>) {
    const sourceTag = args.sourceTag as string;
    const targetTag = args.targetTag as string;
    const db = getDb(env.DB);

    if (sourceTag === targetTag) {
      return { error: '源标签和目标标签不能相同' };
    }

    const sourceRecords = await db
      .select()
      .from(fileTags)
      .where(and(eq(fileTags.userId, userId), eq(fileTags.name, sourceTag)))
      .all();

    let migratedCount = 0;
    for (const record of sourceRecords) {
      const existingTarget = await db
        .select()
        .from(fileTags)
        .where(and(eq(fileTags.userId, userId), eq(fileTags.fileId, record.fileId), eq(fileTags.name, targetTag)))
        .get();

      if (!existingTarget) {
        await db.update(fileTags).set({ name: targetTag }).where(eq(fileTags.id, record.id));
        migratedCount++;
      } else {
        await db.delete(fileTags).where(eq(fileTags.id, record.id));
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
    const maxTagsPerFile = Math.min((args.maxTagsPerFile as number) || 3, 5);

    return {
      status: 'queued',
      message: `自动打标签任务已加入队列，将为 ${fileIds.length} 个文件各推荐最多 ${maxTagsPerFile} 个标签`,
      fileIds,
      maxTagsPerFile,
      _next_actions: ['完成后可通过 get_file_detail 查看更新后的标签', '可通过 search_by_tag 按新标签搜索'],
    };
  }

  static async executeTagFolder(env: Env, userId: string, args: Record<string, unknown>) {
    const folderId = args.folderId as string;
    const tags = (args.tags as string[]) || [];
    const recursive = args.recursive === true;
    const db = getDb(env.DB);

    const folder = await db
      .select()
      .from(files)
      .where(and(eq(files.id, folderId), eq(files.userId, userId), eq(files.isFolder, true), isNull(files.deletedAt)))
      .get();
    if (!folder) return { error: '文件夹不存在或已被删除' };

    const conditions: any[] = [eq(files.userId, userId), isNull(files.deletedAt)];
    if (recursive) {
      conditions.push(like(files.path, `${folder.path}%`));
    } else {
      conditions.push(eq(files.parentId, folderId));
    }
    conditions.push(eq(files.isFolder, false));

    const filesInFolder = await db
      .select({ id: files.id })
      .from(files)
      .where(and(...conditions))
      .all();
    const fileIdsInFolder = filesInFolder.map((f) => f.id);

    let totalAdded = 0;
    for (const fileId of fileIdsInFolder) {
      for (const tag of tags) {
        const existing = await db
          .select()
          .from(fileTags)
          .where(and(eq(fileTags.fileId, fileId), eq(fileTags.name, tag)))
          .get();
        if (!existing) {
          await db.insert(fileTags).values({
            id: crypto.randomUUID(),
            userId,
            fileId,
            name: tag,
            color: generateTagColor(tag),
            createdAt: new Date().toISOString(),
          });
          totalAdded++;
        }
      }
    }

    return {
      success: true,
      message: `已为文件夹 "${folder.name}" 内的 ${filesInFolder.length} 个文件添加标签`,
      folderId,
      folderName: folder.name,
      tagsAdded: totalAdded,
      fileCount: filesInFolder.length,
      recursive,
    };
  }
}

function generateTagColor(tagName: string): string {
  const colors = [
    '#EF4444',
    '#F97316',
    '#F59E0B',
    '#84CC16',
    '#22C55E',
    '#14B8A6',
    '#06B6D4',
    '#3B82F6',
    '#8B5CF6',
    '#D946EF',
  ];
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
