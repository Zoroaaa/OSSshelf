/**
 * aiChatRoutes.ts
 * AI 会话管理路由（增强版）
 *
 * 功能:
 * - 会话 CRUD
 * - 消息记录
 * - 流式聊天（SSE）
 * - RAG 集成
 */

import { Hono } from 'hono';
import { eq, and, desc, sql, count, inArray, isNull } from 'drizzle-orm';
import { getDb, aiChatSessions, aiChatMessages, aiConfirmRequests, aiMemories, files } from '../db';
import { authMiddleware } from '../middleware';
import { ERROR_CODES, logger } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { ModelGateway, RagEngine } from '../lib/ai';
import { AgentEngine, type AgentChunk } from '../lib/ai/agentEngine';
import { AgentMemory } from '../lib/ai/agentMemory';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

app.get('/sessions', async (c) => {
  const userId = c.get('userId')!;

  try {
    const db = getDb(c.env.DB);

    const sessions = await db
      .select()
      .from(aiChatSessions)
      .where(eq(aiChatSessions.userId, userId))
      .orderBy(desc(aiChatSessions.updatedAt))
      .limit(50)
      .all();

    // Single batch query for all message counts
    const msgCounts = await db
      .select({ sessionId: aiChatMessages.sessionId, cnt: count(aiChatMessages.id) })
      .from(aiChatMessages)
      .where(
        sql`${aiChatMessages.sessionId} IN (${sql.join(
          sessions.map((s) => sql`${s.id}`),
          sql`, `
        )})`
      )
      .groupBy(aiChatMessages.sessionId)
      .all();

    const countMap = new Map(msgCounts.map((r) => [r.sessionId, r.cnt]));

    const sessionWithCounts = sessions.map((session) => ({
      ...session,
      messageCount: countMap.get(session.id) ?? 0,
    }));

    return c.json({
      success: true,
      data: sessionWithCounts,
    });
  } catch (error) {
    logger.error('AI Chat', 'Failed to get sessions', { userId }, error);
    return c.json({
      success: false,
      error: { code: ERROR_CODES.INTERNAL_ERROR, message: '获取会话列表失败' },
      data: [],
    });
  }
});

app.post('/sessions', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const { title = '新对话', modelId } = body as { title?: string; modelId?: string };

  try {
    const db = getDb(c.env.DB);

    const newSession = {
      id: crypto.randomUUID(),
      userId,
      title,
      modelId: modelId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.insert(aiChatSessions).values(newSession);

    return c.json({ success: true, data: newSession });
  } catch (error) {
    logger.error('AI Chat', 'Failed to create session', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '创建会话失败' } }, 500);
  }
});

app.get('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);

  const session = await db
    .select()
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!session) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
  }

  const messages = await db
    .select()
    .from(aiChatMessages)
    .where(eq(aiChatMessages.sessionId, sessionId))
    .orderBy(aiChatMessages.createdAt)
    .all();

  const confirmRequests = await db
    .select()
    .from(aiConfirmRequests)
    .where(eq(aiConfirmRequests.sessionId, sessionId))
    .all();

  const confirmStatusMap = new Map(
    confirmRequests.map((cr) => [cr.id, cr.status as 'pending' | 'consumed' | 'cancelled' | 'expired'])
  );

  const mentionedFileIds = messages
    .filter((m) => m.role === 'user' && m.mentionedFiles)
    .flatMap((m) => {
      try {
        return JSON.parse(m.mentionedFiles!) as string[];
      } catch {
        return [];
      }
    });

  const mentionedFileMap = new Map<string, string>();
  if (mentionedFileIds.length > 0) {
    const uniqueIds = [...new Set(mentionedFileIds)];
    const fileRecords = await db
      .select({ id: files.id, name: files.name })
      .from(files)
      .where(and(inArray(files.id, uniqueIds), eq(files.userId, userId), isNull(files.deletedAt)))
      .all();
    fileRecords.forEach((f) => mentionedFileMap.set(f.id, f.name));
  }

  return c.json({
    success: true,
    data: {
      ...session,
      messages: messages.map((m) => {
        let toolCalls = m.toolCalls ? JSON.parse(m.toolCalls) : undefined;
        if (toolCalls && Array.isArray(toolCalls)) {
          toolCalls = toolCalls.map((tc: any) => {
            if (tc.result && typeof tc.result === 'object' && (tc.result as any).status === 'pending_confirm') {
              const confirmId = (tc.result as any).confirmId;
              if (confirmId && confirmStatusMap.has(confirmId)) {
                const dbStatus = confirmStatusMap.get(confirmId);
                const confirmStatus =
                  dbStatus === 'consumed' ? 'confirmed' : dbStatus === 'cancelled' ? 'cancelled' : 'pending';
                return { ...tc, confirmStatus };
              }
            }
            return tc;
          });
        }

        let parsedMentionedFiles: Array<{ id: string; name: string }> | undefined;
        if (m.role === 'user' && m.mentionedFiles) {
          try {
            const ids = JSON.parse(m.mentionedFiles) as string[];
            parsedMentionedFiles = ids
              .map((id) => {
                const name = mentionedFileMap.get(id);
                return name ? { id, name } : null;
              })
              .filter(Boolean) as Array<{ id: string; name: string }>;
            if (parsedMentionedFiles.length === 0) parsedMentionedFiles = undefined;
          } catch {
            parsedMentionedFiles = undefined;
          }
        }

        return {
          ...m,
          sources: m.sources ? JSON.parse(m.sources) : undefined,
          toolCalls,
          reasoning: m.reasoning || undefined,
          aborted: m.aborted || false,
          mentionedFiles: parsedMentionedFiles,
        };
      }),
    },
  });
});

