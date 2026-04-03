/**
 * ragEngine.ts
 * RAG (检索增强生成) 引擎
 *
 * 功能:
 * - 智能上下文组装
 * - Prompt模板管理
 * - 文件内容检索与优化
 * - 来源引用管理
 */

import type { Env } from '../../types/env';
import { searchAndFetchFiles, buildFileTextForVector } from '../vectorIndex';
import { getDb, files } from '../../db';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { logger } from '@osshelf/shared';

export interface FileContext {
  id: string;
  name: string;
  mimeType: string | null;
  similarityScore: number;
  summary?: string;
  description?: string;
  content?: string;
}

export interface RagContext {
  query: string;
  relevantFiles: FileContext[];
  assembledPrompt: string;
  totalTokens: number;
  timestamp: string;
}

export interface ChatRagRequest {
  query: string;
  userId: string;
  maxFiles?: number;
  maxContextLength?: number;
  includeFileContent?: boolean;
  conversationHistory?: Array<{ role: string; content: string }>;
}

const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_CONTEXT_LENGTH = 8000;
const ESTIMATED_TOKENS_PER_CHAR = 0.5;

const SYSTEM_PROMPTS = {
  default: `你是OSSshelf文件管理系统的智能助手。你的职责是帮助用户查询、分析和管理他们的文件。

核心能力：
1. 文件搜索和定位：根据用户描述找到相关文件
2. 内容摘要和分析：总结文件主要内容，提取关键信息
3. 智能问答：基于文件内容回答用户问题

回答规则：
- 基于提供的文件信息回答问题，不要编造信息
- 如果文件信息不足以回答问题，请如实说明
- 在回答末尾用"来源：[序号]"注明引用了哪些文件
- 回答要简洁准确，使用中文（除非用户使用其他语言）
- 对于技术文档，可以适当使用代码块展示关键内容`,

  file_expert: `你是文件分析专家。你擅长：
- 分析文档结构和内容
- 提取关键信息和数据
- 对比多个文件的异同
- 生成详细的文件报告

请根据提供的文件信息，给出专业、详细的分析。`,

  code_assistant: `你是编程助手。你擅长：
- 理释代码逻辑和功能
- 识别潜在问题和优化点
- 解释API接口和数据结构
- 提供代码改进建议

请基于代码文件给出专业的技术分析和建议。`,
};

export class RagEngine {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async buildContext(request: ChatRagRequest): Promise<RagContext> {
    const startTime = Date.now();

    try {
      const relevantFiles = await this.searchRelevantFiles(
        request.query,
        request.userId,
        request.maxFiles || DEFAULT_MAX_FILES
      );

      if (relevantFiles.length === 0) {
        return {
          query: request.query,
          relevantFiles: [],
          assembledPrompt: this.buildEmptyResponsePrompt(request.query),
          totalTokens: 0,
          timestamp: new Date().toISOString(),
        };
      }

      const contextText = await this.assembleFileContext(
        relevantFiles,
        request.includeFileContent ?? false,
        request.maxContextLength || DEFAULT_MAX_CONTEXT_LENGTH
      );

      const conversationContext = this.formatConversationHistory(request.conversationHistory || []);

      const assembledPrompt = this.assembleFinalPrompt({
        systemPrompt: SYSTEM_PROMPTS.default,
        userQuery: request.query,
        contextText,
        conversationContext,
      });

      const totalTokens = Math.ceil(assembledPrompt.length * ESTIMATED_TOKENS_PER_CHAR);

      logger.info('RAG', 'Context built', {
        query: request.query.slice(0, 50),
        fileCount: relevantFiles.length,
        contextLength: contextText.length,
        totalTimeMs: Date.now() - startTime,
      });

      return {
        query: request.query,
        relevantFiles,
        assembledPrompt,
        totalTokens,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('RAG', 'Failed to build context', { query: request.query }, error);
      throw error;
    }
  }

  async searchRelevantFiles(
    query: string,
    userId: string,
    limit: number = DEFAULT_MAX_FILES
  ): Promise<FileContext[]> {
    try {
      const searchResults = await searchAndFetchFiles(this.env, query, userId, {
        limit,
        threshold: 0.3,
      });

      return searchResults.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        similarityScore: file.similarityScore,
        summary: file.aiSummary || undefined,
        description: file.description || undefined,
      }));
    } catch (error) {
      logger.error('RAG', 'File search failed', { query, userId }, error);
      return [];
    }
  }

  private async assembleFileContext(
    files: FileContext[],
    includeContent: boolean,
    maxLength: number
  ): Promise<string> {
    const parts: string[] = [];
    let currentLength = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileParts: string[] = [`[${i + 1}] 文件名：${file.name}`];

      if (file.mimeType) {
        fileParts.push(`类型：${file.mimeType}`);
      }

      fileParts.push(`相关度：${(file.similarityScore * 100).toFixed(1)}%`);

      if (file.summary) {
        fileParts.push(`摘要：${file.summary}`);
      }

      if (file.description) {
        fileParts.push(`描述：${file.description}`);
      }

      if (includeContent) {
        try {
          const content = await buildFileTextForVector(this.env, file.id);
          if (content && content.length > 0) {
            const truncatedContent = content.slice(0, 1000);
            fileParts.push(`内容预览：\n${truncatedContent}`);
          }
        } catch {
          continue;
        }
      }

      const fileText = fileParts.join('\n');

      if (currentLength + fileText.length > maxLength) {
        break;
      }

      parts.push(fileText);
      currentLength += fileText.length;
    }

    return parts.join('\n\n');
  }

  private formatConversationHistory(history: Array<{ role: string; content: string }>): string {
    if (history.length === 0) {
      return '';
    }

    const recentHistory = history.slice(-6);
    const formatted = recentHistory
      .map((msg) => {
        const role = msg.role === 'user' ? '用户' : '助手';
        return `${role}：${msg.content}`;
      })
      .join('\n');

    return `\n\n=== 历史对话 ===\n${formatted}\n=== 历史对话结束 ===\n`;
  }

  private assembleFinalPrompt(params: {
    systemPrompt: string;
    userQuery: string;
    contextText: string;
    conversationContext: string;
  }): string {
    const { systemPrompt, userQuery, contextText, conversationContext } = params;

    return `${systemPrompt}
${conversationContext}
== 相关文件信息 ==
${contextText}
== 文件信息结束 ==

请根据以上文件信息回答用户的问题。

用户问题：${userQuery}`;
  }

  private buildEmptyResponsePrompt(query: string): string {
    return `${SYSTEM_PROMPTS.default}

用户问题：${query}

注意：当前未找到与此问题相关的文件。如果这是一个关于文件管理的通用问题，你可以根据你的知识回答；如果是特定文件内容的询问，请告知用户需要先上传或索引相关文件。`;
  }

  formatSourcesForResponse(files: FileContext[]): string {
    if (files.length === 0) {
      return '';
    }

    return (
      '\n\n---\n**参考来源：**\n' +
      files
        .map(
          (f, i) =>
            `${i + 1}. **${f.name}** (相关度: ${(f.similarityScore * 100).toFixed(0)}%)`
        )
        .join('\n')
    );
  }

  getSystemPrompt(type: keyof typeof SYSTEM_PROMPTS = 'default'): string {
    return SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.default;
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}
