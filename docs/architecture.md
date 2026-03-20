# OSSshelf 架构文档

## 系统概述

OSSshelf 是一个基于 Cloudflare 部署的多厂商 OSS 文件管理系统，支持 WebDAV 协议。系统采用前后端分离架构，前端使用 React + Vite，后端使用 Hono 框架运行在 Cloudflare Workers 上。

## 技术栈

### 前端 (apps/web)

- **框架**: React 18
- **构建工具**: Vite 5
- **路由**: React Router DOM 6
- **状态管理**: Zustand 4
- **数据请求**: TanStack Query 5 + Axios
- **UI 组件**: Radix UI (Dialog, Dropdown Menu, Toast, Tooltip)
- **样式**: Tailwind CSS 3
- **图标**: Lucide React
- **文件拖放**: React Dropzone
- **Office 预览**: docx-preview

### 后端 (apps/api)

- **框架**: Hono 4
- **运行时**: Cloudflare Workers
- **数据库**: Cloudflare D1 (SQLite)
- **ORM**: Drizzle ORM 0.29
- **验证**: Zod 3
- **对象存储**: S3 兼容协议 (R2, AWS S3, 阿里云 OSS, 腾讯云 COS, 华为云 OBS, Backblaze B2, MinIO 等) + Telegram Bot API

### 共享包 (packages/shared)

- **构建工具**: tsup
- **内容**: 常量定义、类型定义、工具函数

## 项目结构

```
ossshelf/
├── apps/
│   ├── api/                    # 后端 API 服务
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── index.ts    # 数据库连接
│   │   │   │   └── schema.ts   # 表结构定义
│   │   │   ├── lib/
│   │   │   │   ├── audit.ts    # 审计日志
│   │   │   │   ├── bucketResolver.ts  # 存储桶解析
│   │   │   │   ├── cleanup.ts  # 清理任务
│   │   │   │   ├── crypto.ts   # 加密工具
│   │   │   │   ├── dedup.ts    # 文件去重
│   │   │   │   ├── folderPolicy.ts # 文件夹策略
│   │   │   │   ├── s3client.ts # S3 客户端
│   │   │   │   ├── telegramClient.ts # Telegram 客户端
│   │   │   │   ├── telegramChunked.ts # Telegram 分片上传
│   │   │   │   ├── utils.ts    # 工具函数
│   │   │   │   └── zipStream.ts # ZIP 流式打包
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts     # 认证中间件
│   │   │   │   ├── error.ts    # 错误处理
│   │   │   │   └── index.ts    # 中间件导出
│   │   │   ├── routes/         # API 路由
│   │   │   │   ├── admin.ts    # 管理员接口
│   │   │   │   ├── auth.ts     # 认证接口
│   │   │   │   ├── batch.ts    # 批量操作
│   │   │   │   ├── buckets.ts  # 存储桶管理
│   │   │   │   ├── cron.ts     # 定时任务
│   │   │   │   ├── downloads.ts # 离线下载
│   │   │   │   ├── files.ts    # 文件管理
│   │   │   │   ├── migrate.ts  # 存储桶迁移
│   │   │   │   ├── permissions.ts # 权限管理
│   │   │   │   ├── presign.ts  # 预签名 URL
│   │   │   │   ├── preview.ts  # 文件预览
│   │   │   │   ├── search.ts   # 文件搜索
│   │   │   │   ├── share.ts    # 文件分享
│   │   │   │   ├── tasks.ts    # 上传任务
│   │   │   │   ├── telegram.ts # Telegram 存储
│   │   │   │   └── webdav.ts   # WebDAV 协议
│   │   │   ├── types/
│   │   │   │   ├── env.ts      # 环境变量类型
│   │   │   │   └── index.ts    # 类型导出
│   │   │   └── index.ts        # 入口文件
│   │   ├── migrations/         # 数据库迁移
│   │   ├── drizzle.config.ts   # Drizzle 配置
│   │   ├── wrangler.toml.example # Wrangler 配置示例
│   │   └── package.json
│   └── web/                    # 前端应用
│       ├── src/
│       │   ├── components/     # UI 组件
│       │   │   ├── files/      # 文件相关组件
│       │   │   │   ├── ShareDialog.tsx # 分享对话框
│       │   │   │   └── ...
│       │   │   ├── layouts/    # 布局组件
│       │   │   └── ui/         # 通用 UI 组件
│       │   │       ├── MigrateBucketDialog.tsx # 迁移对话框
│       │   │       └── ...
│       │   ├── hooks/          # 自定义 Hooks
│       │   │   ├── useFolderUpload.ts # 文件夹上传
│       │   │   └── ...
│       │   ├── pages/          # 页面组件
│       │   │   ├── SharePage.tsx # 分享页面（含上传链接）
│       │   │   └── ...
│       │   ├── services/       # API 服务
│       │   ├── stores/         # Zustand 状态
│       │   └── main.tsx        # 入口文件
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── package.json
├── packages/
│   └── shared/                 # 共享代码
│       ├── src/
│       │   └── constants/
│       │       └── index.ts    # 常量定义
│       ├── tsup.config.ts
│       └── package.json
├── docs/                       # 文档
│   ├── api.md                  # API 文档
│   ├── architecture.md         # 架构文档
│   └── deployment.md           # 部署文档
└── package.json                # 根 package.json
```