app.put('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();
  const { title } = body as { title?: string };

  if (!title) {
    return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '标题不能为空' } }, 400);
  }

  const db = getDb(c.env.DB);

  const existingSession = await db
    .select()
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!existingSession) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
  }

  try {
    await db
      .update(aiChatSessions)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { id: sessionId, title } });
  } catch (error) {
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '更新会话失败' } }, 500);
  }
});

app.delete('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  const db = getDb(c.env.DB);

  const existingSession = await db
    .select()
    .from(aiChatSessions)
    .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
    .get();

  if (!existingSession) {
    return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '会话不存在' } }, 404);
  }

  try {
    await db.delete(aiChatMessages).where(eq(aiChatMessages.sessionId, sessionId));
    await db.delete(aiConfirmRequests).where(eq(aiConfirmRequests.sessionId, sessionId));
    await db.delete(aiMemories).where(eq(aiMemories.sessionId, sessionId));
    await db.delete(aiChatSessions).where(eq(aiChatSessions.id, sessionId));

    return c.json({ success: true, data: { message: '会话已删除' } });
  } catch (error) {
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '删除会话失败' } }, 500);
  }
});

const chatSchema = z.object({
  query: z.string().min(1).max(15000),
  sessionId: z.string().optional(),
  modelId: z.string().optional(),
  maxFiles: z.number().int().min(1).max(10).default(5),
  includeFileContent: z.boolean().default(false),
  stream: z.boolean().default(false),
  contextFolderId: z.string().optional(),
  contextFileIds: z.array(z.string()).optional(),
});

app.post('/chat', async (c) => {
  const userId = c.get('userId')!;

  const body = await c.req.json();
  const result = chatSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { query, sessionId, modelId, maxFiles, includeFileContent, stream, contextFolderId, contextFileIds } =
    result.data;

  if (stream) {
    return handleStreamChat(c, userId, query, sessionId, modelId, contextFolderId, contextFileIds);
  }

  return handleNormalChat(c, userId, query, sessionId, modelId, maxFiles, includeFileContent);
});

