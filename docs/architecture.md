# OSSshelf 架构文档

本文档基于项目实际代码，详细描述 OSSshelf 的系统架构、数据库设计和核心功能实现。

**当前版本**: v4.0.0

---

## 📋 目录

- [系统概述](#系统概述)
- [版本更新](#版本更新)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [数据库设计](#数据库设计)
- [系统常量](#系统常量)
- [API 路由](#api-路由)
- [核心功能架构](#核心功能架构)
- [认证机制](#认证机制)
- [邮件通知系统](#邮件通知系统)
- [定时任务](#定时任务)
- [安全措施](#安全措施)

---

## 系统概述

OSSshelf 是一个基于 Cloudflare 部署的多厂商 OSS 文件管理系统，支持 WebDAV 协议。系统采用前后端分离架构：

- **前端**: React + Vite + Tailwind CSS
- **后端**: Hono 框架运行在 Cloudflare Workers 上
- **数据库**: Cloudflare D1 (SQLite) + Drizzle ORM
- **存储**: S3 兼容协议 + Telegram Bot API
- **邮件**: Resend API（v4.0.0+）

---

## 版本更新

详细的版本更新日志请参阅 [CHANGELOG.md](../CHANGELOG.md)。

### v4.0.0 (2026-04-02)

**核心功能 - 邮件通知系统**

1. **注册邮箱验证**
   - 新用户注册后自动发送验证邮件
   - 邮箱验证链接有效期24小时
   - 首个注册用户（管理员）自动验证
   - 未验证用户显示提示横幅

2. **密码重置流程**
   - 忘记密码邮件重置功能
   - 重置链接有效期1小时
   - 防邮箱枚举攻击

3. **邮箱更换功能**
   - 更换邮箱需要验证新邮箱
   - 更换确认链接有效期1小时
   - 旧邮箱收到更换成功通知

4. **邮件偏好设置**
   - 用户可自定义邮件通知偏好
   - 支持5种通知类型：@提及、分享接收、配额警告、AI完成、系统通知

5. **管理面板邮件配置**
   - Resend API 配置界面
   - 发件人地址和名称设置
   - 发送测试邮件功能
   - 群发系统公告

**安全增强**

1. **JWT失效机制**
   - 密码修改后自动更新 `passwordChangedAt`
   - 密码重置后自动更新 `passwordChangedAt`
   - 登录时检查JWT是否失效

2. **Token安全**
   - Token使用SHA-256哈希存储
   - Token一次性使用机制
   - Token过期时间控制
   - 重发验证邮件限流

**数据库变更**

- 新增迁移文件 0018_email.sql
  - 新增 `email_tokens` 表
  - `users` 表新增 `email_verified` 字段
  - `users` 表新增 `email_preferences` 字段
  - `users` 表新增 `password_changed_at` 字段

### v3.8.0 (2026-04-02)

**新功能**

1. **收藏夹功能**
   - 快速收藏/取消收藏文件和文件夹
   - 侧边栏「收藏」入口，快捷访问收藏文件
   - 文件列表支持收藏图标显示
   - API: POST/DELETE /api/files/:id/star

2. **存储分析 Dashboard**
   - 存储空间分布统计（按文件类型、MIME 类型）
   - 活跃度热力图（上传/下载/删除活动统计）
   - 大文件排行 Top 20
   - 存储趋势分析（按天统计上传量）
   - 存储桶统计
   - API: GET /api/analytics/*

3. **通知系统**
   - 实时通知铃铛（PC端侧边栏底部、移动端顶部栏）
   - 通知列表弹窗（向上/向下展开自适应）
   - 支持已读/未读状态管理
   - 支持全部标记已读、删除通知
   - 通知类型：share_received、mention、permission_granted、ai_complete、system
   - API: GET /api/notifications, PUT /api/notifications/:id/read, DELETE /api/notifications/:id

4. **FTS5 全文搜索**
   - 基于 SQLite FTS5 的全文搜索引擎
   - 支持 unicode61 中文分词
   - 搜索文件名、描述、AI 摘要
   - 前端搜索栏 FTS5 开关（桌面端 + 移动端）

**数据库变更**

- 新增迁移文件 0015_notifications.sql（notifications 表）
- 新增迁移文件 0016_fts5.sql（files_fts 虚拟表）

### v3.7.0 (2026-04-01)

**新功能**

1. **AI 功能集成（基于 Cloudflare AI）**
   - 文件摘要生成：自动为文本文件生成内容摘要（Llama 3.1 8B）
   - 图片智能描述：自动识别图片内容并生成描述（LLaVA 1.5 7B）
   - 图片标签生成：使用 ResNet-50 模型自动生成图片标签
   - 智能重命名建议：根据文件内容智能推荐文件名
   - 语义搜索：基于 Vectorize 实现语义相似文件搜索（BGE-M3 模型）
   - 向量索引管理：批量索引、增量索引、索引状态查询

2. **移动端页面排版优化**
   - 新增移动端底部操作栏（MobileFilesToolbar）
   - 新增移动端搜索面板（MobileSearchPanel）
   - 优化移动端底部导航（MobileBottomNav）
   - 改进视图切换、排序、浮动操作按钮交互
   - 增强移动端触摸体验和响应式布局

3. **预览组件拆分重构**
   - 将 FilePreview 拆分为独立预览组件
   - 新增 filepreview 目录，包含 12 个独立预览组件
   - ImagePreview、VideoPreview、AudioPreview
   - PdfPreview、MarkdownPreview、CodePreview
   - OfficePreview、CsvPreview、ZipPreview
   - FontPreview、EpubPreview
   - 新增 previewUtils 工具函数

**数据库变更**

- files 表新增 ai_summary、ai_summary_at 字段
- files 表新增 ai_tags、ai_tags_at 字段
- files 表新增 vector_indexed_at 字段
- files 表新增 is_starred 字段
- 新增迁移文件 0014_ai_features.sql

### v3.6.0 (2026-03-31)

**新功能**

1. **权限系统 v2**
   - 用户组管理：创建和管理用户组
   - 组成员管理：添加/移除成员，设置管理员角色
   - 权限继承：子文件自动继承父文件夹权限
   - 时效性权限：支持设置权限过期时间
   - 递归 CTE 权限解析：高效查询权限继承链
   - KV 权限缓存：减少数据库查询

2. **RESTful v1 API**
   - 标准化 API 接口设计
   - OpenAPI 3.1.0 文档自动生成
   - Swagger UI 交互式文档
   - API Key 认证支持

3. **Webhook 通知**
   - 文件事件订阅（上传、删除、更新等）
   - HMAC-SHA256 签名验证
   - Webhook 管理界面

### v3.5.0 (2026-03-30)

**新功能**

1. **API Keys 管理**
   - 支持创建、管理 API 密钥，实现程序化访问
   - 支持 6 种权限范围：文件读取、文件写入、分享读取、分享管理、存储桶查看、API Keys 管理
   - 支持设置密钥过期时间
   - 完整的 API Key 使用文档

2. **文件笔记面板**
   - 为文件添加评论和笔记
   - 支持 @提及其他用户
   - 支持笔记回复（嵌套评论）
   - 支持删除笔记和回复

3. **文件编辑功能**
   - 直接在系统内创建和编辑文本文件
   - 支持多种文本格式（代码、配置文件、Markdown 等）
   - 编辑时自动创建版本快照

**功能变更**

1. **文件版本控制重构**
   - 仅支持可编辑的文本文件类型（代码、配置、Markdown 等）
   - 图片、视频、音频等二进制文件不再支持版本控制
   - 版本存储优化：每次编辑生成独立的存储路径，确保历史版本内容不被覆盖
   - 版本恢复功能修复：正确恢复到指定版本内容

### v3.4.0 (2026-03-27)

**新功能**

1. **预览功能大幅强化**
   - 预览大小限制从 10MB 提升至 30MB
   - 新增 EPUB 电子书预览（目录导航、翻页、键盘快捷键）
   - 新增字体文件预览（TTF/OTF/WOFF/WOFF2）
   - 新增 ZIP 压缩包内容列表预览
   - CSV 表格增强预览（搜索、排序、分页）
   - PowerPoint 幻灯片本地预览
   - PDF 分页预览与缩放控制
   - Excel 多工作表切换与样式保留

2. **预览组件优化**
   - 预览窗口大小控制（小/中/大/全屏）
   - 统一预览类型配置（previewTypes.ts）

### v3.3.0 (2026-03-24)

**新功能**

1. **错误码统一管理**
   - 所有 API 错误响应采用统一错误码体系
   - 错误码定义于 `packages/shared/src/constants/errorCodes.ts`
   - 支持错误码国际化

2. **预览功能增强**
   - 增强 Markdown 文件预览
   - 新增 Excel 文件预览

3. **文件版本控制**
   - 支持文件历史版本管理
   - 支持版本回滚和对比
   - 支持版本备注和标签
   - 新增 `file_versions` 数据库表

---

## 技术栈

### 前端 (apps/web)

| 技术               | 说明        |
| ------------------ | ----------- |
| React 18           | UI 框架     |
| Vite 5             | 构建工具    |
| React Router DOM 6 | 路由        |
| Zustand 4          | 状态管理    |
| TanStack Query 5   | 数据请求    |
| Axios              | HTTP 客户端 |
| Radix UI           | UI 组件     |
| Tailwind CSS 3     | 样式        |
| Lucide React       | 图标        |

### 后端 (apps/api)

| 技术               | 说明     |
| ------------------ | -------- |
| Hono 4             | Web 框架 |
| Cloudflare Workers | 运行时   |
| Cloudflare AI      | AI 服务  |
| Vectorize          | 向量搜索 |
| Drizzle ORM 0.29   | ORM      |
| Zod 3              | 验证     |
| bcrypt             | 密码哈希 |

### 共享包 (packages/shared)

| 技术     | 说明     |
| -------- | -------- |
| tsup     | 构建工具 |
| 常量定义 | 系统常量 |
| 类型定义 | 共享类型 |

---

## 项目结构

```
ossshelf/
├── apps/
│   ├── api/                        # 后端 API 服务
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── index.ts        # 数据库连接
│   │   │   │   └── schema.ts       # 表结构定义
│   │   │   ├── lib/
│   │   │   │   ├── audit.ts        # 审计日志
│   │   │   │   ├── bucketResolver.ts   # 存储桶解析
│   │   │   │   ├── cleanup.ts      # 清理任务
│   │   │   │   ├── crypto.ts       # 加密工具
│   │   │   │   ├── dedup.ts        # 文件去重
│   │   │   │   ├── folderPolicy.ts # 文件夹策略
│   │   │   │   ├── s3client.ts     # S3 客户端
│   │   │   │   ├── telegramClient.ts   # Telegram 客户端
│   │   │   │   ├── telegramChunked.ts  # Telegram 分片上传
│   │   │   │   ├── utils.ts        # 工具函数
│   │   │   │   ├── versionManager.ts # 版本管理 (v3.5.0 重构)
│   │   │   │   ├── permissionResolver.ts # 权限解析 (v3.6.0)
│   │   │   │   ├── webhook.ts   # Webhook 分发 (v3.6.0)
│   │   │   │   ├── aiFeatures.ts # AI 功能 (v3.7.0)
│   │   │   │   ├── vectorIndex.ts # 向量索引 (v3.7.0)
│   │   │   │   └── zipStream.ts # ZIP 流式打包
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts         # 认证中间件
│   │   │   │   ├── error.ts        # 错误处理
│   │   │   │   └── index.ts        # 中间件导出
│   │   │   ├── routes/
│   │   │   │   ├── admin.ts        # 管理员接口
│   │   │   │   ├── apiKeys.ts      # API Keys 管理 (v3.5.0)
│   │   │   │   ├── auth.ts         # 认证接口
│   │   │   │   ├── batch.ts        # 批量操作
│   │   │   │   ├── buckets.ts      # 存储桶管理
│   │   │   │   ├── cron.ts         # 定时任务
│   │   │   │   ├── directLink.ts   # 文件直链
│   │   │   │   ├── downloads.ts    # 离线下载
│   │   │   │   ├── files.ts        # 文件管理
│   │   │   │   ├── migrate.ts      # 存储桶迁移
│   │   │   │   ├── notes.ts        # 文件笔记 (v3.5.0)
│   │   │   │   ├── permissions.ts  # 权限管理
│   │   │   │   ├── presign.ts      # 预签名 URL
│   │   │   │   ├── preview.ts      # 文件预览
│   │   │   │   ├── search.ts       # 文件搜索（支持 FTS5）
│   │   │   │   ├── share.ts        # 文件分享
│   │   │   │   ├── tasks.ts        # 上传任务
│   │   │   │   ├── telegram.ts     # Telegram 存储
│   │   │   │   ├── versions.ts     # 版本控制 (v3.3.0)
│   │   │   │   ├── webhooks.ts  # Webhook 管理 (v3.6.0)
│   │   │   │   ├── ai.ts        # AI 功能 (v3.7.0)
│   │   │   │   ├── analytics.ts # 存储分析 (v3.8.0)
│   │   │   │   ├── notifications.ts # 通知系统 (v3.8.0)
│   │   │   │   └── webdav.ts    # WebDAV 协议
│   │   │   ├── types/
│   │   │   │   ├── env.ts          # 环境变量类型
│   │   │   │   └── index.ts        # 类型导出
│   │   │   └── index.ts            # 入口文件
│   │   ├── migrations/             # 数据库迁移
│   │   │   ├── 0001_init.sql
│   │   │   ├── 0002_optimization.sql
│   │   │   ├── 0003_folder_upload_types.sql
│   │   │   ├── 0004_telegram_storage.sql
│   │   │   ├── 0005_dedup_and_upload_links.sql
│   │   │   ├── 0006_upload_progress.sql
│   │   │   ├── 0007_phase7.sql
│   │   │   ├── 0008_direct_link.sql
│   │   │   ├── 0009_file_versions.sql  # 文件版本控制 (v3.3.0)
│   │   │   ├── 0010_notes.sql       # 文件笔记 (v3.5.0)
│   │   │   ├── 0011_api_keys.sql    # API Keys (v3.5.0)
│   │   │   ├── 0012_permission_v2.sql # 权限系统 v2 (v3.6.0)
│   │   │   ├── 0014_ai_features.sql # AI 功能 (v3.7.0)
│   │   │   ├── 0015_notifications.sql # 通知系统 (v3.8.0)
│   │   │   ├── 0016_fts5.sql        # FTS5 全文搜索 (v3.8.0)
│   │   │   └── 0018_email.sql       # 邮件通知系统 (v4.0.0)
│   │   ├── drizzle.config.ts
│   │   ├── wrangler.toml.example
│   │   └── package.json
│   └── web/                        # 前端应用
│       ├── src/
│       │   ├── components/         # UI 组件
│       │   │   ├── ai/             # AI 组件 (v3.7.0)
│       │   │   ├── editor/         # 文件编辑器 (v3.5.0)
│       │   │   ├── notes/          # 文件笔记 (v3.5.0)
│       │   │   ├── groups/         # 用户组 (v3.6.0)
│       │   │   ├── webhooks/       # Webhook (v3.6.0)
│       │   │   ├── permissions/    # 权限管理 (v3.6.0)
│       │   │   ├── analytics/      # 存储分析 (v3.8.0)
│       │   │   ├── notifications/  # 通知系统 (v3.8.0)
│       │   │   ├── files/          # 文件组件
│       │   │   │   ├── filepreview/ # 预览组件 (v3.7.0 拆分)
│       │   │   └── settings/       # 设置组件
│       │   ├── hooks/              # 自定义 Hooks
│       │   ├── pages/              # 页面组件
│       │   ├── services/           # API 服务
│       │   ├── stores/             # Zustand 状态
│       │   └── main.tsx
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── package.json
├── packages/
│   └── shared/                     # 共享代码
│       ├── src/
│       │   ├── constants/
│       │   │   ├── index.ts        # 常量定义
│       │   │   ├── errorCodes.ts   # 错误码定义
│       │   │   └── previewTypes.ts # 预览类型配置
│       │   ├── types/
│       │   │   └── index.ts        # 类型定义
│       │   └── utils/
│       │       └── mimeTypes.ts    # MIME 类型工具
│       ├── tsup.config.ts
│       └── package.json
└── docs/
    ├── api.md
    ├── api-key-guide.md            # API Key 使用指南 (v3.5.0)
    ├── architecture.md
    └── deployment.md
```

---

## 数据库设计

### 表结构（定义于 `apps/api/src/db/schema.ts`）

#### users (用户表)

| 字段           | 类型    | 默认值      | 说明              |
| -------------- | ------- | ----------- | ----------------- |
| `id`           | TEXT    | -           | 主键              |
| `email`        | TEXT    | -           | 邮箱 (唯一)       |
| `passwordHash` | TEXT    | -           | 密码哈希          |
| `name`         | TEXT    | -           | 昵称              |
| `role`         | TEXT    | 'user'      | 角色 (user/admin) |
| `storageQuota` | INTEGER | 10737418240 | 存储配额 (10GB)   |
| `storageUsed`  | INTEGER | 0           | 已用空间          |
| `emailVerified`| BOOLEAN | false       | 邮箱验证状态 (v4.0.0) |
| `emailPreferences` | TEXT | '{}'      | 邮件偏好设置 (JSON) (v4.0.0) |
| `passwordChangedAt` | TEXT | -        | 密码变更时间 (v4.0.0) |
| `createdAt`    | TEXT    | -           | 创建时间          |
| `updatedAt`    | TEXT    | -           | 更新时间          |

**索引**: `idx_users_role`, `idx_users_created`

#### email_tokens (邮件Token表) - v4.0.0

| 字段        | 类型    | 默认值 | 说明                         |
| ----------- | ------- | ------ | ---------------------------- |
| `id`        | TEXT    | -      | 主键                         |
| `userId`    | TEXT    | -      | 用户ID (外键 → users)        |
| `email`     | TEXT    | -      | 关联邮箱                     |
| `type`      | TEXT    | -      | Token类型 (verify_email/reset_password/change_email) |
| `tokenHash` | TEXT    | -      | Token哈希 (SHA-256)          |
| `expiresAt` | TEXT    | -      | 过期时间                     |
| `usedAt`    | TEXT    | -      | 使用时间 (可空)              |
| `createdAt` | TEXT    | -      | 创建时间                     |

**索引**: `idx_email_tokens_hash`, `idx_email_tokens_user`

#### files (文件表)

| 字段                  | 类型    | 默认值 | 说明                    |
| --------------------- | ------- | ------ | ----------------------- |
| `id`                  | TEXT    | -      | 主键                    |
| `userId`              | TEXT    | -      | 所属用户 (外键 → users) |
| `parentId`            | TEXT    | -      | 父文件夹 ID             |
| `name`                | TEXT    | -      | 文件名                  |
| `path`                | TEXT    | -      | 文件路径                |
| `type`                | TEXT    | -      | 文件类型                |
| `size`                | INTEGER | 0      | 文件大小                |
| `r2Key`               | TEXT    | -      | 对象存储键              |
| `mimeType`            | TEXT    | -      | MIME 类型               |
| `hash`                | TEXT    | -      | 文件哈希（去重用）      |
| `isFolder`            | BOOLEAN | false  | 是否为文件夹            |
| `allowedMimeTypes`    | TEXT    | -      | 文件夹允许的上传类型    |
| `refCount`            | INTEGER | 1      | 引用计数（去重机制）    |
| `bucketId`            | TEXT    | -      | 所属存储桶 ID           |
| `directLinkToken`     | TEXT    | -      | 直链访问令牌（唯一）    |
| `directLinkExpiresAt` | TEXT    | -      | 直链过期时间            |
| `aiSummary`           | TEXT    | -      | AI 生成的摘要 (v3.7.0)  |
| `aiSummaryAt`         | TEXT    | -      | 摘要生成时间 (v3.7.0)   |
| `aiTags`              | TEXT    | -      | AI 生成的标签 (v3.7.0)  |
| `aiTagsAt`            | TEXT    | -      | 标签生成时间 (v3.7.0)   |
| `vectorIndexedAt`     | TEXT    | -      | 向量索引时间 (v3.7.0)   |
| `isStarred`           | BOOLEAN | false  | 是否收藏 (v3.7.0)       |
| `createdAt`           | TEXT    | -      | 创建时间                |
| `updatedAt`           | TEXT    | -      | 更新时间                |
| `deletedAt`           | TEXT    | -      | 删除时间 (回收站)       |

**索引**: `idx_files_user_parent_active`, `idx_files_user_deleted`, `idx_files_user_type`, `idx_files_user_mime`, `idx_files_user_created`, `idx_files_user_updated`, `idx_files_user_size`, `idx_files_hash`, `idx_files_direct_link_token`, `idx_files_vector_indexed`, `idx_files_ai_summary`, `idx_files_ai_tags`, `idx_files_is_starred`

#### storage_buckets (存储桶表)

| 字段              | 类型    | 默认值 | 说明                                                |
| ----------------- | ------- | ------ | --------------------------------------------------- |
| `id`              | TEXT    | -      | 主键                                                |
| `userId`          | TEXT    | -      | 所属用户 (外键 → users)                             |
| `name`            | TEXT    | -      | 显示名称                                            |
| `provider`        | TEXT    | -      | 提供商 (r2/s3/oss/cos/obs/b2/minio/custom/telegram) |
| `bucketName`      | TEXT    | -      | 存储桶名称                                          |
| `endpoint`        | TEXT    | -      | 端点 URL                                            |
| `region`          | TEXT    | -      | 区域                                                |
| `accessKeyId`     | TEXT    | -      | Access Key ID (加密存储)                            |
| `secretAccessKey` | TEXT    | -      | Secret Access Key (加密存储)                        |
| `pathStyle`       | BOOLEAN | false  | 是否使用路径样式                                    |
| `isDefault`       | BOOLEAN | false  | 是否为默认存储桶                                    |
| `isActive`        | BOOLEAN | true   | 是否启用                                            |
| `storageUsed`     | INTEGER | 0      | 已用空间                                            |
| `fileCount`       | INTEGER | 0      | 文件数量                                            |
| `storageQuota`    | INTEGER | -      | 存储配额                                            |
| `notes`           | TEXT    | -      | 备注                                                |
| `createdAt`       | TEXT    | -      | 创建时间                                            |
| `updatedAt`       | TEXT    | -      | 更新时间                                            |

**索引**: `idx_buckets_user_active`, `idx_buckets_provider`, `idx_storage_buckets_user_default`

#### shares (分享表)

| 字段                     | 类型    | 默认值 | 说明                       |
| ------------------------ | ------- | ------ | -------------------------- |
| `id`                     | TEXT    | -      | 主键                       |
| `fileId`                 | TEXT    | -      | 关联文件 ID (外键 → files) |
| `userId`                 | TEXT    | -      | 创建者 ID (外键 → users)   |
| `password`               | TEXT    | -      | 访问密码 (可选)            |
| `expiresAt`              | TEXT    | -      | 过期时间                   |
| `downloadLimit`          | INTEGER | -      | 下载次数限制               |
| `downloadCount`          | INTEGER | 0      | 已下载次数                 |
| `isUploadLink`           | BOOLEAN | false  | 是否为上传链接             |
| `uploadToken`            | TEXT    | -      | 上传令牌（唯一）           |
| `maxUploadSize`          | INTEGER | -      | 单文件大小上限             |
| `uploadAllowedMimeTypes` | TEXT    | -      | 允许的 MIME 类型 (JSON)    |
| `maxUploadCount`         | INTEGER | -      | 最多上传文件数             |
| `uploadCount`            | INTEGER | 0      | 已上传文件数               |
| `createdAt`              | TEXT    | -      | 创建时间                   |

**索引**: `idx_shares_expires`, `idx_shares_user_created`, `idx_shares_file_active`, `idx_shares_upload_token`, `idx_shares_upload_link`

#### telegram_file_refs (Telegram 文件引用表)

| 字段         | 类型    | 默认值 | 说明                       |
| ------------ | ------- | ------ | -------------------------- |
| `id`         | TEXT    | -      | 主键                       |
| `fileId`     | TEXT    | -      | OSSshelf 内部文件 ID       |
| `r2Key`      | TEXT    | -      | 与 files.r2Key 对应 (唯一) |
| `tgFileId`   | TEXT    | -      | Telegram 返回的 file_id    |
| `tgFileSize` | INTEGER | -      | Telegram 报告的文件大小    |
| `bucketId`   | TEXT    | -      | 所属存储桶 ID              |
| `createdAt`  | TEXT    | -      | 创建时间                   |

**索引**: `idx_tg_refs_r2key`, `idx_tg_refs_file_id`, `idx_tg_refs_bucket`

#### telegram_file_chunks (Telegram 分片表)

| 字段         | 类型    | 默认值 | 说明                        |
| ------------ | ------- | ------ | --------------------------- |
| `id`         | TEXT    | -      | 主键                        |
| `groupId`    | TEXT    | -      | 同一文件所有分片共享的 UUID |
| `chunkIndex` | INTEGER | -      | 0-based 分片序号            |
| `tgFileId`   | TEXT    | -      | Telegram file_id（此分片）  |
| `chunkSize`  | INTEGER | -      | 此块字节数                  |
| `bucketId`   | TEXT    | -      | 所属存储桶                  |
| `createdAt`  | TEXT    | -      | 创建时间                    |

**索引**: `idx_tg_chunks_group`

#### file_permissions (文件权限表) - v3.6.0 扩展

| 字段                 | 类型 | 默认值     | 说明                             |
| -------------------- | ---- | ---------- | -------------------------------- |
| `id`                 | TEXT | -          | 主键                             |
| `fileId`             | TEXT | -          | 文件 ID (外键 → files)           |
| `userId`             | TEXT | -          | 用户 ID (外键 → users，可空)     |
| `groupId`            | TEXT | -          | 组 ID (外键 → user_groups，可空) |
| `subjectType`        | TEXT | 'user'     | 主体类型 (user/group)            |
| `permission`         | TEXT | 'read'     | 权限 (read/write/admin)          |
| `grantedBy`          | TEXT | -          | 授权人 ID (外键 → users)         |
| `expiresAt`          | TEXT | -          | 过期时间（可选）                 |
| `inheritToChildren`  | BOOL | true       | 是否继承到子文件                 |
| `scope`              | TEXT | 'explicit' | 权限来源 (explicit/inherited)    |
| `sourcePermissionId` | TEXT | -          | 来源权限 ID（继承时）            |
| `createdAt`          | TEXT | -          | 创建时间                         |
| `updatedAt`          | TEXT | -          | 更新时间                         |

**索引**: `idx_file_permissions_file`, `idx_file_permissions_user`, `idx_file_permissions_group`, `idx_file_permissions_expires`, `idx_file_permissions_scope`, `idx_file_permissions_unique` (唯一)

#### user_groups (用户组表) - v3.6.0

| 字段          | 类型 | 默认值 | 说明                     |
| ------------- | ---- | ------ | ------------------------ |
| `id`          | TEXT | -      | 主键                     |
| `ownerId`     | TEXT | -      | 所有者 ID (外键 → users) |
| `name`        | TEXT | -      | 组名称                   |
| `description` | TEXT | -      | 描述                     |
| `createdAt`   | TEXT | -      | 创建时间                 |
| `updatedAt`   | TEXT | -      | 更新时间                 |

**索引**: `idx_user_groups_owner`

#### group_members (组成员表) - v3.6.0

| 字段        | 类型 | 默认值   | 说明                       |
| ----------- | ---- | -------- | -------------------------- |
| `id`        | TEXT | -        | 主键                       |
| `groupId`   | TEXT | -        | 组 ID (外键 → user_groups) |
| `userId`    | TEXT | -        | 用户 ID (外键 → users)     |
| `role`      | TEXT | 'member' | 角色 (member/admin)        |
| `addedBy`   | TEXT | -        | 添加人 ID (外键 → users)   |
| `createdAt` | TEXT | -        | 创建时间                   |

**索引**: `idx_group_members_user`, `idx_group_members_group`, `idx_group_members_unique` (唯一)

#### webhooks (Webhook 表) - v3.6.0

| 字段         | 类型 | 默认值 | 说明                   |
| ------------ | ---- | ------ | ---------------------- |
| `id`         | TEXT | -      | 主键                   |
| `userId`     | TEXT | -      | 用户 ID (外键 → users) |
| `url`        | TEXT | -      | Webhook URL            |
| `secret`     | TEXT | -      | 签名密钥               |
| `events`     | TEXT | -      | 订阅事件 (JSON 数组)   |
| `isActive`   | BOOL | true   | 是否启用               |
| `lastStatus` | INT  | -      | 最后响应状态码         |
| `createdAt`  | TEXT | -      | 创建时间               |

**索引**: `idx_webhooks_user`, `idx_webhooks_active`

#### file_tags (文件标签表)

| 字段        | 类型 | 默认值    | 说明                   |
| ----------- | ---- | --------- | ---------------------- |
| `id`        | TEXT | -         | 主键                   |
| `fileId`    | TEXT | -         | 文件 ID (外键 → files) |
| `userId`    | TEXT | -         | 用户 ID (外键 → users) |
| `name`      | TEXT | -         | 标签名称               |
| `color`     | TEXT | '#6366f1' | 标签颜色               |
| `createdAt` | TEXT | -         | 创建时间               |

**索引**: `idx_file_tags_file`, `idx_file_tags_user_name`, `idx_file_tags_unique` (唯一)

#### upload_tasks (上传任务表)

| 字段            | 类型    | 默认值    | 说明                   |
| --------------- | ------- | --------- | ---------------------- |
| `id`            | TEXT    | -         | 主键                   |
| `userId`        | TEXT    | -         | 用户 ID (外键 → users) |
| `fileName`      | TEXT    | -         | 文件名                 |
| `fileSize`      | INTEGER | -         | 文件大小               |
| `mimeType`      | TEXT    | -         | MIME 类型              |
| `parentId`      | TEXT    | -         | 父文件夹 ID            |
| `bucketId`      | TEXT    | -         | 存储桶 ID              |
| `r2Key`         | TEXT    | -         | 对象存储键             |
| `uploadId`      | TEXT    | -         | 分片上传 ID            |
| `totalParts`    | INTEGER | -         | 总分片数               |
| `uploadedParts` | TEXT    | '[]'      | 已上传分片 (JSON)      |
| `status`        | TEXT    | 'pending' | 状态                   |
| `progress`      | INTEGER | 0         | 进度百分比             |
| `errorMessage`  | TEXT    | -         | 错误信息               |
| `createdAt`     | TEXT    | -         | 创建时间               |
| `updatedAt`     | TEXT    | -         | 更新时间               |
| `expiresAt`     | TEXT    | -         | 过期时间               |

**索引**: `idx_upload_tasks_user`, `idx_upload_tasks_expires`

#### download_tasks (离线下载任务表)

| 字段           | 类型    | 默认值    | 说明                   |
| -------------- | ------- | --------- | ---------------------- |
| `id`           | TEXT    | -         | 主键                   |
| `userId`       | TEXT    | -         | 用户 ID (外键 → users) |
| `url`          | TEXT    | -         | 下载 URL               |
| `fileName`     | TEXT    | -         | 文件名                 |
| `fileSize`     | INTEGER | -         | 文件大小               |
| `parentId`     | TEXT    | -         | 父文件夹 ID            |
| `bucketId`     | TEXT    | -         | 存储桶 ID              |
| `status`       | TEXT    | 'pending' | 状态                   |
| `progress`     | INTEGER | 0         | 进度百分比             |
| `errorMessage` | TEXT    | -         | 错误信息               |
| `createdAt`    | TEXT    | -         | 创建时间               |
| `updatedAt`    | TEXT    | -         | 更新时间               |
| `completedAt`  | TEXT    | -         | 完成时间               |

**索引**: `idx_download_tasks_user`, `idx_download_tasks_status`

#### user_devices (用户设备表)

| 字段         | 类型 | 默认值 | 说明                   |
| ------------ | ---- | ------ | ---------------------- |
| `id`         | TEXT | -      | 主键                   |
| `userId`     | TEXT | -      | 用户 ID (外键 → users) |
| `deviceId`   | TEXT | -      | 设备 ID                |
| `deviceName` | TEXT | -      | 设备名称               |
| `deviceType` | TEXT | -      | 设备类型               |
| `ipAddress`  | TEXT | -      | IP 地址                |
| `userAgent`  | TEXT | -      | User Agent             |
| `lastActive` | TEXT | -      | 最后活跃时间           |
| `createdAt`  | TEXT | -      | 创建时间               |

**索引**: `idx_user_devices_user`, `idx_user_devices_unique` (唯一)

#### login_attempts (登录尝试表)

| 字段        | 类型    | 默认值 | 说明       |
| ----------- | ------- | ------ | ---------- |
| `id`        | TEXT    | -      | 主键       |
| `email`     | TEXT    | -      | 邮箱       |
| `ipAddress` | TEXT    | -      | IP 地址    |
| `success`   | BOOLEAN | false  | 是否成功   |
| `userAgent` | TEXT    | -      | User Agent |
| `createdAt` | TEXT    | -      | 创建时间   |

**索引**: `idx_login_attempts_email`, `idx_login_attempts_ip`

#### audit_logs (审计日志表)

| 字段           | 类型 | 默认值    | 说明                 |
| -------------- | ---- | --------- | -------------------- |
| `id`           | TEXT | -         | 主键                 |
| `userId`       | TEXT | -         | 用户 ID (外键, 可空) |
| `action`       | TEXT | -         | 操作类型             |
| `resourceType` | TEXT | -         | 资源类型             |
| `resourceId`   | TEXT | -         | 资源 ID              |
| `details`      | TEXT | -         | 详情 (JSON)          |
| `ipAddress`    | TEXT | -         | IP 地址              |
| `userAgent`    | TEXT | -         | User Agent           |
| `status`       | TEXT | 'success' | 状态                 |
| `errorMessage` | TEXT | -         | 错误信息             |
| `createdAt`    | TEXT | -         | 创建时间             |

**索引**: `idx_audit_logs_user`, `idx_audit_logs_action`, `idx_audit_logs_resource`, `idx_audit_logs_created`

#### search_history (搜索历史表)

| 字段        | 类型 | 默认值 | 说明                   |
| ----------- | ---- | ------ | ---------------------- |
| `id`        | TEXT | -      | 主键                   |
| `userId`    | TEXT | -      | 用户 ID (外键 → users) |
| `query`     | TEXT | -      | 搜索关键词             |
| `createdAt` | TEXT | -      | 创建时间               |

**索引**: `idx_search_history_user`

#### file_versions (文件版本表) - v3.3.0

| 字段            | 类型    | 默认值 | 说明                   |
| --------------- | ------- | ------ | ---------------------- |
| `id`            | TEXT    | -      | 主键                   |
| `fileId`        | TEXT    | -      | 文件 ID (外键 → files) |
| `userId`        | TEXT    | -      | 用户 ID (外键 → users) |
| `versionNumber` | INTEGER | -      | 版本号                 |
| `r2Key`         | TEXT    | -      | 对象存储键             |
| `size`          | INTEGER | -      | 文件大小               |
| `hash`          | TEXT    | -      | 文件哈希               |
| `note`          | TEXT    | -      | 版本备注               |
| `tags`          | TEXT    | -      | 版本标签 (JSON)        |
| `createdAt`     | TEXT    | -      | 创建时间               |

**索引**: `idx_file_versions_file`, `idx_file_versions_user`, `idx_file_versions_number`

---

## 系统常量

### 文件限制（定义于 `packages/shared/src/constants/index.ts`）

| 常量                    | 值     | 说明                  |
| ----------------------- | ------ | --------------------- |
| `MAX_FILE_SIZE`         | 5 GB   | S3 兼容存储单文件最大 |
| `DEFAULT_STORAGE_QUOTA` | 10 GB  | 默认存储配额          |
| `UPLOAD_CHUNK_SIZE`     | 10 MB  | S3 分片大小           |
| `MULTIPART_THRESHOLD`   | 100 MB | S3 分片上传阈值       |
| `MAX_CONCURRENT_PARTS`  | 3      | 最大并发分片数        |

### Telegram 限制（定义于 `apps/api/src/lib/telegramClient.ts` 和 `telegramChunked.ts`）

| 常量                       | 值    | 说明              |
| -------------------------- | ----- | ----------------- |
| `TG_MAX_FILE_SIZE`         | 50 MB | Telegram 直传上限 |
| `TG_CHUNKED_THRESHOLD`     | 49 MB | Telegram 分片阈值 |
| `TG_CHUNK_SIZE`            | 30 MB | Telegram 分片大小 |
| `TG_MAX_CHUNKED_FILE_SIZE` | 2 GB  | Telegram 最大文件 |

### 时间限制

| 常量                    | 值      | 说明              |
| ----------------------- | ------- | ----------------- |
| `JWT_EXPIRY`            | 7 天    | JWT 有效期        |
| `WEBDAV_SESSION_EXPIRY` | 30 天   | WebDAV 会话有效期 |
| `SHARE_DEFAULT_EXPIRY`  | 7 天    | 分享默认有效期    |
| `TRASH_RETENTION_DAYS`  | 30 天   | 回收站保留天数    |
| `DEVICE_SESSION_EXPIRY` | 30 天   | 设备会话有效期    |
| `UPLOAD_TASK_EXPIRY`    | 24 小时 | 上传任务有效期    |

### 安全限制

| 常量                     | 值      | 说明             |
| ------------------------ | ------- | ---------------- |
| `LOGIN_MAX_ATTEMPTS`     | 5       | 最大登录尝试次数 |
| `LOGIN_LOCKOUT_DURATION` | 15 分钟 | 登录锁定时长     |

### 支持的存储提供商（定义于 `apps/api/src/routes/buckets.ts`）

| Provider   | 名称           | 默认端点                                       | 路径样式 |
| ---------- | -------------- | ---------------------------------------------- | -------- |
| `r2`       | Cloudflare R2  | `https://<accountId>.r2.cloudflarestorage.com` | false    |
| `s3`       | Amazon S3      | -                                              | false    |
| `oss`      | Aliyun OSS     | `https://oss-cn-hangzhou.aliyuncs.com`         | false    |
| `cos`      | Tencent COS    | `https://cos.ap-guangzhou.myqcloud.com`        | false    |
| `obs`      | Huawei OBS     | `https://obs.cn-north-4.myhuaweicloud.com`     | false    |
| `b2`       | Backblaze B2   | `https://s3.us-west-004.backblazeb2.com`       | true     |
| `minio`    | MinIO          | `http://localhost:9000`                        | true     |
| `custom`   | 自定义 S3 兼容 | -                                              | false    |
| `telegram` | Telegram       | -                                              | false    |

---

## API 路由（定义于 `apps/api/src/index.ts`）

| 路由前缀           | 模块           | 说明              |
| ------------------ | -------------- | ----------------- |
| `/api/auth`        | auth.ts        | 用户认证、邮箱验证、密码重置 (v4.0.0增强) |
| `/api/files`       | files.ts       | 文件管理          |
| `/api/buckets`     | buckets.ts     | 存储桶管理        |
| `/api/share`       | share.ts       | 文件分享          |
| `/api/direct`      | directLink.ts  | 文件直链          |
| `/api/presign`     | presign.ts     | 预签名 URL        |
| `/api/tasks`       | tasks.ts       | 上传任务          |
| `/api/downloads`   | downloads.ts   | 离线下载          |
| `/api/batch`       | batch.ts       | 批量操作          |
| `/api/search`      | search.ts      | 文件搜索          |
| `/api/permissions` | permissions.ts | 权限与标签        |
| `/api/preview`     | preview.ts     | 文件预览          |
| `/api/versions`    | versions.ts    | 版本控制 (v3.3.0) |
| `/api/notes`       | notes.ts       | 文件笔记 (v3.5.0) |
| `/api/api-keys`    | apiKeys.ts     | API Keys (v3.5.0) |
| `/api/groups`      | groups.ts      | 用户组管理 (v3.6.0) |
| `/api/webhooks`    | webhooks.ts    | Webhook 管理 (v3.6.0) |
| `/api/ai`          | ai.ts          | AI 功能 (v3.7.0)  |
| `/api/analytics`   | analytics.ts   | 存储分析 (v3.8.0) |
| `/api/notifications` | notifications.ts | 通知系统 (v3.8.0) |
| `/api/v1`          | v1/index.ts    | RESTful v1 (v3.6.0) |
| `/api/admin`       | admin.ts       | 管理员接口、邮件配置 (v4.0.0增强) |
| `/api/migrate`     | migrate.ts     | 存储桶迁移        |
| `/api/telegram`    | telegram.ts    | Telegram 存储     |
| `/cron`            | cron.ts        | 定时任务          |
| `/dav`             | webdav.ts      | WebDAV 协议       |

---

## 核心功能架构

### S3 兼容存储上传流程

```
┌─────────────────────────────────────────────────────────────────┐
│                      文件上传请求                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  文件大小判断    │
                    │  (100MB 阈值)   │
                    └─────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │  ≤ 100 MB       │             │  > 100 MB       │
    │  小文件模式      │             │  分片上传模式    │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ POST /presign/  │             │ POST /presign/  │
    │ upload          │             │ multipart/init  │
    │                 │             │                 │
    │ 返回预签名URL   │             │ 返回 uploadId   │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ PUT 直传到 S3   │             │ 循环上传分片    │
    │                 │             │ POST /presign/  │
    │                 │             │ multipart/part  │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ POST /presign/  │             │ POST /presign/  │
    │ confirm         │             │ multipart/      │
    │                 │             │ complete        │
    └─────────────────┘             └─────────────────┘
```

### Telegram 存储上传流程

```
┌─────────────────────────────────────────────────────────────────┐
│                      文件上传请求                                │
│                  (bucketId 指向 Telegram 桶)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  文件大小判断    │
                    │  (49MB 阈值)    │
                    └─────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │  ≤ 49 MB        │             │  > 49 MB        │
    │  小文件模式      │             │  分片上传模式    │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ POST /tasks/    │             │ POST /tasks/    │
    │ create          │             │ create          │
    │ isSmallFile     │             │ isTelegramChunk │
    │ = true          │             │ = true          │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ POST /tasks/    │             │ 循环上传分片    │
    │ telegram-part   │             │ POST /tasks/    │
    │ (整个文件)      │             │ telegram-part   │
    │                 │             │ (每片≤30MB)    │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ POST /tasks/    │             │ POST /tasks/    │
    │ complete        │             │ complete        │
    │                 │             │                 │
    │ 写入文件记录    │             │ 写入文件记录    │
    │ + TG引用        │             │ + TG引用        │
    │                 │             │ + 分片记录      │
    └─────────────────┘             └─────────────────┘
```

### 存储桶迁移

```
┌─────────────────────────────────────────────────────────────┐
│                    Migration Flow                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  POST /api/migrate/start                                     │
│  ├─ 验证 sourceBucketId / targetBucketId                     │
│  ├─ 收集需要迁移的文件 ID（支持文件夹递归）                    │
│  ├─ 创建 MigrationStatus 存入 KV                             │
│  └─ waitUntil(runMigration) 异步执行                         │
│                                                              │
│  runMigration (后台执行)                                      │
│  ├─ 逐文件处理                                               │
│  │   ├─ 从来源读取 (S3/Telegram/R2)                          │
│  │   ├─ 写入目标 (S3/Telegram)                               │
│  │   ├─ 更新 files 表                                        │
│  │   └─ 更新 bucket stats                                    │
│  ├─ 每完成一个文件更新 KV 状态                                │
│  └─ 支持取消（检查 KV status）                                │
│                                                              │
│  GET /api/migrate/:migrationId                               │
│  └─ 返回 KV 中的 MigrationStatus                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 文件去重（Copy-on-Write）

```
┌─────────────────────────────────────────────────────────────┐
│                   Dedup Flow                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  上传前检查                                                   │
│  checkAndClaimDedup(hash, bucketId, userId)                  │
│  ├─ 查找同 hash + bucketId 的活跃文件                        │
│  ├─ 若存在：ref_count += 1，返回 existingR2Key               │
│  └─ 若不存在：返回 isDuplicate: false                        │
│                                                              │
│  删除文件                                                     │
│  releaseFileRef(fileId)                                      │
│  ├─ ref_count -= 1                                           │
│  └─ 若 ref_count == 0，才删除存储对象                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 文件版本控制（v3.3.0）

```
┌─────────────────────────────────────────────────────────────┐
│                   Version Control Flow                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  上传新版本                                                   │
│  POST /api/versions/create                                   │
│  ├─ 获取当前文件信息                                          │
│  ├─ 保存当前版本到 file_versions 表                          │
│  │   ├─ 记录 r2Key、size、hash                               │
│  │   ├─ 自动递增 versionNumber                               │
│  │   └─ 可选添加备注和标签                                    │
│  ├─ 上传新文件内容                                            │
│  └─ 更新 files 表的 r2Key、size、hash                        │
│                                                              │
│  版本回滚                                                     │
│  POST /api/versions/<versionId>/restore                      │
│  ├─ 获取目标版本信息                                          │
│  ├─ 保存当前版本到历史                                        │
│  └─ 恢复目标版本的 r2Key、size、hash                         │
│                                                              │
│  版本对比                                                     │
│  GET /api/versions/compare?v1=x&v2=y                         │
│  └─ 返回两个版本的元数据差异                                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 错误码管理（v3.3.0）

```
┌─────────────────────────────────────────────────────────────┐
│                   Error Code System                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  错误码定义 (packages/shared/src/constants/errorCodes.ts)    │
│  ├─ AUTH_* : 认证相关错误                                    │
│  │   ├─ AUTH_UNAUTHORIZED (1001)                             │
│  │   ├─ AUTH_TOKEN_EXPIRED (1002)                            │
│  │   └─ AUTH_PERMISSION_DENIED (1003)                        │
│  ├─ FILE_* : 文件相关错误                                    │
│  │   ├─ FILE_NOT_FOUND (2001)                                │
│  │   ├─ FILE_TOO_LARGE (2002)                                │
│  │   └─ FILE_TYPE_NOT_ALLOWED (2003)                         │
│  ├─ STORAGE_* : 存储相关错误                                 │
│  │   ├─ STORAGE_EXCEEDED (3001)                              │
│  │   └─ STORAGE_BUCKET_ERROR (3002)                          │
│  ├─ SHARE_* : 分享相关错误                                   │
│  │   ├─ SHARE_EXPIRED (4001)                                 │
│  │   ├─ SHARE_PASSWORD_REQUIRED (4002)                       │
│  │   └─ SHARE_DOWNLOAD_LIMIT_EXCEEDED (4003)                 │
│  └─ SYSTEM_* : 系统相关错误                                  │
│      ├─ SYSTEM_INTERNAL_ERROR (5001)                         │
│      └─ SYSTEM_VALIDATION_ERROR (5002)                       │
│                                                              │
│  统一响应格式                                                 │
│  {                                                           │
│    "success": false,                                         │
│    "error": {                                                │
│      "code": "FILE_TOO_LARGE",                               │
│      "codeNumber": 2002,                                     │
│      "message": "文件大小超过限制",                           │
│      "details": { "maxSize": 5368709120 }                    │
│    }                                                         │
│  }                                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 文件预览架构（v3.4.0）

```
┌─────────────────────────────────────────────────────────────┐
│                   File Preview System                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  预览类型配置 (packages/shared/src/constants/previewTypes.ts)│
│  ├─ IMAGE_MIME_PREFIX: 'image/'                              │
│  ├─ VIDEO_MIME_PREFIX: 'video/'                              │
│  ├─ AUDIO_MIME_PREFIX: 'audio/'                              │
│  ├─ PDF_MIME_TYPE: 'application/pdf'                         │
│  ├─ MARKDOWN_MIME_TYPE: 'text/markdown'                      │
│  ├─ CSV_MIME_TYPE: 'text/csv'                                │
│  ├─ EPUB_MIME_TYPES: ['application/epub+zip', ...]          │
│  ├─ FONT_MIME_TYPES: ['font/ttf', 'font/otf', ...]          │
│  ├─ ARCHIVE_PREVIEW_MIME_TYPES: ['application/zip', ...]    │
│  └─ OFFICE_MIME_TYPES: { word, excel, powerpoint }          │
│                                                              │
│  前端预览组件 (apps/web/src/components/files/FilePreview.tsx)│
│  ├─ 图片预览: <img> 原生 + 缩放                              │
│  ├─ 视频预览: <video> 原生 + 流式播放                        │
│  ├─ 音频预览: <audio> 原生                                   │
│  ├─ PDF 预览: pdf.js 分页渲染 + 缩放控制                     │
│  ├─ Markdown: react-markdown + GFM + KaTeX                   │
│  ├─ 代码预览: highlight.js 语法高亮                          │
│  ├─ Word 预览: docx-preview 本地渲染                         │
│  ├─ Excel 预览: xlsx 库 + 样式保留 + 多工作表                │
│  ├─ PowerPoint: pptx-preview 本地渲染                        │
│  ├─ EPUB 预览: epub.js 电子书阅读器 + 目录导航               │
│  ├─ 字体预览: FontFace API 字符展示                          │
│  ├─ ZIP 预览: JSZip 文件树 + 压缩统计                        │
│  └─ CSV 预览: PapaParse 表格 + 搜索/排序/分页                │
│                                                              │
│  预览窗口控制                                                │
│  ├─ 窗口大小: small (60%) / medium (80%) / large (90%) / 全屏│
│  ├─ 缩放控制: 50% - 200%                                     │
│  └─ 键盘快捷键: ESC 关闭 / 左右箭头翻页(EPUB)                │
│                                                              │
│  后端预览接口 (apps/api/src/routes/preview.ts)               │
│  ├─ GET /api/preview/:fileId/info - 预览信息                 │
│  ├─ GET /api/preview/:fileId/raw - 原始内容 (≤30MB)          │
│  ├─ GET /api/preview/:fileId/stream - 流式预览               │
│  └─ GET /api/preview/:fileId/thumbnail - 缩略图              │
│                                                              │
│  预览依赖库                                                  │
│  ├─ pdfjs-dist: PDF 渲染                                     │
│  ├─ docx-preview: Word 文档                                  │
│  ├─ xlsx: Excel 表格                                         │
│  ├─ pptx-preview: PowerPoint                                 │
│  ├─ epubjs: EPUB 电子书                                      │
│  ├─ jszip: ZIP 解析                                          │
│  ├─ papaparse: CSV 解析                                      │
│  ├─ highlight.js: 代码高亮                                   │
│  ├─ react-markdown: Markdown 渲染                            │
│  └─ remark-gfm/rehype-highlight: Markdown 插件               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 认证机制

### JWT 认证

- 用户登录后获取 JWT Token
- Token 有效期 7 天
- Token 存储在客户端，通过 `Authorization: Bearer <token>` 头传递
- 支持多设备登录，每个设备有独立的设备 ID

### WebDAV 认证

- 使用 Basic Auth 认证
- 用户名：注册邮箱
- 密码：账户密码
- 认证成功后创建 WebDAV 会话，有效期 30 天

### 登录保护

- 连续 5 次登录失败后锁定账户
- 锁定时长 15 分钟
- 记录所有登录尝试

---

## 邮件通知系统

### 系统架构

v4.0.0 新增的邮件通知系统基于 Resend API 实现，支持多种邮件场景。

```
┌─────────────────────────────────────────────────────────────┐
│                      邮件通知系统架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────┐ │
│  │  触发场景     │─────→│  偏好检查     │─────→│  发送邮件   │ │
│  └──────────────┘      └──────────────┘      └────────────┘ │
│         │                      │                     │       │
│         ▼                      ▼                     ▼       │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────┐ │
│  │ 注册验证      │      │ 用户偏好设置  │      │ Resend API │ │
│  │ 密码重置      │      │ mention      │      │            │ │
│  │ 邮箱更换      │      │ share_received│     │ KV配置存储 │ │
│  │ 系统通知      │      │ quota_warning│      │            │ │
│  │ @提及        │      │ ai_complete  │      │ 模板渲染    │ │
│  │ 分享接收      │      │ system       │      │            │ │
│  └──────────────┘      └──────────────┘      └────────────┘ │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件

#### 1. 邮件服务层 (`emailService.ts`)

```typescript
// 主要功能
- getResendConfig(env)     // 从KV获取Resend配置
- saveResendConfig(env, config)  // 保存配置到KV
- sendEmail(env, to, subject, html)  // 发送邮件
- emailTemplates           // 邮件模板集合
- parseEmailPreferences(json)  // 解析邮件偏好
- shouldSendEmail(type, preferences)  // 判断是否发送
```

#### 2. Token管理 (`email_tokens` 表)

| Token类型 | 有效期 | 用途 |
|----------|-------|------|
| `verify_email` | 24小时 | 注册邮箱验证 |
| `reset_password` | 1小时 | 密码重置 |
| `change_email` | 1小时 | 邮箱更换确认 |

**安全措施**：
- Token使用SHA-256哈希存储
- Token一次性使用
- 使用后标记 `usedAt`

#### 3. 邮件模板

| 模板名称 | 用途 | 包含内容 |
|---------|------|---------|
| `verifyEmail` | 注册验证 | 验证链接、有效期 |
| `resetPassword` | 密码重置 | 重置链接、有效期 |
| `changeEmail` | 邮箱更换 | 确认链接、新邮箱 |
| `passwordChanged` | 密码变更通知 | 变更时间、IP地址 |
| `systemNotify` | 系统通知 | 标题、内容、可选链接 |

### 邮件发送流程

#### 必须发送的邮件（不检查偏好）

```
用户注册
    ↓
生成验证Token (SHA-256哈希)
    ↓
存储到 email_tokens 表
    ↓
生成验证链接 (PUBLIC_URL + token)
    ↓
发送验证邮件 (Resend API)
    ↓
用户点击链接
    ↓
验证Token有效性
    ↓
更新 users.email_verified = true
    ↓
标记Token已使用
```

#### 受偏好控制的邮件

```
触发邮件通知
    ↓
读取用户 email_preferences
    ↓
解析偏好设置
    ↓
判断通知类型映射
  - password_changed → system
  - mention → mention
  - share_received → share_received
    ↓
检查对应偏好是否开启
    ↓
如果开启 → 发送邮件
如果关闭 → 跳过发送
```

### 管理员功能

#### 邮件配置管理

```typescript
// API端点
GET  /api/admin/email/config     // 获取配置（API Key脱敏）
PUT  /api/admin/email/config     // 保存配置
POST /api/admin/email/test       // 发送测试邮件
POST /api/admin/email/broadcast  // 群发系统公告
```

#### 群发系统公告

```typescript
// 请求参数
{
  subject: "系统公告标题",
  body: "公告内容",
  userFilter: {
    role: "admin" | "user"  // 可选：按角色筛选
  }
}

// 响应
{
  success: true,
  data: {
    total: 100,        // 总发送数
    successCount: 98,  // 成功数
    failCount: 2       // 失败数
  }
}
```

### 数据库设计

#### email_tokens 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT | 主键 |
| `userId` | TEXT | 用户ID (外键) |
| `email` | TEXT | 关联邮箱 |
| `type` | TEXT | Token类型 |
| `tokenHash` | TEXT | Token哈希 (SHA-256) |
| `expiresAt` | TEXT | 过期时间 |
| `usedAt` | TEXT | 使用时间 (可空) |
| `createdAt` | TEXT | 创建时间 |

**索引**: `idx_email_tokens_hash`, `idx_email_tokens_user`

#### users 表扩展字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `email_verified` | BOOLEAN | false | 邮箱验证状态 |
| `email_preferences` | TEXT | '{}' | 邮件偏好 (JSON) |
| `password_changed_at` | TEXT | null | 密码变更时间 |

### 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `PUBLIC_URL` | ✅ | 应用公网地址，用于生成邮件链接 |

**注意**: `PUBLIC_URL` 必须配置，否则邮件功能无法使用。

### 前端集成

#### 页面组件

| 组件 | 路由 | 功能 |
|------|------|------|
| `VerifyEmail` | `/verify-email` | 邮箱验证落地页 |
| `ForgotPassword` | `/forgot-password` | 忘记密码页面 |
| `ResetPassword` | `/reset-password` | 重置密码页面 |
| `EmailConfig` | `/admin` (邮件配置选项卡) | 管理员邮件配置 |
| `EmailVerificationBanner` | - | 未验证用户提示横幅 |

#### 设置页面集成

- **邮箱设置选项卡**
  - 显示当前邮箱和验证状态
  - 重发验证邮件
  - 更换邮箱功能
  - 邮件偏好设置

### 安全机制

#### JWT失效机制

```typescript
// 密码修改/重置后更新
await db.update(users).set({
  passwordHash: newPasswordHash,
  passwordChangedAt: now  // 记录变更时间
});

// 登录时检查
if (user.passwordChangedAt && decoded.iat) {
  const passwordChangedAt = new Date(user.passwordChangedAt).getTime() / 1000;
  if (passwordChangedAt > decoded.iat) {
    // JWT已失效，要求重新登录
    return c.json({ error: '密码已更改，请重新登录' }, 401);
  }
}
```

#### 防邮箱枚举攻击

```typescript
// 忘记密码无论邮箱是否存在都返回200
app.post('/forgot-password', async (c) => {
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  
  if (!user) {
    // 不透露邮箱是否存在
    return c.json({ success: true, message: '如果邮箱存在，您将收到重置邮件' });
  }
  
  // 发送重置邮件...
  return c.json({ success: true, message: '如果邮箱存在，您将收到重置邮件' });
});
```

#### 限流机制

```typescript
// 重发验证邮件限流
const rateKey = `rate:resend:${email}`;
const exists = await c.env.KV.get(rateKey);
if (exists) {
  throwAppError('RATE_LIMIT_EXCEEDED', '请等待1分钟后重试');
}
await c.env.KV.put(rateKey, '1', { expirationTtl: 60 });
```

---

## 定时任务

系统通过 Cloudflare Cron Triggers 执行定时任务（定义于 `apps/api/src/routes/cron.ts`）：

| 任务       | 触发时间      | 说明                       |
| ---------- | ------------- | -------------------------- |
| 回收站清理 | 每天凌晨 3 点 | 清理超过 30 天的回收站文件 |
| 会话清理   | 每天凌晨 3 点 | 清理过期的会话和任务       |
| 分享清理   | 每天凌晨 3 点 | 清理过期的分享链接         |

**配置方式** (wrangler.toml):

```toml
[triggers]
crons = ["0 3 * * *"]
```

---

## 安全措施

### 1. 密码存储

使用 bcrypt 哈希存储密码，自动加盐。

### 2. JWT 签名

使用 `JWT_SECRET` 环境变量签名，建议 32+ 字符随机字符串。

### 3. 密钥加密

存储桶密钥使用 AES-GCM 加密存储，密钥为 `ENCRYPTION_KEY`。

### 4. CORS

通过环境变量 `CORS_ORIGINS` 配置允许的域名，多个域名用逗号分隔。本地开发地址默认已允许。

### 5. 安全头

使用 Hono secure-headers 中间件添加安全响应头。

### 6. 输入验证

使用 Zod 进行请求参数验证，防止注入攻击。

### 7. 审计日志

记录所有关键操作，便于追溯和安全审计。
