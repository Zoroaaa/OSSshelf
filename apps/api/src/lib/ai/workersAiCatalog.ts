/**
 * workersAiCatalog.ts
 * Workers AI 模型目录（实时同步 + 内置兜底）
 *
 * 数据源:
 * - 配置 CF_ACCOUNT_ID / CF_API_TOKEN 后，调用 Cloudflare 官方
 *   GET /accounts/{account_id}/ai/models/search（权限：Workers AI Read）
 * - 未配置或同步失败时，回退到 WorkersAiAdapter 内置清单，并显式标记 source
 *
 * 注意: Cloudflare 的模型目录不保证返回价格字段；返回的 properties 会原样透出，
 * 前端按 key 展示（含 context_window / price 等）。
 */

import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';
import { WorkersAiAdapter } from './adapters/workersAiAdapter';

export interface WorkersAiCatalogProperty {
  key: string;
  value: string;
}

export interface WorkersAiCatalogModel {
  id: string;
  name: string;
  description: string;
  task: string;
  capabilities: string[];
  properties: WorkersAiCatalogProperty[];
  pricing: string | null;
  beta: boolean;
  deprecated: boolean;
}

export interface WorkersAiCatalog {
  source: 'live' | 'fallback';
  configured: boolean;
  fetchedAt: string | null;
  error?: string;
  models: WorkersAiCatalogModel[];
}

const CACHE_TTL_MS = 6 * 60 * 60_000;
const MAX_PAGES = 6;
const PER_PAGE = 100;

const cache = new Map<object, { data: WorkersAiCatalog; timestamp: number }>();

const CAPABILITY_RULES: Array<{ pattern: RegExp; capability: string }> = [
  { pattern: /text generation|text-to-text|chat|completion/i, capability: 'chat' },
  { pattern: /text embeddings|embeddings/i, capability: 'embedding' },
  { pattern: /image-to-text|image understanding|vision/i, capability: 'vision' },
];

function deriveCapabilities(task: string, id: string, properties: WorkersAiCatalogProperty[]): string[] {
  const capabilities = new Set<string>();
  for (const rule of CAPABILITY_RULES) {
    if (rule.pattern.test(task)) capabilities.add(rule.capability);
  }

  const hasVisionFlag = properties.some((property) => property.key === 'vision' && property.value !== 'false');
  if (hasVisionFlag || /llava|vision|gemma-3-12b/i.test(id)) capabilities.add('vision');

  return Array.from(capabilities);
}

function normalizeProperty(raw: unknown): WorkersAiCatalogProperty | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const key = String(record.property_id ?? record.key ?? '').trim();
  if (!key) return null;
  const value = record.value;
  return {
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  };
}

function mapLiveModel(raw: unknown): WorkersAiCatalogModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = String(record.id ?? record.name ?? '').trim();
  if (!id) return null;

  const taskRecord = record.task as { name?: unknown; id?: unknown } | string | undefined;
  const task =
    typeof taskRecord === 'string'
      ? taskRecord
      : String(taskRecord?.name ?? taskRecord?.id ?? record.task_id ?? '未知任务');

  const properties = Array.isArray(record.properties)
    ? record.properties.map(normalizeProperty).filter((item): item is WorkersAiCatalogProperty => item !== null)
    : [];
  const capabilities = deriveCapabilities(task, id, properties);

  // 本应用只消费对话 / 视觉 / 向量三类模型，其余（生图、语音等）不列出
  if (capabilities.length === 0) return null;

  const priceProperty = properties.find((property) => /price|pricing|cost/i.test(property.key));
  const betaProperty = properties.find((property) => property.key === 'beta');

  return {
    id,
    name: String(record.name ?? id),
    description: String(record.description ?? ''),
    task,
    capabilities,
    properties,
    pricing: priceProperty ? priceProperty.value : null,
    beta: Boolean(record.beta) || betaProperty?.value === 'true',
    deprecated: Boolean(record.deprecated),
  };
}

function fallbackModels(): WorkersAiCatalogModel[] {
  return WorkersAiAdapter.getAvailableModels()
    .filter((model) => model.id !== '__custom__')
    .map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      task: '内置兜底清单',
      capabilities: model.capabilities,
      properties: [],
      pricing: null,
      beta: false,
      deprecated: false,
    }));
}

function fallbackCatalog(configured: boolean, error?: string): WorkersAiCatalog {
  return {
    source: 'fallback',
    configured,
    fetchedAt: null,
    error,
    models: fallbackModels(),
  };
}

export async function getWorkersAiCatalog(env: Env, options: { refresh?: boolean } = {}): Promise<WorkersAiCatalog> {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;

  if (!accountId || !token) {
    return fallbackCatalog(false);
  }

  const cached = cache.get(env);
  if (!options.refresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const models: WorkersAiCatalogModel[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search` +
        `?per_page=${PER_PAGE}&page=${page}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Cloudflare API ${response.status}: ${text.slice(0, 160)}`);
      }

      const payload = (await response.json()) as {
        success?: boolean;
        result?: unknown[];
        errors?: unknown;
      };

      if (payload.success === false) {
        throw new Error(`Cloudflare API 返回失败: ${JSON.stringify(payload.errors).slice(0, 160)}`);
      }

      const result = Array.isArray(payload.result) ? payload.result : [];
      for (const raw of result) {
        const mapped = mapLiveModel(raw);
        if (mapped) models.push(mapped);
      }

      if (result.length < PER_PAGE) break;
    }

    models.sort((a, b) => a.id.localeCompare(b.id));

    const data: WorkersAiCatalog = {
      source: 'live',
      configured: true,
      fetchedAt: new Date().toISOString(),
      models,
    };
    cache.set(env, { data, timestamp: Date.now() });
    logger.info('AI', 'Workers AI 模型目录同步完成', { count: models.length });
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('AI', 'Workers AI 模型目录同步失败，使用内置兜底', {}, error);

    if (cached) return { ...cached.data, error: `同步失败：${message}` };
    return fallbackCatalog(true, `同步失败：${message}`);
  }
}
