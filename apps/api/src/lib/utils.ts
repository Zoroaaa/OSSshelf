/**
 * utils.ts
 * 通用工具函数
 */

import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import type { DrizzleDb } from '../db';

export function encodeFilename(name: string): string {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
}

export async function getUserOrFail(db: DrizzleDb, userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error('用户不存在');
  return user;
}

export interface RegConfig {
  open: boolean;
  requireInviteCode: boolean;
}

const REG_CONFIG_KEY = 'admin:registration_config';

export async function getRegConfig(kv: KVNamespace): Promise<RegConfig> {
  const raw = await kv.get(REG_CONFIG_KEY);
  if (!raw) return { open: true, requireInviteCode: false };
  try {
    return JSON.parse(raw);
  } catch {
    return { open: true, requireInviteCode: false };
  }
}
