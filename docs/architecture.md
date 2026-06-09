# OSSshelf 架构文档

**版本**: v5.1.0
**更新日期**: 2026-06-08

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
| React        | 18.x | UI 框架      |
| TypeScript   | 5.x  | 类型安全     |
| Vite         | 5.x  | 构建工具     |
| Tailwind CSS | 3.x  | 样式框架     |
| Radix UI     | -    | 无障碍组件库 |
| React Router | 6.x  | 路由管理     |
| Zustand      | 4.x  | 状态管理     |
| React Query  | 5.x  | 数据获取     |
| Clerk        | -    | 用户认证     |

### 后端

| 技术                  | 版本 | 用途              |
| --------------------- | ---- | ----------------- |
| Hono                  | 4.x  | Web 框架          |
| TypeScript            | 5.x  | 类型安全          |
| Cloudflare Workers    | -    | Serverless 运行时 |
| Cloudflare D1         | -    | SQLite 数据库     |
| Cloudflare R2         | -    | 对象存储          |
| Cloudflare Vectorize  | -    | 向量数据库        |
| Cloudflare Workers AI | -    | AI 推理服务       |

### 开发工具

| 工具      | 用途          |
| --------- | ------------- |
| Turborepo | Monorepo 管理 |
| ESLint    | 代码检查      |
| Prettier  | 代码格式化    |
| Vitest    | 单元测试      |

---

## 项目结构

