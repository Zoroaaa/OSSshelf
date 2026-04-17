/**
 * index.ts — AgentTools 统一入口
 *
 * 功能:
 * - 聚合所有子模块的工具定义
 * - 提供统一的执行器入口
 * - 工具路由和分发
 * - 向后兼容旧版 API
 *
 * 模块清单:
 * - search.ts: 6个搜索工具
 * - content.ts: 7个内容理解工具
 * - navigation.ts: 4个导航工具
 * - stats.ts: 5个统计工具
 * - fileops.ts: 15个文件操作工具 ⭐
 * - tags.ts: 6个标签管理工具
 * - share.ts: 10个分享链接工具 ⭐
 * - version.ts: 4个版本管理工具
 * - notes.ts: 4个笔记备注工具
 * - permission.ts: 6个权限管理工具 ⭐
 * - storage.ts: 4个存储桶管理工具
 * - system.ts: 7个系统管理工具
 * - ai-enhance.ts: 5个AI增强工具
 */

import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import { getDb, files } from '../../../db';
import { eq, and, isNull } from 'drizzle-orm';
import { readFileContent } from '../../../lib/fileContentHelper';

// ─────────────────────────────────────────────────────────────────────────────
// 导入所有子模块
// ─────────────────────────────────────────────────────────────────────────────

// 类型导出
export {
  ToolDefinition,
  ToolCall,
  AgentFile,
  ToolResultBase,
  PendingConfirmResult,
  WRITE_TOOLS,
  FileRecord,
} from './types';

// 搜索模块 (6个工具)
import { definitions as searchDefinitions, SearchTools } from './search';

// 内容理解模块 (7个工具)
import { definitions as contentDefinitions, ContentTools } from './content';

// 导航模块 (4个工具)
import { definitions as navigationDefinitions, NavigationTools } from './navigation';

// 统计模块 (5个工具)
import { definitions as statsDefinitions, StatsTools } from './stats';

// 文件操作模块 (15个工具) ⭐
import { definitions as fileopsDefinitions, FileOpsTools } from './fileops';

// 标签管理模块 (6个工具)
import { definitions as tagsDefinitions, TagsTools } from './tags';

// 分享链接模块 (10个工具) ⭐
import { definitions as shareDefinitions, ShareTools } from './share';

// 版本管理模块 (4个工具)
import { definitions as versionDefinitions, VersionTools } from './version';

// 笔记备注模块 (4个工具)
import { definitions as notesDefinitions, NotesTools } from './notes';

// 权限管理模块 (6个工具) ⭐
import { definitions as permissionDefinitions, PermissionTools } from './permission';

// 存储桶管理模块 (4个工具)
import { definitions as storageDefinitions, StorageTools } from './storage';

// 系统管理模块 (7个工具)
import { definitions as systemDefinitions, SystemTools } from './system';

// AI增强模块 (5个工具)
import { definitions as aiEnhanceDefinitions, AiEnhanceTools } from './ai-enhance';

// 写操作标记集合
import { WRITE_TOOLS } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 聚合所有工具定义（发送给 LLM）
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  // 🔍 搜索与发现 (6)
  ...searchDefinitions,
  // 📄 内容理解与分析 (7)
  ...contentDefinitions,
  // 📂 目录导航 (4)
  ...navigationDefinitions,
  // 📊 统计与分析 (5)
  ...statsDefinitions,
  // 📁 文件操作 (15) ⭐
  ...fileopsDefinitions,
  // 🏷️ 标签管理 (6)
  ...tagsDefinitions,
  // 🔗 分享与链接 (10) ⭐
  ...shareDefinitions,
  // 📜 版本管理 (4)
  ...versionDefinitions,
  // 📝 笔记备注 (4)
  ...notesDefinitions,
  // 🔐 权限管理 (6) ⭐
  ...permissionDefinitions,
  // 💾 存储桶管理 (4)
  ...storageDefinitions,
  // ⚙️ 系统管理 (7)
  ...systemDefinitions,
  // 🤖 AI增强 (5)
  ...aiEnhanceDefinitions,
];

