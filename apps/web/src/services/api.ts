/**
 * api.ts
 *
 * 统一导出入口（Barrel File）
 *
 * 本文件作为 services 目录的唯一对外导出接口，聚合所有子模块的 API 对象和类型定义。
 * 所有现有导入路径（如 `import { filesApi } from '@/services/api'`）无需修改即可继续使用。
 *
 * 子模块结构：
 * - ./api-client      → axios 实例（默认导出）
 * - ./core            → 核心业务（auth, files[CRUD], tasks, downloads, batch, preview, directLink, fileContent, versions, notes）
 * - ./storage         → 存储管理（buckets, migrate, telegram, analytics, search）
 * - ./collab          → 协作分享（share, permissions, groups, webhooks, notifications）
 * - ./admin           → 管理员功能（用户/注册/统计/审计/邮件/AI追踪/存储审计）
 * - ./api-keys        → API 密钥管理
 * - ./ai              → AI 功能集（核心/config/chatSession/memories）
 * - ./presignUpload   → 预签名上传（presignUpload/proxyUpload/telegramProxy/URL工具）
 */

export { default as api } from './api-client';

export {
  authApi,
  filesApi,
  tasksApi,
  downloadsApi,
  batchApi,
  previewApi,
  directLinkApi,
  fileContentApi,
  versionsApi,
  notesApi,
} from './core';

export type {
  EmailPreferences,
  BucketStats,
  DashboardStats,
  FolderSizeStats,
  FileAccessLogResponse,
  DirectLinkInfo,
  FileNote,
  VersionInfo,
  VersionsListData,
  NoteHistoryResponse,
} from './core';

export { bucketsApi, migrateApi, telegramApi, analyticsApi, searchApi } from './storage';

export type {
  StorageBucket,
  BucketFormData,
  MigrationStatus,
  StorageBreakdown,
  ActivityHeatmapItem,
  ActivityHeatmap,
  LargeFileItem,
  StorageTrendItem,
  StorageTrend,
  BucketStatItem,
} from './storage';

export const { PROVIDER_META } = await import('./storage');

export { shareApi, permissionsApi, groupsApi, webhooksApi, notificationsApi } from './collab';

export type {
  ShareChildFile,
  ShareInfo,
  ShareFolderInfo,
  SharePreviewInfo,
  UploadLinkInfo,
  CreateUploadLinkParams,
  GlobalPermission,
  ResolvedPermission,
  SearchableUser,
  UserGroup,
  GroupMember,
  Webhook,
  WebhookEvent,
  Notification,
} from './collab';

export { adminApi } from './admin';
export { apiKeysApi } from './api-keys';
export { aiApi } from './ai';
export { presignUpload, getPresignedDownloadUrl, getPresignedPreviewUrl } from './presignUpload';
export { MULTIPART_THRESHOLD, PART_SIZE } from './presignUpload';

export type {
  AITraceItem,
  AITraceDetail,
  AdminUser,
  AdminStats,
  RegistrationConfig,
  StorageMismatchItem,
  BucketAuditResult,
  RemediationRecommendation,
  AuditSummary,
  StorageAuditReport,
  MissingFileDetail,
  MissingFileDetailResponse,
} from './admin';

export type { ApiKey } from './api-keys';

export type {
  AIStatus,
  AIFileStatus,
  AISummaryResult,
  AIImageTagResult,
  AIRenameSuggestion,
  AIIndexTask,
  AISummarizeTask,
  AITagsTask,
  AIIndexStats,
  AIIndexDiagnose,
  AIIndexSample,
  VectorItem,
  VectorListResponse,
  AiSystemConfigItem,
  AiModel,
  CreateAiModelParams,
  AiProvider,
  AiProviderItem,
  CreateAiProviderParams,
  AiWorkersAiModel,
  AiOpenAiModel,
  AiConfigStatus,
  AiChatSession,
  AiChatMessage,
  AiChatSessionDetail,
} from './ai';

export default (await import('./api-client')).default;