async function handleNormalChat(
  c: any,
  userId: string,
  query: string,
  sessionId?: string,
  modelId?: string,
  maxFiles?: number,
  includeFileContent?: boolean
) {
  const startTime = Date.now();
  let actualSessionId = sessionId;

  try {
    const db = getDb(c.env.DB);

    if (!actualSessionId) {
      const newSession = {
        id: crypto.randomUUID(),
        userId,
        title: query.slice(0, 50),
        modelId: modelId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.insert(aiChatSessions).values(newSession);
      actualSessionId = newSession.id;

      c.executionCtx.waitUntil(
        (async () => {
          try {
            const gateway = new ModelGateway(c.env);
            const titleResponse = await gateway.chatCompletion(userId, {
              messages: [
                { role: 'system', content: '用 8-12 个中文字概括用户对话的主题。只输出标题，不加标点和解释。' },
                { role: 'user', content: query },
              ],
              temperature: 0.5,
            });
            const generatedTitle = titleResponse.content.trim().slice(0, 20);
            if (generatedTitle && generatedTitle !== query.slice(0, 20)) {
              await db
                .update(aiChatSessions)
                .set({ title: generatedTitle })
                .where(eq(aiChatSessions.id, actualSessionId));
            }
          } catch {}
        })()
      );
    } else {
      await db
        .update(aiChatSessions)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(aiChatSessions.id, actualSessionId));
    }

    await db.insert(aiChatMessages).values({
      id: crypto.randomUUID(),
      sessionId: actualSessionId,
      role: 'user',
      content: query,
      createdAt: new Date().toISOString(),
    });

    const existingMessages = await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.sessionId, actualSessionId))
      .orderBy(aiChatMessages.createdAt)
      .limit(50)
      .all();

    const conversationHistory = existingMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const ragEngine = new RagEngine(c.env);
    const ragContext = await ragEngine.buildContext({
      query,
      userId,
      maxFiles,
      includeFileContent,
      conversationHistory,
    });

    const gateway = new ModelGateway(c.env);
    const response = await gateway.chatCompletion(
      userId,
      {
        messages: ragContext.messages,
      },
      modelId
    );

    const latencyMs = Date.now() - startTime;
    const sourcesJson = JSON.stringify(
      ragContext.relevantFiles.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        score: f.similarityScore,
      }))
    );

    await db.insert(aiChatMessages).values({
      id: crypto.randomUUID(),
      sessionId: actualSessionId,
      role: 'assistant',
      content: response.content + ragEngine.formatSourcesForResponse(ragContext.relevantFiles),
      sources: sourcesJson,
      modelUsed: response.model,
      latencyMs,
      createdAt: new Date().toISOString(),
    });

    return c.json({
      success: true,
      data: {
        answer: response.content,
        sources: ragContext.relevantFiles.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          score: f.similarityScore,
        })),
        sessionId: actualSessionId,
        latencyMs,
      },
    });
  } catch (error) {
    logger.error('AI Chat', 'Chat failed', { userId, query: query.slice(0, 50) }, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'AI对话失败，请重试',
        },
      },
      500
    );
  }
}

