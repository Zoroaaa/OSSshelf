/**
 * ai.ts
 *
 * AI 功能集 API 服务层
 *
 * 包含模块：
 * - 核心：状态检查 / 语义搜索 / 摘要生成 / 图片标签 / 重命名建议 / 向量化索引
 * - 批量处理：批量摘要 / 批量标签 / 选中文件处理
 * - 索引诊断：统计 / 向量列表 / 诊断 / 样本详情
 * - config：模型 CRUD / 提供商管理 / 连接测试 / 特征配置 / 系统配置 / Workers AI 目录
 * - chatSession：会话 CRUD / SSE 流式聊天（含自动重试） / 操作确认
 * - memories：长期记忆列表 / 删除
 */

import api from './api-client';
import type { ApiResponse, FileItem } from '@osshelf/shared';

// ══════════════════════════════════════════════════════════════════════════════
// 类型定义 — AI 核心状态 & 任务
// ══════════════════════════════════════════════════════════════════════════════

/** AI 功能总开关状态 */
export interface AIStatus {
  configured: boolean;
  features: {
    semanticSearch: boolean;
    summary: boolean;
    imageTags: boolean;
    renameSuggest: boolean;
  };
}

/** AI 摘要结果 */
export interface AISummaryResult {
  summary: string;
  cached: boolean;
}

/** AI 图片标签结果 */
export interface AIImageTagResult {
  tags: string[];
  caption?: string;
}

/** AI 重命名建议 */
export interface AIRenameSuggestion {
  suggestions: string[];
}

/** 向量化索引任务 */
export interface AIIndexTask {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'idle' | 'cancelled';
  total: number;
  processed: number;
  failed: number;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  error?: string;
}

/** 批量摘要任务 */
export interface AISummarizeTask {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'idle' | 'cancelled';
  total: number;
  processed: number;
  failed: number;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  error?: string;
}

/** 批量标签任务 */
export interface AITagsTask {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'idle' | 'cancelled';
  total: number;
  processed: number;
  failed: number;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  error?: string;
}

/** 索引统计 */
export interface AIIndexStats {
  editable: { total: number; noSummary: number; notIndexed: number };
  image: { total: number; noTags: number; notIndexed: number };
  other: { total: number; notIndexed: number };
}

/** 索引样本详情 */
export interface AIIndexSample {
  file: { id: string; name: string; mimeType: string | null; vectorIndexedAt: string | null; aiSummary: string | null };
  chunkCount?: number;
  vectorize: { found: boolean; metadata: Record<string, unknown> | null } | null;
  indexedText: string;
}

/** 向量条目 */
export interface VectorItem {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  vectorIndexedAt: string | null;
  aiSummary: string | null;
  chunkCount?: number;
  indexedTextLength: number;
  indexedTextPreview: string;
}

