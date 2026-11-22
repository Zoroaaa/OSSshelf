/**
 * docs.metadata.test.ts — routeMetadata 与真实路由的一致性守卫
 *
 * 背景：docs.ts 的元数据表靠手写维护，路由改名/删除后元数据不会自动失效，
 * 表现为「文档里有一条点不开的接口」或「新接口在文档里看不到」。
 * 该测试静态扫描源码（不启动 Worker），断言：
 *   1. 每条元数据都能对应到一个真实注册的路由（死条目 = 0）；
 *   2. 元数据键归一化后不重复（防止两条元数据抢同一个路由）。
 *
 * 未登记路由不做断言：目前仍有大量内部/边缘接口未写描述，属于待补清单而非错误。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROUTES_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_SRC = path.resolve(ROUTES_DIR, '..');
const INDEX_SRC = fs.readFileSync(path.join(API_SRC, 'index.ts'), 'utf8');
const DOCS_SRC = fs.readFileSync(path.join(ROUTES_DIR, 'docs.ts'), 'utf8');

/** 参数名不参与比较；元数据按相对 /api 书写，实际路由是完整路径 */
function normalizeKey(method: string, rawPath: string): string {
  const relative =
    rawPath
      .replace(/\{(\w+)\}/g, ':p')
      .replace(/:\w+/g, ':p')
      .replace(/\/+$/, '')
      .replace(/^\/api(?=\/|$)/, '') || '/';
  return `${method.toLowerCase()} ${relative}`;
}

/** index.ts 里 app.route(prefix, var) 的挂载关系 */
const importMap = new Map<string, string>();
for (const m of INDEX_SRC.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([\w.]+)'/g)) {
  importMap.set(m[1], m[2]);
}

/** 实际注册的路由集合 */
const actualRoutes = new Map<string, string>();

for (const m of INDEX_SRC.matchAll(/app\.route\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)) {
  const [, prefix, variable] = m;
  const file = importMap.get(variable);
  if (!file) continue;

  const filePath = path.join(ROUTES_DIR, `${file}.ts`);
  if (!fs.existsSync(filePath)) continue;

  const src = fs.readFileSync(filePath, 'utf8');
  for (const r of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    const [, method, subPath] = r;
    const full = subPath === '/' ? prefix : `${prefix}${subPath}`;
    actualRoutes.set(normalizeKey(method, full), `${method.toUpperCase()} ${full}`);
  }
}

// index.ts 里直接注册的路由（/health、/api）
for (const m of INDEX_SRC.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
  const [, method, p] = m;
  actualRoutes.set(normalizeKey(method, p), `${method.toUpperCase()} ${p}`);
}

// 工厂创建、不在 index.ts 里以 app.get 形式出现的路由
actualRoutes.set('get /api/docs', 'GET /api/docs');
actualRoutes.set('get /api/openapi.json', 'GET /api/openapi.json');

/** 元数据表中的键 */
const metaStart = DOCS_SRC.indexOf('const routeMetadata');
const metaBlock = DOCS_SRC.slice(metaStart, DOCS_SRC.indexOf('};', metaStart));
const metadataEntries = [...metaBlock.matchAll(/'(get|post|put|patch|delete)\s+(\/[^']*)':/g)].map((m) => ({
  method: m[1],
  path: m[2],
}));

describe('routeMetadata 与真实路由一致性', () => {
  it('每条元数据都能对应到真实路由（死条目为 0）', () => {
    const dead = metadataEntries.filter((e) => !actualRoutes.has(normalizeKey(e.method, e.path)));
    expect(dead.map((e) => `${e.method.toUpperCase()} ${e.path}`)).toEqual([]);
  });

  it('元数据键归一化后不重复', () => {
    const keys = metadataEntries.map((e) => normalizeKey(e.method, e.path));
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('元数据表非空（防止解析失败导致空断言通过）', () => {
    expect(metadataEntries.length).toBeGreaterThan(100);
  });
});
