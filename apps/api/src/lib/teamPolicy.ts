/**
 * teamPolicy.ts
 * 团队角色 → 文件权限的唯一映射入口。
 *
 * 产品约定：
 *   owner        全部权限（admin）
 *   admin        读写 + 管理（admin）
 *   member       读写（write）
 *   guest/viewer 只读（read）
 *
 * 所有"团队角色能做什么"的判断都必须经过本模块，避免各路由各写一份。
 */

import { and, eq } from 'drizzle-orm';
import { teamMembers } from '../db';
import type { DrizzleDb } from '../db';
import type { PermissionLevel } from './permissionResolver';

export type TeamRole = 'owner' | 'admin' | 'member' | 'guest' | 'viewer';

const ROLE_PERMISSION: Record<string, PermissionLevel> = {
  owner: 'admin',
  admin: 'admin',
  member: 'write',
  guest: 'read',
  viewer: 'read',
};

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

/** 角色对应的权限上限；未知角色按只读处理（失败关闭） */
export function teamRoleToPermission(role: string | null | undefined): PermissionLevel {
  if (!role) return 'read';
  return ROLE_PERMISSION[role] ?? 'read';
}

export function permissionRank(permission: PermissionLevel): number {
  return PERMISSION_RANK[permission] ?? 0;
}

/** 把授权记录上的权限收敛到角色上限 */
export function capPermissionByTeamRole(permission: PermissionLevel, role: string | null | undefined): PermissionLevel {
  const cap = teamRoleToPermission(role);
  return permissionRank(permission) <= permissionRank(cap) ? permission : cap;
}

/** 角色是否满足所需权限 */
export function teamRoleAllows(role: string | null | undefined, required: PermissionLevel): boolean {
  return permissionRank(teamRoleToPermission(role)) >= permissionRank(required);
}

export interface TeamMembership {
  teamId: string;
  userId: string;
  role: string;
}

/** 读取团队成员关系（不存在返回 null） */
export async function getTeamMembership(db: DrizzleDb, teamId: string, userId: string): Promise<TeamMembership | null> {
  const membership = await db
    .select({ teamId: teamMembers.teamId, userId: teamMembers.userId, role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .get();

  return membership ?? null;
}
