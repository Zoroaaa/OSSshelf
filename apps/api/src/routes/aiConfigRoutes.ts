/**
 * aiConfigRoutes.ts
 * AI 配置管理路由
 *
 * 功能:
 * - 模型配置 CRUD
 * - API密钥加密存储
 * - 模型激活/切换
 * - 使用统计查询
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb, aiModels } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { ModelGateway, WorkersAiAdapter } from '../lib/ai';
import { getWorkersAiCatalog } from '../lib/ai/workersAiCatalog';
import { MODEL_ID_FORMAT_HINT, pickSupportedModelId } from '../lib/ai/modelId';
import { getFeatureModelConfig, saveFeatureModelConfig } from '../lib/ai/featureConfigService';
import type { ModelConfig, ModelCapability, ModelProvider } from '../lib/ai/types';
import { logger } from '@osshelf/shared';
import {
  initializeAiConfig,
  getAllAiConfigs,
  updateAiConfig,
  resetAiConfigToDefault,
  validateAiConfigValue,
} from '../lib/ai/aiConfigService';
import { getProviderPreset, getReferenceProviderPresets, isPresetProtocol } from '../lib/ai/providers/providerPresets';
import {
  createProviderConnection,
  deleteProviderConnection,
  getProviderConnection,
  listProviderConnections,
  setDefaultProvider,
  updateProviderConnection,
  parseHeadersJson,
  type AiProviderRow,
} from '../lib/ai/providers/providerService';
import {
  discoverProviderModels,
  getProviderModels,
  importProviderModels,
  testProviderConnection,
} from '../lib/ai/providers/modelDiscovery';
import {
  getCatalogStatus,
  resetCatalogSnapshot,
  resolveModelMetadataAsync,
  syncCatalogSnapshot,
} from '../lib/ai/catalog/runtimeCatalog';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

const protocolSchema = z.enum(['openai_compatible', 'anthropic']);
const capabilitySchema = z.enum(['chat', 'completion', 'embedding', 'vision', 'function_calling']);

const thinkingFields = {
  supportsThinking: z.boolean().optional(),
  thinkingParamFormat: z.enum(['object', 'boolean', 'string', '']).optional(),
  thinkingParamName: z.string().max(100).optional(),
  thinkingEnabledValue: z.string().max(100).optional(),
  thinkingDisabledValue: z.string().max(100).optional(),
  thinkingNestedKey: z.string().max(100).optional(),
  disableThinkingForFeatures: z.string().max(500).optional(),
};

const createModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.enum(['workers_ai', 'openai_compatible', 'anthropic']).optional(),
  providerId: z.string().min(1).nullable().optional(),
  modelId: z.string().min(1).max(300),
  capabilities: z.array(capabilitySchema).optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().max(4000).optional(),
  isActive: z.boolean().optional(),
  ...thinkingFields,
  sortOrder: z.number().int().min(0).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  inputModalities: z.array(z.string().max(50)).max(20).optional(),
});

const updateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.enum(['workers_ai', 'openai_compatible', 'anthropic']).optional(),
  providerId: z.string().min(1).nullable().optional(),
  modelId: z.string().min(1).max(300).optional(),
  capabilities: z.array(capabilitySchema).optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().max(4000).optional(),
  isActive: z.boolean().optional(),
  ...thinkingFields,
  sortOrder: z.number().int().min(0).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  inputModalities: z.array(z.string().max(50)).max(20).optional(),
});

// ============================================================================
// AI 供应商管理接口
// ============================================================================

const createProviderSchema = z.object({
  presetId: z.string().max(100).optional(),
  name: z.string().min(1).max(100).optional(),
  protocol: protocolSchema.optional(),
  apiEndpoint: z.string().max(500).optional(),
  apiKey: z.string().max(4000).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  thinkingConfig: z.string().max(2000).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const updateProviderSchema = createProviderSchema.extend({
  clearApiKey: z.boolean().optional(),
  clearHeaders: z.boolean().optional(),
});

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

function errorResponse(c: AppContext, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const rawStatus = (error as { status?: unknown }).status;
  const status =
    rawStatus === 400 || rawStatus === 401 || rawStatus === 403 || rawStatus === 404 || rawStatus === 409
      ? rawStatus
      : 500;

  return c.json(
    {
      success: false,
      error: {
        code: status === 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_ERROR,
        message,
      },
    },
    status
  );
}

function parseBody<T extends z.ZodTypeAny>(c: AppContext, schema: T) {
  return c.req.json().then((body) => schema.safeParse(body));
}

function parseInputModalities(value: string | null | undefined): string[] {
  if (!value) return ['text'];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : ['text'];
  } catch {
    return ['text'];
  }
}

app.get('/providers', async (c) => {
  const userId = c.get('userId')!;

  try {
    const connections = await listProviderConnections(c.env, userId);
    return c.json({
      success: true,
      data: {
        presets: getReferenceProviderPresets(),
        connections,
      },
    });
  } catch (error) {
    logger.error('AI Config', 'Failed to list providers', { userId }, error);
    return errorResponse(c, error, '获取供应商列表失败');
  }
});

app.get('/ai-providers', async (c) => {
  const userId = c.get('userId')!;

  try {
    return c.json({ success: true, data: await listProviderConnections(c.env, userId) });
  } catch (error) {
    logger.error('AI Config', 'Failed to list providers', { userId }, error);
    return errorResponse(c, error, '获取供应商列表失败');
  }
});

app.post('/providers', async (c) => {
  const userId = c.get('userId')!;
  const parsed = await parseBody(c, createProviderSchema);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `${firstError.path.join('.') || 'unknown'}: ${firstError.message}`,
        },
      },
      400
    );
  }

  try {
    const provider = await createProviderConnection(c.env, userId, parsed.data);
    logger.info('AI Config', 'Provider created', { userId, providerId: provider.id, presetId: provider.presetId });
    return c.json({ success: true, data: provider });
  } catch (error) {
    logger.error('AI Config', 'Failed to create provider', { userId }, error);
    return errorResponse(c, error, '创建供应商失败');
  }
});

app.put('/providers/:providerId', async (c) => {
  const userId = c.get('userId')!;
  const providerId = c.req.param('providerId');
  const parsed = await parseBody(c, updateProviderSchema);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `${firstError.path.join('.') || 'unknown'}: ${firstError.message}`,
        },
      },
      400
    );
  }

  try {
    const provider = await updateProviderConnection(c.env, userId, providerId, parsed.data);
    logger.info('AI Config', 'Provider updated', { userId, providerId });
    return c.json({ success: true, data: provider });
  } catch (error) {
    logger.error('AI Config', 'Failed to update provider', { userId, providerId }, error);
    return errorResponse(c, error, '更新供应商失败');
  }
});

app.delete('/providers/:providerId', async (c) => {
  const userId = c.get('userId')!;
  const providerId = c.req.param('providerId');
  const cascade = c.req.query('cascade') === '1';

  try {
    const result = await deleteProviderConnection(c.env, userId, providerId, cascade);
    logger.info('AI Config', 'Provider deleted', { userId, providerId, deletedModels: result.deletedModels });
    return c.json({ success: true, data: { message: '供应商已删除', ...result } });
  } catch (error) {
    logger.error('AI Config', 'Failed to delete provider', { userId, providerId }, error);
    return errorResponse(c, error, '删除供应商失败');
  }
});

app.post('/providers/:providerId/set-default', async (c) => {
  const userId = c.get('userId')!;
  const providerId = c.req.param('providerId');

  try {
    await setDefaultProvider(c.env, userId, providerId);
    return c.json({ success: true, data: { message: '已设为默认供应商', providerId } });
  } catch (error) {
    logger.error('AI Config', 'Failed to set default provider', { userId, providerId }, error);
    return errorResponse(c, error, '设置默认供应商失败');
  }
});

app.post('/providers/:providerId/test', async (c) => {
  const userId = c.get('userId')!;
  const providerId = c.req.param('providerId');
  const provider = await getProviderConnection(c.env, userId, providerId);

  if (!provider) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '供应商不存在' } }, 404);
  }

  const result = await testProviderConnection(c.env, provider);
  return c.json({ success: true, data: result });
});

app.post('/providers/:providerId/discover', async (c) => {
  const userId = c.get('userId')!;
  const providerId = c.req.param('providerId');
  const provider = await getProviderConnection(c.env, userId, providerId);

  if (!provider) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '供应商不存在' } }, 404);
  }

  try {
    const result = await discoverProviderModels(c.env, userId, provider, {
      refresh: c.req.query('refresh') === '1',
    });
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('AI Config', 'Failed to discover models', { userId, providerId }, error);
    return errorResponse(c, error, '获取模型列表失败');
  }
});

app.get('/providers/:providerId/models', async (c) => {
  const userId = c.get('userId')!;
  const providerId = c.req.param('providerId');
  const provider = await getProviderConnection(c.env, userId, providerId);

  if (!provider) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '供应商不存在' } }, 404);
  }

  try {
    const result = await getProviderModels(c.env, userId, provider, {
      refresh: c.req.query('refresh') === '1',
    });
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('AI Config', 'Failed to get provider models', { userId, providerId }, error);
    return errorResponse(c, error, '获取模型列表失败');
  }
});

const importModelsSchema = z.object({
  modelIds: z.array(z.string().min(1).max(300)).min(1).max(500),
});

app.post('/providers/:providerId/models', async (c) => {
  const userId = c.get('userId')!;
  const providerId = c.req.param('providerId');
  const provider = await getProviderConnection(c.env, userId, providerId);

  if (!provider) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '供应商不存在' } }, 404);
  }

  const parsed = await parseBody(c, importModelsSchema);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请选择要导入的模型' } },
      400
    );
  }

  try {
    const result = await importProviderModels(c.env, userId, provider, parsed.data.modelIds);
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('AI Config', 'Failed to import models', { userId, providerId }, error);
    return errorResponse(c, error, '导入模型失败');
  }
});

// ============================================================================
// models.dev 运行时快照
// ============================================================================

app.get('/catalog-status', async (c) => {
  try {
    return c.json({ success: true, data: await getCatalogStatus(c.env) });
  } catch (error) {
    logger.error('AI Config', 'Failed to get catalog status', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(c, error, '获取目录状态失败');
  }
});

app.post('/catalog-sync', async (c) => {
  try {
    const status = await syncCatalogSnapshot(c.env);
    logger.info('AI Config', 'Catalog snapshot synced', {
      providerCount: status.providerCount,
      modelCount: status.modelCount,
    });
    return c.json({ success: true, data: status });
  } catch (error) {
    logger.error('AI Config', 'Failed to sync catalog snapshot', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(c, error, '拉取 models.dev 快照失败');
  }
});

app.delete('/catalog-snapshot', async (c) => {
  try {
    return c.json({ success: true, data: await resetCatalogSnapshot(c.env) });
  } catch (error) {
    logger.error('AI Config', 'Failed to reset catalog snapshot', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(c, error, '恢复内置快照失败');
  }
});

// ============================================================================
// 模型管理接口
// ============================================================================

app.get('/models', async (c) => {
  const userId = c.get('userId')!;
  const capability = c.req.query('capability') as ModelCapability | undefined;
  const providerId = c.req.query('providerId');
  const gateway = new ModelGateway(c.env);
  const models = await gateway.getAllModels(userId);

  let filteredModels = models;
  if (capability) {
    filteredModels = models.filter((m) => m.capabilities.includes(capability));
  }
  if (providerId) {
    filteredModels = filteredModels.filter((m) => m.providerId === providerId);
  }

  const data = filteredModels.map((model) => {
    const { apiKeyEncrypted, ...safe } = model;
    return {
      ...safe,
      headers: undefined,
      hasApiKey: !!apiKeyEncrypted,
    };
  });

  return c.json({ success: true, data });
});

app.post('/models', async (c) => {
  const userId = c.get('userId')!;
  const parsed = await parseBody(c, createModelSchema);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `${firstError.path.join('.') || 'unknown'}: ${firstError.message}`,
        },
      },
      400
    );
  }

  const data = parsed.data;
  const isWorkersAi = data.provider === 'workers_ai' || (!data.providerId && !data.provider);

  if (!isWorkersAi && !data.providerId) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '外部模型必须选择供应商连接' } },
      400
    );
  }

  let providerRow: AiProviderRow | null = null;
  if (!isWorkersAi) {
    const providerId = data.providerId;
    if (!providerId) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '外部模型必须选择供应商连接' } },
        400
      );
    }
    providerRow = await getProviderConnection(c.env, userId, providerId);
    if (!providerRow) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '供应商不存在' } }, 404);
    }
  }

  let modelId = data.modelId;
  if (isWorkersAi) {
    const resolvedModelId = pickSupportedModelId(modelId, data.name);
    if (!resolvedModelId) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `模型 ID「${modelId}」不是 Cloudflare 可识别的格式，请填写 ${MODEL_ID_FORMAT_HINT}`,
          },
        },
        400
      );
    }
    modelId = resolvedModelId;
  }

  const db = getDb(c.env.DB);
  if (providerRow) {
    const duplicated = await db
      .select({ id: aiModels.id })
      .from(aiModels)
      .where(and(eq(aiModels.userId, userId), eq(aiModels.providerId, providerRow.id), eq(aiModels.modelId, modelId)))
      .get();
    if (duplicated) {
      return c.json({ success: false, error: { code: 'DUPLICATE_MODEL', message: '该模型已添加' } }, 409);
    }
  }

  const preset = providerRow ? getProviderPreset(providerRow.presetId) : undefined;
  const metadataProviderId = isWorkersAi ? 'cloudflare-workers-ai' : preset?.metadataProviderId;
  const metadata = await resolveModelMetadataAsync(
    c.env,
    metadataProviderId,
    modelId,
    providerRow ? parseInputModalities(providerRow.defaultInput) : ['text']
  );

  const providerProtocol: ModelProvider = isWorkersAi
    ? 'workers_ai'
    : providerRow && isPresetProtocol(providerRow.protocol)
      ? providerRow.protocol
      : 'openai_compatible';

  try {
    if (data.isActive) {
      await db.update(aiModels).set({ isActive: false }).where(eq(aiModels.userId, userId));
    }

    const now = new Date().toISOString();
    const newModel = {
      id: crypto.randomUUID(),
      userId,
      providerId: isWorkersAi ? null : (providerRow?.id ?? null),
      name: data.name ?? metadata.displayName ?? modelId,
      provider: providerProtocol,
      modelId,
      contextWindow: data.contextWindow ?? metadata.contextWindow ?? null,
      maxOutputTokens: data.maxOutputTokens ?? metadata.maxOutputTokens ?? null,
      inputModalities: JSON.stringify(data.inputModalities ?? metadata.inputModalities),
      pricingJson: metadata.pricing ? JSON.stringify(metadata.pricing) : null,
      metadataSource: metadata.source,
      isActive: data.isActive ?? false,
      capabilities: JSON.stringify(data.capabilities ?? metadata.capabilities),
      temperature: data.temperature ?? 0.7,
      systemPrompt: data.systemPrompt ?? null,
      configJson: '{}',
      supportsThinking: data.supportsThinking ?? metadata.supportsThinking,
      thinkingParamFormat: data.thinkingParamFormat || null,
      thinkingParamName: data.thinkingParamName || null,
      thinkingEnabledValue: data.thinkingEnabledValue || null,
      thinkingDisabledValue: data.thinkingDisabledValue || null,
      thinkingNestedKey: data.thinkingNestedKey || null,
      disableThinkingForFeatures: data.disableThinkingForFeatures || null,
      isReadonly: false,
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(aiModels).values(newModel);

    logger.info('AI', 'Model created', { userId, modelName: newModel.name, provider: providerProtocol });

    return c.json({
      success: true,
      data: {
        ...newModel,
        capabilities: data.capabilities ?? metadata.capabilities,
        inputModalities: data.inputModalities ?? metadata.inputModalities,
        hasApiKey: !!providerRow?.apiKeyEncrypted,
      },
    });
  } catch (error) {
    logger.error('AI', 'Failed to create model', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '创建模型失败' } }, 500);
  }
});

app.put('/models/:modelId', async (c) => {
  const userId = c.get('userId')!;
  const modelId = c.req.param('modelId');
  const parsed = await parseBody(c, updateModelSchema);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `${firstError.path.join('.') || 'unknown'}: ${firstError.message}`,
        },
      },
      400
    );
  }

  const data = parsed.data;
  const db = getDb(c.env.DB);

  const existingModel = await db
    .select()
    .from(aiModels)
    .where(and(eq(aiModels.id, modelId), eq(aiModels.userId, userId)))
    .get();

  if (!existingModel) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '模型不存在' } }, 404);
  }

  const nextProviderId = data.providerId !== undefined ? data.providerId : existingModel.providerId;
  const nextIsWorkersAi = data.provider === 'workers_ai' || !nextProviderId;

  let providerRow: AiProviderRow | null = null;
  if (nextProviderId) {
    providerRow = await getProviderConnection(c.env, userId, nextProviderId);
    if (!providerRow) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '供应商不存在' } }, 404);
    }
  }

  let nextModelId = data.modelId ?? existingModel.modelId;
  if (nextIsWorkersAi) {
    const resolvedModelId = pickSupportedModelId(nextModelId, data.name, existingModel.name);
    if (!resolvedModelId) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `模型 ID「${nextModelId}」不是 Cloudflare 可识别的格式，请填写 ${MODEL_ID_FORMAT_HINT}`,
          },
        },
        400
      );
    }
    nextModelId = resolvedModelId;
  }

  const preset = providerRow ? getProviderPreset(providerRow.presetId) : undefined;
  const metadata = await resolveModelMetadataAsync(
    c.env,
    nextIsWorkersAi ? 'cloudflare-workers-ai' : preset?.metadataProviderId,
    nextModelId,
    providerRow ? parseInputModalities(providerRow.defaultInput) : ['text']
  );

  try {
    if (data.isActive) {
      await db.update(aiModels).set({ isActive: false }).where(eq(aiModels.userId, userId));
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      providerId: nextProviderId ?? null,
      provider: nextIsWorkersAi
        ? 'workers_ai'
        : providerRow && isPresetProtocol(providerRow.protocol)
          ? providerRow.protocol
          : 'openai_compatible',
      modelId: nextModelId,
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.temperature !== undefined) updateData.temperature = data.temperature;
    if (data.systemPrompt !== undefined) updateData.systemPrompt = data.systemPrompt || null;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

    if (data.capabilities !== undefined) {
      updateData.capabilities = JSON.stringify(data.capabilities);
    } else if (data.modelId !== undefined) {
      updateData.capabilities = JSON.stringify(metadata.capabilities);
    }

    if (data.contextWindow !== undefined) {
      updateData.contextWindow = data.contextWindow;
    } else if (data.modelId !== undefined) {
      updateData.contextWindow = metadata.contextWindow ?? null;
    }

    if (data.maxOutputTokens !== undefined) {
      updateData.maxOutputTokens = data.maxOutputTokens;
    } else if (data.modelId !== undefined) {
      updateData.maxOutputTokens = metadata.maxOutputTokens ?? null;
    }

    if (data.inputModalities !== undefined) {
      updateData.inputModalities = JSON.stringify(data.inputModalities);
    } else if (data.modelId !== undefined) {
      updateData.inputModalities = JSON.stringify(metadata.inputModalities);
    }

    if (data.modelId !== undefined) {
      updateData.pricingJson = metadata.pricing ? JSON.stringify(metadata.pricing) : null;
      updateData.metadataSource = metadata.source;
    }

    if (data.supportsThinking !== undefined) updateData.supportsThinking = data.supportsThinking;
    else if (data.modelId !== undefined) updateData.supportsThinking = metadata.supportsThinking;

    if (data.thinkingParamFormat !== undefined) updateData.thinkingParamFormat = data.thinkingParamFormat || null;
    if (data.thinkingParamName !== undefined) updateData.thinkingParamName = data.thinkingParamName || null;
    if (data.thinkingEnabledValue !== undefined) updateData.thinkingEnabledValue = data.thinkingEnabledValue || null;
    if (data.thinkingDisabledValue !== undefined) updateData.thinkingDisabledValue = data.thinkingDisabledValue || null;
    if (data.thinkingNestedKey !== undefined) updateData.thinkingNestedKey = data.thinkingNestedKey || null;
    if (data.disableThinkingForFeatures !== undefined)
      updateData.disableThinkingForFeatures = data.disableThinkingForFeatures || null;

    await db.update(aiModels).set(updateData).where(eq(aiModels.id, modelId));

    logger.info('AI', 'Model updated', { userId, modelId });

    return c.json({
      success: true,
      data: { id: modelId, ...updateData, hasApiKey: !!providerRow?.apiKeyEncrypted },
    });
  } catch (error) {
    logger.error('AI', 'Failed to update model', { userId, modelId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '更新模型失败' } }, 500);
  }
});

app.delete('/models/:modelId', async (c) => {
  const userId = c.get('userId')!;
  const modelId = c.req.param('modelId');
  const db = getDb(c.env.DB);

  const existingModel = await db
    .select()
    .from(aiModels)
    .where(and(eq(aiModels.id, modelId), eq(aiModels.userId, userId)))
    .get();

  if (!existingModel) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '模型不存在' } }, 404);
  }

  try {
    await db.delete(aiModels).where(eq(aiModels.id, modelId));

    logger.info('AI', 'Model deleted', { userId, modelId });

    return c.json({ success: true, data: { message: '模型已删除' } });
  } catch (error) {
    logger.error('AI', 'Failed to delete model', { userId, modelId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '删除模型失败' } }, 500);
  }
});

app.post('/models/:modelId/activate', async (c) => {
  const userId = c.get('userId')!;
  const modelId = c.req.param('modelId');
  const db = getDb(c.env.DB);

  const modelToActivate = await db
    .select()
    .from(aiModels)
    .where(and(eq(aiModels.id, modelId), eq(aiModels.userId, userId)))
    .get();

  if (!modelToActivate) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '模型不存在' } }, 404);
  }

  let repairedModelId: string | undefined;
  if (modelToActivate.provider === 'workers_ai') {
    const resolvedModelId = pickSupportedModelId(modelToActivate.modelId, modelToActivate.name);
    if (!resolvedModelId) {
      return c.json(
        {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `模型「${modelToActivate.name}」的 modelId「${modelToActivate.modelId}」不是 Cloudflare 可识别的模型 ID，请先编辑为 ${MODEL_ID_FORMAT_HINT}`,
          },
        },
        400
      );
    }
    if (resolvedModelId !== modelToActivate.modelId) repairedModelId = resolvedModelId;
  }

  try {
    if (repairedModelId) {
      await db
        .update(aiModels)
        .set({ modelId: repairedModelId, updatedAt: new Date().toISOString() })
        .where(eq(aiModels.id, modelId));
      logger.warn('AI', 'Model modelId repaired on activation', {
        userId,
        modelId,
        storedModelId: modelToActivate.modelId,
        resolvedModelId: repairedModelId,
      });
    }

    await db.update(aiModels).set({ isActive: false }).where(eq(aiModels.userId, userId));
    await db
      .update(aiModels)
      .set({ isActive: true, updatedAt: new Date().toISOString() })
      .where(eq(aiModels.id, modelId));

    logger.info('AI', 'Model activated', { userId, modelId });

    return c.json({ success: true, data: { message: '模型已激活', activeModelId: modelId } });
  } catch (error) {
    logger.error('AI', 'Failed to activate model', { userId, modelId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '激活模型失败' } }, 500);
  }
});

/** Workers AI 实时模型目录：含参数与价格字段，未配置凭据时回退内置清单 */
app.get('/workers-ai/models', async (c) => {
  const refresh = c.req.query('refresh') === '1';
  const catalog = await getWorkersAiCatalog(c.env, { refresh });
  return c.json({ success: true, data: catalog });
});