## 数据库设计

### 表结构

#### users (用户表)

| 字段          | 类型    | 说明              |
| ------------- | ------- | ----------------- |
| id            | TEXT    | 主键              |
| email         | TEXT    | 邮箱 (唯一)       |
| password_hash | TEXT    | 密码哈希          |
| name          | TEXT    | 昵称              |
| role          | TEXT    | 角色 (user/admin) |
| storage_quota | INTEGER | 存储配额 (字节)   |
| storage_used  | INTEGER | 已用空间 (字节)   |
| created_at    | TEXT    | 创建时间          |
| updated_at    | TEXT    | 更新时间          |

#### files (文件表)

| 字段               | 类型    | 说明                 |
| ------------------ | ------- | -------------------- |
| id                 | TEXT    | 主键                 |
| user_id            | TEXT    | 所属用户             |
| parent_id          | TEXT    | 父文件夹 ID          |
| name               | TEXT    | 文件名               |
| path               | TEXT    | 文件路径             |
| type               | TEXT    | 文件类型             |
| size               | INTEGER | 文件大小             |
| r2_key             | TEXT    | 对象存储键           |
| mime_type          | TEXT    | MIME 类型            |
| hash               | TEXT    | 文件哈希（用于去重） |
| is_folder          | BOOLEAN | 是否为文件夹         |
| allowed_mime_types | TEXT    | 文件夹允许的上传类型 |
| ref_count          | INTEGER | 引用计数（去重机制） |
| bucket_id          | TEXT    | 所属存储桶 ID        |
| created_at         | TEXT    | 创建时间             |
| updated_at         | TEXT    | 更新时间             |
| deleted_at         | TEXT    | 删除时间 (回收站)    |

#### storage_buckets (存储桶表)

| 字段              | 类型    | 说明                     |
| ----------------- | ------- | ------------------------ |
| id                | TEXT    | 主键                     |
| user_id           | TEXT    | 所属用户                 |
| name              | TEXT    | 显示名称                 |
| provider          | TEXT    | 提供商 (s3/r2/oss/cos/telegram等) |
| bucket_name       | TEXT    | 存储桶名称               |
| endpoint          | TEXT    | 端点 URL                 |
| region            | TEXT    | 区域                     |
| access_key_id     | TEXT    | Access Key ID            |
| secret_access_key | TEXT    | Secret Access Key        |
| path_style        | BOOLEAN | 是否使用路径样式         |
| is_default        | BOOLEAN | 是否为默认存储桶         |
| is_active         | BOOLEAN | 是否启用                 |
| storage_used      | INTEGER | 已用空间                 |
| file_count        | INTEGER | 文件数量                 |
| storage_quota     | INTEGER | 存储配额                 |
| notes             | TEXT    | 备注                     |
| created_at        | TEXT    | 创建时间                 |
| updated_at        | TEXT    | 更新时间                 |

