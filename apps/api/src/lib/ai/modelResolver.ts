/**
 * modelResolver.ts
 * AI SDK 模型解析：DB 配置 → LanguageModel / EmbeddingModel
 *
 * 设计:
 * - ai_models / ai_providers 仍是唯一配置源
 * - Workers AI 走 createAI({ binding })；OpenAI 兼容 / Anthropic 走官方 provider
 * - API Key 只在解析时解密，DO 实例内长期复用
 */

import { and, eq } from 'drizzle-orm';
import { embedMany, type LanguageModel } from 'ai';
import { createAI, type CloudflareLanguageModelId } from 'agents/models/ai-sdk';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getDb, aiModels } from '../../db';
import type { Env } from '../../types/env';
import type { ModelConfig } from './types';
import { AiError } from './aiErrors';
import { getAiConfigString } from './aiConfigService';
import { decryptCredential, getEncryptionKey, isAesGcmFormat } from '../crypto';
import { logger } from '@osshelf/shared';
import { MODEL_ID_FORMAT_HINT, pickSupportedModelId } from './modelId';

export const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3';

export interface ResolvedLanguageModel {
  model: LanguageModel;
  config: ModelConfig;
  modelKey: string;
}

export interface EmbeddingProvider {
  modelKey: string;
  embed(texts: string[]): Promise<number[][]>;
}

const FALLBACK_CHAT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

function parseRow(raw: Record<string, unknown>): ModelConfig {
  return {
    id: raw.id as string,
    userId: raw.userId as string,
    name: raw.name as string,
    provider: raw.provider as ModelConfig['provider'],
    providerId: raw.providerId as string | undefined,
    modelId: raw.modelId as string,
    apiEndpoint: raw.apiEndpoint as string | undefined,
    apiKeyEncrypted: raw.apiKeyEncrypted as string | undefined,
    isActive: Boolean(raw.isActive),
    capabilities: JSON.parse((raw.capabilities as string) || '[]'),
    temperature: (raw.temperature as number) || 0.7,
    systemPrompt: raw.systemPrompt as string | undefined,
    configJson: JSON.parse((raw.configJson as string) || '{}'),
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    supportsThinking: Boolean(raw.supportsThinking),
    thinkingParamFormat: raw.thinkingParamFormat as ModelConfig['thinkingParamFormat'],
    thinkingParamName: raw.thinkingParamName as string | undefined,
    thinkingEnabledValue: raw.thinkingEnabledValue as string | undefined,
    thinkingDisabledValue: raw.thinkingDisabledValue as string | undefined,
    thinkingNestedKey: raw.thinkingNestedKey as string | undefined,
    disableThinkingForFeatures: raw.disableThinkingForFeatures as string | undefined,
    isReadonly: Boolean(raw.isReadonly),
    sortOrder: (raw.sortOrder as number) ?? 0,
  };
}

export async function loadModelConfig(env: Env, userId: string, modelId?: string): Promise<ModelConfig> {
  const db = getDb(env.DB);

  if (modelId) {
    const byId = await db
      .select()
      .from(aiModels)
      .where(and(eq(aiModels.id, modelId), eq(aiModels.userId, userId)))
      .get();
    if (byId) return parseRow(byId);

    const byModelId = await db
      .select()
      .from(aiModels)
      .where(and(eq(aiModels.modelId, modelId), eq(aiModels.userId, userId)))
      .get();
    if (byModelId) return parseRow(byModelId);
  }

  const active = await db
    .select()
    .from(aiModels)
    .where(and(eq(aiModels.userId, userId), eq(aiModels.isActive, true)))
    .get();

  if (active) return parseRow(active);

  const defaultModelId = await getAiConfigString(env, 'ai.default_model.chat', FALLBACK_CHAT_MODEL);
  const now = new Date().toISOString();
  return {
    id: 'default-workers-ai',
    userId,
    name: 'Workers AI 默认模型',
    provider: 'workers_ai',
    modelId: defaultModelId,
    isActive: true,
    capabilities: ['chat'],
    temperature: 0.7,
    configJson: {},
    createdAt: now,
    updatedAt: now,
  };
}

