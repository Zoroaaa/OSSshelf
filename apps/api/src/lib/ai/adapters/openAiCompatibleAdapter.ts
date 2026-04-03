/**
 * openAiCompatibleAdapter.ts
 * OpenAI 兼容 API 适配器
 *
 * 功能:
 * - 支持所有 OpenAI 兼容的 API（OpenAI、Azure、Ollama、本地模型等）
 * - 支持流式输出（SSE）
 * - 支持 API Key 认证
 */

import type {
  IModelAdapter,
  ModelConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
} from '../types';
import { logger } from '@osshelf/shared';

export class OpenAiCompatibleAdapter implements IModelAdapter {
  readonly provider = 'openai_compatible' as const;
  readonly modelName = 'OpenAI Compatible';
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.validateConnection();

    try {
      const response = await fetch(`${this.config.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.modelId,
          messages: request.messages,
          max_tokens: request.maxTokens || this.config.maxTokens,
          temperature: request.temperature ?? this.config.temperature,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        id: string;
        choices: Array<{
          message: { content: string; role: string };
          finish_reason: string;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };

      return {
        id: data.id || crypto.randomUUID(),
        content: data.choices[0]?.message?.content || '',
        role: 'assistant',
        model: this.config.modelId,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        finishReason: data.choices[0]?.finish_reason as 'stop' | 'length' | 'content_filter',
      };
    } catch (error) {
      logger.error('AI', 'OpenAI compatible chat completion failed', {}, error);
      throw error;
    }
  }

  async chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<void> {
    this.validateConnection();

    try {
      const response = await fetch(`${this.config.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: this.config.modelId,
          messages: request.messages,
          max_tokens: request.maxTokens || this.config.maxTokens,
          temperature: request.temperature ?? this.config.temperature,
          stream: true,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API stream error: ${response.status} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done || signal?.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === 'data: [DONE]') {
            if (trimmedLine === 'data: [DONE]') {
              onChunk({
                id: crypto.randomUUID(),
                content: '',
                role: 'assistant',
                model: this.config.modelId,
                done: true,
              });
            }
            continue;
          }

          if (trimmedLine.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmedLine.slice(6));
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) {
                onChunk({
                  id: data.id || crypto.randomUUID(),
                  content: delta,
                  role: 'assistant',
                  model: this.config.modelId,
                  done: false,
                });
              }
            } catch {
              continue;
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        logger.error('AI', 'OpenAI compatible stream failed', {}, error);
      }
      throw error;
    }
  }

  async embedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    this.validateConnection();

    try {
      const response = await fetch(`${this.config.apiEndpoint}/embeddings`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.modelId,
          input: request.input,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI embedding error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
        model: string;
        usage?: {
          prompt_tokens: number;
          total_tokens: number;
        };
      };

      return {
        embeddings: data.data.map((item) => item.embedding),
        model: data.model,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      logger.error('AI', 'OpenAI compatible embedding failed', {}, error);
      throw error;
    }
  }

  validateConfig(config: ModelConfig): { valid: boolean; error?: string } {
    if (!config.apiEndpoint) {
      return { valid: false, error: 'API endpoint is required' };
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

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKeyEncrypted) {
      headers['Authorization'] = `Bearer ${this.config.apiKeyEncrypted}`;
    }

    return headers;
  }

  private validateConnection(): void {
    if (!this.config.apiEndpoint) {
      throw new Error('API endpoint not configured');
    }
  }

  static getPopularModels(): Array<{
    id: string;
    name: string;
    provider: string;
    capabilities: string[];
    description: string;
  }> {
    return [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'OpenAI',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'OpenAI最新多模态模型，支持文本和图像理解',
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        provider: 'OpenAI',
        capabilities: ['chat', 'function_calling'],
        description: '高性能GPT-4模型，适合复杂任务',
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        provider: 'OpenAI',
        capabilities: ['chat'],
        description: '快速响应模型，适合简单任务',
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        provider: 'Anthropic',
        capabilities: ['chat', 'vision'],
        description: 'Anthropic最强模型，擅长复杂推理和分析',
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        provider: 'Anthropic',
        capabilities: ['chat', 'vision'],
        description: '平衡性能和速度的Claude模型',
      },
      {
        id: 'gemini-pro',
        name: 'Gemini Pro',
        provider: 'Google',
        capabilities: ['chat', 'function_calling'],
        description: 'Google的多模态模型',
      },
      {
        id: 'qwen-turbo',
        name: '通义千问 Turbo',
        provider: '阿里云',
        capabilities: ['chat'],
        description: '阿里云通义千问高速版，中文能力优秀',
      },
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        provider: 'DeepSeek',
        capabilities: ['chat'],
        description: 'DeepSeek对话模型，代码和推理能力强',
      },
    ];
  }
}