/** 向量列表响应 */
export interface VectorListResponse {
  vectors: VectorItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

// ══════════════════════════════════════════════════════════════════════════════
// 类型定义 — AI 配置相关（模型/提供商/系统配置）
// ══════════════════════════════════════════════════════════════════════════════

/** AI 系统配置项 */
export interface AiSystemConfigItem {
  id: string;
  key: string;
  category: string;
  label: string;
  description: string | null;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean;
  jsonValue: string | null;
  defaultValue: string;
  isSystem: boolean;
  isEditable: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** AI 模型 */
export interface AiModel {
  id: string;
  userId: string;
  name: string;
  provider: 'workers_ai' | 'openai_compatible';
  providerId?: string;
  modelId: string;
  apiEndpoint?: string;
  apiKeyEncrypted?: string;
  hasApiKey?: boolean;
  isActive: boolean;
  capabilities: string[];
  temperature: number;
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
  supportsThinking?: boolean;
  thinkingParamFormat?: 'object' | 'boolean' | 'string' | '';
  thinkingParamName?: string;
  thinkingEnabledValue?: string;
  thinkingDisabledValue?: string;
  thinkingNestedKey?: string;
  disableThinkingForFeatures?: string;
  isReadonly?: boolean;
  sortOrder?: number;
}

/** 创建 AI 模型参数 */
export interface CreateAiModelParams {
  name: string;
  provider: 'workers_ai' | 'openai_compatible';
  providerId?: string;
  modelId: string;
  apiEndpoint?: string;
  apiKey?: string;
  capabilities?: string[];
  temperature?: number;
  systemPrompt?: string;
  isActive?: boolean;
  supportsThinking?: boolean;
  thinkingParamFormat?: 'object' | 'boolean' | 'string' | '';
  thinkingParamName?: string;
  thinkingEnabledValue?: string;
  thinkingDisabledValue?: string;
  thinkingNestedKey?: string;
  disableThinkingForFeatures?: string;
  sortOrder?: number;
}

/** AI 提供商元数据 */
export interface AiProvider {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  requiresEndpoint: boolean;
}

/** AI 提供商实例 */
export interface AiProviderItem {
  id: string;
  userId?: string;
  name: string;
  apiEndpoint?: string;
  description?: string;
  thinkingConfig?: string;
  isSystem?: boolean;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 创建 AI 提供商参数 */
export interface CreateAiProviderParams {
  name: string;
  apiEndpoint?: string;
  description?: string;
  thinkingConfig?: string;
  isDefault?: boolean;
}

/** Workers AI 内置模型 */
export interface AiWorkersAiModel {
  id: string;
  name: string;
  capabilities: string[];
  description: string;
}

/** Workers AI 目录中的模型参数（如 context_window / price） */
export interface AiWorkersAiModelProperty {
  key: string;
  value: string;
}

/** Workers AI 实时目录模型 */
export interface AiWorkersAiCatalogModel {
  id: string;
  name: string;
  description: string;
  task: string;
  capabilities: string[];
  properties: AiWorkersAiModelProperty[];
  pricing: string | null;
  beta: boolean;
  deprecated: boolean;
}

/** Workers AI 目录（live = 官方 API 实时同步；fallback = 内置兜底清单） */
export interface AiWorkersAiCatalog {
  source: 'live' | 'fallback';
  configured: boolean;
  fetchedAt: string | null;
  error?: string;
  models: AiWorkersAiCatalogModel[];
}

/** AI 配置总览状态 */
export interface AiConfigStatus {
  configured: boolean;
  queueConfigured?: boolean;
  activeModel: { id: string; name: string; provider: string; modelId: string } | null;
  totalModels: number;
  features: { workersAi: boolean; customApi: boolean; chat: boolean; embedding: boolean };
}

// ══════════════════════════════════════════════════════════════════════════════
// 类型定义 — AI 聊天会话相关
// ══════════════════════════════════════════════════════════════════════════════

/** AI 聊天会话 */
export interface AiChatSession {
  id: string;
  userId: string;
  title: string;
  modelId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastToolCallCount?: number;
  totalTokensUsed?: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// AI — 核心 API
// ══════════════════════════════════════════════════════════════════════════════

export const aiApi = {
  getStatus: () => api.get<ApiResponse<AIStatus>>('/api/ai/status'),

  // ── AI 功能调用 ──
  search: (query: string, options?: { limit?: number; threshold?: number; mimeType?: string }) =>
    api.post<ApiResponse<FileItem[]>>('/api/ai/search', { query, ...options }),
  summarize: (fileId: string) => api.post<ApiResponse<AISummaryResult>>(`/api/ai/summarize/${fileId}`),
  generateTags: (fileId: string) => api.post<ApiResponse<AIImageTagResult>>(`/api/ai/tags/${fileId}`),
  suggestRename: (fileId: string) => api.post<ApiResponse<AIRenameSuggestion>>(`/api/ai/rename-suggest/${fileId}`),
  suggestFileName: (params: { content: string; mimeType?: string | null; extension?: string }) =>
    api.post<ApiResponse<AIRenameSuggestion>>('/api/ai/name-suggest', params),

  // ── 向量化索引 ──
  indexAll: () => api.post<ApiResponse<{ message: string; task: AIIndexTask }>>('/api/ai/index/all'),
  getIndexStatus: () => api.get<ApiResponse<AIIndexTask>>('/api/ai/index/status'),
  cancelIndexTask: () => api.delete<ApiResponse<{ message: string; task: AIIndexTask }>>('/api/ai/index/task'),
  /** 任务失败明细（按文件给出错误原因，便于排查） */
  getFailedTaskItems: (taskId: string, limit = 50) =>
    api.get<
      ApiResponse<{
        taskId: string;
        taskError: string | null;
        taskStatus: string;
        items: Array<{
          fileId: string;
          fileName: string;
          error: string;
          attempts: number;
          updatedAt: string;
        }>;
      }>
    >('/api/ai/tasks/failed-items', { params: { taskId, limit } }),
  deleteIndex: (fileId: string) => api.delete<ApiResponse<{ message: string }>>(`/api/ai/index/${fileId}`),

  // ── 批量处理 ──
  summarizeBatch: () => api.post<ApiResponse<{ message: string; task: AISummarizeTask }>>('/api/ai/summarize/batch'),
  getSummarizeTask: () => api.get<ApiResponse<AISummarizeTask>>('/api/ai/summarize/task'),
  cancelSummarizeTask: () =>
    api.delete<ApiResponse<{ message: string; task: AISummarizeTask }>>('/api/ai/summarize/batch'),
  tagsBatch: () => api.post<ApiResponse<{ message: string; task: AITagsTask }>>('/api/ai/tags/batch'),
  getTagsTask: () => api.get<ApiResponse<AITagsTask>>('/api/ai/tags/task'),
  cancelTagsTask: () => api.delete<ApiResponse<{ message: string; task: AITagsTask }>>('/api/ai/tags/batch'),

  /** 对选中的文件执行批量处理（摘要 + 标签） */
  processSelected: (params: { fileIds: string[]; types: ('summary' | 'tags')[] }) =>
    api.post<
      ApiResponse<{
        message: string;
        task: AIIndexTask;
        summaryCount: number;
        tagsCount: number;
      }>
    >('/api/ai/process-selected', params),

  // ── 索引诊断 & 管理 ──
  getIndexStats: () => api.get<ApiResponse<AIIndexStats>>('/api/ai/index/stats'),
  rebuildIndex: () => api.post<ApiResponse<{ message: string; task: AIIndexTask }>>('/api/ai/index/rebuild'),
  getVectors: (params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<ApiResponse<VectorListResponse>>('/api/ai/index/vectors', { params }),
  deleteVectorsBatch: (fileIds: string[]) =>
    api.post<ApiResponse<{ deleted: number }>>('/api/ai/index/vectors/batch-delete', { fileIds }),
  deleteAllVectors: () =>
    api.delete<ApiResponse<{ deleted: number }>>('/api/ai/index/vectors/all'),
  getIndexSample: (fileId: string) => api.get<ApiResponse<AIIndexSample>>(`/api/ai/index/sample/${fileId}`),

  // ═══════════════════════════════════════════════════════════════════════════
  // config — AI 模型 / 提供商 / 系统配置 / 特征配置
  // ═══════════════════════════════════════════════════════════════════════════

  config: {
    getModels: (capability?: 'chat' | 'vision' | 'embedding') =>
      api.get<ApiResponse<AiModel[]>>('/api/ai-config/models', { params: capability ? { capability } : {} }),
    createModel: (data: CreateAiModelParams) => api.post<ApiResponse<AiModel>>('/api/ai-config/models', data),
    updateModel: (modelId: string, data: Partial<CreateAiModelParams>) =>
      api.put<ApiResponse<AiModel>>(`/api/ai-config/models/${modelId}`, data),
    deleteModel: (modelId: string) => api.delete<ApiResponse<{ message: string }>>(`/api/ai-config/models/${modelId}`),
    activateModel: (modelId: string) =>
      api.post<ApiResponse<{ message: string; activeModelId: string }>>(`/api/ai-config/models/${modelId}/activate`),
    getProviders: () =>
      api.get<ApiResponse<{ providers: AiProvider[]; workersAiModels: AiWorkersAiModel[] }>>(
        '/api/ai-config/providers'
      ),
    /** Workers AI 实时模型目录（含参数/价格，未配置凭据时回退内置清单） */
    getWorkersAiModels: (refresh = false) =>
      api.get<ApiResponse<AiWorkersAiCatalog>>('/api/ai-config/workers-ai/models', {
        params: refresh ? { refresh: '1' } : {},
      }),
    getStatus: () => api.get<ApiResponse<AiConfigStatus>>('/api/ai-config/status'),
    testModel: (data: { modelId?: string; provider?: string; apiEndpoint?: string; apiKey?: string }) =>
      api.post<ApiResponse<{ valid: boolean; response?: string; model?: string; latencyMs?: number; error?: string }>>(
        '/api/ai-config/test',
        data
      ),

    // ── AI 提供商管理 ──
    getAiProviders: () => api.get<ApiResponse<AiProviderItem[]>>('/api/ai-config/ai-providers'),
    createAiProvider: (data: CreateAiProviderParams) =>
      api.post<ApiResponse<AiProviderItem>>('/api/ai-config/ai-providers', data),
    updateAiProvider: (providerId: string, data: Partial<CreateAiProviderParams>) =>
      api.put<ApiResponse<AiProviderItem>>(`/api/ai-config/ai-providers/${providerId}`, data),
    deleteAiProvider: (providerId: string) =>
      api.delete<ApiResponse<{ message: string }>>(`/api/ai-config/ai-providers/${providerId}`),
    setDefaultProvider: (providerId: string) =>
      api.post<ApiResponse<{ message: string; providerId: string }>>(
        `/api/ai-config/ai-providers/${providerId}/set-default`
      ),

    // ── 特征配置（摘要/图片说明/标签/重命名提示词）──
    getFeatureConfig: () =>
      api.get<
        ApiResponse<{
          summary: string | null;
          imageCaption: string | null;
          imageTag: string | null;
          rename: string | null;
        }>
      >('/api/ai-config/feature-config'),
    saveFeatureConfig: (data: {
      summary?: string | null;
      imageCaption?: string | null;
      imageTag?: string | null;
      rename?: string | null;
    }) => api.put<ApiResponse<{ message: string; config: any }>>('/api/ai-config/feature-config', data),

    // ── 系统配置 ──
    getSystemConfig: () => api.get<ApiResponse<AiSystemConfigItem[]>>('/api/ai-config/system-config'),
    updateSystemConfig: (key: string, value: unknown) =>
      api.put<ApiResponse<{ message: string; key: string }>>(`/api/ai-config/system-config/${key}`, { value }),
    resetSystemConfig: (key: string) =>
      api.post<ApiResponse<{ message: string; key: string }>>(`/api/ai-config/system-config/${key}/reset`),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // usage — AI 用量统计
  // ═══════════════════════════════════════════════════════════════════════════

  usage: {
    getSummary: (days = 7) =>
      api.get<
        ApiResponse<{
          days: number;
          totals: { inputTokens: number; outputTokens: number; requests: number };
          byDay: Array<{ day: string; inputTokens: number; outputTokens: number; requests: number }>;
          byModel: Array<{ modelId: string; inputTokens: number; outputTokens: number; requests: number }>;
          byFeature: Array<{ feature: string; inputTokens: number; outputTokens: number; requests: number }>;
        }>
      >(`/api/ai/usage/summary?days=${days}`),
    getQuota: () =>
      api.get<
        ApiResponse<{
          allowed: boolean;
          reason?: string;
          usedTokens: number;
          tokenLimit: number;
          usedRequests: number;
          requestLimit: number;
          minuteRequests: number;
          minuteLimit: number;
        }>
      >('/api/ai/usage/quota'),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // chatSession — AI 聊天会话管理
  // ═══════════════════════════════════════════════════════════════════════════

  chatSession: {
    getSessions: () => api.get<ApiResponse<AiChatSession[]>>('/api/ai-chat/sessions'),
    createSession: (data: { id?: string; title?: string; modelId?: string }) =>
      api.post<ApiResponse<AiChatSession>>('/api/ai-chat/sessions', data),
    updateSession: (sessionId: string, data: { title: string }) =>
      api.put<ApiResponse<AiChatSession>>(`/api/ai-chat/sessions/${sessionId}`, data),
    deleteSession: (sessionId: string) =>
      api.delete<ApiResponse<{ message: string }>>(`/api/ai-chat/sessions/${sessionId}`),
    deleteAllSessions: () => api.delete<ApiResponse<{ deleted: number }>>('/api/ai-chat/sessions'),

    /** 首轮对话后生成标题（失败时后端返回原标题） */
    generateTitle: (sessionId: string) =>
      api.post<ApiResponse<{ id: string; title: string }>>(`/api/ai-chat/sessions/${sessionId}/title`, {}),

    /** 导出会话为 Markdown 文件 */
    exportMarkdown: (sessionId: string) =>
      api.get<Blob>(`/api/ai-chat/sessions/${sessionId}/export`, { responseType: 'blob' }),

    /** 换取 Agent WebSocket 票据 */
    wsTicket: async (
      sessionId: string
    ): Promise<{ ticket: string; agent: string; name: string; expiresIn: number } | null> => {
      try {
        const res = await api.post<ApiResponse<{ ticket: string; agent: string; name: string; expiresIn: number }>>(
          '/api/ai-chat/ws-ticket',
          { sessionId }
        );
        return res.data?.data ?? null;
      } catch {
        return null;
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // memories — AI 记忆管理
  // ═══════════════════════════════════════════════════════════════════════════

  memories: {
    list: (params?: { type?: string; limit?: number; offset?: number }) =>
      api.get<
        ApiResponse<{
          items: Array<{ id: string; type: string; summary: string; sessionId: string; createdAt: string }>;
          total: number;
        }>
      >('/api/ai-chat/memories', { params }),
    delete: (memoryId: string) => api.delete<ApiResponse<{ success: boolean }>>(`/api/ai-chat/memories/${memoryId}`),
    deleteMany: (ids: string[]) =>
      api.post<ApiResponse<{ deleted: number }>>('/api/ai-chat/memories/batch-delete', { ids }),
    deleteAll: () => api.delete<ApiResponse<{ deleted: number }>>('/api/ai-chat/memories'),
  },
};
