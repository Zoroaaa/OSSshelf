/**
 * modelRuntime.ts
 * AI 模型运行时：解析 → 调用 → 记账（唯一调用链路）
 *
 * 设计：
 * - 所有模型调用（Agent 流式 / 后台功能）都经由此处解析出 AI SDK LanguageModel
 * - 后台非流式调用统一走 completeText，重试、超时、思考参数、错误映射、用量记账集中在这里
 * - Agent 流式调用复用 resolveModelRuntime 与 buildProviderOptions，记账在流结束后进行
 */

import { embedMany, generateText, type LanguageModel, type ModelMessage } from 'ai';
import { createAI, type CloudflareLanguageModelId } from 'agents/models/ai-sdk';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';
import { AI_REQUEST_DEFAULTS, getAiConfigNumber, getAiConfigString } from './aiConfigService';
import { decryptCredential, getEncryptionKey, isAesGcmFormat } from '../crypto';
import { AiError, mapAiError } from './aiErrors';
import { MODEL_ID_FORMAT_HINT, pickSupportedModelId } from './modelId';
import { recordUsage } from './usage';
import { estimateTokens, extractThinkingContent } from './utils';
import { buildWorkersAiConfig, getActiveModel, getModelById } from './modelService';
import type { AiFeatureType, ChatContentPart, ChatMessage, ModelConfig, TokenUsage } from './types';
import { AI_LOG_MODULE } from './constants';

/** OpenAI 兼容 provider 的固定名称：providerOptions 的 key 由它推导，必须与 createOpenAICompatible 的 name 一致 */
const OPENAI_COMPAT_PROVIDER_NAME = 'openaiCompatible';

/** AI SDK maxRetries 表示“重试次数”，3 次重试 = 4 次尝试；默认值与 aiConfig 注册表一致 */
const DEFAULT_MAX_RETRIES = AI_REQUEST_DEFAULTS.maxRetries;
const DEFAULT_REQUEST_TIMEOUT_MS = AI_REQUEST_DEFAULTS.timeoutMs;
const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3';

/** AI SDK 未导出 ProviderOptions 类型，从 generateText 参数推导 */
type ModelProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;

export interface CompleteRequest {
  messages: ChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
  featureType?: AiFeatureType;
}

export interface CompleteResult {
  content: string;
  reasoning?: string;
  modelId: string;
  usage: TokenUsage;
}

interface ResolvedModelRuntime {
  model: LanguageModel;
  config: ModelConfig;
}

