/**
 * agentMessages.test.ts
 * 消息 metadata → UI Message 的映射契约：
 * - quoted 引用文件（含旧版 `["id"]` 形态）不能丢
 * - 模型名 / 用量 / 耗时从 metadata 映射出来，全零用量视为无用量
 */

import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { mapUIMessages } from './agentMessages';

function textMessage(
  id: string,
  role: 'user' | 'assistant',
  metadata: Record<string, unknown>
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text: 'hello' }],
    metadata,
  } as unknown as UIMessage;
}

describe('mapUIMessages metadata 映射', () => {
  it('用户消息的引用文件从 metadata.mentionedFiles 还原', () => {
    const messages = mapUIMessages([
      textMessage('m1', 'user', {
        createdAt: '2026-11-26T00:00:00.000Z',
        mentionedFiles: [{ id: 'f1', name: '报告.pdf' }],
      }),
    ]);

    expect(messages[0]?.mentionedFiles).toEqual([{ id: 'f1', name: '报告.pdf' }]);
  });

  it('兼容旧版 mentionedFiles 的 id 数组', () => {
    const messages = mapUIMessages([textMessage('m1', 'user', { mentionedFiles: ['f1', 'f2'] })]);

    expect(messages[0]?.mentionedFiles).toEqual([
      { id: 'f1', name: '' },
      { id: 'f2', name: '' },
    ]);
  });

  it('助手消息带出模型名与用量', () => {
    const messages = mapUIMessages([
      textMessage('m1', 'assistant', {
        createdAt: '2026-11-26T00:00:00.000Z',
        modelId: 'model-1',
        modelName: 'GPT-X',
        provider: 'openai',
        latencyMs: 1200,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedTokens: 4 },
      }),
    ]);

    expect(messages[0]).toMatchObject({
      modelId: 'model-1',
      modelName: 'GPT-X',
      provider: 'openai',
      latencyMs: 1200,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedTokens: 4 },
    });
  });

  it('全零用量不下发，避免气泡底部显示 0 tokens', () => {
    const messages = mapUIMessages([
      textMessage('m1', 'assistant', { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
    ]);

    expect(messages[0]?.usage).toBeUndefined();
  });

  it('引用文件只挂在用户消息上', () => {
    const messages = mapUIMessages([
      textMessage('m1', 'assistant', { mentionedFiles: [{ id: 'f1', name: 'a.txt' }] }),
    ]);

    expect(messages[0]?.mentionedFiles).toBeUndefined();
  });
});
