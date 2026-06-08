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
import { extractThinkingContent } from '../utils';

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
      const requestBody: Record<string, unknown> = {
        messages: request.messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        temperature: request.temperature ?? 0.7,
      };

if (request.tools && request.tools.length > 0) {
  requestBody.tools = request.tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: stripNestedObjectArrays(t.function.parameters),
  }));

  function stripNestedObjectArrays(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    
    const result = { ...schema };
    
    if (result.properties) {
      result.properties = Object.fromEntries(
        Object.entries(result.properties).map(([k, v]: [string, any]) => {
          if (v.type === 'array' && v.items?.type === 'object') {
            // 降级为 string，让模型传 JSON 字符串
            return [k, { type: 'string', description: v.description }];
          }
          return [k, stripNestedObjectArrays(v)];
        })
      );
    }
    
    return result;
  }
}

      const response = await (this.env.AI as any).run(modelConfig.modelId, requestBody);

      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      const responseData = response as {
        response?: string;
        tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
      };

      const toolCalls = responseData.tool_calls?.map((tc, idx) => ({
        id: `tc_${idx}_${crypto.randomUUID().slice(0, 8)}`,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      }));

      return {
        id: crypto.randomUUID(),
        content: responseData.response || '',
        role: 'assistant',
        model: modelConfig.modelId,
        finishReason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop',
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
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

      if (request.tools && request.tools.length > 0) {
        const nonStreamResponse = await this.chatCompletion(request, signal);
        if (nonStreamResponse.toolCalls && nonStreamResponse.toolCalls.length > 0) {
          onChunk({
            id: nonStreamResponse.id,
            content: '',
            role: 'assistant',
            model: nonStreamResponse.model,
            done: false,
            toolCalls: nonStreamResponse.toolCalls.map((tc, idx) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              index: idx,
            })),
          });
        } else if (nonStreamResponse.content) {
          onChunk({
            id: nonStreamResponse.id,
            content: nonStreamResponse.content,
            role: 'assistant',
            model: nonStreamResponse.model,
            done: false,
          });
        }
        onChunk({
          id: nonStreamResponse.id,
          content: '',
          role: 'assistant',
          model: nonStreamResponse.model,
          done: true,
        });
        return;
      }

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
      let contentBuffer = '';
      let hasEmittedReasoning = false;

      // eslint-disable-next-line no-constant-condition -- 流式读取标准模式
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
              contentBuffer += chunk;

              // 检查是否有未闭合的``标签
              const hasOpenTag = /<think>/.test(contentBuffer);
              const hasCloseTag = /<\/think>/.test(contentBuffer);

              if (hasOpenTag && !hasCloseTag) {
                // thinking 标签未闭合，提取并发送已接收的 thinking 内容
                const thinkingMatch = /<think>([\s\S]*)$/.exec(contentBuffer);
                if (thinkingMatch) {
                  const partialThinking = thinkingMatch[1];
                  onChunk({
                    id: crypto.randomUUID(),
                    content: '',
                    role: 'assistant',
                    model: modelConfig.modelId,
                    done: false,
                    reasoningContent: partialThinking,
                  });
                }
              } else if (hasOpenTag && hasCloseTag) {
                // 完整的 thinking 标签，提取并发送
                const extracted = extractThinkingContent(contentBuffer);
                if (extracted.reasoning && !hasEmittedReasoning) {
                  onChunk({
                    id: crypto.randomUUID(),
                    content: '',
                    role: 'assistant',
                    model: modelConfig.modelId,
                    done: false,
                    reasoningContent: extracted.reasoning,
                  });
                  hasEmittedReasoning = true;
                }
                // 发送清理后的正文内容
                if (extracted.content) {
                  onChunk({
                    id: crypto.randomUUID(),
                    content: extracted.content,
                    role: 'assistant',
                    model: modelConfig.modelId,
                    done: false,
                  });
                }
                // 清空缓冲区
                contentBuffer = '';
              } else {
                // 没有 thinking 标签，正常发送
                onChunk({
                  id: crypto.randomUUID(),
                  content: chunk,
                  role: 'assistant',
                  model: modelConfig.modelId,
                  done: false,
                });
              }
            }
          } catch {
            continue;
          }
        }
      }

      // 处理剩余的缓冲区内容
      if (contentBuffer) {
        const extracted = extractThinkingContent(contentBuffer);
        if (extracted.reasoning) {
          onChunk({
            id: crypto.randomUUID(),
            content: '',
            role: 'assistant',
            model: modelConfig.modelId,
            done: false,
            reasoningContent: extracted.reasoning,
          });
        }
        if (extracted.content) {
          onChunk({
            id: crypto.randomUUID(),
            content: extracted.content,
            role: 'assistant',
            model: modelConfig.modelId,
            done: false,
          });
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
      {
        id: '__custom__',
        name: '自定义模型 (输入任意 @cf/ 模型 ID)',
        capabilities: ['chat', 'vision'],
        description:
          '手动输入任意 Cloudflare Workers AI 模型 ID，如 @cf/deepseek/deepseek-r1、@cf/black-forest-labs/flux-2-klein-4b 等。支持所有 Workers AI 目录中的模型。',
      },

      // ========== 旗舰/高参数大模型 ==========
      {
        id: '@cf/moonshotai/kimi-k2.5',
        name: 'Kimi K2.5 🌟',
        capabilities: ['chat', 'vision', 'function_calling'],
        description:
          'Moonshot AI前沿开源模型，256K超长上下文，支持多轮工具调用、视觉输入和结构化输出，Agent场景首选（推荐）',
      },
      {
        id: '@cf/openai/gpt-oss-120b',
        name: 'GPT-OSS 120B (OpenAI) 🌟',
        capabilities: ['chat', 'function_calling'],
        description: 'OpenAI开源权重模型，专为推理和Agent任务设计，生产级通用高推理场景首选',
      },
      {
        id: '@cf/meta/llama-4-scout-17b-16e-instruct',
        name: 'Llama 4 Scout 17B MoE (Meta) 🌟',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'Meta最新Llama 4原生多模态MoE架构(16专家)，文本+图像理解业界领先',
      },
      {
        id: '@cf/nvidia/nemotron-3-120b-a12b',
        name: 'Nemotron 3 Super 120B (NVIDIA) 🌟',
        capabilities: ['chat', 'function_calling'],
        description: 'NVIDIA混合MoE架构(120B总参/12B激活)，面向多Agent系统和专业Agent AI优化',
      },
      {
        id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        name: 'Llama 3.3 70B Instruct FP8 (Meta)',
        capabilities: ['chat', 'function_calling'],
        description: 'Meta Llama 3.3 70B参数FP8量化加速版，复杂推理任务首选，支持函数调用',
      },
      {
        id: '@cf/google/gemma-4-26b-a4b-it',
        name: 'Gemma 4 26B MoE (Google) 🌟',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'Google最智能开源模型家族，基于Gemini 3研究构建，256K上下文，内置思考模式+视觉+函数调用',
      },
      {
        id: '@cf/zai-org/glm-4.7-flash',
        name: 'GLM-4.7 Flash (智谱AI) 🌟',
        capabilities: ['chat', 'function_calling'],
        description: '智谱AI高效多语言模型，131K上下文，100+语言支持，多轮工具调用优化',
      },
      {
        id: '@cf/qwen/qwen3-30b-a3b-fp8',
        name: 'Qwen3 30B MoE (通义千问)',
        capabilities: ['chat', 'function_calling'],
        description: '阿里Qwen3最新一代MoE模型(30B总参/3B激活)，推理+指令遵循+Agent能力全面突破',
      },
      {
        id: '@cf/mistral/mistral-small-3.1-24b-instruct',
        name: 'Mistral Small 3.1 24B (Mistral AI)',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'Mistral AI顶级文本+视觉双优模型，128K长上下文，速度与智能的最佳平衡',
      },

      // ========== 推理/思考模式模型 ==========
      {
        id: '@cf/deepseek/deepseek-r1-distill-qwen-32b',
        name: 'DeepSeek R1 Distill Qwen 32B',
        capabilities: ['chat'],
        description: 'DeepSeek R1蒸馏推理模型，数学/代码/逻辑推理能力强，超越o1-mini（推荐）',
      },
      {
        id: '@cf/qwq-32b',
        name: 'QwQ 32B (通义千问推理)',
        capabilities: ['chat'],
        description: 'Qwen系列专用推理模型，深度思考能力媲美DeepSeek-R1和OpenAI o1-mini',
      },

      // ========== 中等参数模型 ==========
      {
        id: '@cf/meta/llama-3.1-8b-instruct',
        name: 'Llama 3.1 8B Instruct (Meta)',
        capabilities: ['chat'],
        description: 'Meta经典8B指令微调模型，多语言对话通用性强，速度快成本低',
      },
      {
        id: '@cf/meta/llama-3.1-8b-instruct-fast',
        name: 'Llama 3.1 8B Fast (Meta)',
        capabilities: ['chat'],
        description: 'Llama 3.1 8B极速版，60K上下文，延迟敏感场景首选',
      },
      {
        id: '@cf/google/gemma-3-12b-it',
        name: 'Gemma 3 12B (Google)',
        capabilities: ['chat', 'vision'],
        description: 'Google多模态模型，128K上下文，140+语言支持，文本生成与图像理解全能',
      },
      {
        id: '@cf/meta/llama-3.2-3b-instruct',
        name: 'Llama 3.2 3B Instruct (Meta)',
        capabilities: ['chat'],
        description: '轻量级3B模型，适合边缘部署和高吞吐量场景',
      },
      {
        id: '@cf/ibm/granite-4.0-h-micro',
        name: 'Granite 4.0 Micro (IBM)',
        capabilities: ['chat', 'function_calling'],
        description: 'IBM指令遵循和函数调用领先模型，适合RAG和多Agent工作流',
      },

      // ========== 多模态视觉模型 ==========
      {
        id: '@cf/meta/llama-3.2-11b-vision-instruct',
        name: 'Llama 3.2 11B Vision (Meta)',
        capabilities: ['vision'],
        description: 'Meta原生视觉指令模型，图像识别、图像推理、图注生成全能',
      },
      {
        id: '@cf/llava-hf/llava-1.5-7b-hf',
        name: 'LLaVA 1.5 7B Vision',
        capabilities: ['vision'],
        description: '经典多模态视觉语言模型，图片内容理解与描述生成',
      },

      // ========== 嵌入/向量化模型 ==========
      {
        id: '@cf/baai/bge-m3',
        name: 'BGE-M3 Embedding',
        capabilities: ['embedding'],
        description: '多语言多粒度嵌入模型(1024维)，语义搜索核心推荐',
      },
      {
        id: '@cf/baai/bge-large-en-v1.5',
        name: 'BGE-Large EN Embedding',
        capabilities: ['embedding'],
        description: '英文专用大规模嵌入模型(1024维)，英文语义搜索优化',
      },
      {
        id: '@cf/qwen/qwen3-embedding-0.6b',
        name: 'Qwen3 Embedding 0.6B',
        capabilities: ['embedding'],
        description: '通义千问最新嵌入模型(1024维)，中英双语优化，支持4096 tokens',
      },
      {
        id: '@cf/google/embeddinggemma-300m',
        name: 'EmbeddingGemma 300M (Google)',
        capabilities: ['embedding'],
        description: 'Google轻量级嵌入模型(768维)，100+语言支持，搜索检索优化',
      },
    ];
  }
}
