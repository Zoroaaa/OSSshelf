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
