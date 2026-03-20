# OSSshelf

基于 Cloudflare 部署的多厂商 OSS 文件管理系统，支持 WebDAV 协议。

## 功能特性

- 📁 **文件管理**: 文件上传、下载、预览、移动、重命名、删除
- 🪣 **多存储支持**: 支持 Cloudflare R2、AWS S3、阿里云 OSS、腾讯云 COS、华为云 OBS、Backblaze B2、MinIO 等
- 📦 **Telegram 存储**: 通过 Telegram Bot API 存储文件，支持大文件分片上传（最大2GB）
- 🔄 **大文件上传**: 分片上传、断点续传、秒传
- 🔗 **文件分享**: 支持文件/文件夹分享，密码保护、过期时间、下载次数限制
- 📤 **上传链接**: 创建公开上传链接，允许他人无需登录上传文件到指定文件夹
- 📁 **文件夹上传**: 支持拖拽上传整个文件夹，自动重建目录结构
- 📝 **文件预览**: 图片、视频、音频、PDF、Office 文档、代码高亮
- 🔐 **权限管理**: 文件/文件夹级别的权限控制
- 🏷️ **标签系统**: 为文件添加自定义标签
- 🔍 **高级搜索**: 按名称、类型、大小、时间等条件搜索
- 📥 **离线下载**: 支持 URL 离线下载到云存储
- 📡 **WebDAV**: 完整的 WebDAV 协议支持（优化 Windows 资源管理器兼容性）
- 🔄 **存储桶迁移**: 支持在不同存储桶之间迁移文件（跨 provider）
- 💾 **文件去重**: Copy-on-Write 机制，相同文件只存储一份
- 👥 **多用户**: 用户管理、存储配额、审计日志
- ⏰ **定时任务**: 自动清理回收站、过期分享

## 技术栈

| 组件   | 技术                                     |
| ------ | ---------------------------------------- |
| 前端   | React 18 + Vite 5 + Tailwind CSS 3       |
| 后端   | Hono 4 + Cloudflare Workers              |
| 数据库 | Cloudflare D1 (SQLite) + Drizzle ORM     |
| 存储   | S3 兼容协议 (R2/S3/OSS/COS/OBS/B2/MinIO) + Telegram Bot API |
| 认证   | JWT + bcrypt                             |

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Cloudflare 账户

### 安装

```bash
# 克隆项目
git clone https://github.com/your-repo/ossshelf.git
cd ossshelf

# 安装依赖
pnpm install

# 配置环境变量
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
# 编辑 wrangler.toml，填入 D1 数据库 ID 和 KV 命名空间 ID

# 创建数据库
wrangler d1 create ossshelf-db
wrangler kv:namespace create KV

# 运行迁移
pnpm db:migrate:local

# 启动开发服务器
pnpm dev:api  # API 服务
pnpm dev:web  # 前端服务
```

### 访问

- 前端: http://localhost:5173
- API: http://localhost:8787

## 项目结构

```
ossshelf/
├── apps/
│   ├── api/          # 后端 API (Hono + Cloudflare Workers)
│   └── web/          # 前端应用 (React + Vite)
├── packages/
│   └── shared/       # 共享代码 (常量、类型)
└── docs/             # 文档
    ├── api.md        # API 文档
    ├── architecture.md # 架构文档
    └── deployment.md # 部署文档
```

## 主要功能

### 文件管理

- 拖拽上传、文件夹上传
- 大文件分片上传（>= 100MB 自动启用）
- 文件预览（图片、视频、音频、PDF、Office、代码）
- 文件夹上传类型限制
- 回收站（30天保留期）
- 文件去重（Copy-on-Write）

### 存储桶管理

- 支持多个存储桶同时配置
- 每个存储桶可独立设置配额
- 支持的存储提供商：
  - Cloudflare R2
  - AWS S3
  - 阿里云 OSS
  - 腾讯云 COS
  - 华为云 OBS
  - Backblaze B2
  - MinIO
  - 自定义 S3 兼容存储
  - Telegram (通过 Bot API)
