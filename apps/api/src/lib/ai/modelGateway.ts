/**
 * modelGateway.ts
 * AI 模型网关 - 统一模型调用入口
 *
 * 功能:
 * - 模型路由和选择
 * - 适配器工厂
 * - 流式输出管理
 * - 错误处理和降级
 */

import type { Env } from '../../types/env';
import type {
  IModelAdapter,
  ModelConfig,
  ModelProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
} from './types';
import { WorkersAiAdapter } from './adapters/workersAiAdapter';
import { OpenAiCompatibleAdapter } from './adapters/openAiCompatibleAdapter';
import { logger } from '@osshelf/shared';
import { getDb, aiModels } from '../../db';
import { eq, and } from 'drizzle-orm';

export class ModelGateway {
  private env: Env;
  private adapterCache: Map<string, IModelAdapter> = new Map();

  constructor(env: Env) {
    this.env = env;
  }

  async getActiveModel(userId: string): Promise<ModelConfig | null> {
    try {
      const db = getDb(this.env.DB);
      const model = await db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.userId, userId), eq(aiModels.isActive, true)))
        .get();

      if (!model) {
        return null;
      }

      return this.parseModelConfig(model);
    } catch (error) {
      logger.error('AI', 'Failed to get active model', { userId }, error);
      return null;
    }
  }

  async getModelById(modelId: string, userId: string): Promise<ModelConfig | null> {
    try {
      const db = getDb(this.env.DB);
      const model = await db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.id, modelId), eq(aiModels.userId, userId)))
        .get();

      if (!model) {
        return null;
      }

      return this.parseModelConfig(model);
    } catch (error) {
      logger.error('AI', 'Failed to get model by ID', { modelId, userId }, error);
      return null;
    }
  }

  async getAllModels(userId: string): Promise<ModelConfig[]> {
    try {
      const db = getDb(this.env.DB);
      const models = await db.select().from(aiModels).where(eq(aiModels.userId, userId)).all();

      return models.map((m) => this.parseModelConfig(m));
    } catch (error) {
      logger.error('AI', 'Failed to get all models', { userId }, error);
      return [];
    }
  }

  getAdapter(modelConfig: ModelConfig): IModelAdapter {
    const cacheKey = `${modelConfig.provider}:${modelConfig.id}`;

    if (this.adapterCache.has(cacheKey)) {
      return this.adapterCache.get(cacheKey)!;
    }

    let adapter: IModelAdapter;

    switch (modelConfig.provider) {
      case 'workers_ai':
        adapter = new WorkersAiAdapter(this.env);
        break;
      case 'openai_compatible':
        adapter = new OpenAiCompatibleAdapter(modelConfig);
        break;
      default:
        throw new Error(`Unsupported model provider: ${modelConfig.provider}`);
    }

    const validation = adapter.validateConfig(modelConfig);
    if (!validation.valid) {
      throw new Error(`Invalid model config: ${validation.error}`);
    }

    this.adapterCache.set(cacheKey, adapter);
    return adapter;
  }

  async chatCompletion(
    userId: string,
    request: ChatCompletionRequest,
    modelId?: string
  ): Promise<ChatCompletionResponse> {
    let modelConfig = modelId
      ? await this.getModelById(modelId, userId)
      : await this.getActiveModel(userId);

    if (!modelConfig) {
      modelConfig = this.getDefaultWorkersAiModel();
    }

    const adapter = this.getAdapter(modelConfig);

    if (modelConfig.systemPrompt && !request.messages.some((m) => m.role === 'system')) {
      request.messages.unshift({
        role: 'system',
        content: modelConfig.systemPrompt,
      });
    }

    return adapter.chatCompletion({
      ...request,
      maxTokens: request.maxTokens || modelConfig.maxTokens,
      temperature: request.temperature ?? modelConfig.temperature,
    });
  }

  async chatCompletionStream(
    userId: string,
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    options?: { modelId?: string; signal?: AbortSignal }
  ): Promise<void> {
    let modelConfig = options?.modelId
      ? await this.getModelById(options.modelId, userId)
      : await this.getActiveModel(userId);

    if (!modelConfig) {
      modelConfig = this.getDefaultWorkersAiModel();
    }

    const adapter = this.getAdapter(modelConfig);

    if (modelConfig.systemPrompt && !request.messages.some((m) => m.role === 'system')) {
      request.messages.unshift({
        role: 'system',
        content: modelConfig.systemPrompt,
      });
    }

    return adapter.chatCompletionStream(
      {
        ...request,
        maxTokens: request.maxTokens || modelConfig.maxTokens,
        temperature: request.temperature ?? modelConfig.temperature,
      },
      onChunk,
      options?.signal
    );
  }

  async embedding(
    userId: string,
    request: EmbeddingRequest,
    modelId?: string
  ): Promise<EmbeddingResponse> {
    const modelConfig = modelId
      ? await this.getModelById(modelId, userId)
      : await this.getActiveModel(userId);

    if (!modelConfig) {
      throw new Error('No active model configured');
    }

    const adapter = this.getAdapter(modelConfig);

    if (!adapter.embedding) {
      throw new Error(`Model ${modelConfig.modelId} does not support embedding`);
    }

    return adapter.embedding(request);
  }

  clearCache(): void {
    this.adapterCache.clear();
  }

  private getDefaultWorkersAiModel(): ModelConfig {
    return {
      id: 'default-workers-ai',
      userId: '',
      name: 'Workers AI 默认模型',
      provider: 'workers_ai',
      modelId: '@cf/meta/llama-3.1-8b-instruct',
      isActive: true,
      capabilities: ['chat'],
      maxTokens: 4096,
      temperature: 0.7,
      configJson: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  static getAvailableProviders(): Array<{
    id: ModelProvider;
    name: string;
    description: string;
    requiresApiKey: boolean;
    requiresEndpoint: boolean;
  }> {
    return [
      {
        id: 'workers_ai',
        name: 'Cloudflare Workers AI',
        description: 'Cloudflare内置的AI服务，无需配置API密钥，直接使用',
        requiresApiKey: false,
        requiresEndpoint: false,
      },
      {
        id: 'openai_compatible',
        name: 'OpenAI 兼容 API',
        description: '支持所有OpenAI兼容的API（OpenAI、Azure、Ollama、本地模型等）',
        requiresApiKey: true,
        requiresEndpoint: true,
      },
    ];
  }

  private parseModelConfig(raw: Record<string, unknown>): ModelConfig {
    return {
      id: raw.id as string,
      userId: raw.userId as string,
      name: raw.name as string,
      provider: raw.provider as ModelProvider,
      modelId: raw.modelId as string,
      apiEndpoint: raw.apiEndpoint as string | undefined,
      apiKeyEncrypted: raw.apiKeyEncrypted as string | undefined,
      isActive: Boolean(raw.isActive),
      capabilities: JSON.parse((raw.capabilities as string) || '[]'),
      maxTokens: (raw.maxTokens as number) || 4096,
      temperature: (raw.temperature as number) || 0.7,
      systemPrompt: raw.systemPrompt as string | undefined,
      configJson: JSON.parse((raw.configJson as string) || '{}'),
      createdAt: raw.createdAt as string,
      updatedAt: raw.updatedAt as string,
    };
  }
}
