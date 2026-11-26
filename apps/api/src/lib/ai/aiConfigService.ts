/**
 * aiConfigService.ts
 * AI功能配置管理服务
 *
 * 功能:
 * - 读取AI相关配置项
 * - 初始化默认配置
 * - 提供配置访问接口
 */

import { getDb, aiConfig } from '../../db';
import { eq } from 'drizzle-orm';
import type { Env } from '../../types/env';
import { logger } from '@osshelf/shared';
import { AI_CONFIG_LOG_MODULE } from './constants';

export interface AiConfigUiMeta {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  multiline?: boolean;
  rows?: number;
  options?: Array<{ label: string; value: string }>;
  advanced?: boolean;
}

export interface AiConfigItem {
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
  ui?: AiConfigUiMeta;
}

export type AiConfigValue = string | number | boolean | object | null;

/**
 * 模型请求重试/超时的唯一默认值来源。
 * 注册表、modelRuntime、Agent 都从这里读取，避免多处字面量漂移。
 */
export const AI_REQUEST_DEFAULTS = {
  maxRetries: 3,
  timeoutMs: 30_000,
  /** 图片理解请求（含流式）独立超时：截图/大图通常比纯文本慢一个数量级 */
  visionTimeoutMs: 120_000,
} as const;

/**
 * 以下默认值是「注册表默认值 + 业务代码 fallback」的唯一来源。
 * 规则：业务代码只允许引用这里的常量，不得再写字面量（aiConfigRegistry.test.ts 静态守卫）。
 */
export const AI_AGENT_DEFAULTS = {
  maxSteps: 20,
  maxContextTokens: 100_000,
  /** 历史消息可占用的上下文比例 */
  contextHistoryRatio: 0.7,
  minKeepMessages: 2,
  maxContextFiles: 5,
  memoryExtractInterval: 4,
  maxPersistedMessages: 200,
  streamStallTimeoutMs: 120_000,
  ticketTtlMs: 600_000,
  /** L1 任务状态层预算比例 */
  taskStateRatio: 0.1,
  /** L2 已解析资产层预算比例 */
  contextAssetRatio: 0.15,
} as const;

export const AI_RAG_DEFAULTS = {
  rrfK: 60,
  vectorThreshold: 0.5,
  chunkThreshold: 0.25,
  topKMultiplier: 5,
  ftsMaxTokens: 8,
  rerankModel: '@cf/baai/bge-reranker-base',
  rerankTimeoutMs: 10_000,
  chunkOverlap: 128,
  maxChunks: 20,
  maxSourceChars: 50_000,
  ftsCircuitTtlMs: 60_000,
  contextTopK: 5,
} as const;

export const AI_TASK_DEFAULTS = {
  stepTimeoutMs: 60_000,
  maxRetries: 3,
  deadLetterAfter: 10,
  approvalRequiredLevel: 'write' as 'write' | 'irreversible',
} as const;

export const AI_TOOL_DEFAULTS = {
  /**
   * 条件注入后实际候选约 70 个；40 会因定义顺序把写工具挤掉（多步任务直接不可用），
   * 60 只裁掉最不相关的尾部工具，仍显著低于全量近百个。
   */
  maxToolDefinitions: 60,
} as const;

export const AI_MODEL_DEFAULTS = {
  anthropicThinkingBudget: 1024,
} as const;

export const AI_UI_DEFAULTS = {
  connectTimeoutMs: 10_000,
  identityWaitMs: 9_000,
  maxQueryLength: 15_000,
  suggestions: [
    '帮我找最近上传的文件',
    '查看我的存储统计',
    '有哪些带有"项目"标签的文件？',
    '列出根目录的内容',
    '我收藏了哪些文件？',
    '帮我创建一个备忘录文件，内容是明天要去开会',
    '帮我把这段代码保存到代码文件夹',
    '查看我分享了哪些文件',
  ],
  capabilityTags: ['文件检索', '内容理解', '批量整理', '分享管理', '存储分析'],
} as const;

/** 条件注入工具组的默认配置：key 对应 getToolsByCategory() 的分类名 */
export const AI_TOOL_CONDITIONAL_GROUPS_DEFAULT = {
  groups: [
    { key: '🔗 分享链接', pattern: '分享|链接|直链|上传链接|二维码' },
    { key: '🔐 权限管理', pattern: '权限|授权|撤销|用户组|成员|访问级别|过期' },
    { key: '💾 存储管理', pattern: '存储桶|迁移|bucket|存储用量|清理|大文件|文件夹大小' },
    { key: '⚙️ 系统管理', pattern: 'webhook|api\\s*key|密钥|审计|系统状态|接口密钥' },
  ],
  alwaysOnSystemTools: [
    'get_system_status',
    'get_help',
    'get_version_info',
    'get_faq',
    'get_user_profile',
    'update_plan',
  ],
} as const;

/**
 * 系统配置 UI 元数据（校验范围 / 单位 / 多行 / 只读折叠）
 * 只影响展示与校验，不落库。
 */