app.get('/status', async (c) => {
  const userId = c.get('userId')!;
  const gateway = new ModelGateway(c.env);

  const activeModel = await gateway.getActiveModel(userId);
  const allModels = await gateway.getAllModels(userId);
  const isWorkersAiConfigured = !!(c.env.AI && c.env.VECTORIZE);

  return c.json({
    success: true,
    data: {
      configured: allModels.length > 0 || isWorkersAiConfigured,
      queueConfigured: !!c.env.AI_TASKS_QUEUE,
      activeModel: activeModel
        ? {
            id: activeModel.id,
            name: activeModel.name,
            provider: activeModel.provider,
            modelId: activeModel.modelId,
          }
        : null,
      totalModels: allModels.length,
      features: {
        workersAi: isWorkersAiConfigured,
        customApi: allModels.some((m) => m.provider !== 'workers_ai'),
        chat: true,
        embedding: isWorkersAiConfigured,
      },
    },
  });
});

// 功能级模型配置
// 获取功能模型配置
app.get('/feature-config', async (c) => {
  const userId = c.get('userId')!;

  try {
    const config = await getFeatureModelConfig(c.env, userId);

    return c.json({
      success: true,
      data: {
        summary: config.summary ?? null,
        imageCaption: config.imageCaption ?? null,
        imageTag: config.imageTag ?? null,
        rename: config.rename ?? null,
      },
    });
  } catch (error) {
    logger.error('AI Config', 'Failed to get feature config', { userId }, error);
    return c.json(
      {
        success: false,
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: '获取配置失败' },
      },
      500
    );
  }
});

