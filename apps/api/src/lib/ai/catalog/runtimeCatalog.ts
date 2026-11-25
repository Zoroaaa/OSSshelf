/**
 * runtimeCatalog.ts
 * models.dev 运行时快照：拉取、存 D1、状态、重置
 *
 * 优先级：D1 运行时快照 > 代码内置快照。
 * 表不存在（迁移未执行）时自动回退内置快照，不影响主流程。
 */

import { eq } from 'drizzle-orm';
import { getDb, aiCatalogSnapshot } from '../../../db';
import type { Env } from '../../../types/env';
import { PROVIDER_PRESETS } from '../providers/providerPresets';
import { MODELS_DEV_SNAPSHOT } from './modelsDevCatalog';
import { getModelsDevProvider, resolveModelMetadataFromProvider, type ModelMetadata } from './modelCatalog';
import type { ModelsDevModelMeta, ModelsDevProviderMeta, ModelsDevReasoningOption, ModelsDevSnapshot } from './types';

const SNAPSHOT_ID = 'models_dev';
const MODELS_DEV_URL = 'https://models.dev/api.json';
const SYNC_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 5 * 60_000;

export interface CatalogStatus {
  source: 'runtime' | 'bundled';
  installed: boolean;
  fetchedAt: string | null;
  generatedAt: string | null;
  providerCount: number;
  modelCount: number;
}

let cachedSnapshot: ModelsDevSnapshot | null = null;
let cachedAt = 0;

/**
 * 保留模型明细的 provider 白名单（来自预设引用的 metadataProviderId）。
 * 其余 provider 仍进入目录，但只保留元数据 + modelCount，控制快照体积。
 */
function detailProviderIds(): Set<string> {
  const ids = new Set<string>();
  for (const preset of PROVIDER_PRESETS) {
    if (preset.metadataProviderId) ids.add(preset.metadataProviderId);
  }
  return ids;
}

function compactModel(raw: Record<string, unknown>): ModelsDevModelMeta {
  const out: ModelsDevModelMeta = {};

  if (typeof raw.name === 'string') out.name = raw.name;
  if (typeof raw.attachment === 'boolean') out.attachment = raw.attachment;
  if (typeof raw.reasoning === 'boolean') out.reasoning = raw.reasoning;
  if (typeof raw.tool_call === 'boolean') out.toolCall = raw.tool_call;
  if (typeof raw.status === 'string') out.status = raw.status as ModelsDevModelMeta['status'];
  if (typeof raw.release_date === 'string') out.releaseDate = raw.release_date;

  if (Array.isArray(raw.reasoning_options)) {
    out.reasoningOptions = raw.reasoning_options
      .filter((option): option is Record<string, unknown> => typeof option === 'object' && option !== null)
      .map((option) => ({
        type: String(option.type ?? ''),
        ...(Array.isArray(option.values) ? { values: option.values.map(String) } : {}),
      })) as ModelsDevReasoningOption[];
  }

  if (raw.modalities && typeof raw.modalities === 'object') {
    const modalities = raw.modalities as { input?: unknown; output?: unknown };
    out.modalities = {
      ...(Array.isArray(modalities.input) ? { input: modalities.input.map(String) } : {}),
      ...(Array.isArray(modalities.output) ? { output: modalities.output.map(String) } : {}),
    };
  }

  if (raw.limit && typeof raw.limit === 'object') {
    const limit = raw.limit as Record<string, unknown>;
    out.limit = {
      ...(typeof limit.context === 'number' ? { context: limit.context } : {}),
      ...(typeof limit.input === 'number' ? { input: limit.input } : {}),
      ...(typeof limit.output === 'number' ? { output: limit.output } : {}),
    };
  }

  if (raw.cost && typeof raw.cost === 'object') {
    const cost = raw.cost as Record<string, unknown>;
    out.cost = {
      ...(typeof cost.input === 'number' ? { input: cost.input } : {}),
      ...(typeof cost.output === 'number' ? { output: cost.output } : {}),
      ...(typeof cost.reasoning === 'number' ? { reasoning: cost.reasoning } : {}),
      ...(typeof cost.cache_read === 'number' ? { cacheRead: cost.cache_read } : {}),
    };
  }

  return out;
}