interface EmbeddingProvider {
  modelKey: string;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * 解析调用配置：显式模型 ID → 活动模型 → 默认 Workers AI。
 * 显式传入 `@cf/...` 但未落库时合成 Workers AI 配置，保留功能配置直填模型 ID 的语义。
 */
async function resolveModelConfig(env: Env, userId: string, modelId?: string): Promise<ModelConfig> {
  if (modelId) {
    const matched = await getModelById(env, userId, modelId);
    if (matched) return matched;
    if (modelId.startsWith('@cf/')) return buildWorkersAiConfig(env, userId, modelId);
  }

  const active = await getActiveModel(env, userId);
  if (active) return active;

  return buildWorkersAiConfig(env, userId);
}

function normalizeWorkersAiConfig(config: ModelConfig): ModelConfig {
  const resolvedModelId = pickSupportedModelId(config.modelId, config.name);
  if (!resolvedModelId) {
    throw new AiError(
      'AI_CONFIG_INVALID',
      `模型「${config.name}」的 modelId「${config.modelId}」不是 Cloudflare 可识别的模型 ID，请改为 ${MODEL_ID_FORMAT_HINT}`
    );
  }

  if (resolvedModelId !== config.modelId) {
    logger.warn(AI_LOG_MODULE, 'Model config modelId repaired at runtime', {
      modelRecordId: config.id,
      storedModelId: config.modelId,
      resolvedModelId,
    });
    return { ...config, modelId: resolvedModelId };
  }

  return config;
}

async function resolveApiKey(env: Env, config: ModelConfig): Promise<string | undefined> {
  if (!config.apiKeyEncrypted) return undefined;

  if (!isAesGcmFormat(config.apiKeyEncrypted)) {
    return config.apiKeyEncrypted;
  }

  try {
    return await decryptCredential(config.apiKeyEncrypted, getEncryptionKey(env));
  } catch (error) {
    throw new AiError('AI_CONFIG_INVALID', '模型 API Key 解密失败', { cause: error });
  }
}

/** ModelConfig → AI SDK LanguageModel，三种协议在这里收口 */
async function createLanguageModel(env: Env, config: ModelConfig): Promise<LanguageModel> {
  switch (config.provider) {
    case 'workers_ai': {
      if (!env.AI) {
        throw new AiError('AI_CONFIG_INVALID', 'Workers AI 绑定未配置');
      }
      const ai = createAI({ binding: env.AI });
      return ai(config.modelId as CloudflareLanguageModelId);
    }

    case 'openai_compatible': {
      if (!config.apiEndpoint) {
        throw new AiError('AI_CONFIG_INVALID', 'OpenAI 兼容模型缺少 API Endpoint');
      }
      const apiKey = await resolveApiKey(env, config);
      if (!apiKey && config.requiresApiKey !== false) {
        throw new AiError('AI_CONFIG_INVALID', 'OpenAI 兼容模型缺少 API Key');
      }
      const provider = createOpenAICompatible({
        name: OPENAI_COMPAT_PROVIDER_NAME,
        baseURL: config.apiEndpoint,
        apiKey: apiKey ?? 'not-needed',
        headers: config.headers,
      });
      return provider.languageModel(config.modelId);
    }

    case 'anthropic': {
      const apiKey = await resolveApiKey(env, config);
      if (!apiKey && config.requiresApiKey !== false) {
        throw new AiError('AI_CONFIG_INVALID', 'Anthropic 模型缺少 API Key');
      }
      const provider = createAnthropic({
        apiKey: apiKey ?? 'not-needed',
        baseURL: config.apiEndpoint || undefined,
        headers: config.headers,
      });
      return provider.languageModel(config.modelId);
    }

    default:
      throw new AiError('AI_CONFIG_INVALID', `不支持的模型供应商: ${String(config.provider)}`);
  }
}

/** 解析并创建可调用的模型实例（Agent 主链路使用） */
export async function resolveModelRuntime(env: Env, userId: string, modelId?: string): Promise<ResolvedModelRuntime> {
  const resolved = await resolveModelConfig(env, userId, modelId);
  const config = resolved.provider === 'workers_ai' ? normalizeWorkersAiConfig(resolved) : resolved;
  const model = await createLanguageModel(env, config);
  return { model, config };
}

/**
 * 思考参数 → AI SDK providerOptions。
 *
 * - OpenAI 兼容：`@ai-sdk/openai-compatible` 会把 provider 名下的未知字段原样并入请求体，
 *   与旧的 extraBody 行为等价。
 * - Anthropic：SDK 只接受 `thinking.type + budgetTokens`，启用时固定 1024。
 * - Workers AI：旧适配器本就忽略 extraBody，保持不传。
 */
export function buildProviderOptions(
  featureType: AiFeatureType = 'chat',
  config: ModelConfig
): ModelProviderOptions | undefined {
  if (!config.supportsThinking) return undefined;

  const { thinkingParamFormat, thinkingParamName, thinkingEnabledValue, thinkingDisabledValue, thinkingNestedKey } =
    config;
  if (!thinkingParamFormat || !thinkingParamName) return undefined;

  let disabledFeatures = ['image_caption', 'image_tag', 'image_analysis', 'file_summary'];
  if (config.disableThinkingForFeatures) {
    try {
      disabledFeatures = JSON.parse(config.disableThinkingForFeatures) as string[];
    } catch {
      // 配置损坏时沿用默认
    }
  }

  const enabled = !disabledFeatures.includes(featureType);
  const value = enabled ? (thinkingEnabledValue ?? 'enabled') : (thinkingDisabledValue ?? 'disabled');

  if (config.provider === 'anthropic') {
    if (!enabled) return undefined;
    return { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } } as ModelProviderOptions;
  }

