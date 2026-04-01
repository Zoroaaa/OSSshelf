<div align="center">

# 🗄️ OSSshelf

**基于 Cloudflare 的多厂商 OSS 文件管理系统**

文件上传下载 · 在线预览 · 文件分享 · 多存储支持 · WebDAV 协议 · 权限管理 · 开放 API

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com)

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [部署指南](#-部署指南) • [API文档](#-api-文档)

</div>

---

## 📋 目录

- [功能特性](#-功能特性)
- [技术栈](#-技术栈)
- [系统限制](#-系统限制)
- [快速开始](#-快速开始)
- [部署指南](#-部署指南)
- [使用说明](#-使用说明)
- [项目结构](#-项目结构)
- [API 文档](#-api-文档)
- [开发命令](#-开发命令)
- [常见问题](#-常见问题)

---

## 📢 版本更新

详细的版本更新日志请参阅 [CHANGELOG.md](CHANGELOG.md)。

### 最新版本 v3.7.0

- **AI 功能集成**：文件摘要生成、图片智能描述、图片标签生成、智能重命名建议、语义搜索
- **移动端优化**：底部操作栏、搜索面板、响应式布局优化
- **预览组件拆分**：独立预览组件，提升代码可维护性

---

## ✨ 功能特性

- 📁 **文件管理**: 文件上传、下载、预览、移动、重命名、删除
- 🪣 **多存储支持**: 支持 Cloudflare R2、AWS S3、阿里云 OSS、腾讯云 COS、华为云 OBS、Backblaze B2、MinIO 等
- 📦 **Telegram 存储**: 通过 Telegram Bot API 存储文件，支持大文件分片上传（最大 2GB）
- 🔄 **大文件上传**: 分片上传、断点续传、秒传
- 🔗 **文件分享**: 支持文件/文件夹分享，密码保护、过期时间、下载次数限制
- 👁️ **分享预览**: 分享页面支持图片、视频、音频、PDF、文本等文件在线预览
- 🔗 **文件直链**: 为文件生成公开访问直链，支持设置有效期，无需登录即可访问
- 📤 **上传链接**: 创建公开上传链接，允许他人无需登录上传文件到指定文件夹
- 📁 **文件夹上传**: 支持拖拽上传整个文件夹，自动重建目录结构
- 📝 **文件预览**: 图片、视频、音频、PDF、Office 文档、代码高亮、EPUB 电子书、字体文件、ZIP 压缩包、CSV 表格
  - **图片**: JPEG/PNG/GIF/WebP/SVG/BMP/TIFF
  - **视频**: MP4/WebM/OGG/MOV/AVI/MKV
  - **音频**: MP3/WAV/OGG/AAC/FLAC/M4A
  - **PDF**: 分页预览、缩放控制
  - **Office**: Word/Excel/PowerPoint 本地渲染
  - **代码**: 50+ 编程语言语法高亮
  - **Markdown**: GFM 语法、数学公式、代码高亮
  - **EPUB**: 电子书阅读器、目录导航
  - **字体**: TTF/OTF/WOFF/WOFF2 字符预览
  - **ZIP**: 压缩包内容列表、文件树展示
  - **CSV**: 表格视图、搜索、排序、分页
- 📜 **版本控制**: 可编辑文本文件的版本历史管理、版本回滚（仅支持代码、配置、Markdown 等文本文件）
- 🔐 **权限管理 v2**: 用户组管理、权限继承、时效性权限、RBAC 权限模型
- 🔑 **API Keys**: 创建和管理 API 密钥，支持细粒度权限控制，实现程序化访问
- 🌐 **RESTful v1 API**: 标准化 API 接口，支持 OpenAPI 文档和 Swagger UI
- 🔔 **Webhook**: 文件事件订阅，支持第三方系统集成
- 💬 **文件笔记**: 为文件添加评论和笔记，支持 @提及和回复
- 🏷️ **标签系统**: 为文件添加自定义标签
- 🔍 **高级搜索**: 按名称、类型、大小、时间等条件搜索
- 🤖 **AI 功能**: 文件摘要、图片描述、智能标签、语义搜索、智能重命名
- 📥 **离线下载**: 支持 URL 离线下载到云存储
- 📡 **WebDAV**: 完整的 WebDAV 协议支持（优化 Windows 资源管理器兼容性）
- 🔄 **存储桶迁移**: 支持在不同存储桶之间迁移文件（跨 provider）
- 💾 **文件去重**: Copy-on-Write 机制，相同文件只存储一份
- 👥 **多用户**: 用户管理、存储配额、审计日志
- ⏰ **定时任务**: 自动清理回收站、过期分享
- 🗑️ **回收站**: 删除文件进入回收站，30 天保留期，支持恢复

### 🪣 支持的存储提供商

| 提供商        | 说明     | 特点           |
| ------------- | -------- | -------------- |
| Cloudflare R2 | 推荐     | 无出站流量费用 |
| AWS S3        | 标准兼容 | 全球部署       |
| 阿里云 OSS    | 国内优化 | 低延迟         |
| 腾讯云 COS    | 国内优化 | 低延迟         |
| 华为云 OBS    | 国内优化 | 低延迟         |
| Backblaze B2  | 高性价比 | 免费额度       |
| MinIO         | 私有部署 | 完全控制       |
| Telegram      | 免费     | 最大 2GB       |

---

## 🔧 技术栈

| 组件   | 技术                                 |
| ------ | ------------------------------------ |
| 前端   | React 18 + Vite 5 + Tailwind CSS 3   |
| 后端   | Hono 4 + Cloudflare Workers          |
| 数据库 | Cloudflare D1 (SQLite) + Drizzle ORM |
| 存储   | S3 兼容协议 + Telegram Bot API       |
| AI     | Cloudflare AI + Vectorize            |
| 认证   | JWT + bcrypt                         |

---

## ⚙️ 系统限制

以下常量定义于 `packages/shared/src/constants/index.ts` 和 `apps/api/src/lib/` 目录：

### 文件限制

| 常量                       | 值     | 说明                  | 定义位置                |
| -------------------------- | ------ | --------------------- | ----------------------- |
| `MAX_FILE_SIZE`            | 5 GB   | S3 兼容存储单文件最大 | shared/constants        |
| `DEFAULT_STORAGE_QUOTA`    | 10 GB  | 默认存储配额          | shared/constants        |
| `UPLOAD_CHUNK_SIZE`        | 10 MB  | S3 分片大小           | shared/constants        |
| `MULTIPART_THRESHOLD`      | 100 MB | S3 分片上传阈值       | shared/constants        |
| `MAX_CONCURRENT_PARTS`     | 3      | 最大并发分片数        | shared/constants        |
| `TG_MAX_FILE_SIZE`         | 50 MB  | Telegram 直传上限     | api/lib/telegramClient  |
| `TG_CHUNKED_THRESHOLD`     | 49 MB  | Telegram 分片阈值     | api/lib/telegramClient  |
| `TG_CHUNK_SIZE`            | 30 MB  | Telegram 分片大小     | api/lib/telegramChunked |
| `TG_MAX_CHUNKED_FILE_SIZE` | 2 GB   | Telegram 最大文件     | api/lib/telegramClient  |

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
| `LOGIN_MAX_ATTEMPTS`     | 5 次    | 最大登录尝试次数 |
| `LOGIN_LOCKOUT_DURATION` | 15 分钟 | 登录锁定时长     |

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0
- **Cloudflare 账户**（免费账户即可）

### 本地开发

```bash
# 1. 克隆项目
git clone https://github.com/your-repo/ossshelf.git
cd ossshelf

# 2. 安装依赖
pnpm install

# 3. 创建 Cloudflare 资源（本地开发）
wrangler login
wrangler d1 create ossshelf-db
wrangler kv:namespace create KV

# 4. 配置 wrangler.toml
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
# 编辑 wrangler.toml，填入 D1 数据库 ID 和 KV 命名空间 ID

# 5. 运行数据库迁移
pnpm db:migrate

# 6. 启动开发服务器
pnpm dev:api  # API 服务 (http://localhost:8787)
pnpm dev:web  # 前端服务 (http://localhost:5173)
```

### 访问地址

| 服务   | 地址                      |
| ------ | ------------------------- |
| 前端   | http://localhost:5173     |
| API    | http://localhost:8787     |
| WebDAV | http://localhost:8787/dav |

---

## 📦 部署指南

详细的部署文档请参阅 [docs/deployment.md](docs/deployment.md)。

### 前置准备

1. **Cloudflare 账户** - 注册 [Cloudflare](https://dash.cloudflare.com/sign-up)
2. **域名**（可选）- 绑定自定义域名
3. **存储服务** - 准备好至少一个存储提供商的凭证

### 一键部署步骤

```bash
# Step 1: 创建生产资源
wrangler d1 create ossshelf-db
wrangler kv:namespace create KV --preview false

# 记录输出的 database_id 和 id，填入 wrangler.toml
```

```bash
# Step 2: 配置 wrangler.toml
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
```

编辑 `apps/api/wrangler.toml`：

```toml
name = "ossshelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "你的D1数据库ID"  # ← 替换这里

[[kv_namespaces]]
binding = "KV"
id = "你的KV命名空间ID"  # ← 替换这里

[vars]
ENVIRONMENT = "production"
JWT_SECRET = "生成一个强随机字符串"  # ← 替换这里
CORS_ORIGINS = "https://your-frontend.pages.dev"  # ← 替换为你的前端域名

[triggers]
crons = ["0 3 * * *"]  # 每天凌晨3点清理
```

```bash
# Step 3: 设置加密密钥（用于加密存储桶凭证）
wrangler secret put ENCRYPTION_KEY
# 输入一个32字节的随机字符串，例如: openssl rand -base64 32

# Step 4: 运行数据库迁移
pnpm db:migrate

# Step 5: 部署 API
pnpm deploy:api

# Step 6: 构建并部署前端
pnpm build:web
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

### 部署验证

```bash
# 检查 API 是否正常运行
curl https://your-api.workers.dev/api/auth/registration-config

# 应返回: {"success":true,"data":{"open":true,"requireInviteCode":false}}
```

### 环境变量说明

| 变量名           | 必填 | 说明                                  |
| ---------------- | ---- | ------------------------------------- |
| `JWT_SECRET`     | ✅   | JWT 签名密钥，建议 32+ 字符随机字符串 |
| `ENCRYPTION_KEY` | ✅   | 存储桶凭证加密密钥，32 字节           |
| `CORS_ORIGINS`   | ✅   | CORS 允许域名，多个用逗号分隔         |

---

## 📖 使用说明

### 首次使用

> **重要**: 第一个注册的用户自动成为管理员，拥有完整管理权限。

### 存储桶配置

1. 登录后进入「设置」→「存储桶」
2. 点击「添加存储桶」
3. 选择存储提供商并填写配置：

#### Cloudflare R2 配置示例

```json
{
  "provider": "r2",
  "bucketName": "my-bucket",
  "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
  "region": "auto",
  "accessKeyId": "你的 Access Key ID",
  "secretAccessKey": "你的 Secret Access Key"
}
```

#### Telegram 配置步骤

1. 通过 [@BotFather](https://t.me/BotFather) 创建 Bot，获取 Token
2. 创建频道或群组，将 Bot 添加为管理员
3. 获取 Chat ID（转发消息到 [@userinfobot](https://t.me/userinfobot)）
4. 在存储桶管理中选择 Telegram 提供商：

```json
{
  "provider": "telegram",
  "bucketName": "Chat ID（如 -1001234567890）",
  "accessKeyId": "Bot Token（如 123456:ABC-DEF...）",
  "secretAccessKey": "telegram-no-secret"
}
```

### 文件上传

| 方式       | 说明                           |
| ---------- | ------------------------------ |
| 拖拽上传   | 直接拖入页面                   |
| 点击上传   | 点击上传按钮选择文件           |
| 文件夹上传 | 支持上传整个文件夹             |
| 大文件     | ≥ 100MB 自动分片，支持断点续传 |

### 文件分享

1. 右键点击文件/文件夹 → 选择「分享」
2. 设置选项：
   - 密码保护（可选）
   - 过期时间（可选）
   - 下载次数限制（可选）
3. 复制分享链接

### WebDAV 连接

| 配置项     | 值                            |
| ---------- | ----------------------------- |
| 服务器地址 | `https://your-domain.com/dav` |
| 用户名     | 注册邮箱                      |
| 密码       | 账户密码                      |
| 认证方式   | Basic Auth                    |

**Windows 资源管理器连接**：

1. 打开「此电脑」
2. 点击「映射网络驱动器」
3. 输入 WebDAV 地址
4. 输入邮箱和密码

### 管理员功能

管理员可在「管理」页面：

- 管理所有用户（查看、编辑配额、重置密码、删除）
- 控制注册开关（开放/关闭注册）
- 生成和管理邀请码
- 查看系统统计和审计日志

---

## 📁 项目结构

```
ossshelf/
├── apps/
│   ├── api/                    # 后端 API 服务
│   │   ├── src/
│   │   │   ├── db/             # 数据库
│   │   │   │   └── schema.ts   # 表结构定义
│   │   │   ├── lib/            # 核心库
│   │   │   │   ├── s3client.ts       # S3 客户端
│   │   │   │   ├── telegramClient.ts # Telegram 客户端
│   │   │   │   ├── telegramChunked.ts # Telegram 分片上传
│   │   │   │   ├── crypto.ts    # 加密工具
│   │   │   │   ├── dedup.ts     # 文件去重
│   │   │   │   ├── versionManager.ts # 版本管理 (v3.5.0)
│   │   │   │   ├── permissionResolver.ts # 权限解析 (v3.6.0)
│   │   │   │   ├── webhook.ts   # Webhook 分发 (v3.6.0)
│   │   │   │   ├── aiFeatures.ts # AI 功能 (v3.7.0)
│   │   │   │   ├── vectorIndex.ts # 向量索引 (v3.7.0)
│   │   │   │   └── cleanup.ts   # 清理任务
│   │   │   ├── middleware/     # 中间件
│   │   │   ├── routes/         # API 路由
│   │   │   │   ├── auth.ts      # 认证
│   │   │   │   ├── files.ts     # 文件管理
│   │   │   │   ├── buckets.ts   # 存储桶
│   │   │   │   ├── share.ts     # 分享
│   │   │   │   ├── directLink.ts # 文件直链
│   │   │   │   ├── tasks.ts     # 上传任务
│   │   │   │   ├── presign.ts   # 预签名
│   │   │   │   ├── search.ts    # 搜索
│   │   │   │   ├── permissions.ts # 权限与标签
│   │   │   │   ├── batch.ts     # 批量操作
│   │   │   │   ├── downloads.ts # 离线下载
│   │   │   │   ├── preview.ts   # 预览
│   │   │   │   ├── versions.ts  # 版本控制 (v3.3.0)
│   │   │   │   ├── notes.ts     # 文件笔记 (v3.5.0)
│   │   │   │   ├── apiKeys.ts   # API Keys 管理 (v3.5.0)
│   │   │   │   ├── groups.ts    # 用户组管理 (v3.6.0)
│   │   │   │   ├── webhooks.ts  # Webhook 管理 (v3.6.0)
│   │   │   │   ├── ai.ts        # AI 功能 (v3.7.0)
│   │   │   │   ├── v1/          # RESTful v1 API (v3.6.0)
│   │   │   │   │   ├── index.ts
│   │   │   │   │   ├── files.ts
│   │   │   │   │   ├── folders.ts
│   │   │   │   │   ├── shares.ts
│   │   │   │   │   ├── search.ts
│   │   │   │   │   └── me.ts
│   │   │   │   ├── admin.ts     # 管理员
│   │   │   │   ├── migrate.ts   # 迁移
│   │   │   │   ├── telegram.ts  # Telegram
│   │   │   │   ├── cron.ts      # 定时任务
│   │   │   │   └── webdav.ts    # WebDAV
│   │   │   └── index.ts        # 入口
│   │   ├── migrations/         # 数据库迁移
│   │   │   ├── 0001_init.sql
│   │   │   ├── 0002_optimization.sql
│   │   │   ├── 0003_folder_upload_types.sql
│   │   │   ├── 0004_telegram_storage.sql
│   │   │   ├── 0005_dedup_and_upload_links.sql
│   │   │   ├── 0006_upload_progress.sql
│   │   │   ├── 0007_phase7.sql
│   │   │   ├── 0010_notes.sql   # 文件笔记 (v3.5.0)
│   │   │   ├── 0011_api_keys.sql # API Keys (v3.5.0)
│   │   │   ├── 0012_permission_v2.sql # 权限系统 v2 (v3.6.0)
│   │   │   ├── 0014_ai_features.sql # AI 功能 (v3.7.0)
│   │   └── wrangler.toml       # Cloudflare 配置
│   └── web/                    # 前端应用
│       ├── src/
│       │   ├── components/     # UI 组件
│       │   │   ├── ai/         # AI 组件 (v3.7.0)
│       │   │   ├── notes/      # 笔记组件 (v3.5.0)
│       │   │   ├── editor/     # 编辑器组件 (v3.5.0)
│       │   │   ├── groups/     # 用户组组件 (v3.6.0)
│       │   │   ├── webhooks/   # Webhook 组件 (v3.6.0)
│       │   │   ├── permissions/ # 权限组件 (v3.6.0)
│       │   │   ├── files/      # 文件组件
│       │   │   │   ├── filepreview/ # 预览组件 (v3.7.0 拆分)
│       │   │   └── settings/   # 设置组件
│       │   ├── hooks/          # 自定义 Hooks
│       │   ├── pages/          # 页面组件
│       │   ├── services/       # API 服务
│       │   └── stores/         # 状态管理
│       └── vite.config.ts
├── packages/
│   └── shared/                 # 共享代码
│       └── src/
│           └── constants/
│               └── index.ts    # 常量定义
└── docs/                       # 文档
    ├── api.md                  # API 文档
    ├── api-key-guide.md        # API Key 使用指南 (v3.5.0)
    ├── architecture.md         # 架构文档
    └── deployment.md           # 部署文档
```

---

## 📚 API 文档

详细的 API 文档请参阅 [docs/api.md](docs/api.md)。

### API 路由概览

| 路由前缀           | 说明                    |
| ------------------ | ----------------------- |
| `/api/auth`        | 用户认证                |
| `/api/files`       | 文件管理                |
| `/api/buckets`     | 存储桶管理              |
| `/api/share`       | 文件分享                |
| `/api/direct`      | 文件直链                |
| `/api/presign`     | 预签名 URL              |
| `/api/tasks`       | 上传任务                |
| `/api/downloads`   | 离线下载                |
| `/api/batch`       | 批量操作                |
| `/api/search`      | 文件搜索                |
| `/api/permissions` | 权限与标签              |
| `/api/preview`     | 文件预览                |
| `/api/versions`    | 版本控制 (v3.3.0)       |
| `/api/notes`       | 文件笔记 (v3.5.0)       |
| `/api/api-keys`    | API Keys 管理 (v3.5.0)  |
| `/api/groups`      | 用户组管理 (v3.6.0)     |
| `/api/webhooks`    | Webhook 管理 (v3.6.0)   |
| `/api/ai`          | AI 功能 (v3.7.0)        |
| `/api/v1`          | RESTful v1 API (v3.6.0) |
| `/api/v1/docs`     | OpenAPI 文档 (v3.6.0)   |
| `/api/admin`       | 管理员接口              |
| `/api/migrate`     | 存储桶迁移              |
| `/api/telegram`    | Telegram 存储           |
| `/cron`            | 定时任务                |
| `/dav`             | WebDAV                  |

---

## 💻 开发命令

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
pnpm db:migrate   # 运行数据库迁移（生产）
pnpm db:studio    # 打开 Drizzle Studio

# 代码质量
pnpm lint         # 运行 ESLint
pnpm lint:fix     # 自动修复 ESLint 问题
pnpm format       # 格式化代码
pnpm typecheck    # 类型检查
```

---

## ❓ 常见问题

### Q: 忘记密码怎么办？

A: 联系管理员重置密码。如果是管理员忘记密码，需要通过数据库直接修改密码哈希。

### Q: 文件删除后能恢复吗？

A: 文件删除后进入回收站，保留 30 天。在此期间可以从回收站恢复。

### Q: 存储配额不够怎么办？

A: 联系管理员增加配额，或清理不需要的文件。

### Q: Telegram 存储有什么限制？

A: 单文件最大 2GB，无法真正删除文件（仅删除消息引用），需要稳定的网络连接。

### Q: WebDAV 连接失败？

A:

1. 确认用户名密码正确（用户名是注册邮箱）
2. 检查 Basic Auth 是否启用
3. 确认 Workers 域名已配置 SSL

### Q: 上传失败？

A:

1. 检查存储桶配置是否正确
2. 确认 Access Key/Secret Key 权限
3. 检查 CORS 配置

### Q: 定时任务不执行？

A:

1. 确认 Cron Triggers 已配置
2. 检查 wrangler.toml 中的 crons 配置
3. 查看 Workers 日志排查错误

---

## 🔄 更新流程

如果你 Fork 了本项目，当上游有更新时：

```bash
# 1. 添加上游仓库（仅需一次）
git remote add upstream https://github.com/original-repo/ossshelf.git

# 2. 拉取上游更新
git fetch upstream
git merge upstream/main

# 3. 检查是否有新的数据库迁移文件
ls apps/api/migrations/

# 4. 如果有新的迁移文件，执行迁移
pnpm db:migrate

# 5. 重新部署
pnpm deploy:api
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

---

## 📄 许可证

[MIT](LICENSE)

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐️ Star 支持一下！**

</div>