/** 从 models.dev 原始 api.json 构建精简快照（纯函数，供测试） */
export function buildSnapshotFromRaw(
  source: Record<string, unknown>,
  generatedAt = new Date().toISOString()
): ModelsDevSnapshot {
  const providers: Record<string, ModelsDevProviderMeta> = {};
  const detailIds = detailProviderIds();

  // 全量 provider 保留元数据供新建目录选取；模型明细仅白名单保留（约 0.6MB vs 全量 3.6MB）。
  for (const providerId of Object.keys(source).sort()) {
    const rawProvider = source[providerId];
    if (!rawProvider || typeof rawProvider !== 'object') continue;

    const provider = rawProvider as Record<string, unknown>;
    const rawModels =
      provider.models && typeof provider.models === 'object' ? (provider.models as Record<string, unknown>) : {};
    const modelCount = Object.keys(rawModels).length;

    const models: Record<string, ModelsDevModelMeta> = {};
    if (detailIds.has(providerId)) {
      for (const modelId of Object.keys(rawModels).sort()) {
        const rawModel = rawModels[modelId];
        if (!rawModel || typeof rawModel !== 'object') continue;
        models[modelId] = compactModel(rawModel as Record<string, unknown>);
      }
    }

    providers[providerId] = {
      name: String(provider.name ?? providerId),
      ...(typeof provider.api === 'string' ? { api: provider.api } : {}),
      ...(typeof provider.doc === 'string' ? { doc: provider.doc } : {}),
      ...(typeof provider.npm === 'string' ? { npm: provider.npm } : {}),
      ...(Array.isArray(provider.env) ? { env: provider.env.map(String) } : {}),
      modelCount,
      models,
    };
  }

  return { generatedAt, providers };
}

export function countSnapshot(snapshot: ModelsDevSnapshot): { providerCount: number; modelCount: number } {
  const providers = Object.values(snapshot.providers);
  return {
    providerCount: providers.length,
    // 优先用原始 modelCount（含非白名单 provider），兼容旧快照回退到明细数。
    modelCount: providers.reduce((sum, provider) => sum + (provider.modelCount ?? Object.keys(provider.models).length), 0),
  };
}

/** 目录条目：新建供应商时可选的精简 provider 信息 */
export interface CatalogProviderItem {
  id: string;
  name: string;
  api?: string;
  doc?: string;
  npm?: string;
  env: string[];
  modelCount: number;
  logoUrl: string;
  /** 该 provider 是否已有内置预设（前端可提示「已预设」） */
  hasPreset: boolean;
}

/** 运行时快照优先，失败回退内置快照 */
export function getCatalogSnapshot(env: Env): Promise<ModelsDevSnapshot> {
  return getRuntimeSnapshot(env).then((runtime) => runtime ?? MODELS_DEV_SNAPSHOT);
}

/**
 * 生成新建供应商可选的 provider 目录。
 * 过滤规则：必须有可直连的 https OpenAI 兼容端点（排除含 ${} 占位符的模板 URL，
 * 例如 Cloudflare Workers AI 的 accounts/${ID} 形式，无法直接作为 Base URL 使用）。
 */
