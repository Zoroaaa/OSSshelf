/**
 * docs.test.ts — API 文档生成的回归守卫
 *
 * 背景：routeMetadata 的键与运行期路由存在三处格式差异（/api 挂载前缀、方法名补空格、:param vs {param}），
 * 任一处不一致都会让整张元数据表匹配失败，spec.paths 变成空对象，/api/docs 打开是空白页。
 * 这里用真实形态的路由断言归一化逻辑，避免再次出现「文档静默为空」。
 */

import { describe, expect, it } from 'vitest';
import type { RouterRoute } from 'hono/types';
import { buildOpenApiSpec } from './docs';

const route = (method: string, path: string) => ({ method, path }) as RouterRoute;

function buildPaths(routes: RouterRoute[]) {
  const spec = buildOpenApiSpec(routes) as { paths: Record<string, Record<string, unknown>> };
  return spec.paths;
}

describe('buildOpenApiSpec', () => {
  const paths = buildPaths([
    route('POST', '/api/auth/register'),
    route('GET', '/api/auth/me'),
    route('GET', '/api/files/:fileId'),
    route('DELETE', '/api/files/:fileId'),
    route('GET', '/api/permissions/roles/templates'),
    route('PUT', '/api/permissions/requests/:requestId/review'),
    route('GET', '/health'),
    route('GET', '/api/internal/undocumented'),
  ]);

  it('带 /api 挂载前缀的路由能匹配到元数据', () => {
    expect(paths['/api/auth/register']?.post).toBeDefined();
    expect(paths['/api/auth/me']?.get).toBeDefined();
  });

  it('路径参数归一化为 OpenAPI 风格 {param}，同一路径多方法都保留', () => {
    expect(paths['/api/files/{fileId}']?.get).toBeDefined();
    expect(paths['/api/files/{fileId}']?.delete).toBeDefined();
  });

  it('嵌套挂载（/permissions/roles/templates）能匹配', () => {
    expect(paths['/api/permissions/roles/templates']).toBeDefined();
  });

  it('参数名与元数据不同（:requestId vs :id）也能匹配', () => {
    expect(paths['/api/permissions/requests/{requestId}/review']?.put).toBeDefined();
  });

  it('非 /api 挂载的根级端点同样可见', () => {
    expect(paths['/health']).toBeDefined();
  });

  it('未登记元数据的路由被跳过，且不影响整体结果', () => {
    expect(paths['/api/internal/undocumented']).toBeUndefined();
    expect(Object.keys(paths).length).toBeGreaterThan(0);
  });
});