  if (config.provider !== 'openai_compatible') return undefined;

  let payload: Record<string, unknown>;
  switch (thinkingParamFormat) {
    case 'boolean':
      payload = { [thinkingParamName]: value === 'true' || value === '1' };
      break;
    case 'string':
      payload = { [thinkingParamName]: value };
      break;
    case 'object':
      payload = thinkingNestedKey
        ? { [thinkingParamName]: { [thinkingNestedKey]: value } }
        : { [thinkingParamName]: value };
      break;
    default:
      return undefined;
  }

  return { [OPENAI_COMPAT_PROVIDER_NAME]: payload } as ModelProviderOptions;
}

function flattenText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

function parseDataUrl(value: string): { mediaType: string; data: string } | null {
  const match = /^data:(.+?);base64,(.+)$/s.exec(value);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function toUserContent(
  parts: ChatContentPart[]
): Array<{ type: 'text'; text: string } | { type: 'image'; image: string | URL; mediaType?: string }> {
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string | URL; mediaType?: string }> =
    [];

  for (const part of parts) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text ?? '' });
      continue;
    }

    if (part.type === 'image_url' && part.image_url?.url) {
      const dataUrl = parseDataUrl(part.image_url.url);
      if (dataUrl) {
        content.push({ type: 'image', image: dataUrl.data, mediaType: dataUrl.mediaType });
      } else {
        content.push({ type: 'image', image: new URL(part.image_url.url) });
      }
    }
  }

  return content;
}

function toModelMessages(messages: ChatMessage[]): { system?: string; messages: ModelMessage[] } {
  let system: string | undefined;
  const converted: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      const text = flattenText(message.content);
      system = system ? `${system}\n${text}` : text;
      continue;
    }

    if (message.role === 'assistant') {
      converted.push({ role: 'assistant', content: flattenText(message.content) });
      continue;
    }

    if (message.role === 'tool') {
      throw new AiError('AI_CONFIG_INVALID', '非 Agent 调用不支持 tool 消息');
    }

    converted.push({
      role: 'user',
      content:
        typeof message.content === 'string' || message.content === null
          ? (message.content ?? '')
          : toUserContent(message.content),
    });
  }

  return { system, messages: converted };
}

function injectSystemPrompt(messages: ChatMessage[], systemPrompt?: string): ChatMessage[] {
  if (!systemPrompt || messages.some((message) => message.role === 'system')) {
    return messages;
  }
  return [{ role: 'system', content: systemPrompt }, ...messages];
}

function collectPromptText(messages: ChatMessage[]): string {
  return messages.map((message) => flattenText(message.content)).join('\n');
}

function toTokenUsage(
  usage: { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number } } | undefined,
  promptText: string,
  outputText: string
): TokenUsage {
  return {
    inputTokens: usage?.inputTokens ?? estimateTokens(promptText),
    outputTokens: usage?.outputTokens ?? estimateTokens(outputText),
    cachedTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
  };
}

function createTimeoutSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException(`AI request timeout after ${timeoutMs}ms`, 'TimeoutError'));
    logger.warn(AI_LOG_MODULE, 'Request timeout', { timeoutMs });
  }, timeoutMs);

  const clear = () => clearTimeout(timeoutId);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clear();
      controller.abort(externalSignal.reason);
      return { signal: controller.signal, clear };
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

  return { signal: controller.signal, clear };
}

async function getRuntimeSettings(env: Env): Promise<{ maxRetries: number; timeoutMs: number }> {
  try {
    const [maxRetries, timeoutMs] = await Promise.all([
      getAiConfigNumber(env, 'ai.request.max_retries', DEFAULT_MAX_RETRIES),
      getAiConfigNumber(env, 'ai.request.timeout_ms', DEFAULT_REQUEST_TIMEOUT_MS),
    ]);
    return { maxRetries, timeoutMs };
  } catch {
    return { maxRetries: DEFAULT_MAX_RETRIES, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS };
  }
}

