# OSSshelf AI 功能说明文档

**版本**: v4.1.0
**更新日期**: 2026-04-03

---

## 📋 目录

- [功能概述](#功能概述)
- [AI 对话系统](#ai-对话系统)
- [AI 文件处理功能](#ai-文件处理功能)
- [多模型支持](#多模型支持)
- [AI 配置中心](#ai-配置中心)
- [功能级模型配置](#功能级模型配置)
- [批量操作](#批量操作)
- [移动端支持](#移动端支持)
- [技术架构](#技术架构)

---

## 功能概述

v4.1.0 版本对 AI 功能进行了全面升级，新增以下核心能力：

| 功能 | 说明 | 版本 |
|------|------|------|
| **AI 对话** | 基于 RAG 的智能问答，支持文件内容理解 | v4.1.0 新增 |
| **多模型架构** | 支持 Workers AI + OpenAI 兼容 API | v4.1.0 新增 |
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

### 使用方式

1. 访问 `/ai-chat` 页面（或点击导航栏「AI 对话」）
2. 直接输入问题开始对话
3. 系统自动搜索相关文件并基于文件内容回答

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

## AI 文件处理功能

### 1️⃣ 文件摘要生成

**功能**：为文本文件自动生成内容摘要

**支持的文件类型**：
- 代码文件（JS、TS、Python、Java、Go 等）
- 配置文件（JSON、YAML、XML、INI 等）
- Markdown、TXT、CSV 等纯文本文件

**使用方式**：
- 单个文件：右键菜单 →「AI 摘要」
- 批量处理：AI 设置 → 索引与处理 →「一键摘要」

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
- 标签：ResNet-50 分类模型

**使用方式**：
- 单个图片：右键菜单 →「AI 描述」或「AI 标签」
- 批量处理：AI 设置 → 索引与处理 →「一键标签+描述」

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
- 批量索引：AI 设置 → 索引与处理 →「一键索引」
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

系统内置 9 个 Cloudflare Workers AI 模型，可直接使用：

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

---

## AI 配置中心

### 访问位置

导航至 `/ai-settings` 或点击导航栏「AI 配置」

### 主要功能

#### 📋 模型管理（Models 标签）

- **添加模型**：选择 Workers AI 或自定义 API
- **编辑模型**：修改名称、参数、提示词等
- **删除模型**：移除不需要的模型
- **激活模型**：设置当前使用的默认模型
- **测试连接**：发送测试消息验证可用性

#### ⚡ 快速启用（Providers 标签）

Workers AI 模型列表，每个模型显示：
- 模型名称和 ID
- 能力标签（chat/vision/embedding）
- 一键快速启用按钮
- 当前使用状态

#### 🎯 功能级配置（Index & Processing 标签）

为不同 AI 功能选择专用模型：

| 功能 | 可选模型范围 | 说明 |
|------|------------|------|
| 文件摘要 | chat 模型 | 推荐使用大参数模型 |
| 图片描述 | vision 模型 | 必须支持图片理解 |
| 图片标签 | classify 模型 | 仅限 Workers AI |
| 智能重命名 | chat 模型 | 推荐使用轻量快速模型 |

#### 📊 任务管理（Tasks 标签）

查看和管理批量任务状态：
- 一键摘要任务
- 一键标签+描述任务
- 一键索引任务

每个任务显示：
- 进度条（已处理/总数）
- 状态图标（运行中/完成/失败/已取消）
- 取消/清除按钮

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
| 图片标签 | `classify` | ResNet-50（仅 Workers AI） |
| 智能重命名 | `chat` | Llama 3.1 8B, Qwen 14B, GPT-4o |

### 配置方法

1. 进入 AI 设置 → 索引与处理
2. 找到「功能模型配置」区域
3. 为每个功能选择模型（或留空使用默认）
4. 选择后自动保存

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
GET  /api/ai/summarize/batch    # 查询状态
DELETE /api/ai/summarize/batch  # 取消任务
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
GET  /api/ai/tags/batch    # 查询状态
DELETE /api/ai/tags/batch  # 取消任务
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
POST /api/ai/index/batch   # 启动任务
GET  /api/ai/index/status   # 查询状态
DELETE /api/ai/index/task   # 取消任务
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

---

## 技术架构

### 目录结构

```
apps/api/src/lib/ai/
├── index.ts                    # 模块导出
├── types.ts                    # 类型定义
├── modelGateway.ts             # 模型网关（核心）
├── ragEngine.ts                # RAG 引擎
├── features.ts                 # 文件处理功能
└── adapters/
    ├── workersAiAdapter.ts     # Workers AI 适配器
    └── openAiCompatibleAdapter.ts # OpenAI 兼容适配器

apps/web/src/
├── pages/
│   ├── AIChat.tsx              # AI 对话页面
│   └── AISettings.tsx          # AI 设置页面
└── components/ai/
    ├── chat/
    │   ├── ChatMessageBubble.tsx
    │   ├── ChatInputBox.tsx
    │   └── SuggestedQuestions.tsx
    └── settings/
        ├── ModelCard.tsx
        ├── TaskProgress.tsx
        └── StatsCard.tsx
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
| created_at | text | 创建时间 |

---

## 相关文档

- [API 文档 - AI 部分](./API_AI.md)
- [更新日志](../CHANGELOG.md)
- [架构文档](./architecture.md)
