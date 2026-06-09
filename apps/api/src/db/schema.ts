/**
 * schema.ts
 * 数据库表结构定义
 *
 * 功能:
 * - 定义所有数据库表结构
 * - 定义表索引和约束
 * - 使用Drizzle ORM的SQLite适配器
 */

import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    role: text('role').default('user').notNull(),
    storageQuota: integer('storage_quota').default(10737418240),
    storageUsed: integer('storage_used').default(0).notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    emailPreferences: text('email_preferences').notNull().default('{}'),
    passwordChangedAt: text('password_changed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    roleIdx: index('idx_users_role').on(table.role),
    createdIdx: index('idx_users_created').on(table.createdAt),
  })
);

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    path: text('path').notNull(),
    type: text('type'),
    size: integer('size').default(0).notNull(),
    r2Key: text('r2_key').notNull(),
    mimeType: text('mime_type'),
    hash: text('hash'),
    isFolder: integer('is_folder', { mode: 'boolean' }).default(false).notNull(),
    allowedMimeTypes: text('allowed_mime_types'),
    refCount: integer('ref_count').default(1).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
    teamId: text('team_id'), // 可空：属于哪个团队的共享空间
    accessLevel: text('access_level'), // 文件夹访问级别: private | team | public_read | public_write
    bucketId: text('bucket_id'),
    directLinkToken: text('direct_link_token').unique(),
    directLinkExpiresAt: text('direct_link_expires_at'),
    currentVersion: integer('current_version').default(1),
    maxVersions: integer('max_versions').default(10),
    versionRetentionDays: integer('version_retention_days').default(30),
    description: text('description'),
    noteCount: integer('note_count').default(0),
    aiSummary: text('ai_summary'),
    aiSummaryAt: text('ai_summary_at'),
    aiTags: text('ai_tags'),
    aiTagsAt: text('ai_tags_at'),
    vectorIndexedAt: text('vector_indexed_at'),
    isStarred: integer('is_starred', { mode: 'boolean' }).default(false),
  },
  (table) => ({
    userParentIdx: index('idx_files_user_parent_active').on(table.userId, table.parentId),
    userDeletedIdx: index('idx_files_user_deleted').on(table.userId, table.deletedAt),
    userTypeIdx: index('idx_files_user_type').on(table.userId, table.type),
    userMimeIdx: index('idx_files_user_mime').on(table.userId, table.mimeType),
    userCreatedIdx: index('idx_files_user_created').on(table.userId, table.createdAt),
    userUpdatedIdx: index('idx_files_user_updated').on(table.userId, table.updatedAt),
    userSizeIdx: index('idx_files_user_size').on(table.userId, table.size),
    hashIdx: index('idx_files_hash').on(table.hash),
    directLinkTokenIdx: index('idx_files_direct_link_token').on(table.directLinkToken),
    vectorIndexedIdx: index('idx_files_vector_indexed').on(table.userId, table.vectorIndexedAt),
    aiSummaryIdx: index('idx_files_ai_summary').on(table.userId, table.aiSummaryAt),
    aiTagsIdx: index('idx_files_ai_tags').on(table.userId, table.aiTagsAt),
    isStarredIdx: index('idx_files_is_starred').on(table.userId, table.isStarred, table.updatedAt),
    teamIdx: index('idx_files_team').on(table.teamId),
  })
);

export const shares = sqliteTable(
  'shares',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    password: text('password'),
    expiresAt: text('expires_at'),
    downloadLimit: integer('download_limit'),
    downloadCount: integer('download_count').default(0).notNull(),
    isUploadLink: integer('is_upload_link', { mode: 'boolean' }).default(false).notNull(),
    uploadToken: text('upload_token').unique(),
    maxUploadSize: integer('max_upload_size'),
    uploadAllowedMimeTypes: text('upload_allowed_mime_types'),
    maxUploadCount: integer('max_upload_count'),
    uploadCount: integer('upload_count').default(0).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    expiresIdx: index('idx_shares_expires').on(table.expiresAt),
    userCreatedIdx: index('idx_shares_user_created').on(table.userId, table.createdAt),
    fileActiveIdx: index('idx_shares_file_active').on(table.fileId, table.expiresAt),
    uploadTokenIdx: index('idx_shares_upload_token').on(table.uploadToken),
    uploadLinkIdx: index('idx_shares_upload_link').on(table.userId, table.isUploadLink),
  })
);

