/**
 * index.ts
 * 数据库连接模块
 *
 * 功能:
 * - 导出数据库连接函数
 * - 导出所有表结构定义
 */

import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type DrizzleDb = ReturnType<typeof getDb>;

export * from './schema';