#### shares (分享表)

| 字段                     | 类型    | 说明                    |
| ------------------------ | ------- | ----------------------- |
| id                       | TEXT    | 主键                    |
| file_id                  | TEXT    | 关联文件 ID             |
| user_id                  | TEXT    | 创建者 ID               |
| password                 | TEXT    | 访问密码 (可选)         |
| expires_at               | TEXT    | 过期时间                |
| download_limit           | INTEGER | 下载次数限制            |
| download_count           | INTEGER | 已下载次数              |
| is_upload_link           | BOOLEAN | 是否为上传链接          |
| upload_token             | TEXT    | 上传令牌（唯一）        |
| max_upload_size          | INTEGER | 单文件大小上限          |
| upload_allowed_mime_types| TEXT    | 允许的 MIME 类型 (JSON) |
| max_upload_count         | INTEGER | 最多上传文件数          |
| upload_count             | INTEGER | 已上传文件数            |
| created_at               | TEXT    | 创建时间                |

#### telegram_file_refs (Telegram 文件引用表)

| 字段          | 类型    | 说明                     |
| ------------- | ------- | ------------------------ |
| id            | TEXT    | 主键                     |
| file_id       | TEXT    | OSSshelf 内部文件 ID     |
| r2_key        | TEXT    | 与 files.r2_key 对应     |
| tg_file_id    | TEXT    | Telegram 返回的 file_id  |
| tg_file_size  | INTEGER | Telegram 报告的文件大小  |
| bucket_id     | TEXT    | 所属存储桶 ID            |
| created_at    | TEXT    | 创建时间                 |

#### telegram_file_chunks (Telegram 分片表)

| 字段        | 类型    | 说明                     |
| ----------- | ------- | ------------------------ |
| id          | TEXT    | 主键                     |
| group_id    | TEXT    | 同一文件所有分片共享的 UUID |
| chunk_index | INTEGER | 0-based 分片序号         |
| tg_file_id  | TEXT    | Telegram file_id（此分片）|
| chunk_size  | INTEGER | 此块字节数               |
| bucket_id   | TEXT    | 所属存储桶               |
| created_at  | TEXT    | 创建时间                 |

#### file_permissions (文件权限表)

| 字段       | 类型 | 说明                    |
| ---------- | ---- | ----------------------- |
| id         | TEXT | 主键                    |
| file_id    | TEXT | 文件 ID                 |
| user_id    | TEXT | 用户 ID                 |
| permission | TEXT | 权限 (read/write/admin) |
| granted_by | TEXT | 授权人 ID               |
| created_at | TEXT | 创建时间                |
| updated_at | TEXT | 更新时间                |

#### file_tags (文件标签表)

| 字段       | 类型 | 说明     |
| ---------- | ---- | -------- |
| id         | TEXT | 主键     |
| file_id    | TEXT | 文件 ID  |
| user_id    | TEXT | 用户 ID  |
| name       | TEXT | 标签名称 |
| color      | TEXT | 标签颜色 |
| created_at | TEXT | 创建时间 |

#### upload_tasks (上传任务表)

| 字段           | 类型    | 说明              |
| -------------- | ------- | ----------------- |
| id             | TEXT    | 主键              |
| user_id        | TEXT    | 用户 ID           |
| file_name      | TEXT    | 文件名            |
| file_size      | INTEGER | 文件大小          |
| mime_type      | TEXT    | MIME 类型         |
| parent_id      | TEXT    | 父文件夹 ID       |
| bucket_id      | TEXT    | 存储桶 ID         |
| r2_key         | TEXT    | 对象存储键        |
| upload_id      | TEXT    | 分片上传 ID       |
| total_parts    | INTEGER | 总分片数          |
| uploaded_parts | TEXT    | 已上传分片 (JSON) |
| status         | TEXT    | 状态              |
| progress       | INTEGER | 进度百分比        |
| error_message  | TEXT    | 错误信息          |
| created_at     | TEXT    | 创建时间          |
| updated_at     | TEXT    | 更新时间          |
| expires_at     | TEXT    | 过期时间          |