export const storageBuckets = sqliteTable(
  'storage_buckets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    bucketName: text('bucket_name').notNull(),
    endpoint: text('endpoint'),
    region: text('region'),
    accessKeyId: text('access_key_id').notNull(),
    secretAccessKey: text('secret_access_key').notNull(),
    pathStyle: integer('path_style', { mode: 'boolean' }).default(false).notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).default(false).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    storageUsed: integer('storage_used').default(0).notNull(),
    fileCount: integer('file_count').default(0).notNull(),
    storageQuota: integer('storage_quota'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userActiveIdx: index('idx_buckets_user_active').on(table.userId, table.isActive),
    providerIdx: index('idx_buckets_provider').on(table.provider),
    // 注意：每用户只允许一个默认桶由业务层保证（设置新默认桶前先清除旧默认），
    // 此处用普通索引以允许用户拥有多个存储桶记录
    userDefaultIdx: index('idx_storage_buckets_user_default').on(table.userId, table.isDefault),
  })
);

export const fileTags = sqliteTable(
  'file_tags',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').default('#6366f1'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    fileIdx: index('idx_file_tags_file').on(table.fileId),
    userNameIdx: index('idx_file_tags_user_name').on(table.userId, table.name),
    uniqueIdx: uniqueIndex('idx_file_tags_unique').on(table.fileId, table.name),
  })
);

export const userGroups = sqliteTable(
  'user_groups',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    ownerIdx: index('idx_user_groups_owner').on(table.ownerId),
  })
);

export const groupMembers = sqliteTable(
  'group_members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    addedBy: text('added_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_group_members_user').on(table.userId),
    groupIdx: index('idx_group_members_group').on(table.groupId),
    uniqueIdx: uniqueIndex('idx_group_members_unique').on(table.groupId, table.userId),
  })
);

export const filePermissions = sqliteTable(
  'file_permissions',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull().default('read'),
    grantedBy: text('granted_by')
      .notNull()
      .references(() => users.id),
    subjectType: text('subject_type').notNull().default('user'),
    groupId: text('group_id').references(() => userGroups.id, { onDelete: 'cascade' }),
    teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at'),
    inheritToChildren: integer('inherit_to_children', { mode: 'boolean' }).notNull().default(true),
    scope: text('scope').notNull().default('explicit'),
    sourcePermissionId: text('source_permission_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    fileIdx: index('idx_file_permissions_file').on(table.fileId),
    userIdx: index('idx_file_permissions_user').on(table.userId),
    groupIdx: index('idx_file_permissions_group').on(table.groupId),
    teamIdx: index('idx_file_permissions_team').on(table.teamId),
    expiresIdx: index('idx_file_permissions_expires').on(table.expiresAt),
    scopeIdx: index('idx_file_permissions_scope').on(table.scope),
    uniqueUserIdx: uniqueIndex('idx_file_permissions_unique_user').on(table.fileId, table.userId),
    uniqueGroupIdx: uniqueIndex('idx_file_permissions_unique_group').on(table.fileId, table.groupId),
  })
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    details: text('details'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    status: text('status').default('success'),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_audit_logs_user').on(table.userId, table.createdAt),
    actionIdx: index('idx_audit_logs_action').on(table.action, table.createdAt),
    resourceIdx: index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
    createdIdx: index('idx_audit_logs_created').on(table.createdAt),
  })
);

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    ipAddress: text('ip_address').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull().default(false),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    emailIdx: index('idx_login_attempts_email').on(table.email, table.createdAt),
    ipIdx: index('idx_login_attempts_ip').on(table.ipAddress, table.createdAt),
  })
);

export const userDevices = sqliteTable(
  'user_devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name'),
    deviceType: text('device_type'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    lastActive: text('last_active').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_user_devices_user').on(table.userId),
    uniqueIdx: uniqueIndex('idx_user_devices_unique').on(table.userId, table.deviceId),
  })
);

export const uploadTasks = sqliteTable(
  'upload_tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: text('mime_type'),
    parentId: text('parent_id'),
    bucketId: text('bucket_id'),
    teamId: text('team_id'),
    r2Key: text('r2_key').notNull(),
    uploadId: text('upload_id').notNull(),
    totalParts: integer('total_parts').notNull(),
    uploadedParts: text('uploaded_parts').default('[]'),
    status: text('status').default('pending'),
    progress: integer('progress').default(0),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_upload_tasks_user').on(table.userId, table.status),
    expiresIdx: index('idx_upload_tasks_expires').on(table.expiresAt),
  })
);

