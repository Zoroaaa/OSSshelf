/**
 * teamActivityService.ts — 团队活动流服务
 *
 * 功能:
 * - 记录团队内事件（成员变更、文件操作等）
 * - 查询团队活动时间线
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb, teamActivities, users } from '../db';
import type { DrizzleDb } from '../db';
import type { Env } from '../types/env';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

export type TeamAction =
  | 'member_joined'
  | 'member_left'
  | 'role_changed'
  | 'file_mounted'
  | 'file_unmounted'
  | 'file_uploaded'
  | 'file_deleted'
  | 'comment_added'
  | 'team_created'
  | 'team_settings_updated'
  | 'invite_sent'
  | 'invite_accepted';

export interface CreateActivityInput {
  teamId: string;
  userId: string;
  action: TeamAction;
  resourceType?: 'file' | 'member' | 'team' | 'invite';
  resourceId?: string;
  details?: Record<string, unknown>;
}

export interface ActivityItem {
  id: string;
  userId: string;
  userName: string | null;
  action: TeamAction;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 记录活动
// ─────────────────────────────────────────────────────────────────────────────

export async function recordActivity(db: DrizzleDb, input: CreateActivityInput): Promise<void> {
  const { teamId, userId, action, resourceType, resourceId, details } = input;

  await db.insert(teamActivities).values({
    id: crypto.randomUUID(),
    teamId,
    userId,
    action,
    resourceType: resourceType ?? null,
    resourceId: resourceId ?? null,
    details: details ? JSON.stringify(details) : null,
    createdAt: new Date().toISOString(),
  });
}

/** 带环境参数的便捷方法 */
export async function recordActivityWithEnv(env: Env, input: CreateActivityInput): Promise<void> {
  const db = getDb(env.DB);
  await recordActivity(db, input);
}

// ─────────────────────────────────────────────────────────────────────────────
// 查询活动时间线
// ─────────────────────────────────────────────────────────────────────────────

export interface ListActivitiesInput {
  teamId: string;
  limit?: number;
  offset?: number;
  actions?: TeamAction[];
}

export interface ActivityListResult {
  items: ActivityItem[];
  total: number;
}

export async function listTeamActivities(db: DrizzleDb, input: ListActivitiesInput): Promise<ActivityListResult> {
  const { teamId, limit = 30, offset = 0, actions } = input;

  const conditions = [eq(teamActivities.teamId, teamId)];
  if (actions && actions.length > 0) {
    conditions.push(
      sql`${teamActivities.action} IN (${sql.join(
        actions.map((a) => sql`${a}`),
        sql`, `
      )})`
    );
  }

  const items = await db
    .select({
      id: teamActivities.id,
      userId: teamActivities.userId,
      userName: users.name,
      action: teamActivities.action,
      resourceType: teamActivities.resourceType,
      resourceId: teamActivities.resourceId,
      details: teamActivities.details,
      createdAt: teamActivities.createdAt,
    })
    .from(teamActivities)
    .leftJoin(users, eq(teamActivities.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(teamActivities.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  const parsedItems: ActivityItem[] = items.map((item) => ({
    ...item,
    action: item.action as TeamAction,
    details: item.details ? (JSON.parse(item.details) as Record<string, unknown>) : null,
  }));

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(teamActivities)
    .where(and(...conditions))
    .get();

  return {
    items: parsedItems,
    total: Number(countResult?.count ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action → 中文描述映射
// ─────────────────────────────────────────────────────────────────────────────

export const ACTION_LABELS: Record<TeamAction, string> = {
  member_joined: '加入了团队',
  member_left: '离开了团队',
  role_changed: '变更了成员角色',
  file_mounted: '挂载了文件',
  file_unmounted: '卸载了文件',
  file_uploaded: '上传了文件',
  file_deleted: '删除了文件',
  comment_added: '发表了评论',
  team_created: '创建了团队',
  team_settings_updated: '更新了团队设置',
  invite_sent: '发送了邀请',
  invite_accepted: '接受了邀请',
};

/** 根据活动数据生成人类可读描述 */
export function formatActivityDescription(activity: ActivityItem): string {
  const userName = activity.userName || '某人';
  const label = ACTION_LABELS[activity.action] || activity.action;
  const detailStr = formatDetails(activity.action, activity.details);
  return detailStr ? `${userName} ${label}：${detailStr}` : `${userName} ${label}`;
}

function formatDetails(action: TeamAction, details: Record<string, unknown> | null): string {
  if (!details) return '';
  switch (action) {
    case 'member_joined':
      return details.targetUserName ? `欢迎 ${details.targetUserName} 加入` : '';
    case 'role_changed':
      return `${details.targetUserName || '某成员'} → ${details.newRole || ''}`;
    case 'file_mounted':
    case 'file_unmounted':
      return (details.fileName as string) || '';
    case 'file_uploaded':
    case 'file_deleted':
      return (details.fileName as string) || '';
    case 'comment_added':
      return details.fileName ? `《${details.fileName as string}》` : '';
    case 'invite_sent':
      return (details.targetEmail as string | undefined) || (details.targetCode as string | undefined) || '';
    default:
      return '';
  }
}
