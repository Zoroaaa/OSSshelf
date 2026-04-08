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

export type ThinkingParamFormat = 'object' | 'boolean' | 'string' | '';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * 模型配置接口
 *
 * 字段说明：
 * - capabilities: 核心能力标识数组，用于功能路由（决定模型可用于哪些业务场景）
 *   例如：['chat', 'vision', 'function_calling'] 表示模型可用于对话、图片理解和工具调用
 *   注意：vision 和 function_calling 能力已包含在 capabilities 中，无需额外的 supportsVision/supportsFunctionCalling 字段
 *
 * - supportsThinking: 思考模式特性开关，控制是否启用深度推理参数（如 thinking.type = enabled）
 * - supportsStreaming: 流式输出特性开关，控制是否支持流式响应
 *
 * 设计原则：
 * - capabilities 描述模型"能做什么"（固有属性）
 * - supportsXxx 描述特性"如何配置"（运行时开关）
 */
export interface ModelConfig {
  id: string;
  userId: string;
  name: string;
  provider: ModelProvider;
  providerId?: string;
  modelId: string;
  apiEndpoint?: string;
  apiKeyEncrypted?: string;
  apiKeyDecrypted?: string;
  isActive: boolean;
  capabilities: ModelCapability[];
  temperature: number;
  systemPrompt?: string;
  configJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  supportsThinking?: boolean;
  thinkingParamFormat?: ThinkingParamFormat;
  thinkingParamName?: string;
  thinkingEnabledValue?: string;
  thinkingDisabledValue?: string;
  thinkingNestedKey?: string;
  disableThinkingForFeatures?: string;
  isReadonly?: boolean;
  sortOrder?: number;
}

export type AiFeatureType =
  | 'image_caption'
  | 'image_tag'
  | 'image_analysis'
  | 'chat'
  | 'file_summary'
  | 'summary'
  | 'rename';

export interface ChatCompletionRequest {
  messages: ChatMessage[];
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
  reasoningContent?: string;
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
