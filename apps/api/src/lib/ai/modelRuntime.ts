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
import { estimateTokens, extractThinkingContent, formatBytes } from './utils';
import { buildWorkersAiConfig, getActiveModel, getModelById } from './modelService';
import { isPrivateHostname } from './providers/providerService';
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
  const config = await resolveNormalizedConfig(env, userId, modelId);
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
): Array<{ type: 'text'; text: string } | { type: 'file'; data: string | URL; mediaType: string }> {
  const content: Array<{ type: 'text'; text: string } | { type: 'file'; data: string | URL; mediaType: string }> = [];

  for (const part of parts) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text ?? '' });
      continue;
    }

    if (part.type === 'image_url' && part.image_url?.url) {
      const dataUrl = parseDataUrl(part.image_url.url);
      if (dataUrl) {
        // AI SDK v7 起 image part 已废弃，统一用 file part + mediaType
        content.push({ type: 'file', data: dataUrl.data, mediaType: dataUrl.mediaType });
      } else {
        content.push({ type: 'file', data: new URL(part.image_url.url), mediaType: 'image' });
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

function hasImageContent(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url' && !!part.image_url?.url)
  );
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const MAX_VISION_IMAGE_BYTES = 10 * 1024 * 1024;

function assertVisionImageSize(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > MAX_VISION_IMAGE_BYTES) {
    throw new AiError(
      'AI_CONFIG_INVALID',
      `图片过大（${formatBytes(bytes.byteLength)}），超过视觉模型上限 ${formatBytes(MAX_VISION_IMAGE_BYTES)}`
    );
  }
  return bytes;
}

/**
 * 将视觉输入统一转换为字节：支持 data URL 与 https 远程地址。
 * 远程地址强制 https、拒绝私网域名且不跟随重定向，避免 SSRF。
 * 超过上限时抛出明确错误，避免与"缺少图片"混淆。
 */
async function loadImageBytes(rawUrl: string): Promise<Uint8Array | null> {
  const dataUrl = parseDataUrl(rawUrl);
  if (dataUrl) return assertVisionImageSize(base64ToBytes(dataUrl.data));

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || isPrivateHostname(url.hostname)) return null;

    const response = await fetch(url, { redirect: 'manual' });
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > MAX_VISION_IMAGE_BYTES) {
      throw new AiError(
        'AI_CONFIG_INVALID',
        `图片过大（${formatBytes(contentLength)}），超过视觉模型上限 ${formatBytes(MAX_VISION_IMAGE_BYTES)}`
      );
    }

    const buffer = await response.arrayBuffer();
    return assertVisionImageSize(new Uint8Array(buffer));
  } catch (error) {
    if (error instanceof AiError) throw error;
    return null;
  }
}

async function extractWorkersAiVisionInput(
  messages: ChatMessage[]
): Promise<{ prompt: string; image: Uint8Array; sourceUrl: string } | null> {
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;

    const imageUrl = message.content.find((part) => part.type === 'image_url' && !!part.image_url?.url)?.image_url?.url;
    if (!imageUrl) continue;

    const image = await loadImageBytes(imageUrl);
    if (!image) continue;

    const prompt = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim();

    return { prompt, image, sourceUrl: imageUrl };
  }

  return null;
}

/**
 * Workers AI 视觉模型有三代输入契约，用错格式不会报错，模型会静默忽略图片：
 * - `moondream`: moondream3 是任务式接口，`{ task, image: data URI 字符串, question }` → `answer` / `caption`
 * - `native`: llava / llama-3.2-11b-vision 是旧原生接口，`{ image: number[], prompt }` → `description` / `response`
 * - `chat`: llama-4-scout、qwen3.8 等新模型只认 chat messages + `image_url`，交给 AI SDK 组装
 */
type WorkersAiVisionPath = 'native' | 'moondream' | 'chat';

function resolveWorkersAiVisionPath(modelId: string): WorkersAiVisionPath {
  if (/^@cf\/moondream\/moondream3/i.test(modelId)) return 'moondream';
  if (modelId === '@cf/llava-hf/llava-1.5-7b-hf' || modelId === '@cf/meta/llama-3.2-11b-vision-instruct') {
    return 'native';
  }
  return 'chat';
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

async function resolveNormalizedConfig(env: Env, userId: string, modelId?: string): Promise<ModelConfig> {
  const resolved = await resolveModelConfig(env, userId, modelId);
  return resolved.provider === 'workers_ai' ? normalizeWorkersAiConfig(resolved) : resolved;
}

/**
 * Workers AI 视觉响应字段在各模型族间不一致（description / response / answer / caption），
 * 有的还会套一层 result/data/output 或返回 JSON 字符串，统一在这里递归取文本。
 */
function extractVisionText(raw: unknown, depth = 0): string {
  if (raw === null || raw === undefined) return '';

  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text || depth > 2) return text;
    try {
      return extractVisionText(JSON.parse(text), depth + 1);
    } catch {
      return text;
    }
  }

  if (typeof raw !== 'object' || depth > 2) return '';
  const record = raw as Record<string, unknown>;

  for (const key of ['description', 'response', 'answer', 'caption', 'text']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  for (const key of ['result', 'data', 'output']) {
    if (record[key] !== undefined) {
      const text = extractVisionText(record[key], depth + 1);
      if (text) return text;
    }
  }

  return '';
}

