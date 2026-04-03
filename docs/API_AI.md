# OSSshelf AI API 文档

**版本**: v4.1.0
**更新日期**: 2026-04-03
**Base URL**: `https://your-api.workers.dev/api`

---

## 📋 目录

- [认证方式](#认证方式)
- [AI 配置管理 API](#ai-配置管理-api)
- [AI 对话系统 API](#ai-对话系统-api)
- [AI 文件处理 API](#ai-文件处理-api)
- [错误码](#错误码)
- [数据类型](#数据类型)

---

## 认证方式

所有 AI API 使用 **Bearer Token (JWT)** 认证：

```http
Authorization: Bearer <jwt-token>
```

---

## AI 配置管理 API

路由前缀：`/api/ai-config`

### 获取可用提供商和模型

```http
GET /api/ai-config/providers
```

**响应**：

```json
{
  "success": true,
  "data": {
    "providers": [
      { "id": "workers_ai", "name": "Cloudflare Workers AI", "description": "..." },
      { "id": "openai_compatible", "name": "OpenAI 兼容 API", "description": "..." }
    ],
    "workersAiModels": [
      {
        "id": "@cf/meta/llama-3.1-8b-instruct",
        "name": "Llama 3.1 8B Instruct",
        "capabilities": ["chat"],
        "description": "Meta的Llama 3.1指令微调模型"
      }
    ],
    "openAiModels": [
      {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "capabilities": ["chat", "vision"],
        "description": "OpenAI最新多模态模型"
      }
    ]
  }
}
```

---

### 获取配置状态

```http
GET /api/ai-config/status
```

**响应**：

```json
{
  "success": true,
  "data": {
    "hasActiveModel": true,
    "activeModel": {
      "id": "xxx",
      "name": "Llama 3.1 8B",
      "provider": "workers_ai",
      "modelId": "@cf/meta/llama-3.1-8b-instruct"
    },
    "totalModels": 3,
    "workersAiAvailable": true,
    "vectorizeAvailable": true
  }
}
```

---

### 获取模型列表

```http
GET /api/ai-config/models
```

**响应**：

```json
{
  "success": true,
  "data": [
    {
      "id": "model-uuid",
      "name": "我的 GPT-4o",
      "provider": "openai_compatible",
      "modelId": "gpt-4o",
      "apiEndpoint": "https://api.openai.com/v1",
      "hasApiKey": true,
      "isActive": true,
      "capabilities": ["chat", "vision"],
      "maxTokens": 4096,
      "temperature": 0.7,
      "createdAt": "2026-04-03T12:00:00Z",
      "updatedAt": "2026-04-03T12:00:00Z"
    }
  ]
}
```

---

### 创建模型

```http
POST /api/ai-config/models
Content-Type: application/json
```

**请求体**：

```json
{
  "name": "我的 GPT-4o",
  "provider": "openai_compatible",
  "modelId": "gpt-4o",
  "apiEndpoint": "https://api.openai.com/v1",
  "apiKey": "sk-xxxxxxxx",
  "capabilities": ["chat", "vision"],
  "maxTokens": 4096,
  "temperature": 0.7,
  "systemPrompt": "你是一个有用的助手",
  "isActive": false
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "id": "new-model-uuid",
    "message": "模型创建成功"
  }
}
```

**验证规则**：
- `name`: 必填，1-100 字符
- `provider`: 必填，`workers_ai` 或 `openai_compatible`
- `modelId`: 必填
- `apiEndpoint`: 仅 `openai_compatible` 时需验证 URL 格式（Workers AI 可不填）
- `apiKey`: 可选
- `capabilities`: 默认 `["chat"]`
- `maxTokens`: 1-128000，默认 4096
- `temperature`: 0-2，默认 0.7

---

### 更新模型

```http
PUT /api/ai-config/models/:modelId
Content-Type: application/json
```

**请求体**：同创建模型（所有字段可选）

---

### 删除模型

```http
DELETE /api/ai-config/models/:modelId
```

**响应**：

```json
{
  "success": true,
  "data": { "message": "模型已删除" }
}
```

---

### 激活模型

```http
POST /api/ai-config/models/:modelId/activate
```

**响应**：

```json
{
  "success": true,
  "data": { "message": "模型已激活" }
}
```

---

### 测试模型连接

```http
POST /api/ai-config/test
Content-Type: application/json
```

**请求体 - 测试已保存的模型**：

```json
{
  "modelId": "model-uuid"
}
```

**请求体 - 测试临时配置（保存前）**：

```json
{
  "provider": "openai_compatible",
  "modelId": "gpt-4o",
  "apiEndpoint": "https://api.openai.com/v1",
  "apiKey": "sk-xxxxxxxx"
}
```

**响应 - 成功**：

```json
{
  "success": true,
  "data": {
    "valid": true,
    "response": "你好！我是 AI 助手，很高兴为您服务。",
    "model": "@cf/meta/llama-3.1-8b-instruct",
    "latencyMs": 1234,
    "timestamp": "2026-04-03T13:31:13.141Z"
  }
}
```

**响应 - 失败**：

```json
{
  "success": false,
  "error": { "code": "G000", "message": "模型测试失败: ..." },
  "data": {
    "valid": false,
    "error": "具体错误信息",
    "timestamp": "2026-04-03T13:31:13.141Z"
  }
}
```

---

### 获取功能级模型配置

```http
GET /api/ai-config/feature-config
```

**响应**：

```json
{
  "success": true,
  "data": {
    "summary": "model-uuid-or-null",
    "imageCaption": "model-uuid-or-null",
    "imageTag": "model-uuid-or-null",
    "rename": "model-uuid-or-null"
  }
}
```

---

### 保存功能级模型配置

```http
PUT /api/ai-config/feature-config
Content-Type: application/json
```

**请求体**：

```json
{
  "summary": "model-uuid",
  "imageCaption": null,
  "imageTag": null,
  "rename": "model-uuid"
}
```

**说明**：
- 每个字段可选
- 设为 `null` 表示使用默认模型
- 系统会验证 modelId 是否存在且属于当前用户

**响应**：

```json
{
  "success": true,
  "data": {
    "message": "功能模型配置已保存",
    "config": { ... }
  }
}
```

---

## AI 对话系统 API

路由前缀：`/api/ai-chat`

### 获取会话列表

```http
GET /api/ai-chat/sessions
```

**响应**：

```json
{
  "success": true,
  "data": [
    {
      "id": "session-uuid",
      "title": "关于项目架构的对话",
      "createdAt": "2026-04-03T10:00:00Z",
      "updatedAt": "2026-04-03T12:00:00Z",
      "messageCount": 15
    }
  ]
}
```

---

### 创建会话

```http
POST /api/ai-chat/sessions
Content-Type: application/json
```

**请求体**：

```json
{
  "title": "新对话"
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "id": "new-session-uuid",
    "title": "新对话",
    "createdAt": "2026-04-03T13:00:00Z"
  }
}
```

---

### 获取会话详情（含消息列表）

```http
GET /api/ai-chat/sessions/:sessionId
```

**响应**：

```json
{
  "success": true,
  "data": {
    "id": "session-uuid",
    "title": "对话标题",
    "messages": [
      {
        "id": "msg-uuid",
        "role": "user",
        "content": "你好",
        "createdAt": "2026-04-03T13:00:00Z"
      },
      {
        "id": "msg-uuid",
        "role": "assistant",
        "content": "你好！有什么可以帮助你的？",
        "sources": [
          { "fileId": "file-uuid", "fileName": "readme.md" }
        ],
        "createdAt": "2026-04-03T13:00:01Z"
      }
    ]
  }
}
```

---

### 更新会话标题

```http
PUT /api/ai-chat/sessions/:sessionId
Content-Type: application/json
```

**请求体**：

```json
{ "title": "新标题" }
```

---

### 删除会话

```http
DELETE /api/ai-chat/sessions/:sessionId
```

---

### 发送消息（非流式）

```http
POST /api/ai-chat/chat
Content-Type: application/json
```

**请求体**：

```json
{
  "sessionId": "session-uuid",
  "message": "帮我总结一下这个项目的结构",
  "stream": false
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "sessionId": "session-uuid",
    "messageId": "msg-uuid",
    "content": "根据你的文件，这个项目的结构是...",
    "sources": [
      { "fileId": "file-uuid", "fileName": "package.json" }
    ],
    "model": "@cf/meta/llama-3.1-8b-instruct",
    "usage": { "promptTokens": 100, "completionTokens": 200, "totalTokens": 300 }
  }
}
```

---

### 发送消息（SSE 流式）⭐ 推荐

```http
POST /api/ai-chat/chat
Content-Type: application/json
Accept: text/event-stream
```

**请求体**：

```json
{
  "sessionId": "session-uuid",
  "message": "帮我总结一下这个项目的结构",
  "stream": true
}
```

**响应格式**（Server-Sent Events）：

```
event: message_start
data: {"sessionId":"xxx","messageId":"xxx"}

event: chunk
data: {"content":"根据","delta":"根据"}

event: chunk
data: {"content":"根据你的","delta":"你的"}

event: source
data: {"fileId":"xxx","fileName":"package.json"}

event: message_end
data: {"usage":{"promptTokens":100,"completionTokens":200,"totalTokens":300},"model":"@cf/meta/llama-3.1-8b-instruct"}

event: done
data: {}
```

**SSE 解析示例**（JavaScript）：

```javascript
const response = await fetch('/api/ai-chat/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
  body: JSON.stringify({ sessionId, message, stream: true })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('event:')) {
      const event = line.replace('event:', '').trim();
      // 处理事件类型
    } else if (line.startsWith('data:')) {
      const data = JSON.parse(line.replace('data:', '').trim());
      // 处理数据
    }
  }
}
```

---

## AI 文件处理 API

路由前缀：`/api/ai`

### 获取 AI 功能状态

```http
GET /api/ai/status
```

**响应**：

```json
{
  "success": true,
  "data": {
    "configured": true,
    "features": {
      "semanticSearch": true,
      "summary": true,
      "imageTags": true,
      "renameSuggest": true
    }
  }
}
```

---

### 语义搜索

```http
POST /api/ai/search
Content-Type: application/json
```

**请求体**：

```json
{
  "query": "查找关于项目计划的文档",
  "limit": 20,
  "threshold": 0.7,
  "mimeType": "application/pdf"
}
```

**参数说明**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索查询文本 |
| `limit` | number | 否 | 返回结果数量，默认 20，最大 50 |
| `threshold` | number | 否 | 相似度阈值，默认 0.7，范围 0-1 |
| `mimeType` | string | 否 | MIME 类型过滤 |

**响应**：

```json
{
  "success": true,
  "data": [
    {
      "id": "file-id",
      "name": "项目计划书.pdf",
      "size": 1048576,
      "mimeType": "application/pdf",
      "score": 0.85,
      "aiSummary": "这是一份关于2026年项目开发的计划书...",
      "createdAt": "2026-04-01T10:00:00Z"
    }
  ]
}
```

---

### 获取文件 AI 信息

```http
GET /api/ai/file/:fileId
```

**响应**：

```json
{
  "success": true,
  "data": {
    "hasSummary": true,
    "summary": "文件摘要内容...",
    "summaryAt": "2026-04-01T10:00:00Z",
    "hasTags": true,
    "tags": ["标签1", "标签2"],
    "tagsAt": "2026-04-01T10:00:00Z",
    "vectorIndexed": true,
    "vectorIndexedAt": "2026-04-01T10:00:00Z"
  }
}
```

---

### 文件摘要生成

```http
POST /api/ai/summarize/:fileId
```

**响应**：

```json
{
  "success": true,
  "data": {
    "summary": "这是一个 React 组件...",
    "cached": false
  }
}
```

---

### 图片标签+描述生成

```http
POST /api/ai/tags/:fileId
```

**响应**：

```json
{
  "success": true,
  "data": {
    "tags": ["风景", "自然", "户外"],
    "caption": "一张美丽的山景照片..."
  }
}
```

---

### 智能重命名建议

```http
POST /api/ai/rename-suggest/:fileId
```

**响应**：

```json
{
  "success": true,
  "data": {
    "suggestions": [
      "UserLoginForm.jsx",
      "AuthComponent.tsx",
      "LoginPage.js"
    ]
  }
}
```

---

### 新文件智能命名

```http
POST /api/ai/name-suggest
Content-Type: application/json
```

**请求体**：

```json
{
  "content": "文件内容...",
  "mimeType": "text/javascript",
  "extension": ".js"
}
```

**响应**：同上

---

### 批量操作

#### 一键摘要

```http
POST /api/ai/summarize/batch     # 启动任务
GET  /api/ai/summarize/task      # 查询状态
DELETE /api/ai/summarize/batch   # 取消任务
```

#### 一键标签+描述

```http
POST /api/ai/tags/batch          # 启动任务
GET  /api/ai/tags/task           # 查询状态
DELETE /api/ai/tags/batch         # 取消任务
```

#### 一键索引

```http
POST /api/ai/index/batch          # 启动任务（指定文件列表）
POST /api/ai/index/all            # 索引所有未索引文件
GET  /api/ai/index/status         # 查询状态
GET  /api/ai/index/stats          # 获取索引统计
DELETE /api/ai/index/task          # 取消任务
```

**索引所有文件**：

```http
POST /api/ai/index/all
```

**响应**：

```json
{
  "success": true,
  "data": {
    "message": "索引任务已启动，将在后台运行",
    "task": {
      "status": "running",
      "total": 0,
      "processed": 0,
      "failed": 0,
      "startedAt": "2026-04-03T10:00:00Z"
    }
  }
}
```

**获取索引统计**：

```http
GET /api/ai/index/stats
```

**响应**：

```json
{
  "success": true,
  "data": {
    "editable": {
      "total": 150,
      "noSummary": 30,
      "notIndexed": 20
    },
    "image": {
      "total": 80,
      "noTags": 15,
      "notIndexed": 10
    },
    "other": {
      "total": 50,
      "notIndexed": 5
    }
  }
}
```

**字段说明**：
- `editable`: 可生成摘要的文件（文档、代码等）
- `image`: 图片文件
- `other`: 其他类型文件
- 每类包含 `total`（总数）、`noSummary`/`noTags`（未生成摘要/标签）、`notIndexed`（未建立向量索引）

**任务状态响应**：

```json
{
  "success": true,
  "data": {
    "status": "running",  // idle | running | completed | failed | cancelled
    "total": 150,
    "processed": 45,
    "failed": 2,
    "startedAt": "2026-04-03T13:00:00Z",
    "updatedAt": "2026-04-03T13:05:00Z"
  }
}
```

---

### AI 对话问答（RAG）

```http
POST /api/ai/chat
Content-Type: application/json
```

**请求体**：

```json
{
  "query": "帮我总结一下项目的架构设计",
  "scope": "all",
  "folderId": null,
  "limit": 5
}
```

**参数说明**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 用户问题，1-500 字符 |
| `scope` | string | 否 | 搜索范围：`all` 或 `folder`，默认 `all` |
| `folderId` | string | 否 | 当 scope 为 folder 时指定文件夹 |
| `limit` | number | 否 | 引用文件数量，默认 5，最大 10 |

**响应**：

```json
{
  "success": true,
  "data": {
    "answer": "根据您的文件，项目架构如下：...",
    "sources": [
      {
        "id": "file-uuid",
        "name": "README.md",
        "mimeType": "text/markdown",
        "score": 0.85
      }
    ]
  }
}
```

**说明**：
- 该接口基于 RAG（检索增强生成）技术
- 先通过向量搜索找到相关文件，再生成回答
- 回答末尾会标注引用来源

---

### 向量索引管理

```http
GET    /api/ai/index              # 获取所有索引状态
DELETE /api/ai/index/:fileId       # 删除单个文件索引
POST   /api/ai/index/:fileId       # 为单个文件建立索引
```

---

## 错误码

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `G100` | 400 | 参数验证失败 |
| `G101` | 400 | 无效的 provider 值 |
| `G102` | 400 | 无效的 Workers AI 模型 ID |
| `G103` | 400 | API Key 格式无效 |
| `G104` | 400 | 配置无效 |
| `G000` | 500 | 服务器内部错误 |
| `G401` | 401 | 未授权 |
| `G404` | 404 | 资源不存在 |

**错误响应格式**：

```json
{
  "success": false,
  "error": {
    "code": { "code": "G100", "httpStatus": 400, "message": "参数验证失败" },
    "message": "详细错误信息"
  }
}
```

---

## 数据类型

### AiModel（模型配置）

```typescript
interface AiModel {
  id: string;
  name: string;
  provider: 'workers_ai' | 'openai_compatible';
  modelId: string;
  apiEndpoint?: string;
  hasApiKey: boolean;
  isActive: boolean;
  capabilities: string[];
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### AiChatSession（对话会话）

```typescript
interface AiChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}
```

### AiChatMessage（对话消息）

```typescript
interface AiChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: Array<{ fileId: string; fileName: string }>;
  createdAt: string;
}
```

### TaskStatus（批量任务状态）

```typescript
type TaskStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

interface AITask {
  status: TaskStatus;
  total: number;
  processed: number;
  failed: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  updatedAt: string;
}
```

---

## 相关文档

- [AI 功能说明](./AI_FEATURES.md)
- [完整 API 文档](./api.md)
- [更新日志](../CHANGELOG.md)
