import { describe, expect, it } from 'vitest';
import { mapModelConfig } from './modelConfigMapper';
import type { AiProviderRow } from './providers/providerService';

function modelRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    userId: 'u1',
    name: 'Model',
    provider: 'openai_compatible',
    providerId: 'p1',
    modelId: 'gpt-test',
    isActive: true,
    capabilities: '["chat","vision"]',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: '["text","image"]',
    pricingJson: '{"input":1.5,"output":2}',
    metadataSource: 'models.dev',
    temperature: 0.7,
    configJson: '{}',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    supportsThinking: true,
    thinkingParamFormat: null,
    thinkingParamName: null,
    thinkingEnabledValue: null,
    thinkingDisabledValue: null,
    thinkingNestedKey: null,
    disableThinkingForFeatures: null,
    isReadonly: false,
    sortOrder: 0,
    ...overrides,
  };
}

function providerRow(overrides: Partial<AiProviderRow> = {}): AiProviderRow {
  return {
    id: 'p1',
    userId: 'u1',
    name: 'Anthropic',
    protocol: 'anthropic',
    apiEndpoint: 'https://api.anthropic.com/v1',
    apiKeyEncrypted: 'encrypted-key',
    presetId: 'anthropic',
    logoUrl: null,
    headersJson: '{"x-test":"1"}',
    discoveredModelsJson: null,
    modelsSyncedAt: null,
    defaultInput: '["text"]',
    description: null,
    thinkingConfig: JSON.stringify({
      paramFormat: 'object',
      paramName: 'thinking',
      nestedKey: 'type',
      enabledValue: 'enabled',
      disabledValue: 'disabled',
    }),
    isSystem: false,
    isDefault: false,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    ...overrides,
  } as AiProviderRow;
}

describe('mapModelConfig', () => {
  it('takes protocol, endpoint and key from the provider connection', () => {
    const config = mapModelConfig(modelRow(), providerRow());

    expect(config.provider).toBe('anthropic');
    expect(config.protocol).toBe('anthropic');
    expect(config.apiEndpoint).toBe('https://api.anthropic.com/v1');
    expect(config.apiKeyEncrypted).toBe('encrypted-key');
    expect(config.headers).toEqual({ 'x-test': '1' });
    expect(config.providerName).toBe('Anthropic');
    expect(config.providerUpdatedAt).toBe('2026-01-02');
  });

  it('keeps workers_ai models without a provider', () => {
    const config = mapModelConfig(
      modelRow({ provider: 'workers_ai', providerId: null, capabilities: '["chat"]' }),
      null
    );

    expect(config.provider).toBe('workers_ai');
    expect(config.apiEndpoint).toBeUndefined();
    expect(config.apiKeyEncrypted).toBeUndefined();
  });

  it('parses metadata fields', () => {
    const config = mapModelConfig(modelRow(), providerRow());

    expect(config.capabilities).toEqual(['chat', 'vision']);
    expect(config.contextWindow).toBe(128000);
    expect(config.maxOutputTokens).toBe(4096);
    expect(config.inputModalities).toEqual(['text', 'image']);
    expect(config.pricing).toEqual({ input: 1.5, output: 2 });
  });

  it('applies provider thinking defaults when model fields are empty', () => {
    const config = mapModelConfig(modelRow(), providerRow());

    expect(config.thinkingParamFormat).toBe('object');
    expect(config.thinkingParamName).toBe('thinking');
    expect(config.thinkingNestedKey).toBe('type');
    expect(config.thinkingEnabledValue).toBe('enabled');
    expect(config.thinkingDisabledValue).toBe('disabled');
  });
});