#### download_tasks (离线下载任务表)

| 字段          | 类型    | 说明        |
| ------------- | ------- | ----------- |
| id            | TEXT    | 主键        |
| user_id       | TEXT    | 用户 ID     |
| url           | TEXT    | 下载 URL    |
| file_name     | TEXT    | 文件名      |
| file_size     | INTEGER | 文件大小    |
| parent_id     | TEXT    | 父文件夹 ID |
| bucket_id     | TEXT    | 存储桶 ID   |
| status        | TEXT    | 状态        |
| progress      | INTEGER | 进度百分比  |
| error_message | TEXT    | 错误信息    |
| created_at    | TEXT    | 创建时间    |
| updated_at    | TEXT    | 更新时间    |
| completed_at  | TEXT    | 完成时间    |

#### webdav_sessions (WebDAV 会话表)

| 字段       | 类型 | 说明     |
| ---------- | ---- | -------- |
| id         | TEXT | 主键     |
| user_id    | TEXT | 用户 ID  |
| token      | TEXT | 会话令牌 |
| expires_at | TEXT | 过期时间 |
| created_at | TEXT | 创建时间 |

#### user_devices (用户设备表)

| 字段        | 类型 | 说明         |
| ----------- | ---- | ------------ |
| id          | TEXT | 主键         |
| user_id     | TEXT | 用户 ID      |
| device_id   | TEXT | 设备 ID      |
| device_name | TEXT | 设备名称     |
| device_type | TEXT | 设备类型     |
| ip_address  | TEXT | IP 地址      |
| user_agent  | TEXT | User Agent   |
| last_active | TEXT | 最后活跃时间 |
| created_at  | TEXT | 创建时间     |

#### login_attempts (登录尝试表)

| 字段       | 类型    | 说明       |
| ---------- | ------- | ---------- |
| id         | TEXT    | 主键       |
| email      | TEXT    | 邮箱       |
| ip_address | TEXT    | IP 地址    |
| success    | BOOLEAN | 是否成功   |
| user_agent | TEXT    | User Agent |
| created_at | TEXT    | 创建时间   |

#### audit_logs (审计日志表)

| 字段          | 类型 | 说明        |
| ------------- | ---- | ----------- |
| id            | TEXT | 主键        |
| user_id       | TEXT | 用户 ID     |
| action        | TEXT | 操作类型    |
| resource_type | TEXT | 资源类型    |
| resource_id   | TEXT | 资源 ID     |
| details       | TEXT | 详情 (JSON) |
| ip_address    | TEXT | IP 地址     |
| user_agent    | TEXT | User Agent  |
| status        | TEXT | 状态        |
| error_message | TEXT | 错误信息    |
| created_at    | TEXT | 创建时间    |

## API 路由

| 路由前缀         | 模块           | 说明        |
| ---------------- | -------------- | ----------- |
| /api/auth        | auth.ts        | 用户认证    |
| /api/files       | files.ts       | 文件管理    |
| /api/buckets     | buckets.ts     | 存储桶管理  |
| /api/share       | share.ts       | 文件分享    |
| /api/presign     | presign.ts     | 预签名 URL  |
| /api/tasks       | tasks.ts       | 上传任务    |
| /api/downloads   | downloads.ts   | 离线下载    |
| /api/batch       | batch.ts       | 批量操作    |
| /api/search      | search.ts      | 文件搜索    |
| /api/permissions | permissions.ts | 权限与标签  |
| /api/preview     | preview.ts     | 文件预览    |
| /api/admin       | admin.ts       | 管理员接口  |
| /api/migrate     | migrate.ts     | 存储桶迁移  |
| /api/telegram    | telegram.ts    | Telegram 存储 |
| /cron            | cron.ts        | 定时任务    |
| /dav             | webdav.ts      | WebDAV 协议 |

