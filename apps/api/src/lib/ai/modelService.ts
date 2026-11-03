/**
 * modelService.ts
 * AI 模型配置读取（D1）
 *
 * 只负责 ai_models / ai_providers → ModelConfig 的读取与映射，不发起任何模型调用。
 * 模型调用统一走 modelRuntime，避免再出现第二套传输链路。
 */

import { and, eq } from 'drizzle-orm';
import { getDb, aiModels, aiProviders } from '../../db';
import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';
import { mapModelConfig } from './modelConfigMapper';
import { getAiConfigNumber, getAiConfigString } from './aiConfigService';
import type { AiProviderRow } from './providers/providerService';
import type { ModelConfig } from './types';
import { AI_LOG_MODULE } from './constants';

const DEFAULT_CHAT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_TEMPERATURE = 0.7;

async function loadProviderMap(env: Env, userId: string): Promise<Map<string, AiProviderRow>> {
  const db = getDb(env.DB);
  const providers = await db.select().from(aiProviders).where(eq(aiProviders.userId, userId)).all();
  return new Map(providers.map((provider) => [provider.id, provider]));
}

export async function getActiveModel(env: Env, userId: string): Promise<ModelConfig | null> {
  try {
    const db = getDb(env.DB);
    const model = await db
      .select()
      .from(aiModels)
      .where(and(eq(aiModels.userId, userId), eq(aiModels.isActive, true)))
      .get();

    if (!model) return null;
    const providers = await loadProviderMap(env, userId);
    return mapModelConfig(model, model.providerId ? providers.get(model.providerId) : null);
  } catch (error) {
    logger.error(AI_LOG_MODULE, 'Failed to get active model', { userId }, error);
    return null;
  }
}

export async function getModelById(env: Env, userId: string, modelId: string): Promise<ModelConfig | null> {
  try {
    const db = getDb(env.DB);
    let model = await db
      .select()
      .from(aiModels)
      .where(and(eq(aiModels.id, modelId), eq(aiModels.userId, userId)))
      .get();

    if (!model) {
      model = await db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.modelId, modelId), eq(aiModels.userId, userId)))
        .get();
    }

    if (!model) return null;
    const providers = await loadProviderMap(env, userId);
    return mapModelConfig(model, model.providerId ? providers.get(model.providerId) : null);
  } catch (error) {
    logger.error(AI_LOG_MODULE, 'Failed to get model by ID', { modelId, userId }, error);
    return null;
  }
}

export async function getAllModels(env: Env, userId: string): Promise<ModelConfig[]> {
  try {
    const db = getDb(env.DB);
    const [models, providers] = await Promise.all([
      db.select().from(aiModels).where(eq(aiModels.userId, userId)).all(),
      loadProviderMap(env, userId),
    ]);
    return models.map((model) => mapModelConfig(model, model.providerId ? providers.get(model.providerId) : null));
  } catch (error) {
    logger.error(AI_LOG_MODULE, 'Failed to get all models', { userId }, error);
    return [];
  }
}

/**
 * 合成 Workers AI 配置。
 * 用于功能配置直接填写 `@cf/...` 模型 ID 的场景（该模型未落 ai_models 表）。
 */
export async function buildWorkersAiConfig(env: Env, userId: string, modelId?: string): Promise<ModelConfig> {
  const [resolvedModelId, temperature] = await Promise.all([
    modelId ? Promise.resolve(modelId) : getAiConfigString(env, 'ai.default_model.chat', DEFAULT_CHAT_MODEL),
    getAiConfigNumber(env, 'ai.model.temperature', DEFAULT_TEMPERATURE),
  ]);
  const now = new Date().toISOString();

  return {
    id: 'default-workers-ai',
    userId,
    name: 'Workers AI 默认模型',
    provider: 'workers_ai',
    modelId: resolvedModelId,
    isActive: true,
    capabilities: ['chat'],
    temperature,
    configJson: {},
    createdAt: now,
    updatedAt: now,
  };
}
