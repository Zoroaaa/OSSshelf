/**
 * notes.ts
 * 文件笔记路由
 *
 * 功能:
 * - 文件笔记 CRUD
 * - 笔记历史版本
 * - @提及 功能
 * - 置顶管理
 */

import { Hono } from 'hono';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { getDb, files, users, fileNotes, fileNoteHistory, noteMentions } from '../db';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';
import { createNotification, getUserInfo } from '../lib/notificationUtils';
import { checkFilePermission } from './permissions';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const createNoteSchema = z.object({
  content: z.string().min(1, '笔记内容不能为空').max(10000, '笔记内容过长'),
  parentId: z.string().optional(),
});

const updateNoteSchema = z.object({
  content: z.string().min(1, '笔记内容不能为空').max(10000, '笔记内容过长'),
});

app.use('/*', authMiddleware);

// 注意：mentions 路由必须在 /:fileId 路由之前，否则会被错误匹配
app.get('/mentions/unread', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);

  const unreadMentions = await db
    .select({
      id: noteMentions.id,
      noteId: noteMentions.noteId,
      createdAt: noteMentions.createdAt,
    })
    .from(noteMentions)
    .where(and(eq(noteMentions.userId, userId), eq(noteMentions.isRead, false)))
    .orderBy(desc(noteMentions.createdAt))
    .limit(50)
    .all();

  return c.json({
    success: true,
    data: unreadMentions,
  });
});

app.put('/mentions/:mentionId/read', async (c) => {
  const userId = c.get('userId')!;
  const mentionId = c.req.param('mentionId');
  const db = getDb(c.env.DB);

  const mention = await db
    .select()
    .from(noteMentions)
    .where(and(eq(noteMentions.id, mentionId), eq(noteMentions.userId, userId)))
    .get();

  if (!mention) throwAppError('MENTION_NOT_FOUND', '提及不存在');

  await db.update(noteMentions).set({ isRead: true }).where(eq(noteMentions.id, mentionId));

  return c.json({ success: true, data: { message: '已标记为已读' } });
});

