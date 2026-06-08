/**
 * notes.ts — 文件笔记路由（薄包装层）
 *
 * 所有业务逻辑委托 noteService，本文件仅处理：
 * - HTTP 层（zod 校验、响应格式化）
 * - 通知发送（依赖 Hono executionCtx）
 */

import { Hono } from 'hono';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { getDb, files, users, fileNotes, noteMentions } from '../db';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import { ERROR_CODES, logger } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createNotification, getUserInfo } from '../lib/notificationUtils';
import {
  createNote as serviceCreateNote,
  updateNote as serviceUpdateNote,
  deleteNote as serviceDeleteNote,
  getFileNotes as serviceGetFileNotes,
  togglePinNote as serviceTogglePinNote,
  getNoteHistory as serviceGetNoteHistory,
} from '../lib/noteService';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createNoteSchema = z.object({
  content: z.string().min(1, '笔记内容不能为空').max(10000, '笔记内容过长'),
  parentId: z.string().optional(),
});

const updateNoteSchema = z.object({
  content: z.string().min(1, '笔记内容不能为空').max(10000, '笔记内容过长'),
});

app.use('/*', authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// 提及相关路由（纯 DB 操作，保留在路由层）
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /:fileId — 笔记列表（委托 service + 用户信息富化）
// ─────────────────────────────────────────────────────────────────────────────

app.get('/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const result = await serviceGetFileNotes(c.env, userId, fileId, limit);
  if (!result.success) throwAppError('FILE_ACCESS_DENIED', result.error);

  const db = getDb(c.env.DB);
  const notesList = await db
    .select({
      id: fileNotes.id,
      content: fileNotes.content,
      contentHtml: fileNotes.contentHtml,
      isPinned: fileNotes.isPinned,
      version: fileNotes.version,
      parentId: fileNotes.parentId,
      createdAt: fileNotes.createdAt,
      updatedAt: fileNotes.updatedAt,
      userId: fileNotes.userId,
    })
    .from(fileNotes)
    .where(and(eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .orderBy(desc(fileNotes.isPinned), desc(fileNotes.createdAt))
    .limit(limit)
    .offset((page - 1) * limit)
    .all();

  const userIds = [...new Set(notesList.map((n) => n.userId))];
  const userMap: Record<string, { id: string; name: string | null; email: string }> = {};
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(sql`${users.id} IN ${userIds}`)
      .all();
    for (const u of userRows) userMap[u.id] = u;
  }

  return c.json({
    success: true,
    data: {
      notes: notesList.map((n) => ({ ...n, user: userMap[n.userId] ?? null })),
      total: result.total,
      page,
      limit,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:fileId — 创建笔记（委托 service + 通知）
// ─────────────────────────────────────────────────────────────────────────────

app.post('/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const body = await c.req.json();
  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: parsed.error.errors[0].message } },
      400
    );
  }

  const { content, parentId } = parsed.data;
  const result = await serviceCreateNote(c.env, userId, { fileId, content, parentId });

  if (!result.success) {
    if (result.error === '无权访问此文件') throwAppError('FILE_ACCESS_DENIED', result.error);
    if (result.error === '文件不存在') throwAppError('FILE_NOT_FOUND');
    return c.json({ success: false, error: result.error }, 400);
  }

  // 发送提及通知
  if (result.mentions && result.mentions.mentionedUserIds.length > 0) {
    const db = getDb(c.env.DB);
    const fileRow = await db.select().from(files).where(eq(files.id, fileId)).get();

    c.executionCtx.waitUntil(
      (async () => {
        try {
          const authorInfo = await getUserInfo(c.env, userId);
          for (const mentionedUid of result.mentions!.mentionedUserIds) {
            if (mentionedUid !== userId) {
              await createNotification(c.env, {
                userId: mentionedUid,
                type: 'mention',
                title: '您在笔记中被提及',
                body: `${authorInfo?.name || authorInfo?.email || '用户'} 在文件「${fileRow?.name}」的笔记中@了您`,
                data: {
                  fileId,
                  fileName: fileRow?.name,
                  noteId: result.noteId,
                  mentionerId: userId,
                  mentionerName: authorInfo?.name || authorInfo?.email,
                },
              });
            }
          }
        } catch (error) {
          logger.error('NOTES', '发送提及通知失败', {}, error);
        }
      })()
    );
  }

  // 发送回复通知
  if (parentId) {
    const db = getDb(c.env.DB);
    const parentNote = await db
      .select({ id: fileNotes.id, userId: fileNotes.userId })
      .from(fileNotes)
      .where(eq(fileNotes.id, parentId))
      .get();

    if (parentNote && parentNote.userId !== userId) {
      const fileRow = await db.select().from(files).where(eq(files.id, fileId)).get();

      c.executionCtx.waitUntil(
        (async () => {
          try {
            const authorInfo = await getUserInfo(c.env, userId);
            await createNotification(c.env, {
              userId: parentNote.userId,
              type: 'reply',
              title: '您的笔记收到了回复',
              body: `${authorInfo?.name || authorInfo?.email || '用户'} 回复了您在文件「${fileRow?.name}」中的笔记`,
              data: {
                fileId,
                fileName: fileRow?.name,
                noteId: result.noteId,
                parentId,
                replierId: userId,
                replierName: authorInfo?.name || authorInfo?.email,
              },
            });
          } catch (error) {
            logger.error('NOTES', '发送回复通知失败', {}, error);
          }
        })()
      );
    }
  }

  return c.json({ success: true, data: result.note });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:fileId/:noteId — 更新笔记（委托 service）
// ─────────────────────────────────────────────────────────────────────────────

app.put('/:fileId/:noteId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const noteId = c.req.param('noteId');
  const body = await c.req.json();
  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: parsed.error.errors[0].message } },
      400
    );
  }

  const result = await serviceUpdateNote(c.env, userId, fileId, noteId, { content: parsed.data.content });
  if (!result.success) {
    if (result.error === '笔记不存在' || result.error === '无权编辑此笔记') {
      throwAppError(result.error === '无权编辑此笔记' ? 'NOTE_EDIT_DENIED' : 'NOTE_NOT_FOUND', result.error);
    }
    return c.json({ success: false, error: result.error }, 400);
  }

  return c.json({
    success: true,
    data: { id: noteId, content: parsed.data.content, version: (result as any).newVersion || 0 },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:fileId/:noteId — 删除笔记（委托 service）
// ─────────────────────────────────────────────────────────────────────────────

app.delete('/:fileId/:noteId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const noteId = c.req.param('noteId');

  const result = await serviceDeleteNote(c.env, userId, fileId, noteId);
  if (!result.success) {
    throwAppError(result.error === '无权删除此笔记' ? 'NOTE_DELETE_DENIED' : 'NOTE_NOT_FOUND', result.error);
  }

  return c.json({ success: true, data: { message: result.message, deletedCount: result.deletedCount } });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:fileId/:noteId/pin — 置顶切换（委托 service）
// ─────────────────────────────────────────────────────────────────────────────

app.post('/:fileId/:noteId/pin', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const noteId = c.req.param('noteId');

  const result = await serviceTogglePinNote(c.env, userId, fileId, noteId);
  if (!result.success) {
    throwAppError(result.error === '无权置顶此笔记' ? 'NOTE_PIN_DENIED' : 'NOTE_NOT_FOUND', result.error);
  }

  return c.json({ success: true, data: { isPinned: result.isPinned, message: result.message } });
});

// ─────────────────────────────────────────────────────────────────────────────
export default app;
