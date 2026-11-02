import { describe, expect, it } from 'vitest';
import { resolveModelMetadata, lookupModelMeta } from './modelCatalog';
import { MODELS_DEV_SNAPSHOT } from './modelsDevCatalog';

describe('modelCatalog', () => {
  it('resolves a known model from the bundled snapshot', () => {
    const provider = MODELS_DEV_SNAPSHOT.providers.deepseek;
    const modelId = Object.keys(provider.models)[0];
    const meta = resolveModelMetadata('deepseek', modelId, ['text']);

    expect(meta.source).toBe('models.dev');
    expect(meta.capabilities).toContain('chat');
    expect(meta.displayName).toBeTruthy();
  });

  it('derives vision and tool capabilities from metadata', () => {
    const provider = MODELS_DEV_SNAPSHOT.providers.openai;
    const modelId = Object.keys(provider.models).find(
      (id) => provider.models[id].toolCall && provider.models[id].modalities?.input?.includes('image')
    );

    if (modelId) {
      const meta = resolveModelMetadata('openai', modelId, ['text']);
      expect(meta.capabilities).toContain('vision');
      expect(meta.capabilities).toContain('function_calling');
    }
  });

  it('falls back to manual metadata for unknown models', () => {
    const meta = resolveModelMetadata('unknown-provider', 'unknown-model', ['text']);
    expect(meta.source).toBe('manual');
    expect(meta.capabilities).toEqual(['chat', 'completion']);
    expect(meta.contextWindow).toBeUndefined();
  });

  it('uses provider response fields when snapshot is missing', () => {
    const meta = resolveModelMetadata(undefined, 'gpt-test', ['text'], {
      id: 'gpt-test',
      context_length: 128000,
      max_output_tokens: 4096,
      modalities: ['text', 'image'],
      pricing: { input: 1.5, output: 2 },
      tool_call: true,
    });

    expect(meta.source).toBe('provider');
    expect(meta.contextWindow).toBe(128000);
    expect(meta.maxOutputTokens).toBe(4096);
    expect(meta.capabilities).toContain('vision');
    expect(meta.pricing?.input).toBe(1.5);
  });

  it('looks up model ids case-insensitively', () => {
    const provider = MODELS_DEV_SNAPSHOT.providers.deepseek;
    const modelId = Object.keys(provider.models)[0];
    expect(lookupModelMeta('deepseek', modelId.toUpperCase())).toBeTruthy();
  });
});
