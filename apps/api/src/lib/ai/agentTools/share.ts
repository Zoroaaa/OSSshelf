/**
 * share.ts — 文件分享与协作工具
 *
 * 功能:
 * - 创建/管理分享链接
 * - 权限控制（查看/编辑/下载）
 * - 分享统计与追踪
 * - 批量分享
 *
 * 智能特性：
 * - 自动生成安全链接
 * - 支持密码保护
 * - 到期时间设置
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { getDb, files, shares } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';
import {
  createShareLink as serviceCreateShare,
  revokeShare as serviceRevokeShare,
  updateShare as serviceUpdateShare,
  createUploadLink as serviceCreateUploadLink,
} from '../../../lib/shareService';

export const definitions: ToolDefinition[] = [
  // 1. create_share_link — 创建分享链接
  {
    type: 'function',
    function: {
      name: 'create_share_link',
      description: `【生成链接】为文件或文件夹创建可分享的链接。
适用场景：
• "把这个文件分享给同事"
• "生成一个分享链接"
• "让其他人能下载这个文档"

💡 可设置：密码、有效期、权限等`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
          permission: { type: 'string', enum: ['read', 'write', 'download'], description: '权限级别' },
          expiresAt: { type: 'string', description: '过期时间（ISO格式，可选）' },
          password: { type: 'string', description: '访问密码（可选）' },
          maxUses: { type: 'number', description: '最大使用次数（可选）' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '把这个文件分享给同事', tool_call: { fileId: '<file_id>' } },
        {
          user_query: '生成带密码的分享链接',
          tool_call: { fileId: '<doc_id>', password: '123456', permission: 'read' },
        },
        {
          user_query: '创建7天有效的下载链接',
          tool_call: { fileId: '<file_id>', expiresAt: '2026-04-23T00:00:00Z', permission: 'download' },
        },
      ],
    },
  },

  // 2. list_shares — 查看分享列表
  {
    type: 'function',
    function: {
      name: 'list_shares',
      description: `【我的分享】查看所有活跃的分享链接及其状态。
适用场景：
• "我分享了哪些文件"
• "这些链接还有效吗"
• "查看分享统计"`,
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回数量（默认20）' },
        },
      },
      examples: [
        { user_query: '我分享了哪些文件', tool_call: {} },
        { user_query: '显示所有分享链接', tool_call: { limit: 50 } },
      ],
    },
  },

  // 3. revoke_share — 撤销分享
  {
    type: 'function',
    function: {
      name: 'revoke_share',
      description: `【取消分享】撤销某个分享链接使其失效。
⚠️ 此操作不可恢复，已获取链接的用户将无法访问`,
      parameters: {
        type: 'object',
        properties: {
          shareId: { type: 'string', description: '要撤销的分享ID' },
        },
        required: ['shareId'],
      },
      examples: [
        { user_query: '撤销这个分享链接', tool_call: { shareId: '<share_id>' } },
        { user_query: '取消文件分享', tool_call: { shareId: '<share_id>' } },
      ],
    },
  },

  // 4. update_share_settings — 更新分享设置
  {
    type: 'function',
    function: {
      name: 'update_share_settings',
      description: `【改设置】修改已有分享链接的配置。
适用场景：
• "延长这个链接的有效期"
• "给分享加上密码"
• "改为只读权限"`,
      parameters: {
        type: 'object',
        properties: {
          shareId: { type: 'string', description: '分享ID' },
          permission: { type: 'string', enum: ['read', 'write', 'download'], description: '新的权限级别' },
          expiresAt: { type: 'string', description: '新的过期时间' },
          password: { type: 'string', description: '新的访问密码（空字符串表示移除）' },
        },
        required: ['shareId'],
      },
      examples: [
        {
          user_query: '延长这个链接的有效期到下个月',
          tool_call: { shareId: '<share_id>', expiresAt: '2026-05-16T00:00:00Z' },
        },
        { user_query: '加上访问密码', tool_call: { shareId: '<share_id>', password: 'newpass123' } },
        { user_query: '改为只读权限', tool_call: { shareId: '<share_id>', permission: 'read' } },
      ],
    },
  },

  // 5. get_share_stats — 分享统计
  {
    type: 'function',
    function: {
      name: 'get_share_stats',
      description: `【看统计】查看分享链接的使用情况。
适用场景：
• "这个链接被访问了多少次"
• "谁下载了这个文件"
• "分享效果如何"`,
      parameters: {
        type: 'object',
        properties: {
          shareId: { type: 'string', description: '分享ID' },
        },
        required: ['shareId'],
      },
      examples: [
        { user_query: '这个链接被访问了多少次', tool_call: { shareId: '<share_id>' } },
        { user_query: '查看分享效果统计', tool_call: { shareId: '<share_id>' } },
      ],
    },
  },

  // B. 直链管理（2个新工具）🔥
  {
    type: 'function',
    function: {
      name: 'create_direct_link',
      description: `【创建直链】生成文件的直接下载链接（无需登录）。
与分享链接的区别：
- 分享链接: 需登录或有密码，可在页面预览
- 直链: 匿名可直接下载，适合嵌入邮件/IM/文档

适用场景："生成PDF的直链发微信群"、"嵌入文档中的下载链接"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          expiresInHours: { type: 'number', description: '有效时长（小时），默认 168（7天）' },
          maxDownloads: { type: 'number', description: '最大下载次数（可选）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '生成PDF的直链发微信群', tool_call: { fileId: '<pdf_id>', _confirmed: true } },
        {
          user_query: '创建24小时有效的下载链接',
          tool_call: { fileId: '<file_id>', expiresInHours: 24, maxDownloads: 10, _confirmed: true },
        },
      ],
    },
  },
  {
    type: 'function',
    function: {
      name: 'revoke_direct_link',
      description: `【撤销直链】立即作废直链。
适用场景："直链被滥用需要紧急停止"、"不再需要公开下载"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件的 UUID' },
          _confirmed: { type: 'boolean', description: '用户确认（必须为true）' },
        },
        required: ['fileId', '_confirmed'],
      },
      examples: [
        { user_query: '撤销直链', tool_call: { fileId: '<file_id>', _confirmed: true } },
        { user_query: '停止公开下载', tool_call: { fileId: '<pdf_id>', _confirmed: true } },
      ],
    },
  },

  // C. 上传链接（1个新工具）🔥
  {
    type: 'function',
    function: {
      name: 'create_upload_link_for_folder',
      description: `【创建上传链接】为文件夹创建上传链接，允许他人向该文件夹上传文件。
适用场景："给设计团队创建上传链接"、"收集作业/文档"`,
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: '目标文件夹 ID' },
          password: { type: 'string', description: '访问密码（可选，建议设置）' },
          expiresInHours: { type: 'number', description: '有效时长（小时），默认 72（3天）' },
          allowedMimeTypes: {
            type: 'array',
            items: { type: 'string' },
            description: '允许上传的文件类型（如 ["image/*","application/pdf"]），不传则不限',
          },
          maxSizeBytes: { type: 'number', description: '单个文件大小限制（字节），如 10485760=10MB' },
          maxUploads: { type: 'number', description: '最大上传数量（可选）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['folderId'],
      },
      examples: [
        {
          user_query: '给设计团队创建上传链接',
          tool_call: { folderId: '<design_folder_id>', allowedMimeTypes: ['image/*'], _confirmed: true },
        },
        {
          user_query: '收集作业文档',
          tool_call: {
            folderId: '<homework_id>',
            password: 'class123',
            expiresInHours: 168,
            maxSizeBytes: 52428800,
            _confirmed: true,
          },
        },
      ],
    },
  },
];

export class ShareTools {
  static async executeCreateShare(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const password = args.password as string | undefined;
    const expiresAtStr = args.expiresAt as string | undefined;
    const maxUses = args.maxVisits as number | undefined;

    // 调用公共 service 层（复用 share.ts POST 的核心逻辑：权限检查、密码哈希、过期时间）
    const result = await serviceCreateShare(env, userId, {
      fileId,
      password,
      expiresAt: expiresAtStr,
      maxUses,
    });

    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: `分享链接已创建`,
      shareId: result.shareId,
      url: `/share/${result.shareId}`,
      hasPassword: !!password,
      expiresAt: expiresAtStr || null,
      downloadLimit: maxUses,
      _next_actions: ['✅ 分享链接已创建', '可通过 list_shares 查看所有分享', '可通过 revoke_share 撤销分享'],
    };
  }

  static async executeListShares(env: Env, userId: string, args: Record<string, unknown>) {
    const limit = Math.min((args.limit as number) || 20, 100);
    const db = getDb(env.DB);

    const rows = await db
      .select()
      .from(shares)
      .where(eq(shares.userId, userId))
      .orderBy(desc(shares.createdAt))
      .limit(limit)
      .all();

    return {
      total: rows.length,
      shares: rows.map((s) => ({
        id: s.id,
        fileId: s.fileId,
        url: `/share/${s.id}`,
        hasPassword: !!s.password,
        isUploadLink: s.isUploadLink,
        downloads: Number(s.downloadCount) || 0,
        downloadLimit: s.downloadLimit,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
      })),
    };
  }

  static async executeUpdateShare(env: Env, userId: string, args: Record<string, unknown>) {
    const shareId = args.shareId as string;
    const password = 'password' in args ? ((args.password as string | undefined) ?? null) : undefined;
    const expiresAt = 'expiresAt' in args ? ((args.expiresAt as string | undefined) ?? null) : undefined;
    const maxUses = 'maxVisits' in args ? ((args.maxVisits as number | undefined) ?? null) : undefined;

    const result = await serviceUpdateShare(env, userId, shareId, { password, expiresAt, maxUses });
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: result.message,
      shareId,
      changes: result.changes,
    };
  }

  static async executeRevokeShare(env: Env, userId: string, args: Record<string, unknown>) {
    const shareId = args.shareId as string;

    // 调用公共 service 层（复用 share.ts DELETE 的核心逻辑：权限检查）
    const result = await serviceRevokeShare(env, userId, shareId);
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: result.message,
      shareId,
      revokedAt: new Date().toISOString(),
    };
  }

  static async executeGetShareDetails(env: Env, userId: string, args: Record<string, unknown>) {
    const shareId = args.shareId as string;
    const db = getDb(env.DB);

    const share = await db
      .select()
      .from(shares)
      .where(and(eq(shares.id, shareId), eq(shares.userId, userId)))
      .get();
    if (!share) return { error: '分享链接不存在' };

    return {
      id: share.id,
      fileId: share.fileId,
      url: `/share/${share.id}`,
      hasPassword: !!share.password,
      isUploadLink: share.isUploadLink,
      stats: {
        totalDownloads: Number(share.downloadCount) || 0,
        downloadLimit: share.downloadLimit,
        remainingDownloads: share.downloadLimit
          ? Math.max(0, share.downloadLimit - (Number(share.downloadCount) || 0))
          : null,
      },
      timeInfo: {
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
        isExpired: share.expiresAt ? new Date(share.expiresAt) < new Date() : false,
        remainingTime: share.expiresAt ? getTimeRemaining(share.expiresAt) : null,
      },
    };
  }

  static async executeCreateDirectLink(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const expiresInHours = Math.min((args.expiresInHours as number) || 168, 720); // 最大30天
    const maxDownloads = args.maxDownloads as number | undefined;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    const directLinkToken = generateSecureToken(48);
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

    await db
      .update(files)
      .set({
        directLinkToken,
        directLinkExpiresAt: expiresAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(files.id, fileId));

    logger.info('AgentTool', 'Created direct link', { fileId, fileName: file.name, expiresInHours });

    return {
      success: true,
      message: '直链已创建',
      fileId,
      fileName: file.name,
      url: `/dl/${directLinkToken}`,
      expiresAt,
      expiresInHours,
      maxDownloads,
      warning: '⚠️ 直链无需登录即可下载，请谨慎分享！',
      _next_actions: ['✅ 直链已创建', '可通过 revoke_direct_link 紧急撤销'],
    };
  }

  static async executeRevokeDirectLink(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)))
      .get();
    if (!file) return { error: '文件不存在' };

    await db
      .update(files)
      .set({
        directLinkToken: null,
        directLinkExpiresAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(files.id, fileId));

    logger.info('AgentTool', 'Revoked direct link', { fileId, fileName: file.name });

    return {
      success: true,
      message: '直链已撤销',
      fileId,
      fileName: file.name,
      revokedAt: new Date().toISOString(),
    };
  }

  static async executeCreateUploadLinkForFolder(env: Env, userId: string, args: Record<string, unknown>) {
    const folderId = args.folderId as string;
    const password = args.password as string | undefined;
    const expiresInHours = Math.min((args.expiresInHours as number) || 72, 720);
    const allowedMimeTypes = args.allowedMimeTypes as string[] | undefined;
    const maxSizeBytes = args.maxSizeBytes as number | undefined;
    const maxUploads = args.maxUploads as number | undefined;

    const result = await serviceCreateUploadLink(env, userId, {
      folderId,
      password,
      expiresInHours,
      allowedMimeTypes,
      maxSizeBytes,
      maxUploads,
    });
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: '上传链接已创建',
      uploadLinkId: result.uploadLinkId,
      url: result.url,
      folderName: result.folderName,
      hasPassword: !!password,
      allowedMimeTypes: allowedMimeTypes || '不限',
      maxSizeBytes: maxSizeBytes ? formatSize(maxSizeBytes) : '不限',
      maxUploads,
      expiresAt: new Date(Date.now() + Math.min(expiresInHours, 720) * 60 * 60 * 1000).toISOString(),
      expiresInHours,
      securityTip: password ? '✅ 已设置密码保护' : '⚠️ 未设置密码，任何人都可以上传',
      _next_actions: ['✅ 上传链接已创建', '可通过 list_shares(isUploadLink=true) 查看', '可通过 revoke_share 撤销'],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

function generateSecureToken(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values)
    .map((v) => chars[v % chars.length])
    .join('');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function getTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return '已过期';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天${hours % 24}小时`;
  return `${hours}小时${Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))}分钟`;
}
