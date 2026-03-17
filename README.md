# OSSshelf

<p align="center">
  <strong>基于 Cloudflare 部署的多厂商 OSS 文件管理系统</strong><br>
  <sub>统一管理主流对象存储 · 支持 WebDAV 协议 · 预签名直传 · 安全分享 · PWA 支持</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-18-61dafb?logo=react" alt="React">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/PWA-Ready-5a0fc8?logo=pwa" alt="PWA Ready">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## 功能特性

### 核心功能

| 功能 | 描述 |
|------|------|
| 📁 **文件管理** | 上传、下载、重命名、移动、删除文件和文件夹，支持拖拽上传、文件夹上传 |
| 🚀 **预签名直传** | 浏览器直传到对象存储，支持大文件分片上传（>100MB），断点续传 |
| 🔗 **文件分享** | 创建分享链接，支持密码保护、过期时间、下载次数限制 |
| 🗑️ **回收站** | 软删除机制，支持恢复已删除文件，自动清理过期文件 |
| 📊 **存储配额** | 用户级别和存储桶级别的存储空间管理 |
| 🔍 **高级搜索** | 按名称/类型/标签搜索，支持搜索建议和搜索历史 |
| 🌐 **多厂商支持** | 统一管理多个云存储厂商的存储桶，支持存储桶启用/禁用切换 |
| 📥 **离线下载** | 创建离线下载任务，支持 URL 下载到云存储，支持暂停/恢复/重试 |
| 🔐 **权限管理** | 文件/文件夹级别的权限控制，支持只读/读写/管理权限 |
| 🏷️ **标签系统** | 为文件添加彩色标签，支持按标签筛选 |
| 📝 **审计日志** | 记录所有操作，支持管理员查看和筛选 |
| 📋 **注册控制** | 支持开放/关闭注册，支持邀请码机制 |

### 批量操作

| 功能 | 描述 |
|------|------|
| 📦 **批量删除** | 同时删除多个文件/文件夹 |
| 📦 **批量移动** | 同时移动多个文件/文件夹到目标目录 |
| 📦 **批量复制** | 同时复制多个文件/文件夹 |
| 📦 **批量重命名** | 批量重命名文件/文件夹 |
| 📦 **批量恢复** | 从回收站批量恢复文件 |
| 📦 **批量永久删除** | 批量永久删除回收站文件 |

### 大文件上传

| 功能 | 描述 |
|------|------|
| 📦 **分片上传** | 大文件自动分片，支持 >5GB 文件上传 |
| ⏸️ **断点续传** | 上传中断后可恢复，任务持久化存储 |
| 📊 **进度显示** | 实时显示上传进度和分片状态 |
| 🔄 **任务管理** | 查看上传任务列表，支持取消/重试 |

### 安全特性

| 功能 | 描述 |
|------|------|
| 🔒 **登录安全** | 登录失败锁定机制（5次失败锁定15分钟），防止暴力破解 |
| 📱 **设备管理** | 查看已登录设备，支持远程注销，自动识别设备类型 |
| 🛡️ **权限控制** | 文件级别权限管理，支持用户授权（读/写/管理） |
| 📋 **审计追踪** | 记录所有敏感操作，支持按操作类型筛选追溯 |

### WebDAV 支持

