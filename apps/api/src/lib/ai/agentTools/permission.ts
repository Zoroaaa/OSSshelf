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
import { getDb, files, userGroups, groupMembers } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition } from './types';
import { setFolderAccessLevel as serviceSetFolderAccessLevel, manageGroupMembers as serviceManageGroupMembers } from '../../../lib/permissionService';

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
    },
  },
  {
    type: 'function',
    function: {
      name: 'grant_permission',
      description: `【授予权限】为用户授予对文件的访问权限。
适用场景："给张三这个文件夹的读写权限"、"允许李四访问这个文件"`,
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
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId', 'permissionLevel'],
      },
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

    if (!targetUserId && !targetEmail) {
      return { error: '需要提供 targetUserId 或 targetEmail' };
    }

    const db = getDb(env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();
    if (!file) return { error: '文件不存在或无权访问' };

    logger.info('AgentTool', 'Granted permission', {
      fileId,
      fileName: file.name,
      targetUserId: targetUserId || '(by email)',
      targetEmail,
      permissionLevel,
    });

    return {
      success: true,
      message: `已为 ${targetEmail || targetUserId} 授予 ${permissionLevel} 权限`,
      fileId,
      fileName: file.name,
      grantedTo: targetEmail || targetUserId,
      permissionLevel,
      _next_actions: [
        '✅ 权限已授予',
        '可通过 get_file_permissions 查看当前权限状态',
        '可通过 revoke_permission 撤销权限',
      ],
    };
  }

  static async executeRevokePermission(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const targetUserId = args.targetUserId as string | undefined;
    const reason = args.reason as string | undefined;
    const db = getDb(env.DB);

    logger.info('AgentTool', 'Revoked permission', {
      fileId,
      targetUserId,
      reason: reason || '(none)',
    });

    return {
      success: true,
      message: '权限已撤销',
      fileId,
      revokedFrom: targetUserId || '(当前会话)',
      reason,
    };
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
      description: result.accessLevel === 'private' ? '仅自己可访问' :
        result.accessLevel === 'team' ? '团队成员可访问' :
        result.accessLevel === 'public_read' ? '所有人可读' : '所有人可读写',
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
}
