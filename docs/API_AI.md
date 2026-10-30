# OSSshelf AI API 文档（v5.0，Cloudflare Agents SDK）

> 运行时：`OSSShelfAgent`（Durable Object）+ AI SDK `streamText`。
> HTTP 接口只负责会话/记忆管理、模型配置、索引任务与用量查询；对话本体走 `/agents/*` WebSocket。

## 鉴权

除健康检查外，所有接口都需要登录态（Bearer JWT 或 API Key）。AI 相关写操作接口额外经过 `aiRateLimit`：

- 日 Token 配额：`ai.quota.daily_tokens`
- 日请求配额：`ai.quota.daily_requests`
- 每分钟请求上限：`ai.rate.requests_per_minute`

超限返回 `429`，`error.code` 为 `AI_RATE_LIMIT` 或 `AI_QUOTA_EXCEEDED`。

## 环境依赖

| 绑定 / 变量 | 必需 | 说明 |
| --- | --- | --- |
| `AI` | 是 | Workers AI 推理与小规模 embedding |
| `VECTORIZE` | 是 | 文件/记忆向量索引 |
| `AI_TASKS_QUEUE` | 是（批量任务） | 一键索引/摘要/标签的队列 |
| `OSSShelfAgent` | 是 | 对话 Durable Object |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | 可选 | 实时拉取 Workers AI 模型目录（权限 Workers AI Read） |
| `ai_usage_events` / `file_chunks` / `ai_task_items` / `ai_feature_config` / `files_fts` | 是 | 由 `110_ai_agents.sql` 创建，需手动执行迁移 |

---

# 对话（WebSocket）

## POST /api/ai-chat/ws-ticket

换取连接 `/agents/OSSShelfAgent/{userId}:{sessionId}` 的短期票据。

```json
{ "sessionId": "uuid" }
```

返回：

```json
{
  "success": true,
  "data": {
    "ticket": "…",
    "agent": "OSSShelfAgent",
    "name": "userId:sessionId",
    "expiresIn": 7200
  }
}
```

连接后由 Agent 处理消息、工具审批与流式输出，HTTP 层不再提供 SSE/`chat` 接口。

## GET /api/ai-chat/sessions

返回当前用户最近 50 个会话，附带 `messageCount`、`totalTokensUsed`、`lastToolCallCount`（用量来自 `ai_usage_events`）。

## POST /api/ai-chat/sessions

```json
{ "id": "uuid（可选，前端预生成）", "title": "新对话", "modelId": "模型记录ID（可选）" }
```

## PUT /api/ai-chat/sessions/:sessionId

```json
{ "title": "新标题" }
```

## POST /api/ai-chat/sessions/:sessionId/title

用前几轮对话自动生成 8-16 字标题；失败时返回原标题，不会覆盖。

## GET /api/ai-chat/sessions/:sessionId/export

导出该会话为 Markdown（`text/markdown` 附件），内容来自 D1 审计镜像。

## DELETE /api/ai-chat/sessions

清空当前用户全部会话：逐个重置 DO 内对话，删除 `ai_chat_messages` / `ai_memories` / `ai_chat_sessions`；`ai_usage_events` 保留（计费口径）。

```json
{ "deleted": 12 }
```

## DELETE /api/ai-chat/sessions/:sessionId

删除单个会话（同样会重置对应 DO）。

## GET /api/ai-chat/memories

查询参数：`type`（`operation` / `preference` / `path` / `file_ref`）、`limit`、`offset`。

## POST /api/ai-chat/memories/batch-delete

```json
{ "ids": ["memoryId"] }
```

最多 200 条，同时删除 `mem_*` 向量。

## DELETE /api/ai-chat/memories

清空当前用户全部记忆（含向量）。

## DELETE /api/ai-chat/memories/:id

删除单条记忆（含向量）。

---

# 模型与提供商（/api/ai-config）

## GET /models

查询参数：`capability`（`chat` / `vision` / `embedding` / `function_calling` / `completion`）。

## POST /models

```json
{
  "name": "显示名",
  "provider": "workers_ai | openai_compatible",
  "providerId": "可选，自定义提供商ID",
  "modelId": "模型 ID",
  "apiEndpoint": "https://…（openai_compatible 必填）",
  "apiKey": "可选，服务端加密存储",
  "capabilities": ["chat", "vision"],
  "temperature": 0.7,
  "isActive": true
}
```

## PUT /models/:modelId

字段同创建接口，全部可选；`apiKey` 留空表示不修改。

## DELETE /models/:modelId

## POST /models/:modelId/activate

将该模型设为当前激活模型（同一用户仅一个激活模型）。

## GET /ai-providers / POST /ai-providers / PUT /ai-providers/:id / DELETE /ai-providers/:id

自定义 OpenAI 兼容提供商 CRUD。删除前会检查是否仍被模型引用。

## POST /ai-providers/:id/set-default

## GET /providers

返回 `ModelGateway.getAvailableProviders()` 与 Workers AI 模型清单（与实时目录一致）。

## GET /workers-ai/models?refresh=1

Workers AI 模型目录。

```json
{
  "source": "live | fallback",
  "configured": true,
  "fetchedAt": "ISO 时间",
  "error": "同步失败原因（可选）",
  "models": [
    {
      "id": "@cf/…",
      "name": "模型名",
      "description": "描述",
      "task": "Text Generation",
      "capabilities": ["chat"],
      "properties": [{ "key": "context_window", "value": "8192" }],
      "pricing": "可选，官方返回 price/pricing 字段时展示",
      "beta": false,
      "deprecated": false
    }
  ]
}
```