export const downloadTasks = sqliteTable(
  'download_tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    fileName: text('file_name'),
    fileSize: integer('file_size'),
    parentId: text('parent_id'),
    bucketId: text('bucket_id'),
    status: text('status').default('pending'),
    progress: integer('progress').default(0),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => ({
    userIdx: index('idx_download_tasks_user').on(table.userId, table.status),
    statusIdx: index('idx_download_tasks_status').on(table.status, table.createdAt),
  })
);

export const telegramFileRefs = sqliteTable(
  'telegram_file_refs',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id').notNull(),
    r2Key: text('r2_key').notNull().unique(),
    tgFileId: text('tg_file_id').notNull(),
    tgFileSize: integer('tg_file_size'),
    bucketId: text('bucket_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    r2KeyIdx: index('idx_tg_refs_r2key').on(table.r2Key),
    fileIdIdx: index('idx_tg_refs_file_id').on(table.fileId),
    bucketIdx: index('idx_tg_refs_bucket').on(table.bucketId),
  })
);

export const telegramFileChunks = sqliteTable(
  'telegram_file_chunks',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    tgFileId: text('tg_file_id').notNull(),
    chunkSize: integer('chunk_size').notNull(),
    bucketId: text('bucket_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    groupIdx: index('idx_tg_chunks_group').on(table.groupId, table.chunkIndex),
  })
);

export type DbType = typeof import('./index').getDb;

export const searchHistory = sqliteTable(
  'search_history',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userCreatedIdx: index('idx_search_history_user').on(table.userId, table.createdAt),
  })
);

export const fileVersions = sqliteTable(
  'file_versions',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    r2Key: text('r2_key').notNull(),
    size: integer('size').default(0).notNull(),
    mimeType: text('mime_type'),
    hash: text('hash'),
    refCount: integer('ref_count').default(1).notNull(),
    changeSummary: text('change_summary'),
    aiChangeSummary: text('ai_change_summary'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    fileCreatedIdx: index('idx_file_versions_file').on(table.fileId, table.createdAt),
    hashIdx: index('idx_file_versions_hash').on(table.hash),
    uniqueVersionIdx: uniqueIndex('idx_file_versions_unique').on(table.fileId, table.version),
  })
);

export const fileNotes = sqliteTable(
  'file_notes',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    contentHtml: text('content_html'),
    isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
    version: integer('version').notNull().default(1),
    parentId: text('parent_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    fileDeletedIdx: index('idx_file_notes_file').on(table.fileId, table.deletedAt, table.createdAt),
    userIdx: index('idx_file_notes_user').on(table.userId, table.createdAt),
    pinnedIdx: index('idx_file_notes_pinned').on(table.fileId, table.isPinned),
  })
);

export const fileNoteHistory = sqliteTable(
  'file_note_history',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id')
      .notNull()
      .references(() => fileNotes.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    version: integer('version').notNull(),
    editedBy: text('edited_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    noteVersionIdx: index('idx_file_note_history_note').on(table.noteId, table.version),
  })
);

export const noteMentions = sqliteTable(
  'note_mentions',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id')
      .notNull()
      .references(() => fileNotes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_note_mentions_user').on(table.userId, table.isRead),
    noteIdx: index('idx_note_mentions_note').on(table.noteId),
  })
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    scopes: text('scopes').notNull(),
    lastUsedAt: text('last_used_at'),
    expiresAt: text('expires_at'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_api_keys_user').on(table.userId, table.isActive),
    prefixIdx: index('idx_api_keys_prefix').on(table.keyPrefix),
    hashIdx: index('idx_api_keys_hash').on(table.keyHash),
  })
);

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: text('events').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastStatus: integer('last_status'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_webhooks_user').on(table.userId, table.isActive),
  })
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    data: text('data'),
    isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_notifications_user').on(table.userId, table.isRead, table.createdAt),
    typeIdx: index('idx_notifications_type').on(table.type),
  })
);

export const emailTokens = sqliteTable(
  'email_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    type: text('type').notNull(),
    code: text('code').notNull(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_email_tokens_user').on(table.userId, table.type),
    expiresIdx: index('idx_email_tokens_expires').on(table.expiresAt),
    codeIdx: index('idx_email_tokens_code').on(table.email, table.code, table.type),
  })
);