- **存储桶迁移**: 支持在不同存储桶之间迁移文件，支持跨 provider 迁移

### Telegram 存储

通过 Telegram Bot API 存储文件，利用 Telegram 的免费存储资源：

**配置方法**：
1. 创建一个 Telegram Bot（通过 @BotFather）
2. 获取 Bot Token
3. 创建一个频道或群组，将 Bot 添加为管理员
4. 获取 Chat ID（频道/群组/私聊的 ID）
5. 在存储桶管理中选择 Telegram 提供商并填入配置

**特点**：
- 支持自定义 Bot API 代理地址
- 自动根据文件类型选择合适的上传方式
- 支持文件预览和下载
- 静默发送，不打扰聊天
- **大文件分片上传**: 超过 49MB 的文件自动分片上传，最大支持 2GB

**限制**：
- 单文件最大 2GB（分片上传）
- 单分片最大 30MB
- 无法真正删除文件，只能删除消息引用
- 需要稳定的网络连接到 Telegram API

### 文件分享

#### 下载分享

- 公开/私密分享
- 密码保护
- 过期时间设置
- 下载次数限制
- **文件夹分享**: 支持浏览文件夹内容，可选择下载单个文件或打包 ZIP 下载全部/部分文件

#### 上传链接

- 创建公开上传链接，无需登录即可上传
- 支持密码保护、过期时间
- 可设置单文件大小上限
- 可设置允许的文件类型
- 可设置最多上传文件数
- 自动继承目标文件夹的类型限制

### 权限系统

- 三级权限：只读、读写、管理
- 文件/文件夹级别授权
- 权限继承

### WebDAV

完整支持 WebDAV 协议，可使用任何 WebDAV 客户端连接，特别优化了 Windows 资源管理器兼容性：

| 配置项     | 值                            |
| ---------- | ----------------------------- |
| 服务器地址 | `https://your-domain.com/dav` |
| 用户名     | 注册邮箱                      |
| 密码       | 账户密码                      |
| 认证方式   | Basic Auth                    |

**Windows 资源管理器优化**：
- 修复 401 响应必须携带 DAV 头的问题
- 确保 PROPFIND 响应路径与请求路径精确匹配
- 实现 LOCK/UNLOCK 操作，解决 Windows 写操作卡死问题

支持的操作：PROPFIND、GET、HEAD、PUT、MKCOL、DELETE、MOVE、COPY、LOCK、UNLOCK、PROPPATCH

### 管理员功能

- 用户管理（查看、编辑、删除）
- 注册开关控制
- 邀请码系统
- 系统统计
- 审计日志

## API 文档

详细的 API 文档请参阅 [docs/api.md](docs/api.md)。

### API 路由概览

| 路由前缀         | 说明       |
| ---------------- | ---------- |
| /api/auth        | 用户认证   |
| /api/files       | 文件管理   |
| /api/buckets     | 存储桶管理 |
| /api/share       | 文件分享   |
| /api/presign     | 预签名 URL |
| /api/tasks       | 上传任务   |
| /api/downloads   | 离线下载   |
| /api/batch       | 批量操作   |
| /api/search      | 文件搜索   |
| /api/permissions | 权限管理   |
| /api/preview     | 文件预览   |
| /api/admin       | 管理员接口 |
| /api/migrate     | 存储桶迁移 |
| /api/telegram    | Telegram 存储 |
| /cron            | 定时任务    |
| /dav             | WebDAV     |

## 部署

详细的部署文档请参阅 [docs/deployment.md](docs/deployment.md)。

### 快速部署

