/**
 * modelConfigMapper.ts
 * ai_models 行 + ai_providers 行 → ModelConfig
 *
 * 单一映射入口，避免 modelResolver / modelGateway 各自维护一份 parse。
 */

import type { ModelCapability, ModelConfig, ModelProvider, ThinkingParamFormat } from './types';
import type { AiProviderRow } from './providers/providerService';
import { getProviderPreset, isPresetProtocol } from './providers/providerPresets';

function parseStringArray(value: unknown, fallback: string[] = []): string[] {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseCapabilities(value: unknown): ModelCapability[] {
  return parseStringArray(value) as ModelCapability[];
}

function parseHeaders(value: string | null | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface ProviderThinking {
  paramFormat?: ThinkingParamFormat;
  paramName?: string;
  nestedKey?: string;
  enabledValue?: string | boolean;
  disabledValue?: string | boolean;
}

function parseProviderThinking(value: string | null | undefined): ProviderThinking {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as ProviderThinking;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeProvider(value: unknown): ModelProvider {
  return value === 'workers_ai' || value === 'anthropic' || value === 'openai_compatible' ? value : 'openai_compatible';
}

export function mapModelConfig(raw: Record<string, unknown>, provider?: AiProviderRow | null): ModelConfig {
  const providerRow = provider ?? null;
  const storedProvider = normalizeProvider(raw.provider);
  const protocol: ModelProvider =
    providerRow && isPresetProtocol(providerRow.protocol) ? providerRow.protocol : storedProvider;

  const providerThinking = parseProviderThinking(providerRow?.thinkingConfig);
  const config: ModelConfig = {
    id: raw.id as string,
    userId: raw.userId as string,
    name: raw.name as string,
    provider: protocol,
    protocol,
    providerId: (raw.providerId as string | undefined) ?? undefined,
    providerName: providerRow?.name,
    providerUpdatedAt: providerRow?.updatedAt,
    requiresApiKey: providerRow ? (getProviderPreset(providerRow.presetId)?.requiresApiKey ?? false) : undefined,
    modelId: raw.modelId as string,
    apiEndpoint: providerRow?.apiEndpoint ?? undefined,
    apiKeyEncrypted: providerRow?.apiKeyEncrypted ?? undefined,
    headers: parseHeaders(providerRow?.headersJson),
    isActive: Boolean(raw.isActive),
    capabilities: parseCapabilities(raw.capabilities),
    contextWindow: (raw.contextWindow as number | undefined) ?? undefined,
    maxOutputTokens: (raw.maxOutputTokens as number | undefined) ?? undefined,
    inputModalities: parseStringArray(raw.inputModalities, ['text']),
    pricing: raw.pricingJson ? (parseJsonObject(raw.pricingJson) as ModelConfig['pricing']) : undefined,
    metadataSource: (raw.metadataSource as string | undefined) ?? undefined,
    temperature: (raw.temperature as number) || 0.7,
    systemPrompt: raw.systemPrompt as string | undefined,
    configJson: parseJsonObject(raw.configJson),
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    supportsThinking: Boolean(raw.supportsThinking),
    thinkingParamFormat: (raw.thinkingParamFormat as ThinkingParamFormat | undefined) ?? undefined,
    thinkingParamName: (raw.thinkingParamName as string | undefined) ?? undefined,
    thinkingEnabledValue: (raw.thinkingEnabledValue as string | undefined) ?? undefined,
    thinkingDisabledValue: (raw.thinkingDisabledValue as string | undefined) ?? undefined,
    thinkingNestedKey: (raw.thinkingNestedKey as string | undefined) ?? undefined,
    disableThinkingForFeatures: (raw.disableThinkingForFeatures as string | undefined) ?? undefined,
    isReadonly: Boolean(raw.isReadonly),
    sortOrder: (raw.sortOrder as number) ?? 0,
  };

  // 供应商级思考配置作为缺省值；模型级配置优先
  if (config.supportsThinking) {
    if (!config.thinkingParamFormat && providerThinking.paramFormat) {
      config.thinkingParamFormat = providerThinking.paramFormat;
    }
    if (!config.thinkingParamName && providerThinking.paramName) {
      config.thinkingParamName = providerThinking.paramName;
    }
    if (!config.thinkingNestedKey && providerThinking.nestedKey) {
      config.thinkingNestedKey = providerThinking.nestedKey;
    }
    if (!config.thinkingEnabledValue && providerThinking.enabledValue !== undefined) {
      config.thinkingEnabledValue = String(providerThinking.enabledValue);
    }
    if (!config.thinkingDisabledValue && providerThinking.disabledValue !== undefined) {
      config.thinkingDisabledValue = String(providerThinking.disabledValue);
    }
  }

  return config;
}
