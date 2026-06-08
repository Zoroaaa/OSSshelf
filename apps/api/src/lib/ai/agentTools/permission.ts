/**
 * permission.ts — ⭐ 权限管理工具（增强版）
 *
 * 功能:
 * - 查看文件/文件夹权限
 * - 授予访问权限
 * - 撤销访问权限
 * - 设置文件夹访问级别
 * - 列出用户组
 * - 管理组成员
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { getDb, files, filePermissions, userGroups, groupMembers } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';
import {
  setFolderAccessLevel as serviceSetFolderAccessLevel,
  manageGroupMembers as serviceManageGroupMembers,
  listExpiredPermissions as serviceListExpiredPermissions,
} from '../../../lib/permissionService';

export const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_file_permissions',
      description: `【查看权限】查看文件或文件夹的权限设置和共享状态。
适用场景："这个文件夹谁能访问""看看文件的共享情况"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件或文件夹 ID' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '这个文件夹谁能访问', tool_call: { fileId: '<folder_id>' } },
        { user_query: '看看文件的共享情况', tool_call: { fileId: '<doc_id>' } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'grant_permission',
      description: `【授予权限】为用户授予对文件的访问权限。
适用场景："给张三这个文件夹的读写权限"、"允许李四访问这个文件"、"把设计文件夹给小明只读，30天后过期"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件/文件夹 ID' },
          targetUserId: { type: 'string', description: '被授权的用户ID' },
          targetEmail: { type: 'string', description: '被授权的邮箱（备选）' },
          permissionLevel: {
            type: 'string',
            enum: ['read', 'write', 'admin'],
            description: '权限级别：read=只读, write=读写, admin=管理员',
          },
          /** N天后过期（自然语言表达，如"30天后过期"） */
          expiresInDays: { type: 'number', description: 'N天后过期（可选，不传则永不过期）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId', 'permissionLevel'],
      },
      examples: [
        {
          user_query: '给张三读写权限',
          tool_call: {
            fileId: '<folder_id>',
            targetUserId: '<zhangsan_id>',
            permissionLevel: 'write',
            _confirmed: true,
          },
        },
        {
          user_query: '允许李四只读访问30天',
          tool_call: { fileId: '<doc_id>', permissionLevel: 'read', expiresInDays: 30, _confirmed: true },
        },
      ],
    },
  },
  {
    type: 'function',
    function: {
      name: 'revoke_permission',
      description: `【撤销权限】撤销用户的访问权限。
适用场景："撤销李四的访问权限"、"取消某人的写入权限"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件/文件夹 ID' },
          targetUserId: { type: 'string', description: '要撤销权限的用户ID' },
          reason: { type: 'string', description: '撤销原因（用于审计）' },
          _confirmed: { type: 'boolean', description: '用户确认（必须为true）' },
        },
        required: ['fileId', '_confirmed'],
      },
      examples: [
        {
          user_query: '撤销李四的访问权限',
          tool_call: { fileId: '<folder_id>', targetUserId: '<lisi_id>', _confirmed: true },
        },
        { user_query: '取消某人的写入权限', tool_call: { fileId: '<doc_id>', reason: '权限调整', _confirmed: true } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'set_folder_access_level',
      description: `【设置访问级别】设置文件夹的整体访问控制级别。
适用场景："设为仅团队成员可访问"、"改为公开可读"`,
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: '文件夹 ID' },
          accessLevel: {
            type: 'string',
            enum: ['private', 'team', 'public_read', 'public_write'],
            description: 'private=仅自己, team=团队成员, public_read=公开可读, public_write=公开读写',
          },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['folderId', 'accessLevel', '_confirmed'],
      },
      examples: [
        {
          user_query: '设为仅团队成员可访问',
          tool_call: { folderId: '<folder_id>', accessLevel: 'team', _confirmed: true },
        },
        {
          user_query: '改为公开可读',
          tool_call: { folderId: '<public_id>', accessLevel: 'public_read', _confirmed: true },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_user_groups',
      description: `【列出用户组】列出所有用户组及其成员信息。
适用场景："看看有哪些组"、"开发组有哪些人"`,
      parameters: {
        type: 'object',
        properties: {
          includeMembers: { type: 'boolean', description: '是否包含组成员详情，默认 true' },
          limit: { type: 'number', description: '返回数量，默认 20' },
        },
        required: [],
      },
      examples: [
        { user_query: '看看有哪些用户组', tool_call: {} },
        { user_query: '开发组有哪些人', tool_call: { includeMembers: true, limit: 10 } },
      ],
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_group_members',
      description: `【管理组成员】添加或移除用户组成员。
适用场景："把王五加到开发组"、"从测试组移除赵六"`,
      parameters: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: '用户组 ID' },
          action: {
            type: 'string',
            enum: ['add', 'remove', 'change_role'],
            description: '操作类型：add=添加, remove=移除, change_role=更改角色',
          },
          userId: { type: 'string', description: '目标用户 ID' },
          role: {
            type: 'string',
            enum: ['owner', 'admin', 'member', 'viewer'],
            description: '角色（change_role时必须）',
          },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['groupId', 'action', 'userId'],
      },
      examples: [
        {
          user_query: '把王五加到开发组',
          tool_call: { groupId: '<dev_group_id>', action: 'add', userId: '<wangwu_id>', _confirmed: true },
        },
        {
          user_query: '从测试组移除赵六',
          tool_call: { groupId: '<test_group_id>', action: 'remove', userId: '<zhaoliu_id>', _confirmed: true },
        },
        {
          user_query: '提升为管理员',
          tool_call: {
            groupId: '<team_id>',
            action: 'change_role',
            userId: '<user_id>',
            role: 'admin',
            _confirmed: true,
          },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_expired_permissions',
      description: `【查询过期授权】查看已过期或即将过期的文件授权。
适用场景："哪些授权过期了"、"快过期的权限"、"清理过期授权"、"检查即将到期的分享"`,
      parameters: {
        type: 'object',
        properties: {
          includeExpiringSoon: { type: 'boolean', description: '是否包含即将过期的授权（默认false）' },
          withinDays: { type: 'number', description: '即将过期的天数阈值（默认7天）' },
        },
        required: [],
      },
      examples: [
        { user_query: '哪些授权过期了', tool_call: {} },
        { user_query: '7天内要过期的权限', tool_call: { includeExpiringSoon: true, withinDays: 7 } },
      ],
    },
  },
];

export class PermissionTools {
  static async executeGetFilePermissions(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    return {
      fileId,
      fileName: file.name,
      isFolder: file.isFolder,
      owner: userId,
      accessInfo: {
        allowedMimeTypes: file.allowedMimeTypes,
        path: file.path,
        createdAt: file.createdAt,
      },
      sharing: {
        hasDirectLink: !!file.directLinkToken,
        directLinkExpiresAt: file.directLinkExpiresAt,
      },
      _next_actions: [
        '如需分享此文件，可调用 create_share 或 create_direct_link',
        '如需授权给其他用户，可调用 grant_permission',
      ],
    };
  }

  static async executeGrantPermission(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const targetUserId = args.targetUserId as string | undefined;
    const targetEmail = args.targetEmail as string | undefined;
    const permissionLevel = args.permissionLevel as string;
    const expiresInDays = args.expiresInDays as number | undefined;

    if (!targetUserId && !targetEmail) {
      return { error: '需要提供 targetUserId 或 targetEmail' };
    }

    let expiresAt: string | undefined;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
    }

    const db = getDb(env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    try {
      const now = new Date().toISOString();
      const finalTargetUserId = targetUserId || crypto.randomUUID();

      const existing = await db
        .select()
        .from(filePermissions)
        .where(and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, finalTargetUserId)))
        .get();

      if (existing) {
        await db
          .update(filePermissions)
          .set({
            permission: permissionLevel as 'read' | 'write' | 'admin',
            expiresAt: expiresAt || null,
            updatedAt: now,
          })
          .where(eq(filePermissions.id, existing.id));
      } else {
        await db.insert(filePermissions).values({
          id: crypto.randomUUID(),
          fileId,
          userId: finalTargetUserId,
          permission: permissionLevel as 'read' | 'write' | 'admin',
          grantedBy: userId,
          subjectType: 'user',
          expiresAt: expiresAt || null,
          createdAt: now,
          updatedAt: now,
        });
      }

      logger.info('AgentTool', 'Granted permission (completed)', {
        fileId,
        fileName: file.name,
        targetUserId: finalTargetUserId,
        targetEmail,
        permissionLevel,
        expiresInDays,
        expiresAt,
      });

      return {
        success: true,
        message: `已为 ${targetEmail || finalTargetUserId} 授予 ${permissionLevel} 权限${expiresAt ? `，${expiresInDays}天后过期` : ''}`,
        fileId,
        fileName: file.name,
        grantedTo: targetEmail || finalTargetUserId,
        permissionLevel,
        ...(expiresAt && { expiresAt, expiresInDays }),
        _next_actions: [
          '✅ 权限已授予',
          '可通过 get_file_permissions 查看当前权限状态',
          '可通过 revoke_permission 撤销权限',
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('AgentTool', 'Failed to grant permission', { fileId, targetUserId, targetEmail }, error);
      return {
        error: `权限授予失败: ${errorMsg}`,
        code: 'GRANT_PERMISSION_FAILED',
        hint: '请检查目标用户是否存在，或联系管理员',
      };
    }
  }

  static async executeRevokePermission(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const targetUserId = args.targetUserId as string | undefined;
    const reason = args.reason as string | undefined;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    try {
      let whereClause;

      if (targetUserId) {
        whereClause = and(eq(filePermissions.fileId, fileId), eq(filePermissions.userId, targetUserId));
      } else {
        whereClause = eq(filePermissions.fileId, fileId);
      }

      const deleted = await db.delete(filePermissions).where(whereClause);

      logger.info('AgentTool', 'Revoked permission (completed)', {
        fileId,
        fileName: file.name,
        targetUserId: targetUserId || '(all)',
        reason: reason || '(none)',
        deletedCount: typeof deleted === 'number' ? deleted : 0,
      });

      return {
        success: true,
        message: targetUserId ? `已撤销 ${targetUserId} 的权限` : '已撤销该文件的所有共享权限',
        fileId,
        revokedFrom: targetUserId || '(所有用户)',
        reason,
        _next_actions: [
          '✅ 权限已撤销',
          '可通过 get_file_permissions 查看当前权限状态',
          '如需重新授权，可使用 grant_permission',
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('AgentTool', 'Failed to revoke permission', { fileId, targetUserId }, error);
      return {
        error: `权限撤销失败: ${errorMsg}`,
        code: 'REVOKE_PERMISSION_FAILED',
        hint: '请检查权限记录是否存在，或联系管理员',
      };
    }
  }

  static async executeSetFolderAccessLevel(env: Env, userId: string, args: Record<string, unknown>) {
    const folderId = args.folderId as string;
    const accessLevel = args.accessLevel as string;

    const result = await serviceSetFolderAccessLevel(env, userId, folderId, {
      accessLevel: accessLevel as any,
    });
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: result.message,
      folderId,
      folderName: result.folderName,
      accessLevel: result.accessLevel,
      description:
        result.accessLevel === 'private'
          ? '仅自己可访问'
          : result.accessLevel === 'team'
            ? '团队成员可访问'
            : result.accessLevel === 'public_read'
              ? '所有人可读'
              : '所有人可读写',
    };
  }

  static async executeListUserGroups(env: Env, userId: string, args: Record<string, unknown>) {
    const includeMembers = args.includeMembers !== false;
    const limit = Math.min((args.limit as number) || 20, 50);
    const db = getDb(env.DB);

    try {
      const groups = await db
        .select()
        .from(userGroups)
        .where(eq(userGroups.ownerId, userId))
        .orderBy(desc(userGroups.createdAt))
        .limit(limit)
        .all();

      let result: any[] = [];

      if (includeMembers && groups.length > 0) {
        for (const group of groups) {
          const members = await db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id)).all();

          result.push({
            id: group.id,
            name: group.name,
            description: group.description,
            memberCount: members.length,
            members: members.map((m) => ({
              userId: m.userId,
              role: m.role,
              joinedAt: m.createdAt,
            })),
            createdAt: group.createdAt,
          });
        }
      } else {
        result = groups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          createdAt: g.createdAt,
        }));
      }

      return {
        total: result.length,
        groups: result,
      };
    } catch (error) {
      return {
        total: 0,
        groups: [],
        note: '用户组功能可能未启用或表结构不完整',
      };
    }
  }

  static async executeManageGroupMembers(env: Env, userId: string, args: Record<string, unknown>) {
    const groupId = args.groupId as string;
    const action = args.action as string;
    const targetUserId = args.userId as string;
    const role = args.role as string | undefined;

    const result = await serviceManageGroupMembers(env, userId, groupId, {
      action: action as any,
      targetUserId,
      role,
    });

    if ('success' in result && result.success === false) return { error: (result as { error: string }).error };

    return result;
  }

  static async executeListExpiredPermissions(env: Env, userId: string, args: Record<string, unknown>) {
    const includeExpiringSoon = (args.includeExpiringSoon as boolean) || false;
    const withinDays = (args.withinDays as number) || 7;

    try {
      const result = await serviceListExpiredPermissions(env, userId, {
        includeExpiringSoon,
        withinDays,
      });

      return {
        ...result,
        _next_actions: [
          `找到 ${result.expired.length} 个已过期授权${includeExpiringSoon ? `，${result.expiringSoon?.length || 0} 个即将过期` : ''}`,
          '可调用 revoke_permission 批量撤销过期授权',
          '可调用 grant_permission 重新授权',
        ],
      };
    } catch (error) {
      logger.error(
        'AgentTool',
        '查询过期授权失败',
        { error: error instanceof Error ? error.message : error },
        error as Error
      );
      return {
        expired: [],
        expiringSoon: includeExpiringSoon ? [] : undefined,
        scannedAt: new Date().toISOString(),
        error: '查询失败：' + (error instanceof Error ? error.message : '未知错误'),
        _next_actions: ['请检查数据库连接或表结构'],
      };
    }
  }
}
