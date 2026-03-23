# OSSshelf 架构文档

本文档基于项目实际代码，详细描述 OSSshelf 的系统架构、数据库设计和核心功能实现。

---

## 📋 目录

- [系统概述](#系统概述)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [数据库设计](#数据库设计)
- [系统常量](#系统常量)
- [API 路由](#api-路由)
- [核心功能架构](#核心功能架构)
- [认证机制](#认证机制)
- [定时任务](#定时任务)
- [安全措施](#安全措施)

---

## 系统概述

OSSshelf 是一个基于 Cloudflare 部署的多厂商 OSS 文件管理系统，支持 WebDAV 协议。系统采用前后端分离架构：

- **前端**: React + Vite + Tailwind CSS
- **后端**: Hono 框架运行在 Cloudflare Workers 上
- **数据库**: Cloudflare D1 (SQLite) + Drizzle ORM
- **存储**: S3 兼容协议 + Telegram Bot API

---

## 技术栈

### 前端 (apps/web)

| 技术 | 说明 |
|------|------|
| React 18 | UI 框架 |
| Vite 5 | 构建工具 |
| React Router DOM 6 | 路由 |
| Zustand 4 | 状态管理 |
| TanStack Query 5 | 数据请求 |
| Axios | HTTP 客户端 |
| Radix UI | UI 组件 |
| Tailwind CSS 3 | 样式 |
| Lucide React | 图标 |

### 后端 (apps/api)

| 技术 | 说明 |
|------|------|
| Hono 4 | Web 框架 |
| Cloudflare Workers | 运行时 |
| Drizzle ORM 0.29 | ORM |
| Zod 3 | 验证 |
| bcrypt | 密码哈希 |

### 共享包 (packages/shared)

| 技术 | 说明 |
|------|------|
| tsup | 构建工具 |
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
│   │   │   │   └── zipStream.ts    # ZIP 流式打包
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts         # 认证中间件
│   │   │   │   ├── error.ts        # 错误处理
│   │   │   │   └── index.ts        # 中间件导出
│   │   │   ├── routes/
│   │   │   │   ├── admin.ts        # 管理员接口
│   │   │   │   ├── auth.ts         # 认证接口
│   │   │   │   ├── batch.ts        # 批量操作
│   │   │   │   ├── buckets.ts      # 存储桶管理
│   │   │   │   ├── cron.ts         # 定时任务
│   │   │   │   ├── downloads.ts    # 离线下载
│   │   │   │   ├── files.ts        # 文件管理
│   │   │   │   ├── migrate.ts      # 存储桶迁移
│   │   │   │   ├── permissions.ts  # 权限管理
│   │   │   │   ├── presign.ts      # 预签名 URL
│   │   │   │   ├── preview.ts      # 文件预览
│   │   │   │   ├── search.ts       # 文件搜索
│   │   │   │   ├── share.ts        # 文件分享
│   │   │   │   ├── directLink.ts   # 文件直链
│   │   │   │   ├── tasks.ts        # 上传任务
│   │   │   │   ├── telegram.ts     # Telegram 存储
│   │   │   │   └── webdav.ts       # WebDAV 协议
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
│   │   │   └── 0007_phase7.sql
│   │   ├── drizzle.config.ts
│   │   ├── wrangler.toml.example
│   │   └── package.json
│   └── web/                        # 前端应用
│       ├── src/
│       │   ├── components/         # UI 组件
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
│       │   └── constants/
│       │       └── index.ts        # 常量定义
│       ├── tsup.config.ts
│       └── package.json
└── docs/
    ├── api.md
    ├── architecture.md
    └── deployment.md
```

---

## 数据库设计

### 表结构（定义于 `apps/api/src/db/schema.ts`）

#### users (用户表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `email` | TEXT | - | 邮箱 (唯一) |
| `passwordHash` | TEXT | - | 密码哈希 |
| `name` | TEXT | - | 昵称 |
| `role` | TEXT | 'user' | 角色 (user/admin) |
| `storageQuota` | INTEGER | 10737418240 | 存储配额 (10GB) |
| `storageUsed` | INTEGER | 0 | 已用空间 |
| `createdAt` | TEXT | - | 创建时间 |
| `updatedAt` | TEXT | - | 更新时间 |

**索引**: `idx_users_role`, `idx_users_created`

#### files (文件表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `userId` | TEXT | - | 所属用户 (外键 → users) |
| `parentId` | TEXT | - | 父文件夹 ID |
| `name` | TEXT | - | 文件名 |
| `path` | TEXT | - | 文件路径 |
| `type` | TEXT | - | 文件类型 |
| `size` | INTEGER | 0 | 文件大小 |
| `r2Key` | TEXT | - | 对象存储键 |
| `mimeType` | TEXT | - | MIME 类型 |
| `hash` | TEXT | - | 文件哈希（去重用） |
| `isFolder` | BOOLEAN | false | 是否为文件夹 |
| `allowedMimeTypes` | TEXT | - | 文件夹允许的上传类型 |
| `refCount` | INTEGER | 1 | 引用计数（去重机制） |
| `bucketId` | TEXT | - | 所属存储桶 ID |
| `directLinkToken` | TEXT | - | 直链访问令牌（唯一） |
| `directLinkExpiresAt` | TEXT | - | 直链过期时间 |
| `createdAt` | TEXT | - | 创建时间 |
| `updatedAt` | TEXT | - | 更新时间 |
| `deletedAt` | TEXT | - | 删除时间 (回收站) |

**索引**: `idx_files_user_parent_active`, `idx_files_user_deleted`, `idx_files_user_type`, `idx_files_user_mime`, `idx_files_user_created`, `idx_files_user_updated`, `idx_files_user_size`, `idx_files_hash`, `idx_files_direct_link_token`

#### storage_buckets (存储桶表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `userId` | TEXT | - | 所属用户 (外键 → users) |
| `name` | TEXT | - | 显示名称 |
| `provider` | TEXT | - | 提供商 (r2/s3/oss/cos/obs/b2/minio/custom/telegram) |
| `bucketName` | TEXT | - | 存储桶名称 |
| `endpoint` | TEXT | - | 端点 URL |
| `region` | TEXT | - | 区域 |
| `accessKeyId` | TEXT | - | Access Key ID (加密存储) |
| `secretAccessKey` | TEXT | - | Secret Access Key (加密存储) |
| `pathStyle` | BOOLEAN | false | 是否使用路径样式 |
| `isDefault` | BOOLEAN | false | 是否为默认存储桶 |
| `isActive` | BOOLEAN | true | 是否启用 |
| `storageUsed` | INTEGER | 0 | 已用空间 |
| `fileCount` | INTEGER | 0 | 文件数量 |
| `storageQuota` | INTEGER | - | 存储配额 |
| `notes` | TEXT | - | 备注 |
| `createdAt` | TEXT | - | 创建时间 |
| `updatedAt` | TEXT | - | 更新时间 |

**索引**: `idx_buckets_user_active`, `idx_buckets_provider`, `idx_storage_buckets_user_default`

#### shares (分享表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `fileId` | TEXT | - | 关联文件 ID (外键 → files) |
| `userId` | TEXT | - | 创建者 ID (外键 → users) |
| `password` | TEXT | - | 访问密码 (可选) |
| `expiresAt` | TEXT | - | 过期时间 |
| `downloadLimit` | INTEGER | - | 下载次数限制 |
| `downloadCount` | INTEGER | 0 | 已下载次数 |
| `isUploadLink` | BOOLEAN | false | 是否为上传链接 |
| `uploadToken` | TEXT | - | 上传令牌（唯一） |
| `maxUploadSize` | INTEGER | - | 单文件大小上限 |
| `uploadAllowedMimeTypes` | TEXT | - | 允许的 MIME 类型 (JSON) |
| `maxUploadCount` | INTEGER | - | 最多上传文件数 |
| `uploadCount` | INTEGER | 0 | 已上传文件数 |
| `createdAt` | TEXT | - | 创建时间 |

**索引**: `idx_shares_expires`, `idx_shares_user_created`, `idx_shares_file_active`, `idx_shares_upload_token`, `idx_shares_upload_link`

#### telegram_file_refs (Telegram 文件引用表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `fileId` | TEXT | - | OSSshelf 内部文件 ID |
| `r2Key` | TEXT | - | 与 files.r2Key 对应 (唯一) |
| `tgFileId` | TEXT | - | Telegram 返回的 file_id |
| `tgFileSize` | INTEGER | - | Telegram 报告的文件大小 |
| `bucketId` | TEXT | - | 所属存储桶 ID |
| `createdAt` | TEXT | - | 创建时间 |

**索引**: `idx_tg_refs_r2key`, `idx_tg_refs_file_id`, `idx_tg_refs_bucket`

#### telegram_file_chunks (Telegram 分片表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `groupId` | TEXT | - | 同一文件所有分片共享的 UUID |
| `chunkIndex` | INTEGER | - | 0-based 分片序号 |
| `tgFileId` | TEXT | - | Telegram file_id（此分片） |
| `chunkSize` | INTEGER | - | 此块字节数 |
| `bucketId` | TEXT | - | 所属存储桶 |
| `createdAt` | TEXT | - | 创建时间 |

**索引**: `idx_tg_chunks_group`

#### file_permissions (文件权限表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `fileId` | TEXT | - | 文件 ID (外键 → files) |
| `userId` | TEXT | - | 用户 ID (外键 → users) |
| `permission` | TEXT | 'read' | 权限 (read/write/admin) |
| `grantedBy` | TEXT | - | 授权人 ID (外键 → users) |
| `createdAt` | TEXT | - | 创建时间 |
| `updatedAt` | TEXT | - | 更新时间 |

**索引**: `idx_file_permissions_file`, `idx_file_permissions_user`, `idx_file_permissions_unique` (唯一)

#### file_tags (文件标签表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `fileId` | TEXT | - | 文件 ID (外键 → files) |
| `userId` | TEXT | - | 用户 ID (外键 → users) |
| `name` | TEXT | - | 标签名称 |
| `color` | TEXT | '#6366f1' | 标签颜色 |
| `createdAt` | TEXT | - | 创建时间 |

**索引**: `idx_file_tags_file`, `idx_file_tags_user_name`, `idx_file_tags_unique` (唯一)

#### upload_tasks (上传任务表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `userId` | TEXT | - | 用户 ID (外键 → users) |
| `fileName` | TEXT | - | 文件名 |
| `fileSize` | INTEGER | - | 文件大小 |
| `mimeType` | TEXT | - | MIME 类型 |
| `parentId` | TEXT | - | 父文件夹 ID |
| `bucketId` | TEXT | - | 存储桶 ID |
| `r2Key` | TEXT | - | 对象存储键 |
| `uploadId` | TEXT | - | 分片上传 ID |
| `totalParts` | INTEGER | - | 总分片数 |
| `uploadedParts` | TEXT | '[]' | 已上传分片 (JSON) |
| `status` | TEXT | 'pending' | 状态 |
| `progress` | INTEGER | 0 | 进度百分比 |
| `errorMessage` | TEXT | - | 错误信息 |
| `createdAt` | TEXT | - | 创建时间 |
| `updatedAt` | TEXT | - | 更新时间 |
| `expiresAt` | TEXT | - | 过期时间 |

**索引**: `idx_upload_tasks_user`, `idx_upload_tasks_expires`

#### download_tasks (离线下载任务表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `userId` | TEXT | - | 用户 ID (外键 → users) |
| `url` | TEXT | - | 下载 URL |
| `fileName` | TEXT | - | 文件名 |
| `fileSize` | INTEGER | - | 文件大小 |
| `parentId` | TEXT | - | 父文件夹 ID |
| `bucketId` | TEXT | - | 存储桶 ID |
| `status` | TEXT | 'pending' | 状态 |
| `progress` | INTEGER | 0 | 进度百分比 |
| `errorMessage` | TEXT | - | 错误信息 |
| `createdAt` | TEXT | - | 创建时间 |
| `updatedAt` | TEXT | - | 更新时间 |
| `completedAt` | TEXT | - | 完成时间 |

**索引**: `idx_download_tasks_user`, `idx_download_tasks_status`

#### user_devices (用户设备表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `userId` | TEXT | - | 用户 ID (外键 → users) |
| `deviceId` | TEXT | - | 设备 ID |
| `deviceName` | TEXT | - | 设备名称 |
| `deviceType` | TEXT | - | 设备类型 |
| `ipAddress` | TEXT | - | IP 地址 |
| `userAgent` | TEXT | - | User Agent |
| `lastActive` | TEXT | - | 最后活跃时间 |
| `createdAt` | TEXT | - | 创建时间 |

**索引**: `idx_user_devices_user`, `idx_user_devices_unique` (唯一)

#### login_attempts (登录尝试表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `email` | TEXT | - | 邮箱 |
| `ipAddress` | TEXT | - | IP 地址 |
| `success` | BOOLEAN | false | 是否成功 |
| `userAgent` | TEXT | - | User Agent |
| `createdAt` | TEXT | - | 创建时间 |

**索引**: `idx_login_attempts_email`, `idx_login_attempts_ip`

#### audit_logs (审计日志表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `userId` | TEXT | - | 用户 ID (外键, 可空) |
| `action` | TEXT | - | 操作类型 |
| `resourceType` | TEXT | - | 资源类型 |
| `resourceId` | TEXT | - | 资源 ID |
| `details` | TEXT | - | 详情 (JSON) |
| `ipAddress` | TEXT | - | IP 地址 |
| `userAgent` | TEXT | - | User Agent |
| `status` | TEXT | 'success' | 状态 |
| `errorMessage` | TEXT | - | 错误信息 |
| `createdAt` | TEXT | - | 创建时间 |

**索引**: `idx_audit_logs_user`, `idx_audit_logs_action`, `idx_audit_logs_resource`, `idx_audit_logs_created`

#### search_history (搜索历史表)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT | - | 主键 |
| `userId` | TEXT | - | 用户 ID (外键 → users) |
| `query` | TEXT | - | 搜索关键词 |
| `createdAt` | TEXT | - | 创建时间 |

**索引**: `idx_search_history_user`

---

## 系统常量

### 文件限制（定义于 `packages/shared/src/constants/index.ts`）

| 常量 | 值 | 说明 |
|------|-----|------|
| `MAX_FILE_SIZE` | 5 GB | S3 兼容存储单文件最大 |
| `DEFAULT_STORAGE_QUOTA` | 10 GB | 默认存储配额 |
| `UPLOAD_CHUNK_SIZE` | 10 MB | S3 分片大小 |
| `MULTIPART_THRESHOLD` | 100 MB | S3 分片上传阈值 |
| `MAX_CONCURRENT_PARTS` | 3 | 最大并发分片数 |

### Telegram 限制（定义于 `apps/api/src/lib/telegramClient.ts` 和 `telegramChunked.ts`）

| 常量 | 值 | 说明 |
|------|-----|------|
| `TG_MAX_FILE_SIZE` | 50 MB | Telegram 直传上限 |
| `TG_CHUNKED_THRESHOLD` | 49 MB | Telegram 分片阈值 |
| `TG_CHUNK_SIZE` | 30 MB | Telegram 分片大小 |
| `TG_MAX_CHUNKED_FILE_SIZE` | 2 GB | Telegram 最大文件 |

### 时间限制

| 常量 | 值 | 说明 |
|------|-----|------|
| `JWT_EXPIRY` | 7 天 | JWT 有效期 |
| `WEBDAV_SESSION_EXPIRY` | 30 天 | WebDAV 会话有效期 |
| `SHARE_DEFAULT_EXPIRY` | 7 天 | 分享默认有效期 |
| `TRASH_RETENTION_DAYS` | 30 天 | 回收站保留天数 |
| `DEVICE_SESSION_EXPIRY` | 30 天 | 设备会话有效期 |
| `UPLOAD_TASK_EXPIRY` | 24 小时 | 上传任务有效期 |

### 安全限制

| 常量 | 值 | 说明 |
|------|-----|------|
| `LOGIN_MAX_ATTEMPTS` | 5 | 最大登录尝试次数 |
| `LOGIN_LOCKOUT_DURATION` | 15 分钟 | 登录锁定时长 |

### 支持的存储提供商（定义于 `apps/api/src/routes/buckets.ts`）

| Provider | 名称 | 默认端点 | 路径样式 |
|----------|------|----------|----------|
| `r2` | Cloudflare R2 | `https://<accountId>.r2.cloudflarestorage.com` | false |
| `s3` | Amazon S3 | - | false |
| `oss` | Aliyun OSS | `https://oss-cn-hangzhou.aliyuncs.com` | false |
| `cos` | Tencent COS | `https://cos.ap-guangzhou.myqcloud.com` | false |
| `obs` | Huawei OBS | `https://obs.cn-north-4.myhuaweicloud.com` | false |
| `b2` | Backblaze B2 | `https://s3.us-west-004.backblazeb2.com` | true |
| `minio` | MinIO | `http://localhost:9000` | true |
| `custom` | 自定义 S3 兼容 | - | false |
| `telegram` | Telegram | - | false |

---

## API 路由（定义于 `apps/api/src/index.ts`）

| 路由前缀 | 模块 | 说明 |
|----------|------|------|
| `/api/auth` | auth.ts | 用户认证 |
| `/api/files` | files.ts | 文件管理 |
| `/api/buckets` | buckets.ts | 存储桶管理 |
| `/api/share` | share.ts | 文件分享 |
| `/api/direct` | directLink.ts | 文件直链 |
| `/api/presign` | presign.ts | 预签名 URL |
| `/api/tasks` | tasks.ts | 上传任务 |
| `/api/downloads` | downloads.ts | 离线下载 |
| `/api/batch` | batch.ts | 批量操作 |
| `/api/search` | search.ts | 文件搜索 |
| `/api/permissions` | permissions.ts | 权限与标签 |
| `/api/preview` | preview.ts | 文件预览 |
| `/api/admin` | admin.ts | 管理员接口 |
| `/api/migrate` | migrate.ts | 存储桶迁移 |
| `/api/telegram` | telegram.ts | Telegram 存储 |
| `/cron` | cron.ts | 定时任务 |
| `/dav` | webdav.ts | WebDAV 协议 |

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

## 定时任务

系统通过 Cloudflare Cron Triggers 执行定时任务（定义于 `apps/api/src/routes/cron.ts`）：

| 任务 | 触发时间 | 说明 |
|------|----------|------|
| 回收站清理 | 每天凌晨 3 点 | 清理超过 30 天的回收站文件 |
| 会话清理 | 每天凌晨 3 点 | 清理过期的会话和任务 |
| 分享清理 | 每天凌晨 3 点 | 清理过期的分享链接 |

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

限制允许的源，防止跨站请求伪造。

### 5. 安全头

使用 Hono secure-headers 中间件添加安全响应头。

### 6. 输入验证

使用 Zod 进行请求参数验证，防止注入攻击。

### 7. 审计日志

记录所有关键操作，便于追溯和安全审计。
