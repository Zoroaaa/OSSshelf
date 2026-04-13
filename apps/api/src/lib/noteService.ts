/**
 * noteService.ts — 笔记操作公共服务层（唯一来源）
 *
 * 从 routes/notes.ts 提取的核心业务逻辑，
 * 供 API 路由和 AI AgentTools 共同调用。
 *
 * 功能:
 * - 创建笔记（含权限检查、Markdown渲染、@提及、回复通知）
 * - 更新笔记（含历史版本、@提及重新提取）
 * - 删除笔记（含递归子笔记清理）
 * - 查询笔记列表
 */

import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { getDb, files, fileNotes, fileNoteHistory, noteMentions, users } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { checkFilePermission } from '../lib/permissionService';

const MAX_NOTE_CONTENT_LENGTH = 10000;

// ─────────────────────────────────────────────────────────────────────────────
// Markdown 渲染（与 routes/notes.ts 完全一致）
// ─────────────────────────────────────────────────────────────────────────────

export function renderMarkdown(content: string): string {
  if (!content) return '';
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\n/g, '<br/>');
}

// ─────────────────────────────────────────────────────────────────────────────
// @提及 提取（与 routes/notes.ts 完全一致）
// ─────────────────────────────────────────────────────────────────────────────

export function extractMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  return [...new Set(mentions)];
}

// ─────────────────────────────────────────────────────────────────────────────
// 输入类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateNoteInput {
  fileId: string;
  content: string;
  parentId?: string;
}

export interface UpdateNoteInput {
  content: string;
}

