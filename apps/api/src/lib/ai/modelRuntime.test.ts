/**
 * modelRuntime.test.ts
 * 视觉调用链路回归测试
 *
 * 覆盖三条曾经返回空或只回文本的路径：
 * - 旧 Workers AI 视觉模型（llama-3.2-11b-vision）走原生 { image, prompt } 输入
 * - 新多模态模型（llama-4-scout）走 chat messages + image_url
 * - moondream3 走任务式 { task, image, question } 并读取 answer
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
    modelId: '@cf/meta/llama-3.2-11b-vision-instruct',
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
  it('旧 Workers AI 视觉模型（llama-3.2-11b-vision）走原生 image + prompt，而不是 chat messages', async () => {
    const run = vi.fn(async () => ({ response: '一只猫' }));
    const env = { AI: { run } } as unknown as Env;

    const result = await completeTextWithConfig(env, baseConfig({}), visionRequest());

    expect(run).toHaveBeenCalledTimes(1);
    const [calledModel, payload] = run.mock.calls[0] as unknown as [string, { image: number[]; prompt: string }];
    expect(calledModel).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(payload).toEqual(
      expect.objectContaining({
        image: [104, 101, 108, 108, 111],
        prompt: '请描述这张图片',
      })
    );
    expect(result.content).toBe('一只猫');
  });

  it('新多模态模型（llama-4-scout）走 chat messages + image_url', async () => {
    // AI SDK 用 returnRawResponse 调用绑定，真实 Workers AI 返回 Response，mock 必须一致
    const run = vi.fn(
      async () =>
        new Response(JSON.stringify({ response: '一只狗' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const env = { AI: { run } } as unknown as Env;

    const result = await completeTextWithConfig(
      env,
      baseConfig({ modelId: '@cf/meta/llama-4-scout-17b-16e-instruct' }),
      visionRequest()
    );

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

  it('moondream3 走流式任务式输入并读取 answer', async () => {
    // 非流式接口恒返回空，必须 stream: true 并解析 SSE
    const run = vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"chunk":{"answer":"一只兔子","caption":null}}\n\ndata: {"chunk":{"answer":"一只兔子","finish_reason":"stop"}}\n\n'
              )
            );
            controller.close();
          },
        })
    );
    const env = { AI: { run } } as unknown as Env;

    const result = await completeTextWithConfig(
      env,
      baseConfig({ modelId: '@cf/moondream/moondream3.1-9B-A2B' }),
      visionRequest()
    );

    const [calledModel, payload] = run.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(calledModel).toBe('@cf/moondream/moondream3.1-9B-A2B');
    expect(payload).toEqual(
      expect.objectContaining({
        task: 'query',
        image: `data:image/png;base64,${IMAGE_BASE64}`,
        question: '请描述这张图片',
        reasoning: false,
        stream: true,
        max_tokens: 1024,
      })
    );
    expect(result.content).toBe('一只兔子');
  });

  it('首选格式返回空时降级到其他输入格式', async () => {
    const run = vi.fn(async (_modelId: string, input: { messages?: unknown[]; image?: number[] }) => {
      // chat 请求返回空内容（模拟格式不匹配被静默忽略）
      if (Array.isArray(input.messages)) {
        return new Response(JSON.stringify({ response: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return { description: '一只猫' };
    });
    const env = { AI: { run } } as unknown as Env;

    const result = await completeTextWithConfig(
      env,
      baseConfig({ modelId: '@cf/meta/llama-4-scout-17b-16e-instruct' }),
      visionRequest()
    );

    expect(run).toHaveBeenCalledTimes(2);
    expect((run.mock.calls[0][1] as { messages?: unknown[] }).messages).toBeDefined();
    expect(run.mock.calls[1][1]).toEqual(expect.objectContaining({ image: [104, 101, 108, 108, 111] }));
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