export const userStars = sqliteTable(
  'user_stars',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    uniqueIdx: uniqueIndex('idx_user_stars_unique').on(table.userId, table.fileId),
    userIdx: index('idx_user_stars_user').on(table.userId),
    fileIdIdx: index('idx_user_stars_file').on(table.fileId),
  })
);

export const aiProviders = sqliteTable(
  'ai_providers',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    apiEndpoint: text('api_endpoint'),
    description: text('description'),
    thinkingConfig: text('thinking_config'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userActiveIdx: index('idx_ai_providers_user_active').on(table.userId, table.isActive),
    userDefaultIdx: index('idx_ai_providers_user_default').on(table.userId, table.isDefault),
    systemIdx: index('idx_ai_providers_system').on(table.isSystem),
  })
);

export const aiModels = sqliteTable(
  'ai_models',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').references(() => aiProviders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('workers_ai'),
    modelId: text('model_id').notNull(),
    apiEndpoint: text('api_endpoint'),
    apiKeyEncrypted: text('api_key_encrypted'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    capabilities: text('capabilities').notNull().default('["chat","completion"]'),
    temperature: real('temperature').default(0.7),
    systemPrompt: text('system_prompt'),
    configJson: text('config_json').default('{}'),
    supportsThinking: integer('supports_thinking', { mode: 'boolean' }).default(false),
    thinkingParamFormat: text('thinking_param_format'),
    thinkingParamName: text('thinking_param_name'),
    thinkingEnabledValue: text('thinking_enabled_value'),
    thinkingDisabledValue: text('thinking_disabled_value'),
    thinkingNestedKey: text('thinking_nested_key'),
    disableThinkingForFeatures: text('disable_thinking_for_features').default(
      '["image_caption","image_tag","image_analysis","file_summary"]'
    ),
    isReadonly: integer('is_readonly', { mode: 'boolean' }).default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userActiveIdx: index('idx_ai_models_user_active').on(table.userId, table.isActive),
    userProviderIdx: index('idx_ai_models_user_provider').on(table.userId, table.provider),
    providerIdx: index('idx_ai_models_provider').on(table.providerId),
  })
);

export const aiChatSessions = sqliteTable(
  'ai_chat_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('新对话'),
    modelId: text('model_id'),
    lastToolCallCount: integer('last_tool_call_count').default(0),
    totalTokensUsed: integer('total_tokens_used').default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userUpdatedIdx: index('idx_chat_sessions_user_updated').on(table.userId, table.updatedAt),
  })
);

export const aiChatMessages = sqliteTable(
  'ai_chat_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => aiChatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    sources: text('sources'),
    modelUsed: text('model_used'),
    latencyMs: integer('latency_ms'),
    toolCalls: text('tool_calls'),
    reasoning: text('reasoning'),
    inputTokens: integer('input_tokens').default(0),
    outputTokens: integer('output_tokens').default(0),
    aborted: integer('aborted', { mode: 'boolean' }).default(false),
    mentionedFiles: text('mentioned_files'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    sessionCreatedIdx: index('idx_chat_messages_session_created').on(table.sessionId, table.createdAt),
  })
);

export type AiModel = typeof aiModels.$inferSelect;
export type AiChatSession = typeof aiChatSessions.$inferSelect;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;

export const aiConfirmRequests = sqliteTable(
  'ai_confirm_requests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id'),
    toolName: text('tool_name').notNull(),
    args: text('args').notNull(),
    summary: text('summary').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => ({
    userStatusIdx: index('idx_confirm_user_status').on(table.userId, table.status),
    expiresIdx: index('idx_confirm_expires').on(table.expiresAt),
  })
);

export type AiConfirmRequest = typeof aiConfirmRequests.$inferSelect;

export const aiTasks = sqliteTable(
  'ai_tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(), // 'index' | 'summary' | 'tags'
    status: text('status').notNull().default('running'), // 'running' | 'completed' | 'failed' | 'cancelled'
    total: integer('total').notNull(),
    processed: integer('processed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    startedAt: text('started_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    error: text('error'),
  },
  (table) => ({
    userTypeIdx: index('idx_ai_tasks_user_type').on(table.userId, table.type),
    statusIdx: index('idx_ai_tasks_status').on(table.status),
  })
);

export type AiTask = typeof aiTasks.$inferSelect;

