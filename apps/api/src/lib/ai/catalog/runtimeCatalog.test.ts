import { describe, expect, it } from 'vitest';
import { buildSnapshotFromRaw, countSnapshot } from './runtimeCatalog';

describe('runtime models.dev snapshot', () => {
  it('normalizes provider and model fields', () => {
    const snapshot = buildSnapshotFromRaw(
      {
        deepseek: {
          name: 'DeepSeek',
          api: 'https://api.deepseek.com',
          doc: 'https://api-docs.deepseek.com',
          npm: '@ai-sdk/openai-compatible',
          env: ['DEEPSEEK_API_KEY'],
          models: {
            'deepseek-test': {
              name: 'DeepSeek Test',
              attachment: true,
              reasoning: true,
              tool_call: true,
              modalities: { input: ['text', 'image'], output: ['text'] },
              limit: { context: 1_000_000, output: 128_000 },
              cost: { input: 0.15, output: 0.6, cache_read: 0.01 },
              status: 'beta',
              release_date: '2026-01-01',
              description: 'should be dropped',
            },
          },
        },
        unknown: {
          name: 'Unknown',
          models: { x: { name: 'X' } },
        },
      },
      '2026-01-01T00:00:00.000Z'
    );

    expect(snapshot.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(snapshot.providers.unknown).toBeUndefined();

    const model = snapshot.providers.deepseek.models['deepseek-test'];
    expect(model.name).toBe('DeepSeek Test');
    expect(model.toolCall).toBe(true);
    expect(model.modalities?.input).toEqual(['text', 'image']);
    expect(model.limit?.context).toBe(1_000_000);
    expect(model.cost?.cacheRead).toBe(0.01);
    expect(model.status).toBe('beta');
    expect((model as unknown as Record<string, unknown>).description).toBeUndefined();
  });

  it('counts providers and models', () => {
    const snapshot = buildSnapshotFromRaw({
      deepseek: {
        name: 'DeepSeek',
        models: { a: { name: 'A' }, b: { name: 'B' } },
      },
      openai: {
        name: 'OpenAI',
        models: { c: { name: 'C' } },
      },
    });

    expect(countSnapshot(snapshot)).toEqual({ providerCount: 2, modelCount: 3 });
  });
});