/** 空内容时只透出响应字段名用于定位，避免把原始内容写进用户侧错误 */
function describeResponseKeys(raw: unknown): string {
  if (raw === null || raw === undefined) return '空响应';
  if (typeof raw !== 'object') return typeof raw;
  const keys = Object.keys(raw as Record<string, unknown>);
  return keys.length > 0 ? keys.slice(0, 8).join(',') : '无字段';
}

interface VisionInput {
  prompt: string;
  image: Uint8Array;
  sourceUrl: string;
}

async function runNativeVision(
  env: Env,
  modelId: string,
  input: VisionInput
): Promise<{ content: string; raw: unknown }> {
  const raw = await (env.AI as any).run(modelId, { image: Array.from(input.image), prompt: input.prompt });
  return { content: extractVisionText(raw), raw };
}

/** 从 Workers AI 的 SSE 文本中提取 moondream 的 answer / caption */
function extractSseText(text: string): string {
  let content = '';

  for (const line of text.split('\n')) {
    const payload = line.trim().replace(/^data:\s*/, '');
    if (!payload || payload === '[DONE]' || payload.startsWith('event:')) continue;

    try {
      const json = JSON.parse(payload) as Record<string, unknown>;
      const chunks: unknown[] = [
        ...(json.chunk && typeof json.chunk === 'object' ? [json.chunk] : []),
        ...(Array.isArray(json.output) ? json.output : []),
      ];

      for (const item of chunks) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (typeof record.answer === 'string' && record.answer.trim()) content = record.answer.trim();
        if (typeof record.caption === 'string' && record.caption.trim()) content = content || record.caption.trim();
      }

      if (typeof json.response === 'string' && json.response.trim()) content = json.response.trim();
    } catch {
      // 忽略非 JSON 事件
    }
  }

  return content;
}

/** 绑定可能返回对象、JSON 字符串或 SSE 流，统一取出文本 */
async function readVisionRawText(raw: unknown): Promise<string> {
  if (typeof raw === 'string') {
    return raw.includes('data:') ? extractSseText(raw) : extractVisionText(raw);
  }

  if (raw && typeof raw === 'object' && typeof (raw as { getReader?: unknown }).getReader === 'function') {
    const text = await new Response(raw as ReadableStream).text();
    return extractSseText(text);
  }

  return extractVisionText(raw);
}

/**
 * moondream3 任务式接口。
 * 注意：非流式调用恒返回空对象（实测 `{}`），必须用 `stream: true` 读取 SSE 的 answer/caption。
 * image 文档声明接受 data URI，绑定侧对编码敏感，data URI 取不到时再试纯 base64。
 */
