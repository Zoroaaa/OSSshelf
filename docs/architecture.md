# OSSshelf 架构文档

**版本**: v3.2.0
**更新日期**: 2026-11-04

---

## 📋 目录

- [系统概述](#系统概述)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [核心模块](#核心模块)
- [AI 模块架构](#ai-模块架构)
- [数据模型](#数据模型)
- [API 设计](#api-设计)
- [安全架构](#安全架构)
- [部署架构](#部署架构)

---

## 系统概述

OSSshelf 是一个基于 Cloudflare 技术栈构建的现代化对象存储管理平台，提供文件管理、AI 智能处理、多用户协作等功能。

### 核心特性

- **文件管理**：上传、下载、预览、版本控制
- **AI 增强**：智能摘要、图片识别、语义搜索、Agent 引擎
- **多用户**：用户认证、权限管理、团队协作
- **分享系统**：公开分享、直链、上传链接
- **存储管理**：多存储桶支持、存储配额

---

## 技术栈

### 前端

| 技术         | 版本 | 用途         |
| ------------ | ---- | ------------ |
| React        | 19.x | UI 框架      |
| TypeScript   | 5.x  | 类型安全     |
| Vite         | 6.x  | 构建工具     |
| Tailwind CSS | 3.x  | 样式框架     |
| Radix UI     | -    | 无障碍组件库 |
| React Router | 6.x  | 路由管理     |
| Zustand      | 4.x  | 状态管理     |
| React Query  | 5.x  | 数据获取     |

> 认证为自建 JWT（`apps/api/src/middleware/auth.ts` + `apps/web/src/stores/auth.ts`），未接入 Clerk 等第三方身份服务。

### 后端

| 技术                  | 版本 | 用途                                       |
| --------------------- | ---- | ------------------------------------------ |
| Hono                  | 4.x  | Web 框架                                   |
| TypeScript            | 5.x  | 类型安全                                   |
| Cloudflare Workers    | -    | Serverless 运行时                          |
| Cloudflare D1         | -    | SQLite 数据库                              |
| 对象存储              | -    | R2 / OSS / S3 等 S3 兼容服务（应用内配置） |
| Cloudflare Vectorize  | -    | 向量数据库                                 |
| Cloudflare Workers AI | -    | AI 推理服务                                |

### 开发工具

| 工具            | 用途          |
| --------------- | ------------- |
| pnpm workspaces | Monorepo 管理 |
| ESLint          | 代码检查      |
| Prettier        | 代码格式化    |
| Vitest          | 单元测试      |

---

## 项目结构

```
OSSshelf/
├── apps/
│   ├── api/                          # 后端：单个 Worker 承载 API / WebDAV / Agent WS
│   │   ├── src/
│   │   │   ├── index.ts              # 入口：中间件、子应用注册、Cron、队列
│   │   │   ├── routes/               # HTTP 路由（鉴权、校验、响应）
│   │   │   ├── lib/                  # 业务编排
│   │   │   │   ├── ai/               # Agent 运行时、工具、检索、模型、用量
│   │   │   │   ├── fileService.ts    # 文件、回收站、版本
│   │   │   │   ├── shareService.ts   # 分享链接
│   │   │   │   ├── permissionResolver.ts   # 权限解析与缓存
│   │   │   │   ├── bucketResolver.ts # 存储桶解析
│   │   │   │   ├── storageGC.ts      # 对象回收与删除队列
│   │   │   │   └── cleanup.ts        # Cron 清理与存储对账
│   │   │   ├── agents/               # OSSShelfAgent（Durable Object）与 WS 鉴权
│   │   │   ├── db/                   # Drizzle schema 与连接
│   │   │   ├── middleware/           # 鉴权、限流、错误处理
│   │   │   └── types/                # Env / Variables 等类型
│   │   ├── migrations/               # SQL 迁移（表结构唯一事实源）
│   │   │   ├── 010_core.sql
│   │   │   ├── 060_ai.sql
│   │   │   └── 119_file_name_unique.sql
│   │   └── wrangler.toml             # Worker 配置（前端静态资源、D1/KV/Vectorize/Queue）
│   │
│   └── web/                          # 前端 SPA
│       ├── src/
│       │   ├── main.tsx              # 入口：QueryClient、主题、Service Worker
│       │   ├── App.tsx               # 路由表
│       │   ├── pages/                # 路由级页面
│       │   ├── components/           # 业务组件（files / teams / ai / ui …）
│       │   ├── hooks/                # 数据编排与交互
│       │   ├── services/             # API 封装（api-client + 端点函数）
│       │   ├── stores/               # Zustand：auth / files / theme
│       │   └── lib/                  # 前端基础设施（dialogStack 等）
│       └── vite.config.ts
│
├── packages/
│   └── shared/                       # 前后端共享
│       └── src/
│           ├── constants/            # ERROR_CODES、预览类型
│           ├── types/                # 共享类型
│           └── utils/                # logger、MIME
│
├── scripts/                          # dev-setup / smoke-test
├── docs/                             # 架构、部署、API、审计、计划、runbook
├── AGENTS.md                         # AI agent 协作规范
├── package.json                      # pnpm workspaces 根
└── README.md
```

---

## 核心模块

### 1. 文件管理模块

```
┌─────────────────────────────────────────────────────────────┐
│                      文件管理流程                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  用户上传 → R2 存储 → 元数据入库 → AI 处理（可选）             │
│                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │  上传   │───→│  R2     │───→│  D1     │───→│   AI    │  │
│  │  请求   │    │  存储   │    │  元数据  │    │  处理   │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**核心功能**：

- 文件上传（分片上传、断点续传）
- 文件下载（直链、签名 URL）
- 文件预览（图片、视频、PDF、代码）
- 文件版本管理
- 文件夹管理
- 文件标签
- 文件搜索（关键词、语义搜索）

### 2. 用户认证模块

使用 Clerk 进行用户认证：

- 用户注册/登录
- 会话管理
- 用户配置
- API Key 管理

### 3. 分享系统模块

```
┌─────────────────────────────────────────────────────────────┐
│                      分享类型                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │    公开分享     │  │     直链        │  │   上传链接   │ │
│  │  (share_link)   │  │ (direct_link)   │  │(upload_link)│ │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────┤ │
│  │ - 密码保护      │  │ - 永久有效      │  │ - 文件夹上传 │ │
│  │ - 过期时间      │  │ - 无需认证      │  │ - 有效期限制 │ │
│  │ - 访问统计      │  │ - 带宽限制      │  │ - 数量限制   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4. 团队协作模块 (v3.0.0 新增)

```
┌─────────────────────────────────────────────────────────────┐
│                      团队协作架构                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │   团队管理       │  │   成员管理       │                   │
│  │  (teamService)  │  │(memberService)  │                   │
│  │ • 创建/解散团队  │  │ • 邀请/移除成员  │                   │
│  │ • 团队配置      │  │ • 角色分配       │                   │
│  └────────┬────────┘  └────────┬────────┘                   │
│           │                    │                            │
│           ▼                    ▼                            │
│  ┌─────────────────────────────────────────┐                │
│  │            权限引擎                      │                │
│  │  ┌──────────────────┐ ┌──────────────┐ │                │
│  │  │ permissionResolver│ │permissionSvc │ │                │
│  │  │ (team 维度扩展)   │ │(审批/批量)   │ │                │
│  │  └──────────────────┘ └──────────────┘ │                │
│  └─────────────────────────────────────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**核心服务**：

- **teamService.ts** — 团队管理服务（创建、更新、解散、资源挂载）
- **permissionResolver** — 权限解析器，扩展支持 team 维度的 RBAC 判断
- **permissionService** — 权限服务，新增权限申请/审批流程、批量权限操作、角色模板管理

---

## AI 模块架构

v3.0 AI 模块基于 Cloudflare Agents SDK：对话由 `OSSShelfAgent`（Durable Object）承载，HTTP 层只负责会话/记忆管理、模型配置、索引任务与用量查询。旧的自研 Agent 引擎、RAG 引擎、SSE 链路、熔断器与工具选择器均已删除。

### 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AI 模块架构 v3.0                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  HTTP 层                                                                     │
│  routes/ai.ts          —— 索引/摘要/标签任务、向量库、语义搜索               │
│  routes/aiConfigRoutes —— 模型/提供商/系统配置、Workers AI 目录              │
│  routes/aiChatRoutes   —— 会话 CRUD、记忆管理、WS 票据                       │
│  routes/aiUsageRoutes  —— 用量汇总、配额状态                                 │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │              OSSShelfAgent（Durable Object，每会话一个）              │    │
│  │  - AI SDK streamText + toUIMessageStreamResponse                     │    │
│  │  - 工具集由 toolAdapter 生成（agentTools/ 13 个模块）                 │    │
│  │  - 写操作 needsApproval，用户确认后同轮继续                           │    │
│  │  - 跨会话记忆召回（agentMemory：D1 + Vectorize）                      │    │
│  │  - onFinish → ai_usage_events + ai_chat_messages（审计镜像）          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│          ┌───────────────────────────┼───────────────────────────┐          │
│          ▼                           ▼                           ▼          │
│  ┌───────────────┐         ┌───────────────┐         ┌───────────────┐    │
│  │  工具执行器   │         │ 模型运行时    │         │  能力层       │    │
│  │ (agentTools/) │         │(modelRuntime) │         │ features/     │    │
│  │ 13+ 模块      │         │ 统一调用记账   │         │ vectorIndex   │    │
│  └───────────────┘         └───────────────┘         └───────────────┘    │
│          │                           │                           │          │
│          ▼                           ▼                           ▼          │
│  ┌───────────────┐         ┌───────────────┐         ┌───────────────┐    │
│  │  文件/权限/   │         │ AI SDK        │         │ file_chunks   │    │
│  │  分享/标签等  │         │ Workers AI /  │         │ Vectorize     │    │
│  │  Agent 工具   │         │ OpenAI / Anthropic│      │ FTS5          │    │
│  └───────────────┘         └───────────────┘         └───────────────┘    │
│                                                                              │
│  支撑模块：                                                                  │
│  ├─ aiTaskQueue.ts — Queues + ai_task_items（进度重算、停滞回收、失败明细）  │
│  ├─ workersAiCatalog.ts — Workers AI 模型目录实时同步（含内置兜底）          │
│  ├─ usage.ts — 用量记账、日配额与分钟限流                                    │
│  └─ aiConfigService.ts — 系统配置注册表与历史配置清理                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### AI 提供商管理架构 (v2.4.0 新增)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AI 提供商管理架构                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    ai_providers 表                                    │    │
│  │                                                                      │    │
│  │  字段：                                                              │    │
│  │  - id: 提供商唯一标识                                                │    │
│  │  - name: 提供商名称                                                  │    │
│  │  - api_endpoint: API 端点                                            │    │
│  │  - thinking_config: 推理模式配置 (JSON)                              │    │
│  │  - is_system: 是否系统内置                                           │    │
│  │  - is_default: 是否默认                                              │    │
│  │  - sort_order: 排序顺序                                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    16 个系统内置提供商                                 │    │
│  │                                                                      │    │
│  │  国内厂商 (9 个)：                                                   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │ 百度文心    │ │ 腾讯混元    │ │ 阿里通义    │ │ 字节火山    │   │    │
│  │  │ 一言       │ │            │ │ 千问       │ │ 引擎       │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │ 智谱AI     │ │ MiniMax    │ │ 月之暗面    │ │ 硅基流动    │   │    │
│  │  │            │ │            │ │ Kimi       │ │            │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐                                                     │    │
│  │  │ DeepSeek   │  ← 推理模型支持 (thinking_config)                   │    │
│  │  │            │                                                     │    │
│  │  └─────────────┘                                                     │    │
│  │                                                                      │    │
│  │  国际厂商 (7 个)：                                                   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │    │
│  │  │ OpenAI     │ │ Anthropic   │ │ Google      │ │ Mistral AI  │   │    │
│  │  │ GPT 系列   │ │ Claude      │ │ Gemini      │ │            │   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                   │    │
│  │  │ xAI Grok   │ │ Groq       │ │ Perplexity  │                   │    │
│  │  │            │ │ 高速推理   │ │ 联网搜索   │                   │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘                   │    │
│  │  ┌─────────────┐                                                     │    │
│  │  │ OpenRouter │  ← 模型聚合平台                                     │    │
│  │  │            │                                                     │    │
│  │  └─────────────┘                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    ai_models 表 (关联提供商)                          │    │
│  │                                                                      │    │
│  │  新增字段 (v2.4.0)：                                                 │    │
│  │  - provider_id: 关联 ai_providers.id                                │    │
│  │  - sort_order: 模型排序                                              │    │
│  │                                                                      │    │
│  │  模型分组展示：                                                      │    │
│  │  - Workers AI 模型单独一组                                           │    │
│  │  - 有 provider_id 的归属对应提供商                                   │    │
│  │  - 其他归入"其他 OpenAI 兼容 API"组                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### thinking_config 配置格式

不同提供商的推理模式配置格式不同：

```typescript
// 布尔类型 (百度、阿里、硅基流动)
{
  "paramFormat": "boolean",
  "paramName": "enable_thinking",
  "enabledValue": true,
  "disabledValue": false
}

// 对象类型 (腾讯、字节、智谱、月之暗面、DeepSeek、Anthropic、xAI)
{
  "paramFormat": "object",
  "paramName": "thinking",
  "nestedKey": "type",
  "enabledValue": "enabled",
  "disabledValue": "disabled"
}

// 字符串类型 (OpenAI、Google)
{
  "paramFormat": "string",
  "paramName": "reasoning_effort",  // 或 "thinking_level"
  "enabledValue": "medium",
  "disabledValue": "low"
}
```

### Agent 引擎核心流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Agent 引擎执行流程                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  用户消息                                                                    │
│      │                                                                       │
│      ▼                                                                       │
│  ┌─────────────────┐                                                        │
│  │  意图识别       │  ← 模式匹配 + 关键词提取                                │
│  └────────┬────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐                               │
│  │  模型调用       │────→│  工具选择       │                               │
│  │  (Native/Prompt)│     │  (100+ 个工具) │                               │
│  └────────┬────────┘     └────────┬────────┘                               │
│           │                       │                                          │
│           │                       ▼                                          │
│           │              ┌─────────────────┐                                │
│           │              │  是写操作？     │                                │
│           │              └────────┬────────┘                                │
│           │                       │                                          │
│           │              ┌────────┴────────┐                                │
│           │              ▼                 ▼                                │
│           │       ┌───────────┐     ┌───────────┐                          │
│           │       │  返回确认 │     │  直接执行 │                          │
│           │       │  请求     │     │  工具     │                          │
│           │       └─────┬─────┘     └─────┬─────┘                          │
│           │             │                 │                                 │
│           │             ▼                 │                                 │
│           │       ┌───────────┐           │                                 │
│           │       │  用户确认 │           │                                 │
│           │       └─────┬─────┘           │                                 │
│           │             │                 │                                 │
│           └─────────────┴─────────────────┘                                 │
│                         │                                                    │
│                         ▼                                                    │
│                ┌─────────────────┐                                          │
│                │  工具结果       │                                          │
│                │  + _next_actions│                                          │
│                └────────┬────────┘                                          │
│                         │                                                    │
│                         ▼                                                    │
│                ┌─────────────────┐                                          │
│                │  需要继续？     │                                          │
│                │  (循环检测)     │                                          │
│                └────────┬────────┘                                          │
│                         │                                                    │
│              ┌──────────┴──────────┐                                        │
│              ▼                     ▼                                        │
│       ┌───────────┐         ┌───────────┐                                  │
│       │  继续循环 │         │  结束响应 │                                  │
│       │  (Reason) │         │  (Done)   │                                  │
│       └───────────┘         └───────────┘                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 工具系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          工具系统架构                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    agentTools/index.ts (统一入口)                     │    │
│  │                                                                      │    │
│  │  - getAllToolDefinitions(): 获取所有工具定义                          │    │
│  │  - getToolsByCategory(category): 按类别获取工具                       │    │
│  │  - executeTool(name, args, context): 执行工具                         │    │
│  │  - findSimilarTool(name): 相似度匹配                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│           ┌──────────────────────────┼──────────────────────────┐           │
│           ▼                          ▼                          ▼           │
│  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐   │
│  │  搜索工具       │       │  内容工具       │       │  导航工具       │   │
│  │  (search.ts)    │       │  (content.ts)   │       │  (navigation.ts)│   │
│  │  6 个工具       │       │  7 个工具       │       │  4 个工具       │   │
│  └─────────────────┘       └─────────────────┘       └─────────────────┘   │
│           │                          │                          │           │
│           ▼                          ▼                          ▼           │
│  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐   │
│  │  统计工具       │       │  文件操作工具   │       │  标签工具       │   │
│  │  (stats.ts)     │       │  (fileops.ts)   │       │  (tags.ts)      │   │
│  │  5 个工具       │       │  17 个工具 ⭐   │       │  6 个工具       │   │
│  └─────────────────┘       └─────────────────┘       └─────────────────┘   │
│           │                          │                          │           │
│           ▼                          ▼                          ▼           │
│  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐   │
│  │  分享工具       │       │  版本工具       │       │  笔记工具       │   │
│  │  (share.ts)     │       │  (version.ts)   │       │  (notes.ts)     │   │
│  │  10 个工具 ⭐   │       │  4 个工具       │       │  5 个工具       │   │
│  └─────────────────┘       └─────────────────┘       └─────────────────┘   │
│           │                          │                          │           │
│           ▼                          ▼                          ▼           │
│  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐   │
│  │  权限工具       │       │  存储工具       │       │  系统工具       │   │
│  │  (permission.ts)│       │  (storage.ts)   │       │  (system.ts)    │   │
│  │  6 个工具 ⭐    │       │  8 个工具       │       │  11 个工具      │   │
│  └─────────────────┘       └─────────────────┘       └─────────────────┘   │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────┐                                                        │
│  │  AI 增强工具    │                                                        │
│  │  (ai-enhance.ts)│                                                        │
│  │  5 个工具       │                                                        │
│  └─────────────────┘                                                        │
│                                                                              │
│  ⭐ = 包含写操作，需要用户确认                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 模型运行时架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          模型运行时架构                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  调用入口（唯一链路）                                                │    │
│  │  - Agent：resolveModelRuntime → AI SDK streamText                    │    │
│  │  - 后台功能：completeText → AI SDK generateText                      │    │
│  │  - 向量：resolveEmbeddingProvider → AI SDK embedMany                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      modelRuntime (modelRuntime.ts)                  │    │
│  │                                                                      │    │
│  │  职责：                                                              │    │
│  │  - 配置解析（modelService.ts：D1 ai_models / ai_providers）          │    │
│  │  - 思考参数 → AI SDK providerOptions                                 │    │
│  │  - 视觉：Workers AI 走原生 { image, prompt }，其余走 AI SDK          │    │
│  │  - 重试 / 超时 / 错误映射                                            │    │
│  │  - 用量记账（ai_usage_events）                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│              ┌───────────────────────┼───────────────────────┐              │
│              ▼                       ▼                       ▼              │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────┐│
│  │ Workers AI              │ │ OpenAI 兼容             │ │ Anthropic       ││
│  │ createAI({ binding })   │ │ createOpenAICompatible  │ │ createAnthropic ││
│  └─────────────────────────┘ └─────────────────────────┘ └─────────────────┘│
│                                                                              │
│  三层回退机制：                                                              │
│  1. 功能级模型配置（如摘要专用模型）                                          │
│  2. 用户默认活跃模型                                                         │
│  3. Workers AI 默认模型（Llama 3.1 8B）                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 数据模型

### 核心表结构

#### 用户相关

```sql
-- 用户配置表
CREATE TABLE user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    default_bucket TEXT,
    storage_quota INTEGER DEFAULT 10737418240,  -- 10GB
    created_at TEXT,
    updated_at TEXT
);

-- API Key 表
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    permissions TEXT,  -- JSON
    last_used_at TEXT,
    expires_at TEXT,
    created_at TEXT
);
```

#### 文件相关

```sql
-- 文件表
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,  -- R2 object key
    name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    folder_id TEXT,
    summary TEXT,
    description TEXT,
    tags TEXT,  -- JSON array
    is_starred INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

-- 文件夹表
CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    path TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
);

-- 文件版本表
CREATE TABLE file_versions (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    key TEXT NOT NULL,
    size INTEGER,
    created_at TEXT
);

-- 文件标签表
CREATE TABLE file_tags (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at TEXT
);

-- 文件-标签关联表
CREATE TABLE file_tag_relations (
    file_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (file_id, tag_id)
);
```

#### 分享相关

```sql
-- 分享链接表
CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    file_id TEXT,
    folder_id TEXT,
    share_type TEXT NOT NULL,  -- 'public', 'direct', 'upload'
    password_hash TEXT,
    expires_at TEXT,
    max_downloads INTEGER,
    download_count INTEGER DEFAULT 0,
    created_at TEXT
);
```

#### AI 相关

```sql
-- AI 提供商表 (v2.4.0 新增)
CREATE TABLE ai_providers (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    api_endpoint TEXT,
    description TEXT,
    thinking_config TEXT,  -- JSON: 推理模式配置
    is_system INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- AI 模型配置表
CREATE TABLE ai_models (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,  -- 'workers_ai', 'openai_compatible'
    provider_id TEXT,  -- v2.4.0 新增: 关联 ai_providers.id
    model_id TEXT NOT NULL,
    api_endpoint TEXT,
    api_key_encrypted TEXT,
    is_active INTEGER DEFAULT 0,
    capabilities TEXT,  -- JSON array
    max_tokens INTEGER,
    temperature REAL,
    system_prompt TEXT,
    config_json TEXT,
    sort_order INTEGER DEFAULT 0,  -- v2.4.0 新增: 模型排序
    supports_thinking INTEGER DEFAULT 0,  -- v2.4.0 新增: 是否支持推理
    thinking_param_format TEXT,  -- v2.4.0 新增: 推理参数格式
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
);

-- AI 对话会话表
CREATE TABLE ai_chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    model_id TEXT,
    created_at TEXT,
    updated_at TEXT
);

-- AI 对话消息表
CREATE TABLE ai_chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,  -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,
    sources TEXT,  -- JSON
    model_used TEXT,
    latency_ms INTEGER,
    created_at TEXT
);

-- AI 记忆表 (v2.7.0 新增)
CREATE TABLE ai_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'operation' | 'preference' | 'path' | 'file_ref'
    summary TEXT NOT NULL,
    embedding_id TEXT,
    created_at TEXT NOT NULL
);

