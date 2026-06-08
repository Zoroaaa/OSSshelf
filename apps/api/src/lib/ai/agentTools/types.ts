/**
 * types.ts — AgentTools 公共类型定义
 *
 * 功能:
 * - 定义所有工具共享的类型接口
 * - 定义工具返回格式
 * - 定义写操作标记集合
 */

// ─────────────────────────────────────────────────────────────────────────────
// 工具定义（发送给 LLM）
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
    examples?: Array<{
      user_query: string;
      tool_call: Record<string, unknown>;
    }>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具统一返回的文件对象（前端渲染用）
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentFile {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  mimeType: string | null;
  size: number;
  sizeFormatted: string;
  createdAt: string;
  updatedAt: string;
  parentId: string | null;
  aiSummary: string | null;
  aiTags: string | null;
  description: string | null;
  isStarred: boolean;
  currentVersion: number | null;
  vectorIndexedAt: string | null;
  _ref?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具结果通用包装
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolResultBase {
  /** Agent 下一步行动建议（驱动链式推理） */
  _next_actions?: string[];
}

/** 写操作待确认状态 */
export interface PendingConfirmResult extends ToolResultBase {
  status: 'pending_confirm';
  message: string;
  toolName: string;
  args: Record<string, unknown>;
  previewDiff?: {
    before: string;
    after: string;
    totalChanges: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 写操作工具标记（需要用户确认）
// ─────────────────────────────────────────────────────────────────────────────

export const WRITE_TOOLS = new Set([
  // 文件操作
  'create_text_file',
  'create_code_file',
  'create_file_from_template',
  'draft_and_create_file',
  'edit_file_content',
  'append_to_file',
  'find_and_replace',
  'rename_file',
  'move_file',
  'copy_file',
  'delete_file',
  'restore_file',
  'create_folder',
  'batch_rename',
  'star_file',
  'unstar_file',

  // 标签管理
  'add_tag',
  'remove_tag',
  'merge_tags',
  'auto_tag_files',
  'tag_folder',

  // 分享管理
  'create_share',
  'update_share',
  'revoke_share',
  'create_direct_link',
  'revoke_direct_link',
  'create_upload_link_for_folder',

  // 版本管理
  'restore_version',
  'set_version_retention',

  // 笔记管理
  'write_note',
  'update_note',
  'delete_note',

  // 权限管理
  'grant_permission',
  'revoke_permission',
  'set_folder_access_level',
  'manage_group_members',

  // 存储桶管理
  'set_default_bucket',
  'migrate_file_to_bucket',

  // 系统管理
  'create_api_key',
  'revoke_api_key',
  'create_webhook',
]);

// ─────────────────────────────────────────────────────────────────────────────
// 执行器上下文
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolContext {
  userId: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  previousTools?: ToolCall[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助类型
// ─────────────────────────────────────────────────────────────────────────────

/** 文件数据库记录 */
export type FileRecord = {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  path: string;
  type: string | null;
  size: number;
  r2Key: string;
  mimeType: string | null;
  hash: string | null;
  isFolder: boolean;
  allowedMimeTypes: string | null;
  refCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  bucketId: string | null;
  directLinkToken: string | null;
  directLinkExpiresAt: string | null;
  currentVersion: number | null;
  maxVersions: number | null;
  versionRetentionDays: number | null;
  description: string | null;
  noteCount: number | null;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  aiTags: string | null;
  aiTagsAt: string | null;
  vectorIndexedAt: string | null;
  isStarred: boolean | null;
};
