/**
 * catalog/types.ts
 * models.dev 快照的类型定义
 */

export interface ModelsDevReasoningOption {
  type: 'toggle' | 'effort' | string;
  values?: string[];
}

export interface ModelsDevModelMeta {
  name?: string;
  attachment?: boolean;
  reasoning?: boolean;
  reasoningOptions?: ModelsDevReasoningOption[];
  toolCall?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
  };
  status?: 'alpha' | 'beta' | 'deprecated';
  releaseDate?: string;
}

export interface ModelsDevProviderMeta {
  name: string;
  api?: string;
  doc?: string;
  npm?: string;
  env?: string[];
  models: Record<string, ModelsDevModelMeta>;
}

export interface ModelsDevSnapshot {
  generatedAt: string;
  providers: Record<string, ModelsDevProviderMeta>;
}
