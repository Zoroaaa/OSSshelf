/**
 * completion.ts
 * 非流式文本生成的 AI SDK 兼容层
 *
 * 用途: 摘要、标签、重命名、记忆提取等后台功能。
 * 新对话主链路直接使用 streamText，不经过这里。
 */

import { generateText, type ModelMessage } from 'ai';
import type { Env } from '../../types/env';
import type { ChatCompletionRequest, ChatContentPart, TokenUsage } from './types';
import { resolveLanguageModel } from './modelResolver';

export interface CompletionResult {
  content: string;
  modelId: string;
  usage: TokenUsage;
}

type CompatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ChatContentPart[] };

function toContentParts(
  content: ChatContentPart[]
): Array<{ type: 'text'; text: string } | { type: 'image'; image: URL }> {
  return content.map((part) => {
    if (part.type === 'image_url' && part.image_url?.url) {
      return { type: 'image' as const, image: new URL(part.image_url.url) };
    }
    return { type: 'text' as const, text: part.text ?? '' };
  });
}

export async function chatCompletion(
  env: Env,
  userId: string,
  request: ChatCompletionRequest,
  modelId?: string,
  abortSignal?: AbortSignal
): Promise<CompletionResult> {
  const { model, config } = await resolveLanguageModel(env, userId, modelId);

  let system: string | undefined;
  const messages: ModelMessage[] = [];

  for (const message of request.messages as CompatMessage[]) {
    if (message.role === 'system') {
      const text =
        typeof message.content === 'string' ? message.content : message.content.map((part) => part.text ?? '').join('');
      system = system ? `${system}\n${text}` : text;
      continue;
    }

    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map((part) => part.text ?? '').join(''),
      });
      continue;
    }

    messages.push({
      role: 'user',
      content: typeof message.content === 'string' ? message.content : toContentParts(message.content),
    });
  }

  const result = await generateText({
    model,
    system,
    messages,
    temperature: request.temperature ?? config.temperature,
    abortSignal: abortSignal ?? request.signal,
    maxRetries: 2,
  });

  return {
    content: result.text,
    modelId: config.modelId,
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  };
}