export const aiConfig = sqliteTable(
  'ai_config',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    category: text('category').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    valueType: text('value_type').notNull().default('string'),
    stringValue: text('string_value'),
    numberValue: real('number_value'),
    booleanValue: integer('boolean_value', { mode: 'boolean' }).default(false),
    jsonValue: text('json_value'),
    defaultValue: text('default_value').notNull(),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(true),
    isEditable: integer('is_editable', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    categoryIdx: index('idx_ai_config_category').on(table.category),
    keyIdx: index('idx_ai_config_key').on(table.key),
  })
);

export type AiConfig = typeof aiConfig.$inferSelect;
export type File = typeof files.$inferSelect;

export const aiMemories = sqliteTable(
  'ai_memories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    type: text('type').notNull().default('operation'),
    summary: text('summary').notNull(),
    embeddingId: text('embedding_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userCreatedIdx: index('idx_memories_user_created').on(table.userId, table.createdAt),
    userTypeIdx: index('idx_memories_user_type').on(table.userId, table.type),
  })
);

export type AiMemory = typeof aiMemories.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// 团队协作相关表
// ═══════════════════════════════════════════════════════════════════════════

export const teams = sqliteTable(
  'teams',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    settings: text('settings').default('{}'),
    storageQuota: integer('storage_quota').default(5368709120),
    storageUsed: integer('storage_used').default(0).notNull(),
    defaultMemberRole: text('default_member_role').default('member'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    ownerIdx: index('idx_teams_owner').on(table.ownerId),
  })
);

export const teamMembers = sqliteTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    addedBy: text('added_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userIdx: index('idx_team_members_user').on(table.userId),
    teamIdx: index('idx_team_members_team').on(table.teamId),
    uniqueIdx: uniqueIndex('idx_team_members_unique').on(table.teamId, table.userId),
  })
);

export const teamResources = sqliteTable(
  'team_resources',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    mountedBy: text('mounted_by')
      .notNull()
      .references(() => users.id),
    mountedAt: text('mounted_at').notNull(),
    /** 挂载目标文件夹ID（NULL=根目录） */
    targetFolderId: text('target_folder_id'),
  },
  (table) => ({
    teamIdx: index('idx_team_resources_team').on(table.teamId),
    fileIdx: index('idx_team_resources_file').on(table.fileId),
    uniqueIdx: uniqueIndex('idx_team_resources_unique').on(table.teamId, table.fileId),
  })
);

export const permissionRequests = sqliteTable(
  'permission_requests',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetTeamId: text('target_team_id').references(() => teams.id, { onDelete: 'set null' }),
    requestedPermission: text('requested_permission').notNull().default('read'),
    reason: text('reason'),
    status: text('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by').references(() => users.id),
    reviewedAt: text('reviewed_at'),
    reviewComment: text('review_comment'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    requesterIdx: index('idx_permission_requests_requester').on(table.requesterId),
    statusIdx: index('idx_permission_requests_status').on(table.status),
    fileIdx: index('idx_permission_requests_file').on(table.fileId),
    targetTeamIdx: index('idx_permission_requests_target_team').on(table.targetTeamId),
  })
);

// 团队邀请表 — 支持链接邀请 + 邮件邀请
export const teamInvitations = sqliteTable(
  'team_invitations',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteToken: text('invite_token').notNull().unique(),
    inviteCode: text('invite_code').unique(),
    email: text('email'),
    role: text('role').notNull().default('member'),
    message: text('message'),
    expiresAt: text('expires_at'),
    acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: text('accepted_at'),
    status: text('status').notNull().default('pending'), // pending | accepted | expired | revoked
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    teamIdx: index('idx_team_invitations_team').on(table.teamId),
    tokenIdx: index('idx_team_invitations_token').on(table.inviteToken),
    statusIdx: index('idx_team_invitations_status').on(table.status),
    expiresIdx: index('idx_team_invitations_expires').on(table.expiresAt),
  })
);

// 团队活动流表 — 记录团队内操作审计
export const teamActivities = sqliteTable(
  'team_activities',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    details: text('details'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    teamIdx: index('idx_team_activities_team').on(table.teamId, table.createdAt),
    userIdx: index('idx_team_activities_user').on(table.userId),
    actionIdx: index('idx_team_activities_action').on(table.action),
  })
);

export const roleTemplates = sqliteTable('role_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  permissions: text('permissions').notNull().default('[]'),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  description: text('description'),
  createdAt: text('created_at').notNull(),
});
