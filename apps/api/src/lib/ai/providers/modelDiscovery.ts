/**
 * modelDiscovery.ts
 * 供应商模型发现、缓存、批量导入
 *
 * 流程：
 *   GET {baseUrl}/models（OpenAI / Anthropic 两种鉴权）
 *   → 与 models.dev 快照合并
 *   → 缓存到 ai_providers.discovered_models_json
 *   → 用户勾选后批量写入 ai_models
 */

import { and, eq } from 'drizzle-orm';
import { getDb, aiModels, aiProviders } from '../../../db';
import type { Env } from '../../../types/env';
import type { ModelCapability } from '../types';
import { AiError } from '../aiErrors';
import { getModelsDevProvider, resolveModelMetadataFromProvider, type ModelMetadata } from '../catalog/modelCatalog';
import { getRuntimeProvider, resolveModelMetadataAsync } from '../catalog/runtimeCatalog';
import type { ModelsDevProviderMeta } from '../catalog/types';
import { joinUrl } from '../url';
import { getProviderPreset } from './providerPresets';
import { decryptProviderApiKey, parseHeadersJson, type AiProviderRow } from './providerService';

const DISCOVERY_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60_000;

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities: string[];
  capabilities: ModelCapability[];
  pricing?: ModelMetadata['pricing'];
  supportsThinking: boolean;
  status?: 'alpha' | 'beta' | 'deprecated';
  source: ModelMetadata['source'];
  added?: boolean;
}

export interface DiscoveryResult {
  models: DiscoveredModel[];
  source: 'live' | 'cache';
  fetchedAt: string;
}

function parseDefaultInput(value: string | null | undefined): string[] {
  if (!value) return ['text'];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : ['text'];
  } catch {
    return ['text'];
  }
}