## 核心功能架构

### Telegram 分片上传

Telegram Bot API 单文件限制为 50MB，通过分片上传机制突破此限制，最大支持 2GB：

```
前端                          Worker                        Telegram
  │                             │                              │
  │  POST /api/tasks/create     │                              │
  │ ──────────────────────────> │                              │
  │                             │  返回 isTelegramUpload=true   │
  │ <────────────────────────── │  totalParts, partSize        │
  │                             │                              │
  │  循环每个分片 (30MB)         │                              │
  │  POST /api/tasks/telegram-part                             │
  │ ──────────────────────────> │  sendDocument                │
  │                             │ ────────────────────────────> │
  │                             │ <──────────────────────────── │
  │ <────────────────────────── │  返回 tgFileId               │
  │                             │  存入 telegram_file_chunks    │
  │                             │                              │
  │  POST /api/tasks/complete   │                              │
  │ ──────────────────────────> │  校验分片完整性               │
  │                             │  写入 files + telegram_file_refs
  │ <────────────────────────── │                              │
```

**关键参数**:
- `TG_CHUNK_SIZE`: 30MB（单分片大小）
- `TG_MAX_CHUNKED_FILE_SIZE`: 2GB（最大文件大小）

### 存储桶迁移

支持在不同存储桶之间迁移文件，包括跨 provider 迁移：

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

**特性**:
- 流式拷贝，不落盘
- 实时进度追踪
- 支持取消
- 支持移动模式（迁移后删除来源）

### 文件夹分享

支持分享整个文件夹，浏览子文件并打包下载：

```
┌─────────────────────────────────────────────────────────────┐
│                   Folder Share Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  创建分享                                                     │
│  POST /api/share { fileId: folderId }                        │
│                                                              │
│  访问分享                                                     │
│  GET /api/share/:shareId                                     │
│  └─ 返回 children 列表（一层子文件）                          │
│                                                              │
│  下载单个子文件                                               │
│  GET /api/share/:shareId/file/:fileId/download               │
│                                                              │
│  打包下载                                                     │
│  GET /api/share/:shareId/zip?fileIds=id1,id2                 │
│  ├─ 收集文件（支持筛选）                                      │
│  ├─ ZipBuilder 流式打包                                      │
│  └─ 返回 ZIP 文件                                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**限制**:
- 单次 ZIP 最多 200 个文件
- ZIP 总大小不超过 500MB

### 上传链接

允许未登录用户向指定文件夹上传文件：

```
┌─────────────────────────────────────────────────────────────┐
│                   Upload Link Flow                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  创建上传链接                                                 │
│  POST /api/share/upload-link                                 │
│  ├─ folderId: 目标文件夹                                      │
│  ├─ maxUploadSize: 单文件大小上限                             │
│  ├─ allowedMimeTypes: 允许的文件类型                          │
│  └─ maxUploadCount: 最多上传数                                │
│                                                              │
│  获取上传链接信息                                             │
│  GET /api/share/upload/:token                                │
│                                                              │
│  上传文件                                                     │
│  POST /api/share/upload/:token                               │
│  ├─ 验证链接有效性                                           │
│  ├─ 检查文件大小限制                                         │
│  ├─ 检查 MIME 类型限制                                       │
│  ├─ 写入存储（以 folder owner 身份）                          │
│  └─ 更新 uploadCount                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 文件去重（Copy-on-Write）

相同 hash + bucketId 的文件共享存储对象：

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

**约束**:
- hash 为 null 的文件不参与去重
- 跨存储桶不去重
- 已软删除的文件不作为去重目标

## 系统常量

### 文件限制