app.get('/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = (page - 1) * limit;

  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');

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
    .offset(offset)
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

  const notesWithUsers = notesList.map((n) => ({
    ...n,
    user: userMap[n.userId] ?? null,
  }));

  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(fileNotes)
    .where(and(eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .get();

  return c.json({
    success: true,
    data: {
      notes: notesWithUsers,
      total: totalResult?.count ?? 0,
      page,
      limit,
    },
  });
});

app.post('/:fileId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const body = await c.req.json();
  const result = createNoteSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { content, parentId } = result.data;
  const db = getDb(c.env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', c.env);
  if (!hasAccess) {
    throwAppError('FILE_ACCESS_DENIED', '无权访问此文件');
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) throwAppError('FILE_NOT_FOUND');

  const noteId = crypto.randomUUID();
  const now = new Date().toISOString();
  const contentHtml = renderMarkdown(content);

  await db.insert(fileNotes).values({
    id: noteId,
    fileId,
    userId,
    content,
    contentHtml,
    isPinned: false,
    version: 1,
    parentId: parentId || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  await db
    .update(files)
    .set({
      noteCount: sql`${files.noteCount} + 1`,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  const mentions = extractMentions(content);
  if (mentions.length > 0) {
    const mentionedUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(sql`${users.email} IN ${mentions}`)
      .all();

    for (const u of mentionedUsers) {
      await db.insert(noteMentions).values({
        id: crypto.randomUUID(),
        noteId,
        userId: u.id,
        isRead: false,
        createdAt: now,
      });
    }

    c.executionCtx.waitUntil(
      (async () => {
        try {
          const authorInfo = await getUserInfo(c.env, userId);
          for (const u of mentionedUsers) {
            if (u.id !== userId) {
              await createNotification(c.env, {
                userId: u.id,
                type: 'mention',
                title: '您在笔记中被提及',
                body: `${authorInfo?.name || authorInfo?.email || '用户'} 在文件「${file.name}」的笔记中@了您`,
                data: {
                  fileId,
                  fileName: file.name,
                  noteId,
                  mentionerId: userId,
                  mentionerName: authorInfo?.name || authorInfo?.email,
                },
              });
            }
          }
        } catch (e) {
          console.error('Failed to send mention notification:', e);
        }
      })()
    );
  }

  if (parentId) {
    const parentNote = await db
      .select({ id: fileNotes.id, userId: fileNotes.userId })
      .from(fileNotes)
      .where(eq(fileNotes.id, parentId))
      .get();

    if (parentNote && parentNote.userId !== userId) {
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const authorInfo = await getUserInfo(c.env, userId);
            await createNotification(c.env, {
              userId: parentNote.userId,
              type: 'reply',
              title: '您的笔记收到了回复',
              body: `${authorInfo?.name || authorInfo?.email || '用户'} 回复了您在文件「${file.name}」中的笔记`,
              data: {
                fileId,
                fileName: file.name,
                noteId,
                parentId,
                replierId: userId,
                replierName: authorInfo?.name || authorInfo?.email,
              },
            });
          } catch (e) {
            console.error('Failed to send reply notification:', e);
          }
        })()
      );
    }
  }

  return c.json({
    success: true,
    data: {
      id: noteId,
      content,
      contentHtml,
      isPinned: false,
      version: 1,
      createdAt: now,
    },
  });
});

app.put('/:fileId/:noteId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const noteId = c.req.param('noteId');
  const body = await c.req.json();
  const result = updateNoteSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }

  const { content } = result.data;
  const db = getDb(c.env.DB);

  const note = await db
    .select()
    .from(fileNotes)
    .where(and(eq(fileNotes.id, noteId), eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .get();

  if (!note) throwAppError('NOTE_NOT_FOUND', '笔记不存在');

  if (note.userId !== userId) {
    throwAppError('NOTE_EDIT_DENIED', '无权编辑此笔记');
  }

  const now = new Date().toISOString();
  const contentHtml = renderMarkdown(content);

  await db.insert(fileNoteHistory).values({
    id: crypto.randomUUID(),
    noteId,
    content: note.content,
    version: note.version,
    editedBy: userId,
    createdAt: now,
  });

  await db
    .update(fileNotes)
    .set({
      content,
      contentHtml,
      version: note.version + 1,
      updatedAt: now,
    })
    .where(eq(fileNotes.id, noteId));

  await db.delete(noteMentions).where(eq(noteMentions.noteId, noteId));

  const mentions = extractMentions(content);
  if (mentions.length > 0) {
    const mentionedUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.email} IN ${mentions}`)
      .all();

    for (const u of mentionedUsers) {
      await db.insert(noteMentions).values({
        id: crypto.randomUUID(),
        noteId,
        userId: u.id,
        isRead: false,
        createdAt: now,
      });
    }
  }

  return c.json({
    success: true,
    data: {
      id: noteId,
      content,
      contentHtml,
      version: note.version + 1,
      updatedAt: now,
    },
  });
});

app.delete('/:fileId/:noteId', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const noteId = c.req.param('noteId');
  const db = getDb(c.env.DB);

  const note = await db
    .select()
    .from(fileNotes)
    .where(and(eq(fileNotes.id, noteId), eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .get();

  if (!note) throwAppError('NOTE_NOT_FOUND', '笔记不存在');

  if (note.userId !== userId) {
    throwAppError('NOTE_DELETE_DENIED', '无权删除此笔记');
  }

  const now = new Date().toISOString();

  const childCountBeforeDelete = await db
    .select({ count: sql<number>`count(*)` })
    .from(fileNotes)
    .where(and(eq(fileNotes.parentId, noteId), isNull(fileNotes.deletedAt)))
    .get();

  await db
    .update(fileNotes)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(fileNotes.parentId, noteId), isNull(fileNotes.deletedAt)));

  await db.update(fileNotes).set({ deletedAt: now, updatedAt: now }).where(eq(fileNotes.id, noteId));

  const deletedCount = 1 + (childCountBeforeDelete?.count ?? 0);

  await db
    .update(files)
    .set({
      noteCount: sql`CASE WHEN ${files.noteCount} > ${deletedCount} THEN ${files.noteCount} - ${deletedCount} ELSE 0 END`,
      updatedAt: now,
    })
    .where(eq(files.id, fileId));

  return c.json({ success: true, data: { message: '笔记已删除', deletedCount } });
});

app.post('/:fileId/:noteId/pin', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const noteId = c.req.param('noteId');
  const db = getDb(c.env.DB);

  const note = await db
    .select()
    .from(fileNotes)
    .where(and(eq(fileNotes.id, noteId), eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .get();

  if (!note) throwAppError('NOTE_NOT_FOUND', '笔记不存在');

  if (note.userId !== userId) {
    throwAppError('NOTE_PIN_DENIED', '无权置顶此笔记');
  }

  const now = new Date().toISOString();
  const newPinnedState = !note.isPinned;

  await db.update(fileNotes).set({ isPinned: newPinnedState, updatedAt: now }).where(eq(fileNotes.id, noteId));

  return c.json({
    success: true,
    data: {
      isPinned: newPinnedState,
      message: newPinnedState ? '已置顶' : '已取消置顶',
    },
  });
});

app.get('/:fileId/:noteId/history', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  const noteId = c.req.param('noteId');
  const db = getDb(c.env.DB);

  const note = await db
    .select()
    .from(fileNotes)
    .where(and(eq(fileNotes.id, noteId), eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .get();

  if (!note) throwAppError('NOTE_NOT_FOUND', '笔记不存在');

  const history = await db
    .select({
      id: fileNoteHistory.id,
      content: fileNoteHistory.content,
      version: fileNoteHistory.version,
      editedBy: fileNoteHistory.editedBy,
      createdAt: fileNoteHistory.createdAt,
    })
    .from(fileNoteHistory)
    .where(eq(fileNoteHistory.noteId, noteId))
    .orderBy(desc(fileNoteHistory.version))
    .all();

  return c.json({
    success: true,
    data: {
      current: {
        id: note.id,
        content: note.content,
        version: note.version,
      },
      history,
    },
  });
});

function renderMarkdown(content: string): string {
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\n/g, '<br>');
}

function extractMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  return [...new Set(mentions)];
}

export default app;
