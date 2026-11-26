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
import { estimateTokens } from './utils';

export interface ContextBudget {
  maxContextTokens: number;
  historyRatio: number;
  minKeepMessages: number;
  taskStateRatio: number;
  assetRatio: number;
  maxContextFiles: number;
}

export interface ContextAllocation {
  historyTokens: number;
  taskStateTokens: number;
  assetTokens: number;
}

export async function loadContextBudget(env: Env): Promise<ContextBudget> {
  const [maxContextTokens, historyRatio, minKeepMessages, taskStateRatio, assetRatio, maxContextFiles] =
    await Promise.all([
      getAiConfigNumber(env, 'ai.agent.max_context_tokens', AI_AGENT_DEFAULTS.maxContextTokens),
      getAiConfigNumber(env, 'ai.agent.context_history_ratio', AI_AGENT_DEFAULTS.contextHistoryRatio),
      getAiConfigNumber(env, 'ai.agent.min_keep_messages', AI_AGENT_DEFAULTS.minKeepMessages),
      getAiConfigNumber(env, 'ai.agent.task_state_ratio', AI_AGENT_DEFAULTS.taskStateRatio),
      getAiConfigNumber(env, 'ai.agent.context_asset_ratio', AI_AGENT_DEFAULTS.contextAssetRatio),
      getAiConfigNumber(env, 'ai.agent.max_context_files', AI_AGENT_DEFAULTS.maxContextFiles),
    ]);

  return {
    maxContextTokens: Math.max(1_000, maxContextTokens),
    historyRatio: clamp(historyRatio, 0.1, 1),
    minKeepMessages: Math.max(0, Math.floor(minKeepMessages)),
    taskStateRatio: clamp(taskStateRatio, 0, 0.5),
    assetRatio: clamp(assetRatio, 0, 0.5),
    maxContextFiles: Math.max(1, Math.floor(maxContextFiles)),
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
export function limitSection(text: string, budgetTokens: number): string {
  if (!text) return '';
  if (estimateTokens(text) <= budgetTokens) return text;
  // 中文约 0.67 token/字符，按最坏情况保守截断
  const maxChars = Math.max(200, Math.floor(budgetTokens * 1.5));
  return `${text.slice(0, maxChars)}\n…（内容超预算已截断）`;
}

export function estimateMessageTokens(message: UIMessage): number {
  try {
    return estimateTokens(JSON.stringify(message.parts ?? []));
  } catch {
    return 0;
  }
}

/** 历史裁剪：从最旧开始丢弃，直到落在预算内；保持消息边界，不破坏 tool call/result 配对 */
export function trimMessagesByBudget(
  messages: UIMessage[],
  budgetTokens: number,
  minKeepMessages: number
): UIMessage[] {
  const keep = Math.max(0, minKeepMessages);
  if (messages.length <= keep) return messages;

  let total = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  let start = 0;
  while (start < messages.length - keep && total > budgetTokens) {
    const oldest = messages[start];
    if (!oldest) break;
    total -= estimateMessageTokens(oldest);
    start++;
  }
  return start === 0 ? messages : messages.slice(start);
}
