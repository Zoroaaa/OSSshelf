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
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
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
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens ?? 0,
              outputTokens: data.usage.completion_tokens ?? 0,
              cachedTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
            }
          : undefined,
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
        stream_options: { include_usage: true },
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
      let finalUsage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined;
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
                usage: finalUsage,
              });
            }
            continue;
          }

          if (trimmedLine.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmedLine.slice(6));
              const choice = data.choices?.[0];
              const delta = choice?.delta;

              if (data.usage) {
                finalUsage = {
                  inputTokens: data.usage.prompt_tokens ?? 0,
                  outputTokens: data.usage.completion_tokens ?? 0,
                  cachedTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
                };
              }

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
}
