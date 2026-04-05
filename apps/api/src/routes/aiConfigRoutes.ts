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
import { eq, and } from 'drizzle-orm';
import { getDb, aiModels } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { ModelGateway, WorkersAiAdapter, OpenAiCompatibleAdapter } from '../lib/ai';
import type { ModelConfig, ModelCapability } from '../lib/ai/types';
import { logger } from '@osshelf/shared';
import { encryptCredential, decryptCredential, getEncryptionKey, isAesGcmFormat } from '../lib/crypto';
import { initializeAiConfig, getAllAiConfigs, updateAiConfig, resetAiConfigToDefault } from '../lib/ai/aiConfigService';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

const createModelSchema = z
  .object({
    name: z.string().min(1).max(100),
    provider: z.enum(['workers_ai', 'openai_compatible']),
    modelId: z.string().min(1),
    apiEndpoint: z.string().max(500).optional(), // 移除 .url() 验证，改为可选字符串
    apiKey: z.string().min(1).optional(),
    capabilities: z.array(z.enum(['chat', 'completion', 'embedding', 'vision', 'function_calling'])).default(['chat']),
    maxTokens: z.number().int().min(1).max(128000).default(4096),
    temperature: z.number().min(0).max(2).default(0.7),
    systemPrompt: z.string().max(2000).optional(),
    isActive: z.boolean().default(false),
  })
  .refine(
    (data) => {
      // 仅当 provider 为 openai_compatible 且提供了 apiEndpoint 时才验证 URL 格式
      if (data.provider === 'openai_compatible' && data.apiEndpoint) {
        try {
          new URL(data.apiEndpoint);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: 'API 端点格式无效，请输入有效的 URL',
      path: ['apiEndpoint'],
    }
  );

const updateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.enum(['workers_ai', 'openai_compatible']).optional(),
  modelId: z.string().min(1).optional(),
  apiEndpoint: z.string().max(500).optional(),
  apiKey: z.union([z.string().min(1), z.literal('')]).optional(),
  capabilities: z.array(z.enum(['chat', 'completion', 'embedding', 'vision', 'function_calling'])).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
});

app.get('/models', async (c) => {
  const userId = c.get('userId')!;
  const capability = c.req.query('capability') as ModelCapability | undefined;
  const gateway = new ModelGateway(c.env);
  const models = await gateway.getAllModels(userId);

  let filteredModels = models;
  if (capability) {
    filteredModels = models.filter((m) => m.capabilities.includes(capability));
  }

  const modelsWithDecryptedKey = filteredModels.map((m) => ({
    ...m,
    apiKeyEncrypted: m.apiKeyEncrypted ? '***' : undefined,
    hasApiKey: !!m.apiKeyEncrypted,
  }));

  return c.json({
    success: true,
    data: modelsWithDecryptedKey,
  });
});

app.get('/models/:modelId', async (c) => {
  const userId = c.get('userId')!;
  const modelId = c.req.param('modelId');
  const gateway = new ModelGateway(c.env);

  const model = await gateway.getModelById(modelId, userId);

  if (!model) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '模型不存在' } }, 404);
  }

  return c.json({
    success: true,
    data: {
      ...model,
      apiKeyEncrypted: model.apiKeyEncrypted ? '***' : undefined,
      hasApiKey: !!model.apiKeyEncrypted,
    },
  });
});