```bash
# 创建生产资源
wrangler d1 create ossshelf-db
wrangler kv:namespace create KV --preview false

# 配置 wrangler.toml
# 运行迁移
pnpm db:migrate

# 部署 API
pnpm deploy:api

# 构建并部署前端
pnpm build:web
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

## 系统限制

| 限制项            | 值      |
| ----------------- | ------- |
| 单文件最大大小    | 5 GB    |
| 默认存储配额      | 10 GB   |
| 分片上传阈值      | 100 MB  |
| 分片大小          | 10 MB   |
| 最大并发分片      | 3       |
| JWT 有效期        | 7 天    |
| WebDAV 会话有效期 | 30 天   |
| 回收站保留期      | 30 天   |
| 登录失败锁定次数  | 5 次    |
| 登录锁定时长      | 15 分钟 |
| Telegram 单文件上限 | 2 GB   |
| Telegram 单分片大小 | 30 MB  |

## 上传逻辑详解

### S3 兼容存储上传流程

S3 兼容存储（R2、AWS S3、阿里云 OSS、腾讯云 COS、华为云 OBS、Backblaze B2、MinIO 等）采用统一的上传逻辑：

#### 常量定义

| 常量 | 值 | 说明 |
| ---- | -- | ---- |
| `MULTIPART_THRESHOLD` | 100 MB | 分片上传阈值 |
| `UPLOAD_CHUNK_SIZE` | 10 MB | 分片大小 |
| `MAX_FILE_SIZE` | 5 GB | 单文件最大限制 |

#### 上传流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                      文件上传请求                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  文件大小判断    │
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
    │ 1. POST /create │             │ 1. POST /create │
    │    获取预签名URL │             │    创建分片任务  │
    │                 │             │    uploadId     │
    │ 2. PUT 直传     │             │                 │
    │    到 S3        │             │ 2. 循环上传分片  │
    │                 │             │    POST /part   │
    │ 3. POST /complete│            │    获取预签名URL │
    │    完成任务      │             │    PUT 分片到S3 │
    │                 │             │                 │
    │                 │             │ 3. POST /complete│
    │                 │             │    合并分片      │
    └─────────────────┘             └─────────────────┘
```

#### API 调用详情

**小文件上传（≤ 100 MB）**：

1. `POST /api/tasks/create` → 返回 `{ uploadUrl, taskId, isSmallFile: true }`
2. `PUT {uploadUrl}` → 直接上传文件到 S3
3. `POST /api/tasks/complete` → 完成任务，写入文件记录

**大文件分片上传（> 100 MB）**：

1. `POST /api/tasks/create` → 返回 `{ uploadId, taskId, totalParts, firstPartUrl }`
2. 循环调用：
   - `GET /api/tasks/part?taskId=&partNumber=` → 获取分片预签名 URL
   - `PUT {partUrl}` → 上传分片到 S3
   - `POST /api/tasks/part-done` → 记录分片完成
3. `POST /api/tasks/complete` → 合并分片，写入文件记录

---

### Telegram 存储上传流程

Telegram 存储通过 Bot API 实现，采用与 S3 类似但独立的分片逻辑：

#### 常量定义

| 常量 | 值 | 说明 |
| ---- | -- | ---- |
| `TG_CHUNK_THRESHOLD` | 50 MB | 分片上传阈值 |
| `TG_CHUNK_SIZE` | 30 MB | 分片大小 |
| `TG_MAX_FILE_SIZE` | 50 MB | 单文件直传上限（Bot API 限制） |
| `TG_MAX_CHUNKED_FILE_SIZE` | 2 GB | 分片上传文件上限 |

#### 上传流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                      文件上传请求                                │
│                  (bucketId 指向 Telegram 桶)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  文件大小判断    │
                    └─────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │  ≤ 50 MB        │             │  > 50 MB        │
    │  小文件模式      │             │  分片上传模式    │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ uploadId        │             │ uploadId        │
    │ = 'telegram'    │             │ = 'telegram-    │
    │                 │             │   chunked:xxx'  │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ 1. POST /create │             │ 1. POST /create │
    │    isSmallFile  │             │    totalParts   │
    │    = true       │             │    = ceil(size  │
    │                 │             │      / 30MB)    │
    │ 2. POST         │             │                 │
    │    /telegram-   │             │ 2. 循环上传分片  │
    │    part         │             │    POST         │
    │    (整个文件)    │             │    /telegram-   │
    │                 │             │    part         │
    │ 3. POST /complete│            │    (每片≤30MB)  │
    │    写入文件记录  │             │                 │
    │    + TG引用     │             │ 3. POST /complete│
    │                 │             │    写入文件记录  │
    │                 │             │    + TG引用     │
    │                 │             │    + 分片记录    │
    └─────────────────┘             └─────────────────┘
