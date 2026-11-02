/**
 * anthropicAdapter.ts
 * Anthropic Messages 协议适配器
 *
 * 用于 Anthropic 官方端点，以及 MiniMax 等 Anthropic 兼容端点。
 */

import type {
  IModelAdapter,
  ModelConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  ChatContentPart,
  ChatMessage,
  ToolDefinition,
} from '../types';
import type { Env } from '../../../types/env';
import { decryptCredential, getEncryptionKey, isAesGcmFormat } from '../../crypto';
import { AiError } from '../aiErrors';

interface AnthropicContentBlock {
  type: 'text' | 'thinking' | 'tool_use';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  id: string;
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason?: 'end_turn' | 'max_tokens' | 'tool_use' | string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function mapFinishReason(reason: string | null | undefined): ChatCompletionResponse['finishReason'] {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'refusal') return 'content_filter';
  return 'stop';
}

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

export class AnthropicAdapter implements IModelAdapter {
  readonly provider = 'anthropic' as const;
  readonly modelName = 'Anthropic';
  private config: ModelConfig;
  private env: Env;

  constructor(env: Env, config: ModelConfig) {
    this.env = env;
    this.config = config;
  }

  private async getApiKey(): Promise<string | undefined> {
    if (this.config.apiKeyDecrypted) return this.config.apiKeyDecrypted;
    if (!this.config.apiKeyEncrypted) return undefined;

    if (!isAesGcmFormat(this.config.apiKeyEncrypted)) {
      return this.config.apiKeyEncrypted;
    }

    try {
      return await decryptCredential(this.config.apiKeyEncrypted, getEncryptionKey(this.env));
    } catch (error) {
      throw new AiError('AI_CONFIG_INVALID', '模型 API Key 解密失败', { cause: error });
    }
  }

  private async requestHeaders(): Promise<Record<string, string>> {
    const key = await this.getApiKey();
    return {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(this.config.headers ?? {}),
      ...(key ? { 'x-api-key': key } : {}),
    };
  }