- 配置 `CF_ACCOUNT_ID` + `CF_API_TOKEN` 时为 `live`，缓存 6 小时，`refresh=1` 强制刷新。
- 未配置或同步失败时为 `fallback`（内置兜底清单），响应中的 `configured/error` 用于前端提示。

## GET /status

返回当前激活模型、模型总数、队列是否配置、Workers AI 是否可用。

## GET /feature-config / PUT /feature-config

功能级模型（摘要 / 图片描述 / 图片标签 / 智能重命名）。

## POST /test

```json
{ "modelId": "模型记录ID" }
```

或临时配置：

```json
{ "provider": "workers_ai | openai_compatible", "modelId": "…", "apiEndpoint": "…", "apiKey": "…" }
```

## GET /system-config

读取全部系统配置；首次调用会初始化默认值，并清理注册表之外的历史配置键。

## PUT /system-config/:key

```json
{ "value": "任意类型，按配置项 valueType 解析" }
```

## POST /system-config/:key/reset

重置为默认值。

---

# 索引、摘要与标签（/api/ai）

## GET /status

```json
{ "configured": true, "queueConfigured": true, "features": { "semanticSearch": true, "summary": true, "imageTags": true, "renameSuggest": true } }
```

## POST /index/all

为所有 `vector_indexed_at IS NULL` 的文件建立向量索引。需要队列；已有运行中任务时返回 `409`。

## POST /index/rebuild

清空全部索引标记并重新索引所有文件（先重置 `vector_indexed_at`，再入队）。

## GET /index/status

返回最近一次索引任务。读取前会自动回收停滞超过 30 分钟的任务（标记 `failed`）。

## DELETE /index/task

取消当前运行中的索引任务。

## POST /summarize/batch / POST /tags/batch

批量摘要 / 批量标签，需要队列。返回任务对象。

## GET /summarize/task / GET /tags/task

查询任务状态（同样会回收停滞任务）。

## DELETE /summarize/batch / DELETE /tags/batch

取消对应任务。

## POST /process-selected

```json
{ "fileIds": ["…"], "types": ["summary", "tags"] }
```

对选中文件提交摘要/标签任务（最多 100 个文件）。

## GET /tasks/failed-items?taskId=…&limit=50

失败明细，用于排查批量任务。

```json
{
  "taskId": "…",
  "taskError": "任务级错误（如停滞回收）",
  "taskStatus": "failed",
  "items": [{ "fileId": "…", "fileName": "…", "error": "失败原因", "attempts": 2, "updatedAt": "…" }]
}
```

## GET /index/stats

可编辑文件 / 图片 / 其他文件的未摘要、未索引数量。

## GET /index/vectors?page=1&pageSize=20&search=

已索引文件列表，含真实 `chunkCount` 与 `indexedTextLength`（来自 `file_chunks`）。

## POST /index/vectors/batch-delete

```json
{ "fileIds": ["…"] }
```

最多 200 个；删除 `file_chunks` + Vectorize 向量，并重置 `vector_indexed_at`。

## DELETE /index/vectors/all

清空当前用户全部向量索引（分批处理，返回 `{ "deleted": n }`）。

## GET /index/sample/:fileId

索引详情：chunk 数、前 3 段正文预览、Vectorize 首块元数据。

## DELETE /index/:fileId

删除单个文件的向量索引并重置索引状态。

## POST /search

```json
{ "query": "关键词", "limit": 20, "threshold": 0.7, "mimeType": "可选" }
```

向量 + FTS5 混合检索（RRF 融合），返回文件记录。

## POST /summarize/:fileId / POST /tags/:fileId

单文件摘要 / 单图片标签。

## POST /rename-suggest/:fileId

基于文件内容生成重命名建议。

## POST /name-suggest

```json
{ "content": "≥30 字符", "mimeType": "可选", "extension": "可选" }
```

---

# 用量与配额（/api/ai/usage）

## GET /summary?days=7

```json
{
  "days": 7,
  "totals": { "inputTokens": 0, "outputTokens": 0, "requests": 0 },
  "byDay": [{ "day": "2026-10-30", "inputTokens": 0, "outputTokens": 0, "requests": 0 }],
  "byModel": [{ "modelId": "@cf/…", "inputTokens": 0, "outputTokens": 0, "requests": 0 }],
  "byFeature": [{ "feature": "chat", "inputTokens": 0, "outputTokens": 0, "requests": 0 }]
}
```

记账口径：Agent 对话由 `OSSShelfAgent` 写入；摘要/标签/重命名/标题/记忆提取由 `ModelGateway` 统一写入。`feature` 取值 `chat` / `summary` / `image_caption` / `image_tag` / `image_analysis` / `rename`。

## GET /quota

```json
{
  "allowed": true,
  "usedTokens": 0,
  "tokenLimit": 200000,
  "usedRequests": 0,
  "requestLimit": 200,
  "minuteRequests": 0,
  "minuteLimit": 20
}
```

---

## 错误响应

```json
{ "success": false, "error": { "code": "…", "message": "…" } }
```

常见 `code`：

- `VALIDATION_ERROR`：参数不合法
- `NOT_FOUND`：会话/记忆/文件/任务不存在
- `CONFLICT`：已有同名任务在运行
- `AI_RATE_LIMIT` / `AI_QUOTA_EXCEEDED`：触发限流或配额
- `INTERNAL_ERROR`：服务端异常（含队列未配置）

## 相关文档

- [AI 功能说明](./AI_FEATURES.md)
- [部署说明](./deployment.md)
- [架构说明](./architecture.md)
