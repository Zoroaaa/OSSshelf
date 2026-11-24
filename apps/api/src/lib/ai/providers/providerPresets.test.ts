import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS } from './providerPresets';
import { MODELS_DEV_SNAPSHOT } from '../catalog/modelsDevCatalog';

describe('providerPresets', () => {
  it('uses unique preset ids', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('requires a legal endpoint for every preset that needs a key', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.id === 'workers_ai') continue;
      expect(preset.baseUrl, preset.id).toMatch(/^https:\/\//);
      expect(['openai_compatible', 'anthropic'], preset.id).toContain(preset.kind);
    }
  });

  it('keeps metadataProviderId aligned with the bundled models.dev snapshot', () => {
    const missing: string[] = [];
    for (const preset of PROVIDER_PRESETS) {
      if (!preset.metadataProviderId) continue;
      if (!MODELS_DEV_SNAPSHOT.providers[preset.metadataProviderId]) {
        missing.push(`${preset.id} -> ${preset.metadataProviderId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('covers the requested mainstream providers', () => {
    const ids = new Set(PROVIDER_PRESETS.map((preset) => preset.id));
    for (const id of [
      'nvidia',
      'agnes',
      'opencode',
      'modelscope',
      'meta',
      'cohere',
      'together',
      'fireworks',
      'deepinfra',
      'huggingface',
      'openrouter',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
