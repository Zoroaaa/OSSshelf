/**
 * ai.ts
 *
 * AI 功能集 API 服务层
 *
 * 包含模块：
 * - 核心：状态检查 / 语义搜索 / 摘要生成 / 图片标签 / 重命名建议 / 向量化索引
 * - 批量处理：批量摘要 / 批量标签 / 选中文件处理
 * - 索引诊断：统计 / 向量列表 / 诊断 / 样本详情
 * - config：模型 CRUD / 提供商管理 / 连接测试 / 特征配置 / 系统配置
 * - chatSession：会话 CRUD / SSE 流式聊天（含自动重试） / 操作确认
 * - memories：长期记忆列表 / 删除
 */

import api from './api-client';
import { useAuthStore } from '../stores/auth';
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

/** 单个文件的 AI 处理状态 */
export interface AIFileStatus {
  hasSummary: boolean;
  summary: string | null;
  summaryAt: string | null;
  hasTags: boolean;
  tags: string[];
  tagsAt: string | null;
  vectorIndexed: boolean;
  vectorIndexedAt: string | null;
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

/** 索引诊断信息 */
export interface AIIndexDiagnose {
  vectorize: {
    configured: boolean;
    totalCount: number;
    userCount: number;
    sampleVectors: Array<{ id: string; score: number; metadata: Record<string, unknown> }>;
  };
  database: { totalFiles: number; indexedFiles: number; filesWithSummary: number; mismatchedFiles: string[] };
  testSearch: { success: boolean; resultCount: number; sampleQuery: string; error: string };
}

/** 索引样本详情 */
export interface AIIndexSample {
  file: { id: string; name: string; mimeType: string | null; vectorIndexedAt: string | null; aiSummary: string | null };
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
  vectorize: { found: boolean; metadata: Record<string, unknown> | null };
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

/** OpenAI 兼容模型 */
export interface AiOpenAiModel {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  description: string;
}

/** AI 配置总览状态 */
export interface AiConfigStatus {
  configured: boolean;
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

/** AI 聊天消息 */
export interface AiChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
  toolCalls?: Array<{
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
  }>;
  reasoning?: string;
  modelUsed?: string;
  latencyMs?: number;
  aborted?: boolean;
  mentionedFiles?: Array<{ id: string; name: string }>;
  createdAt: string;
}

/** AI 聊天会话详情（含消息列表） */
export interface AiChatSessionDetail extends AiChatSession {
  messages: AiChatMessage[];
}

// ══════════════════════════════════════════════════════════════════════════════
// AI — 核心 API
// ══════════════════════════════════════════════════════════════════════════════

export const aiApi = {
  getStatus: () => api.get<ApiResponse<AIStatus>>('/api/ai/status'),
  getFileStatus: (fileId: string) => api.get<ApiResponse<AIFileStatus>>(`/api/ai/file/${fileId}`),

  // ── AI 功能调用 ──
  search: (query: string, options?: { limit?: number; threshold?: number; mimeType?: string }) =>
    api.post<ApiResponse<FileItem[]>>('/api/ai/search', { query, ...options }),
  summarize: (fileId: string) => api.post<ApiResponse<AISummaryResult>>(`/api/ai/summarize/${fileId}`),
  generateTags: (fileId: string) => api.post<ApiResponse<AIImageTagResult>>(`/api/ai/tags/${fileId}`),
  suggestRename: (fileId: string) => api.post<ApiResponse<AIRenameSuggestion>>(`/api/ai/rename-suggest/${fileId}`),
  suggestFileName: (params: { content: string; mimeType?: string | null; extension?: string }) =>
    api.post<ApiResponse<AIRenameSuggestion>>('/api/ai/name-suggest', params),

  // ── 向量化索引 ──
  indexFile: (fileId: string) => api.post<ApiResponse<{ message: string }>>(`/api/ai/index/${fileId}`),
  indexBatch: (fileIds: string[]) =>
    api.post<ApiResponse<Array<{ fileId: string; status: string; error?: string }>>>('/api/ai/index/batch', {
      fileIds,
    }),
  indexAll: () => api.post<ApiResponse<{ message: string; task: AIIndexTask }>>('/api/ai/index/all'),
  getIndexStatus: () => api.get<ApiResponse<AIIndexTask>>('/api/ai/index/status'),
  cancelIndexTask: () => api.delete<ApiResponse<{ message: string; task: AIIndexTask }>>('/api/ai/index/task'),
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
  getVectors: (params?: { page?: number; pageSize?: number; search?: string }) =>
    api.get<ApiResponse<VectorListResponse>>('/api/ai/index/vectors', { params }),
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
      api.get<
        ApiResponse<{ providers: AiProvider[]; workersAiModels: AiWorkersAiModel[]; openAiModels: AiOpenAiModel[] }>
      >('/api/ai-config/providers'),
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
  // chatSession — AI 聊天会话管理
  // ═══════════════════════════════════════════════════════════════════════════

  chatSession: {
    getSessions: () => api.get<ApiResponse<AiChatSession[]>>('/api/ai-chat/sessions'),
    getSession: (sessionId: string) => api.get<ApiResponse<AiChatSessionDetail>>(`/api/ai-chat/sessions/${sessionId}`),
    updateSession: (sessionId: string, data: { title: string }) =>
      api.put<ApiResponse<AiChatSession>>(`/api/ai-chat/sessions/${sessionId}`, data),
    deleteSession: (sessionId: string) =>
      api.delete<ApiResponse<{ message: string }>>(`/api/ai-chat/sessions/${sessionId}`),
    confirmAction: (confirmId: string) =>
      api.post<ApiResponse<{ result: unknown; confirmedAt: string }>>('/api/ai-chat/confirm', { confirmId }),
    cancelAction: (confirmId: string) =>
      api.post<ApiResponse<{ cancelledAt: string }>>('/api/ai-chat/cancel', { confirmId }),

    /**
     * SSE 流式聊天接口
     *
     * 支持自动重试机制（最多 MAX_RETRIES 次，指数退避），
     * 通过 onChunk 回调实时推送解析后的 SSE 数据块。
     * 支持 AbortSignal 取消请求。
     */
    chatStream: async (
      query: string,
      options: {
        sessionId?: string;
        modelId?: string;
        maxFiles?: number;
        includeFileContent?: boolean;
        contextFolderId?: string;
        contextFileIds?: string[];
        onChunk: (chunk: {
          content?: string;
          done?: boolean;
          sessionId?: string;
          sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
          error?: string;
          toolStart?: boolean;
          toolResult?: boolean;
          toolName?: string;
          toolCallId?: string;
          args?: Record<string, unknown>;
          result?: unknown;
          confirmRequest?: boolean;
          confirmId?: string;
          summary?: string;
          reasoning?: boolean;
          reset?: boolean;
        }) => void;
        onError?: (error: Error) => void;
        signal?: AbortSignal;
      }
    ) => {
      const token = useAuthStore.getState().token;
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 1000;

      let retryCount = 0;
      let lastError: Error | null = null;

      while (retryCount <= MAX_RETRIES) {
        try {
          if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

          const response = await fetch(`${baseUrl}/api/ai-chat/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ query, ...options, stream: true }),
            signal: options.signal,
          });

          if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
              const errorJson = JSON.parse(errorText);
              errorMessage = errorJson.error || errorJson.message || errorMessage;
            } catch {
              if (errorText) errorMessage = errorText;
            }
            throw new Error(errorMessage);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error('No reader available');

          const decoder = new TextDecoder();
          let buffer = '';
          let streamDone = false;

          while (!streamDone) {
            if (options.signal?.aborted) {
              try {
                await reader.cancel();
              } catch {
                /* ignore */
              }
              throw new DOMException('The operation was aborted.', 'AbortError');
            }

            const { done, value } = await reader.read();
            if (done) {
              streamDone = true;
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
              try {
                const data = JSON.parse(trimmedLine.slice(6));
                options.onChunk(data);
                if (data.done) return;
                if (data.error) {
                  lastError = new Error(data.error);
                  if (retryCount < MAX_RETRIES && !data.error.includes('认证') && !data.error.includes('权限')) {
                    retryCount++;
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * retryCount));
                    continue;
                  }
                  throw lastError;
                }
              } catch (parseError) {
                if (parseError instanceof SyntaxError) continue;
                throw parseError;
              }
            }
          }
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (options.signal?.aborted || lastError.name === 'AbortError') {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          if (retryCount >= MAX_RETRIES) {
            options.onError?.(lastError);
            throw lastError;
          }
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * retryCount));
        }
      }
      if (lastError) {
        options.onError?.(lastError);
        throw lastError;
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
  },
};
