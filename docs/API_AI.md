# OSSshelf AI API 文档

**版本**: v4.2.0
**更新日期**: 2026-04-06
**Base URL**: `https://your-api.workers.dev/api`

---

## 📋 目录

- [认证方式](#认证方式)
- [AI 配置管理 API](#ai-配置管理-api)
- [AI 对话系统 API](#ai-对话系统-api)
- [AI 文件处理 API](#ai-文件处理-api)
- [AI 系统配置 API](#ai-系统配置-api)
- [向量库管理 API](#向量库管理-api)
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
      },
      {
        "id": "__custom__",
        "name": "自定义模型 (输入任意 @cf/ 模型 ID)",
        "capabilities": ["chat", "vision"],
        "description": "手动输入任意 Cloudflare Workers AI 模型 ID"
      }
    ],
    "openAiModels": [
      {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "capabilities": ["chat", "vision", "function_calling"],
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
    "configured": true,
    "activeModel": {
      "id": "xxx",
      "name": "Llama 3.1 8B",
      "provider": "workers_ai",
      "modelId": "@cf/meta/llama-3.1-8b-instruct"
    },
    "totalModels": 3,
    "features": {
      "workersAi": true,
      "customApi": true,
      "chat": true,
      "embedding": true
    }
  }
}
```

---

### 获取模型列表

```http
GET /api/ai-config/models
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `capability` | string | 按能力过滤：chat / vision / embedding / function_calling |

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
      "capabilities": ["chat", "vision", "function_calling"],
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
  "capabilities": ["chat", "vision", "function_calling"],
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
- `capabilities`: 默认 `["chat"]`，可选值：chat / vision / embedding / function_calling / completion
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
  "data": { "message": "模型已激活", "activeModelId": "model-uuid" }
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

### 获取各功能可用的模型列表 v4.2.0

```http
GET /api/ai-config/feature-models
```

**响应**：

```json
{
  "success": true,
  "data": {
    "summary": [
      { "id": "model-uuid", "name": "Llama 3.1 8B", "provider": "workers_ai", "modelId": "@cf/meta/llama-3.1-8b-instruct", "capabilities": ["chat"], "isActive": true }
    ],
    "imageCaption": [
      { "id": "model-uuid", "name": "LLaVA 1.5 7B", "provider": "workers_ai", "modelId": "@cf/llava-hf/llava-1.5-7b-hf", "capabilities": ["vision"], "isActive": false }
    ],
    "imageTag": [...],
    "rename": [...]
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
- 支持 Workers AI 模型 ID（以 `@cf/` 开头）

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
      "modelId": "@cf/meta/llama-3.1-8b-instruct",
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
  "title": "新对话",
  "modelId": "@cf/meta/llama-3.1-8b-instruct"
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "id": "new-session-uuid",
    "title": "新对话",
    "modelId": "@cf/meta/llama-3.1-8b-instruct",
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
    "modelId": "@cf/meta/llama-3.1-8b-instruct",
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
          { "id": "file-uuid", "name": "readme.md", "mimeType": "text/markdown", "score": 0.85 }
        ],
        "modelUsed": "@cf/meta/llama-3.1-8b-instruct",
        "latencyMs": 1234,
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
  "query": "帮我总结一下这个项目的结构",
  "sessionId": "session-uuid",
  "modelId": "@cf/meta/llama-3.1-8b-instruct",
  "maxFiles": 5,
  "includeFileContent": false,
  "stream": false
}
```

**参数说明**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 用户问题，1-2000 字符 |
| `sessionId` | string | 否 | 会话 ID，不传则创建新会话 |
| `modelId` | string | 否 | 指定模型 ID |
| `maxFiles` | number | 否 | 最大引用文件数，默认 5，最大 10 |
| `includeFileContent` | boolean | 否 | 是否包含文件内容，默认 false |
| `stream` | boolean | 否 | 是否流式响应，默认 false |

**响应**：

```json
{
  "success": true,
  "data": {
    "answer": "根据你的文件，这个项目的结构是...",
    "sources": [
      { "id": "file-uuid", "name": "package.json", "mimeType": "application/json", "score": 0.85 }
    ],
    "sessionId": "session-uuid",
    "latencyMs": 1234
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
  "query": "帮我总结一下这个项目的结构",
  "sessionId": "session-uuid",
  "modelId": "@cf/meta/llama-3.1-8b-instruct",
  "stream": true
}
```

**响应格式**（Server-Sent Events）：

```
data: {"content":"根据","done":false}

data: {"content":"你的","done":false}

data: {"reasoning":true,"content":"思考过程...","done":false}

data: {"toolStart":true,"toolName":"search_files","toolCallId":"tc_123","args":{"query":"项目结构"},"done":false}

data: {"toolResult":true,"toolCallId":"tc_123","toolName":"search_files","result":{"files":[...]},"done":false}

data: {"done":true,"sessionId":"session-uuid","sources":[{"id":"file-uuid","name":"package.json","mimeType":"application/json","score":0.85}]}
```

**SSE 事件类型 v4.2.0**：

| 事件类型 | 字段 | 说明 |
|---------|------|------|
| 文本内容 | `content` | AI 生成的文本内容 |
| 推理内容 | `reasoning: true, content` | 模型的思考过程（DeepSeek R1、智谱 GLM 等） |
| 工具调用开始 | `toolStart: true, toolName, toolCallId, args` | AI 开始调用工具 |
| 工具调用结果 | `toolResult: true, toolCallId, toolName, result` | 工具调用返回结果 |
| 完成 | `done: true, sessionId, sources` | 响应完成，包含来源文件 |

**SSE 解析示例**（JavaScript）：

```javascript
const response = await fetch('/api/ai-chat/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
  body: JSON.stringify({ query, sessionId, stream: true })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('data:')) {
      const data = JSON.parse(line.replace('data:', '').trim());
      
      if (data.done) {
        console.log('完成，来源文件:', data.sources);
      } else if (data.reasoning) {
        console.log('推理:', data.content);
      } else if (data.toolStart) {
        console.log('工具调用开始:', data.toolName, data.args);
      } else if (data.toolResult) {
        console.log('工具调用结果:', data.result);
      } else if (data.content) {
        console.log('文本:', data.content);
      }
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
      "similarityScore": 0.85,
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

### 图片标签生成

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

#### 一键标签

```http
POST /api/ai/tags/batch          # 启动任务
GET  /api/ai/tags/task           # 查询状态
DELETE /api/ai/tags/batch        # 取消任务
```

#### 一键索引

```http
POST /api/ai/index/all           # 索引所有未索引文件
POST /api/ai/index/batch         # 索引指定文件列表
GET  /api/ai/index/status        # 查询状态
GET  /api/ai/index/stats         # 获取索引统计
DELETE /api/ai/index/task        # 取消任务
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
      "id": "task-uuid",
      "status": "running",
      "total": 150,
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

**任务状态响应**：

```json
{
  "success": true,
  "data": {
    "id": "task-uuid",
    "status": "running",
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

---

## AI 系统配置 API

v4.2.0 新增

路由前缀：`/api/ai-config`

### 获取所有 AI 系统配置

```http
GET /api/ai-config/system-config
```

**响应**：

```json
{
  "success": true,
  "data": [
    {
      "key": "ai.default_model.chat",
      "label": "默认聊天模型",
      "description": "AI 对话功能使用的默认模型",
      "category": "model",
      "valueType": "string",
      "stringValue": "@cf/meta/llama-3.1-8b-instruct",
      "defaultValue": "@cf/meta/llama-3.1-8b-instruct",
      "isEditable": true
    },
    {
      "key": "ai.parameter.temperature",
      "label": "默认温度",
      "description": "模型生成的随机性，0-2 之间",
      "category": "parameter",
      "valueType": "number",
      "numberValue": 0.7,
      "defaultValue": 0.7,
      "isEditable": true
    },
    {
      "key": "ai.feature.enable_reasoning",
      "label": "启用推理内容显示",
      "description": "是否显示模型的思考过程",
      "category": "feature",
      "valueType": "boolean",
      "booleanValue": true,
      "defaultValue": true,
      "isEditable": true
    }
  ]
}
```

**配置分类**：

| 分类 | 说明 |
|------|------|
| `model` | 默认模型配置 |
| `parameter` | 模型参数配置 |
| `limit` | 内容限制配置 |
| `retry` | 重试策略配置 |
| `prompt` | 提示词模板配置 |
| `feature` | 功能开关配置 |

---

### 更新单个 AI 系统配置

```http
PUT /api/ai-config/system-config/:key
Content-Type: application/json
```

**请求体**：

```json
{
  "value": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "message": "配置已更新",
    "key": "ai.default_model.chat"
  }
}
```

---

### 重置配置为默认值

```http
POST /api/ai-config/system-config/:key/reset
```

**响应**：

```json
{
  "success": true,
  "data": {
    "message": "配置已重置为默认值",
    "key": "ai.default_model.chat"
  }
}
```

---

## 向量库管理 API

v4.2.0 新增

路由前缀：`/api/ai`

### 获取向量索引列表

```http
GET /api/ai/index/vectors
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | number | 页码，默认 1 |
| `pageSize` | number | 每页数量，默认 20 |
| `search` | string | 文件名搜索 |

**响应**：

```json
{
  "success": true,
  "data": {
    "vectors": [
      {
        "id": "file-uuid",
        "name": "项目计划书.pdf",
        "mimeType": "application/pdf",
        "size": 1048576,
        "vectorIndexedAt": "2026-04-03T10:00:00Z",
        "aiSummary": "这是一份项目计划书...",
        "indexedTextLength": 1500,
        "indexedTextPreview": "项目计划书.pdf - 这是一份项目计划书..."
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 150,
      "totalPages": 8
    }
  }
}
```

---

### 删除单个向量索引

```http
DELETE /api/ai/index/vectors/:fileId
```

**响应**：

```json
{
  "success": true,
  "data": { "message": "向量索引已删除" }
}
```

---

### 向量索引诊断

```http
GET /api/ai/index/diagnose
```

**响应**：

```json
{
  "success": true,
  "data": {
    "vectorize": {
      "configured": true,
      "totalCount": 500,
      "userCount": 150,
      "sampleVectors": [
        { "id": "file-uuid", "score": 0.95, "metadata": { "fileName": "readme.md" } }
      ]
    },
    "database": {
      "totalFiles": 200,
      "indexedFiles": 150,
      "filesWithSummary": 100
    },
    "testSearch": {
      "success": true,
      "resultCount": 10,
      "error": ""
    }
  }
}
```

---

### 获取文件索引样本

```http
GET /api/ai/index/sample/:fileId
```

**响应**：

```json
{
  "success": true,
  "data": {
    "file": {
      "id": "file-uuid",
      "name": "readme.md",
      "mimeType": "text/markdown",
      "vectorIndexedAt": "2026-04-03T10:00:00Z",
      "aiSummary": "项目说明文档..."
    },
    "vectorize": {
      "found": true,
      "metadata": { "fileName": "readme.md", "userId": "user-uuid" }
    },
    "indexedText": "# 项目说明\n\n这是一个文件管理系统..."
  }
}
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
| `G409` | 409 | 冲突（如任务已在运行） |
| `G503` | 503 | 服务不可用（如 AI 任务队列未配置） |

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
  capabilities: ('chat' | 'vision' | 'embedding' | 'function_calling' | 'completion')[];
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
  modelId?: string;
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
  sources?: Array<{ id: string; name: string; mimeType: string | null; score: number }>;
  modelUsed?: string;
  latencyMs?: number;
  createdAt: string;
}
```

### AiSystemConfigItem（系统配置项）v4.2.0

```typescript
interface AiSystemConfigItem {
  key: string;
  label: string;
  description: string;
  category: 'model' | 'parameter' | 'limit' | 'retry' | 'prompt' | 'feature';
  valueType: 'string' | 'number' | 'boolean' | 'json';
  stringValue?: string;
  numberValue?: number;
  booleanValue?: boolean;
  jsonValue?: unknown;
  defaultValue: string | number | boolean;
  isEditable: boolean;
}
```

### TaskStatus（批量任务状态）

```typescript
type TaskStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

interface AITask {
  id: string;
  status: TaskStatus;
  total: number;
  processed: number;
  failed: number;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}
```

### StreamChunk（流式响应块）v4.2.0

```typescript
interface StreamChunk {
  id: string;
  content: string;
  role: 'assistant';
  model: string;
  done: boolean;
  reasoningContent?: string;
  toolCalls?: Array<{
    id: string;
    name?: string;
    arguments?: string;
    index: number;
  }>;
}
```

---

## 相关文档

- [AI 功能说明](./AI_FEATURES.md)
- [完整 API 文档](./api.md)
- [更新日志](../CHANGELOG.md)
