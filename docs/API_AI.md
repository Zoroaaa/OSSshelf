# OSSshelf AI API 文档

**版本**: v5.1.0
**更新日期**: 2026-06-08

---

## 📋 目录

- [API 概述](#api-概述)
- [认证](#认证)
- [AI 提供商 API](#ai-提供商-api)
- [AI 对话 API](#ai-对话-api)
- [Agent API](#agent-api)
- [模型管理 API](#模型管理-api)
- [AI 功能 API](#ai-功能-api)
- [向量索引 API](#向量索引-api)
- [AI 配置 API](#ai-配置-api)
- [SSE 事件格式](#sse-事件格式)
- [错误处理](#错误处理)

---

## API 概述

所有 AI 相关 API 都位于 `/api/ai` 路径下，主要功能包括：

| 模块      | 路径前缀                               | 功能                           |
| --------- | -------------------------------------- | ------------------------------ |
| AI 提供商 | `/api/ai-config/providers`             | 提供商管理（v4.4.0 新增）      |
| AI 对话   | `/api/ai/chat`                         | 会话管理、消息发送             |
| Agent     | `/api/ai/agent`                        | Agent 引擎、工具调用、确认操作 |
| 模型管理  | `/api/ai/models`                       | 模型配置、激活、测试           |
| AI 功能   | `/api/ai/summarize`, `/api/ai/tags` 等 | 摘要、标签、重命名             |
| 向量索引  | `/api/ai/index`                        | 向量索引管理                   |
| AI 配置   | `/api/ai/config`                       | 系统配置管理                   |
| 记忆管理  | `/api/ai/memories`                     | 跨会话记忆 CRUD（v4.7.0 新增） |

---

## 认证

所有 API 请求需要通过 Clerk 认证：

```http
Authorization: Bearer <session_token>
```

或使用 Cookie 认证。

---

## AI 提供商 API

v4.4.0 新增提供商管理功能。

### 获取系统内置提供商列表

```http
GET /api/ai-config/providers
```

**响应**:

```json
{
  "workersAiModels": [
    {
      "id": "@cf/meta/llama-3.1-8b-instruct",
      "name": "Llama 3.1 8B",
      "capabilities": ["chat"]
    }
  ]
}
```

### 获取所有提供商

```http
GET /api/ai-config/ai-providers
```

**响应**:

```json
{
  "data": [
    {
      "id": "vendor-deepseek",
      "name": "DeepSeek",
      "apiEndpoint": "https://api.deepseek.com/v1",
      "description": "DeepSeek深度求索大模型",
      "thinkingConfig": "{\"paramFormat\":\"object\",\"paramName\":\"thinking\",\"nestedKey\":\"type\",\"enabledValue\":\"enabled\",\"disabledValue\":\"disabled\"}",
      "isSystem": true,
      "isDefault": false,
      "isActive": true,
      "sortOrder": 91
    }
  ]
}
```

### 创建自定义提供商

```http
POST /api/ai-config/ai-providers
Content-Type: application/json

{
  "name": "我的自定义提供商",
  "apiEndpoint": "https://api.example.com/v1",
  "description": "自定义 OpenAI 兼容 API",
  "thinkingConfig": "{\"paramFormat\":\"boolean\",\"paramName\":\"enable_thinking\",\"enabledValue\":true,\"disabledValue\":false}"
}
```

### 更新提供商

```http
PUT /api/ai-config/ai-providers/:id
Content-Type: application/json

{
  "name": "新名称",
  "isDefault": true
}
```

### 删除提供商

```http
DELETE /api/ai-config/ai-providers/:id
```

> 注意：系统内置提供商无法删除

### 设置默认提供商

```http
POST /api/ai-config/ai-providers/:providerId/set-default
```

**响应**:

```json
{
  "success": true,
  "data": {
    "message": "已设为默认提供商",
    "providerId": "uuid"
  }
}
```

> 注意：会将该用户的其他提供商的 isDefault 设为 false

---

## AI 对话 API

### 创建会话

```http
POST /api/ai/chat/sessions
Content-Type: application/json

{
  "title": "新对话"  // 可选，默认自动生成
}
```

**响应**:

```json
{
  "id": "uuid",
  "userId": "user_xxx",
  "title": "新对话",
  "createdAt": "2026-04-08T10:00:00Z",
  "updatedAt": "2026-04-08T10:00:00Z"
}
```

### 获取会话列表

```http
GET /api/ai/chat/sessions
```

**响应**:

```json
{
  "sessions": [
    {
      "id": "uuid",
      "title": "关于项目的讨论",
      "createdAt": "2026-04-08T10:00:00Z",
      "updatedAt": "2026-04-08T10:30:00Z"
    }
  ]
}
```

### 获取会话消息

```http
GET /api/ai/chat/sessions/:sessionId/messages
```

**响应**:

```json
{
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "content": "帮我找一下项目配置文件",
      "createdAt": "2026-04-08T10:00:00Z"
    },
    {
      "id": "uuid",
      "role": "assistant",
      "content": "我找到了以下配置文件...",
      "sources": [{ "fileId": "xxx", "fileName": "config.json" }],
      "createdAt": "2026-04-08T10:00:05Z"
    }
  ]
}
```

### 删除会话

```http
DELETE /api/ai/chat/sessions/:sessionId
```

### 更新会话标题

```http
PATCH /api/ai/chat/sessions/:sessionId
Content-Type: application/json

{
  "title": "新标题"
}
```

---

## Agent API

### 发送消息（流式响应）

v4.3.0 Agent 引擎支持多轮推理和工具调用。

```http
POST /api/ai/agent/chat
Content-Type: application/json

{
  "message": "帮我找一下所有图片文件",
  "sessionId": "uuid",        // 可选，不传则创建新会话
  "modelId": "uuid",          // 可选，不传则使用默认模型
  "history": [                // 可选，历史消息
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**响应**: SSE 流式响应，参见 [SSE 事件格式](#sse-事件格式)

### 确认写操作

v4.3.0 新增：用户确认敏感操作后调用。

```http
POST /api/ai/agent/confirm
Content-Type: application/json

{
  "confirmId": "uuid"
}
```

**响应**:

```json
{
  "success": true,
  "result": {
    "message": "文件已删除",
    "fileId": "xxx"
  }
}
```

### 获取可用工具列表

```http
GET /api/ai/agent/tools
```

**响应**:

```json
{
  "tools": [
    {
      "name": "search_files",
      "description": "搜索文件",
      "category": "search",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "limit": { "type": "number" }
        }
      }
    }
  ],
  "total": 100+
}
```

### 按类别获取工具

```http
GET /api/ai/agent/tools?category=search
```

**响应**:

```json
{
  "tools": [
    { "name": "search_files", ... },
    { "name": "filter_files", ... },
    { "name": "search_by_tag", ... }
  ],
  "category": "search",
  "total": 6
}
```

---

## 模型管理 API

### 获取模型列表

```http
GET /api/ai/models
```

**响应**:

```json
{
  "models": [
    {
      "id": "uuid",
      "name": "Llama 3.1 8B",
      "provider": "workers_ai",
      "modelId": "@cf/meta/llama-3.1-8b-instruct",
      "isActive": true,
      "capabilities": ["chat"],
      "maxTokens": 4096,
      "temperature": 0.7
    }
  ]
}
```

### 添加模型

```http
POST /api/ai/models
Content-Type: application/json

{
  "name": "GPT-4o",
  "provider": "openai_compatible",
  "modelId": "gpt-4o",
  "apiEndpoint": "https://api.openai.com/v1",
  "apiKey": "sk-xxx",
  "capabilities": ["chat", "vision"],
  "maxTokens": 4096,
  "temperature": 0.7,
  "systemPrompt": "你是一个有帮助的助手。"
}
```

### 更新模型

```http
PATCH /api/ai/models/:modelId
Content-Type: application/json

{
  "name": "新名称",
  "temperature": 0.5
}
```

### 删除模型

```http
DELETE /api/ai/models/:modelId
```

### 激活模型

```http
POST /api/ai/models/:modelId/activate
```

### 测试模型连接

```http
POST /api/ai/models/:modelId/test
Content-Type: application/json

{
  "message": "Hello"
}
```

**响应**:

```json
{
  "success": true,
  "response": "Hello! How can I help you today?",
  "latencyMs": 1234
}
```

### 获取可用模型供应商

```http
GET /api/ai/models/providers
```

**响应**:

```json
{
  "providers": [
    {
      "id": "workers_ai",
      "name": "Workers AI",
      "models": [
        {
          "modelId": "@cf/meta/llama-3.1-8b-instruct",
          "name": "Llama 3.1 8B",
          "capabilities": ["chat"]
        }
      ]
    }
  ]
}
```

---

## AI 功能 API

### 文件摘要

#### 单文件摘要

```http
POST /api/ai/summarize
Content-Type: application/json

{
  "fileId": "uuid"
}
```

**响应**:

```json
{
  "summary": "这是一个配置文件，包含数据库连接信息...",
  "modelUsed": "@cf/meta/llama-3.1-8b-instruct"
}
```

#### 批量摘要

```http
POST /api/ai/summarize/batch
```

**响应**:

```json
{
  "taskId": "uuid",
  "status": "running",
  "total": 100,
  "processed": 0,
  "failed": 0
}
```

#### 查询批量任务状态

```http
GET /api/ai/summarize/task
```

#### 取消批量任务

```http
DELETE /api/ai/summarize/batch
```

### 图片标签和描述

#### 单图片处理

```http
POST /api/ai/tags
Content-Type: application/json

{
  "fileId": "uuid"
}
```

**响应**:

```json
{
  "description": "一张风景照片，包含山脉和湖泊",
  "tags": ["风景", "自然", "山脉", "湖泊"],
  "modelUsed": "@cf/llava-hf/llava-1.5-7b-hf"
}
```

#### 批量处理

```http
POST /api/ai/tags/batch
GET /api/ai/tags/task
DELETE /api/ai/tags/batch
```

### 智能重命名

```http
POST /api/ai/rename-suggest
Content-Type: application/json

{
  "fileId": "uuid"
}
```

**响应**:

```json
{
  "suggestions": ["UserLoginForm.jsx", "LoginFormComponent.tsx", "AuthLoginPage.js"],
  "modelUsed": "@cf/meta/llama-3.1-8b-instruct"
}
```

### RAG 问答

```http
POST /api/ai/rag/query
Content-Type: application/json

{
  "query": "项目中有哪些配置文件？",
  "topK": 5
}
```

**响应**:

```json
{
  "answer": "项目中包含以下配置文件...",
  "sources": [
    {
      "fileId": "uuid",
      "fileName": "config.json",
      "score": 0.95,
      "snippet": "..."
    }
  ]
}
```

---

## 向量索引 API

### 索引单个文件

```http
POST /api/ai/index
Content-Type: application/json

{
  "fileId": "uuid"
}
```

### 批量索引

```http
POST /api/ai/index/all
```

### 查询索引状态

```http
GET /api/ai/index/status
```

### 获取向量索引列表

```http
GET /api/ai/index/vectors?page=1&limit=20&search=keyword
```

**响应**:

```json
{
  "vectors": [
    {
      "fileId": "uuid",
      "fileName": "document.pdf",
      "mimeType": "application/pdf",
      "size": 1024000,
      "indexedAt": "2026-04-08T10:00:00Z",
      "hasSummary": true
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 20
}
```

### 删除向量索引

```http
DELETE /api/ai/index/vectors/:fileId
```

### 向量索引诊断

```http
GET /api/ai/index/diagnose
```

**响应**:

```json
{
  "status": "healthy",
  "totalIndexed": 50,
  "totalFiles": 100,
  "indexCoverage": "50%",
  "errors": []
}
```

### 获取索引样本

```http
GET /api/ai/index/sample/:fileId
```

---

## AI 配置 API

### 获取所有配置

```http
GET /api/ai/config
```

**响应**:

```json
{
  "configs": [
    {
      "key": "ai.default_model.chat",
      "value": "@cf/meta/llama-3.1-8b-instruct",
      "description": "默认聊天模型",
      "category": "default_model"
    },
    {
      "key": "ai.parameter.temperature",
      "value": "0.7",
      "description": "默认温度",
      "category": "parameter"
    },
    {
      "key": "ai.agent.max_tool_calls",
      "value": "20",
      "description": "最大工具调用次数",
      "category": "agent"
    }
  ]
}
```

### 获取单个配置

```http
GET /api/ai/config/:key
```

### 更新配置

```http
PATCH /api/ai/config/:key
Content-Type: application/json

{
  "value": "0.5"
}
```

### 重置配置

```http
POST /api/ai/config/:key/reset
```

### 批量更新配置

```http
PATCH /api/ai/config
Content-Type: application/json

{
  "configs": [
    { "key": "ai.parameter.temperature", "value": "0.5" },
    { "key": "ai.parameter.max_tokens", "value": "2048" }
  ]
}
```

---

## 记忆管理 API（v4.7.0 新增）

跨会话语义记忆系统，支持 Agent 跨对话记住用户偏好、操作历史、常用路径等信息。

### 获取记忆列表

```http
GET /api/ai/memories?type=operation&limit=20&offset=0
```

**查询参数**：

| 参数   | 类型   | 必填 | 说明                                             |
| ------ | ------ | ---- | ------------------------------------------------ |
| type   | string | 否   | 记忆类型筛选：operation/preference/path/file_ref |
| limit  | number | 否   | 每页数量（默认 50）                              |
| offset | number | 否   | 偏移量（默认 0）                                 |

**响应**：

```json
{
  "data": {
    "items": [
      {
        "id": "memory-uuid",
        "userId": "user-uuid",
        "sessionId": "session-uuid",
        "type": "operation",
        "summary": "用户将设计文件夹归档到 /Archive/2024/Design",
        "embeddingId": "vector-uuid",
        "createdAt": "2026-04-15T10:00:00Z"
      }
    ],
    "total": 25
  }
}
```

### 删除单条记忆

```http
DELETE /api/ai/memories/:memoryId
```

**响应**：

```json
{
  "success": true
}
```

**注意**：只能删除当前用户的记忆，跨用户操作返回 403。

---

## SSE 事件格式

v4.3.0 Agent 引擎使用 SSE（Server-Sent Events）进行流式响应。

### 事件类型

#### 文本内容事件

```
event: text
data: {"content": "你好", "done": false}

event: text
data: {"content": "！", "done": false}
```

#### 推理内容事件

```
event: reasoning
data: {"content": "让我思考一下...", "done": false}
```

#### 工具调用开始事件

```
event: tool_start
data: {
  "toolCallId": "call_xxx",
  "toolName": "search_files",
  "args": {
    "query": "配置文件",
    "limit": 10
  },
  "done": false
}
```

#### 工具调用结果事件

```
event: tool_result
data: {
  "toolCallId": "call_xxx",
  "toolName": "search_files",
  "result": {
    "files": [...],
    "total": 5
  },
  "done": false
}
```

#### 确认请求事件（v4.3.0 新增）

```
event: confirm_request
data: {
  "confirmId": "uuid",
  "toolName": "delete_file",
  "args": {
    "fileId": "xxx"
  },
  "summary": "删除文件: document.pdf",
  "done": true
}
```

#### 完成事件

```
event: done
data: {
  "sessionId": "uuid",
  "sources": [
    {
      "fileId": "xxx",
      "fileName": "config.json",
      "mimeType": "application/json"
    }
  ],
  "done": true
}
```

#### 错误事件

```
event: error
data: {
  "message": "模型调用失败",
  "done": true
}
```

#### 执行计划事件（v4.7.0 新增）

```
event: plan
data: {
  "plan": {
    "goal": "整理下载文件夹中的文件",
    "steps": [
      {
        "id": "step-1",
        "description": "扫描下载文件夹获取所有文件列表",
        "toolHint": "filter_files",
        "status": "pending"
      },
      {
        "id": "step-2",
        "description": "按文件类型分类归档",
        "dependsOn": ["step-1"],
        "status": "pending"
      }
    ],
    "estimatedToolCalls": 8
  },
  "done": false
}
```

#### 步骤状态更新事件（v4.7.0 新增）

```
event: plan_step_update
data: {
  "stepId": "step-1",
  "status": "running",
  "done": false
}

event: plan_step_update
data: {
  "stepId": "step-1",
  "status": "done",
  "done": false
}
```

### 前端使用示例

```typescript
const eventSource = new EventSource('/api/ai/agent/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '你好' }),
});

eventSource.addEventListener('text', (e) => {
  const data = JSON.parse(e.data);
  appendText(data.content);
});

eventSource.addEventListener('tool_start', (e) => {
  const data = JSON.parse(e.data);
  showToolCall(data.toolName, data.args);
});

eventSource.addEventListener('tool_result', (e) => {
  const data = JSON.parse(e.data);
  updateToolResult(data.toolCallId, data.result);
});

eventSource.addEventListener('confirm_request', (e) => {
  const data = JSON.parse(e.data);
  showConfirmCard(data.confirmId, data.summary);
});

eventSource.addEventListener('done', (e) => {
  const data = JSON.parse(e.data);
  showSources(data.sources);
  eventSource.close();
});

eventSource.addEventListener('error', (e) => {
  const data = JSON.parse(e.data);
  showError(data.message);
  eventSource.close();
});

eventSource.addEventListener('plan', (e) => {
  const data = JSON.parse(e.data);
  showExecutionPlan(data.plan);
});

eventSource.addEventListener('plan_step_update', (e) => {
  const data = JSON.parse(e.data);
  updatePlanStepStatus(data.stepId, data.status);
});

// v4.7.0 新增：中断处理
// 当用户手动停止或连接中断时，前端应保留已接收内容
const abortController = new AbortController();
eventSource.addEventListener('error', async (e) => {
  // 检查是否为用户主动中断
  if (abortController.signal.aborted) {
    // 保留已输出内容，标记 aborted 状态
    markMessageAsAborted(lastMessageId);
    showAbortIndicator();
  }
  eventSource.close();
});

// 手动停止
function stopGeneration() {
  abortController.abort();
  // API 层会抛出 DOMException('AbortError')，前端统一捕获
}
```

---

## 错误处理

### 错误响应格式

```json
{
  "error": {
    "code": "MODEL_NOT_FOUND",
    "message": "模型不存在",
    "details": {
      "modelId": "uuid"
    }
  }
}
```

### 错误码

| 错误码                | 说明                               | HTTP 状态码 |
| --------------------- | ---------------------------------- | ----------- |
| `UNAUTHORIZED`        | 未认证                             | 401         |
| `FORBIDDEN`           | 无权限                             | 403         |
| `NOT_FOUND`           | 资源不存在                         | 404         |
| `VALIDATION_ERROR`    | 参数验证失败                       | 400         |
| `MODEL_NOT_FOUND`     | 模型不存在                         | 404         |
| `MODEL_INACTIVE`      | 模型未激活                         | 400         |
| `MODEL_TEST_FAILED`   | 模型测试失败                       | 500         |
| `FILE_NOT_FOUND`      | 文件不存在                         | 404         |
| `FILE_NOT_TEXT`       | 文件不是文本类型                   | 400         |
| `FILE_NOT_IMAGE`      | 文件不是图片类型                   | 400         |
| `VECTORIZE_ERROR`     | 向量化失败                         | 500         |
| `AI_REQUEST_FAILED`   | AI 请求失败                        | 500         |
| `RATE_LIMIT_EXCEEDED` | 请求频率超限                       | 429         |
| `TASK_RUNNING`        | 任务正在运行                       | 409         |
| `CONFIRM_EXPIRED`     | 确认请求已过期                     | 400         |
| `CONFIRM_CONSUMED`    | 确认请求已使用                     | 400         |
| `TOKEN_EXPIRED`       | Token 已过期（v4.7.0 修正为 A006） | 401         |

### 错误处理最佳实践

```typescript
try {
  const response = await fetch('/api/ai/models', {
    method: 'POST',
    body: JSON.stringify(modelConfig),
  });

  if (!response.ok) {
    const error = await response.json();
    switch (error.error.code) {
      case 'VALIDATION_ERROR':
        showValidationErrors(error.error.details);
        break;
      case 'MODEL_TEST_FAILED':
        showModelTestError(error.error.message);
        break;
      default:
        showGenericError(error.error.message);
    }
    return;
  }

  const model = await response.json();
  // 处理成功响应
} catch (err) {
  showNetworkError();
}
```

### v4.7.0 中断处理机制（流式输出稳定性）

**问题背景**：v4.7.0 修复了 AI 对话流式输出中断时内容丢失的问题。

**消息类型扩展（aborted 字段）**

```typescript
interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ id: string; fileName: string; score?: number }>;
  toolCalls?: Array<{
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
  }>;
  reasoning?: string;
  modelUsed?: string;
  latencyMs?: number;
  aborted?: boolean; // v4.7.0 新增：标记消息是否被中断
  mentionedFiles?: Array<{
    // v4.7.0 新增：@mention 引用的文件列表
    id: string;
    name: string;
  }>;
  createdAt: string;
}
```

**中断处理流程**

```
用户点击停止 / 连接超时
       ↓
AbortController.abort() → signal.aborted = true
       ↓
API 层检测到 signal → 抛出 DOMException('AbortError')
       ↓
前端 catch AbortError → 保留已接收的 content
       ↓
设置 aborted: true + 显示"输出已中断"提示
       ↓
显示"重新生成"按钮（可基于当前上下文重新发起）
```

**前端实现要点**

1. `api.ts` 中请求开始前检查 `signal.aborted`
2. 流式读取循环中每轮检查中断信号，及时取消 `reader`
3. 统一抛出标准 `DOMException('AbortError')`，避免被重试逻辑误捕获
4. `AIChat.tsx` 中中断时设置 `content: m.content || ''`（保留已输出内容）

---

## v4.7.0 新增工具 API

> **v4.7.0 更新**: Agent 工具集从 99+ 个扩展至 **100+** 个，新增 2 个批量操作工具。同时为所有高频工具补充了 `examples` 字段（Few-shot 示例），提升弱模型工具选择准确率。

### v4.7.0 新增工具列表

| 工具名称       | 模块       | 说明                           | 版本   |
| -------------- | ---------- | ------------------------------ | ------ |
| `batch_move`   | fileops.ts | 批量移动文件（超阈值自动入队） | v4.7.0 |
| `batch_delete` | fileops.ts | 批量删除文件（超阈值自动入队） | v4.7.0 |

### v4.6.0 工具列表（保留）

| 工具名称                   | 模块          | 说明                           | 版本   |
| -------------------------- | ------------- | ------------------------------ | ------ |
| `list_expired_permissions` | permission.ts | 查询已过期/快过期的文件授权    | v4.6.0 |
| `draft_and_create_file`    | fileops.ts    | 对话式文件创建（支持草稿预览） | v4.6.0 |
| `smart_organize_suggest`   | ai-enhance.ts | 智能整理建议（四维度分析）     | v4.6.0 |
| `analyze_file_collection`  | content.ts    | 文件集合分析（多场景分析）     | v4.6.0 |

### 1. list_expired_permissions

查询已过期或即将过期的文件授权。

**参数**：

```typescript
{
  includeExpiringSoon?: boolean,  // 是否包含快过期授权（默认 false）
  withinDays?: number            // 快过期阈值天数（默认 7 天）
}
```

**响应**：

```json
{
  "success": true,
  "data": [
    {
      "fileId": "file-uuid",
      "fileName": "project.docx",
      "userId": "user-uuid",
      "permission": "read",
      "expiresAt": "2026-03-01T00:00:00Z",
      "status": "expired"
    },
    {
      "fileId": "file-uuid-2",
      "fileName": "report.pdf",
      "userId": "user-uuid-2",
      "permission": "write",
      "expiresAt": "2026-04-20T00:00:00Z",
      "status": "expiring_soon"
    }
  ],
  "_next_actions": ["可调用 revoke_permission 批量撤销"]
}
```

**使用场景**：

- 定期清理已过期授权
- 查找即将到期的授权并通知用户
- 批量撤销不再需要的权限

### 2. draft_and_create_file

对话式文件创建工具，支持草稿预览和多轮确认流程。

**参数**：

```typescript
{
  fileName: string,           // 目标文件名（含扩展名）
  targetFolderId?: string,    // 目标文件夹 ID（可选，默认根目录）
  userRequest: string,        // 用户原始需求
  draftContent: string,       // Agent 生成的草稿内容
  _confirmed?: boolean        // 是否确认（false=返回草稿，true=创建文件）
}
```

**响应（\_confirmed = false）**：

```json
{
  "success": true,
  "type": "pending_confirm",
  "data": {
    "confirmId": "confirm-uuid",
    "message": "是否创建文件 \"README.md\"？",
    "draftContent": "# 项目名称\n\n## 简介\n\n这是一个新项目...",
    "previewType": "draft"
  }
}
```

**响应（\_confirmed = true）**：

```json
{
  "success": true,
  "data": {
    "fileId": "file-uuid",
    "fileName": "README.md",
    "path": "/folder/README.md"
  }
}
```

**工作流程**：

1. Agent 调用工具生成草稿（\_confirmed=false）
2. 前端渲染 DraftPreview 组件展示草稿
3. 用户确认后再次调用（\_confirmed=true）
4. 文件创建完成

**支持的预览格式**：

- `.md` → Markdown 渲染
- `.py/.js/.ts/.json` → 代码高亮
- 其他 → 纯文本显示

### 3. smart_organize_suggest

智能分析文件库并提供整理建议（四维度分析）。

**参数**：

```typescript
{
  scope: 'all' | 'folder' | 'untagged',  // 分析范围
  folderId?: string,                     // 文件夹 ID（scope='folder' 时必填）
  limit?: number                         // 最大扫描数（默认 200）
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "scannedCount": 500,
    "namingIssues": [
      {
        "fileId": "file-uuid",
        "currentName": "IMG_001.jpg",
        "issue": "不规范命名：以 IMG 开头"
      }
    ],
    "missingTags": [
      {
        "fileId": "file-uuid-2",
        "fileName": "document.pdf"
      }
    ],
    "relocateSuggestions": [
      {
        "fileId": "file-uuid-3",
        "fileName": "image1.png",
        "suggestedFolderName": "图片",
        "reason": "根目录有 5 个图片文件，建议归类"
      }
    ],
    "structureIssues": [
      {
        "folderId": "folder-uuid",
        "folderName": "uploads",
        "issue": "子文件数过多（120个）",
        "suggestion": "建议按类型拆分为多个文件夹"
      }
    ],
    "_next_actions": ["可调用 batch_rename 修复命名问题", "可调用 auto_tag_files 补充标签", "可调用 move_file 归类文件"]
  }
}
```

**分析维度详解**：

1. **命名问题** (namingIssues)
   - 匹配规则：/^(IMG|DSC|截图|Screenshot|未命名|Untitled|New )/i 或纯数字
   - 建议：使用 batch_rename 批量重命名

2. **标签缺失** (missingTags)
   - 条件：aiTags 为空 AND aiSummary 非空
   - 建议：使用 auto_tag_files 自动打标签

3. **归类建议** (relocateSuggestions)
   - 条件：根目录文件且同 MIME 类型 > 3 个
   - 建议：归入同一文件夹

4. **结构问题** (structureIssues)
   - 条件：单文件夹直接子文件 > 100 或路径层级 > 5
   - 建议：拆分文件夹或平铺结构

### 4. analyze_file_collection

对文件集合进行多维度分析，支持多种分析类型。

**参数**：

```typescript
{
  scope: 'folder' | 'tag' | 'starred',     // 分析范围
  folderId?: string,                        // 文件夹 ID（scope='folder' 时）
  tagName?: string,                         // 标签名（scope='tag' 时）
  analysisType: 'summary' | 'compare' | 'extract_common' | 'timeline',
  maxFiles?: number                          // 最大文件数（默认 20）
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "files": [
      {
        "id": "file-uuid",
        "name": "project-plan.md",
        "mimeType": "text/markdown",
        "size": 10240,
        "summary": "项目计划文档，包含时间线和里程碑...",
        "updatedAt": "2026-04-10T10:00:00Z"
      }
    ],
    "totalCount": 15,
    "truncated": false,
    "analysisType": "summary",
    "_next_actions": ["请基于以上文件摘要生成整体报告"]
  }
}
```

**analysisType 类型说明**：

| 类型             | 说明                     | 输出示例                        |
| ---------------- | ------------------------ | ------------------------------- |
| `summary`        | 生成整体报告             | 文件夹概览、主要主题、统计信息  |
| `compare`        | 对比异同点               | 文档差异、版本对比、优缺点对比  |
| `extract_common` | 提取共同主题/条款/关键词 | 合同要点、论文共同观点、API规范 |
| `timeline`       | 按时间顺序梳理脉络       | 项目进展、事件时间线、变更历史  |

**技术特点**：

- **性能优化**：优先使用 aiSummary 字段，减少实际文件读取
- **灵活范围**：支持 folder/tag/starred 三种筛选方式
- **智能截断**：超过 maxFiles 时优先保留有 aiSummary 的文件
- **Agent 驱动**：返回的 \_next_actions 指导 Agent 进行下一步分析

### 5. batch_move（v4.7.0 新增）

批量移动文件到目标文件夹，超过阈值时自动入队执行。

**参数**：

```typescript
{
  fileIds: string[],        // 要移动的文件 ID 数组（必填）
  targetFolderId: string    // 目标文件夹 ID（必填）
}
```

**响应（文件数 ≤ 20，同步执行）**：

```json
{
  "status": "completed",
  "message": "批量移动完成：15 成功，0 失败",
  "totalFiles": 15,
  "successCount": 15,
  "failCount": 0,
  "_next_actions": ["✅ 已将 15 个文件移到目标文件夹"]
}
```

**响应（文件数 > 20，异步入队）**：

```json
{
  "status": "queued",
  "taskId": "task-uuid",
  "message": "批量移动任务已提交到队列（共 50 个文件），预计 3 分钟完成",
  "totalFiles": 50,
  "estimatedMinutes": 3,
  "_next_actions": ["✅ 批量移动任务已入队（taskId: task-uuid）", "可通过 GET /api/ai/index/task 查看进度"]
}
```

**关键特性**：

- **BATCH_THRESHOLD = 20**：文件数超过此值自动入队
- **降级机制**：队列失败时自动降级为同步执行
- **任务追踪**：返回 taskId 可通过 Task Center 查看进度

### 6. batch_delete（v4.7.0 新增）

批量删除文件（软删除，移入回收站），超过阈值时自动入队执行。

**参数**：

```typescript
{
  fileIds: string[],     // 要删除的文件 ID 数组（必填）
  reason?: string        // 删除原因（可选）
}
```

**响应（文件数 ≤ 20，同步执行）**：

```json
{
  "status": "completed",
  "message": "批量删除完成：10 成功，0 失败",
  "totalFiles": 10,
  "successCount": 10,
  "failCount": 0,
  "_next_actions": ["✅ 已将 10 个文件移入回收站"]
}
```

**响应（文件数 > 20，异步入队）**：

```json
{
  "status": "queued",
  "taskId": "task-uuid",
  "message": "批量删除任务已提交到队列（共 100 个文件），预计 5 分钟完成。文件将被移入回收站，可通过 restore_file 恢复",
  "totalFiles": 100,
  "estimatedMinutes": 5,
  "_next_actions": ["✅ 批量删除任务已入队（taskId: task-uuid）", "删除的文件可在回收站中恢复"]
}
```

**关键特性**：

- **软删除**：文件移入回收站而非永久删除，可通过 `restore_file` 恢复
- **BATCH_THRESHOLD = 20**：与 batch_move 相同的阈值
- **可恢复性**：明确提示用户可在回收站中恢复

---

## 相关文档

- [AI 功能说明](./AI_FEATURES.md)
- [更新日志](../CHANGELOG.md)
- [架构文档](./architecture.md)
