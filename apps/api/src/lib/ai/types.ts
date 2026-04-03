/**
 * types.ts
 * AI模型网关类型定义
 *
 * 功能:
 * - 定义统一的模型接口
 * - 消息类型定义
 * - 流式响应类型
 */

export type ModelProvider = 'workers_ai' | 'openai_compatible' | 'anthropic' | 'custom';

export type ModelCapability = 'chat' | 'completion' | 'embedding' | 'vision' | 'function_calling';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

export interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface ModelConfig {
  id: string;
  userId: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  apiEndpoint?: string;
  apiKeyEncrypted?: string;
  isActive: boolean;
  capabilities: ModelCapability[];
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
  configJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  stop?: string[];
}

export interface ChatCompletionResponse {
  id: string;
  content: string;
  role: 'assistant';
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: 'stop' | 'length' | 'content_filter';
}

export interface StreamChunk {
  id: string;
  content: string;
  role: 'assistant';
  model: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface EmbeddingRequest {
  input: string | string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface IModelAdapter {
  readonly provider: ModelProvider;
  readonly modelName: string;

  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<void>;
  embedding?(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  validateConfig(config: ModelConfig): { valid: boolean; error?: string };
}