async function handleStreamChat(
  c: any,
  userId: string,
  query: string,
  sessionId?: string,
  modelId?: string,
  contextFolderId?: string,
  contextFileIds?: string[]
) {
  const startTime = Date.now();
  let actualSessionId = sessionId;

  try {
    const db = getDb(c.env.DB);

    // Ensure session exists
    if (!actualSessionId) {
      const newSession = {
        id: crypto.randomUUID(),
        userId,
        title: query.slice(0, 50),
        modelId: modelId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.insert(aiChatSessions).values(newSession);
      actualSessionId = newSession.id;

      // 异步生成 LLM 标题（与 handleNormalChat 保持一致）
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const gateway = new ModelGateway(c.env);
            const titleResponse = await gateway.chatCompletion(userId, {
              messages: [
                { role: 'system', content: '用 8-12 个中文字概括用户对话的主题。只输出标题，不加标点和解释。' },
                { role: 'user', content: query },
              ],
              temperature: 0.5,
            });
            const generatedTitle = titleResponse.content.trim().slice(0, 20);
            if (generatedTitle && generatedTitle !== query.slice(0, 20)) {
              await db
                .update(aiChatSessions)
                .set({ title: generatedTitle })
                .where(eq(aiChatSessions.id, actualSessionId));
            }
          } catch {}
        })()
      );
    } else {
      await db
        .update(aiChatSessions)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(aiChatSessions.id, actualSessionId));
    }

    // Save user message
    await db.insert(aiChatMessages).values({
      id: crypto.randomUUID(),
      sessionId: actualSessionId,
      role: 'user',
      content: query,
      mentionedFiles: contextFileIds && contextFileIds.length > 0 ? JSON.stringify(contextFileIds) : undefined,
      createdAt: new Date().toISOString(),
    });

    // Load conversation history for context
    const existingMessages = await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.sessionId, actualSessionId))
      .orderBy(aiChatMessages.createdAt)
      .all();

    const conversationHistory = existingMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const agentEngine = new AgentEngine(c.env);

    // ── 占位消息：流开始前写入 DB，确保任何中断都有记录可更新 ──────────────
    const assistantMsgId = crypto.randomUUID();
    await db.insert(aiChatMessages).values({
      id: assistantMsgId,
      sessionId: actualSessionId!,
      role: 'assistant',
      content: '',
      aborted: false,
      createdAt: new Date().toISOString(),
    });

    let fullText = '';
    let finalSources: Array<{ id: string; name: string; mimeType: string | null; score: number }> = [];
    const collectedToolCalls: Array<{
      id: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
      status: 'running' | 'done' | 'error';
    }> = [];
    let collectedReasoning = '';
    let resolveStream!: () => void;
    let doneEmitted = false;
    let agentResult: Awaited<ReturnType<typeof agentEngine.run>> | undefined;
    const streamDone = new Promise<void>((r) => {
      resolveStream = r;
    });

    // ── 统一的消息更新函数，替代双路径 INSERT ────────────────────────────────
    const saveAssistantMessage = async (opts: {
      isAborted: boolean;
      inputTokens?: number;
      outputTokens?: number;
      latencyMs: number;
    }) => {
      await db
        .update(aiChatMessages)
        .set({
          content: fullText || (collectedToolCalls.length > 0 ? '(执行了工具操作)' : '(响应中断)'),
          sources: JSON.stringify(finalSources),
          toolCalls: collectedToolCalls.length > 0 ? JSON.stringify(collectedToolCalls) : null,
          reasoning: collectedReasoning || null,
          modelUsed: agentResult?.meta?.modelId || modelId || null,
          latencyMs: opts.latencyMs,
          inputTokens: opts.inputTokens ?? 0,
          outputTokens: opts.outputTokens ?? 0,
          aborted: opts.isAborted,
        })
        .where(eq(aiChatMessages.id, assistantMsgId));
    };

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (data: object) => {
          try {
            const serialized = JSON.stringify(data);
            controller.enqueue(`data: ${serialized}\n\n`);
          } catch (err) {
            logger.error('AI Chat', 'Failed to serialize SSE data', { data: JSON.stringify(data).slice(0, 200) }, err);
          }
        };

        const emitDone = (data: object) => {
          if (doneEmitted) return;
          doneEmitted = true;
          enqueue(data);
          setTimeout(() => {
            try {
              controller.close();
            } catch {}
            resolveStream();
          }, 50);
        };

        try {
          agentResult = await agentEngine.run(
            userId,
            query,
            conversationHistory,
            modelId,
            (chunk: AgentChunk) => {
              if (chunk.done) {
                if (chunk.type === 'done') {
                  finalSources = chunk.sources;
                  emitDone({ done: true, sessionId: actualSessionId, sources: chunk.sources });
                } else if (chunk.type === 'confirm_request') {
                  emitDone({
                    done: true,
                    confirmRequest: true,
                    confirmId: chunk.confirmId,
                    toolName: chunk.toolName,
                    args: chunk.args,
                    summary: chunk.summary,
                    sessionId: actualSessionId,
                    sources: [],
                  });
                } else {
                  emitDone({ done: true, error: (chunk as any).message, sessionId: actualSessionId, sources: [] });
                }
              } else {
                if (chunk.type === 'text') {
                  fullText += chunk.content;
                  enqueue({ content: chunk.content, done: false });
                } else if (chunk.type === 'reasoning') {
                  collectedReasoning += chunk.content;
                  enqueue({ reasoning: true, content: chunk.content, done: false });
                } else if (chunk.type === 'tool_start') {
                  collectedToolCalls.push({
                    id: chunk.toolCallId,
                    toolName: chunk.toolName,
                    args: chunk.args || {},
                    status: 'running',
                  });
                  enqueue({
                    toolStart: true,
                    toolName: chunk.toolName,
                    toolCallId: chunk.toolCallId,
                    args: chunk.args,
                    done: false,
                  });
                } else if (chunk.type === 'tool_result') {
                  const tc = collectedToolCalls.find((t) => t.id === chunk.toolCallId);
                  if (tc) {
                    tc.result = chunk.result;
                    tc.status = 'done';
                  }
                  enqueue({
                    toolResult: true,
                    toolCallId: chunk.toolCallId,
                    toolName: chunk.toolName,
                    result: chunk.result,
                    done: false,
                  });
                }
              }
            },
            c.req.raw.signal,
            actualSessionId,
            contextFolderId,
            contextFileIds
          );

          // Guard: agent finished without emitting done
          if (!doneEmitted && agentResult) {
            finalSources = agentResult.sources;
            emitDone({ done: true, sessionId: actualSessionId, sources: agentResult.sources });
          }
        } catch (error) {
          logger.error('AI Agent', 'Stream failed', { userId }, error);
          const isAborted = error instanceof Error && error.name === 'AbortError';
          const errorMessage = error instanceof Error ? error.message : 'AI 响应出错';
          enqueue({
            done: true,
            error: isAborted ? '响应已中断' : errorMessage,
            sessionId: actualSessionId,
            sources: finalSources,
          });
          try {
            controller.close();
          } catch {}
          // ── abort/error 路径：立即更新占位消息，保存已输出的部分内容 ──────
          try {
            await saveAssistantMessage({ isAborted, latencyMs: Date.now() - startTime });
            logger.info('AI Agent', 'Partial message saved after abort/error', {
              sessionId: actualSessionId,
              isAborted,
              contentLen: fullText.length,
            });
          } catch (saveError) {
            logger.error('AI Agent', 'Failed to save partial message', { userId }, saveError);
          }
          resolveStream();
        }
      },
    });

    // ── 正常完成路径：更新占位消息（含完整 tokens/latency 信息）────────────
    c.executionCtx.waitUntil(
      (async () => {
        await streamDone;
        // abort 路径已在 catch 块中同步保存，此处跳过避免覆盖
        if (!doneEmitted) return;
        try {
          const latencyMs = Date.now() - startTime;
          await saveAssistantMessage({
            isAborted: false,
            inputTokens: agentResult?.meta?.inputTokens ?? 0,
            outputTokens: agentResult?.meta?.outputTokens ?? 0,
            latencyMs,
          });
          logger.info('AI Agent', 'Message saved', {
            sessionId: actualSessionId,
            latencyMs,
            toolCallCount: agentResult?.meta?.toolCallCount ?? collectedToolCalls.length,
            inputTokens: agentResult?.meta?.inputTokens ?? 0,
            outputTokens: agentResult?.meta?.outputTokens ?? 0,
            modelId: agentResult?.meta?.modelId || modelId,
          });

          if (actualSessionId && agentResult?.meta) {
            await db
              .update(aiChatSessions)
              .set({
                modelId: agentResult.meta.modelId || modelId || null,
                lastToolCallCount: sql`last_tool_call_count + ${agentResult.meta.toolCallCount}`,
                totalTokensUsed: sql`total_tokens_used + ${agentResult.meta.inputTokens + agentResult.meta.outputTokens}`,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(aiChatSessions.id, actualSessionId));
          }

          const toolCallsStr = collectedToolCalls.map((tc) => `${tc.toolName}: ${JSON.stringify(tc.args)}`).join('\n');
          const memory = new AgentMemory(new ModelGateway(c.env), c.env);
          await memory.extractAndSaveMemories(userId, actualSessionId!, fullText, toolCallsStr);
        } catch (error) {
          logger.error('AI Agent', 'Failed to save message', { userId }, error);
        }
      })()
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    logger.error('AI Chat', 'Failed to start agent stream', { userId }, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : '启动对话失败',
        },
      },
      500
    );
  }
}

