# OSSshelf 项目架构文档

## 概述

OSSshelf 是一个基于 Cloudflare 边缘计算平台构建的多厂商对象存储文件管理系统，采用 Monorepo 架构管理前后端代码。

## 系统架构

### 整体架构图

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
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## 项目结构

```
OSSshelf/
├── apps/
│   ├── api/                    # 后端 API 服务
│   │   ├── src/
│   │   │   ├── db/             # 数据库连接和 Schema
│   │   │   ├── lib/            # 工具库（加密、S3客户端等）
│   │   │   ├── middleware/     # 中间件（认证、错误处理）
│   │   │   ├── routes/         # API 路由
│   │   │   └── types/          # 类型定义
│   │   └── migrations/         # 数据库迁移文件
│   └── web/                    # 前端 Web 应用
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
└── .github/workflows/          # CI/CD 配置
```

## 技术栈

### 前端 (apps/web)

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

### 后端 (apps/api)

| 技术 | 版本 | 用途 |
|------|------|------|
| Hono | ^4.0.0 | Web 框架 |
| Cloudflare Workers | ^3.24.0 | Serverless 运行时 |
| Drizzle ORM | ^0.29.0 | 数据库 ORM |
| Zod | ^3.22.0 | 参数验证 |

### 云服务

| 服务 | 用途 |
|------|------|
| Cloudflare D1 | SQLite 数据库 |
| Cloudflare KV | 键值存储（可选） |
| 多厂商对象存储 | 文件内容存储 |
| Cloudflare Cron | 定时任务 |

## 核心模块

### 1. 认证模块 (routes/auth.ts)

- 用户注册与登录
- JWT Token 管理
- 登录失败锁定保护
- 设备管理与会话控制

### 2. 文件模块 (routes/files.ts)

- 文件/文件夹 CRUD
- 文件上传下载
- 回收站管理
- 文件预览

### 3. 存储桶模块 (routes/buckets.ts)

- 多厂商存储桶管理
- S3 兼容 API 客户端
- 存储配额管理

### 4. 预签名模块 (routes/presign.ts)

- 浏览器直传支持
- 大文件分片上传
- 断点续传

### 5. WebDAV 模块 (routes/webdav.ts)

- RFC 4918 协议实现
- 多客户端兼容

### 6. 权限模块 (routes/permissions.ts)

- 文件级别权限控制
- 标签系统

### 7. 审计模块 (lib/audit.ts)

- 操作日志记录
- 安全审计追踪

## 数据库设计

### 核心表结构

| 表名 | 用途 |
|------|------|
| users | 用户数据 |
| files | 文件/文件夹元数据 |
| storage_buckets | 存储桶配置 |
| shares | 分享链接 |
| file_tags | 文件标签 |
| file_permissions | 文件权限 |
| audit_logs | 审计日志 |
| upload_tasks | 上传任务 |
| download_tasks | 下载任务 |
| user_devices | 用户设备 |
| login_attempts | 登录尝试 |
| webdav_sessions | WebDAV 会话 |

## 安全设计

### 认证安全

- JWT Token 认证
- 密码 bcrypt 哈希
- 登录失败锁定机制
- 设备会话管理

### 数据安全

- 存储桶凭证加密存储
- 预签名 URL 临时访问
- 文件级别权限控制

### 传输安全

- HTTPS 强制
- CORS 配置
- 安全响应头

## 性能优化

### 前端优化

- 代码分割与懒加载
- React Query 缓存
- 图片懒加载
- PWA 离线支持

### 后端优化

- 数据库索引优化
- 预签名直传绕过 Worker
- 分片上传支持大文件
- 定时任务异步处理

## 扩展性设计

### 存储厂商扩展

通过统一的 S3 兼容接口，支持任意 S3 兼容存储服务：

```typescript
// 存储桶配置结构
interface BucketConfig {
  provider: 'r2' | 's3' | 'oss' | 'cos' | 'obs' | 'b2' | 'minio' | 'custom';
  endpoint?: string;
  region?: string;
  pathStyle: boolean;
  // ...
}
```

### 功能模块扩展

- 路由模块化设计
- 中间件可插拔
- 共享类型定义
