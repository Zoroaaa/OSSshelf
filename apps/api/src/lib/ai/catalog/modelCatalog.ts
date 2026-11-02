/**
 * modelCatalog.ts
 * models.dev 快照查询 + 能力派生
 *
 * 只做纯函数查询，不做网络请求。
 */

import type { ModelCapability } from '../types';
import { MODELS_DEV_SNAPSHOT } from './modelsDevCatalog';
import type { ModelsDevModelMeta, ModelsDevProviderMeta } from './types';

export interface ModelMetadata {
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities: string[];
  capabilities: ModelCapability[];
  pricing?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
  };
  supportsThinking: boolean;
  status?: 'alpha' | 'beta' | 'deprecated';
  releaseDate?: string;
  source: 'models.dev' | 'provider' | 'manual';
}

export function getModelsDevProvider(providerId: string | undefined | null): ModelsDevProviderMeta | undefined {
  if (!providerId) return undefined;
  return MODELS_DEV_SNAPSHOT.providers[providerId];
}

export function lookupModelMetaInProvider(
  provider: ModelsDevProviderMeta | undefined | null,
  modelId: string
): ModelsDevModelMeta | undefined {
  if (!provider) return undefined;

  const exact = provider.models[modelId];
  if (exact) return exact;

  const lower = modelId.toLowerCase();
  const foundKey = Object.keys(provider.models).find((key) => key.toLowerCase() === lower);
  return foundKey ? provider.models[foundKey] : undefined;
}

export function lookupModelMeta(
  metadataProviderId: string | undefined | null,
  modelId: string
): ModelsDevModelMeta | undefined {
  return lookupModelMetaInProvider(getModelsDevProvider(metadataProviderId), modelId);
}

function isEmbeddingModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes('embed') || lower.includes('embedding');
}

interface CapabilityHints {
  hasImage?: boolean;
  hasTools?: boolean;
}

function deriveCapabilities(modelId: string, hints: CapabilityHints = {}): ModelCapability[] {
  if (isEmbeddingModel(modelId)) return ['embedding'];

  const capabilities: ModelCapability[] = ['chat', 'completion'];
  if (hints.hasImage) capabilities.push('vision');
  if (hints.hasTools) capabilities.push('function_calling');

  return capabilities;
}

export function metadataFromProviderMeta(
  provider: ModelsDevProviderMeta | undefined | null,
  modelId: string,
  fallbackInput: string[]
): ModelMetadata | null {
  const meta = lookupModelMetaInProvider(provider, modelId);
  if (!meta) return null;

  return {
    displayName: meta.name,
    contextWindow: meta.limit?.context,
    maxOutputTokens: meta.limit?.output,
    inputModalities: meta.modalities?.input ?? fallbackInput,
    capabilities: deriveCapabilities(modelId, {
      hasImage: meta.attachment === true || (meta.modalities?.input ?? []).includes('image'),
      hasTools: meta.toolCall === true,
    }),
    pricing: meta.cost
      ? {
          input: meta.cost.input,
          output: meta.cost.output,
          reasoning: meta.cost.reasoning,
          cacheRead: meta.cost.cacheRead,
        }
      : undefined,
    supportsThinking: meta.reasoning === true,
    status: meta.status,
    releaseDate: meta.releaseDate,
    source: 'models.dev',
  };
}

export function metadataFromProviderResponse(
  modelId: string,
  raw: Record<string, unknown>,
  fallbackInput: string[]
): ModelMetadata {
  const input = Array.isArray(raw.modalities)
    ? (raw.modalities as string[])
    : Array.isArray(raw.input_modalities)
      ? (raw.input_modalities as string[])
      : fallbackInput;

  const contextValue =
    typeof raw.context_length === 'number'
      ? raw.context_length
      : typeof raw.context_window === 'number'
        ? raw.context_window
        : typeof raw.max_context_length === 'number'
          ? raw.max_context_length
          : undefined;

  const maxOutputValue =
    typeof raw.max_output_tokens === 'number'
      ? raw.max_output_tokens
      : typeof raw.max_tokens === 'number'
        ? raw.max_tokens
        : undefined;

  const pricingRaw = raw.pricing as Record<string, unknown> | undefined;
  const pricing =
    pricingRaw && (typeof pricingRaw.input === 'number' || typeof pricingRaw.output === 'number')
      ? {
          input: typeof pricingRaw.input === 'number' ? pricingRaw.input : undefined,
          output: typeof pricingRaw.output === 'number' ? pricingRaw.output : undefined,
        }
      : undefined;

  const capabilities = deriveCapabilities(modelId, {
    hasImage: raw.attachment === true || input.includes('image'),
    hasTools: raw.tool_call === true || raw.supported_tools === true,
  });

  return {
    displayName: typeof raw.name === 'string' ? raw.name : undefined,
    contextWindow: contextValue,
    maxOutputTokens: maxOutputValue,
    inputModalities: input,
    capabilities,
    pricing,
    supportsThinking: raw.reasoning === true || raw.supports_reasoning === true,
    source: 'provider',
  };
}

export function manualMetadata(modelId: string, fallbackInput: string[]): ModelMetadata {
  return {
    inputModalities: fallbackInput,
    capabilities: deriveCapabilities(modelId),
    supportsThinking: false,
    source: 'manual',
  };
}

export function resolveModelMetadataFromProvider(
  provider: ModelsDevProviderMeta | undefined | null,
  modelId: string,
  fallbackInput: string[],
  providerRaw?: Record<string, unknown>
): ModelMetadata {
  const fromCatalog = metadataFromProviderMeta(provider, modelId, fallbackInput);
  if (fromCatalog) {
    // 供应商返回的上下文/价格更新时，用供应商值补齐快照缺失项
    if (providerRaw) {
      const fromProvider = metadataFromProviderResponse(modelId, providerRaw, fallbackInput);
      return {
        ...fromCatalog,
        contextWindow: fromCatalog.contextWindow ?? fromProvider.contextWindow,
        maxOutputTokens: fromCatalog.maxOutputTokens ?? fromProvider.maxOutputTokens,
        pricing: fromCatalog.pricing ?? fromProvider.pricing,
        displayName: fromCatalog.displayName ?? fromProvider.displayName,
      };
    }
    return fromCatalog;
  }

  if (providerRaw) return metadataFromProviderResponse(modelId, providerRaw, fallbackInput);
  return manualMetadata(modelId, fallbackInput);
}

/** 同步版本：只查代码内置快照 */
export function resolveModelMetadata(
  metadataProviderId: string | undefined | null,
  modelId: string,
  fallbackInput: string[],
  providerRaw?: Record<string, unknown>
): ModelMetadata {
  return resolveModelMetadataFromProvider(
    getModelsDevProvider(metadataProviderId),
    modelId,
    fallbackInput,
    providerRaw
  );
}
