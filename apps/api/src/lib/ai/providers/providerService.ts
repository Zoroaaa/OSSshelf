/**
 * providerService.ts
 * AI 供应商连接：CRUD、密钥加解密、视图转换
 *
 * 约定：
 * - ai_providers 只存用户级连接；预设目录在 providerPresets.ts
 * - api_key_encrypted 永不出现在 API 响应中，只返回 hasApiKey
 */

import { and, desc, eq } from 'drizzle-orm';
import { getDb, aiModels, aiProviders } from '../../../db';
import type { Env } from '../../../types/env';
import { AiError } from '../aiErrors';
import { decryptCredential, encryptCredential, getEncryptionKey, isAesGcmFormat } from '../../crypto';
import {
  getProviderPreset,
  isPresetProtocol,
  presetLogoUrl,
  presetThinkingConfigJson,
  type AiProtocol,
  type ProviderPreset,
} from './providerPresets';

export type AiProviderRow = typeof aiProviders.$inferSelect;

export interface ProviderConnectionView {
  id: string;
  userId: string | null;
  name: string;
  protocol: AiProtocol;
  apiEndpoint: string | null;
  presetId: string | null;
  logoUrl: string | null;
  description: string | null;
  thinkingConfig: string | null;
  hasApiKey: boolean;
  hasHeaders: boolean;
  defaultInput: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  modelsSyncedAt: string | null;
  modelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderConnectionInput {
  presetId?: string | null;
  name?: string;
  protocol?: string;
  apiEndpoint?: string;
  apiKey?: string | null;
  clearApiKey?: boolean;
  headers?: Record<string, string> | null;
  clearHeaders?: boolean;
  thinkingConfig?: string | null;
  description?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);

export function normalizeBaseUrl(value: string): string {
  let normalized = value.trim();
  if (!normalized) throw new AiError('AI_CONFIG_INVALID', 'Base URL 不能为空');

  normalized = normalized.replace(/\/+$/, '');
  normalized = normalized.replace(/\/chat\/completions$/i, '');
  normalized = normalized.replace(/\/models$/i, '');

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new AiError('AI_CONFIG_INVALID', 'Base URL 格式无效，请输入完整的 http(s) 地址');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiError('AI_CONFIG_INVALID', 'Base URL 只支持 http/https');
  }

  return normalized;
}

export function parseHeaders(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AiError('AI_CONFIG_INVALID', '自定义请求头必须是 JSON 对象');
  }

  const headers: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) throw new AiError('AI_CONFIG_INVALID', '自定义请求头不能超过 20 个');

  for (const [key, rawValue] of entries) {
    const name = key.trim();
    if (!name || FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new AiError('AI_CONFIG_INVALID', `不允许设置请求头: ${key}`);
    }
    if (typeof rawValue !== 'string' || rawValue.length > 2000) {
      throw new AiError('AI_CONFIG_INVALID', `请求头 ${name} 的值必须是字符串且不超过 2000 字符`);
    }
    headers[name] = rawValue;
  }

  return Object.keys(headers).length > 0 ? headers : null;
}

export function parseHeadersJson(value: string | null | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function serializeHeaders(headers: Record<string, string> | null): string | null {
  return headers ? JSON.stringify(headers) : null;
}

export function resolvePresetForInput(input: ProviderConnectionInput): ProviderPreset | undefined {
  return getProviderPreset(input.presetId);
}

function resolveProtocol(input: ProviderConnectionInput, preset: ProviderPreset | undefined): AiProtocol {
  if (preset?.protocol) return preset.protocol;
  if (input.protocol && isPresetProtocol(input.protocol)) return input.protocol;
  throw new AiError('AI_CONFIG_INVALID', '请选择协议：openai_compatible 或 anthropic');
}

export async function encryptApiKey(env: Env, apiKey: string): Promise<string> {
  return encryptCredential(apiKey, getEncryptionKey(env));
}

export async function decryptProviderApiKey(
  env: Env,
  encrypted: string | null | undefined
): Promise<string | undefined> {
  if (!encrypted) return undefined;
  if (!isAesGcmFormat(encrypted)) return encrypted;

  try {
    return await decryptCredential(encrypted, getEncryptionKey(env));
  } catch (error) {
    throw new AiError('AI_CONFIG_INVALID', '供应商 API Key 解密失败', { cause: error });
  }
}

export async function listProviderConnections(env: Env, userId: string): Promise<ProviderConnectionView[]> {
  const db = getDb(env.DB);
  const rows = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.userId, userId))
    .orderBy(desc(aiProviders.isDefault), aiProviders.sortOrder, aiProviders.createdAt)
    .all();

  const models = await db.select().from(aiModels).where(eq(aiModels.userId, userId)).all();
  const countByProvider = new Map<string, number>();
  for (const model of models) {
    if (!model.providerId) continue;
    countByProvider.set(model.providerId, (countByProvider.get(model.providerId) ?? 0) + 1);
  }

  return rows.map((row) => toProviderView(row, countByProvider.get(row.id) ?? 0));
}

