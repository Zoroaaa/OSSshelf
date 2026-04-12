/**
 * constants.ts
 * AI模块常量定义
 *
 * 功能:
 * - 统一的日志模块名
 * - AI相关常量配置
 */

export const AI_LOG_MODULE = 'AI';

export const AI_CONFIG_LOG_MODULE = 'AiConfig';

export const AI_CONSTANTS = {
  MAX_TOOL_CALLS: 20,
  MAX_IDLE_ROUNDS: 3,
  DEFAULT_TEMPERATURE: 0.3,
  IMAGE_TIMEOUT_MS: 25000,
  CONFIRM_TTL_MS: 5 * 60 * 1000,
  MAX_CONTEXT_TOKENS: 100000,
  MAX_IMAGE_SIZE_BYTES: 5242880,
  TEXT_CHUNK_SIZE: 1500,
} as const;

export const VECTOR_LOG_MODULE = 'VECTOR';

export const RAG_LOG_MODULE = 'RAG';

export const AGENT_LOG_MODULE = 'Agent';