export const SYSTEM_CONFIG_UI_META: Record<string, AiConfigUiMeta> = {
  'ai.model.temperature': { min: 0, max: 2, step: 0.1 },
  'ai.agent.max_steps': { min: 1, max: 100, step: 1, unit: '步' },
  'ai.agent.max_context_tokens': {
    min: 10_000,
    max: 400_000,
    step: 1_000,
    unit: 'tokens',
  },
  'ai.agent.context_history_ratio': { min: 0.1, max: 1, step: 0.05 },
  'ai.agent.min_keep_messages': { min: 0, max: 50, step: 1, unit: '条', advanced: true },
  'ai.agent.max_context_files': { min: 1, max: 20, step: 1, unit: '个' },
  'ai.agent.memory_extract_interval': { min: 1, max: 50, step: 1, unit: '轮', advanced: true },
  'ai.agent.max_persisted_messages': { min: 20, max: 2_000, step: 10, unit: '条', advanced: true },
  'ai.agent.stream_stall_timeout_ms': { min: 30_000, max: 600_000, step: 1_000, unit: 'ms', advanced: true },
  'ai.agent.ticket_ttl_ms': { min: 60_000, max: 3_600_000, step: 60_000, unit: 'ms', advanced: true },
  'ai.agent.task_state_ratio': { min: 0, max: 0.5, step: 0.01 },
  'ai.agent.context_asset_ratio': { min: 0, max: 0.5, step: 0.01 },
  'ai.rag.rrf_k': { min: 1, max: 200, step: 1, advanced: true },
  'ai.rag.vector_threshold': { min: 0, max: 1, step: 0.01 },
  'ai.rag.chunk_threshold': { min: 0, max: 1, step: 0.01, advanced: true },
  'ai.rag.top_k_multiplier': { min: 1, max: 20, step: 1, advanced: true },
  'ai.rag.fts_max_tokens': { min: 1, max: 32, step: 1, advanced: true },
  'ai.rag.rerank_model': { advanced: true },
  'ai.rag.rerank_timeout_ms': { min: 1_000, max: 60_000, step: 1_000, unit: 'ms', advanced: true },
  'ai.rag.chunk_overlap': { min: 0, max: 1_024, step: 16, unit: '字符', advanced: true },
  'ai.rag.max_chunks': { min: 1, max: 100, step: 1, unit: '块', advanced: true },
  'ai.rag.max_source_chars': { min: 1_000, max: 500_000, step: 1_000, unit: '字符', advanced: true },
  'ai.rag.fts_circuit_ttl_ms': { min: 1_000, max: 600_000, step: 1_000, unit: 'ms', advanced: true },
  'ai.rag.context_top_k': { min: 1, max: 20, step: 1, unit: '条' },
  'ai.task.step_timeout_ms': { min: 5_000, max: 600_000, step: 1_000, unit: 'ms', advanced: true },
  'ai.task.max_retries': { min: 0, max: 10, step: 1, unit: '次', advanced: true },
  'ai.task.dead_letter_after': { min: 1, max: 100, step: 1, unit: '次', advanced: true },
  'ai.task.approval_required_level': {
    options: [
      { label: '所有写操作', value: 'write' },
      { label: '仅不可逆操作', value: 'irreversible' },
    ],
  },
  'ai.tool.conditional_groups': { multiline: true, rows: 8, advanced: true },
  'ai.tool.max_tool_definitions': { min: 5, max: 120, step: 1, unit: '个' },
  'ai.model.anthropic_thinking_budget': { min: 512, max: 8_192, step: 256, unit: 'tokens', advanced: true },
  'ai.ui.connect_timeout_ms': { min: 3_000, max: 60_000, step: 1_000, unit: 'ms', advanced: true },
  'ai.ui.identity_wait_ms': { min: 3_000, max: 60_000, step: 1_000, unit: 'ms', advanced: true },
  'ai.ui.max_query_length': { min: 1_000, max: 100_000, step: 1_000, unit: '字符' },
  'ai.ui.suggestions': { multiline: true, rows: 8 },
  'ai.ui.capability_tags': { multiline: true, rows: 4 },
  'ai.tool.max_image_size_bytes': { min: 0, max: 52_428_800, step: 1_024, unit: 'bytes' },
  'ai.tool.text_chunk_size': { min: 100, max: 10_000, step: 100, unit: '字符' },
  'ai.tool.max_result_bytes': { min: 1_024, max: 1_048_576, step: 1_024, unit: 'bytes' },
  'ai.rag.rerank_enabled': { advanced: false },
  'ai.request.max_retries': { min: 0, max: 10, step: 1, unit: '次', advanced: true },
  'ai.request.timeout_ms': { min: 5_000, max: 120_000, step: 1_000, unit: 'ms' },
  'ai.request.vision_timeout_ms': { min: 5_000, max: 300_000, step: 1_000, unit: 'ms' },
  'ai.quota.daily_tokens': { min: 0, max: 100_000_000, step: 1_000, unit: 'tokens' },
  'ai.quota.daily_requests': { min: 0, max: 100_000, step: 1, unit: '次' },
  'ai.quota.estimated_tokens_per_request': { min: 0, max: 200_000, step: 100, unit: 'tokens', advanced: true },
  'ai.rate.requests_per_minute': { min: 0, max: 10_000, step: 1, unit: '次/分' },
  'ai.summary.prompt.default': { multiline: true, rows: 6 },
  'ai.summary.prompt.code': { multiline: true, rows: 6 },
  'ai.summary.prompt.markdown': { multiline: true, rows: 6 },
  'ai.summary.prompt.data': { multiline: true, rows: 6 },
};

