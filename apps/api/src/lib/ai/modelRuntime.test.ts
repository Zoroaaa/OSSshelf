/**
 * modelRuntime.test.ts
 * 视觉调用链路回归测试
 *
 * 覆盖两类 provider 的图片输入转换：
 * - Workers AI 统一走 chat messages + image_url（由 AI SDK 组装，不按模型 ID 分支）
 * - OpenAI 兼容把图片 part 转换为 image_url data URL
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
    modelId: '@cf/meta/llama-4-scout-17b-16e-instruct',
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
  it('Workers AI 视觉走 chat messages + image_url', async () => {
    // AI SDK 用 returnRawResponse 调用绑定，真实 Workers AI 返回 Response，mock 必须一致
    const run = vi.fn(
      async () =>
        new Response(JSON.stringify({ response: '一只狗' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const env = { AI: { run } } as unknown as Env;

    const result = await completeTextWithConfig(env, baseConfig({}), visionRequest());

    expect(run).toHaveBeenCalledTimes(1);
    const [modelId, input] = run.mock.calls[0] as unknown as [
      string,
      { messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> },
    ];
    expect(modelId).toBe('@cf/meta/llama-4-scout-17b-16e-instruct');
    const imagePart = input.messages[0].content.find((part) => part.type === 'image_url');
    expect(imagePart?.image_url?.url).toBe(`data:image/png;base64,${IMAGE_BASE64}`);
    expect(result.content).toBe('一只狗');
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
