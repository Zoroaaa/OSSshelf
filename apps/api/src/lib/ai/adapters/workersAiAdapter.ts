/**
 * workersAiAdapter.ts
 * Cloudflare Workers AI 模型适配器
 *
 * 功能:
 * - 封装 Workers AI API 调用
 * - 支持流式输出
 * - 支持聊天和嵌入模型
 */

import type { Env } from '../../../types/env';
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

export class WorkersAiAdapter implements IModelAdapter {
  readonly provider = 'workers_ai' as const;
  readonly modelName = 'Cloudflare Workers AI';
  private env: Env;
  private modelConfig: ModelConfig | null;

  constructor(env: Env, modelConfig?: ModelConfig) {
    this.env = env;
    this.modelConfig = modelConfig || null;
  }

  async chatCompletion(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResponse> {
    if (!this.env.AI) {
      throw new Error('Workers AI service not configured');
    }

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }

    try {
      const modelConfig = this.getModelConfig(request);
      const response = await (this.env.AI as any).run(modelConfig.modelId, {
        messages: request.messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        temperature: request.temperature ?? 0.7,
      });

      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      return {
        id: crypto.randomUUID(),
        content: (response as { response?: string }).response || '',
        role: 'assistant',
        model: modelConfig.modelId,
      };
    } catch (error) {
      logger.error('AI', 'Workers AI chat completion failed', {}, error);
      throw error;
    }
  }

  async chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.env.AI) {
      throw new Error('Workers AI service not configured');
    }

    try {
      const modelConfig = this.getModelConfig(request);
      const response = await (this.env.AI as any).run(modelConfig.modelId, {
        messages: request.messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        temperature: request.temperature ?? 0.7,
        stream: true,
      });

      if (signal?.aborted) {
        return;
      }

      const reader = response.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done || signal?.aborted) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter((line: string) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            const chunk = data.response || '';
            if (chunk) {
              fullContent += chunk;
              onChunk({
                id: crypto.randomUUID(),
                content: chunk,
                role: 'assistant',
                model: modelConfig.modelId,
                done: false,
              });
            }
          } catch {
            continue;
          }
        }
      }

      onChunk({
        id: crypto.randomUUID(),
        content: '',
        role: 'assistant',
        model: modelConfig.modelId,
        done: true,
      });
    } catch (error) {
      logger.error('AI', 'Workers AI stream failed', {}, error);
      throw error;
    }
  }

  async embedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.env.AI) {
      throw new Error('Workers AI service not configured');
    }

    try {
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      const result = await (this.env.AI as any).run('@cf/baai/bge-m3', {
        text: inputs,
      });

      return {
        embeddings: result.data || [],
        model: '@cf/baai/bge-m3',
      };
    } catch (error) {
      logger.error('AI', 'Workers AI embedding failed', {}, error);
      throw error;
    }
  }

  validateConfig(config: ModelConfig): { valid: boolean; error?: string } {
    if (!config.modelId) {
      return { valid: false, error: 'Workers AI 模型 ID 不能为空' };
    }
    if (!config.modelId.startsWith('@cf/') && config.modelId !== '__custom__') {
      return { valid: false, error: 'Invalid Workers AI model ID. Must start with @cf/' };
    }

    if (config.capabilities?.includes('function_calling')) {
      logger.warn('AI', 'Workers AI 不支持 native function calling，将使用 prompt-based fallback');
    }
    return { valid: true };
  }

  private getModelConfig(request: ChatCompletionRequest): { modelId: string; temperature: number } {
    const userModelId = this.modelConfig?.modelId;
    const effectiveModelId =
      userModelId && userModelId.startsWith('@cf/') ? userModelId : '@cf/meta/llama-3.1-8b-instruct';

    return {
      modelId: effectiveModelId,
      temperature: request.temperature ?? this.modelConfig?.temperature ?? 0.7,
    };
  }

  static getAvailableModels(): Array<{
    id: string;
    name: string;
    capabilities: string[];
    description: string;
  }> {
    return [
      // ========== 自定义模型 ==========
      {
        id: '__custom__',
        name: '自定义模型 (输入任意 @cf/ 模型 ID)',
        capabilities: ['chat', 'vision'],
        description:
          '手动输入任意 Cloudflare Workers AI 模型 ID，如 @cf/deepseek/deepseek-r1、@cf/black-forest-labs/flux-2-klein-4b 等。支持所有 Workers AI 目录中的模型。',
      },

      // ========== 大语言模型（高参数） ==========
      {
        id: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
        name: 'DeepSeek R1 Distill Qwen 32B',
        capabilities: ['chat'],
        description: 'DeepSeek R1蒸馏版32B参数，推理能力强，擅长数学和代码任务（推荐）',
      },
      {
        id: '@cf/qwen/qwen1.5-14b-chat-awq',
        name: 'Qwen 1.5 14B Chat',
        capabilities: ['chat'],
        description: '通义千问14B对话模型，中文能力优秀，适合中文场景',
      },
      {
        id: '@cf/meta/llama-3.1-8b-instruct',
        name: 'Llama 3.1 8B Instruct',
        capabilities: ['chat'],
        description: 'Meta的Llama 3.1指令微调模型，支持多语言对话，通用问答',
      },
      {
        id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        name: 'Llama 3.3 70B Instruct (FP8)',
        capabilities: ['chat'],
        description: 'Meta最新Llama 3.3 70B大参数模型，性能强劲，复杂推理任务首选',
      },
      {
        id: '@cf/mistral/mistral-7b-instruct-v0.2',
        name: 'Mistral 7B Instruct v0.2',
        capabilities: ['chat'],
        description: 'Mistral AI的7B参数指令模型，推理速度快，适合实时对话',
      },
      {
        id: '@cf/google/gemma-2b-it-lora',
        name: 'Gemma 2B LoRA',
        capabilities: ['chat'],
        description: 'Google轻量级2B模型，响应速度极快，适合简单任务',
      },

      // ========== 多模态视觉模型 ==========
      {
        id: '@cf/llava-hf/llava-1.5-7b-hf',
        name: 'LLaVA 1.5 7B Vision',
        capabilities: ['vision'],
        description: '多模态视觉语言模型，可以理解图片内容并生成描述',
      },

      // ========== 嵌入模型 ==========
      {
        id: '@cf/baai/bge-m3',
        name: 'BGE-M3 Embedding',
        capabilities: ['embedding'],
        description: '多语言嵌入模型，用于文本向量化（1024维），语义搜索核心',
      },
    ];
  }
}
