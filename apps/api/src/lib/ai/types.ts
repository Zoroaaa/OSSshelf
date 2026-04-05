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
  apiKeyDecrypted?: string;
  isActive: boolean;
  capabilities: ModelCapability[];
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
  configJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AiFeatureType = 'image_caption' | 'image_tag' | 'image_analysis' | 'chat' | 'file_summary' | 'summary' | 'rename';

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  stop?: string[];
  signal?: AbortSignal;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string };
  extraBody?: Record<string, unknown>;
  featureType?: AiFeatureType;
}

export interface ChatCompletionResponse {
  id: string;
  content: string;
  role: 'assistant';
  model: string;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

export interface StreamChunk {
  id: string;
  content: string;
  role: 'assistant';
  model: string;
  done: boolean;
  reasoningContent?: string;
  toolCalls?: Array<{
    id: string;
    name?: string;
    arguments?: string;
    index: number;
  }>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface EmbeddingRequest {
  input: string | string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
}

export interface IModelAdapter {
  readonly provider: ModelProvider;
  readonly modelName: string;

  chatCompletion(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResponse>;
  chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<void>;
  embedding?(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  validateConfig(config: ModelConfig): { valid: boolean; error?: string };
}
