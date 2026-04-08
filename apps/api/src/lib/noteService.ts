/**
 * noteService.ts — 笔记操作公共服务层
 *
 * 从 routes/notes.ts 提取的核心业务逻辑，
 * 供 API 路由和 AI AgentTools 共同调用。
 *
 * 功能:
 * - 创建笔记（含权限检查、Markdown渲染、@提及）
 * - 更新笔记（含历史版本、@提及重新提取）
 * - 删除笔记
 * - 查询笔记列表
 */

import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { getDb, files, fileNotes, fileNoteHistory } from '../db';
import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';
import { checkFilePermission } from '../routes/permissions';

const MAX_NOTE_CONTENT_LENGTH = 10000;

// ─────────────────────────────────────────────────────────────────────────────
// 简单的 Markdown 渲染（复用 notes.ts 的 renderMarkdown 逻辑）
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(content: string): string {
  if (!content) return '';
  const html = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
  return html;
}

export interface CreateNoteInput {
  fileId: string;
  content: string;
  parentId?: string;
}

export interface UpdateNoteInput {
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 创建笔记（复用 notes.ts POST /:fileId 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

export async function createNote(
  env: Env,
  userId: string,
  input: CreateNoteInput
): Promise<{ success: true; noteId: string; note: Record<string, unknown> } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { fileId, content, parentId } = input;

  if (!content || content.trim().length === 0) {
    return { success: false, error: '笔记内容不能为空' };
  }
  if (content.length > MAX_NOTE_CONTENT_LENGTH) {
    return { success: false, error: `笔记内容过长（最大${MAX_NOTE_CONTENT_LENGTH}字符）` };
  }

  // 权限检查：需要 read 权限才能添加笔记
  const { hasAccess } = await checkFilePermission(db, fileId, userId, 'read', env);
  if (!hasAccess) {
    return { success: false, error: '无权访问此文件' };
  }

  // 文件存在性检查
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

  // 更新文件的笔记计数
  await db
    .update(files)
    .set({ noteCount: sql`${files.noteCount} + 1`, updatedAt: now })
    .where(eq(files.id, fileId));

  logger.info('NoteService', '笔记创建成功', { noteId, fileId, contentLength: content.length });

  return {
    success: true,
    noteId,
    note: { id: noteId, content, contentHtml, isPinned: false, version: 1, createdAt: now },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 更新笔记（复用 notes.ts PUT /:fileId/:noteId 的核心逻辑）
// ─────────────────────────────────────────────────────────────────────────────

export async function updateNote(
  env: Env,
  userId: string,
  noteId: string,
  input: UpdateNoteInput
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);
  const { content } = input;

  if (!content || content.trim().length === 0) {
    return { success: false, error: '笔记内容不能为空' };
  }
  if (content.length > MAX_NOTE_CONTENT_LENGTH) {
    return { success: false, error: `笔记内容过长（最大${MAX_NOTE_CONTENT_LENGTH}字符）` };
  }

  // 查找笔记并验证权限
  const note = await db
    .select()
    .from(fileNotes)
    .where(and(eq(fileNotes.id, noteId), isNull(fileNotes.deletedAt)))
    .get();

  if (!note) return { success: false, error: '笔记不存在' };

  // 只有创建者可以编辑
  if (note.userId !== userId) {
    return { success: false, error: '无权编辑此笔记' };
  }

  const now = new Date().toISOString();
  const contentHtml = renderMarkdown(content);

  // 保存历史版本
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

  // 更新笔记内容
  await db
    .update(fileNotes)
    .set({ content, contentHtml, version: note.version + 1, updatedAt: now })
    .where(eq(fileNotes.id, noteId));

  logger.info('NoteService', '笔记更新成功', { noteId, newVersion: note.version + 1 });
  return { success: true, message: '笔记已更新' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 删除笔记
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteNote(
  env: Env,
  userId: string,
  noteId: string
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const db = getDb(env.DB);

  const note = await db
    .select()
    .from(fileNotes)
    .where(and(eq(fileNotes.id, noteId), isNull(fileNotes.deletedAt)))
    .get();

  if (!note) return { success: false, error: '笔记不存在' };

  // 只有创建者可以删除
  if (note.userId !== userId) {
    return { success: false, error: '无权删除此笔记' };
  }

  const now = new Date().toISOString();
  await db.update(fileNotes).set({ deletedAt: now }).where(eq(fileNotes.id, noteId));

  // 更新文件笔记计数
  await db
    .update(files)
    .set({ noteCount: sql`CASE WHEN ${files.noteCount} > 0 THEN ${files.noteCount} - 1 ELSE 0 END`, updatedAt: now })
    .where(eq(files.id, note.fileId));

  logger.info('NoteService', '笔记删除成功', { noteId });
  return { success: true, message: '笔记已删除' };
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
