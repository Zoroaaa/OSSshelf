/**
 * agentMemory.ts — Agent 跨会话记忆管理
 *
 * 修复:
 * - listMemories 的 total 改为真实 COUNT(*)
 * - 写入记忆时生成 embedding 并落 Vectorize（此前 embeddingId 永远为空）
 * - 召回改为 Vectorize filter（此前传了不存在的 namespace 参数，异常被吞）
 * - 向量不可用时回退到最近记忆
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, aiMemories } from '../../db';
import { logger } from '@osshelf/shared';
import { ModelGateway } from './modelGateway';
import type { Env } from '../../types/env';
import { resolveEmbeddingProvider } from './modelResolver';

export interface MemoryFact {
  type: 'operation' | 'preference' | 'path' | 'file_ref';
  summary: string;
  sessionId: string;
  createdAt: string;
}

const MEMORY_RECALL_TOP_K = 3;
const MEMORY_VECTOR_PREFIX = 'mem_';

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
        const embeddingId = await this.storeMemoryVector(userId, memoryId, fact.summary);

        await db.insert(aiMemories).values({
          id: memoryId,
          userId,
          sessionId,
          type: fact.type as MemoryFact['type'],
          summary: fact.summary,
          embeddingId,
          createdAt: new Date().toISOString(),
        });
      }

      logger.info('AgentMemory', `Extracted ${validFacts.length} memories`, { sessionId });
    } catch (error) {
      logger.error('AgentMemory', 'extractAndSaveMemories failed', { sessionId }, error);
    }
  }

  async recallMemories(userId: string, query: string): Promise<string> {
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

      const matched = await this.recallByVector(userId, query, recentMemories);
      if (matched.length > 0) {
        relevantMemories = matched.slice(0, MEMORY_RECALL_TOP_K);
      }

      const memoryLines = relevantMemories.map((m) => `- ${m.summary}`).join('\n');
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
    const where = options?.type
      ? and(eq(aiMemories.userId, userId), eq(aiMemories.type, options.type))
      : eq(aiMemories.userId, userId);

    const items = await db
      .select()
      .from(aiMemories)
      .where(where)
      .orderBy(desc(aiMemories.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    const countRow = await db
      .select({ total: sql<number>`count(*)` })
      .from(aiMemories)
      .where(where)
      .get();

    return { items, total: countRow?.total ?? 0 };
  }

  async deleteMemory(memoryId: string, userId: string): Promise<boolean> {
    try {
      const db = getDb(this.env.DB);
      await db.delete(aiMemories).where(and(eq(aiMemories.id, memoryId), eq(aiMemories.userId, userId)));

      if (this.env.VECTORIZE) {
        try {
          await this.env.VECTORIZE.deleteByIds([`${MEMORY_VECTOR_PREFIX}${memoryId}`]);
        } catch {
          // 向量不存在时忽略
        }
      }

      return true;
    } catch (error) {
      logger.error('AgentMemory', 'deleteMemory failed', { memoryId }, error);
      return false;
    }
  }

  /** 批量删除：只删除属于该用户的记忆，并同步清理 Vectorize 向量 */
  async deleteMemories(ids: string[], userId: string): Promise<number> {
    if (ids.length === 0) return 0;

    try {
      const db = getDb(this.env.DB);
      // D1 单条 SQL 绑定参数上限为 100，按批查询与删除
      const DB_CHUNK = 100;
      const ownedIds: string[] = [];
      for (let i = 0; i < ids.length; i += DB_CHUNK) {
        const rows = await db
          .select({ id: aiMemories.id })
          .from(aiMemories)
          .where(and(eq(aiMemories.userId, userId), inArray(aiMemories.id, ids.slice(i, i + DB_CHUNK))))
          .all();
        ownedIds.push(...rows.map((row) => row.id));
      }
      if (ownedIds.length === 0) return 0;

      for (let i = 0; i < ownedIds.length; i += DB_CHUNK) {
        await db
          .delete(aiMemories)
          .where(and(eq(aiMemories.userId, userId), inArray(aiMemories.id, ownedIds.slice(i, i + DB_CHUNK))));
      }

      if (this.env.VECTORIZE) {
        const vectorIds = ownedIds.map((id) => `${MEMORY_VECTOR_PREFIX}${id}`);
        const BATCH = 1000;
        for (let i = 0; i < vectorIds.length; i += BATCH) {
          try {
            await this.env.VECTORIZE.deleteByIds(vectorIds.slice(i, i + BATCH));
          } catch (error) {
            logger.warn('AgentMemory', 'deleteMemories vector cleanup failed', { count: BATCH }, error);
          }
        }
      }

      return ownedIds.length;
    } catch (error) {
      logger.error('AgentMemory', 'deleteMemories failed', { count: ids.length }, error);
      return 0;
    }
  }

  /** 清空该用户的全部记忆 */
  async deleteAllMemories(userId: string): Promise<number> {
    try {
      const db = getDb(this.env.DB);
      const rows = await db.select({ id: aiMemories.id }).from(aiMemories).where(eq(aiMemories.userId, userId)).all();
      return this.deleteMemories(
        rows.map((row) => row.id),
        userId
      );
    } catch (error) {
      logger.error('AgentMemory', 'deleteAllMemories failed', { userId }, error);
      return 0;
    }
  }

  private async storeMemoryVector(userId: string, memoryId: string, summary: string): Promise<string | null> {
    if (!this.env.VECTORIZE || !this.env.AI) return null;

    try {
      const provider = await resolveEmbeddingProvider(this.env);
      const [values] = await provider.embed([summary]);
      if (!values) return null;

      const embeddingId = `${MEMORY_VECTOR_PREFIX}${memoryId}`;
      await this.env.VECTORIZE.upsert([
        {
          id: embeddingId,
          values,
          metadata: { userId, kind: 'memory', embeddingModel: provider.modelKey },
        },
      ]);

      return embeddingId;
    } catch (error) {
      logger.warn('AgentMemory', 'storeMemoryVector failed', { memoryId }, error);
      return null;
    }
  }

  private async recallByVector(
    userId: string,
    query: string,
    recentMemories: Array<typeof aiMemories.$inferSelect>
  ): Promise<Array<typeof aiMemories.$inferSelect>> {
    if (!this.env.VECTORIZE || !this.env.AI) return [];

    try {
      const provider = await resolveEmbeddingProvider(this.env);
      const [values] = await provider.embed([query]);
      if (!values) return [];

      const results = await this.env.VECTORIZE.query(values, {
        topK: MEMORY_RECALL_TOP_K * 2,
        filter: { userId, kind: 'memory' },
        returnMetadata: false,
      });

      const ids = results.matches
        .map((match) => match.id.replace(new RegExp(`^${MEMORY_VECTOR_PREFIX}`), ''))
        .filter(Boolean);
      if (ids.length === 0) return [];

      const rows = await getDb(this.env.DB)
        .select()
        .from(aiMemories)
        .where(and(eq(aiMemories.userId, userId), inArray(aiMemories.id, ids)))
        .all();

      return ids.map((id) => rows.find((row) => row.id === id)).filter(Boolean) as Array<
        typeof aiMemories.$inferSelect
      >;
    } catch (error) {
      logger.warn('AgentMemory', 'Vector recall failed, using recent fallback', {}, error);
      return recentMemories.slice(0, MEMORY_RECALL_TOP_K);
    }
  }
}
