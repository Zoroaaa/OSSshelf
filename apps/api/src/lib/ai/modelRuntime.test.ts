/**
 * modelRuntime.test.ts
 * 视觉调用链路回归测试
 *
 * 覆盖两个曾经返回空的路径：
 * - Workers AI 视觉模型必须走原生 { image, prompt } 输入
 * - OpenAI 兼容视觉模型必须把图片 part 转换为 image_url data URL
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types/env';
import type { ModelConfig } from './types';
import { completeTextWithConfig } from './modelRuntime';
import { buildVisionMessageContent } from './utils';

const IMAGE_BASE64 = 'aGVsbG8=';

function baseConfig(overrides: Partial<ModelConfig>): ModelConfig {
  return {
    id: 'test-model',
    userId: 'user-1',
    name: '测试模型',
    provider: 'workers_ai',
    modelId: '@cf/llava-hf/llava-1.5-7b-hf',
    isActive: true,
    capabilities: ['vision'],
    temperature: 0.7,
    configJson: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function visionRequest(prompt = '请描述这张图片') {
  return {
    messages: [
      {
        role: 'user' as const,
        content: buildVisionMessageContent(IMAGE_BASE64, 'image/png', prompt),
      },
    ],
    featureType: 'image_caption' as const,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('视觉调用链路', () => {
  it('Workers AI 视觉走原生 image + prompt，而不是 chat messages', async () => {
    const run = vi.fn(async () => ({ description: '一只猫' }));
    const env = { AI: { run } } as unknown as Env;

    const result = await completeTextWithConfig(env, baseConfig({}), visionRequest());

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      '@cf/llava-hf/llava-1.5-7b-hf',
      expect.objectContaining({
        image: [104, 101, 108, 108, 111],
        prompt: '请描述这张图片',
      })
    );
    expect(result.content).toBe('一只猫');
  });

  it('OpenAI 兼容视觉把图片转换为 image_url data URL', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        messages: Array<{ content: Array<{ type: string; image_url?: { url: string }; text?: string }> }>;
      };
      const parts = body.messages[0].content;
      const image = parts.find((part) => part.type === 'image_url');
      expect(image?.image_url?.url).toBe(`data:image/png;base64,${IMAGE_BASE64}`);

      return new Response(
        JSON.stringify({
          id: 'resp-1',
          choices: [{ message: { role: 'assistant', content: '一张图片' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const env = {} as unknown as Env;
    const config = baseConfig({
      provider: 'openai_compatible',
      modelId: 'qwen-vl',
      apiEndpoint: 'https://example.com/v1',
      apiKeyEncrypted: 'test-key',
      requiresApiKey: true,
    });

    const result = await completeTextWithConfig(env, config, visionRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('一张图片');
  });
});