-- AI 系统配置表
CREATE TABLE ai_system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    category TEXT,
    created_at TEXT,
    updated_at TEXT
);
```

#### AI 任务编排与检索（2026-11-26 新增）

```sql
-- 任务事实源：一次多步任务的终态与当前步骤
CREATE TABLE ai_task_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    status TEXT NOT NULL,          -- running | awaiting_approval | succeeded | failed | cancelled
    current_step_id TEXT,
    total_steps INTEGER NOT NULL DEFAULT 0,
    completed_steps INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

-- 步骤状态机：模型只上报状态，推进与重试由 PlanRuntime 负责
CREATE TABLE ai_task_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    tool_name TEXT,
    status TEXT NOT NULL,          -- pending | running | done | failed | skipped | awaiting_approval
    attempts INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    error TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (run_id, step_index)
);

-- 事件流：审批、重试、死信、工具执行都追加，不覆盖
CREATE TABLE ai_task_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT,
    type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL
);

-- FTS5 关键词索引：122 迁移重建，列名统一为 file_id
CREATE VIRTUAL TABLE files_fts_v2 USING fts5(
    file_id UNINDEXED, name, description, ai_summary, ai_tags,
    tokenize = 'unicode61'
);

-- 上传资产解析（124 迁移）：一次登记，按步骤排队，status 由 ai_tasks 派生后回写
CREATE TABLE ai_ingest_assets (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',   -- JSON: { steps: ['index','summary','tags'], ocr }
    status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | ready | partial | failed
    task_ids TEXT,                        -- JSON: [{ step, taskId }]
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_ai_ingest_assets_file ON ai_ingest_assets(file_id);
```

要点：`ai_task_*` 是任务事实源，DO 回收/断线/审批挂起后按 step 状态续跑；`files_fts_v2` 与 070 的旧 `files_fts`（列名 `id`）并存，旧表只作熔断降级回退。

#### 团队相关 (v3.0.0 新增)

```sql
-- 团队表
CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL,
    avatar_url TEXT,
    storage_quota INTEGER DEFAULT 0,  -- 0 表示不限制
    settings TEXT,  -- JSON: 团队配置
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 团队成员表
CREATE TABLE team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member' | 'viewer'
    status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'pending' | 'suspended'
    invited_by TEXT,
    joined_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (team_id, user_id)
);