app.post('/models', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createModelSchema.safeParse(body);

  if (!result.success) {
    const firstError = result.error.errors[0];
    const fieldPath = firstError.path.join('.') || 'unknown';
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `${fieldPath}: ${firstError.message}`,
        },
      },
      400
    );
  }

  const data = result.data;

  try {
    const db = getDb(c.env.DB);

    if (data.isActive) {
      await db.update(aiModels).set({ isActive: false }).where(eq(aiModels.userId, userId));
    }

    const apiKeyEncrypted = data.apiKey ? await encryptApiKey(data.apiKey, c.env) : null;

    const newModel = {
      id: crypto.randomUUID(),
      userId,
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      apiEndpoint: data.apiEndpoint || null,
      apiKeyEncrypted,
      isActive: data.isActive,
      capabilities: JSON.stringify(data.capabilities),
      maxTokens: data.maxTokens,
      temperature: data.temperature,
      systemPrompt: data.systemPrompt || null,
      configJson: '{}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.insert(aiModels).values(newModel);

    logger.info('AI', 'Model created', { userId, modelName: data.name, provider: data.provider });

    return c.json({
      success: true,
      data: {
        id: newModel.id,
        ...data,
        apiKeyEncrypted: undefined,
        hasApiKey: !!apiKeyEncrypted,
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
  const body = await c.req.json();
  const result = updateModelSchema.safeParse(body);

  if (!result.success) {
    const firstError = result.error.errors[0];
    const fieldPath = firstError.path.join('.') || 'unknown';
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `${fieldPath}: ${firstError.message}`,
        },
      },
      400
    );
  }

  const data = result.data;
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
    if (data.isActive) {
      await db.update(aiModels).set({ isActive: false }).where(eq(aiModels.userId, userId));
    }

    let apiKeyEncrypted = existingModel.apiKeyEncrypted;
    if (data.apiKey !== undefined && data.apiKey !== '') {
      apiKeyEncrypted = data.apiKey ? await encryptApiKey(data.apiKey, c.env) : null;
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.provider !== undefined) updateData.provider = data.provider;
    if (data.modelId !== undefined) updateData.modelId = data.modelId;
    if (data.apiEndpoint !== undefined) updateData.apiEndpoint = data.apiEndpoint || null;
    if (data.apiKey !== undefined) updateData.apiKeyEncrypted = apiKeyEncrypted;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.capabilities !== undefined) updateData.capabilities = JSON.stringify(data.capabilities);
    if (data.maxTokens !== undefined) updateData.maxTokens = data.maxTokens;
    if (data.temperature !== undefined) updateData.temperature = data.temperature;
    if (data.systemPrompt !== undefined) updateData.systemPrompt = data.systemPrompt || null;

    await db.update(aiModels).set(updateData).where(eq(aiModels.id, modelId));

    logger.info('AI', 'Model updated', { userId, modelId });

    return c.json({ success: true, data: { id: modelId, ...data, apiKeyEncrypted: undefined } });
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

  try {
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

app.get('/providers', (c) => {
  return c.json({
    success: true,
    data: {
      providers: ModelGateway.getAvailableProviders(),
      workersAiModels: WorkersAiAdapter.getAvailableModels(),
      openAiModels: OpenAiCompatibleAdapter.getPopularModels(),
    },
  });
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
        customApi: allModels.some((m) => m.provider === 'openai_compatible'),
        chat: true,
        embedding: isWorkersAiConfigured,
      },
    },
  });
});

// 功能级模型配置
const FEATURE_CONFIG_KEY = (userId: string) => `ai:feature-model-config:${userId}`;

