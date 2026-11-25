import { describe, expect, it } from 'vitest';
import { buildSnapshotFromRaw, countSnapshot, listCatalogProviders } from './runtimeCatalog';

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
    // 非白名单 provider 仍保留元数据供目录展示，但不保留模型明细（控制快照体积）
    expect(snapshot.providers.unknown?.name).toBe('Unknown');
    expect(snapshot.providers.unknown?.modelCount).toBe(1);
    expect(Object.keys(snapshot.providers.unknown?.models ?? {})).toHaveLength(0);

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

  it('keeps metadata but drops model details for providers without a preset', () => {
    const snapshot = buildSnapshotFromRaw({
      deepseek: { name: 'DeepSeek', api: 'https://api.deepseek.com', models: { a: { name: 'A' } } },
      acme: { name: 'Acme', api: 'https://api.acme.com', models: { b: { name: 'B' }, c: { name: 'C' } } },
    });

    expect(snapshot.providers.acme?.api).toBe('https://api.acme.com');
    expect(snapshot.providers.acme?.modelCount).toBe(2);
    expect(Object.keys(snapshot.providers.acme?.models ?? {})).toHaveLength(0);
    // 目录统计用完整 modelCount，不受明细裁剪影响
    expect(countSnapshot(snapshot)).toEqual({ providerCount: 2, modelCount: 3 });
  });

  it('lists only providers with a directly usable https endpoint', () => {
    const snapshot = buildSnapshotFromRaw({
      deepseek: { name: 'DeepSeek', api: 'https://api.deepseek.com', doc: 'https://docs.example.com', models: {} },
      templated: { name: 'Templated', api: 'https://api.example.com/${ACCOUNT_ID}/v1', models: {} },
      noapi: { name: 'No Api', npm: '@ai-sdk/vertex', models: {} },
    });

    const items = listCatalogProviders(snapshot);
    expect(items.map((item) => item.id)).toEqual(['deepseek']);
    expect(items[0]?.hasPreset).toBe(true);
    expect(items[0]?.logoUrl).toContain('deepseek');
  });
});