export function validateAiConfigValue(config: AiConfigItem, value: unknown): { valid: boolean; error?: string } {
  const ui = SYSTEM_CONFIG_UI_META[config.key];

  switch (config.valueType) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { valid: false, error: '请输入有效数字' };
      }
      if (ui?.min !== undefined && value < ui.min) {
        return { valid: false, error: `不能小于 ${ui.min}` };
      }
      if (ui?.max !== undefined && value > ui.max) {
        return { valid: false, error: `不能大于 ${ui.max}` };
      }
      return { valid: true };
    }
    case 'boolean':
      return typeof value === 'boolean' ? { valid: true } : { valid: false, error: '值必须是布尔类型' };
    case 'string': {
      if (typeof value !== 'string') return { valid: false, error: '值必须是字符串' };
      if (value.length > 10_000) return { valid: false, error: '文本不能超过 10000 字符' };
      return { valid: true };
    }
    case 'json':
      return typeof value === 'object' && value !== null
        ? { valid: true }
        : { valid: false, error: '值必须是 JSON 对象' };
    default:
      return { valid: true };
  }
}

const CONFIG_CACHE_TTL_MS = 60_000;
/**
 * 配置版本号（KV 单键）：写入配置时 +1，读取侧最迟每 2s 对一次版本。
 * 60s TTL 只是兜底；没有版本号时，多 isolate 下改配置最多 60s 不生效。
 */
const CONFIG_VERSION_KEY = 'ai_config_version';
const CONFIG_VERSION_CHECK_INTERVAL_MS = 2_000;

