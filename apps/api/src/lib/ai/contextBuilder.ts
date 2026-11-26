/**
 * contextBuilder.ts
 * 上下文分层与预算分配（单一预算源）
 *
 * 原则：
 * - 总量只有一个开关：ai.agent.max_context_tokens
 * - 各层比例/上限全部来自配置，代码里不出现 0.7 / 2 / 5 这类魔法值
 * - 预算只用于裁剪，不改变消息顺序；最近 N 条消息始终保留
 */

import type { UIMessage } from 'ai';
import type { Env } from '../../types/env';
import { AI_AGENT_DEFAULTS, getAiConfigNumber } from './aiConfigService';
import { TOKEN_ESTIMATE_DEFAULTS, estimateTokens, type TokenEstimateOptions } from './utils';

export interface ContextBudget {
  maxContextTokens: number;
  historyRatio: number;
  minKeepMessages: number;
  taskStateRatio: number;
  assetRatio: number;
  maxContextFiles: number;
  /** 与预算一起下发的估算系数，避免调用方各自读配置导致同一轮出现两种口径 */
  tokenEstimate: Required<TokenEstimateOptions>;
}

export interface ContextAllocation {
  historyTokens: number;
  taskStateTokens: number;
  assetTokens: number;
}

export async function loadContextBudget(env: Env): Promise<ContextBudget> {
  const [
    maxContextTokens,
    historyRatio,
    minKeepMessages,
    taskStateRatio,
    assetRatio,
    maxContextFiles,
    charsPerToken,
    cjkTokensPerChar,
  ] = await Promise.all([
    getAiConfigNumber(env, 'ai.agent.max_context_tokens', AI_AGENT_DEFAULTS.maxContextTokens),
    getAiConfigNumber(env, 'ai.agent.context_history_ratio', AI_AGENT_DEFAULTS.contextHistoryRatio),
    getAiConfigNumber(env, 'ai.agent.min_keep_messages', AI_AGENT_DEFAULTS.minKeepMessages),
    getAiConfigNumber(env, 'ai.agent.task_state_ratio', AI_AGENT_DEFAULTS.taskStateRatio),
    getAiConfigNumber(env, 'ai.agent.context_asset_ratio', AI_AGENT_DEFAULTS.contextAssetRatio),
    getAiConfigNumber(env, 'ai.agent.max_context_files', AI_AGENT_DEFAULTS.maxContextFiles),
    getAiConfigNumber(env, 'ai.agent.token_chars_per_token', AI_AGENT_DEFAULTS.tokenCharsPerToken),
    getAiConfigNumber(env, 'ai.agent.cjk_tokens_per_char', AI_AGENT_DEFAULTS.cjkTokensPerChar),
  ]);

  return {
    maxContextTokens: Math.max(1_000, maxContextTokens),
    historyRatio: clamp(historyRatio, 0.1, 1),
    minKeepMessages: Math.max(0, Math.floor(minKeepMessages)),
    taskStateRatio: clamp(taskStateRatio, 0, 0.5),
    assetRatio: clamp(assetRatio, 0, 0.5),
    maxContextFiles: Math.max(1, Math.floor(maxContextFiles)),
    tokenEstimate: {
      charsPerToken: clamp(charsPerToken, 1, 8),
      cjkTokensPerChar: clamp(cjkTokensPerChar, 0.3, 2),
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function allocateContext(budget: ContextBudget): ContextAllocation {
  return {
    historyTokens: Math.floor(budget.maxContextTokens * budget.historyRatio),
    taskStateTokens: Math.floor(budget.maxContextTokens * budget.taskStateRatio),
    assetTokens: Math.floor(budget.maxContextTokens * budget.assetRatio),
  };
}

/** 按 token 预算裁剪一组 section 文本；超预算从尾部截断（低优先级内容在后） */
export function limitSection(
  text: string,
  budgetTokens: number,
  tokenEstimate: TokenEstimateOptions = TOKEN_ESTIMATE_DEFAULTS
): string {
  if (!text) return '';
  if (estimateTokens(text, tokenEstimate) <= budgetTokens) return text;
  // 按最保守的系数反推字符上限：宁可截短，也不要超窗口
  const cjkTokensPerChar = tokenEstimate.cjkTokensPerChar ?? TOKEN_ESTIMATE_DEFAULTS.cjkTokensPerChar;
  const maxChars = Math.max(200, Math.floor(budgetTokens / Math.max(0.3, cjkTokensPerChar)));
  return `${text.slice(0, maxChars)}\n…（内容超预算已截断）`;
}

export function estimateMessageTokens(
  message: UIMessage,
  tokenEstimate: TokenEstimateOptions = TOKEN_ESTIMATE_DEFAULTS
): number {
  try {
    return estimateTokens(JSON.stringify(message.parts ?? []), tokenEstimate);
  } catch {
    return 0;
  }
}

/** 历史裁剪：从最旧开始丢弃，直到落在预算内；保持消息边界，不破坏 tool call/result 配对 */
export function trimMessagesByBudget(
  messages: UIMessage[],
  budgetTokens: number,
  minKeepMessages: number,
  tokenEstimate: TokenEstimateOptions = TOKEN_ESTIMATE_DEFAULTS
): UIMessage[] {
  const keep = Math.max(0, minKeepMessages);
  if (messages.length <= keep) return messages;

  let total = messages.reduce((sum, message) => sum + estimateMessageTokens(message, tokenEstimate), 0);
  let start = 0;
  while (start < messages.length - keep && total > budgetTokens) {
    const oldest = messages[start];
    if (!oldest) break;
    total -= estimateMessageTokens(oldest, tokenEstimate);
    start++;
  }
  return start === 0 ? messages : messages.slice(start);
}