```
OSSshelf/
├── apps/
│   ├── api/                    # 后端 API 服务
│   │   ├── src/
│   │   │   ├── index.ts        # 入口文件
│   │   │   ├── routes/         # API 路由
│   │   │   │   ├── ai.ts       # AI 相关路由
│   │   │   │   ├── aiChatRoutes.ts    # AI 对话路由 (v4.3.0)
│   │   │   │   ├── aiConfigRoutes.ts  # AI 配置路由 (v4.3.0)
│   │   │   │   ├── files.ts    # 文件管理路由
│   │   │   │   ├── auth.ts     # 认证路由
│   │   │   │   └── ...
│   │   │   ├── lib/            # 核心库
│   │   │   │   ├── ai/         # AI 模块 (v4.3.0 重点)
│   │   │   │   │   ├── agentEngine.ts    # Agent 引擎
│   │   │   │   │   ├── agentTools/       # 工具集 (95个工具)
│   │   │   │   │   ├── modelGateway.ts   # 模型网关
│   │   │   │   │   ├── ragEngine.ts      # RAG 引擎
│   │   │   │   │   └── ...
│   │   │   │   ├── db/         # 数据库操作
│   │   │   │   │   ├── index.ts
│   │   │   │   │   └── schema.ts
│   │   │   │   ├── s3client.ts # S3/R2 客户端
│   │   │   │   └── ...
│   │   │   ├── middleware/     # 中间件
│   │   │   └── utils/          # 工具函数
│   │   ├── migrations/         # 数据库迁移
│   │   │   ├── 0001_init.sql
│   │   │   ├── ...
│   │   │   └── 0011_ai_confirm_requests.sql  # v4.3.0
│   │   ├── wrangler.toml       # Cloudflare Workers 配置
│   │   └── package.json
│   │
│   └── web/                    # 前端应用
│       ├── src/
│       │   ├── main.tsx        # 入口文件
│       │   ├── App.tsx         # 应用组件
│       │   ├── pages/          # 页面组件
│       │   │   ├── AIChat.tsx  # AI 对话页面 (v4.3.0)
│       │   │   ├── AISettings.tsx # AI 设置页面 (v4.3.0)
│       │   │   ├── Files.tsx   # 文件管理页面
│       │   │   └── ...
│       │   ├── components/     # 组件
│       │   │   ├── ai/         # AI 相关组件
│       │   │   │   ├── chat/   # 对话组件
│       │   │   │   └── settings/  # 设置组件
│       │   │   ├── files/      # 文件相关组件
│       │   │   └── ui/         # 通用 UI 组件
│       │   ├── hooks/          # 自定义 Hooks
│       │   ├── stores/         # Zustand 状态
│       │   ├── services/       # API 服务
│       │   └── utils/          # 工具函数
│       ├── vite.config.ts      # Vite 配置
│       └── package.json
│
├── packages/                   # 共享包
│   └── shared/                 # 共享类型和工具
│       ├── src/
│       │   └── constants/
│       │       └── index.ts    # 共享常量
│       └── package.json
│
├── docs/                       # 文档
│   ├── AI_FEATURES.md          # AI 功能说明 (v4.3.0)
│   ├── API_AI.md               # AI API 文档 (v4.3.0)
│   └── architecture.md         # 架构文档（本文件）
│
├── package.json                # 根 package.json
├── turbo.json                  # Turborepo 配置
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

### 4. 团队协作模块 (v5.0.0 新增)

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

v4.7.0 AI 模块采用分层架构，核心是 Agent 引擎、工具系统和提供商管理。v4.7.0 版本新增 Planning 层、跨会话记忆系统、模型熔断器、批量操作队列打通等核心能力，工具总数扩展至 **100+** 个。

### 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AI 模块架构 v4.7.0                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          API 层 (routes/ai.ts)                        │    │
│  │  /api/ai/agent/chat  │  /api/ai/models  │  /api/ai/config  │  ...    │    │
│  │  /api/ai/memories    │  (v4.7.0 新增: 记忆管理)                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Agent 引擎 (agentEngine.ts)                   │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │                    ReAct 循环 + Planning 层 (v4.7.0 新增)     │    │    │
│  │  │  Reason → Plan → Act → Observe → Reason → Act → ...         │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  │                                                                      │    │
│  │  功能：                                                              │    │
│  │  - 意图识别与工具选择                                                │    │
│  │  - 结构化任务规划（ExecutionPlan）(v4.7.0 新增)                       │    │
│  │  - 链式推理与自动规划                                                │    │
│  │  - 循环防护与去重                                                    │    │
│  │  - 写操作确认机制                                                    │    │
│  │  - SSE 流式响应（含 plan/plan_step_update 事件）(v4.7.0 增强)        │    │
│  │  - 模型熔断器集成 (circuitBreaker.ts, v4.7.0 新增)                  │    │
│  │  - 跨会话记忆召回 (agentMemory.ts, v4.7.0 新增)                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│          ┌───────────────────────────┼───────────────────────────┐          │
│          ▼                           ▼                           ▼          │
│  ┌───────────────┐         ┌───────────────┐         ┌───────────────┐    │
│  │  工具执行器   │         │  模型网关     │         │  RAG 引擎     │    │
│  │ (agentTools/) │         │(modelGateway) │         │ (ragEngine)   │    │
│  └───────────────┘         └───────────────┘         └───────────────┘    │
│          │                           │                           │          │
│          ▼                           ▼                           ▼          │
│  ┌───────────────┐         ┌───────────────┐         ┌───────────────┐    │
│  │ 100+ 个工具   │         │  提供商管理   │         │  Vectorize    │    │
│  │  13+ 个模块   │         │ (aiProviders) │         │  向量搜索     │    │
│  │              │         │  16 个内置    │         │              │    │
│  └───────────────┘         └───────────────┘         └───────────────┘    │
│                                                                              │
│  v4.7.0 新增模块：                                                           │
│  ├─ agentMemory.ts — 跨会话记忆管理（D1+Vectorize 双存储）                   │
│  ├─ circuitBreaker.ts — 模型调用熔断器（三态状态机）                         │
│  ├─ batch_move/batch_delete — 批量操作工具（BATCH_THRESHOLD=20）            │
│  │                                                                          │
│  v4.6.0 新增工具 (4个)：                                                     │
│  ├─ list_expired_permissions (permission.ts)                                │
│  ├─ draft_and_create_file (fileops.ts)                                     │
│  ├─ smart_organize_suggest (ai-enhance.ts)                                 │
│  └─ analyze_file_collection (content.ts)                                   │
│                                                                              │
│                                      │                                       │
│                                      ▼                                       │
│                      ┌───────────────────────────────┐                      │
│                      │        模型适配器             │                      │
│                      ├───────────────────────────────┤                      │
│                      │  Workers AI  │ OpenAI 兼容   │                      │
│                      └───────────────────────────────┘                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### AI 提供商管理架构 (v4.4.0 新增)

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
│  │  新增字段 (v4.4.0)：                                                 │    │
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

### 模型网关架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          模型网关架构                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      ModelGateway (modelGateway.ts)                   │    │
│  │                                                                      │    │
│  │  职责：                                                              │    │
│  │  - 模型配置管理                                                      │    │
│  │  - 请求路由                                                          │    │
│  │  - 流式响应处理                                                      │    │
│  │  - 错误处理与重试                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│              ┌───────────────────────┴───────────────────────┐              │
│              ▼                                               ▼              │
│  ┌─────────────────────────┐                   ┌─────────────────────────┐  │
│  │  Workers AI 适配器      │                   │  OpenAI 兼容适配器      │  │
│  │  (workersAiAdapter.ts)  │                   │(openAiCompatibleAdapter)│  │
│  │                         │                   │                         │  │
│  │  - 内置模型列表         │                   │ - 自定义端点            │  │
│  │  - 自动能力检测         │                   │ - API Key 管理          │  │
│  │  - Workers AI API       │                   │ - OpenAI API 格式       │  │
│  └─────────────────────────┘                   └─────────────────────────┘  │
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
-- AI 提供商表 (v4.4.0 新增)
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
    provider_id TEXT,  -- v4.4.0 新增: 关联 ai_providers.id
    model_id TEXT NOT NULL,
    api_endpoint TEXT,
    api_key_encrypted TEXT,
    is_active INTEGER DEFAULT 0,
    capabilities TEXT,  -- JSON array
    max_tokens INTEGER,
    temperature REAL,
    system_prompt TEXT,
    config_json TEXT,
    sort_order INTEGER DEFAULT 0,  -- v4.4.0 新增: 模型排序
    supports_thinking INTEGER DEFAULT 0,  -- v4.4.0 新增: 是否支持推理
    thinking_param_format TEXT,  -- v4.4.0 新增: 推理参数格式
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

-- AI 确认请求表 (v4.3.0 新增)
CREATE TABLE ai_confirm_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,  -- JSON
    summary TEXT NOT NULL,
    status TEXT DEFAULT 'pending',  -- 'pending', 'consumed'
    created_at TEXT,
    expires_at TEXT
);

-- AI 记忆表 (v4.7.0 新增)
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

#### 团队相关 (v5.0.0 新增)

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

| 模块   | 路径前缀           | 说明                   |
| ------ | ------------------ | ---------------------- |
| 认证   | `/api/auth`        | 用户认证、会话管理     |
| 文件   | `/api/files`       | 文件上传、下载、管理   |
| 文件夹 | `/api/folders`     | 文件夹管理             |
| 分享   | `/api/shares`      | 分享链接管理           |
| AI     | `/api/ai`          | AI 功能                |
| 用户   | `/api/user`        | 用户配置               |
| 团队   | `/api/teams`       | 团队管理 (v5.0.0)      |
| 权限   | `/api/permissions` | 权限管理 (v5.0.0 扩展) |

### 团队管理 API (v5.0.0 新增)

`/api/teams` — 12 个端点：

| 方法   | 路径                                   | 说明         |
| ------ | -------------------------------------- | ------------ |
| POST   | `/api/teams`                           | 创建团队     |
| GET    | `/api/teams`                           | 列出我的团队 |
| GET    | `/api/teams/:id`                       | 团队详情     |
| PATCH  | `/api/teams/:id`                       | 更新团队信息 |
| DELETE | `/api/teams/:id`                       | 解散团队     |
| POST   | `/api/teams/:id/members`               | 邀请成员     |
| GET    | `/api/teams/:id/members`               | 成员列表     |
| PATCH  | `/api/teams/:id/members/:userId`       | 更新成员角色 |
| DELETE | `/api/teams/:id/members/:userId`       | 移除成员     |
| POST   | `/api/teams/:id/resources`             | 挂载资源     |
| GET    | `/api/teams/:id/resources`             | 资源列表     |
| DELETE | `/api/teams/:id/resources/:resourceId` | 卸载资源     |

### 权限扩展 API (v5.0.0 新增)

`/api/permissions` — 7 个新端点：

| 方法  | 路径                            | 说明         |
| ----- | ------------------------------- | ------------ |
| POST  | `/api/permissions/requests`     | 提交权限申请 |
| GET   | `/api/permissions/requests`     | 申请列表     |
| PATCH | `/api/permissions/requests/:id` | 审批权限申请 |
| POST  | `/api/permissions/batch`        | 批量权限操作 |
| GET   | `/api/roles/templates`          | 角色模板列表 |
| POST  | `/api/roles/templates`          | 创建角色模板 |
| PUT   | `/api/roles/templates/:id`      | 更新角色模板 |

### 响应格式

**成功响应**:

```json
{
  "data": { ... },
  "message": "操作成功"
}
```

**错误响应**:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": { ... }
  }
}
```

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