interface CacheEntry {
  cache: Map<string, AiConfigItem>;
  timestamp: number;
  version: string;
  versionCheckedAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const envCacheMap = new WeakMap<object, CacheEntry>();

async function readConfigVersion(env: Env): Promise<string> {
  if (!env.KV) return '0';
  try {
    return (await env.KV.get(CONFIG_VERSION_KEY)) ?? '0';
  } catch {
    // KV 不可用（本地单测/极简环境）时退化为无版本语义，只依赖 TTL
    return '0';
  }
}

async function bumpConfigVersion(env: Env): Promise<void> {
  if (!env.KV) return;
  try {
    const current = Number(await env.KV.get(CONFIG_VERSION_KEY)) || 0;
    await env.KV.put(CONFIG_VERSION_KEY, String(current + 1));
  } catch (error) {
    logger.warn(AI_CONFIG_LOG_MODULE, 'Failed to bump config version, falling back to TTL', { error: String(error) });
  }
}

function scheduleCleanup(env: Env): void {
  const cached = envCacheMap.get(env);
  if (!cached) return;

  if (cached.cleanupTimer) {
    clearTimeout(cached.cleanupTimer);
  }

  cached.cleanupTimer = setTimeout(() => {
    envCacheMap.delete(env);
    logger.debug(AI_CONFIG_LOG_MODULE, 'Cache expired and cleaned up');
  }, CONFIG_CACHE_TTL_MS * 2);
}

const DEFAULT_CONFIGS: Array<{
  key: string;
  category: string;
  label: string;
  description: string;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  defaultValue: string;
  isEditable: boolean;
  sortOrder: number;
}> = [
  {
    key: 'ai.default_model.chat',
    category: 'model',
    label: '默认对话模型',
    description: '用于通用对话、问答等场景的默认模型ID',
    valueType: 'string',
    defaultValue: '@cf/meta/llama-3.1-8b-instruct',
    isEditable: true,
    sortOrder: 1,
  },
  {
    key: 'ai.default_model.vision',
    category: 'model',
    label: '默认视觉模型',
    description: '用于图片分析、视觉理解的模型ID（需支持vision能力）',
    valueType: 'string',
    defaultValue: '@cf/meta/llama-4-scout-17b-16e-instruct',
    isEditable: true,
    sortOrder: 2,
  },
  {
    key: 'ai.default_model.embedding',
    category: 'model',
    label: '向量嵌入模型',
    description: '用于文件/记忆向量化的 Workers AI embedding 模型（维度必须与 Vectorize 索引一致）',
    valueType: 'string',
    defaultValue: '@cf/baai/bge-m3',
    isEditable: true,
    sortOrder: 7,
  },
  {
    key: 'ai.model.temperature',
    category: 'parameter',
    label: '温度参数',
    description: '控制模型输出的随机性（0-2之间，越高越随机）',
    valueType: 'number',
    defaultValue: '0.7',
    isEditable: true,
    sortOrder: 11,
  },
  {
    key: 'ai.agent.max_steps',
    category: 'agent',
    label: 'Agent 最大推理步数',
    description: '单轮对话中模型可执行的最大推理/工具步数',
    valueType: 'number',
    defaultValue: '20',
    isEditable: true,
    sortOrder: 18,
  },
  {
    key: 'ai.agent.max_context_tokens',
    category: 'agent',
    label: '最大上下文Token数',
    description: 'Agent对话历史的最大Token预算，超出时裁剪最早的消息',
    valueType: 'number',
    defaultValue: '100000',
    isEditable: true,
    sortOrder: 17,
  },
  {
    key: 'ai.tool.max_image_size_bytes',
    category: 'tool',
    label: '图片最大大小(字节)',
    description: '允许AI分析的图片最大字节数（超过则跳过分析）',
    valueType: 'number',
    defaultValue: '5242880',
    isEditable: true,
    sortOrder: 21,
  },
  {
    key: 'ai.tool.text_chunk_size',
    category: 'tool',
    label: '文本分段大小',
    description: '读取文件内容时每段的字符数',
    valueType: 'number',
    defaultValue: '1500',
    isEditable: true,
    sortOrder: 22,
  },
  {
    key: 'ai.tool.max_result_bytes',
    category: 'tool',
    label: '工具结果最大字节数',
    description: '单次工具结果注入模型上下文前的截断阈值',
    valueType: 'number',
    defaultValue: '16384',
    isEditable: true,
    sortOrder: 23,
  },
  {
    key: 'ai.rag.rerank_enabled',
    category: 'rag',
    label: '启用检索重排',
    description: '混合检索后是否使用 bge-reranker 对候选结果重排',
    valueType: 'boolean',
    defaultValue: 'false',
    isEditable: true,
    sortOrder: 29,
  },
  {
    key: 'ai.request.max_retries',
    category: 'retry',
    label: '最大重试次数',
    description: '模型请求失败后的重试次数（不含首次请求）',
    valueType: 'number',
    defaultValue: String(AI_REQUEST_DEFAULTS.maxRetries),
    isEditable: false,
    sortOrder: 30,
  },
  {
    key: 'ai.request.timeout_ms',
    category: 'retry',
    label: '请求超时时间(ms)',
    description: '单个非流式模型请求的超时时间（毫秒）',
    valueType: 'number',
    defaultValue: String(AI_REQUEST_DEFAULTS.timeoutMs),
    isEditable: true,
    sortOrder: 32,
  },
  {
    key: 'ai.request.vision_timeout_ms',
    category: 'retry',
    label: '视觉请求超时时间(ms)',
    description: '图片理解请求（含流式输出）的超时时间；截图/大图较慢，默认 120 秒',
    valueType: 'number',
    defaultValue: String(AI_REQUEST_DEFAULTS.visionTimeoutMs),
    isEditable: true,
    sortOrder: 31,
  },
  {
    key: 'ai.quota.daily_tokens',
    category: 'quota',
    label: '每日 Token 配额',
    description: '单用户每日 input+output token 上限（<=0 表示不限制）',
    valueType: 'number',
    defaultValue: '200000',
    isEditable: true,
    sortOrder: 33,
  },
  {
    key: 'ai.quota.daily_requests',
    category: 'quota',
    label: '每日请求配额',
    description: '单用户每日 AI 请求次数上限（<=0 表示不限制）',
    valueType: 'number',
    defaultValue: '200',
    isEditable: true,
    sortOrder: 34,
  },
  {
    key: 'ai.rate.requests_per_minute',
    category: 'quota',
    label: '每分钟请求上限',
    description: '单用户每分钟 AI 请求次数上限（<=0 表示不限制）',
    valueType: 'number',
    defaultValue: '20',
    isEditable: true,
    sortOrder: 35,
  },
  {
    key: 'ai.summary.prompt.default',
    category: 'prompt',
    label: '默认摘要提示词',
    description: '通用文件类型的摘要生成提示词模板',
    valueType: 'string',
    defaultValue: '你是文件助手。请用简洁的中文（不超过3句话）概括文件主要内容。',
    isEditable: true,
    sortOrder: 40,
  },
  {
    key: 'ai.summary.prompt.code',
    category: 'prompt',
    label: '代码摘要提示词',
    description: '代码文件的摘要生成提示词模板',
    valueType: 'string',
    defaultValue: '你是代码分析助手。请概括以下代码的功能、主要类/函数/接口、核心逻辑。（不超过4句话）',
    isEditable: true,
    sortOrder: 41,
  },
  {
    key: 'ai.summary.prompt.markdown',
    category: 'prompt',
    label: 'Markdown摘要提示词',
    description: 'Markdown文档的摘要生成提示词模板',
    valueType: 'string',
    defaultValue: '你是技术文档助手。请概括 Markdown 文档的结构、主要章节和核心内容。（不超过3句话）',
    isEditable: true,
    sortOrder: 42,
  },
  {
    key: 'ai.summary.prompt.data',
    category: 'prompt',
    label: '数据/配置摘要提示词',
    description: 'JSON/YAML/XML等数据配置文件的摘要生成提示词模板',
    valueType: 'string',
    defaultValue: '你是数据分析助手。请概括数据/配置文件的结构、关键字段和主要内容。（不超过3句话）',
    isEditable: true,
    sortOrder: 43,
  },
  {
    key: 'ai.agent.context_history_ratio',
    category: 'agent',
    label: '历史消息预算比例',
    description: '上下文总预算中分配给历史消息的比例（0-1）；剩余预算留给工具结果与回复',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.contextHistoryRatio),
    isEditable: true,
    sortOrder: 19,
  },
  {
    key: 'ai.agent.min_keep_messages',
    category: 'agent',
    label: '最少保留消息数',
    description: '裁剪历史时至少保留的最近消息条数，避免把当前轮上下文裁掉',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.minKeepMessages),
    isEditable: true,
    sortOrder: 24,
  },
  {
    key: 'ai.agent.max_context_files',
    category: 'agent',
    label: '引用文件上限',
    description: '单轮对话最多注入的 @ 引用文件数量',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.maxContextFiles),
    isEditable: true,
    sortOrder: 25,
  },
  {
    key: 'ai.agent.memory_extract_interval',
    category: 'agent',
    label: '记忆提取间隔',
    description: '每 N 轮对话触发一次跨会话记忆提取（0 或负数按 1 处理）',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.memoryExtractInterval),
    isEditable: true,
    sortOrder: 26,
  },
  {
    key: 'ai.agent.max_persisted_messages',
    category: 'agent',
    label: '消息持久化上限',
    description: 'DO 内保留与从审计表回种的最大消息条数',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.maxPersistedMessages),
    isEditable: true,
    sortOrder: 27,
  },
  {
    key: 'ai.agent.stream_stall_timeout_ms',
    category: 'agent',
    label: '流式停滞超时(ms)',
    description: '流式响应无新分片超过该时长视为停滞并中断；同时用于前端停滞判定',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.streamStallTimeoutMs),
    isEditable: true,
    sortOrder: 28,
  },
  {
    key: 'ai.agent.ticket_ttl_ms',
    category: 'agent',
    label: 'WS 票据有效期(ms)',
    description: 'WebSocket 连接票据的签发有效期，前端按此值决定重连时机（单点下发）',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.ticketTtlMs),
    isEditable: true,
    sortOrder: 37,
  },
  {
    key: 'ai.agent.task_state_ratio',
    category: 'agent',
    label: '任务状态预算比例',
    description: 'L1 任务状态（目标/步骤/约束）占上下文预算的比例',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.taskStateRatio),
    isEditable: true,
    sortOrder: 46,
  },
  {
    key: 'ai.agent.context_asset_ratio',
    category: 'agent',
    label: '已解析资产预算比例',
    description: 'L2 已解析资产（上传策略/摘要/片段）占上下文预算的比例',
    valueType: 'number',
    defaultValue: String(AI_AGENT_DEFAULTS.contextAssetRatio),
    isEditable: true,
    sortOrder: 47,
  },
  {
    key: 'ai.rag.rrf_k',
    category: 'rag',
    label: 'RRF 融合常数 k',
    description: '倒数排名融合常数，越大越平滑；默认 60',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.rrfK),
    isEditable: true,
    sortOrder: 60,
  },
  {
    key: 'ai.rag.vector_threshold',
    category: 'rag',
    label: '向量召回阈值',
    description: 'Vectorize 余弦相似度低于该值的候选丢弃',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.vectorThreshold),
    isEditable: true,
    sortOrder: 61,
  },
  {
    key: 'ai.rag.chunk_threshold',
    category: 'rag',
    label: '分块召回阈值',
    description: '分块级向量检索的最低相似度',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.chunkThreshold),
    isEditable: true,
    sortOrder: 62,
  },
  {
    key: 'ai.rag.top_k_multiplier',
    category: 'rag',
    label: '召回倍数',
    description: '向量召回数量 = topK × 该倍数，用于给融合与重排留候选',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.topKMultiplier),
    isEditable: true,
    sortOrder: 63,
  },
  {
    key: 'ai.rag.fts_max_tokens',
    category: 'rag',
    label: 'FTS 关键词上限',
    description: '关键词检索最多拆分的 token 数',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.ftsMaxTokens),
    isEditable: true,
    sortOrder: 64,
  },
  {
    key: 'ai.rag.rerank_model',
    category: 'rag',
    label: '重排模型',
    description: '启用重排时使用的 Workers AI reranker 模型 ID',
    valueType: 'string',
    defaultValue: AI_RAG_DEFAULTS.rerankModel,
    isEditable: true,
    sortOrder: 65,
  },
  {
    key: 'ai.rag.rerank_timeout_ms',
    category: 'rag',
    label: '重排超时(ms)',
    description: '重排请求超时，超时后直接使用融合排序结果',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.rerankTimeoutMs),
    isEditable: true,
    sortOrder: 66,
  },
  {
    key: 'ai.rag.chunk_overlap',
    category: 'rag',
    label: '分块重叠字符',
    description: '相邻分块的重叠字符数，避免切断语义',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.chunkOverlap),
    isEditable: true,
    sortOrder: 67,
  },
  {
    key: 'ai.rag.max_chunks',
    category: 'rag',
    label: '单文件最大分块数',
    description: '索引一个文件时最多生成的分块数量',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.maxChunks),
    isEditable: true,
    sortOrder: 68,
  },
  {
    key: 'ai.rag.max_source_chars',
    category: 'rag',
    label: '正文读取上限(字符)',
    description: '读取文件正文时截断的字符数，超出部分不参与摘要与索引',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.maxSourceChars),
    isEditable: true,
    sortOrder: 69,
  },
  {
    key: 'ai.rag.fts_circuit_ttl_ms',
    category: 'rag',
    label: 'FTS 熔断冷却(ms)',
    description: 'FTS 查询失败后跳过 FTS 直接走 LIKE 的冷却时长，到期半开探测',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.ftsCircuitTtlMs),
    isEditable: true,
    sortOrder: 70,
  },
  {
    key: 'ai.rag.context_top_k',
    category: 'rag',
    label: '上下文检索条数',
    description: 'L3 检索片段层注入的 topK',
    valueType: 'number',
    defaultValue: String(AI_RAG_DEFAULTS.contextTopK),
    isEditable: true,
    sortOrder: 71,
  },
  {
    key: 'ai.task.step_timeout_ms',
    category: 'task',
    label: '步骤超时(ms)',
    description: '单个任务步骤的最长执行时间，超时记失败并按重试策略处理',
    valueType: 'number',
    defaultValue: String(AI_TASK_DEFAULTS.stepTimeoutMs),
    isEditable: true,
    sortOrder: 80,
  },
  {
    key: 'ai.task.max_retries',
    category: 'task',
    label: '步骤最大重试次数',
    description: '步骤失败后的自动重试次数',
    valueType: 'number',
    defaultValue: String(AI_TASK_DEFAULTS.maxRetries),
    isEditable: true,
    sortOrder: 81,
  },
  {
    key: 'ai.task.dead_letter_after',
    category: 'task',
    label: '死信阈值',
    description: '连续失败达到该次数后停止自动重试并通知用户',
    valueType: 'number',
    defaultValue: String(AI_TASK_DEFAULTS.deadLetterAfter),
    isEditable: true,
    sortOrder: 82,
  },
  {
    key: 'ai.task.approval_required_level',
    category: 'task',
    label: '审批级别',
    description: 'write：所有写操作需审批；irreversible：仅删除/撤销等不可逆操作需审批',
    valueType: 'string',
    defaultValue: AI_TASK_DEFAULTS.approvalRequiredLevel,
    isEditable: true,
    sortOrder: 83,
  },
  {
    key: 'ai.tool.conditional_groups',
    category: 'tool',
    label: '条件注入工具组',
    description: 'JSON：{groups:[{key,pattern}],alwaysOnSystemTools:[]}，命中关键词才注入对应工具组',
    valueType: 'json',
    defaultValue: JSON.stringify(AI_TOOL_CONDITIONAL_GROUPS_DEFAULT),
    isEditable: true,
    sortOrder: 84,
  },
  {
    key: 'ai.tool.max_tool_definitions',
    category: 'tool',
    label: '单轮工具定义上限',
    description: '每次请求下发给模型的最大工具数量，避免近百工具压垮小模型',
    valueType: 'number',
    defaultValue: String(AI_TOOL_DEFAULTS.maxToolDefinitions),
    isEditable: true,
    sortOrder: 85,
  },
  {
    key: 'ai.model.anthropic_thinking_budget',
    category: 'model',
    label: 'Anthropic 思考预算',
    description: '启用 thinking 时分配给推理的 token 预算',
    valueType: 'number',
    defaultValue: String(AI_MODEL_DEFAULTS.anthropicThinkingBudget),
    isEditable: true,
    sortOrder: 86,
  },
  {
    key: 'ai.ui.connect_timeout_ms',
    category: 'ui',
    label: '前端连接超时(ms)',
    description: '会话连接超时，前端通过 effective-config 读取',
    valueType: 'number',
    defaultValue: String(AI_UI_DEFAULTS.connectTimeoutMs),
    isEditable: true,
    sortOrder: 90,
  },
  {
    key: 'ai.ui.identity_wait_ms',
    category: 'ui',
    label: '身份等待超时(ms)',
    description: '连接建立后等待身份确认的时长，超时自动换票重连',
    valueType: 'number',
    defaultValue: String(AI_UI_DEFAULTS.identityWaitMs),
    isEditable: true,
    sortOrder: 91,
  },
  {
    key: 'ai.ui.max_query_length',
    category: 'ui',
    label: '输入长度上限',
    description: '单条消息允许的最大字符数，前端与后端共用',
    valueType: 'number',
    defaultValue: String(AI_UI_DEFAULTS.maxQueryLength),
    isEditable: true,
    sortOrder: 92,
  },
  {
    key: 'ai.ui.suggestions',
    category: 'ui',
    label: '推荐问题',
    description: '欢迎页展示的推荐问题（JSON 字符串数组）',
    valueType: 'json',
    defaultValue: JSON.stringify(AI_UI_DEFAULTS.suggestions),
    isEditable: true,
    sortOrder: 93,
  },
  {
    key: 'ai.ui.capability_tags',
    category: 'ui',
    label: '能力标签',
    description: '欢迎页展示的能力标签（JSON 字符串数组）',
    valueType: 'json',
    defaultValue: JSON.stringify(AI_UI_DEFAULTS.capabilityTags),
    isEditable: true,
    sortOrder: 94,
  },
  {
    key: 'ai.quota.estimated_tokens_per_request',
    category: 'quota',
    label: '请求预估 Token',
    description: '无法精确预估输入时的默认预扣 token 数，用于配额原子预扣',
    valueType: 'number',
    defaultValue: '1000',
    isEditable: true,
    sortOrder: 38,
  },
  {
    key: 'ai.feature.auto_process_enabled',
    category: 'feature',
    label: '启用自动处理',
    description: '上传文件后是否自动执行AI处理（摘要、标签等）',
    valueType: 'boolean',
    defaultValue: 'true',
    isEditable: true,
    sortOrder: 50,
  },
  {
    key: 'ai.feature.vector_index_enabled',
    category: 'feature',
    label: '启用向量索引',
    description: '是否为文件建立向量索引用于语义搜索',
    valueType: 'boolean',
    defaultValue: 'true',
    isEditable: true,
    sortOrder: 51,
  },
];