// 获取功能模型配置
app.get('/feature-config', async (c) => {
  const userId = c.get('userId')!;

  try {
    const config = await c.env.KV.get(FEATURE_CONFIG_KEY(userId), 'json');

    return c.json({
      success: true,
      data: config || {
        summary: null,
        imageCaption: null,
        imageTag: null,
        rename: null,
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

// 获取各功能可用的模型列表（带能力过滤）
// 前端用此接口渲染下拉选项，避免用户选到不支持的模型
app.get('/feature-models', async (c) => {
  const userId = c.get('userId')!;
  const gateway = new ModelGateway(c.env);

  try {
    const allModels = await gateway.getAllModels(userId);

    const featureModels = {
      summary: allModels.filter((m) => m.capabilities.includes('chat')).map(formatModelForSelect),
      imageCaption: allModels.filter((m) => m.capabilities.includes('vision')).map(formatModelForSelect),
      imageTag: allModels.filter((m) => m.capabilities.includes('chat')).map(formatModelForSelect),
      rename: allModels.filter((m) => m.capabilities.includes('chat')).map(formatModelForSelect),
    };

    return c.json({
      success: true,
      data: featureModels,
    });
  } catch (error) {
    logger.error('AI Config', 'Failed to get feature models', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '获取可用模型失败' } }, 500);
  }
});

function formatModelForSelect(m: ModelConfig) {
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    modelId: m.modelId,
    capabilities: m.capabilities,
    isActive: m.isActive,
  };
}

// 各功能所需的模型能力映射
const FEATURE_CAPABILITY_REQUIREMENTS: Record<string, ModelCapability[]> = {
  summary: ['chat'],
  imageCaption: ['vision'],
  imageTag: ['chat'],
  rename: ['chat'],
};

function validateWorkersAiModel(modelId: string, requiredCapability: ModelCapability): { valid: boolean; error?: string } {
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
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '摘要模型不存在' } }, 400);
      }
      if (!m.capabilities?.includes('chat')) {
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该模型不支持 chat 能力' } }, 400);
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
            error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该模型不支持 vision 能力（需要多模态模型如 GPT-4o）' },
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
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '图片标签模型不存在' } }, 400);
      }
      if (!m.capabilities?.includes('chat')) {
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该模型不支持 chat 能力' } }, 400);
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
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '重命名模型不存在' } }, 400);
      }
      if (!m.capabilities?.includes('chat')) {
        return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '该模型不支持 chat 能力' } }, 400);
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
    await c.env.KV.put(FEATURE_CONFIG_KEY(userId), JSON.stringify(config), { expirationTtl: 86400 * 30 });

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
  const body = await c.req.json();
  const { modelId, provider, apiEndpoint, apiKey } = body as {
    modelId?: string;
    provider?: string;
    apiEndpoint?: string;
    apiKey?: string;
  };

  try {
    let testConfig: ModelConfig;

    if (modelId && modelId.trim()) {
      // 测试已保存的模型（modelId 是数据库记录 ID）
      const gateway = new ModelGateway(c.env);
      const config = await gateway.getModelById(modelId, userId);
      if (!config) {
        return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '模型不存在' } }, 404);
      }
      testConfig = config;

      // 验证配置有效性
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
    } else if (provider) {
      // 测试临时配置（保存前测试）
      const actualModelId = body.modelId || (provider === 'workers_ai' ? '@cf/meta/llama-3.1-8b-instruct' : 'gpt-4o');

      testConfig = {
        id: 'test-temp',
        userId,
        name: '测试模型',
        provider: provider as any,
        modelId: actualModelId,
        apiEndpoint: apiEndpoint || undefined,
        apiKeyEncrypted: undefined,
        apiKeyDecrypted: apiKey || undefined,
        isActive: false,
        capabilities: ['chat'],
        maxTokens: 100,
        temperature: 0.7,
        configJson: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      return c.json(
        { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '请提供 modelId 或 provider' } },
        400
      );
    }

    // 执行测试请求
    const gateway = new ModelGateway(c.env);
    const adapter = gateway.getAdapter(testConfig);

    const startTime = Date.now();
    const response = await adapter.chatCompletion({
      messages: [{ role: 'user', content: 'Hello, 请用一句话介绍你自己。' }],
      maxTokens: 100,
      temperature: 0.7,
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
    logger.error('AI Config', 'Model test failed', { userId, provider, modelId }, error);

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

async function encryptApiKey(apiKey: string, env: Env): Promise<string> {
  const secret = getEncryptionKey(env);
  return encryptCredential(apiKey, secret);
}

async function decryptApiKey(encrypted: string, env: Env): Promise<string> {
  const secret = getEncryptionKey(env);
  return decryptCredential(encrypted, secret);
}

export function decryptModelApiKey(model: ModelConfig, env: Env): ModelConfig {
  if (model.apiKeyEncrypted && isAesGcmFormat(model.apiKeyEncrypted)) {
    return {
      ...model,
      apiKeyEncrypted: undefined,
      apiKeyDecrypted: model.apiKeyEncrypted,
    } as ModelConfig & { apiKeyDecrypted?: string };
  }
  return model;
}

export async function decryptModelApiKeyAsync(
  model: ModelConfig,
  env: Env
): Promise<ModelConfig & { apiKeyDecrypted?: string }> {
  if (model.apiKeyEncrypted && isAesGcmFormat(model.apiKeyEncrypted)) {
    const decrypted = await decryptApiKey(model.apiKeyEncrypted, env);
    return {
      ...model,
      apiKeyEncrypted: undefined,
      apiKeyDecrypted: decrypted,
    };
  }
  return model as ModelConfig & { apiKeyDecrypted?: string };
}

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
