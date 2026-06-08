/**
 * agentMemory.ts — Agent 跨会话记忆管理
 *
 * 功能:
 * - 对话结束时自动提取结构化记忆（操作/偏好/路径/文件引用）
 * - 对话开始时召回相关历史记忆注入上下文
 * - 记忆的增删查管理接口
 *
 * 架构设计:
 * - 双存储：D1（结构化查询）+ Vectorize（语义检索）
 * - 命名空间隔离：memory:{userId} 区别于 file:{userId}
 * - 召回策略：时间优先 + 向量语义匹配兜底
 *
 * 使用场景:
 * - 用户说"上次你帮我整理的那个文件夹" → Agent 能找回上下文
 * - 用户偏好、常用路径、重要文件被记住，减少重复提问
 */

import { getDb, aiMemories } from '../../db';
import { eq, and, desc } from 'drizzle-orm';
import { logger } from '@osshelf/shared';
import { ModelGateway } from './modelGateway';
import type { Env } from '../../types/env';

export interface MemoryFact {
  type: 'operation' | 'preference' | 'path' | 'file_ref';
  summary: string;
  sessionId: string;
  createdAt: string;
}

const MEMORY_NAMESPACE_PREFIX = 'memory:';
const MEMORY_RECALL_TOP_K = 3;
const EMBEDDING_MODEL = '@cf/baai/bge-m3';

const MEMORY_EXTRACTION_PROMPT = `你是一个对话记忆提取专家。从以下 AI 对话中提取 3-5 条有价值的结构化记忆事实。

## 输出格式
严格输出 JSON 数组，不要输出其他内容：
[
  {
    "type": "operation|preference|path|file_ref",
    "summary": "一句话概括（如：用户将设计文件夹归档到 /Archive/2024/Design）"
  }
]

## 类型说明
- operation: 用户执行的操作（移动文件、创建文件、重命名等）
- preference: 用户偏好（习惯用某个工具、喜欢某种命名方式）
- path: 用户常用的路径或文件夹
- file_ref: 用户提到的重要文件

## 规则
1. 只提取有价值的信息，跳过闲聊和简单问答
2. summary 要具体、可操作，避免模糊描述
3. 每条记忆要独立、不重复
4. 如果没有值得记录的内容，返回空数组 []`;

export class AgentMemory {
  private gateway: ModelGateway;
  private env: Env;

  constructor(gateway: ModelGateway, env: Env) {
    this.gateway = gateway;
    this.env = env;
  }

  getMemoryNamespace(userId: string): string {
    return `${MEMORY_NAMESPACE_PREFIX}${userId}`;
  }

  async extractAndSaveMemories(
    userId: string,
    sessionId: string,
    fullText: string,
    toolCallsStr: string
  ): Promise<void> {
    try {
      const conversationContext = `用户消息与助手回复：\n${fullText.slice(-4000)}\n\n工具调用记录：\n${toolCallsStr.slice(-2000)}`;

      const response = await this.gateway.chatCompletion(userId, {
        messages: [
          { role: 'system', content: MEMORY_EXTRACTION_PROMPT },
          { role: 'user', content: `请从以下对话中提取记忆：\n\n${conversationContext}` },
        ],
        temperature: 0.1,
      });

      const jsonMatch = response.content.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) return;

      const facts = JSON.parse(jsonMatch[0]) as Array<{ type: string; summary: string }>;
      if (!Array.isArray(facts) || facts.length === 0) return;

      const validTypes = ['operation', 'preference', 'path', 'file_ref'];
      const validFacts = facts.filter(
        (f) => validTypes.includes(f.type) && typeof f.summary === 'string' && f.summary.length > 5
      );

      if (validFacts.length === 0) return;

      const db = getDb(this.env.DB);
      for (const fact of validFacts.slice(0, 5)) {
        const memoryId = crypto.randomUUID();
        await db.insert(aiMemories).values({
          id: memoryId,
          userId,
          sessionId,
          type: fact.type as MemoryFact['type'],
          summary: fact.summary,
          createdAt: new Date().toISOString(),
        });
      }

      logger.info('AgentMemory', `Extracted ${validFacts.length} memories`, { sessionId });
    } catch (error) {
      logger.error('AgentMemory', 'extractAndSaveMemories failed', { sessionId }, error);
    }
  }

  async recallMemories(
    userId: string,
    query: string,
    _vectorizeQuery?: (
      namespace: string,
      values: number[],
      metadata?: Record<string, string | number | boolean>
    ) => Promise<string | null>
  ): Promise<string> {
    try {
      const db = getDb(this.env.DB);
      const recentMemories = await db
        .select()
        .from(aiMemories)
        .where(eq(aiMemories.userId, userId))
        .orderBy(desc(aiMemories.createdAt))
        .limit(20);

      if (recentMemories.length === 0) return '';

      let relevantMemories = recentMemories.slice(0, MEMORY_RECALL_TOP_K);

      if (_vectorizeQuery && recentMemories.length > 0) {
        try {
          const queryEmbedding = await this.generateEmbedding(query);
          if (queryEmbedding) {
            const namespace = this.getMemoryNamespace(userId);
            const vectorId = await _vectorizeQuery(namespace, queryEmbedding, {});
            if (vectorId) {
              const matched = recentMemories.filter((m: typeof aiMemories.$inferSelect) => m.embeddingId === vectorId);
              if (matched.length > 0) {
                relevantMemories = matched.slice(0, MEMORY_RECALL_TOP_K);
              }
            }
          }
        } catch (embeddingError) {
          logger.warn('AgentMemory', 'Embedding recall failed, using time-based fallback', {}, embeddingError);
        }
      }

      if (relevantMemories.length === 0) return '';

      const memoryLines = relevantMemories.map((m: typeof aiMemories.$inferSelect) => `- ${m.summary}`).join('\n');
      return `\n\n[历史记忆]\n${memoryLines}`;
    } catch (error) {
      logger.error('AgentMemory', 'recallMemories failed', { userId }, error);
      return '';
    }
  }

  async listMemories(
    userId: string,
    options?: { type?: string; limit?: number; offset?: number }
  ): Promise<{ items: (typeof aiMemories.$inferSelect)[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const db = getDb(this.env.DB);
    let baseQuery = db.select().from(aiMemories).where(eq(aiMemories.userId, userId)) as any;
    if (options?.type) {
      baseQuery = baseQuery.where(and(eq(aiMemories.userId, userId), eq(aiMemories.type, options.type))) as any;
    }

    const items = await baseQuery.orderBy(desc(aiMemories.createdAt)).limit(limit).offset(offset);

    const countResult = await db.select({ count: aiMemories.id }).from(aiMemories).where(eq(aiMemories.userId, userId));
    const total = countResult.length;

    return { items, total };
  }

  async deleteMemory(memoryId: string, userId: string): Promise<boolean> {
    try {
      const db = getDb(this.env.DB);
      await db.delete(aiMemories).where(and(eq(aiMemories.id, memoryId), eq(aiMemories.userId, userId)));
      return true;
    } catch (error) {
      logger.error('AgentMemory', 'deleteMemory failed', { memoryId }, error);
      return false;
    }
  }

  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const result = await (this.env.AI as any).run(EMBEDDING_MODEL, { text });
      const data = result?.data;
      if (!data || data.length === 0) return null;
      return data[0] as number[];
    } catch (error) {
      logger.warn('AgentMemory', 'generateEmbedding failed', {}, error);
      return null;
    }
  }
}
