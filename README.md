# OSSshelf

<p align="center">
  <strong>基于 Cloudflare 部署的多厂商 OSS 文件管理系统</strong><br>
  <sub>统一管理主流对象存储 · 支持 WebDAV 协议 · 安全分享 · 响应式界面</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-18-61dafb?logo=react" alt="React">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## 目录

- [功能特性](#功能特性)
- [技术架构](#技术架构)
- [支持的存储厂商](#支持的存储厂商)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [API 文档](#api-文档)
- [WebDAV 使用](#webdav-使用)
- [部署指南](#部署指南)
- [开发指南](#开发指南)

---

## 功能特性

### 核心功能

| 功能 | 描述 |
|------|------|
| 📁 **文件管理** | 上传、下载、重命名、移动、删除文件和文件夹，支持拖拽上传 |
| 🔗 **文件分享** | 创建分享链接，支持密码保护、过期时间、下载次数限制 |
| 🗑️ **回收站** | 软删除机制，支持恢复已删除文件，可永久删除或清空 |
| 📊 **存储配额** | 用户级别和存储桶级别的存储空间管理 |
| 🔍 **搜索排序** | 按名称搜索文件，支持名称/大小/时间排序 |
| 🌐 **多厂商支持** | 统一管理多个云存储厂商的存储桶 |
| 🔄 **存储桶切换** | 灵活的存储桶分配和默认存储桶设置 |

### WebDAV 支持

完整实现 [RFC 4918](https://datatracker.ietf.org/doc/html/rfc4918) WebDAV 协议，兼容主流客户端：

| 方法 | 功能 |
|------|------|
| `PROPFIND` | 列出目录内容 |
| `GET/HEAD` | 下载文件 |
| `PUT` | 上传文件 |
| `MKCOL` | 创建文件夹 |
| `DELETE` | 删除文件/文件夹 |
| `MOVE` | 移动/重命名 |
| `COPY` | 复制文件 |

**兼容客户端**: Windows 资源管理器、macOS Finder、Cyberduck、WinSCP、rclone 等

### 界面特性

- 🌙 深色/浅色主题自动适配
- 📱 响应式设计，支持移动端
- ⚡ 实时上传进度显示
- 🖼️ 图片/视频/音频/PDF 在线预览
- 📂 文件夹拖拽上传
- 🗃️ 多存储桶管理界面

---

## 技术架构

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  React 18 + TypeScript + Tailwind CSS + Zustand     │   │
│  │  React Query + Radix UI + Vite                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        API 服务层                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Hono Framework + Cloudflare Workers                 │   │
│  │  REST API + WebDAV Protocol                          │   │
│  │  S3 兼容存储客户端（多厂商支持）                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Cloudflare D1  │ │  多厂商对象存储   │ │  Cloudflare KV  │
│   (SQLite)      │ │  (S3 兼容 API)   │ │   (Cache)       │
│                 │ │                 │ │                 │
│  - 用户数据     │ │  - 文件内容     │ │  - Session      │
│  - 文件元数据   │ │  - 支持大文件   │ │  - 临时缓存     │
│  - 存储桶配置   │ │  - 跨厂商兼容   │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 技术栈详情

#### 前端 (apps/web)

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.2 | UI 框架 |
| TypeScript | 5.3 | 类型安全 |
| Vite | 5.1 | 构建工具 |
| Tailwind CSS | 3.4 | 样式框架 |
| Zustand | 4.5 | 状态管理 |
| React Query | 5.24 | 服务端状态 |
| React Router | 6.22 | 路由管理 |
| Radix UI | - | 无障碍组件 |
| Lucide | - | 图标库 |
| Axios | 1.6 | HTTP 客户端 |

#### 后端 (apps/api)

| 技术 | 版本 | 用途 |
|------|------|------|
| Hono | 4.0 | Web 框架 |
| Cloudflare Workers | - | Serverless 运行时 |
| Drizzle ORM | 0.29 | 数据库 ORM |
| Zod | 3.22 | 参数验证 |
| JWT | - | 身份认证 |

#### 云服务

| 服务 | 用途 |
|------|------|
| Cloudflare D1 | SQLite 数据库，存储用户、文件元数据和存储桶配置 |
| Cloudflare KV | 键值存储，Session 管理 |
| 多厂商对象存储 | 通过 S3 兼容 API 存储文件内容 |

---

## 支持的存储厂商

OSSshelf 通过统一的 S3 兼容 API 接口，支持以下主流对象存储服务：

| 厂商 | 标识 | 说明 |
|------|------|------|
| Cloudflare R2 | `r2` | Cloudflare 原生对象存储 |
| Amazon S3 | `s3` | AWS 标准对象存储服务 |
| 阿里云 OSS | `oss` | 阿里云对象存储服务 |
| 腾讯云 COS | `cos` | 腾讯云对象存储服务 |
| 华为云 OBS | `obs` | 华为云对象存储服务 |
| Backblaze B2 | `b2` | Backblaze 云存储 |
| MinIO | `minio` | 开源对象存储服务器 |
| 自定义 S3 兼容 | `custom` | 其他支持 S3 协议的存储服务 |

---

## 项目结构

```
OSSshelf/
├── apps/
│   ├── api/                          # 后端 API 服务
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── index.ts          # 数据库连接
│   │   │   │   └── schema.ts         # Drizzle Schema 定义
│   │   │   ├── lib/
│   │   │   │   ├── bucketResolver.ts # 存储桶解析逻辑
│   │   │   │   ├── crypto.ts         # 密码哈希、JWT 签名
│   │   │   │   └── s3client.ts       # S3 兼容存储客户端
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           # JWT 认证中间件
│   │   │   │   ├── error.ts          # 错误处理中间件
│   │   │   │   └── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts           # 认证路由 (注册/登录/用户信息)
│   │   │   │   ├── buckets.ts        # 存储桶管理路由
│   │   │   │   ├── files.ts          # 文件操作路由
│   │   │   │   ├── share.ts          # 分享路由
│   │   │   │   ├── webdav.ts         # WebDAV 协议实现
│   │   │   │   └── index.ts
│   │   │   ├── types/
│   │   │   │   ├── env.ts            # Cloudflare 环境类型
│   │   │   │   └── index.ts
│   │   │   └── index.ts              # 应用入口
│   │   ├── migrations/               # D1 数据库迁移文件
│   │   │   ├── 0001_init.sql
│   │   │   ├── 0002_soft_delete.sql
│   │   │   ├── 0003_storage_buckets.sql
│   │   │   └── 0004_bucket_quota_and_file_bucket.sql
│   │   ├── drizzle.config.ts
│   │   ├── wrangler.toml.example     # Workers 配置模板
│   │   └── package.json
│   │
│   └── web/                          # 前端 Web 应用
│       ├── src/
│       │   ├── components/
│       │   │   ├── layouts/
│       │   │   │   ├── AuthLayout.tsx    # 认证页面布局
│       │   │   │   └── MainLayout.tsx    # 主应用布局
│       │   │   └── ui/
│       │   │       ├── BreadcrumbNav.tsx # 面包屑导航
│       │   │       ├── FileIcon.tsx      # 文件类型图标
│       │   │       ├── FilePreview.tsx   # 文件预览组件
│       │   │       ├── MoveFolderPicker.tsx
│       │   │       ├── RenameDialog.tsx
│       │   │       ├── StorageBar.tsx    # 存储空间进度条
│       │   │       └── ...               # 其他 UI 组件
│       │   ├── hooks/
│       │   │   └── useFolderUpload.ts    # 文件夹上传 Hook
│       │   ├── pages/
│       │   │   ├── Buckets.tsx          # 存储桶管理页面
│       │   │   ├── Dashboard.tsx         # 仪表盘
│       │   │   ├── Files.tsx             # 文件列表
│       │   │   ├── Shares.tsx            # 分享管理
│       │   │   ├── Trash.tsx             # 回收站
│       │   │   ├── Settings.tsx          # 设置页面
│       │   │   ├── Login.tsx
│       │   │   ├── Register.tsx
│       │   │   └── SharePage.tsx         # 公开分享页面
│       │   ├── services/
│       │   │   └── api.ts                # API 请求封装
│       │   ├── stores/
│       │   │   ├── auth.ts               # 认证状态
│       │   │   └── files.ts              # 文件状态
│       │   ├── utils/
│       │   │   ├── fileTypes.ts          # 文件类型判断
│       │   │   └── index.ts              # 工具函数
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   └── index.css
│       ├── public/
│       │   └── favicon.svg
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── package.json
│
├── packages/
│   └── shared/                       # 共享代码包
│       ├── src/
│       │   ├── constants/
│       │   │   └── index.ts          # 常量定义
│       │   ├── types/
│       │   │   └── index.ts          # 类型定义
│       │   └── index.ts
│       └── package.json
│
├── .github/
│   └── workflows/
│       └── deploy-api.yml            # CI/CD 部署配置
│
├── package.json                      # Monorepo 根配置
├── pnpm-workspace.yaml               # pnpm 工作区配置
├── tsconfig.json
└── README.md
```

---

## 快速开始

### 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Node.js | >= 20.0.0 |
| pnpm | >= 8.0.0 |
| Cloudflare 账号 | 需要 |

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/your-username/OSSshelf.git
cd OSSshelf

# 2. 安装依赖
pnpm install

# 3. 复制配置文件
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
```

### 创建 Cloudflare 资源

```bash
# 登录 Cloudflare
wrangler login

# 创建 D1 数据库
wrangler d1 create ossshelf-db
# 记录返回的 database_id，填入 wrangler.toml

# 创建 KV 命名空间
wrangler kv:namespace create KV
# 记录返回的 id，填入 wrangler.toml
```

### 配置 wrangler.toml

```toml
name = "osshelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "osshelf-db"
database_id = "your-d1-database-id"    # 替换为实际 ID

[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"            # 替换为实际 ID

[vars]
ENVIRONMENT = "development"
JWT_SECRET = "your-secure-jwt-secret"  # 替换为安全密钥
```

### 数据库迁移

```bash
# 本地开发环境迁移
pnpm db:migrate:local

# 生产环境迁移
pnpm db:migrate
```

### 启动开发服务

```bash
# 终端 1: 启动 API 服务 (端口 8787)
pnpm dev:api

# 终端 2: 启动 Web 服务 (端口 3000)
pnpm dev:web
```

访问 http://localhost:3000 开始使用。

---

## 配置说明

### 环境变量

#### API 服务 (wrangler.toml)

| 变量 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| `ENVIRONMENT` | string | 运行环境 | `development` |
| `JWT_SECRET` | string | JWT 签名密钥，生产环境必须修改 | - |

#### Web 应用

| 变量 | 类型 | 描述 |
|------|------|------|
| `VITE_API_URL` | string | API 地址，同域部署可留空 |

### 系统常量

定义在 `packages/shared/src/constants/index.ts`：

| 常量 | 值 | 描述 |
|------|-----|------|
| `MAX_FILE_SIZE` | 5GB | 单文件最大大小 |
| `DEFAULT_STORAGE_QUOTA` | 10GB | 默认用户存储配额 |
| `JWT_EXPIRY` | 7天 | JWT 令牌有效期 |
| `SHARE_DEFAULT_EXPIRY` | 7天 | 分享链接默认有效期 |

### 存储桶配置

通过 Web 界面的「存储桶管理」页面，可以添加和配置多个存储桶：

1. **存储厂商**：选择支持的存储服务提供商
2. **显示名称**：存储桶的友好名称
3. **存储桶名称**：在存储服务中创建的实际桶名称
4. **Endpoint URL**：存储服务的 API 端点（留空使用默认）
5. **区域**：存储桶所在的区域（部分厂商必填）
6. **访问凭证**：Access Key ID 和 Secret Access Key
7. **Path-style URL**：是否使用路径风格的 URL（MinIO/B2 等需要）
8. **默认存储桶**：设置为默认存储位置
9. **存储限额**：可选的存储桶级别的空间限制

---

## API 文档

### 基础信息

- **Base URL**: `/api`
- **认证方式**: Bearer Token (JWT)
- **响应格式**: JSON

### 统一响应格式

```typescript
// 成功响应
{
  "success": true,
  "data": { ... }
}

// 错误响应
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  }
}
```

### 认证接口

#### 注册

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "用户名"  // 可选
}
```

#### 登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

#### 获取当前用户

```http
GET /api/auth/me
Authorization: Bearer <token>
```

### 存储桶接口

#### 列出存储桶

```http
GET /api/buckets
Authorization: Bearer <token>
```

#### 创建存储桶

```http
POST /api/buckets
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "我的 S3 存储桶",
  "provider": "s3",
  "bucketName": "my-bucket",
  "region": "us-east-1",
  "accessKeyId": "AKIA...",
  "secretAccessKey": "secret...",
  "isDefault": true
}
```

#### 更新存储桶

```http
PUT /api/buckets/<id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "更新的名称",
  "isDefault": true
}
```

#### 删除存储桶

```http
DELETE /api/buckets/<id>
Authorization: Bearer <token>
```

#### 测试存储桶连接

```http
POST /api/buckets/<id>/test
Authorization: Bearer <token>
```

### 文件接口

#### 上传文件

```http
POST /api/files/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary>
parentId: <folder-id>  // 可选
bucketId: <bucket-id>  // 可选，指定存储桶
```

#### 列出文件

```http
GET /api/files?parentId=<id>&search=<keyword>&sortBy=name&sortOrder=asc
Authorization: Bearer <token>
```

#### 创建文件夹

```http
POST /api/files
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新建文件夹",
  "parentId": null,  // 可选
  "bucketId": "bucket-id"  // 可选，指定存储桶
}
```

### 其他接口

- **回收站管理**：`/api/files/trash` 相关接口
- **分享管理**：`/api/share` 相关接口
- **WebDAV**：`/dav` 路径，遵循 WebDAV 协议

---

## WebDAV 使用

### 连接配置

| 配置项 | 值 |
|--------|-----|
| 服务器地址 | `https://your-domain.com/dav` |
| 用户名 | 注册邮箱 |
| 密码 | 账户密码 |
| 认证方式 | Basic Auth |

### 支持的操作

| 操作 | 方法 | 描述 |
|------|------|------|
| 列出目录 | `PROPFIND` | Depth: 0 (当前), 1 (包含子项) |
| 下载文件 | `GET` | - |
| 上传文件 | `PUT` | 覆盖已存在文件 |
| 创建目录 | `MKCOL` | - |
| 删除 | `DELETE` | 永久删除，不进回收站 |
| 移动/重命名 | `MOVE` | 需要 Destination 头 |
| 复制 | `COPY` | 需要 Destination 头 |

### 客户端配置示例

#### Windows 资源管理器

1. 打开"此电脑"
2. 点击"映射网络驱动器"
3. 文件夹输入: `https://your-domain.com/dav`
4. 勾选"使用其他凭据连接"
5. 输入邮箱和密码

#### macOS Finder

1. Finder 菜单 → 前往 → 连接服务器
2. 服务器地址: `https://your-domain.com/dav`
3. 点击"连接"，输入邮箱和密码

#### rclone

```ini
[osshelf]
type = webdav
url = https://your-domain.com/dav
vendor = other
user = your@email.com
pass = your-password
```

---

## 部署指南

### 部署 API

```bash
# 构建检查
pnpm build:api

# 部署到 Cloudflare Workers
pnpm deploy:api
```

### 部署 Web

#### 方式一: Cloudflare Pages

```bash
# 构建
pnpm build:web

# 在 Cloudflare Dashboard 中:
# 1. 创建 Pages 项目
# 2. 连接 Git 仓库，或手动上传 apps/web/dist 目录
# 3. 构建命令: pnpm build:web
# 4. 输出目录: apps/web/dist
```

#### 方式二: 其他静态托管

```bash
# 构建
pnpm build:web

# 将 apps/web/dist 目录部署到任意静态托管服务
# 注意配置 VITE_API_URL 环境变量
```

### 自定义域名

1. 在 Cloudflare Workers 设置自定义域名
2. 更新 Web 应用的 `VITE_API_URL` 环境变量
3. 重新构建部署

---

## 开发指南

### 常用命令

```bash
# 开发
pnpm dev:web          # 启动前端开发服务
pnpm dev:api          # 启动 API 开发服务

# 构建
pnpm build:web        # 构建前端
pnpm build:api        # 构建 API (dry-run)

# 代码质量
pnpm lint             # 运行 ESLint
pnpm typecheck        # TypeScript 类型检查

# 数据库
pnpm db:generate      # 生成迁移文件
pnpm db:migrate       # 生产环境迁移
pnpm db:migrate:local # 本地环境迁移
pnpm db:studio        # 打开 Drizzle Studio
```

### 数据库 Schema

```typescript
// 用户表
users: {
  id: string           // UUID
  email: string        // 唯一邮箱
  passwordHash: string // 密码哈希
  name: string | null  // 显示名称
  role: 'admin' | 'user'
  storageQuota: number // 存储配额 (字节)
  storageUsed: number  // 已用空间 (字节)
  createdAt: string
  updatedAt: string
}

// 文件表
files: {
  id: string
  userId: string       // 所属用户
  parentId: string     // 父文件夹 ID
  name: string         // 文件名
  path: string         // 路径
  type: 'file' | 'folder'
  size: number         // 大小 (字节)
  r2Key: string        // 存储键
  mimeType: string     // MIME 类型
  isFolder: boolean
  deletedAt: string    // 软删除时间
  bucketId: string     // 存储桶 ID
  createdAt: string
  updatedAt: string
}

// 存储桶表
storageBuckets: {
  id: string
  userId: string       // 所属用户
  name: string         // 显示名称
  provider: string     // 存储厂商
  bucketName: string   // 存储桶名称
  endpoint: string     // API 端点
  region: string       // 区域
  accessKeyId: string  // 加密存储的 Access Key
  secretAccessKey: string // 加密存储的 Secret Key
  pathStyle: boolean   // 是否使用路径风格 URL
  isDefault: boolean   // 是否默认存储桶
  isActive: boolean    // 是否激活
  storageUsed: number  // 已用空间
  fileCount: number    // 文件数量
  storageQuota: number // 存储限额
  notes: string        // 备注
  createdAt: string
  updatedAt: string
}

// 分享表
shares: {
  id: string
  fileId: string
  userId: string
  password: string     // 访问密码
  expiresAt: string    // 过期时间
  downloadLimit: number // 下载次数限制
  downloadCount: number // 已下载次数
  createdAt: string
}
```

### 添加新功能

1. 在 `packages/shared` 定义类型和常量
2. 在 `apps/api/src/routes` 添加路由
3. 在 `apps/web/src/services/api.ts` 添加 API 调用
4. 在 `apps/web/src/pages` 添加页面组件

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 致谢

- [Cloudflare](https://www.cloudflare.com/) - 边缘计算平台
- [Hono](https://hono.dev/) - 轻量级 Web 框架
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [Radix UI](https://www.radix-ui.com/) - 无障碍组件库
- [Lucide](https://lucide.dev/) - 图标库
- 各存储厂商提供的 S3 兼容 API