```

#### API 调用详情

**小文件上传（≤ 50 MB）**：

1. `POST /api/tasks/create` → 返回 `{ taskId, uploadId: 'telegram', isSmallFile: true, isTelegramUpload: true }`
2. `POST /api/tasks/telegram-part` (multipart/form-data)
   - 字段：`taskId`, `partNumber=1`, `chunk=文件`
   - 直接上传整个文件到 Telegram
3. `POST /api/tasks/complete` → 写入 `files` 表 + `telegramFileRefs` 表

**大文件分片上传（> 50 MB）**：

1. `POST /api/tasks/create` → 返回 `{ taskId, uploadId: 'telegram-chunked:xxx', totalParts, isTelegramUpload: true }`
2. 循环调用 `POST /api/tasks/telegram-part` (multipart/form-data)：
   - 字段：`taskId`, `partNumber`, `chunk=分片`
   - 每个分片独立上传到 Telegram
   - 分片记录写入 `telegramFileChunks` 表
3. `POST /api/tasks/complete` → 校验分片完整性，写入文件记录

#### 数据库表结构

| 表名 | 说明 |
| ---- | ---- |
| `files` | 文件元数据（所有存储类型共用） |
| `telegramFileRefs` | Telegram 文件引用（tgFileId 映射） |
| `telegramFileChunks` | Telegram 分片记录（大文件分片信息） |

#### 分片下载逻辑

下载时根据 `tgFileId` 前缀判断：

- 普通 `tgFileId`：直接调用 Telegram API 下载
- `chunked:xxx` 前缀：从 `telegramFileChunks` 读取分片列表，按顺序下载并合并

---

### 前端上传逻辑

前端 `presignUpload.ts` 根据后端返回的标志选择上传路径：

```typescript
// 判断是否需要分片
if (file.size > MULTIPART_THRESHOLD) {
  // S3 分片上传
  return multipartUpload({ ... });
}

// 小文件上传
const init = await apiPost('/api/tasks/create', { ... });

if (init.isTelegramUpload) {
  // Telegram 上传（小文件或分片）
  return telegramProxyUpload({ ... });
}

if (init.uploadUrl) {
  // S3 直传
  await directPut(init.uploadUrl, file, ...);
}
```

### 关键差异对比

| 特性 | S3 兼容存储 | Telegram 存储 |
| ---- | ---------- | ------------- |
| 分片阈值 | 100 MB | 50 MB |
| 分片大小 | 10 MB | 30 MB |
| 单文件上限 | 5 GB | 2 GB |
| 直传方式 | 预签名 URL | 代理上传 |
| 分片存储 | S3 服务端合并 | 独立消息 + 虚拟合并 |
| 删除支持 | 完整删除 | 仅删除引用 |

## 开发命令

```bash
# 开发
pnpm dev:web      # 启动前端开发服务器
pnpm dev:api      # 启动 API 开发服务器

# 构建
pnpm build:web    # 构建前端
pnpm build:api    # 构建 API

# 部署
pnpm deploy:api   # 部署 API 到 Cloudflare Workers

# 数据库
pnpm db:generate  # 生成数据库迁移
pnpm db:migrate   # 运行数据库迁移
pnpm db:studio    # 打开 Drizzle Studio

# 代码质量
pnpm lint         # 运行 ESLint
pnpm lint:fix     # 自动修复 ESLint 问题
pnpm format       # 格式化代码
pnpm typecheck    # 类型检查
```

## 文档

- [API 文档](docs/api.md) - 完整的 API 接口文档
- [架构文档](docs/architecture.md) - 系统架构和数据库设计
- [部署文档](docs/deployment.md) - 部署和运维指南

## 许可证

MIT
