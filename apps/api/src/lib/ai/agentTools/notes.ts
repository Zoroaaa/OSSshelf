/**
 * notes.ts — 文件笔记与批注工具
 *
 * 功能:
 * - 添加/查看/编辑笔记
 * - 笔记搜索与筛选
 * - 批量操作
 *
 * 智能特性：
 * - 支持富文本（Markdown）
 * - 自动关联上下文
 */

import { eq, and, isNull, desc, like } from 'drizzle-orm';
import { getDb, files, fileNotes } from '../../../db';
import type { Env } from '../../../types/env';
import type { ToolDefinition } from './types';
import {
  createNote as serviceCreateNote,
  updateNote as serviceUpdateNote,
  deleteNote as serviceDeleteNote,
  getFileNotes as serviceGetFileNotes,
} from '../../../lib/noteService';

export const definitions: ToolDefinition[] = [
  // 1. add_note — 添加笔记
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: `【写笔记】为文件添加个人备注或批注。
适用场景：
• "在这个文档上记个笔记"
• "标注一下这个文件的重点"
• "提醒我这份合同需要注意什么"

💡 笔记是私密的，只有你自己能看到`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
          content: { type: 'string', description: '笔记内容（支持Markdown格式）' },
        },
        required: ['fileId', 'content'],
      },
      examples: [
        { user_query: '在这个文档上记个笔记', tool_call: { fileId: '<doc_id>', content: '重要：第3页的数据需要核实' } },
        {
          user_query: '标注一下这个文件的重点',
          tool_call: { fileId: '<report_id>', content: '## 重点摘要\n- 项目进度：80%\n- 风险点：...' },
        },
      ],
    },
  },

  // 2. get_notes — 查看笔记
  {
    type: 'function',
    function: {
      name: 'get_notes',
      description: `【读笔记】查看文件的笔记列表。
适用场景：
• "这个文件有什么备注"
• "看看我之前记了什么"
• "显示所有笔记"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '目标文件ID' },
          limit: { type: 'number', description: '返回数量（默认20）' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '这个文件有什么备注', tool_call: { fileId: '<file_id>' } },
        { user_query: '看看我之前记了什么', tool_call: { fileId: '<doc_id>', limit: 10 } },
      ],
    },
  },

  // 3. update_note — 编辑笔记
  {
    type: 'function',
    function: {
      name: 'update_note',
      description: `【改笔记】修改已有的笔记内容。
适用场景：
• "更新一下之前的备注"
• "修正笔记中的错误"
• "补充更多信息到笔记里"`,
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string', description: '笔记ID' },
          content: { type: 'string', description: '新的笔记内容' },
        },
        required: ['noteId', 'content'],
      },
      examples: [
        {
          user_query: '更新一下之前的备注',
          tool_call: { noteId: '<note_id>', content: '更新后的笔记内容：数据已核实，可以提交' },
        },
        { user_query: '修正笔记中的错误', tool_call: { noteId: '<note_id>', content: '修正：日期应为2026-04-16' } },
      ],
    },
  },

  // 4. delete_note — 删除笔记
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: `【删笔记】删除不需要的笔记。
⚠️ 此操作不可恢复，请确认后再调用`,
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string', description: '要删除的笔记ID' },
        },
        required: ['noteId'],
      },
      examples: [
        { user_query: '删除这条笔记', tool_call: { noteId: '<note_id>' } },
        { user_query: '清理不需要的备注', tool_call: { noteId: '<old_note_id>' } },
      ],
    },
  },

  // 5. search_notes — 搜索笔记
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: `【搜笔记】在所有笔记中搜索关键词。
适用场景：
• "找一下提到XX的笔记"
• "我记得有篇笔记说了..."
• "搜索我的所有备注"`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '返回数量（默认20）' },
        },
        required: ['query'],
      },
      examples: [
        { user_query: '找一下提到项目的笔记', tool_call: { query: '项目' } },
        { user_query: '搜索包含会议的备注', tool_call: { query: '会议', limit: 30 } },
      ],
    },
  },
];

export class NotesTools {
  static async executeWriteNote(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const content = args.content as string;
    const append = args.append !== false;

    // 调用公共 service 层（复用 notes.ts POST /:fileId 的核心逻辑：权限检查、Markdown渲染、@提及）
    const result = await serviceCreateNote(env, userId, { fileId, content });
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: append ? '备注已追加' : '备注已创建',
      noteId: result.noteId,
      fileId,
      action: 'created',
      _next_actions: ['✅ 笔记保存成功'],
    };
  }

  static async executeGetFileNotes(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const limit = Math.min((args.limit as number) || 20, 50);

    // 调用公共 service 层
    const result = await serviceGetFileNotes(env, userId, fileId, limit);
    if (!result.success) return { error: result.error };

    return {
      fileId,
      total: result.total,
      notes: result.notes.map((n: any) => ({
        id: n.id,
        content: n.content,
        fullContent: n.content,
        isPinned: n.isPinned,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    };
  }

  static async executeUpdateNote(env: Env, userId: string, args: Record<string, unknown>) {
    const noteId = args.noteId as string;
    const content = args.content as string;

    // 调用公共 service 层（复用 notes.ts PUT /:fileId/:noteId 的核心逻辑：历史版本、权限检查）
    const result = await serviceUpdateNote(env, userId, undefined, noteId, { content });
    if (!result.success) return { error: result.error };

    return { success: true, message: result.message, noteId };
  }

  static async executeDeleteNote(env: Env, userId: string, args: Record<string, unknown>) {
    const noteId = args.noteId as string;

    const result = await serviceDeleteNote(env, userId, undefined, noteId);
    if (!result.success) return { error: result.error };

    return { success: true, message: result.message, noteId };
  }

  static async executeSearchNotes(env: Env, userId: string, args: Record<string, unknown>) {
    const query = args.query as string;
    const limit = Math.min((args.limit as number) || 20, 100);
    const db = getDb(env.DB);

    if (!query) {
      return { error: '请提供搜索关键词' };
    }

    const results = await db
      .select({
        noteId: fileNotes.id,
        fileId: fileNotes.fileId,
        fileName: files.name,
        content: fileNotes.content,
        createdAt: fileNotes.createdAt,
      })
      .from(fileNotes)
      .innerJoin(files, eq(fileNotes.fileId, files.id))
      .where(and(eq(fileNotes.userId, userId), isNull(fileNotes.deletedAt), like(fileNotes.content, `%${query}%`)))
      .orderBy(desc(fileNotes.createdAt))
      .limit(limit)
      .all();

    return {
      total: results.length,
      query,
      results: results.map((r) => ({
        noteId: r.noteId,
        fileId: r.fileId,
        fileName: r.fileName,
        snippet: r.content || '',
        createdAt: r.createdAt,
      })),
    };
  }
}
