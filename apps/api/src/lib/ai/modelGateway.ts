/**
 * modelGateway.ts
 * AI 模型网关 - 统一模型调用入口
 *
 * 功能:
 * - 模型路由和选择
 * - 适配器工厂（带版本化缓存）
 * - 流式输出管理
 * - 错误处理、重试（指数退避）、超时控制
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
  ThinkingParamFormat,
} from './types';
import { WorkersAiAdapter } from './adapters/workersAiAdapter';
import { OpenAiCompatibleAdapter } from './adapters/openAiCompatibleAdapter';
import { logger } from '@osshelf/shared';
import { getDb, aiModels } from '../../db';
import { eq, and } from 'drizzle-orm';
import { getAiConfigString, getAiConfigNumber } from './aiConfigService';
import { AI_LOG_MODULE } from './constants';
import { buildThinkingConfig } from './utils';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export class ModelGateway {
  private env: Env;
  private adapterCache: Map<string, { adapter: IModelAdapter; version: string }> = new Map();
  private retryConfig: { maxRetries: number; baseDelayMs: number; timeoutMs: number } | null = null;

  constructor(env: Env) {
    this.env = env;
  }

  private async getRetryConfig(): Promise<{ maxRetries: number; baseDelayMs: number; timeoutMs: number }> {
    if (this.retryConfig) return this.retryConfig;
    try {
      this.retryConfig = {
        maxRetries: await getAiConfigNumber(this.env, 'ai.request.max_retries', DEFAULT_MAX_RETRIES),
        baseDelayMs: await getAiConfigNumber(this.env, 'ai.request.retry_base_delay_ms', DEFAULT_RETRY_BASE_DELAY_MS),
        timeoutMs: await getAiConfigNumber(this.env, 'ai.request.timeout_ms', DEFAULT_REQUEST_TIMEOUT_MS),
      };
      return this.retryConfig;
    } catch {
      return {
        maxRetries: DEFAULT_MAX_RETRIES,
        baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      };
    }
  }

  async getActiveModel(userId: string): Promise<ModelConfig | null> {
    try {
      const db = getDb(this.env.DB);
      const model = await db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.userId, userId), eq(aiModels.isActive, true)))
        .get();

      if (!model) return null;
      return this.parseModelConfigWithValidation(model);
    } catch (error) {
      logger.error(AI_LOG_MODULE, 'Failed to get active model', { userId }, error);
      return null;
    }
  }

  async getModelById(modelId: string, userId: string): Promise<ModelConfig | null> {
    try {
      const db = getDb(this.env.DB);
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
      return this.parseModelConfigWithValidation(model);
    } catch (error) {
      logger.error(AI_LOG_MODULE, 'Failed to get model by ID', { modelId, userId }, error);
      return null;
    }
  }

  async getAllModels(userId: string): Promise<ModelConfig[]> {
    try {
      const db = getDb(this.env.DB);
      const models = await db.select().from(aiModels).where(eq(aiModels.userId, userId)).all();
      return models.map((m) => this.parseModelConfigWithValidation(m));
    } catch (error) {
      logger.error(AI_LOG_MODULE, 'Failed to get all models', { userId }, error);
      return [];
    }
  }

  getAdapter(modelConfig: ModelConfig): IModelAdapter {
    const cacheKey = this.buildCacheKey(modelConfig);
    const cached = this.adapterCache.get(cacheKey);

    if (cached) return cached.adapter;

    let adapter: IModelAdapter;

    switch (modelConfig.provider) {
      case 'workers_ai':
        adapter = new WorkersAiAdapter(this.env, modelConfig);
        break;
      case 'openai_compatible':
        adapter = new OpenAiCompatibleAdapter(this.env, modelConfig);
        break;
      default:
        throw new Error(`Unsupported model provider: ${modelConfig.provider}`);
    }

    const validation = adapter.validateConfig(modelConfig);
    if (!validation.valid) {
      throw new Error(`Invalid model config: ${validation.error}`);
    }

    this.adapterCache.set(cacheKey, { adapter, version: cacheKey });
    return adapter;
  }

  async chatCompletion(
    userId: string,
    request: ChatCompletionRequest,
    modelId?: string,
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    return this.callWithRetry(
      () => this.chatCompletionInternal(userId, request, modelId, signal),
      `chatCompletion(${modelId || 'active'})`
    );
  }

  async chatCompletionStream(
    userId: string,
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    options?: { modelId?: string; signal?: AbortSignal }
  ): Promise<void> {
    return this.callWithRetry(
      () => this.chatCompletionStreamInternal(userId, request, onChunk, options),
      `chatCompletionStream(${options?.modelId || 'active'})`
    );
  }

  async embedding(userId: string, request: EmbeddingRequest, modelId?: string): Promise<EmbeddingResponse> {
    return this.callWithRetry(
      () => this.embeddingInternal(userId, request, modelId),
      `embedding(${modelId || 'active'})`
    );
  }

  clearCache(): void {
    this.adapterCache.clear();
    this.retryConfig = null;
  }

  private async callWithRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    const { maxRetries, baseDelayMs } = await this.getRetryConfig();
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        const status = (error as any)?.status ?? (error as any)?.response?.status;
        const isRetryable = !status || status >= 500 || status === 429;
        const isAbort = (error as Error)?.name === 'AbortError';

        if (!isRetryable || isAbort || attempt >= maxRetries - 1) {
          throw error;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempt);
        logger.warn(AI_LOG_MODULE, `Retrying ${operation}`, { attempt: attempt + 1, delayMs, status });
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    throw lastError;
  }

  private async chatCompletionInternal(
    userId: string,
    request: ChatCompletionRequest,
    modelId?: string,
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    const modelConfig = await this.resolveModelConfig(userId, modelId);
    const adapter = this.getAdapter(modelConfig);
    this.injectSystemPrompt(request, modelConfig);

    const thinkingConfig = buildThinkingConfig(request.featureType, modelConfig);
    if (thinkingConfig && !request.extraBody) {
      request.extraBody = thinkingConfig;
    } else if (thinkingConfig && request.extraBody) {
      request.extraBody = { ...request.extraBody, ...thinkingConfig };
    }

    const timeoutSignal = await this.createTimeoutSignal(signal);

    try {
      return await adapter.chatCompletion(
        {
          ...request,
          temperature: request.temperature ?? modelConfig.temperature,
        },
        timeoutSignal.controller.signal
      );
    } finally {
      timeoutSignal.clear();
    }
  }

  private async chatCompletionStreamInternal(
    userId: string,
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    options?: { modelId?: string; signal?: AbortSignal }
  ): Promise<void> {
    const modelConfig = await this.resolveModelConfig(userId, options?.modelId);
    const adapter = this.getAdapter(modelConfig);
    this.injectSystemPrompt(request, modelConfig);

    const thinkingConfig = buildThinkingConfig(request.featureType, modelConfig);
    if (thinkingConfig && !request.extraBody) {
      request.extraBody = thinkingConfig;
    } else if (thinkingConfig && request.extraBody) {
      request.extraBody = { ...request.extraBody, ...thinkingConfig };
    }

    const timeoutSignal = await this.createTimeoutSignal(options?.signal);

    try {
      return await adapter.chatCompletionStream(
        {
          ...request,
          temperature: request.temperature ?? modelConfig.temperature,
        },
        onChunk,
        timeoutSignal.controller.signal
      );
    } finally {
      timeoutSignal.clear();
    }
  }

  private async embeddingInternal(
    userId: string,
    request: EmbeddingRequest,
    modelId?: string
  ): Promise<EmbeddingResponse> {
    const modelConfig = modelId ? await this.getModelById(modelId, userId) : await this.getActiveModel(userId);

    if (!modelConfig) {
      throw new Error('No active model configured');
    }

    const adapter = this.getAdapter(modelConfig);

    if (!adapter.embedding) {
      throw new Error(`Model ${modelConfig.modelId} does not support embedding`);
    }

    return adapter.embedding(request);
  }

  private async resolveModelConfig(userId: string, modelId?: string): Promise<ModelConfig> {
    if (modelId) {
      const config = await this.getModelById(modelId, userId);
      if (config) return config;
    }

    const activeConfig = await this.getActiveModel(userId);
    if (activeConfig) return activeConfig;

    return await this.getDefaultWorkersAiModel();
  }

  private injectSystemPrompt(request: ChatCompletionRequest, modelConfig: ModelConfig): void {
    if (modelConfig.systemPrompt && !request.messages.some((m) => m.role === 'system')) {
      request.messages.unshift({
        role: 'system',
        content: modelConfig.systemPrompt,
      });
    }
  }

  private async createTimeoutSignal(externalSignal?: AbortSignal): Promise<{
    controller: AbortController;
    timeoutId: ReturnType<typeof setTimeout>;
    clear: () => void;
  }> {
    const { timeoutMs } = await this.getRetryConfig();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      const error = new DOMException(`AI request timeout after ${timeoutMs}ms`, 'TimeoutError');
      controller.abort(error);
      logger.warn(AI_LOG_MODULE, 'Request timeout', { timeoutMs });
    }, timeoutMs);

    const clear = () => {
      clearTimeout(timeoutId);
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        clear();
        controller.abort(externalSignal.reason);
        return { controller, timeoutId, clear };
      }

      externalSignal.addEventListener(
        'abort',
        () => {
          clear();
          controller.abort(externalSignal.reason);
        },
        { once: true }
      );
    }

    return { controller, timeoutId, clear };
  }

  private buildCacheKey(config: ModelConfig): string {
    const versionPart = [
      config.modelId,
      config.apiEndpoint,
      config.apiKeyEncrypted?.slice(0, 8),
      config.updatedAt,
    ].join('|');

    let hash = 0;
    for (let i = 0; i < versionPart.length; i++) {
      const char = versionPart.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }

    return `${config.provider}:${config.id}:v${Math.abs(hash).toString(16).slice(0, 8)}`;
  }

  private async getDefaultWorkersAiModel(): Promise<ModelConfig> {
    const modelId = await getAiConfigString(this.env, 'ai.default_model.chat', '@cf/meta/llama-3.1-8b-instruct');
    const temperature = await getAiConfigNumber(this.env, 'ai.model.temperature', 0.7);

    return {
      id: 'default-workers-ai',
      userId: '',
      name: 'Workers AI 默认模型',
      provider: 'workers_ai',
      modelId,
      isActive: true,
      capabilities: ['chat'],
      temperature,
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
        description:
          'Cloudflare内置的AI服务，无需配置API密钥，直接使用。支持自定义模型ID。注意：不支持 Native Function Calling，工具调用走 Prompt-Based Fallback',
        requiresApiKey: false,
        requiresEndpoint: false,
      },
      {
        id: 'openai_compatible',
        name: 'OpenAI 兼容 API',
        description: '支持所有OpenAI兼容的API（OpenAI、Azure、Ollama、本地模型等），支持 Native Function Calling',
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
      thinkingParamFormat: raw.thinkingParamFormat as ThinkingParamFormat | undefined,
      thinkingParamName: raw.thinkingParamName as string | undefined,
      thinkingEnabledValue: raw.thinkingEnabledValue as string | undefined,
      thinkingDisabledValue: raw.thinkingDisabledValue as string | undefined,
      thinkingNestedKey: raw.thinkingNestedKey as string | undefined,
      disableThinkingForFeatures: raw.disableThinkingForFeatures as string | undefined,
      isReadonly: Boolean(raw.isReadonly),
      sortOrder: (raw.sortOrder as number) ?? 0,
    };
  }

  private parseModelConfigWithValidation(raw: Record<string, unknown>): ModelConfig {
    const config = this.parseModelConfig(raw);
    return config;
  }

  /**
   * 解析模型调用请求：优先使用用户配置的自定义模型，否则回退到 Workers AI 默认模型
   * @param userId 用户ID
   * @param modelId 模型标识（可能是数据库记录ID或Workers AI模型ID）
   * @returns 解析结果：包含类型和完整配置
   */
  async resolveModelForCall(
    userId: string,
    modelId: string
  ): Promise<{ type: 'custom'; config: ModelConfig } | { type: 'workers_ai'; modelId: string }> {
    const customModel = await this.getModelById(modelId, userId);

    if (customModel) {
      return { type: 'custom', config: customModel };
    }
    return { type: 'workers_ai', modelId };
  }
}
