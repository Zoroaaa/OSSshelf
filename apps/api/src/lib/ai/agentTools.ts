/**
 * agentTools.ts — OSSshelf Agent 工具集 (全面重构版)
 *
 * 设计原则：
 *  - 工具粒度：每个工具有明确的单一职责，不重叠
 *  - 工具覆盖：覆盖文件管理系统所有核心数据维度
 *  - 链式友好：每个工具返回 _next_actions 建议，引导 Agent 自主规划
 *  - 视觉感知：图片类文件支持直接视觉分析（base64 → vision model）
 *  - 双存储透明：S3/R2 与 Telegram 对工具调用者完全透明
 *  - 上下文感知：工具结果携带足够元数据，避免 Agent 多余的补充查询
 *
 * 工具清单（17 个）：
 *
 * ── 搜索与发现 ──────────────────────────────
 *  1.  search_files         语义 + FTS + 多字段混合搜索
 *  2.  filter_files         结构化多维过滤（类型/大小/日期/标签/文件夹）
 *  3.  search_by_tag        按标签搜索（支持多标签 AND/OR）
 *  4.  search_duplicates    查找重复文件（按 hash）
 *
 * ── 文件内容理解 ─────────────────────────────
 *  5.  read_file_text       读取文本类文件内容（分段）
 *  6.  analyze_image        视觉分析图片（调用 vision model，支持 S3 + TG）
 *  7.  get_file_detail      单文件完整元数据（标签/分享/权限/版本数）
 *  8.  get_file_versions    文件版本历史
 *  9.  get_file_notes       文件备注/笔记
 *
 * ── 目录导航 ──────────────────────────────────
 *  10. list_folder          列出文件夹内容
 *  11. get_folder_tree      目录树（可指定深度）
 *
 * ── 集合与统计 ────────────────────────────────
 *  12. list_recent          最近上传/修改（可按类型过滤）
 *  13. list_starred         收藏文件
 *  14. list_shares          分享链接
 *  15. get_storage_stats    存储统计（总量/类型分布/存储桶分布）
 *  16. get_activity_stats   活动统计（最近 N 天上传趋势）
 *
 * ── 跨文件操作 ────────────────────────────────
 *  17. compare_files        比较两个文本文件的内容差异（摘要级）
 */