function validateWorkersAiModel(
  modelId: string,
  requiredCapability: ModelCapability
): { valid: boolean; error?: string } {
  const workersAiModels = WorkersAiAdapter.getAvailableModels();
  const model = workersAiModels.find((m) => m.id === modelId);
  if (!model) {
    return { valid: false, error: 'Workers AI 模型不存在' };
  }
  if (!model.capabilities.includes(requiredCapability)) {
    return { valid: false, error: `该模型不支持 ${requiredCapability} 能力` };
  }
  return { valid: true };
}

// 保存功能模型配置
app.put('/feature-config', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const { summary, imageCaption, imageTag, rename } = body as {
    summary?: string | null;
    imageCaption?: string | null;
    imageTag?: string | null;
    rename?: string | null;
  };

  const gateway = new ModelGateway(c.env);

  if (summary) {
    if (summary.startsWith('@cf/')) {
      const result = validateWorkersAiModel(summary, 'chat');
      if (!result.valid) {
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } }, 400);
      }
    } else {
      const m = await gateway.getModelById(summary, userId);
      if (!m) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '摘要模型不存在' } },
          400
        );
      }
      if (!m.capabilities?.includes('chat')) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该模型不支持 chat 能力' } },
          400
        );
      }
    }
  }

  if (imageCaption) {
    if (imageCaption.startsWith('@cf/')) {
      const result = validateWorkersAiModel(imageCaption, 'vision');
      if (!result.valid) {
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } }, 400);
      }
    } else {
      const m = await gateway.getModelById(imageCaption, userId);
      if (!m) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '图片描述模型不存在' } },
          400
        );
      }
      if (!m.capabilities?.includes('vision')) {
        return c.json(
          {
            success: false,
            error: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: '该模型不支持 vision 能力（需要多模态模型如 GPT-4o）',
            },
          },
          400
        );
      }
    }
  }

  if (imageTag) {
    if (imageTag.startsWith('@cf/')) {
      const result = validateWorkersAiModel(imageTag, 'vision');
      if (!result.valid) {
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } }, 400);
      }
    } else {
      const m = await gateway.getModelById(imageTag, userId);
      if (!m) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '图片标签模型不存在' } },
          400
        );
      }
      if (!m.capabilities?.includes('chat')) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该模型不支持 chat 能力' } },
          400
        );
      }
    }
  }

  if (rename) {
    if (rename.startsWith('@cf/')) {
      const result = validateWorkersAiModel(rename, 'chat');
      if (!result.valid) {
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error } }, 400);
      }
    } else {
      const m = await gateway.getModelById(rename, userId);
      if (!m) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '重命名模型不存在' } },
          400
        );
      }
      if (!m.capabilities?.includes('chat')) {
        return c.json(
          { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该模型不支持 chat 能力' } },
          400
        );
      }
    }
  }

  const config = {
    summary: summary || null,
    imageCaption: imageCaption || null,
    imageTag: imageTag || null,
    rename: rename || null,
  };

  try {
    await saveFeatureModelConfig(c.env, userId, {
      summary: config.summary ?? undefined,
      imageCaption: config.imageCaption ?? undefined,
      imageTag: config.imageTag ?? undefined,
      rename: config.rename ?? undefined,
    });

    logger.info('AI Config', 'Feature model config saved', { userId, config });

    return c.json({
      success: true,
      data: { message: '功能模型配置已保存', config },
    });
  } catch (error) {
    logger.error('AI Config', 'Failed to save feature config', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '保存配置失败' } }, 500);
  }
});