完整实现 [RFC 4918](https://datatracker.ietf.org/doc/html/rfc4918) WebDAV 协议，兼容主流客户端：

| 方法 | 功能 |
|------|------|
| `PROPFIND` | 列出目录内容 |
| `GET/HEAD` | 下载文件 |
| `PUT` | 上传文件（自动创建父目录） |
| `MKCOL` | 创建文件夹 |
| `DELETE` | 删除文件/文件夹（永久删除） |
| `MOVE` | 移动/重命名 |
| `COPY` | 复制文件 |

**兼容客户端**: Windows 资源管理器、macOS Finder、Cyberduck、WinSCP、rclone 等

### 界面特性

- 🎨 **主题切换** - 支持浅色/深色/跟随系统三种主题模式
- 📱 响应式设计，完美支持移动端
- ⌨️ 键盘快捷键支持（全选、删除、重命名、新建文件夹、切换视图等）
- 🖱️ 右键上下文菜单
- 📊 多视图模式（列表/网格/瀑布流）
- 🖼️ 增强文件预览（图片、视频、PDF、代码高亮）
- ⚡ 实时上传进度显示
- 📂 文件夹拖拽上传
- 📱 PWA 支持，可安装到桌面
- 🔍 搜索建议自动补全
- 🏷️ 标签点击筛选

---

## 技术架构

### 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户界面层                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  React 18 + TypeScript + Tailwind CSS + Zustand     │   │
│  │  React Query + Radix UI + Vite + PWA                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        API 服务层                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Hono Framework + Cloudflare Workers                 │   │
│  │  REST API + WebDAV Protocol + Presigned URL          │   │
│  │  S3 兼容存储客户端（多厂商支持）                       │   │
│  │  Cron Triggers（定时任务）                           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Cloudflare D1  │ │  多厂商对象存储   │ │  Cloudflare KV  │
│   (SQLite)      │ │  (S3 兼容 API)   │ │   (可选)        │
│                 │ │                 │ │                 │
│  - 用户数据     │ │  - 文件内容     │ │  - Session      │
│  - 文件元数据   │ │  - 支持大文件   │ │  - 临时缓存     │
│  - 存储桶配置   │ │  - 跨厂商兼容   │ │                 │
│  - 权限/标签    │ │  - 直传支持     │ │                 │
│  - 审计日志     │ │                 │ │                 │
│  - 上传/下载任务│ │                 │ │                 │
│  - 设备管理     │ │                 │ │                 │
│  - 登录记录     │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 技术栈

#### 前端 (apps/web)

| 技术 | 版本 | 用途 |
|------|------|------|
| React | ^18.2.0 | UI 框架 |
| TypeScript | ^5.3.0 | 类型安全 |
| Vite | ^5.1.0 | 构建工具 |
| Tailwind CSS | ^3.4.0 | 样式框架 |
| Zustand | ^4.5.0 | 状态管理 |
| React Query | ^5.24.0 | 服务端状态 |
| React Router | ^6.22.0 | 路由管理 |
| Radix UI | ^1.0.x | 无障碍组件 |
| Lucide | ^0.344.0 | 图标库 |

#### 后端 (apps/api)

| 技术 | 版本 | 用途 |
|------|------|------|
| Hono | ^4.0.0 | Web 框架 |
| Cloudflare Workers | ^3.24.0 | Serverless 运行时 |
| Drizzle ORM | ^0.29.0 | 数据库 ORM |
| Zod | ^3.22.0 | 参数验证 |

---

## 文档

- [项目架构文档](docs/architecture.md) - 系统架构详情、数据库设计、安全设计
- [API 文档](docs/api.md) - 完整的 API 接口说明
- [部署文档](docs/deployment.md) - 部署指南、配置说明、故障排查

---

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Cloudflare 账号

### 安装部署

```bash
# 1. 克隆项目
git clone https://github.com/your-username/OSSshelf.git
cd OSSshelf

# 2. 安装依赖
pnpm install

# 3. 配置 Cloudflare 资源
npx wrangler login
npx wrangler d1 create ossshelf-db
npx wrangler kv:namespace create KV

# 4. 复制并编辑配置文件
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
# 编辑 apps/api/wrangler.toml，填入 database_id 和 kv id

# 5. 数据库迁移
pnpm db:migrate:local

# 6. 启动开发服务
pnpm dev:api   # 端口 8787
pnpm dev:web   # 端口 5173
```

访问 http://localhost:5173 开始使用。

详细部署说明请参考 [部署文档](docs/deployment.md)。

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
│   ├── api/                    # 后端 API 服务 (Cloudflare Workers)
│   │   ├── src/
│   │   │   ├── db/             # 数据库连接和 Schema
│   │   │   ├── lib/            # 工具库（加密、S3客户端等）
│   │   │   ├── middleware/     # 中间件（认证、错误处理）
│   │   │   ├── routes/         # API 路由
│   │   │   └── types/          # 类型定义
│   │   └── migrations/         # 数据库迁移文件
│   └── web/                    # 前端 Web 应用 (React + Vite)
│       ├── src/
│       │   ├── components/     # React 组件
│       │   ├── hooks/          # 自定义 Hooks
│       │   ├── pages/          # 页面组件
│       │   ├── services/       # API 服务
│       │   ├── stores/         # Zustand 状态管理
│       │   └── utils/          # 工具函数
│       └── public/             # 静态资源
├── packages/
│   └── shared/                 # 共享代码包（类型、常量）
├── docs/                       # 项目文档
└── .github/workflows/          # CI/CD 配置
```

---

## 常用命令

```bash
# 开发
pnpm dev:web          # 启动前端开发服务
pnpm dev:api          # 启动 API 开发服务

# 构建
pnpm build:web        # 构建前端
pnpm build:api        # 构建 API

# 部署
pnpm deploy:api       # 部署 API 到 Cloudflare Workers

# 数据库
pnpm db:migrate       # 生产环境迁移
pnpm db:migrate:local # 本地环境迁移
pnpm db:studio        # 打开 Drizzle Studio

# 代码质量
pnpm lint             # 运行 ESLint
pnpm typecheck        # TypeScript 类型检查
```

---

## 系统常量

| 常量 | 值 | 描述 |
|------|-----|------|
| `MAX_FILE_SIZE` | 5GB | 单文件最大大小 |
| `DEFAULT_STORAGE_QUOTA` | 10GB | 默认用户存储配额 |
| `JWT_EXPIRY` | 7天 | JWT 令牌有效期 |
| `WEBDAV_SESSION_EXPIRY` | 30天 | WebDAV 会话有效期 |
| `UPLOAD_CHUNK_SIZE` | 10MB | 分片上传块大小 |
| `MULTIPART_THRESHOLD` | 100MB | 触发分片上传的阈值 |
| `MAX_CONCURRENT_PARTS` | 3 | 最大并发上传分片数 |
| `TRASH_RETENTION_DAYS` | 30天 | 回收站文件保留天数 |
| `LOGIN_MAX_ATTEMPTS` | 5次 | 登录最大尝试次数 |
| `LOGIN_LOCKOUT_DURATION` | 15分钟 | 登录锁定时间 |
| `DEVICE_SESSION_EXPIRY` | 30天 | 设备会话有效期 |
| `UPLOAD_TASK_EXPIRY` | 24小时 | 上传任务有效期 |
| `SHARE_DEFAULT_EXPIRY` | 7天 | 分享链接默认有效期 |

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 致谢

- [Cloudflare](https://www.cloudflare.com/) - 边缘计算平台
- [Hono](https://hono.dev/) - 轻量级 Web 框架
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [Radix UI](https://www.radix-ui.com/) - 无障碍组件库