/** 注册表键集合：静态守卫与 effective 白名单校验共用 */
export const AI_CONFIG_KEYS: readonly string[] = DEFAULT_CONFIGS.map((config) => config.key);

export function isRegisteredAiConfigKey(key: string): boolean {
  return DEFAULT_CONFIGS.some((config) => config.key === key);
}

export async function initializeAiConfig(env: Env): Promise<void> {
  const db = getDb(env.DB);
  const existingConfigs = await db.select().from(aiConfig).all();

  const defaultConfigs = DEFAULT_CONFIGS;

  const existingKeys = new Set(existingConfigs.map((c) => c.key));
  const missingConfigs = defaultConfigs.filter((config) => !existingKeys.has(config.key));

  // 注册表是唯一事实来源：不在注册表中的历史残留键直接清理，
  // 避免旧版本配置继续出现在「高级配置」里。
  const definedKeys = new Set(defaultConfigs.map((config) => config.key));
  const obsoleteKeys = existingConfigs.filter((config) => !definedKeys.has(config.key)).map((config) => config.key);

  if (missingConfigs.length === 0 && obsoleteKeys.length === 0) {
    logger.info(AI_CONFIG_LOG_MODULE, `已存在 ${existingConfigs.length} 条配置，无缺失项`);
    return;
  }

  // 多 isolate 可能同时初始化（部署后首批请求、并发管理页），key 唯一约束会让后来的插入冲突，
  // 冲突只代表别的 isolate 已写入，忽略即可，否则整个 /system-config 会 500。
  for (const config of missingConfigs) {
    const now = new Date().toISOString();
    await db
      .insert(aiConfig)
      .values({
        id: crypto.randomUUID(),
        ...config,
        stringValue: config.valueType === 'string' ? config.defaultValue : null,
        numberValue: config.valueType === 'number' ? parseFloat(config.defaultValue) : null,
        booleanValue: config.valueType === 'boolean' ? config.defaultValue === 'true' : false,
        jsonValue: config.valueType === 'json' ? config.defaultValue : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  if (obsoleteKeys.length > 0) {
    for (const key of obsoleteKeys) {
      await db.delete(aiConfig).where(eq(aiConfig.key, key));
    }
    logger.info(AI_CONFIG_LOG_MODULE, `已清理 ${obsoleteKeys.length} 条历史配置`, { keys: obsoleteKeys });
  }

  logger.info(AI_CONFIG_LOG_MODULE, `成功初始化 ${missingConfigs.length} 条默认配置`);
  clearCache(env);
  await bumpConfigVersion(env);
}

async function loadAllConfigs(env: Env): Promise<Map<string, AiConfigItem>> {
  const now = Date.now();
  const cached = envCacheMap.get(env);

  // 版本校验独立于 60s TTL：只有版本没变且 TTL 未过期才复用缓存
  let version = cached?.version ?? '0';
  if (!cached || now - cached.versionCheckedAt >= CONFIG_VERSION_CHECK_INTERVAL_MS) {
    version = await readConfigVersion(env);
    if (cached) {
      cached.versionCheckedAt = now;
      if (cached.version !== version) {
        logger.debug(AI_CONFIG_LOG_MODULE, 'Config version changed, invalidating cache', {
          from: cached.version,
          to: version,
        });
        cached.timestamp = 0;
        cached.version = version;
      }
    }
  }

  if (cached && now - cached.timestamp < CONFIG_CACHE_TTL_MS) {
    return cached.cache;
  }

  if (cached?.cleanupTimer) {
    clearTimeout(cached.cleanupTimer);
  }

  const db = getDb(env.DB);
  let configs = await db.select().from(aiConfig).orderBy(aiConfig.sortOrder).all();

  // 注册表新增 key 后，生产库在下一次 /system-config 之前不会有这些行。
  // 这里做一次惰性补齐：缺项即初始化，避免读取方长期拿默认值并刷「未找到配置项」告警。
  const existingKeys = new Set(configs.map((row) => row.key));
  if (AI_CONFIG_KEYS.some((key) => !existingKeys.has(key))) {
    try {
      await initializeAiConfig(env);
      configs = await db.select().from(aiConfig).orderBy(aiConfig.sortOrder).all();
    } catch (error) {
      logger.warn(AI_CONFIG_LOG_MODULE, 'Lazy config initialization failed, using fallbacks', {
        error: String(error),
      });
    }
  }

  const cache = new Map(configs.map((c) => [c.key, c as AiConfigItem]));

  const entry: CacheEntry = { cache, timestamp: now, version, versionCheckedAt: now };
  envCacheMap.set(env, entry);

  scheduleCleanup(env);

  return cache;
}

function clearCache(env: Env): void {
  const cached = envCacheMap.get(env);
  if (cached?.cleanupTimer) {
    clearTimeout(cached.cleanupTimer);
  }
  envCacheMap.delete(env);
}

export async function getAiConfig(env: Env, key: string): Promise<AiConfigValue> {
  const configs = await loadAllConfigs(env);
  const config = configs.get(key);

  if (!config) {
    logger.warn(AI_CONFIG_LOG_MODULE, `未找到配置项: ${key}`);
    return null;
  }

  switch (config.valueType) {
    case 'string':
      return config.stringValue ?? config.defaultValue;
    case 'number':
      return config.numberValue ?? parseFloat(config.defaultValue);
    case 'boolean':
      return config.booleanValue ?? config.defaultValue === 'true';
    case 'json':
      try {
        return config.jsonValue ? JSON.parse(config.jsonValue) : JSON.parse(config.defaultValue);
      } catch (error) {
        logger.error(AI_CONFIG_LOG_MODULE, `JSON解析失败: ${key}`, { error: String(error) });
        return null;
      }
    default:
      return config.stringValue ?? config.defaultValue;
  }
}

export async function getAiConfigString(env: Env, key: string, fallback?: string): Promise<string> {
  const value = await getAiConfig(env, key);
  return (value as string) || fallback || '';
}

export async function getAiConfigNumber(env: Env, key: string, fallback?: number): Promise<number> {
  const value = await getAiConfig(env, key);
  // 0 是合法配置值（如不限流/禁用重试），不能用 || 吞掉
  return typeof value === 'number' ? value : (fallback ?? 0);
}

export async function getAiConfigBoolean(env: Env, key: string, fallback?: boolean): Promise<boolean> {
  const value = await getAiConfig(env, key);
  return typeof value === 'boolean' ? value : fallback || false;
}

/** JSON 型配置：解析失败或类型不匹配时返回 fallback，调用方不处理异常 */
export async function getAiConfigJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const value = await getAiConfig(env, key);
  return value && typeof value === 'object' ? (value as T) : fallback;
}

export async function getAllAiConfigs(env: Env): Promise<AiConfigItem[]> {
  const configs = await loadAllConfigs(env);
  return Array.from(configs.values()).map((config) => ({
    ...config,
    ui: SYSTEM_CONFIG_UI_META[config.key],
  }));
}

export async function updateAiConfig(env: Env, key: string, value: AiConfigValue): Promise<boolean> {
  const db = getDb(env.DB);

  const existing = await db.select().from(aiConfig).where(eq(aiConfig.key, key)).get();
  if (!existing) {
    logger.error(AI_CONFIG_LOG_MODULE, `更新失败：配置项不存在: ${key}`);
    return false;
  }
  if (!existing.isEditable) {
    logger.error(AI_CONFIG_LOG_MODULE, `更新失败：配置项不可编辑: ${key}`);
    return false;
  }

  let updateData: Record<string, unknown> = {};

  switch (existing.valueType) {
    case 'string':
      updateData = { stringValue: String(value), updatedAt: new Date().toISOString() };
      break;
    case 'number':
      updateData = { numberValue: Number(value), updatedAt: new Date().toISOString() };
      break;
    case 'boolean':
      updateData = { booleanValue: Boolean(value), updatedAt: new Date().toISOString() };
      break;
    case 'json':
      updateData = { jsonValue: JSON.stringify(value), updatedAt: new Date().toISOString() };
      break;
    default:
      updateData = { stringValue: String(value), updatedAt: new Date().toISOString() };
  }

  try {
    await db.update(aiConfig).set(updateData).where(eq(aiConfig.key, key));
    clearCache(env);
    await bumpConfigVersion(env);
    logger.info(AI_CONFIG_LOG_MODULE, `配置已更新: ${key}`);
    return true;
  } catch (error) {
    logger.error(AI_CONFIG_LOG_MODULE, `更新配置失败: ${key}`, { error: String(error) });
    return false;
  }
}

export async function resetAiConfigToDefault(env: Env, key: string): Promise<boolean> {
  const db = getDb(env.DB);
  const existing = await db.select().from(aiConfig).where(eq(aiConfig.key, key)).get();

  if (!existing) return false;

  let resetData: Record<string, unknown> = {};
  switch (existing.valueType) {
    case 'string':
      resetData = { stringValue: existing.defaultValue, updatedAt: new Date().toISOString() };
      break;
    case 'number':
      resetData = { numberValue: parseFloat(existing.defaultValue), updatedAt: new Date().toISOString() };
      break;
    case 'boolean':
      resetData = { booleanValue: existing.defaultValue === 'true', updatedAt: new Date().toISOString() };
      break;
    case 'json':
      resetData = { jsonValue: existing.defaultValue, updatedAt: new Date().toISOString() };
      break;
    default:
      resetData = { stringValue: existing.defaultValue, updatedAt: new Date().toISOString() };
  }

  try {
    await db.update(aiConfig).set(resetData).where(eq(aiConfig.key, key));
    clearCache(env);
    await bumpConfigVersion(env);
    logger.info(AI_CONFIG_LOG_MODULE, `配置已重置为默认值: ${key}`);
    return true;
  } catch (error) {
    logger.error(AI_CONFIG_LOG_MODULE, `重置配置失败: ${key}`, { error: String(error) });
    return false;
  }
}
