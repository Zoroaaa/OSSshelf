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
  /**
   * models.dev 上的完整模型数量。
   * 快照只保留白名单 provider 的模型明细（控制体积），非白名单 provider 的 models 为空，
   * 但目录需要展示真实模型数，故单独记录。
   */
  modelCount?: number;
  models: Record<string, ModelsDevModelMeta>;
}

export interface ModelsDevSnapshot {
  generatedAt: string;
  providers: Record<string, ModelsDevProviderMeta>;
}