function buildHeaders(provider: AiProviderRow, apiKey: string | undefined): Record<string, string> {
  const custom = parseHeadersJson(provider.headersJson) ?? {};
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...custom,
  };

  if (provider.protocol === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

async function fetchModelList(provider: AiProviderRow, apiKey: string | undefined): Promise<Record<string, unknown>[]> {
  if (!provider.apiEndpoint) {
    throw new AiError('AI_CONFIG_INVALID', '供应商 Base URL 为空');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    const response = await fetch(joinUrl(provider.apiEndpoint, 'models'), {
      method: 'GET',
      headers: buildHeaders(provider, apiKey),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new AiError('AI_UNAUTHORIZED', 'API Key 无效或已过期');
    }

    if (response.status === 404) {
      throw new AiError('AI_CONFIG_INVALID', '该供应商不支持模型列表，请手动填写模型 ID，或检查 Base URL 是否正确');
    }

    if (!response.ok) {
      throw new AiError('AI_UPSTREAM_ERROR', `模型列表请求失败：HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { data?: unknown } | unknown[];
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown }).data)
        ? ((payload as { data: unknown[] }).data ?? [])
        : null;

    if (!items) {
      throw new AiError('AI_UPSTREAM_ERROR', '供应商返回的模型列表格式无法识别');
    }

    return items.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
    );
  } catch (error) {
    if (error instanceof AiError) throw error;

    if ((error as Error)?.name === 'AbortError') {
      throw new AiError('AI_TIMEOUT', '连接超时，请检查 Base URL 或网络');
    }

    throw new AiError('AI_UPSTREAM_ERROR', `模型列表请求失败：${(error as Error)?.message ?? '未知错误'}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRawModel(raw: Record<string, unknown>): Record<string, unknown> {
  const architecture = raw.architecture as { input_modalities?: string[]; output_modalities?: string[] } | undefined;

  if (architecture?.input_modalities && !raw.modalities) {
    return { ...raw, modalities: architecture.input_modalities };
  }

  return raw;
}

function toDiscoveredModel(
  providerMeta: ModelsDevProviderMeta | undefined,
  fallbackInput: string[],
  raw: Record<string, unknown>
): DiscoveredModel | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return null;

  const normalized = normalizeRawModel(raw);
  const metadata = resolveModelMetadataFromProvider(providerMeta, id, fallbackInput, normalized);

  return {
    id,
    name: metadata.displayName || id,
    contextWindow: metadata.contextWindow,
    maxOutputTokens: metadata.maxOutputTokens,
    inputModalities: metadata.inputModalities,
    capabilities: metadata.capabilities,
    pricing: metadata.pricing,
    supportsThinking: metadata.supportsThinking,
    status: metadata.status,
    source: metadata.source,
  };
}

function parseCachedModels(provider: AiProviderRow): DiscoveredModel[] | null {
  if (!provider.discoveredModelsJson) return null;
  try {
    const parsed = JSON.parse(provider.discoveredModelsJson) as DiscoveredModel[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCacheFresh(provider: AiProviderRow): boolean {
  if (!provider.modelsSyncedAt) return false;
  return Date.now() - new Date(provider.modelsSyncedAt).getTime() < CACHE_TTL_MS;
}

export async function discoverProviderModels(
  env: Env,
  userId: string,
  provider: AiProviderRow,
  options: { refresh?: boolean } = {}
): Promise<DiscoveryResult> {
  const cached = parseCachedModels(provider);
  if (cached && isCacheFresh(provider) && !options.refresh) {
    return {
      models: await attachAddedState(env, userId, provider.id, cached),
      source: 'cache',
      fetchedAt: provider.modelsSyncedAt ?? new Date().toISOString(),
    };
  }

  const apiKey = await decryptProviderApiKey(env, provider.apiKeyEncrypted);
  const preset = getProviderPreset(provider.presetId);
  const fallbackInput = parseDefaultInput(provider.defaultInput);
  const metadataProviderId = preset?.metadataProviderId;
  const runtimeProvider = await getRuntimeProvider(env, metadataProviderId);
  const providerMeta = runtimeProvider ?? getModelsDevProvider(metadataProviderId);

  const rawModels = await fetchModelList(provider, apiKey);
  const models = rawModels
    .map((raw) => toDiscoveredModel(providerMeta, fallbackInput, raw))
    .filter((model): model is DiscoveredModel => model !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (models.length === 0) {
    throw new AiError('AI_CONFIG_INVALID', '供应商没有返回可用模型');
  }

  const now = new Date().toISOString();
  const db = getDb(env.DB);
  await db
    .update(aiProviders)
    .set({
      discoveredModelsJson: JSON.stringify(models),
      modelsSyncedAt: now,
      updatedAt: now,
    })
    .where(and(eq(aiProviders.id, provider.id), eq(aiProviders.userId, userId)));

  return {
    models: await attachAddedState(env, userId, provider.id, models),
    source: 'live',
    fetchedAt: now,
  };
}

async function attachAddedState(
  env: Env,
  userId: string,
  providerId: string,
  models: DiscoveredModel[]
): Promise<DiscoveredModel[]> {
  const db = getDb(env.DB);
  const existing = await db
    .select({ modelId: aiModels.modelId })
    .from(aiModels)
    .where(and(eq(aiModels.userId, userId), eq(aiModels.providerId, providerId)))
    .all();

  const added = new Set(existing.map((row) => row.modelId));
  return models.map((model) => ({ ...model, added: added.has(model.id) }));
}

export async function getProviderModels(
  env: Env,
  userId: string,
  provider: AiProviderRow,
  options: { refresh?: boolean } = {}
): Promise<DiscoveryResult> {
  return discoverProviderModels(env, userId, provider, options);
}

export interface ImportResult {
  created: number;
  skipped: number;
}

export async function importProviderModels(
  env: Env,
  userId: string,
  provider: AiProviderRow,
  modelIds: string[]
): Promise<ImportResult> {
  const requested = Array.from(new Set(modelIds.map((id) => id.trim()).filter(Boolean))).slice(0, 500);
  if (requested.length === 0) {
    throw new AiError('AI_CONFIG_INVALID', '请选择要导入的模型');
  }

  let discovered = parseCachedModels(provider);
  if (!discovered) {
    const result = await discoverProviderModels(env, userId, provider);
    discovered = await attachAddedState(env, userId, provider.id, result.models);
  }

  const byId = new Map(discovered.map((model) => [model.id, model]));
  const preset = getProviderPreset(provider.presetId);
  const fallbackInput = parseDefaultInput(provider.defaultInput);

  const db = getDb(env.DB);
  const existing = await db
    .select({ modelId: aiModels.modelId })
    .from(aiModels)
    .where(and(eq(aiModels.userId, userId), eq(aiModels.providerId, provider.id)))
    .all();
  const existingIds = new Set(existing.map((row) => row.modelId));

  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const modelId of requested) {
    if (existingIds.has(modelId)) {
      skipped += 1;
      continue;
    }

    const discoveredModel = byId.get(modelId);
    const metadata = await resolveModelMetadataAsync(env, preset?.metadataProviderId, modelId, fallbackInput);

    const capabilities = discoveredModel?.capabilities ?? metadata.capabilities;
    const supportsThinking = discoveredModel?.supportsThinking ?? metadata.supportsThinking;
    const inputModalities = discoveredModel?.inputModalities ?? metadata.inputModalities;
    const contextWindow = discoveredModel?.contextWindow ?? metadata.contextWindow;
    const maxOutputTokens = discoveredModel?.maxOutputTokens ?? metadata.maxOutputTokens;
    const pricing = discoveredModel?.pricing ?? metadata.pricing;
    const metadataSource = discoveredModel?.source ?? metadata.source;
    const displayName = discoveredModel?.name ?? metadata.displayName ?? modelId;

    await db.insert(aiModels).values({
      id: crypto.randomUUID(),
      userId,
      providerId: provider.id,
      name: displayName,
      provider: provider.protocol,
      modelId,
      contextWindow: contextWindow ?? null,
      maxOutputTokens: maxOutputTokens ?? null,
      inputModalities: JSON.stringify(inputModalities),
      pricingJson: pricing ? JSON.stringify(pricing) : null,
      metadataSource,
      isActive: false,
      capabilities: JSON.stringify(capabilities),
      temperature: 0.7,
      systemPrompt: null,
      configJson: '{}',
      supportsThinking,
      thinkingParamFormat: null,
      thinkingParamName: null,
      thinkingEnabledValue: null,
      thinkingDisabledValue: null,
      thinkingNestedKey: null,
      disableThinkingForFeatures: '["image_caption","image_tag","image_analysis","file_summary"]',
      isReadonly: false,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });

    existingIds.add(modelId);
    created += 1;
  }

  return { created, skipped };
}

export async function testProviderConnection(
  env: Env,
  provider: AiProviderRow
): Promise<{ valid: boolean; latencyMs: number; modelCount: number; error?: string }> {
  const startedAt = Date.now();

  try {
    const apiKey = await decryptProviderApiKey(env, provider.apiKeyEncrypted);
    const rawModels = await fetchModelList(provider, apiKey);
    return {
      valid: true,
      latencyMs: Date.now() - startedAt,
      modelCount: rawModels.length,
    };
  } catch (error) {
    return {
      valid: false,
      latencyMs: Date.now() - startedAt,
      modelCount: 0,
      error: error instanceof Error ? error.message : '连接测试失败',
    };
  }
}