| 常量                  | 值     | 说明           |
| --------------------- | ------ | -------------- |
| MAX_FILE_SIZE         | 5 GB   | 单文件最大大小 |
| DEFAULT_STORAGE_QUOTA | 10 GB  | 默认存储配额   |
| UPLOAD_CHUNK_SIZE     | 10 MB  | 分片上传大小   |
| MULTIPART_THRESHOLD   | 100 MB | 分片上传阈值   |
| MAX_CONCURRENT_PARTS  | 3      | 最大并发分片数 |
| TG_CHUNK_SIZE         | 30 MB  | Telegram 分片大小 |
| TG_MAX_CHUNKED_FILE_SIZE | 2 GB | Telegram 最大文件 |

### 时间限制

| 常量                  | 值      | 说明              |
| --------------------- | ------- | ----------------- |
| JWT_EXPIRY            | 7 天    | JWT 有效期        |
| WEBDAV_SESSION_EXPIRY | 30 天   | WebDAV 会话有效期 |
| SHARE_DEFAULT_EXPIRY  | 7 天    | 分享默认有效期    |
| TRASH_RETENTION_DAYS  | 30 天   | 回收站保留天数    |
| DEVICE_SESSION_EXPIRY | 30 天   | 设备会话有效期    |
| UPLOAD_TASK_EXPIRY    | 24 小时 | 上传任务有效期    |

### 安全限制

| 常量                   | 值      | 说明             |
| ---------------------- | ------- | ---------------- |
| LOGIN_MAX_ATTEMPTS     | 5       | 最大登录尝试次数 |
| LOGIN_LOCKOUT_DURATION | 15 分钟 | 登录锁定时长     |

### 支持的存储提供商

| Provider | 说明           |
| -------- | -------------- |
| r2       | Cloudflare R2  |
| s3       | AWS S3         |
| oss      | 阿里云 OSS     |
| cos      | 腾讯云 COS     |
| obs      | 华为云 OBS     |
| b2       | Backblaze B2   |
| minio    | MinIO          |
| custom   | 自定义 S3 兼容 |
| telegram | Telegram Bot API |

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

## 文件上传流程

### 小文件上传 (< 100MB)

1. 前端直接 POST 到 `/api/files/upload`
2. 后端代理上传到对象存储
3. 创建文件记录

### 大文件上传 (>= 100MB)

1. 前端调用 `/api/presign/upload` 获取预签名 URL
2. 如果返回 `useProxy: true`，使用代理模式
3. 如果返回预签名 URL，直接上传到对象存储
4. 上传完成后调用 `/api/presign/confirm` 确认

### 分片上传流程

1. 调用 `/api/presign/multipart/init` 初始化
2. 循环获取每个分片的上传 URL
3. 并发上传分片（最多 3 个并发）
4. 调用 `/api/presign/multipart/complete` 完成上传

### Telegram 分片上传流程

1. 调用 `/api/tasks/create`，返回 `isTelegramUpload: true`
2. 循环调用 `/api/tasks/telegram-part` 上传每个分片（30MB）
3. 调用 `/api/tasks/complete` 完成上传，后端写入文件记录

## 定时任务

系统通过 Cloudflare Cron Triggers 执行定时任务：

| 任务       | 触发时间      | 说明                       |
| ---------- | ------------- | -------------------------- |
| 回收站清理 | 每天凌晨 3 点 | 清理超过 30 天的回收站文件 |
| 会话清理   | 每天凌晨 3 点 | 清理过期的会话和任务       |
| 分享清理   | 每天凌晨 3 点 | 清理过期的分享链接         |

## 安全措施

1. **密码存储**: 使用 bcrypt 哈希存储密码
2. **JWT 签名**: 使用 JWT_SECRET 环境变量签名
3. **CORS**: 限制允许的源
4. **安全头**: 使用 Hono secure-headers 中间件
5. **输入验证**: 使用 Zod 进行请求参数验证
6. **审计日志**: 记录所有关键操作
7. **密钥加密**: 存储桶密钥使用 AES-GCM 加密存储