async function runMoondreamVision(
  env: Env,
  modelId: string,
  input: VisionInput
): Promise<{ content: string; raw: unknown }> {
  const dataUri = input.sourceUrl;
  const rawBase64 = dataUri.startsWith('data:') ? dataUri.slice(dataUri.indexOf(',') + 1) : dataUri;
  const attempts: Array<Record<string, unknown>> = [
    { task: 'query', image: dataUri, question: input.prompt, reasoning: false, stream: true },
    { task: 'query', image: rawBase64, question: input.prompt, reasoning: false, stream: true },
  ];

  let lastRaw: unknown;
  let lastError: unknown;
  for (const payload of attempts) {
    try {
      const raw = await (env.AI as any).run(modelId, payload);
      lastRaw = raw;
      const content = await readVisionRawText(raw);
      if (content) return { content, raw };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastRaw === undefined && lastError) throw mapAiError(lastError);
  return { content: '', raw: lastRaw };
}

/**
 * 旧版 Workers AI 视觉模型的原生输入：moondream3 任务式、llava/llama-3.2-vision 的 { image, prompt }。
 * 其余视觉模型走 chat-completions（messages + image_url），由 AI SDK 组装，避免这里重复实现。
 * 记账由调用方（runWorkersAiVisionWithFallback）统一处理。
 */
async function runWorkersAiVision(
  env: Env,
  config: ModelConfig,
  request: CompleteRequest,
  options: { path: 'native' | 'moondream' }
): Promise<CompleteResult> {
  if (!env.AI) {
    throw new AiError('AI_CONFIG_INVALID', 'Workers AI 绑定未配置，无法进行视觉分析');
  }

  const input = await extractWorkersAiVisionInput(request.messages);
  if (!input) {
    throw new AiError('AI_CONFIG_INVALID', '视觉调用缺少图片内容');
  }

  try {
    const { content, raw } =
      options.path === 'moondream'
        ? await runMoondreamVision(env, config.modelId, input)
        : await runNativeVision(env, config.modelId, input);

    if (!content) {
      throw new AiError(
        'AI_UPSTREAM_ERROR',
        `视觉模型「${config.modelId}」返回空内容（响应字段：${describeResponseKeys(raw)}）`
      );
    }

    const usage: TokenUsage = {
      inputTokens: estimateTokens(input.prompt),
      outputTokens: estimateTokens(content),
    };

    return { content, modelId: config.modelId, usage };
  } catch (error) {
    throw mapAiError(error);
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
      await recordUsage(env, {
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
      await recordUsage(env, {
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

/** 视觉格式降级顺序：只对新模型（首选 chat）启用，旧模型契约已知，空结果直接算失败 */
const WORKERS_AI_VISION_FALLBACK_ORDER: WorkersAiVisionPath[] = ['native', 'moondream'];

/** 换输入格式也不可能修复的错误（配置/鉴权/限流/超时/上下文） */
const NON_FORMAT_RETRYABLE_ERRORS = new Set([
  'AI_CONFIG_INVALID',
  'AI_UNAUTHORIZED',
  'AI_RATE_LIMIT',
  'AI_TIMEOUT',
  'AI_CONTEXT_OVERFLOW',
]);

function isFormatRetryable(error: unknown): boolean {
  return !NON_FORMAT_RETRYABLE_ERRORS.has(mapAiError(error).code);
}

/**
 * Workers AI 视觉调用的格式降级链。
 *
 * 模型族更换输入契约时不会报错，只会静默忽略图片，所以新模型（首选 chat）返回空内容时
 * 依次换旧版原生格式重试；旧模型契约已知，空结果直接算失败，避免把纯文本回答当成功。
 * 成功或最终失败只记一次用量，避免降级放大配额。
 */
async function runWorkersAiVisionWithFallback(
  env: Env,
  config: ModelConfig,
  request: CompleteRequest,
  options: { userId: string; signal?: AbortSignal; record: boolean }
): Promise<CompleteResult> {
  const primary = resolveWorkersAiVisionPath(config.modelId);
  const order = primary === 'chat' ? [primary, ...WORKERS_AI_VISION_FALLBACK_ORDER] : [primary];
  const startedAt = Date.now();
  let lastError: unknown;

  for (const path of order) {
    if (options.signal?.aborted) break;

    try {
      const result =
        path === 'chat'
          ? await runCompletion(env, await createLanguageModel(env, config), config, request, {
              userId: options.userId,
              signal: options.signal,
              record: false,
            })
          : await runWorkersAiVision(env, config, request, { path });

      if (!result.content.trim()) {
        lastError = new AiError('AI_UPSTREAM_ERROR', `视觉模型「${config.modelId}」返回空内容`);
        logger.warn(AI_LOG_MODULE, 'Vision model returned empty content, trying next input format', {
          modelId: config.modelId,
          path,
        });
        continue;
      }

      if (options.record) {
        await recordUsage(env, {
          userId: options.userId,
          feature: request.featureType ?? 'chat',
          provider: config.provider,
          modelId: config.modelId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedTokens: result.usage.cachedTokens ?? 0,
          latencyMs: Date.now() - startedAt,
          status: 'completed',
        });
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isFormatRetryable(error)) break;
      logger.warn(AI_LOG_MODULE, 'Vision input format failed, trying next input format', {
        modelId: config.modelId,
        path,
      });
    }
  }

  const mapped = mapAiError(lastError ?? new AiError('AI_UPSTREAM_ERROR', '视觉模型调用失败'));
  if (options.record) {
    await recordUsage(env, {
      userId: options.userId,
      feature: request.featureType ?? 'chat',
      provider: config.provider,
      modelId: config.modelId,
      inputTokens: estimateTokens(collectPromptText(request.messages)),
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      errorCode: mapped.code,
    });
  }
  throw mapped;
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
  const config = await resolveNormalizedConfig(env, userId, options.modelId);

  if (config.provider === 'workers_ai' && hasImageContent(request.messages)) {
    return runWorkersAiVisionWithFallback(env, config, request, {
      userId,
      signal: options.signal,
      record: true,
    });
  }

  const model = await createLanguageModel(env, config);
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

  if (normalized.provider === 'workers_ai' && hasImageContent(request.messages)) {
    return runWorkersAiVisionWithFallback(env, normalized, request, {
      userId: normalized.userId,
      signal: options.signal,
      record: false,
    });
  }

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