app.get('/memories', async (c) => {
  const userId = c.get('userId')!;
  const type = c.req.query('type');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const memory = new AgentMemory(new ModelGateway(c.env), c.env);
    const result = await memory.listMemories(userId, { type, limit, offset });
    return c.json({ success: true, data: result });
  } catch (error) {
    logger.error('AI Chat', 'List memories failed', { userId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '获取记忆列表失败' } }, 500);
  }
});

app.delete('/memories/:id', async (c) => {
  const userId = c.get('userId')!;
  const memoryId = c.req.param('id');

  try {
    const memory = new AgentMemory(new ModelGateway(c.env), c.env);
    const success = await memory.deleteMemory(memoryId, userId);
    if (!success) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '记忆不存在' } }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error('AI Chat', 'Delete memory failed', { userId, memoryId }, error);
    return c.json({ success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: '删除记忆失败' } }, 500);
  }
});

app.post('/confirm', async (c) => {
  const userId = c.get('userId')!;

  try {
    const body = await c.req.json();
    const { confirmId } = body as { confirmId: string };

    if (!confirmId) {
      return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少 confirmId' } }, 400);
    }

    const agentEngine = new AgentEngine(c.env);
    const result = await agentEngine.executeConfirmAction(confirmId, userId);

    return c.json({
      success: true,
      data: {
        result,
        confirmedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('AI Chat', 'Confirm action failed', { userId }, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : '确认执行失败',
        },
      },
      500
    );
  }
});

app.post('/cancel', async (c) => {
  const userId = c.get('userId')!;

  try {
    const body = await c.req.json();
    const { confirmId } = body as { confirmId: string };

    if (!confirmId) {
      return c.json({ success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: '缺少 confirmId' } }, 400);
    }

    const db = getDb(c.env.DB);
    const now = new Date().toISOString();

    const result = await db
      .update(aiConfirmRequests)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(aiConfirmRequests.id, confirmId),
          eq(aiConfirmRequests.userId, userId),
          eq(aiConfirmRequests.status, 'pending')
        )
      )
      .returning();

    if (!result || result.length === 0) {
      return c.json({ success: false, error: { code: ERROR_CODES.NOT_FOUND, message: '确认请求不存在或已处理' } }, 404);
    }

    return c.json({
      success: true,
      data: {
        cancelledAt: now,
      },
    });
  } catch (error) {
    logger.error('AI Chat', 'Cancel action failed', { userId }, error);
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : '取消操作失败',
        },
      },
      500
    );
  }
});

export default app;
