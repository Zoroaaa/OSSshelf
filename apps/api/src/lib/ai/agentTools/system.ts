/**
 * system.ts — 系统信息与帮助工具
 *
 * 功能:
 * - 系统状态检查
 * - 功能说明与使用指南
 * - 版本信息
 * - 常见问题解答
 */

import { eq, and, isNull, desc, sql, like, or, count } from 'drizzle-orm';
import { getDb, files, apiKeys, webhooks, auditLogs } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';
import { formatBytes } from '../utils';

export const definitions: ToolDefinition[] = [
  // 1. get_system_status — 系统状态
  {
    type: 'function',
    function: {
      name: 'get_system_status',
      description: `【系统状态】查看系统运行状态和健康情况。
适用场景：
• "系统正常吗"
• "服务状态如何"
• "有什么问题吗"

显示：存储连接、数据库状态、AI服务等`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      examples: [
        { user_query: '系统正常吗', tool_call: {} },
        { user_query: '服务状态如何', tool_call: {} },
      ],
    },
  },

  // 2. get_help — 使用帮助
  {
    type: 'function',
    function: {
      name: 'get_help',
      description: `【使用指南】获取功能说明和操作指引。
适用场景：
• "这个怎么用"
• "有哪些功能"
• "帮我看看教程"

提供：功能列表、最佳实践、常见操作示例`,
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: '具体主题（可选，如"搜索"、"分享"、"上传"）' },
        },
      },
      examples: [
        { user_query: '搜索功能怎么用', tool_call: { topic: '搜索' } },
        { user_query: '有哪些功能', tool_call: {} },
        { user_query: '分享操作的教程', tool_call: { topic: '分享' } },
      ],
    },
  },

  // 3. get_version_info — 版本信息
  {
    type: 'function',
    function: {
      name: 'get_version_info',
      description: `【版本信息】查看当前系统的版本号和更新日志。
适用场景：
• "这是什么版本"
• "最近更新了什么"
• "有新功能吗"`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      examples: [
        { user_query: '当前版本是什么', tool_call: {} },
        { user_query: '最近更新了什么功能', tool_call: {} },
      ],
    },
  },

  // 4. get_faq — 常见问题
  {
    type: 'function',
    function: {
      name: 'get_faq',
      description: `【常见问题】查看FAQ和解决方案。
适用场景：
• "遇到问题了怎么办"
• "为什么XX不行"
• "报错怎么解决"

涵盖：上传失败、搜索无结果、权限问题等常见场景`,
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '问题分类（可选）' },
        },
      },
      examples: [
        { user_query: '上传失败怎么办', tool_call: { category: '上传' } },
        { user_query: '搜索不到结果', tool_call: { category: '搜索' } },
        { user_query: '常见问题', tool_call: {} },
      ],
    },
  },

  // 5. get_user_profile — 用户信息
  {
    type: 'function',
    function: {
      name: 'get_user_profile',
      description: `【我的信息】查看当前用户的个人资料和设置。
适用场景：
• "我的账户信息"
• "查看个人设置"`,
      parameters: {
        type: 'object',
        properties: {},
      },
      examples: [
        { user_query: '我的账户信息', tool_call: {} },
        { user_query: '查看个人设置', tool_call: {} },
      ],
    },
  },

  // 6. list_api_keys — API密钥列表
  {
    type: 'function',
    function: {
      name: 'list_api_keys',
      description: `【API密钥】查看所有API密钥。
适用场景：
• "我有哪些API密钥"
• "管理访问令牌"`,
      parameters: {
        type: 'object',
        properties: {
          includeExpired: { type: 'boolean', description: '是否包含已过期的（默认false）' },
        },
      },
      examples: [
        { user_query: '我有哪些API密钥', tool_call: {} },
        { user_query: '包括过期的也显示', tool_call: { includeExpired: true } },
      ],
    },
  },

  // 7. create_api_key — 创建API密钥
  {
    type: 'function',
    function: {
      name: 'create_api_key',
      description: `【创建密钥】生成新的API访问密钥。
⚠️ 密钥创建后只显示一次，请妥善保管`,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '密钥名称/备注' },
          expiresInDays: { type: 'number', description: '有效期（天），不传则永不过期' },
          permissions: { type: 'array', items: { type: 'string' }, description: '权限列表' },
        },
        required: ['name'],
      },
      examples: [
        { user_query: '创建一个新的API密钥', tool_call: { name: '我的应用' } },
        { user_query: '生成30天有效的密钥', tool_call: { name: '临时访问', expiresInDays: 30, permissions: ['read'] } },
      ],
    },
  },

  // 8. revoke_api_key — 撤销API密钥
  {
    type: 'function',
    function: {
      name: 'revoke_api_key',
      description: `【撤销密钥】立即作废某个API密钥。
⚠️ 此操作不可恢复`,
      parameters: {
        type: 'object',
        properties: {
          keyId: { type: 'string', description: '要撤销的密钥ID' },
        },
        required: ['keyId'],
      },
      examples: [
        { user_query: '撤销这个API密钥', tool_call: { keyId: '<key_id>' } },
        { user_query: '删除不再使用的密钥', tool_call: { keyId: '<old_key_id>' } },
      ],
    },
  },

  // 9. list_webhooks — Webhook列表
  {
    type: 'function',
    function: {
      name: 'list_webhooks',
      description: `【Webhook列表】查看所有配置的Webhook。
适用场景：
• "我配置了哪些回调"
• "管理事件通知"`,
      parameters: {
        type: 'object',
        properties: {},
      },
      examples: [
        { user_query: '我配置了哪些回调', tool_call: {} },
        { user_query: '显示所有Webhook', tool_call: {} },
      ],
    },
  },

  // 10. create_webhook — 创建Webhook
  {
    type: 'function',
    function: {
      name: 'create_webhook',
      description: `【创建Webhook】配置事件回调URL。
适用场景：
• "文件上传后通知我的服务"
• "配置自动化流程"`,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '回调URL' },
          events: { type: 'array', items: { type: 'string' }, description: '订阅的事件类型' },
          secret: { type: 'string', description: '签名密钥（可选）' },
        },
        required: ['url', 'events'],
      },
      examples: [
        {
          user_query: '文件上传后通知我的服务',
          tool_call: { url: 'https://myapp.com/webhook', events: ['file.uploaded'] },
        },
        {
          user_query: '配置自动化流程',
          tool_call: {
            url: 'https://api.example.com/handler',
            events: ['file.uploaded', 'file.deleted'],
            secret: 'mysecret',
          },
        },
      ],
    },
  },

  // 11. get_audit_logs — 审计日志
  {
    type: 'function',
    function: {
      name: 'get_audit_logs',
      description: `【操作日志】查看账户操作历史记录。
适用场景：
• "谁访问了我的文件"
• "最近有什么操作"
• "安全审计"`,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '筛选操作类型（可选）' },
          startDate: { type: 'string', description: '开始日期（可选）' },
          endDate: { type: 'string', description: '结束日期（可选）' },
          limit: { type: 'number', description: '返回数量（默认50）' },
        },
      },
      examples: [
        { user_query: '最近有什么操作', tool_call: {} },
        { user_query: '查看登录记录', tool_call: { action: 'login', limit: 20 } },
        { user_query: '本月的安全审计日志', tool_call: { startDate: '2026-04-01', endDate: '2026-04-16', limit: 100 } },
      ],
    },
  },
];