// ─────────────────────────────────────────────────────────────────────────────
// 工具名称到执行器的映射表
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_EXECUTOR_MAP: Record<string, (env: Env, userId: string, args: Record<string, unknown>) => Promise<unknown>> =
  {
    // ════════════════════════════════════════════════════════════════
    // 🔍 搜索与发现 (search.ts)
    // ════════════════════════════════════════════════════════════════
    search_files: (env, userId, args) => SearchTools.executeSearchFiles(env, userId, args),
    filter_files: (env, userId, args) => SearchTools.executeFilterFiles(env, userId, args),
    search_by_tag: (env, userId, args) => SearchTools.executeSearchByTag(env, userId, args),
    search_duplicates: (env, userId, args) => SearchTools.executeSearchDuplicates(env, userId, args),
    smart_search: (env, userId, args) => SearchTools.executeSmartSearch(env, userId, args),
    get_similar_files: (env, userId, args) => SearchTools.executeGetSimilarFiles(env, userId, args),
    get_file_details: (env, userId, args) => SearchTools.executeGetFileDetails(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 📄 内容理解与分析 (content.ts)
    // ════════════════════════════════════════════════════════════════
    read_file_text: (env, userId, args) => ContentTools.executeReadFileText(env, userId, args),
    analyze_image: (env, userId, args) => ContentTools.executeAnalyzeImage(env, userId, args),
    compare_files: (env, userId, args) => ContentTools.executeCompareFiles(env, userId, args),
    extract_metadata: (env, userId, args) => ContentTools.executeExtractMetadata(env, userId, args),
    generate_summary: (env, userId, args) => ContentTools.executeGenerateSummary(env, userId, args),
    generate_tags: (env, userId, args) => ContentTools.executeGenerateTags(env, userId, args),
    content_preview: (env, userId, args) => ContentTools.executeContentPreview(env, userId, args),
    analyze_file_collection: (env, userId, args) => ContentTools.executeAnalyzeFileCollection(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 📂 目录导航 (navigation.ts)
    // ════════════════════════════════════════════════════════════════
    navigate_path: (env, userId, args) => NavigationTools.executeNavigatePath(env, userId, args),
    list_folder: (env, userId, args) => NavigationTools.executeListFolder(env, userId, args),
    get_recent_files: (env, userId, args) => NavigationTools.executeGetRecentFiles(env, userId, args),
    get_starred_files: (env, userId, args) => NavigationTools.executeGetStarredFiles(env, userId, args),
    get_parent_chain: (env, userId, args) => NavigationTools.executeGetParentChain(env, userId, args),
    get_folder_tree: (env, userId, args) => NavigationTools.executeGetFolderTree(env, userId, args),
    get_storage_overview: (env, userId, args) => NavigationTools.executeGetStorageOverview(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 📊 统计与分析 (stats.ts)
    // ════════════════════════════════════════════════════════════════
    get_storage_stats: (env, userId, args) => StatsTools.executeGetStorageStats(env, userId, args),
    get_activity_stats: (env, userId, args) => StatsTools.executeGetActivityStats(env, userId, args),
    get_user_quota_info: (env, userId, args) => StatsTools.executeGetUserQuotaInfo(env, userId, args),
    get_file_type_distribution: (env, userId, args) => StatsTools.executeGetFileTypeDistribution(env, userId, args),
    get_sharing_stats: (env, userId, args) => StatsTools.executeGetSharingStats(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 📁 文件操作 (fileops.ts) ⭐
    // ════════════════════════════════════════════════════════════════
    create_text_file: (env, userId, args) => FileOpsTools.executeCreateTextFile(env, userId, args),
    create_code_file: (env, userId, args) => FileOpsTools.executeCreateCodeFile(env, userId, args),
    create_file_from_template: (env, userId, args) => FileOpsTools.executeCreateFileFromTemplate(env, userId, args),
    edit_file_content: (env, userId, args) => FileOpsTools.executeEditFileContent(env, userId, args),
    append_to_file: (env, userId, args) => FileOpsTools.executeAppendToFile(env, userId, args),
    find_and_replace: (env, userId, args) => FileOpsTools.executeFindAndReplace(env, userId, args),
    rename_file: (env, userId, args) => FileOpsTools.executeRenameFile(env, userId, args),
    move_file: (env, userId, args) => FileOpsTools.executeMoveFile(env, userId, args),
    copy_file: (env, userId, args) => FileOpsTools.executeCopyFile(env, userId, args),
    delete_file: (env, userId, args) => FileOpsTools.executeDeleteFile(env, userId, args),
    restore_file: (env, userId, args) => FileOpsTools.executeRestoreFile(env, userId, args),
    create_folder: (env, userId, args) => FileOpsTools.executeCreateFolder(env, userId, args),
    batch_rename: (env, userId, args) => FileOpsTools.executeBatchRename(env, userId, args),
    batch_move: (env, userId, args) => FileOpsTools.executeBatchMove(env, userId, args),
    batch_delete: (env, userId, args) => FileOpsTools.executeBatchDelete(env, userId, args),
    star_file: (env, userId, args) => FileOpsTools.executeStarFile(env, userId, args),
    unstar_file: (env, userId, args) => FileOpsTools.executeUnstarFile(env, userId, args),
    draft_and_create_file: (env, userId, args) => FileOpsTools.executeDraftAndCreateFile(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 🏷️ 标签管理 (tags.ts)
    // ════════════════════════════════════════════════════════════════
    add_tag: (env, userId, args) => TagsTools.executeAddTag(env, userId, args),
    remove_tag: (env, userId, args) => TagsTools.executeRemoveTag(env, userId, args),
    get_file_tags: (env, userId, args) => TagsTools.executeGetFileTags(env, userId, args),
    list_all_tags_for_management: (env, userId, args) => TagsTools.executeListAllTags(env, userId, args),
    merge_tags: (env, userId, args) => TagsTools.executeMergeTags(env, userId, args),
    auto_tag_files: (env, userId, args) => TagsTools.executeAutoTagFiles(env, userId, args),
    tag_folder: (env, userId, args) => TagsTools.executeTagFolder(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 🔗 分享与链接 (share.ts) ⭐
    // ════════════════════════════════════════════════════════════════
    create_share_link: (env, userId, args) => ShareTools.executeCreateShare(env, userId, args),
    list_shares: (env, userId, args) => ShareTools.executeListShares(env, userId, args),
    update_share_settings: (env, userId, args) => ShareTools.executeUpdateShare(env, userId, args),
    revoke_share: (env, userId, args) => ShareTools.executeRevokeShare(env, userId, args),
    get_share_stats: (env, userId, args) => ShareTools.executeGetShareDetails(env, userId, args),
    create_direct_link: (env, userId, args) => ShareTools.executeCreateDirectLink(env, userId, args),
    revoke_direct_link: (env, userId, args) => ShareTools.executeRevokeDirectLink(env, userId, args),
    create_upload_link_for_folder: (env, userId, args) =>
      ShareTools.executeCreateUploadLinkForFolder(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 📜 版本管理 (version.ts)
    // ════════════════════════════════════════════════════════════════
    get_file_versions: (env, userId, args) => VersionTools.executeGetFileVersions(env, userId, args),
    restore_version: (env, userId, args) => VersionTools.executeRestoreVersion(env, userId, args),
    compare_versions: (env, userId, args) => VersionTools.executeCompareVersions(env, userId, args),
    set_version_retention: (env, userId, args) => VersionTools.executeSetVersionRetention(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 📝 笔记备注 (notes.ts)
    // ════════════════════════════════════════════════════════════════
    add_note: (env, userId, args) => NotesTools.executeWriteNote(env, userId, args),
    get_notes: (env, userId, args) => NotesTools.executeGetFileNotes(env, userId, args),
    update_note: (env, userId, args) => NotesTools.executeUpdateNote(env, userId, args),
    delete_note: (env, userId, args) => NotesTools.executeDeleteNote(env, userId, args),
    search_notes: (env, userId, args) => NotesTools.executeSearchNotes(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 🔐 权限管理 (permission.ts) ⭐
    // ════════════════════════════════════════════════════════════════
    get_file_permissions: (env, userId, args) => PermissionTools.executeGetFilePermissions(env, userId, args),
    grant_permission: (env, userId, args) => PermissionTools.executeGrantPermission(env, userId, args),
    revoke_permission: (env, userId, args) => PermissionTools.executeRevokePermission(env, userId, args),
    set_folder_access_level: (env, userId, args) => PermissionTools.executeSetFolderAccessLevel(env, userId, args),
    list_user_groups: (env, userId, args) => PermissionTools.executeListUserGroups(env, userId, args),
    manage_group_members: (env, userId, args) => PermissionTools.executeManageGroupMembers(env, userId, args),
    list_expired_permissions: (env, userId, args) => PermissionTools.executeListExpiredPermissions(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 💾 存储桶管理 (storage.ts)
    // ════════════════════════════════════════════════════════════════
    get_storage_usage: (env, userId, args) => StorageTools.executeGetStorageUsage(env, userId, args),
    get_large_files: (env, userId, args) => StorageTools.executeGetLargeFiles(env, userId, args),
    get_folder_sizes: (env, userId, args) => StorageTools.executeGetFolderSizes(env, userId, args),
    get_cleanup_suggestions: (env, userId, args) => StorageTools.executeGetCleanupSuggestions(env, userId, args),
    list_buckets: (env, userId, args) => StorageTools.executeListBuckets(env, userId, args),
    get_bucket_info: (env, userId, args) => StorageTools.executeGetBucketInfo(env, userId, args),
    set_default_bucket: (env, userId, args) => StorageTools.executeSetDefaultBucket(env, userId, args),
    migrate_file_to_bucket: (env, userId, args) => StorageTools.executeMigrateFileToBucket(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // ⚙️ 系统管理 (system.ts)
    // ════════════════════════════════════════════════════════════════
    get_system_status: (env, userId, args) => SystemTools.executeGetSystemStatus(env, userId, args),
    get_help: (env, userId, args) => SystemTools.executeGetHelp(env, userId, args),
    get_version_info: (env, userId, args) => SystemTools.executeGetVersionInfo(env, userId, args),
    get_faq: (env, userId, args) => SystemTools.executeGetFaq(env, userId, args),
    get_user_profile: (env, userId, args) => SystemTools.executeGetUserProfile(env, userId, args),
    list_api_keys: (env, userId, args) => SystemTools.executeListApiKeys(env, userId, args),
    create_api_key: (env, userId, args) => SystemTools.executeCreateApiKey(env, userId, args),
    revoke_api_key: (env, userId, args) => SystemTools.executeRevokeApiKey(env, userId, args),
    list_webhooks: (env, userId, args) => SystemTools.executeListWebhooks(env, userId, args),
    create_webhook: (env, userId, args) => SystemTools.executeCreateWebhook(env, userId, args),
    get_audit_logs: (env, userId, args) => SystemTools.executeGetAuditLogs(env, userId, args),

    // ════════════════════════════════════════════════════════════════
    // 🤖 AI增强 (ai-enhance.ts)
    // ════════════════════════════════════════════════════════════════
    trigger_ai_summary: (env, userId, args) => AiEnhanceTools.executeTriggerAiSummary(env, userId, args),
    trigger_ai_tags: (env, userId, args) => AiEnhanceTools.executeTriggerAiTags(env, userId, args),
    rebuild_vector_index: (env, userId, args) => AiEnhanceTools.executeRebuildVectorIndex(env, userId, args),
    ask_rag_question: (env, userId, args) => AiEnhanceTools.executeAskRagQuestion(env, userId, args),
    smart_rename_suggest: (env, userId, args) => AiEnhanceTools.executeSmartRenameSuggest(env, userId, args),
    smart_organize_suggest: (env, userId, args) => AiEnhanceTools.executeSmartOrganizeSuggest(env, userId, args),
  };

// ─────────────────────────────────────────────────────────────────────────────
// 统一的 AgentToolExecutor 类（向后兼容）
// ─────────────────────────────────────────────────────────────────────────────

export class AgentToolExecutor {
  private env: Env;
  private userId: string;

  constructor(env: Env, userId: string) {
    this.env = env;
    this.userId = userId;
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * 执行指定的工具调用
   * @param toolName 工具名称
   * @param args 参数对象
   * @returns 工具执行结果
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const startTime = Date.now();

    try {
      const executor = TOOL_EXECUTOR_MAP[toolName];
      if (!executor) {
        logger.warn('AgentTool', 'Unknown tool requested', { toolName });
        const allTools = Object.keys(TOOL_EXECUTOR_MAP).sort();
        const similarTools = findSimilarTools(toolName, allTools);
        return {
          error: `未知工具: ${toolName}`,
          hint:
            similarTools.length > 0 ? `您是否想使用: ${similarTools.join(', ')}?` : `可用工具共 ${allTools.length} 个`,
          similarTools,
        };
      }

      const isWriteOperation = WRITE_TOOLS.has(toolName);

      if (isWriteOperation) {
        const pendingResult: Record<string, unknown> = {
          status: 'pending_confirm' as const,
          message: `此操作需要用户确认`,
          toolName,
          args,
        };

        // 对编辑类工具预先计算 diff 预览
        if (['edit_file_content', 'find_and_replace', 'append_to_file'].includes(toolName)) {
          try {
            const fileId = args.fileId as string;
            if (fileId) {
              const db = getDb(this.env.DB);
              const file = await db
                .select()
                .from(files)
                .where(and(eq(files.id, fileId), eq(files.userId, this.userId), isNull(files.deletedAt)))
                .get();
              if (file) {
                const readResult = await readFileContent(this.env, file, this.userId);
                if (readResult.success && readResult.content) {
                  const originalContent = readResult.content;
                  let newContent = originalContent;
                  let changeCount = 0;

                  if (toolName === 'edit_file_content') {
                    const edits = args.edits as Array<{
                      operation: string;
                      oldValue?: string;
                      newValue?: string;
                      position?: number;
                    }>;
                    for (const edit of edits || []) {
                      if (edit.operation === 'replace' && edit.oldValue && edit.newValue !== undefined) {
                        if (newContent.includes(edit.oldValue)) {
                          changeCount++;
                        }
                        newContent = newContent.replace(edit.oldValue, edit.newValue);
                      } else if (edit.operation === 'append' && edit.newValue) {
                        changeCount++;
                        newContent += '\n' + edit.newValue;
                      } else if (edit.operation === 'insert' && edit.newValue !== undefined) {
                        changeCount++;
                        newContent =
                          newContent.slice(0, edit.position ?? 0) +
                          edit.newValue +
                          newContent.slice(edit.position ?? 0);
                      } else if (edit.operation === 'delete' && edit.oldValue) {
                        changeCount++;
                        newContent = newContent.replace(edit.oldValue, '');
                      }
                    }
                  } else if (toolName === 'find_and_replace') {
                    const findStr = args.find as string;
                    const replaceStr = args.replace as string;
                    const replaceAll = args.replaceAll !== false;
                    if (findStr && replaceStr !== undefined) {
                      const regex = new RegExp(findStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                      const matches = originalContent.match(regex);
                      changeCount = matches ? matches.length : 0;
                      newContent = replaceAll
                        ? originalContent.replace(regex, replaceStr)
                        : originalContent.replace(regex, replaceStr);
                    }
                  } else if (toolName === 'append_to_file') {
                    const content = args.content as string;
                    if (content) {
                      changeCount = 1;
                      newContent =
                        args.addNewline === false ? originalContent + content : originalContent + '\n' + content;
                    }
                  }

                  pendingResult.previewDiff = {
                    before: originalContent.slice(0, 500),
                    after: newContent.slice(0, 500),
                    totalChanges: changeCount,
                  };
                }
              }
            }
          } catch (diffError) {
            logger.warn('AgentTool', 'Failed to compute previewDiff', { toolName, error: diffError });
          }
        }

        return pendingResult;
      }

      const result = await executor(this.env, this.userId, args);
      const duration = Date.now() - startTime;

      logger.info('AgentTool', `Executed tool [${toolName}]`, {
        toolName,
        userId: this.userId,
        duration: `${duration}ms`,
        success: true,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        'AgentTool',
        `Tool execution failed [${toolName}]`,
        {
          toolName,
          userId: this.userId,
          duration: `${duration}ms`,
          error: errorMessage,
        },
        error instanceof Error ? error : undefined
      );

      return {
        error: `${toolName} 执行失败: ${errorMessage}`,
        toolName,
      };
    }
  }

  async executeConfirmed(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const startTime = Date.now();

    try {
      const executor = TOOL_EXECUTOR_MAP[toolName];
      if (!executor) {
        return { error: `未知工具: ${toolName}` };
      }

      const safeArgs = { ...args };
      delete safeArgs._confirmed;

      const result = await executor(this.env, this.userId, safeArgs);
      const duration = Date.now() - startTime;

      logger.info('AgentTool', `Executed confirmed write tool [${toolName}]`, {
        toolName,
        userId: this.userId,
        duration: `${duration}ms`,
        success: true,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        'AgentTool',
        `Confirmed tool execution failed [${toolName}]`,
        {
          toolName,
          userId: this.userId,
          duration: `${duration}ms`,
          error: errorMessage,
        },
        error instanceof Error ? error : undefined
      );

      return { error: `${toolName} 执行失败: ${errorMessage}`, toolName };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

function findSimilarTools(toolName: string, allTools: string[], maxResults: number = 5): string[] {
  const lowerName = toolName.toLowerCase();
  const scores: Array<{ name: string; score: number }> = [];

  for (const name of allTools) {
    const lowerTarget = name.toLowerCase();
    let score = 0;

    if (lowerTarget === lowerName) {
      score = 100;
    } else if (lowerTarget.includes(lowerName) || lowerName.includes(lowerTarget)) {
      score = 80;
    } else if (
      lowerTarget.split('_').some((part) => lowerName.includes(part)) ||
      lowerName.split('_').some((part) => lowerTarget.includes(part))
    ) {
      score = 60;
    } else {
      const commonChars = [...lowerName].filter((c) => lowerTarget.includes(c)).length;
      score = (commonChars / Math.max(lowerName.length, lowerTarget.length)) * 50;
    }

    if (score > 30) {
      scores.push({ name, score });
    }
  }

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.name);
}

export function getAvailableToolNames(): string[] {
  return Object.keys(TOOL_EXECUTOR_MAP).sort();
}

export function getToolDefinitionByName(toolName: string): (typeof TOOL_DEFINITIONS)[number] | undefined {
  return TOOL_DEFINITIONS.find((def) => def.function.name === toolName);
}

export function getToolsByCategory(): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    '🔍 搜索与发现': [
      'search_files',
      'filter_files',
      'search_by_tag',
      'search_duplicates',
      'smart_search',
      'get_similar_files',
      'get_file_details',
    ],
    '📄 内容理解': [
      'read_file_text',
      'analyze_image',
      'compare_files',
      'extract_metadata',
      'generate_summary',
      'generate_tags',
      'content_preview',
      'analyze_file_collection',
    ],
    '📂 目录导航': [
      'navigate_path',
      'list_folder',
      'get_recent_files',
      'get_starred_files',
      'get_parent_chain',
      'get_folder_tree',
      'get_storage_overview',
    ],
    '📊 统计分析': [
      'get_storage_stats',
      'get_activity_stats',
      'get_user_quota_info',
      'get_file_type_distribution',
      'get_sharing_stats',
    ],
    '📁 文件操作': [
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
    ],
    '🏷️ 标签管理': [
      'add_tag',
      'remove_tag',
      'get_file_tags',
      'list_all_tags_for_management',
      'merge_tags',
      'auto_tag_files',
      'tag_folder',
    ],
    '🔗 分享链接': [
      'create_share_link',
      'list_shares',
      'update_share_settings',
      'revoke_share',
      'get_share_stats',
      'create_direct_link',
      'revoke_direct_link',
      'create_upload_link_for_folder',
    ],
    '📜 版本管理': ['get_file_versions', 'restore_version', 'compare_versions', 'set_version_retention'],
    '📝 笔记备注': ['add_note', 'get_notes', 'update_note', 'delete_note', 'search_notes'],
    '🔐 权限管理': [
      'get_file_permissions',
      'grant_permission',
      'revoke_permission',
      'set_folder_access_level',
      'list_user_groups',
      'manage_group_members',
      'list_expired_permissions',
    ],
    '💾 存储管理': [
      'get_storage_usage',
      'get_large_files',
      'get_folder_sizes',
      'get_cleanup_suggestions',
      'list_buckets',
      'get_bucket_info',
      'set_default_bucket',
      'migrate_file_to_bucket',
    ],
    '⚙️ 系统管理': [
      'get_system_status',
      'get_help',
      'get_version_info',
      'get_faq',
      'get_user_profile',
      'list_api_keys',
      'create_api_key',
      'revoke_api_key',
      'list_webhooks',
      'create_webhook',
      'get_audit_logs',
    ],
    '🤖 AI增强': [
      'trigger_ai_summary',
      'trigger_ai_tags',
      'rebuild_vector_index',
      'ask_rag_question',
      'smart_rename_suggest',
      'smart_organize_suggest',
    ],
  };

  return categories;
}

const REQUIRED_FIELDS = ['name', 'description', 'parameters'] as const;

export function validateToolDefinitions(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const toolNames = new Set<string>();

  for (const def of TOOL_DEFINITIONS) {
    const name = def.function.name;

    if (toolNames.has(name)) {
      warnings.push(`[重复] 工具名重复: ${name}`);
    }
    toolNames.add(name);

    for (const field of REQUIRED_FIELDS) {
      if (!def.function[field]) {
        warnings.push(`[缺失] ${name} 缺少必填字段: ${field}`);
      }
    }

    if (!def.function.parameters || typeof def.function.parameters !== 'object') {
      warnings.push(`[格式] ${name} parameters 格式错误`);
    } else {
      const params = def.function.parameters as Record<string, unknown>;
      if (!params.properties || typeof params.properties !== 'object') {
        warnings.push(`[格式] ${name} parameters 缺少 properties`);
      }
    }

    if (!def.function.description || def.function.description.length < 10) {
      warnings.push(`[描述] ${name} description 过短（<10字符）`);
    }
  }

  const orphanTools = Object.keys(TOOL_EXECUTOR_MAP).filter((n) => !toolNames.has(n));
  if (orphanTools.length > 0) {
    warnings.push(`[孤立] 有执行器但无定义的工具: ${orphanTools.join(', ')}`);
  }

  const orphanDefs = TOOL_DEFINITIONS.filter((d) => !TOOL_EXECUTOR_MAP[d.function.name]);
  if (orphanDefs.length > 0) {
    warnings.push(`[孤立] 有定义但无执行器的工具: ${orphanDefs.map((d) => d.function.name).join(', ')}`);
  }

  if (warnings.length > 0 && process.env.NODE_ENV !== 'production') {
    logger.warn('AgentTools', `工具定义校验完成，发现 ${warnings.length} 个问题`, { warnings });
  }

  return { valid: warnings.filter((w) => w.startsWith('[缺失]')).length === 0, warnings };
}

if (typeof globalThis !== 'undefined' && process.env.NODE_ENV !== 'production') {
  validateToolDefinitions();
}
