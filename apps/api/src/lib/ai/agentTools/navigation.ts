/**
 * navigation.ts — 文件夹导航与浏览工具
 *
 * 功能:
 * - 路径导航（支持模糊匹配）
 * - 文件夹内容浏览
 * - 最近访问
 * - 收藏文件
 *
 * 智能特性：
 * - 自动识别用户意图（"打开XX文件夹"、"进入XX"）
 * - 支持中文路径名智能匹配
 * - 记住上下文，减少重复查询
 */

import { eq, and, isNull, desc, asc, like, sql, count } from 'drizzle-orm';
import { getDb, files } from '../../../db';
import type { Env } from '../../../types/env';
import type { ToolDefinition, AgentFile } from './types';
import { formatBytes, getMimeTypeCategory } from '../utils';

export const definitions: ToolDefinition[] = [
  // 1. navigate_path — 智能路径导航
  {
    type: 'function',
    function: {
      name: 'navigate_path',
      description: `【智能导航】理解用户的路径意图并导航到目标位置。
适用场景（自动触发）：
• "打开/工作/项目文档" → 导航到该路径
• "进入我的照片文件夹" → 智能搜索匹配
• "回到上一级" → 使用 ".." 或 parentId
• "根目录" → 传空字符串或 "/"

💡 智能特性：
• 支持中英文混合路径名
• 自动处理"我的XX"、"XX文件夹"等口语化表达
• 路径不存在时返回相似路径建议`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标路径（如"/工作/项目文档"、空串表示根目录、".."表示上级）' },
          folderId: { type: 'string', description: '目标文件夹ID（优先使用此参数）' },
        },
      },
      examples: [
        { user_query: '打开工作文件夹', tool_call: { path: '/工作' } },
        { user_query: '进入项目文档目录', tool_call: { folderId: '<project_folder_id>' } },
        { user_query: '回到上一级', tool_call: { path: '..' } },
      ],
    },
  },

  // 2. list_folder — 浏览文件夹内容
  {
    type: 'function',
    function: {
      name: 'list_folder',
      description: `【浏览文件夹】查看指定文件夹内的所有内容。
适用场景：
• "这个文件夹里有什么"
• "列出XX目录下的文件"
• "看看最近修改的文件"

⚠️ 必须先通过 navigate_path 获取到 folderId 后再调用`,
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: '要浏览的文件夹ID' },
          sortBy: { type: 'string', enum: ['name', 'size', 'updated_at', 'created_at'], description: '排序方式' },
          sortOrder: { type: 'string', enum: ['asc', 'desc'], description: '排序方向（默认降序）' },
          mimeTypePrefix: { type: 'string', description: '按类型过滤（如 "image/" 只看图片）' },
          limit: { type: 'number', description: '最多返回数量（默认50）' },
        },
        required: ['folderId'],
      },
      examples: [
        { user_query: '这个文件夹里有什么', tool_call: { folderId: '<folder_id>' } },
        {
          user_query: '按时间倒序排列文件',
          tool_call: { folderId: '<folder_id>', sortBy: 'updated_at', sortOrder: 'desc' },
        },
        { user_query: '只看图片文件', tool_call: { folderId: '<folder_id>', mimeTypePrefix: 'image/' } },
      ],
    },
  },

  // 3. get_recent_files — 最近访问
  {
    type: 'function',
    function: {
      name: 'get_recent_files',
      description: `【最近文件】获取用户最近操作过的文件列表。
适用场景：
• "我最近编辑了什么"
• "刚才那个文件叫什么"
• "最近上传的照片"

适合作为对话开始时的快速回顾`,
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '数量限制（默认20）' },
          days: { type: 'number', description: '时间范围（天），默认7天' },
        },
      },
      examples: [
        { user_query: '我最近编辑了什么', tool_call: {} },
        { user_query: '最近3天的文件', tool_call: { days: 3, limit: 30 } },
        { user_query: '刚才操作的文件', tool_call: { days: 1, limit: 5 } },
      ],
    },
  },

  // 4. get_starred_files — 收藏文件
  {
    type: 'function',
    function: {
      name: 'get_starred_files',
      description: `【收藏夹】获取用户标记为收藏的重要文件。
适用场景：
• "我的收藏有哪些"
• "重要的文件在哪里"
• "找到我之前收藏的那个文档"

适合查找常用或重要资源`,
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '数量限制（默认50）' },
          includeFolders: { type: 'boolean', description: '是否包含收藏的文件夹（默认true）' },
        },
      },
      examples: [
        { user_query: '我的收藏有哪些', tool_call: {} },
        { user_query: '重要的文件在哪里', tool_call: { limit: 20, includeFolders: false } },
      ],
    },
  },

  // 5. get_parent_chain — 父级链路
  {
    type: 'function',
    function: {
      name: 'get_parent_chain',
      description: `【面包屑导航】获取从根目录到当前文件的完整路径链。
适用场景：
• "这个文件在哪个目录下"
• "显示完整路径"
• "帮我定位到这个文件"

帮助用户理解文件的层级位置`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '这个文件在哪个目录下', tool_call: { fileId: '<file_id>' } },
        { user_query: '显示完整路径', tool_call: { fileId: '<doc_id>' } },
      ],
    },
  },

  // 6. get_folder_tree — 文件夹树
  {
    type: 'function',
    function: {
      name: 'get_folder_tree',
      description: `【目录树】获取文件夹的层级树结构。
适用场景：
• "显示目录结构"
• "查看文件夹下有什么"
• "展开子目录"`,
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: '根文件夹ID（不传则从根目录开始）' },
          depth: { type: 'number', description: '展开深度（默认2，最大5）' },
        },
      },
      examples: [
        { user_query: '显示目录结构', tool_call: {} },
        { user_query: '展开工作目录3层', tool_call: { folderId: '<work_id>', depth: 3 } },
      ],
    },
  },

  // 7. get_storage_overview — 存储概览
  {
    type: 'function',
    function: {
      name: 'get_storage_overview',
      description: `【存储概览】查看整体存储使用情况。
适用场景：
• "我用了多少空间"
• "存储使用情况"
• "空间分布统计"`,
      parameters: {
        type: 'object',
        properties: {
          topN: { type: 'number', description: '显示前N个大文件夹（默认10）' },
          includeFileTypes: { type: 'boolean', description: '是否包含文件类型分布（默认true）' },
        },
      },
      examples: [
        { user_query: '我用了多少空间', tool_call: {} },
        { user_query: '存储使用情况详情', tool_call: { topN: 20, includeFileTypes: true } },
      ],
    },
  },
];