// 测试模型连接
app.post('/test', async (c) => {
  const userId = c.get('userId')!;
  const body = (await c.req.json()) as {
    modelId?: string;
    providerId?: string;
  };

  try {
    let testConfig: ModelConfig;

    if (body.modelId && !body.providerId) {
      // 测试已保存的模型（modelId 是数据库记录 ID 或模型标识）
      const gateway = new ModelGateway(c.env);
      const config = await gateway.getModelById(body.modelId, userId);
      if (!config) {
        return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '模型不存在' } }, 404);
      }
      testConfig = config;

      const adapter = gateway.getAdapter(testConfig);
      const validation = adapter.validateConfig(testConfig);
      if (!validation.valid) {
        return c.json(
          {
            success: false,
            error: { code: ERROR_CODES.VALIDATION_ERROR, message: validation.error || '配置无效' },
            data: { valid: false, error: validation.error },
          },
          400
        );
      }
    } else if (body.providerId && body.modelId) {
      // 保存前测试：用供应商连接 + 模型 ID 组装临时配置
      const providerRow = await getProviderConnection(c.env, userId, body.providerId);
      if (!providerRow) {
        return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '供应商不存在' } }, 404);
      }

      const preset = getProviderPreset(providerRow.presetId);
      const metadata = await resolveModelMetadataAsync(
        c.env,
        preset?.metadataProviderId,
        body.modelId,
        parseInputModalities(providerRow.defaultInput)
      );

      testConfig = {
        id: 'test-temp',
        userId,
        name: metadata.displayName ?? body.modelId,
        provider: isPresetProtocol(providerRow.protocol) ? providerRow.protocol : 'openai_compatible',
        providerId: providerRow.id,
        providerName: providerRow.name,
        providerUpdatedAt: providerRow.updatedAt,
        requiresApiKey: preset?.requiresApiKey ?? false,
        modelId: body.modelId,
        apiEndpoint: providerRow.apiEndpoint ?? undefined,
        apiKeyEncrypted: providerRow.apiKeyEncrypted ?? undefined,
        headers: parseHeadersJson(providerRow.headersJson),
        isActive: false,
        capabilities: metadata.capabilities,
        contextWindow: metadata.contextWindow,
        maxOutputTokens: metadata.maxOutputTokens,
        inputModalities: metadata.inputModalities,
        pricing: metadata.pricing,
        metadataSource: metadata.source,
        temperature: 0.7,
        supportsThinking: metadata.supportsThinking,
        configJson: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      return c.json(
        {
          success: false,
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请提供 modelId，或 providerId + modelId' },
        },
        400
      );
    }

    if (testConfig.provider === 'workers_ai') {
      const resolvedModelId = pickSupportedModelId(testConfig.modelId, testConfig.name);
      if (!resolvedModelId) {
        return c.json(
          {
            success: false,
            error: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: `模型 ID「${testConfig.modelId}」不是 Cloudflare 可识别的格式，请填写 ${MODEL_ID_FORMAT_HINT}`,
            },
          },
          400
        );
      }
      testConfig.modelId = resolvedModelId;
    }

    // 执行测试请求
    const gateway = new ModelGateway(c.env);
    const adapter = gateway.getAdapter(testConfig);

    const startTime = Date.now();
    const response = await adapter.chatCompletion({
      messages: [{ role: 'user', content: 'Hello, 请用一句话介绍你自己。' }],
    });
    const latencyMs = Date.now() - startTime;

    return c.json({
      success: true,
      data: {
        valid: true,
        response: response.content,
        model: response.model,
        latencyMs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error(
      'AI Config',
      'Model test failed',
      { userId, providerId: body.providerId, modelId: body.modelId },
      error
    );

    const errorMessage = error instanceof Error ? error.message : '测试失败';
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: `模型测试失败: ${errorMessage}`,
        },
        data: {
          valid: false,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        },
      },
      500
    );
  }
});

