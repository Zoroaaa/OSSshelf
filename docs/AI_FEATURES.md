# OSSshelf AI 功能说明文档

**版本**: v4.2.0
**更新日期**: 2026-04-06

---

## 📋 目录

- [功能概述](#功能概述)
- [AI 对话系统](#ai-对话系统)
- [Agent 引擎](#agent-引擎)
- [AI 文件处理功能](#ai-文件处理功能)
- [多模型支持](#多模型支持)
- [AI 配置中心](#ai-配置中心)
- [功能级模型配置](#功能级模型配置)
- [AI 系统配置](#ai-系统配置)
- [批量操作](#批量操作)
- [向量库管理](#向量库管理)
- [移动端支持](#移动端支持)
- [技术架构](#技术架构)

---

## 功能概述

v4.2.0 版本对 AI 功能进行了全面升级，新增以下核心能力：

| 功能 | 说明 | 版本 |
|------|------|------|
| **Agent 引擎** | 支持工具调用、推理内容显示、多轮对话 | v4.2.0 新增 |
| **AI 系统配置** | 可配置默认模型、参数、限制、重试策略、提示词模板 | v4.2.0 新增 |
| **向量库管理** | 查看和删除向量索引，支持分页和搜索 | v4.2.0 新增 |
| **任务中心** | 统一显示所有任务状态，实时进度监控 | v4.2.0 新增 |
| **全局 AI 聊天** | 悬浮式 AI 聊天组件，支持会话切换 | v4.2.0 新增 |
| **自定义模型** | 支持任意 Workers AI 模型 ID | v4.2.0 新增 |
| **AI 对话** | 基于 RAG 的智能问答，支持文件内容理解 | v4.1.0 |
| **多模型架构** | 支持 Workers AI + OpenAI 兼容 API | v4.1.0 |
| **文件摘要** | 自动生成文本文件内容摘要 | v3.7.0, v4.1.0 增强 |
| **图片描述** | 识别图片内容并生成文字描述 | v3.7.0, v4.1.0 增强 |
| **图片标签** | 自动识别图片内容标签 | v3.7.0, v4.1.0 增强 |
| **语义搜索** | 基于向量索引的相似度搜索 | v3.7.0 |
| **智能重命名** | 根据文件内容推荐文件名 | v3.7.0, v4.1.0 增强 |

---

## AI 对话系统

### 功能介绍

全新的 AI 对话页面，提供现代化的聊天体验：

- **SSE 流式响应**：实时打字效果，无需等待完整回复
- **会话管理**：创建、切换、删除多个对话会话
- **RAG 集成**：基于用户存储的文件内容进行智能问答
- **Markdown 渲染**：支持代码高亮、表格、列表等格式
- **源文件引用**：回答中引用相关文件，可点击跳转
- **推理内容显示**：支持显示模型的思考过程（DeepSeek R1、智谱 GLM 等）
- **工具调用显示**：显示 AI 调用的工具和结果

### 全局悬浮聊天组件

v4.2.0 新增全局悬浮式 AI 聊天组件（AIChatWidget）：

- **位置**：页面右下角悬浮按钮
- **功能**：
  - 快速发起 AI 对话
  - 会话列表切换
  - 抽屉式聊天面板
  - 支持最小化/展开

### 使用方式

1. 访问 `/ai-chat` 页面（或点击导航栏「AI 对话」）
2. 或点击页面右下角悬浮按钮打开聊天面板
3. 直接输入问题开始对话
4. 系统自动搜索相关文件并基于文件内容回答

### 支持的提问类型

```
"我的项目里有哪些配置文件？"
"帮我总结一下上周的会议记录"
"找到所有包含 'API' 关键字的代码文件"
"这个图片里写了什么？"
```

### RAG 工作原理

```
用户提问 → 向量搜索相关文件 → 组装上下文 → 发送给 AI 模型 → 流式返回答案
                                                    ↓
                                              引用来源文件
```

---

## Agent 引擎

### 功能介绍

v4.2.0 新增 Agent 引擎（agentEngine.ts），提供更强大的 AI 代理能力：

**核心特性**：
- **工具调用（Function Calling）**：AI 可调用预定义工具获取信息
- **推理内容（Reasoning Content）**：显示模型的思考过程
- **多轮对话**：支持上下文记忆和连续对话
- **流式输出**：实时返回 AI 响应

### 内置工具

Agent 引擎内置以下工具：

| 工具名称 | 功能 | 说明 |
|---------|------|------|
| `search_files` | 搜索文件 | 根据关键词搜索用户文件 |
| `get_file_content` | 获取文件内容 | 读取指定文件的内容 |
| `list_files` | 列出文件 | 列出指定文件夹下的文件 |
| `get_file_info` | 获取文件信息 | 获取文件的元数据信息 |

### 推理内容支持

以下模型支持显示推理内容：

| 厂商 | 模型 | 说明 |
|------|------|------|
| DeepSeek | R1 系列 | 显示完整推理过程 |
| 智谱 | GLM-4.5/4.6/4.7/5 | 支持 thinking 模式 |
| 阿里 | QwQ 系列 | 显示推理过程 |

### SSE 事件类型

流式响应支持以下事件类型：

```typescript
// 文本内容
{ content: "文本内容", done: false }

// 推理内容
{ reasoning: true, content: "思考过程...", done: false }

// 工具调用开始
{ toolStart: true, toolName: "search_files", toolCallId: "xxx", args: {...}, done: false }

// 工具调用结果
{ toolResult: true, toolCallId: "xxx", toolName: "search_files", result: {...}, done: false }

// 完成
{ done: true, sessionId: "xxx", sources: [...] }
```

---

## AI 文件处理功能

### 1️⃣ 文件摘要生成

**功能**：为文本文件自动生成内容摘要

**支持的文件类型**：
- 代码文件（JS、TS、Python、Java、Go 等）
- 配置文件（JSON、YAML、XML、INI 等）
- Markdown、TXT、CSV 等纯文本文件

**使用方式**：
- 单个文件：右键菜单 →「AI 摘要」
- 批量处理：AI 设置 → 索引与处理 →「批量生成摘要」

**输出示例**：
```
这是一个 React 组件，实现了用户登录表单功能。
包含邮箱/密码输入框、记住我选项、登录按钮。
使用了 Formik 进行表单管理，Yup 进行验证。
```

### 2️⃣ 图片智能描述 + 标签

**功能**：
- **图片描述**：识别图片中的文字、场景、物体等，生成自然语言描述
- **图片标签**：自动分类并生成标签（如：风景、人物、文档等）

**使用的模型**：
- 描述：LLaVA 1.5 7B Vision（需 vision 能力）
- 标签：使用 chat 模型生成

**使用方式**：
- 单个图片：右键菜单 →「AI 描述」或「AI 标签」
- 批量处理：AI 设置 → 索引与处理 →「批量生成标签」

### 3️⃣ 语义搜索

**功能**：基于文件内容的语义相似度搜索，而非简单的关键词匹配

**工作流程**：
```
文件上传 → 提取文本 → 向量化 → 存入 Vectorize
                                        ↓
用户搜索 → 查询向量化 → 相似度匹配 → 返回结果
```

**优势**：
- 支持自然语言查询（如"找关于用户认证的代码"）
- 跨语言搜索
- 语义理解（同义词、概念关联）

**使用方式**：
- 批量索引：AI 设置 → 索引与处理 →「一键生成索引」
- 搜索：文件列表页面的搜索栏切换到「语义搜索」

### 4️⃣ 智能重命名

**功能**：根据文件内容智能推荐文件名

**使用方式**：
- 已有文件：右键菜单 →「智能重命名」
- 新建文件：创建文件对话框中的「AI 命名」选项

**输出示例**：
```
原文件名: untitled.js
建议名称:
1. UserLoginForm.jsx
2. LoginFormComponent.tsx
3. AuthLoginPage.js
```

---

## 多模型支持

### Workers AI 内置模型

系统内置多个 Cloudflare Workers AI 模型，可直接使用：

#### 聊天模型 (Chat)

| 模型 ID | 名称 | 参数量 | 特点 | 推荐场景 |
|---------|------|--------|------|---------|
| `@cf/deepseek/deepseek-r1-distill-qwen-32b` | DeepSeek R1 32B | 32B | 推理能力强 | 数学、代码、复杂推理 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Llama 3.3 70B | 70B | Meta 最新 | 复杂任务首选 |
| `@cf/qwen/qwen1.5-14b-chat-awq` | Qwen 1.5 14B | 14B | 中文优秀 | 中文对话 |
| `@cf/meta/llama-3.1-8b-instruct` | Llama 3.1 8B | 8B | 通用型 | 默认模型，日常使用 |
| `@cf/mistral/mistral-7b-instruct-v0.2` | Mistral 7B | 7B | 速度快 | 实时对话 |
| `@cf/google/gemma-2b-it-lora` | Gemma 2B | 2B | 轻量 | 简单任务 |

#### 视觉模型 (Vision)

| 模型 ID | 名称 | 用途 |
|---------|------|------|
| `@cf/llava-hf/llava-1.5-7b-hf` | LLaVA 1.5 7B | 图片理解和描述 |

#### 嵌入模型 (Embedding)

| 模型 ID | 名称 | 用途 |
|---------|------|------|
| `@cf/baai/bge-m3` | BGE-M3 | 文本向量化、语义搜索 |

#### 自定义模型

v4.2.0 新增自定义模型选项，支持输入任意 Workers AI 模型 ID：

- 支持所有 `@cf/` 开头的模型 ID
- 例如：`@cf/deepseek/deepseek-r1`、`@cf/black-forest-labs/flux-2-klein-4b`
- 可在 [Workers AI 模型目录](https://developers.cloudflare.com/workers-ai/models/) 查看所有可用模型

### OpenAI 兼容 API

支持接入任何 OpenAI API 格式的服务：

**支持的服务商**：
- OpenAI（GPT-4o、GPT-4 Turbo 等）
- Anthropic（Claude 3.5 Sonnet 等）
- Google（Gemini Pro 等）
- Ollama（本地部署）
- 其他兼容服务

**配置要求**：
- API Endpoint URL
- API Key
- 选择模型 ID

### 模型能力

| 能力 | 说明 | 适用功能 |
|------|------|---------|
| `chat` | 文本对话 | 摘要生成、智能重命名、对话 |
| `vision` | 图片理解 | 图片描述、图片标签 |
| `embedding` | 文本向量化 | 语义搜索 |
| `function_calling` | 工具调用 | Agent 引擎 |

---

## AI 配置中心

### 访问位置

导航至 `/ai-settings` 或点击导航栏「AI 配置」

### 标签页功能

#### 📋 模型管理（Models 标签）

- **添加模型**：选择 Workers AI 或自定义 API
- **编辑模型**：修改名称、参数、提示词等
- **删除模型**：移除不需要的模型
- **激活模型**：设置当前使用的默认模型
- **测试连接**：发送测试消息验证可用性

#### ⚡ 可用模型（Providers 标签）

Workers AI 模型列表，每个模型显示：
- 模型名称和 ID
- 能力标签（chat/vision/embedding）
- 一键快速启用按钮
- 当前使用状态

#### 🎯 索引与处理（Index 标签）

为不同 AI 功能选择专用模型：

| 功能 | 可选模型范围 | 说明 |
|------|------------|------|
| 文件摘要 | chat 模型 | 推荐使用大参数模型 |
| 图片描述 | vision 模型 | 必须支持图片理解 |
| 图片标签 | chat 模型 | 使用文本模型生成标签 |
| 智能重命名 | chat 模型 | 推荐使用轻量快速模型 |

#### 📊 向量库（Vectors 标签）v4.2.0 新增

查看和管理向量索引：
- 已索引文件列表（分页显示）
- 文件名、类型、大小、索引时间
- 摘要生成状态
- 单个删除向量索引

#### 📈 任务中心（Tasks 标签）v4.2.0 新增

统一显示所有任务状态：
- 索引任务状态
- 摘要生成任务状态
- 标签生成任务状态
- 文件处理总览统计

#### ⚙️ 高级配置（Advanced 标签）v4.2.0 新增

AI 系统配置管理，详见 [AI 系统配置](#ai-系统配置)。

---

## 功能级模型配置

### 配置说明

可以为每个 AI 功能单独指定使用的模型，实现精细化控制：

**配置优先级**：
```
功能级模型 > 用户默认活跃模型 > Workers AI 默认模型
```

### 能力限制

选择模型时会根据功能需求进行过滤：

| 功能 | 要求的能力 | 可选模型示例 |
|------|-----------|-------------|
| 文件摘要 | `chat` | Llama 3.1 8B, DeepSeek 32B, GPT-4o |
| 图片描述 | `vision` | LLaVA 1.5 7B, GPT-4 Vision |
| 图片标签 | `chat` | Llama 3.1 8B, Qwen 14B, GPT-4o |
| 智能重命名 | `chat` | Llama 3.1 8B, Qwen 14B, GPT-4o |

### 配置方法

1. 进入 AI 设置 → 索引与处理
2. 找到「功能模型配置」区域
3. 为每个功能选择模型（或留空使用默认）
4. 选择后自动保存

---

## AI 系统配置

v4.2.0 新增 AI 系统配置功能，支持细粒度的 AI 参数调整。

### 配置分类

| 分类 | 说明 | 配置项示例 |
|------|------|-----------|
| 🤖 默认模型 | 各功能的默认模型 | 默认聊天模型、默认视觉模型 |
| ⚙️ 模型参数 | 模型调用参数 | 默认温度、最大 Token |
| 📏 内容限制 | 内容生成限制 | 摘要最大长度、标签最大数量 |
| 🔄 重试策略 | 错误重试配置 | 最大重试次数、重试间隔 |
| 💬 提示词模板 | 自定义提示词 | 摘要提示词、标签提示词 |
| ✨ 功能开关 | 功能启用控制 | 启用推理内容显示 |

### 配置项示例

| 配置 Key | 说明 | 默认值 |
|----------|------|--------|
| `ai.default_model.chat` | 默认聊天模型 | `@cf/meta/llama-3.1-8b-instruct` |
| `ai.default_model.vision` | 默认视觉模型 | `@cf/llava-hf/llava-1.5-7b-hf` |
| `ai.default_model.summary` | 默认摘要模型 | `@cf/meta/llama-3.1-8b-instruct` |
| `ai.default_model.image_caption` | 默认图片描述模型 | `@cf/llava-hf/llava-1.5-7b-hf` |
| `ai.default_model.image_tag` | 默认图片标签模型 | `@cf/llava-hf/llava-1.5-7b-hf` |
| `ai.default_model.rename` | 默认重命名模型 | `@cf/meta/llama-3.1-8b-instruct` |
| `ai.parameter.temperature` | 默认温度 | `0.7` |
| `ai.parameter.max_tokens` | 默认最大 Token | `4096` |
| `ai.limit.summary_max_length` | 摘要最大长度 | `500` |
| `ai.limit.tags_max_count` | 标签最大数量 | `10` |
| `ai.retry.max_attempts` | 最大重试次数 | `3` |
| `ai.retry.delay_ms` | 重试间隔（毫秒） | `1000` |

### 配置方法

1. 进入 AI 设置 → 高级配置
2. 找到需要修改的配置项
3. 点击「编辑」按钮修改值
4. 可点击「重置」按钮恢复默认值

---

## 批量操作

### 一键摘要

**功能**：为所有未摘要的文本文件生成摘要

**优化项**：
- ✅ 支持取消操作
- ✅ 单文件超时 30 秒
- ✅ 连续错误 10 次终止
- ✅ 并发数 3
- ✅ 实时进度反馈

**API**：
```http
POST /api/ai/summarize/batch   # 启动任务
GET  /api/ai/summarize/task    # 查询状态
DELETE /api/ai/summarize/batch # 取消任务
```

### 一键标签+描述

**功能**：为所有未处理的图片生成标签和描述

**优化项**：
- ✅ 支持取消操作
- ✅ 单图片超时 60 秒
- ✅ 连续错误 10 次终止
- ✅ 并发数 3
- ✅ 实时进度反馈

**API**：
```http
POST /api/ai/tags/batch   # 启动任务
GET  /api/ai/tags/task    # 查询状态
DELETE /api/ai/tags/batch # 取消任务
```

### 一键索引

**功能**：为所有未索引的文件建立向量索引

**优化项**：
- ✅ 支持取消操作
- ✅ 单文件超时 60 秒
- ✅ 连续错误 10 次终止
- ✅ 并发数 3
- ✅ 实时进度反馈

**API**：
```http
POST /api/ai/index/all    # 索引所有未索引文件
GET  /api/ai/index/status # 查询状态
DELETE /api/ai/index/task # 取消任务
```

---

## 向量库管理

v4.2.0 新增向量库管理功能。

### 功能列表

- **查看已索引文件**：分页显示所有已建立向量索引的文件
- **文件信息展示**：文件名、类型、大小、索引时间、摘要状态
- **搜索过滤**：按文件名搜索
- **删除索引**：单个删除文件的向量索引

### 使用方式

1. 进入 AI 设置 → 向量库
2. 查看已索引文件列表
3. 可使用搜索框过滤文件
4. 点击删除按钮移除单个索引

### API 接口

```http
GET    /api/ai/index/vectors         # 获取向量索引列表
DELETE /api/ai/index/vectors/:fileId # 删除单个向量索引
GET    /api/ai/index/diagnose        # 向量索引诊断
GET    /api/ai/index/sample/:fileId  # 获取文件索引样本
```

---

## 移动端支持

### 导航入口

**底部导航栏**：
- 新增「AI 对话」入口（替换原「分享」）

**更多菜单**：
- 新增「AI 配置」入口

### 页面适配

**AIChat 页面**：
- 侧边栏默认隐藏，点击按钮展开
- 抽屉式侧边栏带遮罩层
- 顶部栏紧凑化
- 消息列表响应式间距

**AISettings 页面**：
- 表单布局自适应
- 模型卡片堆叠排列
- 操作按钮触控友好
- 标签页横向滚动

---

## 技术架构

### 目录结构

```
apps/api/src/lib/ai/
├── index.ts                    # 模块导出
├── types.ts                    # 类型定义
├── modelGateway.ts             # 模型网关（核心）
├── agentEngine.ts              # Agent 引擎 v4.2.0
├── aiConfigService.ts          # AI 配置服务 v4.2.0
├── ragEngine.ts                # RAG 引擎
├── agentTools.ts               # Agent 工具集 v4.2.0
├── features.ts                 # 文件处理功能
├── utils.ts                    # 工具函数 v4.2.0
└── adapters/
    ├── workersAiAdapter.ts     # Workers AI 适配器
    └── openAiCompatibleAdapter.ts # OpenAI 兼容适配器

apps/web/src/
├── pages/
│   ├── AIChat.tsx              # AI 对话页面
│   └── AISettings.tsx          # AI 设置页面
└── components/ai/
    ├── AIChatWidget.tsx        # 全局悬浮聊天组件 v4.2.0
    └── chat/
        ├── ChatMessageBubble.tsx
        ├── ChatInputBox.tsx
        └── SuggestedQuestions.tsx
```

### 核心类/函数

#### ModelGateway（模型网关）

统一管理所有模型调用，提供：

```typescript
class ModelGateway {
  // 获取当前活跃模型
  getActiveModel(userId): Promise<ModelConfig>

  // 根据 ID 获取模型
  getModelById(modelId, userId): Promise<ModelConfig>

  // 聊天补全（非流式）
  chatCompletion(userId, request, modelId?): Promise<ChatCompletionResponse>

  // 聊天补全（流式）
  chatCompletionStream(userId, request, onChunk, options?): Promise<void>

  // 获取适配器
  getAdapter(config): IModelAdapter
}
```

#### AgentEngine（Agent 引擎）v4.2.0

```typescript
class AgentEngine {
  // 运行 Agent
  run(userId, query, history, modelId?, onChunk?, signal?): Promise<AgentResult>

  // 内置工具
  tools: ToolDefinition[]
}
```

#### 三层回退机制

```
1. 功能级模型配置（如摘要专用模型）
       ↓ 失败
2. 用户默认活跃模型
       ↓ 失败
3. Workers AI 默认模型（Llama 3.1 8B）
```

### 数据库表

#### ai_models（模型配置表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text | 主键 UUID |
| user_id | text | 用户 ID |
| name | text | 模型显示名称 |
| provider | text | providers: workers_ai / openai_compatible |
| model_id | text | 模型 ID |
| api_endpoint | text? | API 端点（OpenAI 兼容） |
| api_key_encrypted | text? | 加密的 API Key |
| is_active | integer | 是否激活 (0/1) |
| capabilities | text | 能力 JSON 数组 |
| max_tokens | integer | 最大 Token 数 |
| temperature | real | 温度参数 |
| system_prompt | text? | 系统提示词 |
| config_json | text | 扩展配置 JSON |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

#### ai_chat_sessions（对话会话表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text | 主键 UUID |
| user_id | text | 用户 ID |
| title | text | 会话标题 |
| model_id | text? | 使用的模型 ID |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

#### ai_chat_messages（对话消息表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text | 主键 UUID |
| session_id | text | 会话 ID |
| role | text | 角色: user / assistant / system |
| content | text | 消息内容 |
| sources | text? | 来源文件 JSON |
| model_used | text? | 使用的模型 |
| latency_ms | integer? | 响应延迟（毫秒） |
| created_at | text | 创建时间 |

---

## 相关文档

- [API 文档 - AI 部分](./API_AI.md)
- [更新日志](../CHANGELOG.md)
- [架构文档](./architecture.md)
