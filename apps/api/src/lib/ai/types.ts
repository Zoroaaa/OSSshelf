/**
 * types.ts
 * AI 模块内部类型定义
 *
 * 只保留配置与消息模型；调用参数与结果类型定义在 modelRuntime.ts。
 */

export type ModelProvider = 'workers_ai' | 'openai_compatible' | 'anthropic';

export type ModelCapability = 'chat' | 'completion' | 'embedding' | 'vision' | 'function_calling';

export type ThinkingParamFormat = 'object' | 'boolean' | 'string' | '';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
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
 *
 * - supportsThinking: 思考模式特性开关，控制是否启用深度推理参数（如 thinking.type = enabled）
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
  /** 供应商连接上的实际协议（读取时覆盖 provider） */
  protocol?: ModelProvider;
  providerId?: string;
  providerName?: string;
  providerUpdatedAt?: string;
  /** 该供应商连接是否必须提供 API Key（自定义本地端点可为 false） */
  requiresApiKey?: boolean;
  modelId: string;
  /** 运行时字段：由供应商连接解析得出，不落 ai_models */
  apiEndpoint?: string;
  apiKeyEncrypted?: string;
  headers?: Record<string, string>;
  isActive: boolean;
  capabilities: ModelCapability[];
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities?: string[];
  pricing?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
  };
  metadataSource?: string;
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

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}
