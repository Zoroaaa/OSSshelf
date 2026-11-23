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

function llavaConfig(): ModelConfig {
  return {
    id: 'test-model',
    userId: 'user-1',
    name: 'LLaVA',
    provider: 'workers_ai',
    modelId: '@cf/llava-hf/llava-1.5-7b-hf',
    isActive: true,
    capabilities: ['vision'],
    temperature: 0.7,
    configJson: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('视觉探测', () => {
  it('答案包含颜色才算通过', () => {
    expect(isVisionProbeAnswer('红色')).toBe(true);
    expect(isVisionProbeAnswer('The image is red.')).toBe(true);
    expect(isVisionProbeAnswer('我无法查看图片，请提供图片内容。')).toBe(false);
    expect(isVisionProbeAnswer('')).toBe(false);
  });

  it('能看见图片的模型通过探测', async () => {
    const run = vi.fn(async () => ({ description: '红色' }));
    const env = { AI: { run } } as unknown as Env;

    const result = await probeVisionModel(env, 'user-1', { config: llavaConfig() });

    expect(result.ok).toBe(true);
    expect(result.answer).toBe('红色');
    expect(result.modelId).toBe('@cf/llava-hf/llava-1.5-7b-hf');
    expect(run).toHaveBeenCalledWith(
      '@cf/llava-hf/llava-1.5-7b-hf',
      expect.objectContaining({ prompt: expect.stringContaining('颜色') })
    );
  });

  it('只回文本的模型不通过探测', async () => {
    const run = vi.fn(async () => ({ description: '我无法查看图片，请提供图片内容。' }));
    const env = { AI: { run } } as unknown as Env;

    const result = await probeVisionModel(env, 'user-1', { config: llavaConfig() });

    expect(result.ok).toBe(false);
  });
});
