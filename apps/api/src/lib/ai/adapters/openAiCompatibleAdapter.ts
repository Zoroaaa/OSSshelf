/**
 * openAiCompatibleAdapter.ts
 * OpenAI 兼容 API 适配器
 *
 * 功能:
 * - 支持所有 OpenAI 兼容的 API（OpenAI、Azure、Ollama、本地模型等）
 * - 支持流式输出（SSE）
 * - 支持 API Key 认证
 * - 安全的 API Key 处理：即时解密，不存储明文
 */

import type {
  IModelAdapter,
  ModelConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ChatContentPart,
} from '../types';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import { decryptCredential, getEncryptionKey, isAesGcmFormat } from '../../crypto';
import { AI_LOG_MODULE } from '../constants';
import { extractThinkingContent, hasThinkingTags } from '../utils';

export class OpenAiCompatibleAdapter implements IModelAdapter {
  readonly provider = 'openai_compatible' as const;
  readonly modelName = 'OpenAI Compatible';
  private config: ModelConfig;
  private env: Env;

  constructor(env: Env, config: ModelConfig) {
    this.env = env;
    this.config = config;
  }

  async chatCompletion(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResponse> {
    this.validateConnection();

    try {
      const body: Record<string, unknown> = {
        model: this.config.modelId,
        messages: request.messages.map((msg) => this.formatMessage(msg)),
        temperature: request.temperature ?? this.config.temperature,
        stream: false,
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools;
        body.tool_choice = request.toolChoice || 'auto';
      }

      if (request.extraBody) {
        Object.assign(body, request.extraBody);
      }

      const response = await fetch(`${this.config.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: await this.getHeadersAsync(),
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        id: string;
        choices: Array<{
          message: {
            content: string | null;
            reasoning_content?: string | null;
            role: string;
            tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
          };
          finish_reason: string;
        }> | null;
        error?: {
          message: string;
          type: string;
          code: string;
        };
      };

      if (data.error) {
        throw new Error(`API error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        throw new Error(`API returned empty or invalid choices: ${JSON.stringify(data)}`);
      }

      const choice = data.choices[0];
      let responseContent = choice?.message?.content || '';
      let reasoningContent = choice?.message?.reasoning_content || '';

      // 如果响应中包含 `` 标签，提取思考内容
      if (responseContent && hasThinkingTags(responseContent)) {
        const extracted = extractThinkingContent(responseContent);
        if (extracted.reasoning) {
          reasoningContent = reasoningContent ? reasoningContent + extracted.reasoning : extracted.reasoning;
        }
        responseContent = extracted.content;
      }

      const toolCalls = choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

      return {
        id: data.id || crypto.randomUUID(),
        content: responseContent,
        role: 'assistant',
        model: this.config.modelId,
        finishReason: (choice?.finish_reason === 'tool_calls' ? 'tool_calls' : choice?.finish_reason) as
          | 'stop'
          | 'length'
          | 'content_filter'
          | 'tool_calls',
        reasoningContent: reasoningContent || undefined,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      logger.error(AI_LOG_MODULE, 'OpenAI compatible chat completion failed', {}, error);
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
      const streamBody: Record<string, unknown> = {
        model: this.config.modelId,
        messages: request.messages.map((msg) => this.formatMessage(msg)),
        temperature: request.temperature ?? this.config.temperature,
        stream: true,
      };

      if (request.tools && request.tools.length > 0) {
        streamBody.tools = request.tools;
        streamBody.tool_choice = request.toolChoice || 'auto';
      }

      if (request.extraBody) {
        Object.assign(streamBody, request.extraBody);
      }

      const streamHeaders = await this.getHeadersAsync();
      streamHeaders['Accept'] = 'text/event-stream';

      const response = await fetch(`${this.config.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify(streamBody),
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
      let contentBuffer = '';
      const toolCallMap = new Map<number, { id?: string; name?: string; arguments: string }>();
      let lastEmittedReasoningLen = 0; // 追踪已 emit 的 reasoning 长度，避免 <think> 未闭合时重复发送

      // eslint-disable-next-line no-constant-condition -- 流式读取标准模式
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
              // 处理累积的内容缓冲区，提取thinking内容
              if (contentBuffer) {
                const extracted = extractThinkingContent(contentBuffer);
                if (extracted.reasoning) {
                  onChunk({
                    id: crypto.randomUUID(),
                    content: '',
                    role: 'assistant',
                    model: this.config.modelId,
                    done: false,
                    reasoningContent: extracted.reasoning,
                  });
                }
                if (extracted.content) {
                  onChunk({
                    id: crypto.randomUUID(),
                    content: extracted.content,
                    role: 'assistant',
                    model: this.config.modelId,
                    done: false,
                  });
                }
              }

              // 统一在 [DONE] 处 flush toolCallMap，确保所有 arguments delta 已完整拼接
              if (toolCallMap.size > 0) {
                onChunk({
                  id: crypto.randomUUID(),
                  content: '',
                  role: 'assistant',
                  model: this.config.modelId,
                  done: false,
                  toolCalls: Array.from(toolCallMap.entries()).map(([index, tc]) => ({
                    id: tc.id || `tc_idx_${index}`,
                    name: tc.name || '',
                    arguments: tc.arguments,
                    index,
                  })),
                });
                toolCallMap.clear();
              }
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
              const choice = data.choices?.[0];
              const delta = choice?.delta;

              if (delta?.content) {
                contentBuffer += delta.content;

                // 检查是否有未闭合的``标签
                const hasOpenTag = /<think>/.test(contentBuffer);
                const hasCloseTag = /<\/think>/.test(contentBuffer);

                if (hasOpenTag && !hasCloseTag) {
                  // thinking标签未闭合，只 emit 新增的增量部分，避免每次都重发整段内容
                  const thinkingMatch = /<think>([\s\S]*)$/.exec(contentBuffer);
                  if (thinkingMatch) {
                    const fullPartial = thinkingMatch[1];
                    const newPart = fullPartial.slice(lastEmittedReasoningLen);
                    if (newPart) {
                      onChunk({
                        id: data.id || crypto.randomUUID(),
                        content: '',
                        role: 'assistant',
                        model: this.config.modelId,
                        done: false,
                        reasoningContent: newPart,
                      });
                      lastEmittedReasoningLen = fullPartial.length;
                    }
                  }
                } else if (hasOpenTag && hasCloseTag) {
                  // 完整的thinking标签，提取并发送
                  const extracted = extractThinkingContent(contentBuffer);
                  if (extracted.reasoning) {
                    onChunk({
                      id: data.id || crypto.randomUUID(),
                      content: '',
                      role: 'assistant',
                      model: this.config.modelId,
                      done: false,
                      reasoningContent: extracted.reasoning,
                    });
                  }
                  // 发送清理后的正文内容
                  if (extracted.content) {
                    onChunk({
                      id: data.id || crypto.randomUUID(),
                      content: extracted.content,
                      role: 'assistant',
                      model: this.config.modelId,
                      done: false,
                    });
                  }
                  // 清空缓冲区，重置增量计数器
                  contentBuffer = '';
                  lastEmittedReasoningLen = 0;
                } else {
                  // 没有thinking标签，正常发送，并清空缓冲区防止 [DONE] 时重复发送
                  onChunk({
                    id: data.id || crypto.randomUUID(),
                    content: delta.content,
                    role: 'assistant',
                    model: this.config.modelId,
                    done: false,
                  });
                  contentBuffer = ''; // 关键修复：已直接发送 delta，清空避免 [DONE] flush 重复
                }
              }

              if (delta?.reasoning_content) {
                onChunk({
                  id: data.id || crypto.randomUUID(),
                  content: '',
                  role: 'assistant',
                  model: this.config.modelId,
                  done: false,
                  reasoningContent: delta.reasoning_content,
                });
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallMap.has(idx)) {
                    toolCallMap.set(idx, { arguments: '' });
                  }
                  const existing = toolCallMap.get(idx)!;
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                }
              }

              // finish_reason=tool_calls：仅标记，不提前 emit+clear。
              // 原因：部分模型在 finish_reason 事件发出时 tool_calls 的 arguments 字段
              // 尚未完整接收，提前 clear 会导致 arguments 截断后 JSON.parse 失败，
              // 工具调用静默丢失。统一在 [DONE] 处 flush，确保 arguments 已完整拼接。
              if (choice?.finish_reason === 'tool_calls') {
                // 仅清空 contentBuffer（thinking 内容在此时已可以确认完整）
                if (contentBuffer) {
                  const extracted = extractThinkingContent(contentBuffer);
                  if (extracted.reasoning) {
                    onChunk({
                      id: data.id || crypto.randomUUID(),
                      content: '',
                      role: 'assistant',
                      model: this.config.modelId,
                      done: false,
                      reasoningContent: extracted.reasoning,
                    });
                  }
                  if (extracted.content) {
                    onChunk({
                      id: data.id || crypto.randomUUID(),
                      content: extracted.content,
                      role: 'assistant',
                      model: this.config.modelId,
                      done: false,
                    });
                  }
                  contentBuffer = '';
                }
                // toolCallMap 保留，等 [DONE] 统一 flush
              }
            } catch {
              continue;
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        logger.error(AI_LOG_MODULE, 'OpenAI compatible stream failed', {}, error);
      }
      throw error;
    }
  }

  async embedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    this.validateConnection();

    try {
      const response = await fetch(`${this.config.apiEndpoint}/embeddings`, {
        method: 'POST',
        headers: await this.getHeadersAsync(),
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
      };

      return {
        embeddings: data.data.map((item) => item.embedding),
        model: data.model,
      };
    } catch (error) {
      logger.error(AI_LOG_MODULE, 'OpenAI compatible embedding failed', {}, error);
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

  private async getHeadersAsync(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = await this.resolveApiKey();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private async resolveApiKey(): Promise<string | null> {
    if (this.config.apiKeyEncrypted) {
      if (isAesGcmFormat(this.config.apiKeyEncrypted)) {
        try {
          const secret = getEncryptionKey(this.env);
          return await decryptCredential(this.config.apiKeyEncrypted, secret);
        } catch (error) {
          logger.error(AI_LOG_MODULE, 'Failed to decrypt API key', { modelId: this.config.id }, error);
          return null;
        }
      }
      return this.config.apiKeyEncrypted;
    }
    return null;
  }

  private validateConnection(): void {
    if (!this.config.apiEndpoint) {
      throw new Error('API endpoint not configured');
    }
  }

  private formatMessageContent(
    content: string | ChatContentPart[] | null
  ): string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> | null {
    if (content === null || content === undefined) {
      return null;
    }
    if (typeof content === 'string') {
      return content;
    }

    return content
      .map((part) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        if (part.type === 'image_url' && part.image_url) {
          return { type: 'image_url', image_url: part.image_url };
        }
        return null;
      })
      .filter(Boolean) as Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>;
  }

  private formatMessage(msg: import('../types').ChatMessage): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      role: msg.role,
      content: this.formatMessageContent(msg.content),
    };

    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      formatted.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: tc.type,
        function: tc.function,
      }));
    }

    if (msg.role === 'tool' && msg.toolCallId) {
      formatted.tool_call_id = msg.toolCallId;
    }

    return formatted;
  }

  static getPopularModels(): Array<{
    id: string;
    name: string;
    provider: string;
    capabilities: string[];
    description: string;
  }> {
    return [
      // ========== OpenAI ==========
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4 🌟',
        provider: 'OpenAI',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'OpenAI最新旗舰模型，1M上下文，内置思考模式，多模态+工具调用全能（推荐）',
      },
      {
        id: 'gpt-5.3-instant',
        name: 'GPT-5.3 Instant',
        provider: 'OpenAI',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'OpenAI平衡型模型，速度与智能的最佳结合，日常任务首选',
      },
      {
        id: 'o4-mini',
        name: 'o4-mini (推理)',
        provider: 'OpenAI',
        capabilities: ['chat', 'function_calling'],
        description: 'OpenAI高性价比推理模型，数学/编程/科学优化，支持思考力度调节',
      },

      // ========== Anthropic Claude ==========
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6 🌟',
        provider: 'Anthropic',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'Anthropic最强旗舰，1M上下文扩展思考，复杂编码和Agent场景SOTA（推荐）',
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        provider: 'Anthropic',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: '速度/智能/成本最佳平衡，1M上下文，128K输出，生产环境推荐默认模型',
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        provider: 'Anthropic',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: '最快最经济的Claude 4模型，高吞吐量和延迟敏感场景首选',
      },

      // ========== Google Gemini ==========
      {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro Preview 🌟',
        provider: 'Google',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'Google最新旗舰模型，1M上下文，原生多模态+代码执行+Agent能力',
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: 'Google',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'Google强推理模型，1M上下文，复杂任务深度思考优化',
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: 'Google',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'Google高速高性价比模型，1M上下文，响应快成本低',
      },

      // ========== DeepSeek (深度求索) ==========
      {
        id: 'deepseek-chat',
        name: 'DeepSeek V3.2 Chat 🌟',
        provider: 'DeepSeek',
        capabilities: ['chat', 'function_calling'],
        description: 'DeepSeek通用对话主力模型(V3.2)，MoE架构极速推理，性价比极高（推荐）',
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1 (推理)',
        provider: 'DeepSeek',
        capabilities: ['chat'],
        description: 'DeepSeek专用推理模型，链式思维深度推理，数学/代码/科学问题首选',
      },

      // ========== 智谱 AI (Zhipu) ==========
      {
        id: 'glm-5',
        name: 'GLM-5 🌟',
        provider: '智谱AI',
        capabilities: ['chat', 'function_calling'],
        description: '智谱最新旗舰(744B参数MoE)，编码与Agent场景开源SOTA，支持思考模式（推荐）',
      },
      {
        id: 'glm-4.5',
        name: 'GLM-4.5',
        provider: '智谱AI',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: '智谱强通用模型(3550亿参MoE)，128K上下文，中文能力领先',
      },
      {
        id: 'glm-4.7-flash',
        name: 'GLM-4.7 Flash',
        provider: '智谱AI',
        capabilities: ['chat', 'function_calling'],
        description: '智谱高效模型，131K上下文，100+语言，多轮工具调用优化',
      },

      // ========== 通义千问 Qwen (阿里云) ==========
      {
        id: 'qwen3-max',
        name: 'Qwen3 Max (通义千问) 🌟',
        provider: '阿里云',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: '阿里闭源旗舰(万亿参MoE)，支持测试时缩放(TTS)，综合性能顶尖（推荐）',
      },
      {
        id: 'qwen3.5-plus',
        name: 'Qwen3.5 Plus (通义千问)',
        provider: '阿里云',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: '阿里最新开源权重模型，纯文本表现媲美Max，速度更快成本更低',
      },
      {
        id: 'qwen3-235b-a22b-instruct',
        name: 'Qwen3 235B MoE (通义千问)',
        provider: '阿里云',
        capabilities: ['chat', 'function_calling'],
        description: '阿里大型开源MoE模型(235B总参/22B激活)，推理+Agent能力强',
      },

      // ========== Moonshot / Kimi ==========
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5 🌟',
        provider: 'Moonshot/Kimi',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: '月之暗面前沿模型，256K超长上下文，视觉+多轮工具调用+结构化输出（推荐）',
      },

      // ========== 其他主流提供商 ==========
      {
        id: 'grok-4',
        name: 'Grok 4 (xAI)',
        provider: 'xAI',
        capabilities: ['chat', 'vision', 'function_calling'],
        description: 'xAI最新模型，256K上下文，实时信息接入，深度研究能力',
      },
      {
        id: 'command-r-plus-08-2024',
        name: 'Command R+ (Cohere)',
        provider: 'Cohere',
        capabilities: ['chat', 'function_calling'],
        description: 'Cohere企业级RAG优化模型，长文档处理和引用能力突出',
      },
    ];
  }
}