async function resolveApiKey(env: Env, config: ModelConfig): Promise<string | undefined> {
  if (!config.apiKeyEncrypted) return undefined;

  if (!isAesGcmFormat(config.apiKeyEncrypted)) {
    return config.apiKeyEncrypted;
  }

  try {
    return await decryptCredential(config.apiKeyEncrypted, getEncryptionKey(env));
  } catch (error) {
    logger.error('AI', 'Failed to decrypt API key', { modelId: config.id }, error);
    throw new AiError('AI_CONFIG_INVALID', '模型 API Key 解密失败', { cause: error });
  }
}

export async function resolveLanguageModel(env: Env, userId: string, modelId?: string): Promise<ResolvedLanguageModel> {
  const config = await loadModelConfig(env, userId, modelId);

  switch (config.provider) {
    case 'workers_ai': {
      if (!env.AI) {
        throw new AiError('AI_CONFIG_INVALID', 'Workers AI 绑定未配置');
      }
      // 兼容历史脏数据：modelId 是 UUID 时尝试用 name 修回合法 ID
      const resolvedModelId = pickSupportedModelId(config.modelId, config.name);
      if (!resolvedModelId) {
        throw new AiError(
          'AI_CONFIG_INVALID',
          `模型「${config.name}」的 modelId「${config.modelId}」不是 Cloudflare 可识别的模型 ID，请改为 ${MODEL_ID_FORMAT_HINT}`
        );
      }
      if (resolvedModelId !== config.modelId) {
        logger.warn('AI', 'Model config modelId repaired at runtime', {
          modelRecordId: config.id,
          storedModelId: config.modelId,
          resolvedModelId,
        });
      }
      const ai = createAI({ binding: env.AI });
      return {
        model: ai(resolvedModelId as CloudflareLanguageModelId),
        config: { ...config, modelId: resolvedModelId },
        modelKey: `${config.provider}:${resolvedModelId}`,
      };
    }
    case 'openai_compatible': {
      if (!config.apiEndpoint) {
        throw new AiError('AI_CONFIG_INVALID', 'OpenAI 兼容模型缺少 API Endpoint');
      }
      const apiKey = await resolveApiKey(env, config);
      if (!apiKey) {
        throw new AiError('AI_CONFIG_INVALID', 'OpenAI 兼容模型缺少 API Key');
      }
      const provider = createOpenAICompatible({
        name: config.name || 'openai-compatible',
        baseURL: config.apiEndpoint,
        apiKey,
      });
      return {
        model: provider.languageModel(config.modelId),
        config,
        modelKey: `${config.provider}:${config.modelId}`,
      };
    }
    case 'anthropic': {
      const apiKey = await resolveApiKey(env, config);
      if (!apiKey) {
        throw new AiError('AI_CONFIG_INVALID', 'Anthropic 模型缺少 API Key');
      }
      const provider = createAnthropic({
        apiKey,
        baseURL: config.apiEndpoint || undefined,
      });
      return {
        model: provider.languageModel(config.modelId),
        config,
        modelKey: `${config.provider}:${config.modelId}`,
      };
    }
    default:
      throw new AiError('AI_CONFIG_INVALID', `不支持的模型供应商: ${config.provider}`);
  }
}

export async function resolveEmbeddingProvider(env: Env): Promise<EmbeddingProvider> {
  const modelKey = await getAiConfigString(env, 'ai.default_model.embedding', DEFAULT_EMBEDDING_MODEL);

  if (!env.AI) {
    throw new AiError('AI_CONFIG_INVALID', 'Workers AI 绑定未配置，无法生成向量');
  }

  const ai = createAI({ binding: env.AI });
  const model = ai.embedding(modelKey as Parameters<typeof ai.embedding>[0]);

  return {
    modelKey,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const result = await embedMany({ model, values: texts });
      return result.embeddings.map((embedding) => Array.from(embedding));
    },
  };
}