### v4.7.0 安全增强（22 项修复）

**安全防护层新增**

```
┌─────────────────────────────────────────────────────────────┐
│                 v4.7.0 安全防护层                            │
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

**关键安全组件（v4.7.0 新增）**

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
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare 部署架构                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Cloudflare                        │    │
│  │                                                      │    │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────┐ │    │
│  │  │   Pages     │    │   Workers   │    │   R2    │ │    │
│  │  │  (前端)     │    │  (后端 API) │    │ (存储)  │ │    │
│  │  └─────────────┘    └─────────────┘    └─────────┘ │    │
│  │         │                  │                │       │    │
│  │         │                  ▼                │       │    │
│  │         │          ┌─────────────┐          │       │    │
│  │         │          │     D1      │          │       │    │
│  │         │          │  (数据库)   │──────────┘       │    │
│  │         │          └─────────────┘                  │    │
│  │         │                  │                        │    │
│  │         │                  ▼                        │    │
│  │         │          ┌─────────────┐                  │    │
│  │         │          │ Vectorize   │                  │    │
│  │         │          │  (向量库)   │                  │    │
│  │         │          └─────────────┘                  │    │
│  │         │                  │                        │    │
│  │         │                  ▼                        │    │
│  │         │          ┌─────────────┐                  │    │
│  │         │          │ Workers AI  │                  │    │
│  │         │          │  (AI 服务)  │                  │    │
│  │         │          └─────────────┘                  │    │
│  │         │                                           │    │
│  │         └───────────────────────────────────────────┘    │
│  │                          │                               │    │
│  └──────────────────────────┼───────────────────────────────┘    │
│                             │                                    │
│                             ▼                                    │
│                    ┌─────────────────┐                          │
│                    │     用户        │                          │
│                    └─────────────────┘                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 环境变量

```toml
# wrangler.toml
[vars]
ENVIRONMENT = "production"

[[d1_databases]]
binding = "DB"
database_name = "ossshelf"
database_id = "xxx"

[[r2_buckets]]
binding = "R2"
bucket_name = "ossshelf"

[[vectorize]]
binding = "VECTORIZE"
index_name = "ossshelf"

[ai]
binding = "AI"
```

---

## 相关文档

- [AI 功能说明](./AI_FEATURES.md)
- [AI API 文档](./API_AI.md)
- [更新日志](../CHANGELOG.md)