export interface NoteWithMentions {
  noteId: string;
  mentionedUserIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 创建笔记（复用 notes.ts POST /:fileId 的核心逻辑）
// 返回提及信息供路由层发送通知
// ─────────────────────────────────────────────────────────────────────────────

export async function createNote(
  env: Env,
  userId: string,
  input: CreateNoteInput
): Promise<
  | {
      success: true;
      noteId: string;
      note: Record<string, unknown>;
      mentions: NoteWithMentions | null;
    }
  | { success: false; error: string }
> {
  const db = getDb(env.DB);
  const { fileId, content, parentId } = input;

  if (!content || content.trim().length === 0) {
    return { success: false, error: '笔记内容不能为空' };
  }
  if (content.length > MAX_NOTE_CONTENT_LENGTH) {
    return { success: false, error: `笔记内容过长（最大${MAX_NOTE_CONTENT_LENGTH}字符）` };
  }

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', env);
  if (!hasAccess) {
    return { success: false, error: '无权访问此文件' };
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return { success: false, error: '文件不存在' };

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
    .set({ noteCount: sql`${files.noteCount} + 1`, updatedAt: now })
    .where(eq(files.id, fileId));

  // 处理 @提及
  let mentionResult: NoteWithMentions | null = null;
  const mentions = extractMentions(content);

  if (mentions.length > 0) {
    const mentionedUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(sql`${users.email} IN ${mentions}`)
      .all();

    const mentionedUserIds: string[] = [];
    for (const u of mentionedUsers) {
      await db.insert(noteMentions).values({
        id: crypto.randomUUID(),
        noteId,
        userId: u.id,
        isRead: false,
        createdAt: now,
      });
      mentionedUserIds.push(u.id);
    }

    if (mentionedUserIds.length > 0) {
      mentionResult = { noteId, mentionedUserIds };
    }
  }

  logger.info('NoteService', '笔记创建成功', { noteId, fileId, contentLength: content.length });

  return {
    success: true,
    noteId,
    note: { id: noteId, content, contentHtml, isPinned: false, version: 1, createdAt: now },
    mentions: mentionResult,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 更新笔记（复用 notes.ts PUT /:fileId/:noteId 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

export async function updateNote(
  env: Env,
  userId: string,
  fileId: string | undefined,
  noteId: string,
  input: UpdateNoteInput
): Promise<{ success: true; message: string; mentions: NoteWithMentions | null } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { content } = input;

  if (!content || content.trim().length === 0) {
    return { success: false, error: '笔记内容不能为空' };
  }
  if (content.length > MAX_NOTE_CONTENT_LENGTH) {
    return { success: false, error: `笔记内容过长（最大${MAX_NOTE_CONTENT_LENGTH}字符）` };
  }

  const whereClause = fileId
    ? and(eq(fileNotes.id, noteId), eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt))
    : and(eq(fileNotes.id, noteId), isNull(fileNotes.deletedAt));

  const note = await db.select().from(fileNotes).where(whereClause).get();

  if (!note) return { success: false, error: '笔记不存在' };

  if (note.userId !== userId) {
    return { success: false, error: '无权编辑此笔记' };
  }

  const now = new Date().toISOString();
  const contentHtml = renderMarkdown(content);

  try {
    await db.insert(fileNoteHistory).values({
      id: crypto.randomUUID(),
      noteId,
      content: note.content,
      version: note.version,
      editedBy: userId,
      createdAt: now,
    });
  } catch (historyError) {
    logger.warn('NoteService', '保存历史版本失败（非致命）', { noteId }, historyError);
  }

  await db
    .update(fileNotes)
    .set({ content, contentHtml, version: note.version + 1, updatedAt: now })
    .where(eq(fileNotes.id, noteId));

  // 重新提取 @提及：先删除旧的，再插入新的
  let mentionResult: NoteWithMentions | null = null;

  try {
    await db.delete(noteMentions).where(eq(noteMentions.noteId, noteId));

    const mentions = extractMentions(content);
    if (mentions.length > 0) {
      const mentionedUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.email} IN ${mentions}`)
        .all();

      const mentionedUserIds: string[] = [];
      for (const u of mentionedUsers) {
        await db.insert(noteMentions).values({
          id: crypto.randomUUID(),
          noteId,
          userId: u.id,
          isRead: false,
          createdAt: now,
        });
        mentionedUserIds.push(u.id);
      }

      if (mentionedUserIds.length > 0) {
        mentionResult = { noteId, mentionedUserIds };
      }
    }
  } catch (mentionError) {
    logger.warn('NoteService', '更新提及失败（非致命）', { noteId }, mentionError);
  }

  logger.info('NoteService', '笔记更新成功', { noteId, newVersion: note.version + 1 });
  return { success: true, message: '笔记已更新', mentions: mentionResult };
}

// ─────────────────────────────────────────────────────────────────────────────
// 删除笔记（含递归子笔记清理，与路由完全一致）
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteNote(
  env: Env,
  userId: string,
  fileId: string | undefined,
  noteId: string
): Promise<{ success: true; message: string; deletedCount: number } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const whereClause = fileId
    ? and(eq(fileNotes.id, noteId), eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt))
    : and(eq(fileNotes.id, noteId), isNull(fileNotes.deletedAt));

  const note = await db.select().from(fileNotes).where(whereClause).get();

  if (!note) return { success: false, error: '笔记不存在' };

  if (note.userId !== userId) {
    return { success: false, error: '无权删除此笔记' };
  }

  const resolvedFileId = fileId || note.fileId;
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
    .where(eq(files.id, resolvedFileId));

  logger.info('NoteService', '笔记删除成功', { noteId, deletedCount });
  return { success: true, message: '笔记已删除', deletedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取文件笔记列表
// ─────────────────────────────────────────────────────────────────────────────

export async function getFileNotes(
  env: Env,
  userId: string,
  fileId: string,
  limit: number = 20
): Promise<
  { success: true; notes: Array<Record<string, unknown>>; total: number } | { success: false; error: string }
> {
  const db = getDb(env.DB);

  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', env);
  if (!hasAccess) {
    return { success: false, error: '无权访问此文件' };
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return { success: false, error: '文件不存在' };

  const notesList = await db
    .select({
      id: fileNotes.id,
      content: fileNotes.content,
      contentHtml: fileNotes.contentHtml,
      isPinned: fileNotes.isPinned,
      version: fileNotes.version,
      createdAt: fileNotes.createdAt,
      updatedAt: fileNotes.updatedAt,
    })
    .from(fileNotes)
    .where(and(eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .orderBy(desc(fileNotes.isPinned), desc(fileNotes.createdAt))
    .limit(limit)
    .all();

  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(fileNotes)
    .where(and(eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .get();

  return {
    success: true,
    notes: notesList.map((n) => ({ ...n })),
    total: totalResult?.count ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 置顶/取消置顶笔记
// ─────────────────────────────────────────────────────────────────────────────

export async function togglePinNote(
  env: Env,
  userId: string,
  fileId: string,
  noteId: string
): Promise<{ success: true; isPinned: boolean; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const note = await db
    .select()
    .from(fileNotes)
    .where(and(eq(fileNotes.id, noteId), eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .get();

  if (!note) return { success: false, error: '笔记不存在' };

  if (note.userId !== userId) {
    return { success: false, error: '无权置顶此笔记' };
  }

  const now = new Date().toISOString();
  const newPinnedState = !note.isPinned;

  await db.update(fileNotes).set({ isPinned: newPinnedState, updatedAt: now }).where(eq(fileNotes.id, noteId));

  return {
    success: true,
    isPinned: newPinnedState,
    message: newPinnedState ? '已置顶' : '已取消置顶',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 获取笔记历史版本
// ─────────────────────────────────────────────────────────────────────────────

export interface NoteHistoryEntry {
  id: string;
  content: string;
  version: number;
  editedBy: string | null;
  createdAt: string;
}

export async function getNoteHistory(
  env: Env,
  userId: string,
  fileId: string,
  noteId: string
): Promise<
  | {
      success: true;
      current: { id: string; content: string; version: number };
      history: NoteHistoryEntry[];
    }
  | { success: false; error: string }
> {
  const db = getDb(env.DB);

  const note = await db
    .select()
    .from(fileNotes)
    .where(and(eq(fileNotes.id, noteId), eq(fileNotes.fileId, fileId), isNull(fileNotes.deletedAt)))
    .get();

  if (!note) return { success: false, error: '笔记不存在' };

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

  return {
    success: true,
    current: {
      id: note.id,
      content: note.content,
      version: note.version,
    },
    history,
  };
}