export async function getProviderConnection(
  env: Env,
  userId: string,
  providerId: string
): Promise<AiProviderRow | null> {
  const db = getDb(env.DB);
  const row = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.id, providerId), eq(aiProviders.userId, userId)))
    .get();

  return row ?? null;
}

export async function getProviderView(
  env: Env,
  userId: string,
  providerId: string
): Promise<ProviderConnectionView | null> {
  const row = await getProviderConnection(env, userId, providerId);
  if (!row) return null;

  const db = getDb(env.DB);
  const models = await db
    .select({ id: aiModels.id })
    .from(aiModels)
    .where(and(eq(aiModels.userId, userId), eq(aiModels.providerId, providerId)))
    .all();

  return toProviderView(row, models.length);
}

export function toProviderView(row: AiProviderRow, modelCount: number): ProviderConnectionView {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    protocol: isPresetProtocol(row.protocol) ? row.protocol : 'openai_compatible',
    apiEndpoint: row.apiEndpoint,
    presetId: row.presetId,
    logoUrl: row.logoUrl,
    description: row.description,
    thinkingConfig: row.thinkingConfig,
    hasApiKey: !!row.apiKeyEncrypted,
    hasHeaders: !!row.headersJson,
    defaultInput: row.defaultInput || '["text"]',
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    modelsSyncedAt: row.modelsSyncedAt,
    modelCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createProviderConnection(
  env: Env,
  userId: string,
  input: ProviderConnectionInput
): Promise<ProviderConnectionView> {
  const preset = resolvePresetForInput(input);
  if (preset?.kind === 'workers_ai') {
    throw new AiError('AI_CONFIG_INVALID', 'Workers AI 是内置供应商，不需要创建连接');
  }

  const db = getDb(env.DB);
  const name = (input.name?.trim() || preset?.name || '').trim();
  if (!name) throw new AiError('AI_CONFIG_INVALID', '供应商名称不能为空');

  const protocol = resolveProtocol(input, preset);
  const endpoint = normalizeBaseUrl(input.apiEndpoint?.trim() || preset?.baseUrl || '');
  const headers = parseHeaders(input.headers ?? undefined);
  const encryptedKey = input.apiKey ? await encryptApiKey(env, input.apiKey) : null;
  const now = new Date().toISOString();

  if (input.isDefault) {
    await db.update(aiProviders).set({ isDefault: false }).where(eq(aiProviders.userId, userId));
  }

  const row: AiProviderRow = {
    id: crypto.randomUUID(),
    userId,
    name,
    protocol,
    apiEndpoint: endpoint,
    apiKeyEncrypted: encryptedKey,
    presetId: preset?.id ?? null,
    logoUrl: presetLogoUrl(preset) ?? null,
    headersJson: serializeHeaders(headers),
    discoveredModelsJson: null,
    modelsSyncedAt: null,
    defaultInput: JSON.stringify(preset?.defaultInput ?? ['text']),
    description: input.description ?? preset?.description ?? null,
    thinkingConfig: input.thinkingConfig ?? presetThinkingConfigJson(preset) ?? null,
    isSystem: false,
    isDefault: input.isDefault ?? false,
    isActive: input.isActive ?? true,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(aiProviders).values(row);
  return toProviderView(row, 0);
}

export async function updateProviderConnection(
  env: Env,
  userId: string,
  providerId: string,
  input: ProviderConnectionInput
): Promise<ProviderConnectionView> {
  const existing = await getProviderConnection(env, userId, providerId);
  if (!existing) throw new AiError('AI_CONFIG_INVALID', '供应商不存在');

  const preset = getProviderPreset(existing.presetId);
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new AiError('AI_CONFIG_INVALID', '供应商名称不能为空');
    updates.name = name;
  }

  if (input.apiEndpoint !== undefined) {
    updates.apiEndpoint = normalizeBaseUrl(input.apiEndpoint);
  }

  // 预设连接的协议固定；自定义连接可改
  if (!preset && input.protocol !== undefined) {
    if (!isPresetProtocol(input.protocol)) throw new AiError('AI_CONFIG_INVALID', '不支持的协议');
    updates.protocol = input.protocol;
  }

  if (input.clearHeaders) {
    updates.headersJson = null;
  } else if (input.headers !== undefined) {
    const headers = parseHeaders(input.headers);
    updates.headersJson = serializeHeaders(headers);
  }

  if (input.thinkingConfig !== undefined) {
    updates.thinkingConfig = input.thinkingConfig || null;
  }

  if (input.description !== undefined) {
    updates.description = input.description || null;
  }

  if (input.clearApiKey) {
    updates.apiKeyEncrypted = null;
  } else if (input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== '') {
    updates.apiKeyEncrypted = await encryptApiKey(env, input.apiKey);
  }

  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  if (input.isDefault) {
    await getDb(env.DB).update(aiProviders).set({ isDefault: false }).where(eq(aiProviders.userId, userId));
    updates.isDefault = true;
  } else if (input.isDefault === false) {
    updates.isDefault = false;
  }

  const db = getDb(env.DB);
  await db.update(aiProviders).set(updates).where(eq(aiProviders.id, providerId));

  const updated = await getProviderView(env, userId, providerId);
  if (!updated) throw new AiError('AI_CONFIG_INVALID', '供应商更新失败');
  return updated;
}

export interface DependentModel {
  id: string;
  name: string;
  modelId: string;
}

export async function deleteProviderConnection(
  env: Env,
  userId: string,
  providerId: string,
  cascade: boolean
): Promise<{ deletedModels: number }> {
  const existing = await getProviderConnection(env, userId, providerId);
  if (!existing) throw new AiError('AI_CONFIG_INVALID', '供应商不存在');

  const db = getDb(env.DB);
  const dependentModels = await db
    .select({ id: aiModels.id, name: aiModels.name, modelId: aiModels.modelId })
    .from(aiModels)
    .where(and(eq(aiModels.userId, userId), eq(aiModels.providerId, providerId)))
    .all();

  if (dependentModels.length > 0 && !cascade) {
    throw new AiError(
      'AI_CONFIG_INVALID',
      `该供应商下还有 ${dependentModels.length} 个模型，请先迁移或选择同时删除模型`
    );
  }

  if (dependentModels.length > 0) {
    for (const model of dependentModels) {
      await db.delete(aiModels).where(eq(aiModels.id, model.id));
    }
  }

  await db.delete(aiProviders).where(eq(aiProviders.id, providerId));
  return { deletedModels: dependentModels.length };
}

export async function setDefaultProvider(env: Env, userId: string, providerId: string): Promise<void> {
  const existing = await getProviderConnection(env, userId, providerId);
  if (!existing) throw new AiError('AI_CONFIG_INVALID', '供应商不存在');

  const db = getDb(env.DB);
  await db.update(aiProviders).set({ isDefault: false }).where(eq(aiProviders.userId, userId));
  await db
    .update(aiProviders)
    .set({ isDefault: true, updatedAt: new Date().toISOString() })
    .where(eq(aiProviders.id, providerId));
}

export function presetDefaultInput(presetId: string | null): string[] {
  const preset = getProviderPreset(presetId);
  return preset?.defaultInput ?? ['text'];
}