async function runCompletion(
  env: Env,
  model: LanguageModel,
  config: ModelConfig,
  request: CompleteRequest,
  options: { userId: string; signal?: AbortSignal; record: boolean }
): Promise<CompleteResult> {
  const featureType = request.featureType ?? 'chat';
  const messages = injectSystemPrompt(request.messages, config.systemPrompt);
  const { system, messages: modelMessages } = toModelMessages(messages);
  const promptText = collectPromptText(messages);

  const { maxRetries, timeoutMs } = await getRuntimeSettings(env);

  const timeoutSignal = createTimeoutSignal(timeoutMs, options.signal);
  const startedAt = Date.now();

  try {
    const result = await generateText({
      model,
      system,
      messages: modelMessages,
      temperature: request.temperature ?? config.temperature,
      providerOptions: buildProviderOptions(featureType, config),
      maxRetries,
      abortSignal: timeoutSignal.signal,
    });

    const extracted = extractThinkingContent(result.text ?? '');
    const reasoning = [result.reasoningText?.trim(), extracted.reasoning].filter(Boolean).join('\n') || undefined;
    const usage = toTokenUsage(result.usage, promptText, result.text ?? '');

    if (options.record) {
      void recordUsage(env, {
        userId: options.userId,
        feature: featureType,
        provider: config.provider,
        modelId: config.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        status: 'completed',
      });
    }

    return {
      content: extracted.content,
      reasoning,
      modelId: config.modelId,
      usage,
    };
  } catch (error) {
    const mapped = mapAiError(error);

    if (options.record) {
      void recordUsage(env, {
        userId: options.userId,
        feature: featureType,
        provider: config.provider,
        modelId: config.modelId,
        inputTokens: estimateTokens(promptText),
        outputTokens: 0,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        errorCode: mapped.code,
      });
    }

    throw mapped;
  } finally {
    timeoutSignal.clear();
  }
}

/**
 * 后台功能统一入口：解析用户配置 → AI SDK 生成 → 记账。
 */
export async function completeText(
  env: Env,
  userId: string,
  request: CompleteRequest,
  options: { modelId?: string; signal?: AbortSignal } = {}
): Promise<CompleteResult> {
  const { model, config } = await resolveModelRuntime(env, userId, options.modelId);
  return runCompletion(env, model, config, request, {
    userId,
    signal: options.signal,
    record: true,
  });
}

/**
 * 指定配置直接调用（模型连通性测试用），不解析用户配置、不记账。
 */
export async function completeTextWithConfig(
  env: Env,
  config: ModelConfig,
  request: CompleteRequest,
  options: { signal?: AbortSignal } = {}
): Promise<CompleteResult> {
  const normalized = config.provider === 'workers_ai' ? normalizeWorkersAiConfig(config) : config;
  const model = await createLanguageModel(env, normalized);
  return runCompletion(env, model, normalized, request, {
    userId: normalized.userId,
    signal: options.signal,
    record: false,
  });
}

/** 配置校验：替代三个 adapter 各自的 validateConfig */
export function validateModelConfig(config: ModelConfig): { valid: boolean; error?: string } {
  if (config.provider === 'workers_ai') {
    if (!config.modelId) return { valid: false, error: 'Workers AI 模型 ID 不能为空' };
    if (!config.modelId.startsWith('@cf/') && config.modelId !== '__custom__') {
      return { valid: false, error: 'Invalid Workers AI model ID. Must start with @cf/' };
    }
    return { valid: true };
  }

  if (!config.apiEndpoint) {
    return {
      valid: false,
      error: config.provider === 'anthropic' ? 'Anthropic 模型缺少 API Endpoint' : '请先在供应商页配置 Base URL',
    };
  }

  try {
    new URL(config.apiEndpoint);
  } catch {
    return { valid: false, error: 'Invalid API endpoint URL' };
  }

  if (!config.modelId) {
    return { valid: false, error: 'Model ID is required' };
  }

  return { valid: true };
}

/** 嵌入模型统一使用 Workers AI（向量索引与记忆召回共用） */
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
