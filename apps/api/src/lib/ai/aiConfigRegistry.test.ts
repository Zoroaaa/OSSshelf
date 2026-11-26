/**
 * aiConfigRegistry.test.ts
 * 配置项 ↔ 读取点静态守卫
 *
 * 两类漂移都会在这里失败：
 * 1. 代码读了未注册的 key（大概率是拼写错误或历史残留，线上永远拿不到值）
 * 2. 注册了却没人读的 key（配置页能改但不生效，正是 R14 的问题）
 *
 * 例外：纯展示/由 getAllAiConfigs 输出到管理页的项也必须至少有一个真实读取点，
 * 否则"可改但不生效"依然是 bug，不允许加白名单绕过。
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_CONFIG_KEYS } from './aiConfigService';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 匹配 getAiConfig / getAiConfigNumber / getAiConfigJson<T>(env, 'key', …) */
const READ_PATTERN = /getAiConfig\w*(?:<[^(]*>)?\(\s*[^,]+,\s*['"]([^'"]+)['"]/gs;

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, acc);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    acc.push(full);
  }
  return acc;
}

function collectReadPoints(): Map<string, string[]> {
  const points = new Map<string, string[]>();
  for (const file of collectTsFiles(srcRoot)) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(READ_PATTERN)) {
      const key = match[1];
      if (!key) continue;
      const list = points.get(key) ?? [];
      list.push(path.relative(srcRoot, file));
      points.set(key, list);
    }
  }
  return points;
}

describe('AI 配置注册表守卫', () => {
  const registered = new Set(AI_CONFIG_KEYS);
  const readPoints = collectReadPoints();

  it('注册表 key 唯一', () => {
    expect(new Set(AI_CONFIG_KEYS).size).toBe(AI_CONFIG_KEYS.length);
  });

  it('代码读取的每个 key 都已注册', () => {
    const unregistered = [...readPoints.keys()].filter((key) => !registered.has(key)).sort();
    expect(unregistered).toEqual([]);
  });

  it('每个注册项至少有一个读取点（配了必须生效）', () => {
    const orphaned = [...registered].filter((key) => !readPoints.has(key)).sort();
    expect(orphaned).toEqual([]);
  });
});