// AI功能配置表相关接口

// 获取所有AI配置项
app.get('/system-config', async (c) => {
  try {
    await initializeAiConfig(c.env);
    const configs = await getAllAiConfigs(c.env);

    return c.json({
      success: true,
      data: configs,
    });
  } catch (error) {
    logger.error('AI Config', 'Failed to get system config', { error: String(error) });
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '获取系统配置失败' } }, 500);
  }
});

// 更新单个AI配置项
app.put('/system-config/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json();
  const { value } = body as { value: unknown };

  try {
    await initializeAiConfig(c.env);
    const config = (await getAllAiConfigs(c.env)).find((item) => item.key === key);

    if (!config) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '配置项不存在' } }, 404);
    }

    const validation = validateAiConfigValue(config, value);
    if (!validation.valid) {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: validation.error || '配置值无效' } },
        400
      );
    }

    const success = await updateAiConfig(c.env, key, value as string | number | boolean | object | null);

    if (!success) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '配置项不存在或不可编辑' } }, 404);
    }

    return c.json({
      success: true,
      data: { message: '配置已更新', key },
    });
  } catch (error) {
    logger.error('AI Config', 'Failed to update system config', { key, error: String(error) });
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '更新配置失败' } }, 500);
  }
});

// 重置单个配置为默认值
app.post('/system-config/:key/reset', async (c) => {
  const key = c.req.param('key');

  try {
    const success = await resetAiConfigToDefault(c.env, key);

    if (!success) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '配置项不存在' } }, 404);
    }

    return c.json({
      success: true,
      data: { message: '配置已重置为默认值', key },
    });
  } catch (error) {
    logger.error('AI Config', 'Failed to reset system config', { key, error: String(error) });
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '重置配置失败' } }, 500);
  }
});

export default app;