-- 团队资源挂载表
CREATE TABLE team_resources (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,  -- 'bucket' | 'folder'
    resource_id TEXT NOT NULL,
    mount_path TEXT NOT NULL,  -- 团队空间内的挂载路径
    permissions TEXT NOT NULL,  -- JSON: 该资源对团队成员的默认权限
    created_at TEXT NOT NULL,
    UNIQUE (team_id, resource_type, resource_id)
);

-- 权限申请表
CREATE TABLE permission_requests (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    requested_role TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
    reviewer_id TEXT,
    reviewed_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL
);

-- 角色模板表
CREATE TABLE role_templates (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    permissions TEXT NOT NULL,  -- JSON: 权限定义
    is_system INTEGER NOT NULL DEFAULT 0,  -- 是否系统内置模板
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## API 设计

### RESTful API 规范

```
GET    /api/resource          # 列表
GET    /api/resource/:id      # 详情
POST   /api/resource          # 创建
PATCH  /api/resource/:id      # 更新
DELETE /api/resource/:id      # 删除
```

### API 模块

以下为 `apps/api/src/index.ts` 实际挂载的前缀（新增模块必须在此登记并同步本节）。

| 模块     | 路径前缀                                                     | 说明                               |
| -------- | ------------------------------------------------------------ | ---------------------------------- |
| 认证     | `/api/auth`                                                  | 注册、登录、JWT、设备、邮箱验证    |
| 文件     | `/api/files`                                                 | 文件与文件夹 CRUD、上传、回收站    |
| 分享     | `/api/share`                                                 | 分享链接、提取码、过期时间         |
| 直链     | `/api/direct`                                                | 公开直链                           |
| 预签名   | `/api/presign`                                               | 直传与分片上传                     |
| 存储桶   | `/api/buckets`                                               | 多厂商存储配置                     |
| 上传任务 | `/api/tasks`                                                 | 分片上传任务与进度                 |
| 离线下载 | `/api/downloads`                                             | URL 离线下载                       |
| 批量操作 | `/api/batch`                                                 | 批量删除 / 移动 / 复制 / 重命名    |
| 搜索     | `/api/search`                                                | 关键词、FTS5 全文、语义搜索        |
| 权限     | `/api/permissions`                                           | 授权、标签、角色模板、审批流       |
| 用户组   | `/api/groups`                                                | 组成员与批量授权                   |
| 团队     | `/api/teams`                                                 | 团队空间、成员、资源挂载           |
| 邀请     | `/api/invite`                                                | 邀请接受与注册                     |
| 预览     | `/api/preview`                                               | 多格式在线预览                     |
| 版本     | `/api/versions`                                              | 历史版本与回滚                     |
| 笔记     | `/api/notes`                                                 | 文件笔记与 @提及                   |
| API Key  | `/api/keys`                                                  | 程序化访问密钥                     |
| Webhook  | `/api/webhooks`                                              | 事件订阅                           |
| AI       | `/api/ai`、`/api/ai-chat`、`/api/ai-config`、`/api/ai/usage` | 能力、对话、配置、用量             |
| 分析     | `/api/analytics`                                             | 存储分析与活跃度                   |
| 通知     | `/api/notifications`                                         | 通知中心                           |
| 管理     | `/api/admin`                                                 | 用户、系统配置、审计、邮件、邀请码 |
| 迁移     | `/api/migrate`                                               | 跨存储桶迁移                       |
| Telegram | `/api/telegram`                                              | Bot 集成                           |
| 文档     | `/api/docs`、`/api/openapi.json`                             | Scalar 交互式文档与 OpenAPI spec   |
| 健康检查 | `/health`                                                    | 服务探针                           |
| WebDAV   | `/dav`                                                       | WebDAV 协议入口                    |
| Agent    | `/agents`                                                    | Durable Object WebSocket           |
| Cron     | `/cron`                                                      | 定时任务入口                       |

### 团队管理 API (v3.0.0 新增)

`/api/teams` — 12 个端点：

| 方法   | 路径                                        | 说明         |
| ------ | ------------------------------------------- | ------------ |
| POST   | `/api/teams`                                | 创建团队     |
| GET    | `/api/teams`                                | 列出我的团队 |
| GET    | `/api/teams/:id`                            | 团队详情     |
| PUT    | `/api/teams/:id`                            | 更新团队信息 |
| DELETE | `/api/teams/:id`                            | 解散团队     |
| POST   | `/api/teams/:id/transfer`                   | 转让所有权   |
| POST   | `/api/teams/:id/members`                    | 邀请成员     |
| GET    | `/api/teams/:id/members`                    | 成员列表     |
| PUT    | `/api/teams/:id/members/:memberUserId/role` | 更新成员角色 |
| DELETE | `/api/teams/:id/members/:memberUserId`      | 移除成员     |
| POST   | `/api/teams/:id/resources`                  | 挂载资源     |
| GET    | `/api/teams/:id/resources/list`             | 资源列表     |
| DELETE | `/api/teams/:id/resources/:fileId`          | 卸载资源     |

> 邀请（`/invites`）、动态（`/activities`）、存储统计（`/storage`）、工作区（`/workspace/*`）等端点未在此展开，完整清单见 `/api/docs` 的 Teams 分组。

### 权限扩展 API (v3.0.0 新增)

`/api/permissions` — 7 个新端点：

| 方法 | 路径                                          | 说明         |
| ---- | --------------------------------------------- | ------------ |
| POST | `/api/permissions/requests`                   | 提交权限申请 |
| GET  | `/api/permissions/requests/my`                | 我的申请     |
| GET  | `/api/permissions/requests/pending`           | 待审批列表   |
| PUT  | `/api/permissions/requests/:requestId/review` | 审批权限申请 |
| POST | `/api/permissions/batch-grant`                | 批量授权     |
| POST | `/api/permissions/batch-revoke`               | 批量取消授权 |
| GET  | `/api/permissions/roles/templates`            | 角色模板列表 |

### 响应格式

**成功响应**（列表接口额外带 `pagination`）:

```json
{
  "success": true,
  "data": { ... },
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

**错误响应**（由 `apps/api/src/middleware/error.ts` 统一产出）:

```json
{
  "success": false,
  "error": {
    "code": "F404",
    "name": "FILE_NOT_FOUND",
    "message": "文件不存在",
    "details": { ... },
    "requestId": "uuid",
    "timestamp": "2026-11-22T00:00:00.000Z"
  }
}
```

> `code` 取自 `@osshelf/shared` 的 `ERROR_CODES`（如 `F404`），`name` 是对应的错误码键名（如 `FILE_NOT_FOUND`）。
> 存量路由中仍有直接 `return c.json({ success: false, error: { code, message } })` 的精简写法（缺 `name` / `requestId` / `timestamp`），新接口统一用 `throwAppError` 走全局错误处理。

---

## 安全架构

### 认证与授权

```
┌─────────────────────────────────────────────────────────────┐
│                      认证流程                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  请求 → Clerk 中间件 → 用户验证 → 权限检查 → 业务处理        │
│                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │  请求   │───→│  Clerk  │───→│  权限   │───→│  业务   │  │
│  │         │    │  验证   │    │  检查   │    │  处理   │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 数据安全

- **API Key 加密**：使用 AES-256-GCM 加密存储
- **密码哈希**：使用 bcrypt 进行哈希
- **敏感数据**：不记录日志，不返回给前端

### 访问控制

- **文件访问**：检查文件所有者
- **分享访问**：验证分享密码和有效期
- **API 访问**：验证 API Key 权限

### v2.7.0 安全增强（22 项修复）

**安全防护层新增**

```
┌─────────────────────────────────────────────────────────────┐
│                 v2.7.0 安全防护层                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ CORS 防护       │  │ 时序攻击防护     │                   │
│  │ • 未知origin拒绝 │  │ • timingSafeEqual│                  │
│  │ • 不回退白名单   │  │ • KV 5min/10次  │                   │
│  └─────────────────┘  └─────────────────┘                   │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ SQL 注入防护    │  │ 暴力破解防护     │                   │
│  │ • 字段白名单     │  │ • IP维KV限流     │                   │
│  │ • switch映射     │  │ • WebDAV 5min/10次│                 │
│  └─────────────────┘  └─────────────────┘                   │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ OOM 防护        │  │ 竞态条件防护     │                   │
│  │ • SQL替代内存加载│  │ • 原子CAS操作    │                   │
│  │ • Response透传   │  │ • 单条SQL完成    │                   │
│  └─────────────────┘  └─────────────────┘                   │
│                                                              │
│  ┌─────────────────────────────────────────────────┐        │
│  │ 中断恢复机制（AI 流式输出）                      │        │
│  │ • AbortController + signal.aborted 检测         │        │
│  │ • DOMException('AbortError') 标准化             │        │
│  │ • aborted: true 状态标记 + 内容保留            │        │
│  └─────────────────────────────────────────────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**关键安全组件（v2.7.0 新增）**

| 组件                  | 文件                                       | 功能                           |
| --------------------- | ------------------------------------------ | ------------------------------ |
| `timingSafeEqual()`   | `routes/share.ts`                          | HMAC 常量时间比较，防时序攻击  |
| `ALLOWED_SORT_FIELDS` | `routes/files.ts`                          | sortBy 字段白名单，防 SQL 注入 |
| IP KV 速率限制器      | `routes/webdav.ts`, `routes/directLink.ts` | 按 IP 维度限流防暴力破解       |
| 原子 CAS 计数器       | `routes/share.ts`                          | 下载计数原子更新，防 TOCTOU    |
| AbortController 链路  | `services/api.ts`, `pages/AIChat.tsx`      | AI 流式中断内容保留            |

---

## 部署架构

### Cloudflare 部署

```
┌──────────────────────────────────────────────────────────────┐
│                     Cloudflare 部署架构                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                  Worker: ossshelf                │    │
│  │                                                      │    │
│  │   [assets] apps/web/dist ◄── 静态资源 + SPA 回退      │    │
│  │        │                                             │    │
│  │        ├── /api      → Hono 路由                     │    │
│  │        ├── /dav      → WebDAV                        │    │
│  │        ├── /agents   → OSSShelfAgent (Durable Object)│    │
│  │        ├── /cron     → 定时任务入口                   │    │
│  │        └── /health   → 健康检查                       │    │
│  └──────────────┬───────────────────────────────────────┘    │
│                 │ 绑定                                        │
│                 ▼                                             │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐    │
│  │   D1     │    KV    │  Queue   │Vectorize │Workers AI│    │
│  │ (数据库) │ (缓存)   │(AI 批处理)│(向量库)  │(AI 服务) │    │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘    │
│                                                               │
└───────────────────────────────┬───────────────────────────────┘
                                ▼
                        ┌──────────────┐
                        │     用户      │
                        └──────────────┘
```

部署编排：GitHub Actions 先执行 D1 迁移，成功后 POST Deploy Hook，由 Workers Builds
执行 `pnpm build:web` 与 `wrangler deploy`；前端与 API 同源。

### 环境变量

```toml
# wrangler.toml
[vars]
ENVIRONMENT = "production"

[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "xxx"

[[kv_namespaces]]
binding = "KV"
id = "xxx"

[[vectorize]]
binding = "VECTORIZE"
index_name = "ossshelf-files"

[ai]
binding = "AI"
```

---

## 相关文档

- [AI 功能说明](./AI_FEATURES.md)
- [AI API 文档](./API_AI.md)
- [更新日志](../CHANGELOG.md)