export class NavigationTools {
  static async executeListFolder(env: Env, userId: string, args: Record<string, unknown>) {
    const db = getDb(env.DB);
    let parentId: string | null = null;

    if (args.folderId) {
      const folder = await db
        .select()
        .from(files)
        .where(and(eq(files.id, args.folderId as string), eq(files.userId, userId), isNull(files.deletedAt)))
        .get();
      if (!folder) return { error: `文件夹不存在: ${args.folderId}` };
      if (!folder.isFolder) return { error: `${args.folderId} 不是文件夹` };
      parentId = folder.id;
    } else if (args.folderPath) {
      const folder = await db
        .select()
        .from(files)
        .where(and(eq(files.userId, userId), eq(files.path, args.folderPath as string), isNull(files.deletedAt)))
        .get();
      if (folder) parentId = folder.id;
    }

    const sortBy = (args.sortBy as string) || 'name_asc';
    const limit = Math.min((args.limit as number) || 50, 200);
    const orderMap: Record<string, any> = {
      name_asc: asc(files.name),
      name_desc: desc(files.name),
      newest: desc(files.createdAt),
      oldest: asc(files.createdAt),
      largest: desc(files.size),
      smallest: asc(files.size),
    };

    const rows = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          isNull(files.deletedAt),
          parentId ? eq(files.parentId, parentId) : isNull(files.parentId)
        )
      )
      .orderBy(orderMap[sortBy] ?? asc(files.name))
      .limit(limit)
      .all();

    const children = rows.map(toAgentFile);
    const folderCount = children.filter((f) => f.isFolder).length;
    const fileCount = children.length - folderCount;

    return {
      folderId: parentId,
      children,
      total: children.length,
      folderCount,
      fileCount,
      _next_actions: folderCount > 0 ? ['如需进入某个子文件夹，请使用其 id 作为 folderId 调用本工具'] : [],
    };
  }

  static async executeGetFolderTree(env: Env, userId: string, args: Record<string, unknown>) {
    const rootFolderId = args.rootFolderId as string | undefined;
    const maxDepth = Math.min((args.maxDepth as number) || 3, 5);
    const includeFiles = args.includeFiles !== false;

    async function buildTree(parentId: string | null, depth: number): Promise<any[]> {
      if (depth <= 0) return [];

      const db = getDb(env.DB);
      const items = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.userId, userId),
            isNull(files.deletedAt),
            parentId ? eq(files.parentId, parentId) : isNull(files.parentId)
          )
        )
        .orderBy(asc(files.name))
        .limit(100)
        .all();

      return Promise.all(
        items.map(async (item) => {
          const node: any = {
            id: item.id,
            name: item.name,
            isFolder: item.isFolder,
            size: formatBytes(item.size),
          };

          if (item.isFolder && depth > 1) {
            node.children = await buildTree(item.id, depth - 1);
          }
          if (!item.isFolder && includeFiles) {
            node.mimeType = item.mimeType;
          }

          return node;
        })
      );
    }

    const tree = await buildTree(rootFolderId || null, maxDepth);

    function countNodes(nodes: any[]): { folders: number; files: number } {
      let folders = 0,
        files = 0;
      for (const n of nodes) {
        if (n.isFolder) {
          folders++;
          if (n.children) {
            const sub = countNodes(n.children);
            folders += sub.folders;
            files += sub.files;
          }
        } else {
          files++;
        }
      }
      return { folders, files };
    }

    const counts = countNodes(tree);

    return {
      tree,
      maxDepth,
      ...counts,
      _next_actions: ['如需查看某个文件夹内容，使用 list_folder 并传入对应 id'],
    };
  }

  static async executeNavigatePath(env: Env, userId: string, args: Record<string, unknown>) {
    const path = args.path as string;
    const currentFolderId = args.currentFolderId as string | undefined;
    const action = (args.action as string) || 'list';
    const db = getDb(env.DB);

    let targetId: string | null = null;

    if (path === '..' || path === '../' || path === 'parent') {
      if (!currentFolderId) {
        return { error: '需要提供 currentFolderId 才能返回父级' };
      }
      const current = await db
        .select()
        .from(files)
        .where(and(eq(files.id, currentFolderId), eq(files.userId, userId)))
        .get();
      targetId = current?.parentId || null;
    } else if (path.startsWith('/') || path.startsWith('\\')) {
      const folder = await db
        .select()
        .from(files)
        .where(and(eq(files.userId, userId), eq(files.path, path), isNull(files.deletedAt)))
        .get();
      targetId = folder?.id || null;
    } else {
      const current = currentFolderId
        ? await db
            .select()
            .from(files)
            .where(and(eq(files.id, currentFolderId), eq(files.userId, userId)))
            .get()
        : null;

      const searchPath = current?.path ? `${current.path}/${path}` : `/${path}`;

      const folder = await db
        .select()
        .from(files)
        .where(and(eq(files.userId, userId), like(files.path, `%${searchPath}%`), isNull(files.deletedAt)))
        .get();
      targetId = folder?.id || null;
    }

    switch (action) {
      case 'info':
        if (targetId) {
          const info = await db.select().from(files).where(eq(files.id, targetId)).get();
          return { path, targetId, info: toAgentFile(info!) };
        }
        return { path, targetId: null, message: '路径不存在' };

      case 'parent':
        if (targetId) {
          const parent = await db.select().from(files).where(eq(files.id, targetId)).get();
          return { path, parentId: targetId, parentName: parent?.name };
        }
        return { path, parentId: null, message: '已在根目录' };

      case 'list':
      default:
        if (targetId) {
          return await NavigationTools.executeListFolder(env, userId, { folderId: targetId });
        }
        return await NavigationTools.executeListFolder(env, userId, {});
    }
  }

  static async executeGetStorageOverview(env: Env, userId: string, args: Record<string, unknown>) {
    const topN = Math.min((args.topN as number) || 10, 20);
    const includeFileTypes = args.includeFileTypes !== false;
    const db = getDb(env.DB);

    const [totalStats, folderSizes, fileTypeDist] = await Promise.all([
      db
        .select({
          totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)`,
          totalCount: count(),
        })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
        .get(),

      db
        .select({
          folderId: files.parentId,
          folderName: files.name,
          totalSize: sql<number>`SUM(${files.size})`,
          fileCount: count(),
        })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
        .groupBy(files.parentId)
        .orderBy(desc(sql`SUM(${files.size})`))
        .limit(topN)
        .all(),

      includeFileTypes
        ? db
            .select({
              mimeType: files.mimeType,
              count: count(),
              totalSize: sql<number>`SUM(${files.size})`,
            })
            .from(files)
            .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
            .groupBy(files.mimeType)
            .orderBy(desc(count()))
            .limit(15)
            .all()
        : [],
    ]);

    return {
      total: {
        size: formatBytes(totalStats?.totalSize || 0),
        sizeBytes: totalStats?.totalSize || 0,
        count: totalStats?.totalCount || 0,
      },
      topFolders: (folderSizes || []).map((f) => ({
        folderId: f.folderId,
        folderName: f.folderName || '(根目录)',
        size: formatBytes(f.totalSize || 0),
        sizeBytes: f.totalSize || 0,
        fileCount: Number(f.fileCount) || 0,
      })),
      ...(includeFileTypes
        ? {
            fileTypes: (fileTypeDist || []).map((t) => ({
              mimeType: t.mimeType || 'unknown',
              category: getMimeTypeCategory(t.mimeType),
              count: Number(t.count) || 0,
              size: formatBytes(t.totalSize || 0),
            })),
          }
        : {}),
      _next_actions: ['如需查看某文件夹详细内容，调用 list_folder 并传入 folderId'],
    };
  }

  static async executeGetRecentFiles(env: Env, userId: string, args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) || 20, 100);
    const days = (args.days as number) || 7;
    const db = getDb(env.DB);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const rows = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          isNull(files.deletedAt),
          eq(files.isFolder, false),
          sql`${files.updatedAt} >= ${since}`
        )
      )
      .orderBy(desc(files.updatedAt))
      .limit(limit)
      .all();

    return {
      total: rows.length,
      days,
      files: rows.map(toAgentFile),
    };
  }

  static async executeGetStarredFiles(env: Env, userId: string, args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) || 50, 100);
    const includeFolders = args.includeFolders !== false;
    const db = getDb(env.DB);

    const conditions = [eq(files.userId, userId), isNull(files.deletedAt), eq(files.isStarred, true)];
    if (!includeFolders) {
      conditions.push(eq(files.isFolder, false));
    }

    const rows = await db
      .select()
      .from(files)
      .where(and(...conditions))
      .orderBy(desc(files.updatedAt))
      .limit(limit)
      .all();

    return {
      total: rows.length,
      files: rows.map(toAgentFile),
    };
  }

  static async executeGetParentChain(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) return { error: `文件不存在: ${fileId}` };

    const chain: AgentFile[] = [];
    let currentId: string | null = file.parentId;

    while (currentId) {
      const parent = await db.select().from(files).where(eq(files.id, currentId)).get();
      if (!parent) break;
      chain.unshift(toAgentFile(parent));
      currentId = parent.parentId;
    }

    return {
      fileId,
      fileName: file.name,
      path: file.path,
      chain,
      depth: chain.length,
    };
  }
}

function toAgentFile(f: any): AgentFile {
  return {
    id: f.id,
    name: f.name,
    path: f.path,
    isFolder: f.isFolder,
    mimeType: f.mimeType,
    size: f.size,
    sizeFormatted: formatBytes(f.size),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    parentId: f.parentId,
    aiSummary: f.aiSummary,
    aiTags: f.aiTags,
    description: f.description,
    isStarred: f.isStarred ?? false,
    currentVersion: f.currentVersion ?? null,
    vectorIndexedAt: f.vectorIndexedAt,
  };
}
