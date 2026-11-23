/**
 * visionProbe.test.ts
 * 视觉模型探测逻辑回归测试
 *
 * 覆盖：
 * - 颜色答案判定（红 / red / 看不到图片）
 * - 真实图片探测走视觉链路而非纯文本
 */

import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types/env';
import type { ModelConfig } from './types';
import { isVisionProbeAnswer, probeVisionModel } from './visionProbe';

function visionConfig(): ModelConfig {
  return {
    id: 'test-model',
    userId: 'user-1',
    name: 'Llama 4 Scout',
    provider: 'workers_ai',
    modelId: '@cf/meta/llama-4-scout-17b-16e-instruct',
    isActive: true,
    capabilities: ['vision'],
    temperature: 0.7,
    configJson: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ response: content }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('视觉探测', () => {
  it('答案包含颜色才算通过', () => {
    expect(isVisionProbeAnswer('红色')).toBe(true);
    expect(isVisionProbeAnswer('The image is red.')).toBe(true);
    expect(isVisionProbeAnswer('我无法查看图片，请提供图片内容。')).toBe(false);
    expect(isVisionProbeAnswer('')).toBe(false);
  });

  it('能看见图片的模型通过探测', async () => {
    const run = vi.fn(async () => chatResponse('红色'));
    const env = { AI: { run } } as unknown as Env;

    const result = await probeVisionModel(env, 'user-1', { config: visionConfig() });

    expect(result.ok).toBe(true);
    expect(result.answer).toBe('红色');
    expect(result.modelId).toBe('@cf/meta/llama-4-scout-17b-16e-instruct');
  });

  it('只回文本的模型不通过探测', async () => {
    const run = vi.fn(async () => chatResponse('我无法查看图片，请提供图片内容。'));
    const env = { AI: { run } } as unknown as Env;

    const result = await probeVisionModel(env, 'user-1', { config: visionConfig() });

    expect(result.ok).toBe(false);
  });
});