export class SystemTools {
  static async executeGetSystemStatus(env: Env, userId: string, _args: Record<string, unknown>) {
    const db = getDb(env.DB);

    const [storageStats, recentActivity] = await Promise.all([
      db
        .select({
          totalSize: sql<number>`COALESCE(SUM(${files.size}), 0)`,
          fileCount: count(),
        })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isFolder, false)))
        .get(),
      db.select().from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.createdAt)).limit(5).all(),
    ]);

    return {
      status: 'healthy',
      services: {
        database: 'connected',
        storage: env.FILES ? 'available' : 'unavailable',
        ai: env.AI ? 'available' : 'unavailable',
      },
      userStats: {
        storageUsed: formatBytes(storageStats?.totalSize || 0),
        fileCount: storageStats?.fileCount || 0,
      },
      recentActivity: recentActivity.slice(0, 3).map((l) => ({
        action: l.action,
        createdAt: l.createdAt,
      })),
    };
  }

  static async executeGetHelp(_env: Env, _userId: string, args: Record<string, unknown>) {
    const topic = args.topic as string | undefined;

    const helpTopics: Record<string, { description: string; commands: string[] }> = {
      search: {
        description: '搜索文件和内容',
        commands: ['"找一下XX文件"', '"搜索包含XX的文档"', '"最近的照片"'],
      },
      share: {
        description: '分享文件和文件夹',
        commands: ['"分享这个文件"', '"创建下载链接"', '"查看我的分享"'],
      },
      organize: {
        description: '整理和管理文件',
        commands: ['"给这个文件打标签"', '"移动到XX文件夹"', '"重命名为XX"'],
      },
    };

    if (topic && helpTopics[topic]) {
      return {
        topic,
        ...helpTopics[topic],
        tip: '直接用自然语言告诉我你想做什么即可',
      };
    }

    return {
      message: '我是你的文件管理助手，可以帮你：',
      capabilities: [
        '🔍 搜索和查找文件',
        '📂 浏览文件夹',
        '🏷️ 管理标签',
        '🔗 创建分享链接',
        '📝 添加笔记备注',
        '📊 查看存储统计',
      ],
      tip: '直接用自然语言描述你的需求，我会理解并执行',
      availableTopics: Object.keys(helpTopics),
    };
  }

  static async executeGetVersionInfo(_env: Env, _userId: string, _args: Record<string, unknown>) {
    return {
      version: '1.0.0',
      releaseDate: '2025-01-01',
      features: ['AI智能助手', '向量搜索', '多存储桶支持', '版本管理'],
      changelog: [{ version: '1.0.0', date: '2025-01-01', changes: '初始版本发布' }],
    };
  }

  static async executeGetFaq(_env: Env, _userId: string, args: Record<string, unknown>) {
    const category = args.category as string | undefined;

    const faqs: Record<string, Array<{ question: string; answer: string }>> = {
      upload: [
        { question: '上传失败怎么办？', answer: '检查文件大小是否超过限制，或尝试刷新页面后重试' },
        { question: '支持哪些文件类型？', answer: '支持所有常见文件类型，包括图片、文档、视频、压缩包等' },
      ],
      search: [
        { question: '搜索不到文件？', answer: '尝试使用更通用的关键词，或检查文件是否被删除' },
        { question: '如何搜索文件内容？', answer: '直接描述内容即可，系统会自动搜索文件名、标签和AI摘要' },
      ],
      share: [
        { question: '分享链接无效？', answer: '检查链接是否过期，或是否设置了访问密码' },
        { question: '如何取消分享？', answer: '说"取消分享"或"撤销链接"即可' },
      ],
    };

    if (category && faqs[category]) {
      return { category, faqs: faqs[category] };
    }

    return {
      categories: Object.keys(faqs),
      tip: '可以指定分类查看更多问题，如"上传问题"、"搜索问题"',
    };
  }

  static async executeGetUserProfile(env: Env, userId: string, _args: Record<string, unknown>) {
    const db = getDb(env.DB);

    const [stats, starredCount] = await Promise.all([
      db
        .select({
          totalSize: (sql as any)`COALESCE(SUM(${files.size}), 0)`.mapWith(Number),
          fileCount: (sql as any)`COUNT(*)`.mapWith(Number),
          folderCount: (sql as any)`COUNT(*) FILTER (WHERE ${files.isFolder} = TRUE)`.mapWith(Number),
        })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
        .get(),
      db
        .select({ cnt: (sql as any)`COUNT(*)`.mapWith(Number) })
        .from(files)
        .where(and(eq(files.userId, userId), isNull(files.deletedAt), eq(files.isStarred, true)))
        .get(),
    ]);

    return {
      userId,
      storage: {
        usedBytes: stats?.totalSize || 0,
        usedFormatted: formatBytes(stats?.totalSize || 0),
      },
      files: {
        total: stats?.fileCount || 0,
        folders: stats?.folderCount || 0,
        starred: starredCount?.cnt || 0,
      },
      features: {
        aiEnabled: true,
        vectorSearchEnabled: true,
        sharingEnabled: true,
        webhooksEnabled: true,
      },
    };
  }

  static async executeListApiKeys(env: Env, userId: string, args: Record<string, unknown>) {
    const includeExpired = args.includeExpired === true;
    const limit = Math.min((args.limit as number) || 20, 50);
    const db = getDb(env.DB);

    try {
      const conditions: any[] = [eq(apiKeys.userId, userId)];
      if (!includeExpired) {
        conditions.push(or(isNull(apiKeys.expiresAt), (sql as any)`${apiKeys.expiresAt} > NOW()`));
      }

      const keys = await db
        .select()
        .from(apiKeys)
        .where(and(...conditions))
        .orderBy(desc(apiKeys.createdAt))
        .limit(limit)
        .all();

      return {
        total: keys.length,
        keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          scopes: k.scopes ? JSON.parse(k.scopes as string) : [],
          lastUsedAt: k.lastUsedAt,
          expiresAt: k.expiresAt,
          isActive: k.isActive !== false,
          createdAt: k.createdAt,
        })),
      };
    } catch (error) {
      return { total: 0, keys: [], note: 'API密钥功能可能未启用' };
    }
  }

  static async executeCreateApiKey(env: Env, userId: string, args: Record<string, unknown>) {
    const name = args.name as string;
    const scopes = (args.scopes as string[]) || ['read'];
    const expiresInDays = args.expiresInDays as number | undefined;
    const db = getDb(env.DB);

    const rawKey = `oss_${crypto.randomUUID().replace(/-/g, '')}`;
    const keyPrefix = `${rawKey.slice(0, 8)}...${rawKey.slice(-4)}`;
    const hashedKey = await hashApiKey(rawKey);
    const now = new Date().toISOString();

    const keyId = crypto.randomUUID();
    await db.insert(apiKeys).values({
      id: keyId,
      userId,
      name,
      keyHash: hashedKey,
      keyPrefix,
      scopes: JSON.stringify(scopes),
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null,
      isActive: true,
      createdAt: now,
    });

    logger.info('AgentTool', 'Created API key via agent tool', { keyId, name, scopes });

    return {
      success: true,
      message: 'API密钥已创建（请立即保存，之后无法查看完整值）',
      keyId,
      name,
      key: rawKey,
      scopes,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null,
      warning: '⚠️ 请妥善保管此密钥，页面刷新后无法再次查看完整值',
    };
  }

  static async executeRevokeApiKey(env: Env, userId: string, args: Record<string, unknown>) {
    const keyId = args.keyId as string;
    const reason = args.reason as string | undefined;
    const db = getDb(env.DB);

    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .run();

    logger.info('AgentTool', 'Revoked API key', { keyId, reason: reason || '(none)' });

    return {
      success: true,
      message: 'API密钥已撤销',
      keyId,
      revokedAt: new Date().toISOString(),
    };
  }

  static async executeListWebhooks(env: Env, userId: string, args: Record<string, unknown>) {
    const includeDisabled = args.includeDisabled === true;
    const limit = Math.min((args.limit as number) || 20, 50);
    const db = getDb(env.DB);

    try {
      const conditions: any[] = [eq(webhooks.userId, userId)];
      if (!includeDisabled) {
        conditions.push(eq(webhooks.isActive, true));
      }

      const hooks = await db
        .select()
        .from(webhooks)
        .where(and(...conditions))
        .orderBy(desc(webhooks.createdAt))
        .limit(limit)
        .all();

      return {
        total: hooks.length,
        webhooks: (hooks || []).map((h) => ({
          id: h.id,
          url: maskUrl(h.url),
          events: h.events ? JSON.parse(h.events as string) : [],
          isActive: h.isActive,
          lastStatus: h.lastStatus,
          createdAt: h.createdAt,
        })),
      };
    } catch (error) {
      return { total: 0, webhooks: [], note: 'Webhook功能可能未启用' };
    }
  }

  static async executeCreateWebhook(env: Env, userId: string, args: Record<string, unknown>) {
    const url = args.url as string;
    const events = (args.events as string[]) || [];
    const secret = (args.secret as string) || crypto.randomUUID();
    const db = getDb(env.DB);

    const webhookId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(webhooks).values({
      id: webhookId,
      userId,
      url,
      secret,
      events: JSON.stringify(events),
      isActive: true,
      createdAt: now,
    });

    logger.info('AgentTool', 'Created webhook via agent tool', { webhookId, url, eventCount: events.length });

    return {
      success: true,
      message: 'Webhook已创建',
      webhookId,
      url: maskUrl(url),
      events,
      hasSecret: !!secret,
    };
  }

  static async executeGetAuditLogs(env: Env, userId: string, args: Record<string, unknown>) {
    const actionType = args.actionType as string | undefined;
    const limit = Math.min((args.limit as number) || 30, 100);
    const sinceHours = Math.min((args.sinceHours as number) || 24, 168); // 最大7天
    const db = getDb(env.DB);

    const sinceDate = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

    try {
      const conditions: any[] = [eq(auditLogs.userId, userId), (sql as any)`${auditLogs.createdAt} >= ${sinceDate}`];
      if (actionType) {
        conditions.push(like(auditLogs.action, `%${actionType}%`));
      }

      const logs = await db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .all();

      return {
        total: logs.length,
        range: { sinceHours, since: sinceDate },
        logs: (logs || []).map((l) => ({
          id: l.id,
          action: l.action,
          resourceType: l.resourceType,
          resourceId: l.resourceId,
          details: l.details ? JSON.parse(l.details as string) : null,
          status: l.status || 'success',
          errorMessage: l.errorMessage || null,
          ipAddress: l.ipAddress ? maskIp(l.ipAddress) : null,
          userAgent: l.userAgent ? maskUserAgent(l.userAgent) : null,
          createdAt: l.createdAt,
        })),
      };
    } catch (error) {
      return { total: 0, logs: [], range: { sinceHours }, note: '审计日志功能可能未启用' };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}

function maskIp(ip: string): string {
  const parts = ip.split('.');
  if (parts.length === 4) return parts[0] + '.' + parts[1] + '.***.***';
  return ip.replace(/\d{1,3}$/, '***');
}

function maskUserAgent(ua: string): string {
  if (ua.length <= 80) return ua;
  return ua.slice(0, 80) + '...';
}