import { eq, and, isNull, isNotNull, desc, asc, like, or, inArray, count, gte, lte, ne, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import {
  getDb,
  files,
  fileTags,
  shares,
  userStars,
  storageBuckets,
  fileNotes,
  fileVersions,
  auditLogs,
} from '../../db';
import { searchAndFetchFiles, buildFileTextForVector } from '../vectorIndex';
import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';
import { getAiConfigString, getAiConfigNumber } from './aiConfigService';
import { ModelGateway } from './modelGateway';
import type { ModelConfig } from './types';
import { uint8ArrayToBase64, formatBytes, fetchFileBuffer, getMimeTypeCategory, buildVisionMessageContent } from './utils';

// ─────────────────────────────────────────────────────────────────────────────
// 配置常量
// ─────────────────────────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// 公共类型
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** 工具统一返回的文件对象（前端渲染用） */
export interface AgentFile {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  mimeType: string | null;
  size: number;
  sizeFormatted: string;
  createdAt: string;
  updatedAt: string;
  parentId: string | null;
  aiSummary: string | null;
  aiTags: string | null;
  description: string | null;
  isStarred: boolean;
  currentVersion: number | null;
  vectorIndexedAt: string | null;
}

/** 工具结果通用包装 */
export interface ToolResultBase {
  /** Agent 下一步行动建议（驱动链式推理） */
  _next_actions?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具定义（发送给 LLM）
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ── 1. search_files ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: `【核心搜索】语义向量搜索 + 全文检索混合，覆盖文件名/描述/AI摘要/AI标签四个字段。
适用场景：
- 用户明确说要"找""搜"某类或某个文件
- 关键词搜索：2-5 个核心词，避免完整句子
- 支持 mimeTypePrefix 按文件类型过滤（如 "image/" "video/" "application/pdf"）
⚠️ 返回 0 结果时：不要重试超过 2 次，改用 filter_files 按类型浏览
⚠️ 找到图片时：调用 analyze_image 进行视觉确认`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索词（2-5个核心词）' },
          limit: { type: 'number', description: '结果数量，默认 10，最大 30' },
          mimeTypePrefix: { type: 'string', description: '类型过滤，如 "image/" "video/" "text/" "application/pdf"' },
          folderId: { type: 'string', description: '限定在某文件夹内搜索' },
        },
        required: ['query'],
      },
    },
  },

  // ── 2. filter_files ───────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'filter_files',
      description: `【结构化过滤】通过多维条件组合筛选文件，不依赖关键词匹配。
适用场景：
- "找所有图片" / "找大文件" / "最近一周上传的文件"
- 搜索无结果时的备选方案
- 需要视觉筛选时（先 filter_files 获取图片列表，再 analyze_image 逐张判断）
- 组合场景："找有 AI 摘要的 PDF 文件"`,
      parameters: {
        type: 'object',
        properties: {
          mimeTypePrefix: { type: 'string', description: '文件类型前缀，如 "image/" "video/" "audio/"' },
          hasAiSummary: { type: 'boolean', description: '仅返回已有 AI 摘要的文件' },
          hasVectorIndex: { type: 'boolean', description: '仅返回已建立向量索引的文件' },
          isStarred: { type: 'boolean', description: '仅返回收藏的文件' },
          minSizeBytes: { type: 'number', description: '最小文件大小（字节）' },
          maxSizeBytes: { type: 'number', description: '最大文件大小（字节）' },
          createdAfter: { type: 'string', description: '创建时间起（ISO 8601）' },
          createdBefore: { type: 'string', description: '创建时间止（ISO 8601）' },
          folderId: { type: 'string', description: '限定在某文件夹内，不传则全局' },
          sortBy: {
            type: 'string',
            enum: ['newest', 'oldest', 'largest', 'smallest', 'name_asc', 'name_desc'],
            description: '排序方式，默认 newest',
          },
          limit: { type: 'number', description: '结果数量，默认 20，最大 100' },
        },
        required: [],
      },
    },
  },

  // ── 3. search_by_tag ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'search_by_tag',
      description: '按标签精确或模糊搜索文件。支持同时搜索多个标签（AND 逻辑：文件必须包含所有标签）。',
      parameters: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签名数组，如 ["重要", "合同"]。多个标签取交集（AND）',
          },
          matchMode: {
            type: 'string',
            enum: ['any', 'all'],
            description: '"any"=包含任意一个标签（OR），"all"=包含所有标签（AND）。默认 any',
          },
          limit: { type: 'number', description: '结果数量，默认 20' },
        },
        required: ['tags'],
      },
    },
  },

  // ── 4. search_duplicates ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'search_duplicates',
      description: '查找重复文件（相同内容哈希的文件）。适合用户问"有没有重复文件"时使用。',
      parameters: {
        type: 'object',
        properties: {
          mimeTypePrefix: { type: 'string', description: '可选：只查找某类型的重复文件' },
          limit: { type: 'number', description: '返回重复组数量，默认 10' },
        },
        required: [],
      },
    },
  },

  // ── 5. read_file_text ─────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'read_file_text',
      description: `【文本内容读取】获取文件的文本内容（分段）。
适用：文档/代码/CSV/Markdown 等文本类文件。
⚠️ 图片/视频文件无文本内容，请用 analyze_image 代替。
⚠️ 搜到 ≤5 个文本文件后，若需了解内容，逐一调用此工具。`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID（如 "bf7b4a5e-5872-4edb-a150-a9a1330c58a9"），必须是工具返回的 id 字段' },
          sectionIndex: { type: 'number', description: '要读取的段落序号（0开始），不传则返回所有段落摘要' },
        },
        required: ['fileId'],
      },
    },
  },

  // ── 6. analyze_image ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'analyze_image',
      description: `【视觉分析】直接"看"图片并描述内容，支持 S3/R2 和 Telegram 双存储。
⚠️ 仅适用于图片文件（image/*）。
适用场景：
- 需要视觉确认是否符合用户描述（人物外貌、场景、风格等）
- 批量筛选图片时逐一调用（每次 1 张，最多调用 10 次）
- 用户直接问"这张图片是什么内容"
降级机制：视觉模型不可用时，返回已有的 aiTags + description + aiSummary 作为参考。`,
      parameters: {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: '图片文件的 UUID（如 "bf7b4a5e-5872-4edb-a150-a9a1330c58a9"），必须是工具返回的 id 字段，不是文件名',
          },
          question: {
            type: 'string',
            description: '对图片提问。默认："详细描述图片内容，包括人物（外貌/性别/年龄/表情）、场景、风格、颜色"',
          },
        },
        required: ['fileId'],
      },
    },
  },

  // ── 7. get_file_detail ────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_file_detail',
      description:
        '获取单个文件或文件夹的完整元数据：AI摘要、标签列表、分享信息、权限、版本数量、备注数量。用于用户追问某文件详情时。',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件或文件夹的 UUID，必须是工具返回的 id 字段' },
        },
        required: ['fileId'],
      },
    },
  },

  // ── 8. get_file_versions ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_file_versions',
      description: '获取文件的版本历史（版本号、大小、修改时间、变更说明）。用于用户问"这个文件改过几次"时。',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID，必须是工具返回的 id 字段' },
          limit: { type: 'number', description: '版本数量，默认全部' },
        },
        required: ['fileId'],
      },
    },
  },

  // ── 9. get_file_notes ─────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_file_notes',
      description: '获取文件上的备注/笔记列表（包含置顶备注）。用于用户问"这个文件有什么备注"时。',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID，必须是工具返回的 id 字段' },
        },
        required: ['fileId'],
      },
    },
  },

  // ── 10. list_folder ───────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_folder',
      description: '列出文件夹内容（文件 + 子文件夹）。folderId 不传则列出根目录。',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: '文件夹 ID，不传则列出根目录' },
          limit: { type: 'number', description: '数量限制，默认 50' },
          sortBy: {
            type: 'string',
            enum: ['name', 'newest', 'largest'],
            description: '排序方式，默认文件夹优先然后按名称',
          },
        },
        required: [],
      },
    },
  },

  // ── 11. get_folder_tree ───────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_folder_tree',
      description: '获取目录树结构（含各层级文件夹名称和文件数量统计）。适合用户问"帮我看看文件结构"时。',
      parameters: {
        type: 'object',
        properties: {
          rootFolderId: { type: 'string', description: '起始文件夹 ID，不传从根目录开始' },
          maxDepth: { type: 'number', description: '最大深度，默认 3，最大 5' },
        },
        required: [],
      },
    },
  },

  // ── 12. list_recent ───────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_recent',
      description: '列出最近上传或修改的文件，按时间倒序。可按类型过滤。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '数量，默认 15' },
          sortBy: {
            type: 'string',
            enum: ['uploaded', 'modified'],
            description: '按上传时间或修改时间，默认 uploaded',
          },
          mimeTypePrefix: { type: 'string', description: '类型过滤，如 "image/"' },
        },
        required: [],
      },
    },
  },

  // ── 13. list_starred ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_starred',
      description: '列出用户收藏（星标）的文件，按收藏时间倒序。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '数量，默认 20' },
        },
        required: [],
      },
    },
  },

  // ── 14. list_shares ───────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_shares',
      description: '列出用户创建的分享链接，包括对应文件、到期时间、下载次数。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '数量，默认 20' },
          includeExpired: { type: 'boolean', description: '是否包含已过期的分享，默认 false' },
        },
        required: [],
      },
    },
  },

  // ── 15. get_storage_stats ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_storage_stats',
      description: '获取存储统计：文件总数/总大小/按类型分布/按存储桶分布/最近上传/最大文件。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },

  // ── 16. get_activity_stats ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_activity_stats',
      description: '获取最近 N 天的文件上传活动趋势（每天上传数量）。适合用户问"我最近上传了多少文件"时。',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: '统计天数，默认 30，最大 365' },
        },
        required: [],
      },
    },
  },

  // ── 17. compare_files ─────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'compare_files',
      description: '对比两个文本文件的内容摘要差异，适合用户问"这两个文件有什么区别"时。',
      parameters: {
        type: 'object',
        properties: {
          fileIdA: { type: 'string', description: '第一个文件的 UUID，必须是工具返回的 id 字段' },
          fileIdB: { type: 'string', description: '第二个文件的 UUID，必须是工具返回的 id 字段' },
        },
        required: ['fileIdA', 'fileIdB'],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 工具执行器
// ─────────────────────────────────────────────────────────────────────────────

export class AgentToolExecutor {
  constructor(
    private env: Env,
    public userId: string
  ) {}

  async execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    logger.info('AgentTool', `Execute: ${toolName}`, { args, userId: this.userId });

    const dispatch: Record<string, () => Promise<unknown>> = {
      search_files: () => this.searchFiles(args),
      filter_files: () => this.filterFiles(args),
      search_by_tag: () => this.searchByTag(args),
      search_duplicates: () => this.searchDuplicates(args),
      read_file_text: () => this.readFileText(args),
      analyze_image: () => this.analyzeImage(args),
      get_file_detail: () => this.getFileDetail(args),
      get_file_versions: () => this.getFileVersions(args),
      get_file_notes: () => this.getFileNotes(args),
      list_folder: () => this.listFolder(args),
      get_folder_tree: () => this.getFolderTree(args),
      list_recent: () => this.listRecent(args),
      list_starred: () => this.listStarred(args),
      list_shares: () => this.listShares(args),
      get_storage_stats: () => this.getStorageStats(),
      get_activity_stats: () => this.getActivityStats(args),
      compare_files: () => this.compareFiles(args),
    };

    const fn = dispatch[toolName];
    if (!fn) throw new Error(`未知工具: ${toolName}`);
    return fn();
  }

  // ── 1. search_files ──────────────────────────────────────────────────────

  private async searchFiles(args: Record<string, unknown>) {
    const query = args.query as string;
    const limit = Math.min((args.limit as number) || 10, 30);
    const mimeTypePrefix = args.mimeTypePrefix as string | undefined;
    const folderId = args.folderId as string | undefined;

    const db = getDb(this.env.DB);
    let results: AgentFile[] = [];

    // 1) 语义向量搜索
    try {
      const vectorResults = await searchAndFetchFiles(this.env, query, this.userId, {
        limit: limit * 2,
        threshold: 0.22,
      });
      results = vectorResults
        .filter((f) => !mimeTypePrefix || (f.mimeType ?? '').startsWith(mimeTypePrefix))
        .filter((f) => !folderId || f.parentId === folderId)
        .map(toAgentFile);
    } catch (error) {
      logger.warn('AgentTool', 'Vector search failed, falling back to FTS', { query }, error);
    }

    // 2) FTS fallback（覆盖 name / description / aiSummary / aiTags）
    if (results.length < 3) {
      const kws = query.split(/\s+/).slice(0, 4);
      const conditions: any[] = [
        eq(files.userId, this.userId),
        isNull(files.deletedAt),
        or(
          ...kws.flatMap((w) => [
            like(files.name, `%${w}%`),
            like(files.description, `%${w}%`),
            like(files.aiSummary, `%${w}%`),
            like(files.aiTags, `%${w}%`),
          ])
        ),
      ];
      if (mimeTypePrefix) conditions.push(like(files.mimeType, `${mimeTypePrefix}%`));
      if (folderId) conditions.push(eq(files.parentId, folderId));

      const kwRows = await db
        .select()
        .from(files)
        .where(and(...conditions))
        .orderBy(desc(files.updatedAt))
        .limit(limit)
        .all();

      const existing = new Set(results.map((r) => r.id));
      results = [...results, ...kwRows.filter((f) => !existing.has(f.id)).map(toAgentFile)].slice(0, limit);
    }

    const imageCount = results.filter((f) => f.mimeType?.startsWith('image/')).length;
    const textCount = results.filter((f) => isTextFile(f.mimeType) && !f.isFolder).length;

    const nextActions: string[] = [];
    if (results.length === 0) {
      nextActions.push('搜索无结果。建议：换同义词再试一次，或使用 filter_files 按类型浏览所有文件。');
    } else if (imageCount > 0 && imageCount <= 10) {
      nextActions.push(`找到 ${imageCount} 张图片。若需视觉确认是否符合描述，逐一调用 analyze_image（每次 1 张）。`);
    } else if (textCount > 0 && textCount <= 5) {
      nextActions.push(`找到 ${textCount} 个文本文件。若需了解内容，逐一调用 read_file_text。`);
    }

    return { total: results.length, files: results, _next_actions: nextActions };
  }

  // ── 2. filter_files ──────────────────────────────────────────────────────

  private async filterFiles(args: Record<string, unknown>) {
    const db = getDb(this.env.DB);
    const limit = Math.min((args.limit as number) || 20, 100);
    const sortBy = (args.sortBy as string) || 'newest';

    const conditions: any[] = [eq(files.userId, this.userId), isNull(files.deletedAt), eq(files.isFolder, false)];

    if (args.mimeTypePrefix) conditions.push(like(files.mimeType, `${args.mimeTypePrefix}%`));
    if (args.hasAiSummary === true) conditions.push(isNotNull(files.aiSummary));
    if (args.hasVectorIndex === true) conditions.push(isNotNull(files.vectorIndexedAt));
    if (args.isStarred === true) conditions.push(eq(files.isStarred, true));
    if (args.minSizeBytes) conditions.push(gte(files.size, args.minSizeBytes as number));
    if (args.maxSizeBytes) conditions.push(lte(files.size, args.maxSizeBytes as number));
    if (args.createdAfter) conditions.push(gte(files.createdAt, args.createdAfter as string));
    if (args.createdBefore) conditions.push(lte(files.createdAt, args.createdBefore as string));
    if (args.folderId) conditions.push(eq(files.parentId, args.folderId as string));

    const orderMap: Record<string, any> = {
      newest: desc(files.createdAt),
      oldest: asc(files.createdAt),
      largest: desc(files.size),
      smallest: asc(files.size),
      name_asc: asc(files.name),
      name_desc: desc(files.name),
    };

    const rows = await db
      .select()
      .from(files)
      .where(and(...conditions))
      .orderBy(orderMap[sortBy] ?? desc(files.createdAt))
      .limit(limit)
      .all();

    const results = rows.map(toAgentFile);
    const imageCount = results.filter((f) => f.mimeType?.startsWith('image/')).length;

    const nextActions: string[] = [];
    if (results.length === 0) {
      nextActions.push('过滤结果为空，请尝试放宽条件（减少过滤参数）。');
    } else if (imageCount > 0) {
      nextActions.push(`过滤出 ${imageCount} 张图片。若需视觉判断，调用 analyze_image 逐张分析。`);
    }

    return { total: results.length, files: results, _next_actions: nextActions };
  }

  // ── 3. search_by_tag ─────────────────────────────────────────────────────

  private async searchByTag(args: Record<string, unknown>) {
    const tags = args.tags as string[];
    const matchMode = (args.matchMode as string) || 'any';
    const limit = Math.min((args.limit as number) || 20, 50);
    const db = getDb(this.env.DB);

    if (matchMode === 'all' && tags.length > 1) {
      // AND 逻辑：找同时含所有标签的文件
      const fileIdsWithTag = await Promise.all(
        tags.map((tag) =>
          db
            .select({ fileId: fileTags.fileId })
            .from(fileTags)
            .where(and(eq(fileTags.userId, this.userId), like(fileTags.name, `%${tag}%`)))
            .all()
            .then((rows) => new Set(rows.map((r) => r.fileId)))
        )
      );

      // 交集
      const intersection = fileIdsWithTag.reduce((acc, cur) => {
        return new Set([...acc].filter((id) => cur.has(id)));
      });

      if (intersection.size === 0) return { tags, matchMode, total: 0, files: [] };

      const rows = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.userId, this.userId),
            isNull(files.deletedAt),
            inArray(files.id, [...intersection].slice(0, limit))
          )
        )
        .all();

      return { tags, matchMode, total: rows.length, files: rows.map(toAgentFile) };
    }

    // OR 逻辑（默认）
    const rows = await db
      .select({ file: files, tag: fileTags })
      .from(fileTags)
      .innerJoin(files, eq(fileTags.fileId, files.id))
      .where(
        and(
          eq(fileTags.userId, this.userId),
          or(...tags.map((tag) => like(fileTags.name, `%${tag}%`))),
          isNull(files.deletedAt)
        )
      )
      .orderBy(desc(files.updatedAt))
      .limit(limit)
      .all();

    // 去重（同一文件可能有多个匹配标签）
    const seen = new Set<string>();
    const deduped = rows.filter((r) => {
      if (seen.has(r.file.id)) return false;
      seen.add(r.file.id);
      return true;
    });

    return {
      tags,
      matchMode,
      total: deduped.length,
      files: deduped.map((r) => ({ ...toAgentFile(r.file), matchedTag: r.tag.name })),
    };
  }

  // ── 4. search_duplicates ─────────────────────────────────────────────────

  private async searchDuplicates(args: Record<string, unknown>) {
    const mimeTypePrefix = args.mimeTypePrefix as string | undefined;
    const limit = Math.min((args.limit as number) || 10, 50);
    const db = getDb(this.env.DB);

    const conditions: any[] = [
      eq(files.userId, this.userId),
      isNull(files.deletedAt),
      isNotNull(files.hash),
      eq(files.isFolder, false),
    ];
    if (mimeTypePrefix) conditions.push(like(files.mimeType, `${mimeTypePrefix}%`));

    // 找出 hash 相同的文件组
    const hashGroups = await db
      .select({ hash: files.hash, cnt: count(files.id) })
      .from(files)
      .where(and(...conditions))
      .groupBy(files.hash)
      .having(sql`count(${files.id}) > 1`)
      .orderBy(desc(sql`count(${files.id})`))
      .limit(limit)
      .all();

    if (hashGroups.length === 0) {
      return { total: 0, duplicateGroups: [], message: '未发现重复文件' };
    }

    const hashes = hashGroups.map((g) => g.hash as string);
    const allDuplicates = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, this.userId), isNull(files.deletedAt), inArray(files.hash, hashes)))
      .all();

    // 按 hash 分组
    const groups = new Map<string, AgentFile[]>();
    for (const file of allDuplicates) {
      const h = file.hash as string;
      if (!groups.has(h)) groups.set(h, []);
      groups.get(h)!.push(toAgentFile(file));
    }

    const duplicateGroups = [...groups.entries()].map(([hash, groupFiles]) => ({
      hash: hash.slice(0, 12) + '...',
      count: groupFiles.length,
      totalWastedSize: formatBytes((groupFiles.length - 1) * (groupFiles[0]?.size || 0)),
      files: groupFiles,
    }));

    return {
      total: hashGroups.length,
      duplicateGroups,
      _next_actions: ['找到重复文件。你可以告知用户哪些文件重复，建议保留哪个版本（如最新的）。'],
    };
  }

  // ── 5. read_file_text ─────────────────────────────────────────────────────

  private async readFileText(args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const sectionIndex = args.sectionIndex as number | undefined;
    const db = getDb(this.env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, this.userId), isNull(files.deletedAt)))
      .get();

    if (!file) return { error: `文件不存在或无权访问: ${fileId}` };

    if (
      file.mimeType?.startsWith('image/') ||
      file.mimeType?.startsWith('video/') ||
      file.mimeType?.startsWith('audio/')
    ) {
      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        error: '该文件类型无文本内容',
        _next_actions: file.mimeType.startsWith('image/') ? ['请使用 analyze_image 工具来理解图片内容。'] : [],
      };
    }

    const vectorText = await buildFileTextForVector(this.env, fileId);
    if (!vectorText || vectorText.trim().length < 30) {
      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        aiSummary: file.aiSummary || null,
        sections: [],
        note: '该文件尚无可提取的文本内容（可能未建立索引，或为二进制文件）。',
      };
    }

    const CHUNK = 1500;
    const totalChunks = Math.ceil(vectorText.length / CHUNK);
    const allSections = Array.from({ length: totalChunks }, (_, i) => ({
      index: i,
      title: `第 ${i + 1} 段（共 ${totalChunks} 段）`,
      content: vectorText.slice(i * CHUNK, Math.min((i + 1) * CHUNK, vectorText.length)),
      charCount: Math.min(CHUNK, vectorText.length - i * CHUNK),
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

    // 不指定段落时返回摘要 + 各段标题（省 token）
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
        preview: s.content.slice(0, 100) + (s.content.length > 100 ? '...' : ''),
      })),
      _next_actions:
        totalChunks > 1 ? ['若需阅读具体内容，传入 sectionIndex 参数（0 到 ' + (totalChunks - 1) + '）再次调用。'] : [],
    };
  }

  // ── 6. analyze_image ──────────────────────────────────────────────────────

  private async analyzeImage(args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const question =
      (args.question as string) ||
      '请详细描述这张图片的内容，包括：人物（外貌、性别、大概年龄、表情、穿着）、背景场景、主要物体、整体风格和色调。';

    const db = getDb(this.env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, this.userId), isNull(files.deletedAt)))
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

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        size: formatBytes(file.size),
        visualDescription: null,
        error: `图片过大（${formatBytes(file.size)}），超过 5MB 限制`,
        existingMetadata: {
          aiTags: file.aiTags || null,
          aiSummary: file.aiSummary || null,
          description: file.description || null,
        },
        note: '请使用较小的图片，或使用已有元数据作为参考。',
      };
    }

    const buffer = await fetchFileBuffer(this.env, file);
    if (!buffer) {
      return {
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        visualDescription: null,
        storageError: true,
        existingMetadata: {
          aiTags: file.aiTags || null,
          aiSummary: file.aiSummary || null,
          description: file.description || null,
        },
        note: '无法读取图片原始数据（存储后端连接失败），已返回数据库中已有的 AI 元数据供参考。',
      };
    }

    const imageBytes = new Uint8Array(buffer);
    const actualMimeType = file.mimeType || 'image/jpeg';
    const visionModelId = await getAiConfigString(
      this.env,
      'ai.default_model.vision',
      '@cf/llava-hf/llava-1.5-7b-hf'
    );
    const visionMaxTokens = await getAiConfigNumber(this.env, 'ai.vision.max_tokens', 600);

    try {
      const modelGateway = new ModelGateway(this.env);
      const resolved = await modelGateway.resolveModelForCall(this.userId, visionModelId);

      let description: string;

      if (resolved.type === 'custom') {
        const customModel = resolved.config;
        if (customModel.provider === 'openai_compatible') {
          if (!customModel.capabilities.includes('vision')) {
            logger.warn('AgentTool', 'Custom model does not support vision', {
              modelId: visionModelId,
              capabilities: customModel.capabilities,
            });
            return {
              fileId,
              fileName: file.name,
              mimeType: file.mimeType,
              visualDescription: null,
              error: '配置的模型不支持视觉分析',
              existingMetadata: {
                aiTags: file.aiTags || null,
                aiSummary: file.aiSummary || null,
                description: file.description || null,
              },
              note: '请在 AI 设置中配置支持视觉的模型（如 glm-4v-flash）。',
            };
          }
          const gateway = new ModelGateway(this.env);
          const base64Image = uint8ArrayToBase64(imageBytes);
          const response = await gateway.chatCompletion(
            this.userId,
            {
              messages: [
                {
                  role: 'user',
                  content: buildVisionMessageContent(base64Image, actualMimeType, question),
                },
              ],
              maxTokens: 2048,
              featureType: 'image_analysis',
            },
            visionModelId
          );
          description = response.content.trim();
        } else if (this.env.AI) {
          const result = await (this.env.AI as any).run(visionModelId, {
            image: Array.from(imageBytes),
            prompt: question,
            max_tokens: 2048,
          });
          description =
            (result as any)?.description?.trim() ||
            (result as any)?.response?.trim() ||
            '';
        } else {
          throw new Error('No AI service available for this model type');
        }
      } else {
        if (!this.env.AI) {
          return {
            fileId,
            fileName: file.name,
            mimeType: file.mimeType,
            visualDescription: null,
            existingMetadata: {
              aiTags: file.aiTags || null,
              aiSummary: file.aiSummary || null,
              description: file.description || null,
            },
            note: 'Workers AI 未绑定，无法进行视觉分析。已返回已有元数据供参考。',
          };
        }
        const result = await (this.env.AI as any).run(visionModelId, {
          image: Array.from(imageBytes),
          prompt: question,
          max_tokens: visionMaxTokens,
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
        note: '视觉分析失败，已返回数据库已有元数据。',
      };
    }
  }

  // ── 7. get_file_detail ────────────────────────────────────────────────────

  private async getFileDetail(args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(this.env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, this.userId), isNull(files.deletedAt)))
      .get();

    if (!file) return { error: '文件不存在或无权限访问', fileId };

    const [tags, shareList, noteCountRes] = await Promise.all([
      db.select().from(fileTags).where(eq(fileTags.fileId, fileId)).all(),
      db.select().from(shares).where(eq(shares.fileId, fileId)).all(),
      db
        .select({ cnt: count(fileNotes.id) })
        .from(fileNotes)
        .where(and(eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
        .get(),
    ]);

    let childCount: number | null = null;
    if (file.isFolder) {
      const res = await db
        .select({ cnt: count(files.id) })
        .from(files)
        .where(and(eq(files.parentId, fileId), isNull(files.deletedAt)))
        .get();
      childCount = res?.cnt ?? 0;
    }

    const now = Date.now();
    const activeShares = shareList.filter((s) => !s.expiresAt || new Date(s.expiresAt).getTime() > now);

    return {
      ...toAgentFile(file),
      tags: tags.map((t) => ({ name: t.name, color: t.color })),
      shares: {
        total: shareList.length,
        active: activeShares.length,
        list: shareList.map((s) => ({
          id: s.id,
          expiresAt: s.expiresAt,
          downloadCount: s.downloadCount,
          downloadLimit: s.downloadLimit,
          isUploadLink: s.isUploadLink,
          isExpired: s.expiresAt ? new Date(s.expiresAt).getTime() < now : false,
        })),
      },
      noteCount: noteCountRes?.cnt ?? 0,
      childCount,
      storageBackend: file.bucketId ? 'external' : 'r2',
    };
  }

  // ── 8. get_file_versions ─────────────────────────────────────────────────

  private async getFileVersions(args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(this.env.DB);

    const file = await db
      .select({ id: files.id, name: files.name, currentVersion: files.currentVersion })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, this.userId)))
      .get();

    if (!file) return { error: '文件不存在或无权访问', fileId };

    const versions = await db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId))
      .orderBy(desc(fileVersions.version))
      .all();

    return {
      fileId,
      fileName: file.name,
      currentVersion: file.currentVersion,
      totalVersions: versions.length,
      versions: versions.map((v) => ({
        version: v.version,
        size: formatBytes(v.size),
        sizeBytes: v.size,
        mimeType: v.mimeType,
        changeSummary: v.changeSummary || null,
        createdAt: v.createdAt,
        isCurrent: v.version === file.currentVersion,
      })),
    };
  }

  // ── 9. get_file_notes ─────────────────────────────────────────────────────

  private async getFileNotes(args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(this.env.DB);

    const notes = await db
      .select()
      .from(fileNotes)
      .where(and(eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
      .orderBy(desc(fileNotes.isPinned), desc(fileNotes.createdAt))
      .limit(30)
      .all();

    return {
      fileId,
      total: notes.length,
      notes: notes.map((n) => ({
        id: n.id,
        content: n.content,
        isPinned: n.isPinned,
        version: n.version,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    };
  }

  // ── 10. list_folder ───────────────────────────────────────────────────────

  private async listFolder(args: Record<string, unknown>) {
    const folderId = (args.folderId as string) || null;
    const limit = Math.min((args.limit as number) || 50, 200);
    const sortBy = (args.sortBy as string) || 'default';
    const db = getDb(this.env.DB);

    const rows = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.userId, this.userId),
          isNull(files.deletedAt),
          folderId ? eq(files.parentId, folderId) : isNull(files.parentId)
        )
      )
      .orderBy(
        sortBy === 'newest'
          ? desc(files.createdAt)
          : sortBy === 'largest'
            ? desc(files.size)
            : sql`${files.isFolder} DESC, ${files.name} ASC`
      )
      .limit(limit)
      .all();

    let folderInfo: AgentFile | null = null;
    if (folderId) {
      const folder = await db
        .select()
        .from(files)
        .where(and(eq(files.id, folderId), eq(files.userId, this.userId)))
        .get();
      if (folder) folderInfo = toAgentFile(folder);
    }

    const subFolderCount = rows.filter((r) => r.isFolder).length;
    const fileCount = rows.length - subFolderCount;

    return {
      folderId: folderId || 'root',
      folderName: folderInfo?.name || '根目录',
      summary: `${subFolderCount} 个文件夹，${fileCount} 个文件`,
      total: rows.length,
      files: rows.map(toAgentFile),
    };
  }

  // ── 11. get_folder_tree ───────────────────────────────────────────────────

  private async getFolderTree(args: Record<string, unknown>) {
    const rootId = (args.rootFolderId as string) || null;
    const maxDepth = Math.min((args.maxDepth as number) || 3, 5);
    const db = getDb(this.env.DB);

    // 获取所有文件夹和文件数
    const [allFolders, fileCounts] = await Promise.all([
      db
        .select({ id: files.id, name: files.name, parentId: files.parentId })
        .from(files)
        .where(and(eq(files.userId, this.userId), isNull(files.deletedAt), eq(files.isFolder, true)))
        .all(),
      db
        .select({ parentId: files.parentId, cnt: count(files.id) })
        .from(files)
        .where(and(eq(files.userId, this.userId), isNull(files.deletedAt), eq(files.isFolder, false)))
        .groupBy(files.parentId)
        .all(),
    ]);

    const fileCountMap = new Map(fileCounts.map((r) => [r.parentId, r.cnt]));

    type TreeNode = {
      id: string;
      name: string;
      fileCount: number;
      children: TreeNode[];
    };

    const buildTree = (parentId: string | null, depth: number): TreeNode[] => {
      if (depth >= maxDepth) return [];
      return allFolders
        .filter((f) => f.parentId === parentId)
        .map((f) => ({
          id: f.id,
          name: f.name,
          fileCount: fileCountMap.get(f.id) ?? 0,
          children: buildTree(f.id, depth + 1),
        }));
    };

    return {
      rootId: rootId || 'root',
      maxDepth,
      totalFolders: allFolders.length,
      tree: buildTree(rootId, 0),
    };
  }

  // ── 12. list_recent ───────────────────────────────────────────────────────

  private async listRecent(args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) || 15, 50);
    const sortCol = (args.sortBy as string) === 'modified' ? files.updatedAt : files.createdAt;
    const mimeTypePrefix = args.mimeTypePrefix as string | undefined;
    const db = getDb(this.env.DB);

    const conditions: any[] = [eq(files.userId, this.userId), isNull(files.deletedAt), eq(files.isFolder, false)];
    if (mimeTypePrefix) conditions.push(like(files.mimeType, `${mimeTypePrefix}%`));

    const rows = await db
      .select()
      .from(files)
      .where(and(...conditions))
      .orderBy(desc(sortCol))
      .limit(limit)
      .all();

    return { total: rows.length, files: rows.map(toAgentFile) };
  }

  // ── 13. list_starred ──────────────────────────────────────────────────────

  private async listStarred(args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) || 20, 50);
    const db = getDb(this.env.DB);

    const rows = await db
      .select({ file: files, starredAt: userStars.createdAt })
      .from(userStars)
      .innerJoin(files, eq(userStars.fileId, files.id))
      .where(and(eq(userStars.userId, this.userId), isNull(files.deletedAt)))
      .orderBy(desc(userStars.createdAt))
      .limit(limit)
      .all();

    return {
      total: rows.length,
      files: rows.map((r) => ({ ...toAgentFile(r.file), starredAt: r.starredAt })),
    };
  }

  // ── 14. list_shares ───────────────────────────────────────────────────────

  private async listShares(args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) || 20, 50);
    const includeExpired = (args.includeExpired as boolean) ?? false;
    const db = getDb(this.env.DB);

    const now = new Date().toISOString();
    const conditions: any[] = [eq(shares.userId, this.userId)];
    if (!includeExpired) {
      conditions.push(or(isNull(shares.expiresAt), gte(shares.expiresAt, now)));
    }

    const rows = await db
      .select({ share: shares, file: files })
      .from(shares)
      .innerJoin(files, eq(shares.fileId, files.id))
      .where(and(...conditions))
      .orderBy(desc(shares.createdAt))
      .limit(limit)
      .all();

    return {
      total: rows.length,
      shares: rows.map((r) => ({
        shareId: r.share.id,
        file: toAgentFile(r.file),
        expiresAt: r.share.expiresAt,
        downloadCount: r.share.downloadCount,
        downloadLimit: r.share.downloadLimit,
        isUploadLink: r.share.isUploadLink,
        isExpired: r.share.expiresAt ? r.share.expiresAt < now : false,
        createdAt: (r.share as any).createdAt,
      })),
    };
  }

  // ── 15. get_storage_stats ─────────────────────────────────────────────────

  private async getStorageStats() {
    const db = getDb(this.env.DB);

    const [allFiles, buckets] = await Promise.all([
      db
        .select({
          id: files.id,
          name: files.name,
          mimeType: files.mimeType,
          size: files.size,
          createdAt: files.createdAt,
          bucketId: files.bucketId,
        })
        .from(files)
        .where(and(eq(files.userId, this.userId), isNull(files.deletedAt), eq(files.isFolder, false)))
        .all(),
      db
        .select({ id: storageBuckets.id, name: storageBuckets.name, provider: storageBuckets.provider })
        .from(storageBuckets)
        .where(and(eq(storageBuckets.userId, this.userId), eq(storageBuckets.isActive, true)))
        .all(),
    ]);

    const totalSize = allFiles.reduce((s, f) => s + (f.size || 0), 0);

    // 按 MIME 类型分组
    const typeMap = new Map<string, { count: number; size: number }>();
    for (const f of allFiles) {
      const cat = getMimeTypeCategory(f.mimeType);
      const cur = typeMap.get(cat) || { count: 0, size: 0 };
      typeMap.set(cat, { count: cur.count + 1, size: cur.size + (f.size || 0) });
    }

    // 按存储桶分组
    const bucketMap = new Map<string, { count: number; size: number; name: string; provider: string }>();
    for (const f of allFiles) {
      const bid = f.bucketId || '__default__';
      const bucket = buckets.find((b) => b.id === bid);
      const cur = bucketMap.get(bid) || {
        count: 0,
        size: 0,
        name: bucket?.name || '默认存储',
        provider: bucket?.provider || 'r2',
      };
      bucketMap.set(bid, { ...cur, count: cur.count + 1, size: cur.size + (f.size || 0) });
    }

    const folderRes = await db
      .select({ cnt: count(files.id) })
      .from(files)
      .where(and(eq(files.userId, this.userId), isNull(files.deletedAt), eq(files.isFolder, true)))
      .get();

    // 最大文件 Top5
    const top5Largest = [...allFiles]
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 5)
      .map((f) => ({ name: f.name, size: formatBytes(f.size || 0), sizeBytes: f.size }));

    return {
      totalFiles: allFiles.length,
      totalFolders: folderRes?.cnt ?? 0,
      totalSize: formatBytes(totalSize),
      totalSizeBytes: totalSize,
      byType: [...typeMap.entries()]
        .map(([type, d]) => ({ type, count: d.count, size: formatBytes(d.size) }))
        .sort((a, b) => b.count - a.count),
      byBucket: [...bucketMap.entries()].map(([, d]) => ({
        name: d.name,
        provider: d.provider,
        count: d.count,
        size: formatBytes(d.size),
      })),
      top5Largest,
      recentUploads: [...allFiles]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5)
        .map((f) => ({ name: f.name, size: formatBytes(f.size || 0), createdAt: f.createdAt })),
    };
  }

  // ── 16. get_activity_stats ────────────────────────────────────────────────

  private async getActivityStats(args: Record<string, unknown>) {
    const days = Math.min((args.days as number) || 30, 365);
    const db = getDb(this.env.DB);

    const since = new Date(Date.now() - days * 86400000).toISOString();

    const rows = await db
      .select({ createdAt: files.createdAt, size: files.size })
      .from(files)
      .where(
        and(
          eq(files.userId, this.userId),
          isNull(files.deletedAt),
          eq(files.isFolder, false),
          gte(files.createdAt, since)
        )
      )
      .all();

    // 按天汇总
    const dayMap = new Map<string, { count: number; size: number }>();
    for (const f of rows) {
      const day = f.createdAt.slice(0, 10);
      const cur = dayMap.get(day) || { count: 0, size: 0 };
      dayMap.set(day, { count: cur.count + 1, size: cur.size + (f.size || 0) });
    }

    const dailyTrend = [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({ date, count: d.count, size: formatBytes(d.size) }));

    const totalInPeriod = rows.length;
    const avgPerDay = totalInPeriod / days;

    return {
      period: `最近 ${days} 天`,
      totalUploaded: totalInPeriod,
      avgPerDay: parseFloat(avgPerDay.toFixed(1)),
      totalSize: formatBytes(rows.reduce((s, f) => s + (f.size || 0), 0)),
      dailyTrend,
      peakDay: dailyTrend.sort((a, b) => b.count - a.count)[0] || null,
    };
  }

  // ── 17. compare_files ─────────────────────────────────────────────────────

  private async compareFiles(args: Record<string, unknown>) {
    const fileIdA = args.fileIdA as string;
    const fileIdB = args.fileIdB as string;
    const db = getDb(this.env.DB);

    const [fileA, fileB] = await Promise.all([
      db
        .select()
        .from(files)
        .where(and(eq(files.id, fileIdA), eq(files.userId, this.userId)))
        .get(),
      db
        .select()
        .from(files)
        .where(and(eq(files.id, fileIdB), eq(files.userId, this.userId)))
        .get(),
    ]);

    if (!fileA) return { error: `文件 A 不存在: ${fileIdA}` };
    if (!fileB) return { error: `文件 B 不存在: ${fileIdB}` };

    const [textA, textB] = await Promise.all([
      buildFileTextForVector(this.env, fileIdA),
      buildFileTextForVector(this.env, fileIdB),
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
      note: '文件内容已提供，请基于各自的 aiSummary 字段对比主要差异，或调用 read_file_text 读取具体内容后再对比。',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 共享工具函数（被 agentEngine.ts 导出复用）
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

type FileRecord = InferSelectModel<typeof files>;

function toAgentFile(f: FileRecord): AgentFile {
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
