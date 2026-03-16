# R2Shelf

<p align="center">
  <strong>基于 Cloudflare R2 的现代化文件管理系统</strong><br>
  <sub>支持 WebDAV 协议 · 安全分享 · 响应式界面</sub>
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
| 📊 **存储配额** | 用户级别存储空间管理，默认 10GB 配额 |
| 🔍 **搜索排序** | 按名称搜索文件，支持名称/大小/时间排序 |

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
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Cloudflare D1  │ │  Cloudflare R2  │ │  Cloudflare KV  │
│   (SQLite)      │ │  (Object Store) │ │   (Cache)       │
│                 │ │                 │ │                 │
│  - 用户数据     │ │  - 文件内容     │ │  - Session      │
│  - 文件元数据   │ │  - 支持大文件   │ │  - 临时缓存     │
│  - 分享记录     │ │  - CDN 加速     │ │                 │
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
| Cloudflare D1 | SQLite 数据库，存储用户、文件元数据 |
| Cloudflare R2 | 对象存储，存储文件内容 |
| Cloudflare KV | 键值存储，Session 管理 |

---

## 项目结构

```
r2shelf/
├── apps/
│   ├── api/                          # 后端 API 服务
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── index.ts          # 数据库连接
│   │   │   │   └── schema.ts         # Drizzle Schema 定义
│   │   │   ├── lib/
│   │   │   │   └── crypto.ts         # 密码哈希、JWT 签名
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           # JWT 认证中间件
│   │   │   │   ├── error.ts          # 错误处理中间件
│   │   │   │   └── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts           # 认证路由 (注册/登录/用户信息)
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
│   │   │   └── 0002_soft_delete.sql
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
git clone https://github.com/your-username/r2shelf.git
cd r2shelf

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
wrangler d1 create r2shelf-db
# 记录返回的 database_id，填入 wrangler.toml

# 创建 R2 存储桶
wrangler r2 bucket create r2shelf-files

# 创建 KV 命名空间
wrangler kv:namespace create KV
# 记录返回的 id，填入 wrangler.toml
```

### 配置 wrangler.toml

```toml
name = "r2shelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "r2shelf-db"
database_id = "your-d1-database-id"    # 替换为实际 ID

[[r2_buckets]]
binding = "FILES"
bucket_name = "r2shelf-files"

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

#### 更新用户信息

```http
PATCH /api/auth/me
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新用户名",
  "currentPassword": "旧密码",    // 修改密码时必填
  "newPassword": "新密码"         // 可选
}
```

#### 获取统计数据

```http
GET /api/auth/stats
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
```

#### 列出文件

```http
GET /api/files?parentId=<id>&search=<keyword>&sortBy=name&sortOrder=asc
Authorization: Bearer <token>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `parentId` | string | 父文件夹 ID，根目录留空 |
| `search` | string | 搜索关键词 |
| `sortBy` | string | 排序字段: `name`, `size`, `createdAt` |
| `sortOrder` | string | 排序方向: `asc`, `desc` |

#### 创建文件夹

```http
POST /api/files
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新建文件夹",
  "parentId": null  // 可选
}
```

#### 重命名/移动

```http
PUT /api/files/<id>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新名称",
  "parentId": "new-parent-id"  // 可选，用于移动
}
```

#### 移动文件

```http
POST /api/files/<id>/move
Authorization: Bearer <token>
Content-Type: application/json

{
  "targetParentId": "folder-id"  // null 表示根目录
}
```

#### 下载文件

```http
GET /api/files/<id>/download
Authorization: Bearer <token>
```

#### 预览文件

```http
GET /api/files/<id>/preview
Authorization: Bearer <token>
```

#### 删除文件 (移入回收站)

```http
DELETE /api/files/<id>
Authorization: Bearer <token>
```

### 回收站接口

#### 列出回收站文件

```http
GET /api/files/trash
Authorization: Bearer <token>
```

#### 恢复文件

```http
POST /api/files/trash/<id>/restore
Authorization: Bearer <token>
```

#### 永久删除文件

```http
DELETE /api/files/trash/<id>
Authorization: Bearer <token>
```

#### 清空回收站

```http
DELETE /api/files/trash
Authorization: Bearer <token>
```

### 分享接口

#### 创建分享

```http
POST /api/share
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file-id",
  "password": "optional-password",    // 可选
  "expiresAt": "2024-12-31T23:59:59Z", // 可选
  "downloadLimit": 100                 // 可选
}
```

#### 获取分享列表

```http
GET /api/share
Authorization: Bearer <token>
```

#### 获取分享信息 (公开)

```http
GET /api/share/<id>?password=<password>
```

#### 下载分享文件 (公开)

```http
GET /api/share/<id>/download?password=<password>
```

#### 删除分享

```http
DELETE /api/share/<id>
Authorization: Bearer <token>
```

### 错误码

| 错误码 | HTTP 状态码 | 描述 |
|--------|-------------|------|
| `UNAUTHORIZED` | 401 | 未授权 |
| `FORBIDDEN` | 403 | 禁止访问 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VALIDATION_ERROR` | 400 | 参数验证失败 |
| `FILE_TOO_LARGE` | 400 | 文件超过大小限制 |
| `STORAGE_EXCEEDED` | 400 | 存储空间不足 |
| `SHARE_EXPIRED` | 410 | 分享链接已过期 |
| `SHARE_PASSWORD_REQUIRED` | 401 | 需要密码访问 |
| `SHARE_PASSWORD_INVALID` | 401 | 密码错误 |
| `SHARE_DOWNLOAD_LIMIT_EXCEEDED` | 403 | 下载次数已达上限 |

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
[r2shelf]
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
  r2Key: string        // R2 存储键
  mimeType: string     // MIME 类型
  isFolder: boolean
  deletedAt: string    // 软删除时间
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