  private messageContent(content: ChatMessage['content']): Array<Record<string, unknown>> {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }];
    }
    if (!Array.isArray(content)) return [{ type: 'text', text: '' }];

    const blocks: Array<Record<string, unknown>> = [];
    for (const part of content as ChatContentPart[]) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text ?? '' });
        continue;
      }

      if (part.type === 'image_url' && part.image_url?.url) {
        const dataUrl = parseDataUrl(part.image_url.url);
        if (dataUrl) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: dataUrl.mediaType, data: dataUrl.data },
          });
        } else {
          blocks.push({ type: 'image', source: { type: 'url', url: part.image_url.url } });
        }
      }
    }

    return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
  }

  private buildMessages(messages: ChatMessage[]): {
    system?: string;
    messages: Array<Record<string, unknown>>;
  } {
    const systemParts: string[] = [];
    const result: Array<Record<string, unknown>> = [];

    for (const message of messages) {
      if (message.role === 'system') {
        const text =
          typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text ?? '')
                  .join('\n')
              : '';
        if (text) systemParts.push(text);
        continue;
      }

      if (message.role === 'tool') {
        const text =
          typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? message.content.map((part) => part.text ?? '').join('\n')
              : '';
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.toolCallId,
              content: text,
            },
          ],
        });
        continue;
      }

      if (message.role === 'assistant') {
        const blocks: Array<Record<string, unknown>> = [];
        if (typeof message.content === 'string' && message.content) {
          blocks.push({ type: 'text', text: message.content });
        } else if (Array.isArray(message.content)) {
          blocks.push(...this.messageContent(message.content));
        }

        for (const toolCall of message.toolCalls ?? []) {
          let input: unknown = {};
          try {
            input = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            input = {};
          }
          blocks.push({ type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input });
        }

        result.push({ role: 'assistant', content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }] });
        continue;
      }

      result.push({ role: 'user', content: this.messageContent(message.content) });
    }

    return {
      system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      messages: result,
    };
  }

  private buildTools(tools: ToolDefinition[] | undefined): Array<Record<string, unknown>> | undefined {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }

  private buildToolChoice(choice: ChatCompletionRequest['toolChoice']): Record<string, unknown> | undefined {
    if (!choice || choice === 'auto') return undefined;
    if (choice === 'none') return { type: 'none' };
    if (choice === 'required') return { type: 'any' };
    return { type: 'tool', name: choice.toolName };
  }

  private normalizeExtraBody(body: Record<string, unknown>, extraBody?: Record<string, unknown>): void {
    if (!extraBody) return;

    for (const [key, value] of Object.entries(extraBody)) {
      if (key === 'thinking' && value && typeof value === 'object') {
        const thinking = value as Record<string, unknown>;
        if (thinking.type === 'enabled') {
          body.thinking = {
            ...thinking,
            budget_tokens: typeof thinking.budget_tokens === 'number' ? thinking.budget_tokens : 1024,
          };
        } else if (thinking.type === 'disabled') {
          // Anthropic 通过不传 thinking 关闭
        }
        continue;
      }
      body[key] = value;
    }
  }

  private buildBody(request: ChatCompletionRequest, stream: boolean): Record<string, unknown> {
    const { system, messages } = this.buildMessages(request.messages);
    const body: Record<string, unknown> = {
      model: this.config.modelId,
      max_tokens: Math.min(this.config.maxOutputTokens ?? 4096, 8192),
      messages,
      temperature: request.temperature ?? this.config.temperature,
      stream,
    };

    if (system) body.system = system;
    if (request.stop?.length) body.stop_sequences = request.stop;

    const tools = this.buildTools(request.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = this.buildToolChoice(request.toolChoice);
      if (toolChoice) body.tool_choice = toolChoice;
    }

    this.normalizeExtraBody(body, request.extraBody);
    return body;
  }

  async chatCompletion(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResponse> {
    if (!this.config.apiEndpoint) throw new AiError('AI_CONFIG_INVALID', 'Anthropic 模型缺少 API Endpoint');

    const response = await fetch(`${this.config.apiEndpoint.replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      headers: await this.requestHeaders(),
      body: JSON.stringify(this.buildBody(request, false)),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AiError(
        response.status === 401 || response.status === 403 ? 'AI_UNAUTHORIZED' : 'AI_UPSTREAM_ERROR',
        `Anthropic API error: ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as AnthropicResponse;
    const text = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    const reasoning = data.content
      .filter((block) => block.type === 'thinking')
      .map((block) => block.thinking ?? '')
      .join('');
    const toolCalls = data.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: block.id ?? '',
        name: block.name ?? '',
        arguments: JSON.stringify(block.input ?? {}),
      }));

    return {
      id: data.id,
      content: text,
      role: 'assistant',
      model: this.config.modelId,
      finishReason: mapFinishReason(data.stop_reason),
      reasoningContent: reasoning || undefined,
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens ?? 0,
            outputTokens: data.usage.output_tokens ?? 0,
            cachedTokens: data.usage.cache_read_input_tokens ?? 0,
          }
        : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.config.apiEndpoint) throw new AiError('AI_CONFIG_INVALID', 'Anthropic 模型缺少 API Endpoint');

    const response = await fetch(`${this.config.apiEndpoint.replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      headers: await this.requestHeaders(),
      body: JSON.stringify(this.buildBody(request, true)),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AiError(
        response.status === 401 || response.status === 403 ? 'AI_UNAUTHORIZED' : 'AI_UPSTREAM_ERROR',
        `Anthropic API error: ${response.status} - ${errorText}`
      );
    }

    if (!response.body) throw new AiError('AI_UPSTREAM_ERROR', 'Anthropic 流式响应为空');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let messageId = '';
    let usage: StreamChunk['usage'];
    let finished = false;

    const toolBlocks = new Map<number, { id: string; name: string; input: string }>();

    const handleEvent = (payload: string) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return;
      }

      if (event.type === 'message_start') {
        const message = event.message as { id?: string; usage?: AnthropicResponse['usage'] } | undefined;
        messageId = message?.id ?? crypto.randomUUID();
        if (message?.usage) {
          usage = {
            inputTokens: message.usage.input_tokens ?? 0,
            outputTokens: message.usage.output_tokens ?? 0,
            cachedTokens: message.usage.cache_read_input_tokens ?? 0,
          };
        }
        return;
      }

      if (event.type === 'content_block_start') {
        const index = event.index as number;
        const block = event.content_block as { type?: string; id?: string; name?: string };
        if (block.type === 'tool_use') {
          toolBlocks.set(index, { id: block.id ?? '', name: block.name ?? '', input: '' });
        }
        return;
      }

      if (event.type === 'content_block_delta') {
        const index = event.index as number;
        const delta = event.delta as { type?: string; text?: string; thinking?: string; partial_json?: string };
        if (delta.type === 'text_delta' && delta.text) {
          onChunk({
            id: messageId,
            content: delta.text,
            role: 'assistant',
            model: this.config.modelId,
            done: false,
          });
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          onChunk({
            id: messageId,
            content: '',
            role: 'assistant',
            model: this.config.modelId,
            done: false,
            reasoningContent: delta.thinking,
          });
        } else if (delta.type === 'input_json_delta') {
          const tool = toolBlocks.get(index);
          if (tool) tool.input += delta.partial_json ?? '';
        }
        return;
      }

      if (event.type === 'content_block_stop') {
        const index = event.index as number;
        const tool = toolBlocks.get(index);
        if (tool) {
          toolBlocks.delete(index);
          onChunk({
            id: messageId,
            content: '',
            role: 'assistant',
            model: this.config.modelId,
            done: false,
            toolCalls: [{ id: tool.id, name: tool.name, arguments: tool.input || '{}', index }],
          });
        }
        return;
      }

      if (event.type === 'message_delta') {
        const usageDelta = event.usage as { output_tokens?: number } | undefined;
        if (usageDelta?.output_tokens !== undefined) {
          usage = { ...usage, inputTokens: usage?.inputTokens ?? 0, outputTokens: usageDelta.output_tokens };
        }
        return;
      }

      if (event.type === 'message_stop') {
        finished = true;
        onChunk({
          id: messageId,
          content: '',
          role: 'assistant',
          model: this.config.modelId,
          done: true,
          usage,
        });
      }
    };

    try {
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) {
          streamDone = true;
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (line.startsWith('data:')) handleEvent(line.slice(5).trim());
          }
        }
      }

      // 兜底：部分兼容端点不发 message_stop
      if (!finished) {
        onChunk({
          id: messageId || crypto.randomUUID(),
          content: '',
          role: 'assistant',
          model: this.config.modelId,
          done: true,
          usage,
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  validateConfig(config: ModelConfig): { valid: boolean; error?: string } {
    if (!config.apiEndpoint) return { valid: false, error: 'Anthropic 模型缺少 API Endpoint' };
    if (!config.apiKeyEncrypted && !config.apiKeyDecrypted && config.requiresApiKey !== false) {
      return { valid: false, error: 'Anthropic 模型缺少 API Key' };
    }
    return { valid: true };
  }
}