export function listCatalogProviders(snapshot: ModelsDevSnapshot): CatalogProviderItem[] {
  const presetIds = new Set<string>();
  for (const preset of PROVIDER_PRESETS) {
    if (preset.metadataProviderId) presetIds.add(preset.metadataProviderId);
  }

  const items: CatalogProviderItem[] = [];
  for (const [id, provider] of Object.entries(snapshot.providers)) {
    if (!provider.api || provider.api.includes('${')) continue;
    items.push({
      id,
      name: provider.name,
      ...(provider.api ? { api: provider.api } : {}),
      ...(provider.doc ? { doc: provider.doc } : {}),
      ...(provider.npm ? { npm: provider.npm } : {}),
      env: provider.env ?? [],
      modelCount: provider.modelCount ?? Object.keys(provider.models).length,
      logoUrl: `https://models.dev/logos/${encodeURIComponent(id)}.svg`,
      hasPreset: presetIds.has(id),
    });
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export function getBundledCatalogStatus(): CatalogStatus {
  const counts = countSnapshot(MODELS_DEV_SNAPSHOT);
  return {
    source: 'bundled',
    installed: false,
    fetchedAt: null,
    generatedAt: MODELS_DEV_SNAPSHOT.generatedAt,
    ...counts,
  };
}

export async function getRuntimeSnapshot(env: Env): Promise<ModelsDevSnapshot | null> {
  const now = Date.now();
  if (cachedSnapshot && now - cachedAt < CACHE_TTL_MS) return cachedSnapshot;

  try {
    const db = getDb(env.DB);
    const row = await db
      .select({ payload: aiCatalogSnapshot.payload })
      .from(aiCatalogSnapshot)
      .where(eq(aiCatalogSnapshot.id, SNAPSHOT_ID))
      .get();

    if (!row?.payload) return null;

    const parsed = JSON.parse(row.payload) as ModelsDevSnapshot;
    cachedSnapshot = parsed;
    cachedAt = now;
    return parsed;
  } catch {
    // 迁移未执行或表不存在时回退内置快照
    return null;
  }
}

export async function getRuntimeProvider(
  env: Env,
  metadataProviderId: string | undefined | null
): Promise<ModelsDevProviderMeta | null> {
  if (!metadataProviderId) return null;
  const snapshot = await getRuntimeSnapshot(env);
  return snapshot?.providers[metadataProviderId] ?? null;
}

/** 运行时快照优先；单个 provider 缺失时回退内置快照 */
export async function resolveModelMetadataAsync(
  env: Env,
  metadataProviderId: string | undefined | null,
  modelId: string,
  fallbackInput: string[],
  providerRaw?: Record<string, unknown>
): Promise<ModelMetadata> {
  const runtimeProvider = await getRuntimeProvider(env, metadataProviderId);
  const provider = runtimeProvider ?? getModelsDevProvider(metadataProviderId);
  return resolveModelMetadataFromProvider(provider, modelId, fallbackInput, providerRaw);
}

export async function getCatalogStatus(env: Env): Promise<CatalogStatus> {
  const bundled = getBundledCatalogStatus();

  try {
    const db = getDb(env.DB);
    const row = await db
      .select({
        fetchedAt: aiCatalogSnapshot.fetchedAt,
        generatedAt: aiCatalogSnapshot.generatedAt,
        providerCount: aiCatalogSnapshot.providerCount,
        modelCount: aiCatalogSnapshot.modelCount,
      })
      .from(aiCatalogSnapshot)
      .where(eq(aiCatalogSnapshot.id, SNAPSHOT_ID))
      .get();

    if (!row) return bundled;

    return {
      source: 'runtime',
      installed: true,
      fetchedAt: row.fetchedAt,
      generatedAt: row.generatedAt,
      providerCount: row.providerCount,
      modelCount: row.modelCount,
    };
  } catch {
    return bundled;
  }
}

export async function syncCatalogSnapshot(env: Env): Promise<CatalogStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

  try {
    const response = await fetch(MODELS_DEV_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`models.dev 返回 HTTP ${response.status}`);
    }

    const source = (await response.json()) as Record<string, unknown>;
    const snapshot = buildSnapshotFromRaw(source);
    const counts = countSnapshot(snapshot);
    const fetchedAt = new Date().toISOString();
    const payload = JSON.stringify(snapshot);

    if (counts.modelCount === 0) {
      throw new Error('models.dev 没有返回可用模型');
    }

    const db = getDb(env.DB);
    await db
      .insert(aiCatalogSnapshot)
      .values({
        id: SNAPSHOT_ID,
        payload,
        generatedAt: snapshot.generatedAt,
        fetchedAt,
        providerCount: counts.providerCount,
        modelCount: counts.modelCount,
        source: 'models.dev',
      })
      .onConflictDoUpdate({
        target: aiCatalogSnapshot.id,
        set: {
          payload,
          generatedAt: snapshot.generatedAt,
          fetchedAt,
          providerCount: counts.providerCount,
          modelCount: counts.modelCount,
          source: 'models.dev',
        },
      });

    cachedSnapshot = snapshot;
    cachedAt = Date.now();

    return {
      source: 'runtime',
      installed: true,
      fetchedAt,
      generatedAt: snapshot.generatedAt,
      ...counts,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resetCatalogSnapshot(env: Env): Promise<CatalogStatus> {
  const db = getDb(env.DB);
  await db.delete(aiCatalogSnapshot).where(eq(aiCatalogSnapshot.id, SNAPSHOT_ID));
  cachedSnapshot = null;
  cachedAt = 0;
  return getBundledCatalogStatus();
}
