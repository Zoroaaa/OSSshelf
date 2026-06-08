# OSSshelf AI 功能说明文档

**版本**: v5.0.0
**更新日期**: 2026-06-08

---

## 📋 目录

- [功能概述](#功能概述)
- [AI 提供商管理](#ai-提供商管理)
- [AI 对话系统](#ai-对话系统)
- [Agent 引擎](#agent-引擎)
- [智能工具集](#智能工具集)
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

v4.7.0 版本对 AI 模块进行了全面升级，核心变化如下：

| 功能                       | 说明                                                | 版本                     |
| -------------------------- | --------------------------------------------------- | ------------------------ |
| **Planning 层**            | 结构化任务规划、ExecutionPlan 接口、SSE 实时进度    | v4.7.0 新增              |
| **跨会话语义记忆**         | D1+Vectorize 双存储、自动提取/召回、记忆管理 UI     | v4.7.0 新增              |
| **工具 Few-shot Examples** | ToolDefinition examples 字段、弱模型准确率提升      | v4.7.0 新增              |
| **批量操作队列打通**       | batch_move/batch_delete、BATCH_THRESHOLD=20         | v4.7.0 新增              |
| **文件拖拽注入**           | 拖拽文件到对话框、自动填入 contextFileIds           | v4.7.0 新增              |
| **@文件快捷引用**          | @mention 下拉框、键盘导航、Chip 展示                | v4.7.0 新增              |
| **对话消息引用/追问**      | 右键引用消息、[引用] 前缀拼接                       | v4.7.0 新增              |
| **模型熔断器**             | 三态状态机、连续失败3次熔断、10分钟恢复             | v4.7.0 新增              |
| **Reasoning 展示优化**     | 默认折叠、streaming 自动展开、字数统计              | v4.7.0 增强              |
| **对话式权限管理**         | 自然语言授权、expiresInDays参数、已过期权限查询     | v4.6.0 新增              |
| **对话式文件创建**         | 草稿预览、多轮起草流程、DraftPreview组件            | v4.6.0 新增              |
| **智能整理建议**           | 四维度分析（命名/标签/归类/结构）、可执行建议       | v4.6.0 新增              |
| **文件集合分析**           | 多场景分析（对比/总结/时间脉络）、aiSummary代理     | v4.6.0 新增              |
| **100+ 个智能工具**        | 覆盖文件操作、权限管理、分享链接等 13+ 个模块       | v4.3.0 新增, v4.7.0 扩展 |
| **模型库大幅扩展**         | 16 个厂商 80+ 个模型，覆盖 2025 年最新推理/视觉模型 | v4.5.0 新增              |
| **Agent 引擎增强**         | Token 预算管理、降级机制改进、统计增强              | v4.5.0 增强              |
| **AI 提供商管理**          | 16 个系统内置提供商，支持自定义提供商               | v4.4.0 新增              |
| **Agent 引擎重构**         | ReAct 架构，多轮推理，链式调用                      | v4.3.0 重构              |
| **智能意图识别**           | 自动识别搜索、视觉、内容理解等意图                  | v4.3.0 新增              |
| **写操作确认**             | 敏感操作需用户确认后执行                            | v4.3.0 新增              |

### v4.7.0 AI 新功能详解

#### 1. Planning 层——结构化任务规划（1.1）

**核心能力**：

- 复杂任务自动生成结构化执行计划
- SSE 实时推送计划进度，前端渲染 PlanProgressBar
- 超出 `maxToolCalls` 时优先完成当前步骤再暂停

**ExecutionPlan 接口**：

```typescript
interface ExecutionPlan {
  goal: string; // 任务目标
  steps: Array<{
    id: string; // step-1, step-2 ...
    description: string; // 人类可读描述
    toolHint?: string; // 预期使用的工具
    dependsOn?: string[]; // 依赖哪些步骤完成
    status: 'pending' | 'running' | 'done' | 'skipped';
  }>;
  estimatedToolCalls: number; // 预估工具调用次数
}
```

**工作流程**：

```
用户输入复杂任务
       ↓
意图复杂度判断（关键词 + LLM）
       ↓
planPhase() → LLM 输出 JSON 计划
       ↓
SSE 推送 { type: 'plan', plan: ExecutionPlan }
       ↓
前端渲染 PlanProgressBar
       ↓
逐步执行 → 每步完成推送 plan_step_update
```

#### 2. 跨会话语义记忆系统（1.2）

**架构设计**：

| 特性         | 说明                                     |
| ------------ | ---------------------------------------- |
| 双存储       | D1（结构化查询）+ Vectorize（语义检索）  |
| 命名空间隔离 | `memory:{userId}` 区别于 `file:{userId}` |
| 记忆类型     | operation / preference / path / file_ref |
| 召回策略     | 时间优先 + 向量语义匹配兜底              |
| 召回数量     | top-3（每次对话注入）                    |

**MemoryFact 接口**：

```typescript
interface MemoryFact {
  type: 'operation' | 'preference' | 'path' | 'file_ref';
  summary: string; // 一句话概括
  sessionId: string;
  createdAt: string;
}
```

**记忆生命周期**：

```
对话进行中 → 用户操作、偏好表达
       ↓
对话结束（waitUntil）
       ↓
LLM 提取 3-5 条结构化事实
       ↓
写入 D1 ai_memories 表 + Vectorize memory:{userId}
       ↓
下次对话开始时 → recallMemories() 召回 top-3
       ↓
拼入 system prompt [历史记忆] 区域
```

**API 端点**：

- `GET /api/ai/memories?type=operation&limit=20&offset=0`
- `DELETE /api/ai/memories/:memoryId`

**前端管理界面**：AISettings 页面新增「记忆管理」Tab

#### 3. 工具定义 Few-shot Examples（1.3）

**ToolDefinition schema 扩展**：

```typescript
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    examples?: Array<{
      // v4.7.0 新增
      user_query: string; // 触发这个工具的典型用户问题
      tool_call: object; // 对应的参数示例
    }>;
  };
}
```

**覆盖工具**：search_files、smart_search、filter_files、draft_and_create_file、move_file 等

**效果**：弱模型工具选择准确率显著提升

#### 4. 批量操作队列打通（1.4）

**新增工具**：

| 工具名称       | 功能                 | 阈值  | 降级策略          |
| -------------- | -------------------- | ----- | ----------------- |
| `batch_move`   | 批量移动文件         | 20 个 | 队列失败→同步执行 |
| `batch_delete` | 批量删除文件（软删） | 20 个 | 队列失败→同步执行 |

**返回格式（异步入队）**：

```json
{
  "status": "queued",
  "taskId": "task-uuid",
  "message": "批量移动任务已提交到队列（共 50 个文件），预计 3 分钟完成",
  "totalFiles": 50,
  "estimatedMinutes": 3,
  "_next_actions": ["可通过 GET /api/ai/index/task 查看进度"]
}
```

#### 5. 文件拖拽注入（2.2）

**交互方式**：从文件列表拖拽文件到对话框

**实现细节**：

- `onDragOver` / `onDragLeave` / `onDrop` 事件处理
- 自动填入 `contextFileIds`
- 消息框显示「附带文件：xxx.pdf」Chip 样式
- 支持多文件拖拽

#### 6. @文件快捷引用（2.2）

**交互方式**：输入 `@` 触发下拉框

**实现细节**：

- debounce 300ms 防抖搜索
- 下拉框展示文件列表（名称 + 路径 + 图标）
- 键盘导航支持（ArrowDown/ArrowUp/Enter）
- 选中后显示 Chip，点击可移除

#### 7. 对话消息引用/追问（2.2）

**交互方式**：右键/长按消息 → 选择「引用此消息」

**实现细节**：

- 输入框顶部显示引用预览条（可关闭）
- 发送时拼接 `[引用]: 原始消息内容\n\n用户问题`
- Agent 可针对历史消息追问和上下文延续

#### 8. 模型熔断器（3.3）

**状态机**：

```
closed（正常）──失败计数≥3──→ open（熔断）
     ↑                            │
     │                     10分钟超时
     │                            ↓
     └──── half-open（半开探测）←──┘
                │
          试探成功 → closed
          试探失败 → open
```

**配置参数**：

| 参数                   | 值             | 说明                   |
| ---------------------- | -------------- | ---------------------- |
| FAILURE_THRESHOLD      | 3              | 连续失败次数阈值       |
| RECOVERY_TIMEOUT_MS    | 10 _ 60 _ 1000 | 熔断恢复时间（10分钟） |
| CIRCUIT_BREAKER_PREFIX | 'circuit:'     | KV 存储键前缀          |

**错误分类**：

- `model_error`：触发熔断（模型本身错误、429 限流等）
- `network_timeout`：不触发熔断（直接重试）
- `unknown`：记录日志

**集成位置**：agentEngine.ts 的 native 和 prompt-based 两条路径

### v4.7.0 安全性与稳定性修复详解 🛡️

#### 9. AI 对话中断恢复（流式输出稳定性）

**问题**：流式输出被中断（卡死/手动停止）时，已输出内容消失。

**修复方案（三层联动）**

| 层级                     | 修改                                                                                     | 效果                     |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------ |
| **API 层** (`api.ts`)    | 请求前检查 `signal.aborted`；流循环中检查中断信号；统一抛出 `DOMException('AbortError')` | 防止中断后重试逻辑误捕获 |
| **类型层** (`types.ts`)  | `AiChatMessage` 新增 `aborted?: boolean` 字段                                            | 明确标记中断状态         |
| **UI 层** (`AIChat.tsx`) | 中断时 `content: m.content \|\| ''` 保留内容；显示"输出已中断" + "重新生成"按钮          | 用户可看到已有输出并继续 |

**前端 UI 表现**

- 被中断的 assistant 消息底部显示 amber 色提示条：「⏹ 输出已中断」
- 消息正常展示已接收的文本、工具调用卡片等
- 消息操作栏显示"重新生成"入口
- user 消息的 `mentionedFiles` 以 Chip 形式展示引用文件列表

#### 10. 安全漏洞全面修复（22 项）

**P0 — Critical（4 项）**

| 漏洞           | 影响                           | 修复方式                                    |
| -------------- | ------------------------------ | ------------------------------------------- |
| 跨用户数据泄露 | 用户 A 可遍历用户 B 文件夹     | `collectFolderFiles` 增加 userId 过滤       |
| WebDAV OOM     | 大文件夹 DELETE/MOVE/COPY 崩溃 | 改用 SQL `like(path, ...)` 查询替代内存过滤 |
| 时序攻击       | 分享密码比对泄露长度信息       | `timingSafeEqual()` 常量时间比较 + KV 限流  |
| CSRF 绕过      | 未知 origin 回退到白名单首项   | CORS fallback 返回 `undefined` 拒绝         |

**P1 — High（6 项）**

| 漏洞            | 影响                          | 修复方式                                                      |
| --------------- | ----------------------------- | ------------------------------------------------------------- |
| Token 缓存泄漏  | CDN 缓存 Query Token 认证信息 | `Cache-Control: private, no-store, no-cache, must-revalidate` |
| sortBy SQL 注入 | 动态字段访问导致注入          | `ALLOWED_SORT_FIELDS` 白名单 + switch 映射                    |
| 流式下载 OOM    | 大文件下载撑爆 Worker 内存    | `s3Get()` → Response body 直接透传                            |
| TOCTOU 竞态     | 下载计数先读后写丢失更新      | 原子 CAS: `UPDATE ... WHERE count < limit`                    |
| WebDAV 暴力破解 | 无限次密码尝试                | IP 维度 KV 限流 5min/10次 → HTTP 429                          |
| 直链滥用        | 无限制调用直链下载            | IP+Token 双维度限流 60次/分钟                                 |

**P2/P3 — Medium/Low（8 项）**

- 广播过滤器字段修正（`role` → `emailVerified`）
- 错误码去重（`TOKEN_EXPIRED`: A001 → A006）
- 类型安全强化（`any[]` → 具体泛型类型）
- 权限常量提取（消除重复定义）
- 缩略图参数边界校验（`clamp(16, 2048)`）
- ESM require 冗余清理
- 魔术数字命名常量化

#### 11. 额外稳定性修复（7 项）

| 问题                  | 严重程度 | 修复方案                                |
| --------------------- | -------- | --------------------------------------- |
| storageUsed 竞态条件  | 🔴 高危  | 原子方法 `updateUserStorage()` 统一替换 |
| 文件列表无分页        | 🔴 高危  | SQL ORDER BY + limit/offset 分页        |
| softDelete 不释放配额 | 🟡 中危  | 软删除时立即扣减 storageUsed            |
| JWT 无 refresh token  | 🟡 中危  | 新增静默续期机制                        |
| Analytics 全量扫描    | 🟡 中危  | SQL GROUP BY 替代 JS 聚合               |
| 分享上传绕过配额      | 🟡 中危  | 增加 owner storageUsed 校验             |
| LIKE 搜索未转义       | 🔵 低危  | `%` / `_` 自动转义                      |

#### 12. 性能优化（5 项）

1. **SQL 排序 + 分页**：文件列表 ORDER BY 替代 JS .sort()
2. **AI 队列背压**：per-user 并发槽位上限
3. **cleanup 分批**：每批 100 条硬删除
4. **WebDAV 原子化**：统一 updateUserStorage()
5. **向量断点续传**：记录最后处理位置

#### 13. 新增功能（6 项）

| 功能              | 说明                             |
| ----------------- | -------------------------------- |
| 📁 文件夹大小统计 | FileDetailPanel 展示递归占用空间 |
| 🔍 增量向量索引   | 上传自动触发，新文件立即可搜     |
| 📦 Zip 打包下载   | 文件夹一键打包                   |
| 📋 文件访问日志   | 文件维度访问记录                 |
| 🏷️ 标签全局管理   | 合并/重命名/批量删除             |
| 📄 AI 对话导出    | Markdown/PDF 导出                |

### v4.6.0 AI 新功能详解

#### 1. 对话式权限管理

**新增能力**：

- `grant_permission` 工具新增 `expiresInDays` 参数
  - 支持自然语言过期时间表达："30天后过期"、"7天后失效"
  - 工具层自动将天数转换为 expiresAt ISO 字符串

- 新增 `list_expired_permissions` 工具
  - 查询已过期的文件授权
  - 支持查询快过期授权（withinDays 参数）
  - 返回结果可直接用于批量撤销操作

- PERMISSION_PATTERNS 扩展
  - 新增口语化表达匹配：把.*给、让.*只能看、让.*只读、收回.*权限、过期.\*授权等

**使用示例**：

```
用户: "把设计文件夹给小明只读，30天后过期"
AI: 调用 grant_permission(folderId, userId, 'read', expiresInDays=30)

用户: "清理所有已过期授权"
AI: 调用 list_expired_permissions() → 逐个 revoke_permission(_confirmed=true)
```

#### 2. 对话式文件创建（含草稿预览）

**工作流程**：

1. 用户请求创建文件（如"帮我写一个README"）
2. Agent 调用 `draft_and_create_file` 工具生成草稿
3. 工具返回 pending_confirm 状态，携带 draftContent 和 previewType: 'draft'
4. 前端 ToolCallCard 渲染 DraftPreview 组件展示草稿
5. 用户确认后，Agent 再次调用 `_confirmed=true` 完成创建

**DraftPreview 组件特性**：

- 支持 Markdown 渲染（react-markdown）
- 支持代码高亮（highlight.js）
- 支持纯文本显示
- 根据 fileName 扩展名自动选择渲染方式
- 最大高度 256px，超出可滚动

#### 3. 智能整理建议

**四维度分析**：

| 维度     | 检测规则                                                   | 建议操作                 |
| -------- | ---------------------------------------------------------- | ------------------------ |
| 命名问题 | 匹配 IMG*/DSC*/截图/未命名/Untitled/New 开头或纯数字文件名 | batch_rename             |
| 标签缺失 | aiTags 为空但 aiSummary 非空                               | auto_tag_files           |
| 归类建议 | 根目录文件且同类型>3个                                     | move_file 归入同一文件夹 |
| 结构问题 | 单文件夹直接子文件数>100 或路径层级>5                      | 拆分文件夹或平铺结构     |

**返回格式**：

```json
{
  "scannedCount": 500,
  "namingIssues": [
    { "fileId": "...", "currentName": "IMG_001.jpg", "issue": "不规范命名" }
  ],
  "missingTags": [...],
  "relocateSuggestions": [...],
  "structureIssues": [...],
  "_next_actions": ["可调用 batch_rename", "可调用 auto_tag_files", "可调用 move_file"]
}
```

#### 4. 文件集合分析

**支持的分析类型**：

| analysisType     | 说明                     | 适用场景               |
| ---------------- | ------------------------ | ---------------------- |
| `summary`        | 生成整体报告             | 了解文件夹全貌         |
| `compare`        | 对比异同点               | 版本对比、文档差异分析 |
| `extract_common` | 提取共同主题/条款/关键词 | 合同分析、论文要点提取 |
| `timeline`       | 按时间顺序梳理脉络       | 项目进展、历史事件梳理 |

**技术优势**：

- 优先使用 aiSummary 减少实际文件读取（性能优化）
- 支持三种范围：folder（文件夹）、tag（标签）、starred（收藏）
- 默认最多分析20个文件（可配置 maxFiles）
- 由 Agent 主模型自行分析和总结（灵活性强）

---

## AI 提供商管理

v4.4.0 新增提供商管理功能，支持 16 个系统内置提供商和用户自定义提供商。

### 系统内置提供商

#### 国内厂商（9 个）

| 提供商          | API 端点                      | Thinking Config            |
| --------------- | ----------------------------- | -------------------------- |
| 百度文心一言    | aip.baidubce.com              | 布尔类型 (enable_thinking) |
| 腾讯混元        | api.hunyuan.cloud.tencent.com | 对象类型 (thinking.type)   |
| 阿里通义千问    | dashscope.aliyuncs.com        | 布尔类型 (enable_thinking) |
| 字节火山引擎    | ark.cn-beijing.volces.com     | 对象类型 (thinking.type)   |
| 智谱AI          | open.bigmodel.cn              | 对象类型 (thinking.type)   |
| MiniMax         | api.minimax.chat              | -                          |
| 月之暗面 (Kimi) | api.moonshot.cn               | 对象类型 (thinking.type)   |
| 硅基流动        | api.siliconflow.cn            | 布尔类型 (enable_thinking) |
| DeepSeek        | api.deepseek.com              | 对象类型 (thinking.type)   |

#### 国际厂商（7 个）

| 提供商           | API 端点                          | Thinking Config               |
| ---------------- | --------------------------------- | ----------------------------- |
| OpenAI           | api.openai.com                    | 字符串类型 (reasoning_effort) |
| Anthropic Claude | api.anthropic.com                 | 对象类型 (thinking.type)      |
| Google Gemini    | generativelanguage.googleapis.com | 字符串类型 (thinking_level)   |
| Mistral AI       | api.mistral.ai                    | -                             |
| xAI Grok         | api.x.ai                          | 对象类型 (thinking.type)      |
| Groq             | api.groq.com                      | -                             |
| Perplexity       | api.perplexity.ai                 | -                             |
| OpenRouter       | openrouter.ai                     | -                             |

### Thinking Config 配置

不同提供商的推理模式配置格式：

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

### 提供商管理功能

- **查看提供商列表**：显示所有系统内置和自定义提供商
- **添加自定义提供商**：支持用户添加自己的 OpenAI 兼容 API
- **编辑提供商**：修改名称、端点、描述等
- **删除提供商**：仅支持删除自定义提供商
- **设置默认提供商**：快速切换默认提供商

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
- **写操作确认**：敏感操作展示确认卡片

### 全局悬浮聊天组件

页面右下角悬浮按钮：

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
"这张图片里是什么？"
"帮我创建一个 README.md 文件"
"把这些文件移动到项目文件夹"
```

### RAG 工作原理

```
用户提问 → 向量搜索相关文件 → 组装上下文 → 发送给 AI 模型 → 流式返回答案
                                                    ↓
                                              引用来源文件
```

---

## Agent 引擎

### 架构概述

v4.3.0 采用 **ReAct 架构**（Reason → Act → Observe → Reason...），实现多轮推理和链式工具调用：

```
┌─────────────────────────────────────────────────────────────┐
│                    ReAct 循环                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  Reason  │───→│   Act    │───→│ Observe  │──┐           │
│  │  (推理)  │    │  (行动)  │    │  (观察)  │  │           │
│  └──────────┘    └──────────┘    └──────────┘  │           │
│       ↑                                          │           │
│       └──────────────────────────────────────────┘           │
│                                                              │
│  循环条件：                                                   │
│  - 工具调用次数 < 最大限制（默认 20）                          │
│  - 无重复调用                                                 │
│  - 有效信息轮 < 最大空转轮数（默认 3）                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 核心特性

#### 1. 智能意图识别

系统自动识别用户意图，精准选择工具：

| 意图类型       | 特征                   | 工具选择                       |
| -------------- | ---------------------- | ------------------------------ |
| **搜索类**     | 提到文件名/内容关键词  | search_files                   |
| **过滤类**     | 只说文件类型/属性      | filter_files                   |
| **标签类**     | 提到标签               | search_by_tag                  |
| **视觉类**     | 涉及图片外观/场景/描述 | filter_files → analyze_image   |
| **内容理解类** | 想了解文件内容         | read_file_text / analyze_image |
| **统计类**     | 问存储/文件数量        | get_storage_stats              |
| **操作类**     | 创建/编辑/删除文件     | 对应写操作工具                 |

#### 2. 链式推理

工具结果中的 `_next_actions` 字段驱动 Agent 自主规划下一步：

```typescript
// 工具返回示例
{
  "files": [...],
  "total": 10,
  "_next_actions": [
    "如果用户想了解具体内容，可以调用 read_file_text",
    "如果是图片文件，可以调用 analyze_image"
  ]
}
```

#### 3. 视觉意图检测

当用户需求涉及图片视觉内容时，自动触发视觉分析链路：

```typescript
// 视觉意图模式匹配
const VISUAL_INTENT_PATTERNS = [
  /描述|外观|颜色|样子|长什么/,
  /照片|图片.*(找|搜|看)/,
  /describe|appearance|look like/i,
  /find.*photo|find.*image/i,
];
```

**标准流程**：

1. 调用 `filter_files(mimeTypePrefix="image/")` 获取图片候选集
2. 对每张候选图片调用 `analyze_image`
3. 根据视觉描述结果筛选，汇报符合条件的图片

#### 4. 循环防护机制

- **调用签名去重**：相同工具+相同参数的调用自动跳过
- **空转检测**：连续 N 轮无有效新信息自动退出
- **次数限制**：单次响应最大 20 次工具调用（可配置）

#### 5. 写操作确认

敏感操作（删除、移动、权限变更等）需用户确认后执行：

```
用户请求删除文件
       ↓
Agent 调用 delete_file 工具
       ↓
系统检测到写操作，暂停执行
       ↓
返回 confirm_request 事件
       ↓
前端展示确认卡片
       ↓
用户点击"确认执行"
       ↓
调用确认 API，执行操作
```

### SSE 事件类型

流式响应支持以下事件类型：

```typescript
// 文本内容
{ type: "text", content: "文本内容", done: false }

// 推理内容
{ type: "reasoning", content: "思考过程...", done: false }

// 工具调用开始
{ type: "tool_start", toolName: "search_files", toolCallId: "xxx", args: {...}, done: false }

// 工具调用结果
{ type: "tool_result", toolCallId: "xxx", toolName: "search_files", result: {...}, done: false }

// 确认请求（写操作）
{ type: "confirm_request", confirmId: "xxx", toolName: "delete_file", args: {...}, summary: "删除文件", done: true }

// 执行计划（v4.7.0 新增）
{ type: "plan", plan: ExecutionPlan, done: false }

// 步骤状态更新（v4.7.0 新增）
{ type: "plan_step_update", stepId: "step-1", status: "running", done: false }

// 完成
{ type: "done", sessionId: "xxx", sources: [...] }
```

### 推理内容支持

以下模型支持显示推理内容：

| 厂商     | 模型              | 说明               |
| -------- | ----------------- | ------------------ |
| DeepSeek | R1 系列           | 显示完整推理过程   |
| 智谱     | GLM-4.5/4.6/4.7/5 | 支持 thinking 模式 |
| 阿里     | QwQ 系列          | 显示推理过程       |

---

## 智能工具集

v4.3.0 提供了 **100+ 个智能工具**，分为 13 个功能模块：

### 工具模块总览

| 模块          | 工具数 | 功能描述                                         |
| ------------- | ------ | ------------------------------------------------ |
| 🔍 搜索与发现 | 7      | 文件搜索、过滤、标签搜索、重复检测、文件详情     |
| 📄 内容理解   | 7      | 文件读取、图片分析、文件对比、元数据提取         |
| 📂 目录导航   | 7      | 文件夹浏览、目录树、最近文件、收藏文件、存储概览 |
| 📊 统计分析   | 5      | 存储统计、活动统计、配额信息、文件分布           |
| 📁 文件操作   | 15     | 创建、编辑、重命名、移动、复制、删除等           |
| 🏷️ 标签管理   | 7      | 添加/移除标签、合并标签、自动打标签、标签管理    |
| 🔗 分享链接   | 8      | 创建分享、直链、上传链接、分享管理               |
| 📜 版本管理   | 4      | 版本查看、恢复、对比、保留策略                   |
| 📝 笔记备注   | 5      | 添加/获取/更新/删除/搜索笔记                     |
| 🔐 权限管理   | 6      | 权限查看、授权、撤销、用户组管理                 |
| 💾 存储管理   | 8      | 存储桶管理、文件迁移、存储分析                   |
| ⚙️ 系统管理   | 11     | 用户配置、API Key、Webhook、审计日志、FAQ        |
| 🤖 AI 增强    | 5      | AI 摘要、AI 标签、向量索引、RAG 问答             |

### 详细工具列表

#### 🔍 搜索与发现（7 个）

| 工具名称            | 功能           | 参数                                        |
| ------------------- | -------------- | ------------------------------------------- |
| `search_files`      | 关键词搜索文件 | query, limit, mimeType                      |
| `filter_files`      | 按条件过滤文件 | mimeTypePrefix, minSize, maxSize, dateRange |
| `search_by_tag`     | 按标签搜索     | tagNames, matchAll                          |
| `search_duplicates` | 查找重复文件   | -                                           |
| `smart_search`      | 智能语义搜索   | query, limit                                |
| `get_similar_files` | 获取相似文件   | fileId, limit                               |
| `get_file_details`  | 获取文件详情   | fileId                                      |

#### 📄 内容理解与分析（7 个）

| 工具名称           | 功能             | 参数                       |
| ------------------ | ---------------- | -------------------------- |
| `read_file_text`   | 读取文本文件内容 | fileId, startLine, endLine |
| `analyze_image`    | 分析图片内容     | fileId, question           |
| `compare_files`    | 对比两个文件     | fileId1, fileId2           |
| `extract_metadata` | 提取文件元数据   | fileId                     |
| `generate_summary` | 生成文件摘要     | fileId                     |
| `generate_tags`    | 生成文件标签     | fileId                     |
| `content_preview`  | 内容预览         | fileId, maxLength          |

#### 📂 目录导航（7 个）

| 工具名称               | 功能           | 参数                        |
| ---------------------- | -------------- | --------------------------- |
| `navigate_path`        | 导航到指定路径 | path                        |
| `list_folder`          | 列出文件夹内容 | folderId, sortBy, sortOrder |
| `get_recent_files`     | 获取最近文件   | limit, mimeType             |
| `get_starred_files`    | 获取收藏文件   | limit                       |
| `get_parent_chain`     | 获取父级路径链 | fileId                      |
| `get_folder_tree`      | 获取目录树     | folderId, depth             |
| `get_storage_overview` | 获取存储概览   | -                           |

#### 📊 统计与分析（5 个）

| 工具名称                     | 功能             | 参数 |
| ---------------------------- | ---------------- | ---- |
| `get_storage_stats`          | 获取存储统计     | -    |
| `get_activity_stats`         | 获取活动统计     | days |
| `get_user_quota_info`        | 获取用户配额     | -    |
| `get_file_type_distribution` | 获取文件类型分布 | -    |
| `get_sharing_stats`          | 获取分享统计     | -    |

#### 📁 文件操作（15 个）⭐ 写操作

| 工具名称                    | 功能           | 需确认 |
| --------------------------- | -------------- | ------ |
| `create_text_file`          | 创建文本文件   | ✅     |
| `create_code_file`          | 创建代码文件   | ✅     |
| `create_file_from_template` | 从模板创建文件 | ✅     |
| `edit_file_content`         | 编辑文件内容   | ✅     |
| `append_to_file`            | 追加内容到文件 | ✅     |
| `find_and_replace`          | 查找替换       | ✅     |
| `rename_file`               | 重命名文件     | ✅     |
| `move_file`                 | 移动文件       | ✅     |
| `copy_file`                 | 复制文件       | ✅     |
| `delete_file`               | 删除文件       | ✅     |
| `restore_file`              | 恢复文件       | ✅     |
| `create_folder`             | 创建文件夹     | ✅     |
| `batch_rename`              | 批量重命名     | ✅     |
| `star_file`                 | 收藏文件       | ✅     |
| `unstar_file`               | 取消收藏       | ✅     |

#### 🏷️ 标签管理（7 个）

| 工具名称                       | 功能                   | 需确认 |
| ------------------------------ | ---------------------- | ------ |
| `add_tag`                      | 添加标签               | ✅     |
| `remove_tag`                   | 移除标签               | ✅     |
| `get_file_tags`                | 获取文件标签           | ❌     |
| `list_all_tags_for_management` | 列出所有标签（管理用） | ❌     |
| `merge_tags`                   | 合并标签               | ✅     |
| `auto_tag_files`               | 自动打标签             | ✅     |
| `tag_folder`                   | 为文件夹打标签         | ✅     |

#### 🔗 分享链接（8 个）

| 工具名称                        | 功能         | 需确认 |
| ------------------------------- | ------------ | ------ |
| `create_share_link`             | 创建分享链接 | ✅     |
| `list_shares`                   | 列出分享     | ❌     |
| `update_share_settings`         | 更新分享设置 | ✅     |
| `revoke_share`                  | 撤销分享     | ✅     |
| `get_share_stats`               | 获取分享详情 | ❌     |
| `create_direct_link`            | 创建直链     | ✅     |
| `revoke_direct_link`            | 撤销直链     | ✅     |
| `create_upload_link_for_folder` | 创建上传链接 | ✅     |

#### 📜 版本管理（4 个）

| 工具名称                | 功能         | 需确认 |
| ----------------------- | ------------ | ------ |
| `get_file_versions`     | 获取版本列表 | ❌     |
| `restore_version`       | 恢复版本     | ✅     |
| `compare_versions`      | 对比版本     | ❌     |
| `set_version_retention` | 设置保留策略 | ✅     |

#### 📝 笔记备注（5 个）

| 工具名称       | 功能         | 需确认 |
| -------------- | ------------ | ------ |
| `add_note`     | 添加笔记     | ✅     |
| `get_notes`    | 获取笔记列表 | ❌     |
| `update_note`  | 更新笔记     | ✅     |
| `delete_note`  | 删除笔记     | ✅     |
| `search_notes` | 搜索笔记     | ❌     |

#### 🔐 权限管理（6 个）

| 工具名称                  | 功能         | 需确认 |
| ------------------------- | ------------ | ------ |
| `get_file_permissions`    | 获取权限     | ❌     |
| `grant_permission`        | 授权         | ✅     |
| `revoke_permission`       | 撤销权限     | ✅     |
| `set_folder_access_level` | 设置访问级别 | ✅     |
| `list_user_groups`        | 列出用户组   | ❌     |
| `manage_group_members`    | 管理组成员   | ✅     |

#### 💾 存储管理（8 个）

| 工具名称                  | 功能           | 需确认 |
| ------------------------- | -------------- | ------ |
| `get_storage_usage`       | 获取存储使用   | ❌     |
| `get_large_files`         | 获取大文件     | ❌     |
| `get_folder_sizes`        | 获取文件夹大小 | ❌     |
| `get_cleanup_suggestions` | 清理建议       | ❌     |
| `list_buckets`            | 列出存储桶     | ❌     |
| `get_bucket_info`         | 获取存储桶信息 | ❌     |
| `set_default_bucket`      | 设置默认桶     | ✅     |
| `migrate_file_to_bucket`  | 迁移文件       | ✅     |

#### ⚙️ 系统管理（11 个）

| 工具名称            | 功能         | 需确认 |
| ------------------- | ------------ | ------ |
| `get_system_status` | 系统状态     | ❌     |
| `get_help`          | 获取帮助     | ❌     |
| `get_version_info`  | 版本信息     | ❌     |
| `get_user_profile`  | 用户配置     | ❌     |
| `list_api_keys`     | 列出 API Key | ❌     |
| `create_api_key`    | 创建 API Key | ✅     |
| `revoke_api_key`    | 撤销 API Key | ✅     |
| `list_webhooks`     | 列出 Webhook | ❌     |
| `create_webhook`    | 创建 Webhook | ✅     |
| `get_audit_logs`    | 审计日志     | ❌     |

#### 🤖 AI 增强（5 个）

| 工具名称               | 功能           | 需确认 |
| ---------------------- | -------------- | ------ |
| `trigger_ai_summary`   | 触发 AI 摘要   | ❌     |
| `trigger_ai_tags`      | 触发 AI 标签   | ❌     |
| `rebuild_vector_index` | 重建向量索引   | ❌     |
| `ask_rag_question`     | RAG 问答       | ❌     |
| `smart_rename_suggest` | 智能重命名建议 | ❌     |

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
- AI 对话中：直接说"帮我总结这个文件"

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
- AI 对话中：直接说"分析这张图片"

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
- AI 对话中：直接提问，系统自动使用语义搜索

### 4️⃣ 智能重命名

**功能**：根据文件内容智能推荐文件名

**使用方式**：

- 已有文件：右键菜单 →「智能重命名」
- 新建文件：创建文件对话框中的「AI 命名」选项
- AI 对话中：直接说"帮我重命名这个文件"

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

| 模型 ID                                     | 名称            | 参数量 | 特点       | 推荐场景             |
| ------------------------------------------- | --------------- | ------ | ---------- | -------------------- |
| `@cf/deepseek/deepseek-r1-distill-qwen-32b` | DeepSeek R1 32B | 32B    | 推理能力强 | 数学、代码、复杂推理 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast`  | Llama 3.3 70B   | 70B    | Meta 最新  | 复杂任务首选         |
| `@cf/qwen/qwen1.5-14b-chat-awq`             | Qwen 1.5 14B    | 14B    | 中文优秀   | 中文对话             |
| `@cf/meta/llama-3.1-8b-instruct`            | Llama 3.1 8B    | 8B     | 通用型     | 默认模型，日常使用   |
| `@cf/mistral/mistral-7b-instruct-v0.2`      | Mistral 7B      | 7B     | 速度快     | 实时对话             |
| `@cf/google/gemma-2b-it-lora`               | Gemma 2B        | 2B     | 轻量       | 简单任务             |

#### 视觉模型 (Vision)

| 模型 ID                        | 名称         | 用途           |
| ------------------------------ | ------------ | -------------- |
| `@cf/llava-hf/llava-1.5-7b-hf` | LLaVA 1.5 7B | 图片理解和描述 |

#### 嵌入模型 (Embedding)

| 模型 ID           | 名称   | 用途                 |
| ----------------- | ------ | -------------------- |
| `@cf/baai/bge-m3` | BGE-M3 | 文本向量化、语义搜索 |

#### 自定义模型

支持输入任意 Workers AI 模型 ID：

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

| 能力               | 说明       | 适用功能                   |
| ------------------ | ---------- | -------------------------- |
| `chat`             | 文本对话   | 摘要生成、智能重命名、对话 |
| `vision`           | 图片理解   | 图片描述、图片标签         |
| `embedding`        | 文本向量化 | 语义搜索                   |
| `function_calling` | 工具调用   | Agent 引擎                 |

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

| 功能       | 可选模型范围 | 说明                 |
| ---------- | ------------ | -------------------- |
| 文件摘要   | chat 模型    | 推荐使用大参数模型   |
| 图片描述   | vision 模型  | 必须支持图片理解     |
| 图片标签   | chat 模型    | 使用文本模型生成标签 |
| 智能重命名 | chat 模型    | 推荐使用轻量快速模型 |

#### 📊 向量库（Vectors 标签）

查看和管理向量索引：

- 已索引文件列表（分页显示）
- 文件名、类型、大小、索引时间
- 摘要生成状态
- 单个删除向量索引

#### 📈 任务中心（Tasks 标签）

统一显示所有任务状态：

- 索引任务状态
- 摘要生成任务状态
- 标签生成任务状态
- 文件处理总览统计

#### ⚙️ 高级配置（Advanced 标签）

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

| 功能       | 要求的能力 | 可选模型示例                       |
| ---------- | ---------- | ---------------------------------- |
| 文件摘要   | `chat`     | Llama 3.1 8B, DeepSeek 32B, GPT-4o |
| 图片描述   | `vision`   | LLaVA 1.5 7B, GPT-4 Vision         |
| 图片标签   | `chat`     | Llama 3.1 8B, Qwen 14B, GPT-4o     |
| 智能重命名 | `chat`     | Llama 3.1 8B, Qwen 14B, GPT-4o     |

### 配置方法

1. 进入 AI 设置 → 索引与处理
2. 找到「功能模型配置」区域
3. 为每个功能选择模型（或留空使用默认）
4. 选择后自动保存

---

## AI 系统配置

v4.3.0 AI 系统配置功能，支持细粒度的 AI 参数调整。

### 配置分类

| 分类          | 说明             | 配置项示例                     |
| ------------- | ---------------- | ------------------------------ |
| 🤖 默认模型   | 各功能的默认模型 | 默认聊天模型、默认视觉模型     |
| ⚙️ 模型参数   | 模型调用参数     | 默认温度、最大 Token           |
| 📏 内容限制   | 内容生成限制     | 摘要最大长度、标签最大数量     |
| 🔄 重试策略   | 错误重试配置     | 最大重试次数、重试间隔         |
| 💬 提示词模板 | 自定义提示词     | 摘要提示词、标签提示词         |
| ✨ 功能开关   | 功能启用控制     | 启用推理内容显示               |
| 🤖 Agent 配置 | Agent 行为配置   | 最大工具调用次数、最大空转轮数 |

### 配置项示例

| 配置 Key                      | 说明             | 默认值                           |
| ----------------------------- | ---------------- | -------------------------------- |
| `ai.default_model.chat`       | 默认聊天模型     | `@cf/meta/llama-3.1-8b-instruct` |
| `ai.default_model.vision`     | 默认视觉模型     | `@cf/llava-hf/llava-1.5-7b-hf`   |
| `ai.default_model.summary`    | 默认摘要模型     | `@cf/meta/llama-3.1-8b-instruct` |
| `ai.parameter.temperature`    | 默认温度         | `0.7`                            |
| `ai.parameter.max_tokens`     | 默认最大 Token   | `4096`                           |
| `ai.limit.summary_max_length` | 摘要最大长度     | `500`                            |
| `ai.limit.tags_max_count`     | 标签最大数量     | `10`                             |
| `ai.retry.max_attempts`       | 最大重试次数     | `3`                              |
| `ai.retry.delay_ms`           | 重试间隔（毫秒） | `1000`                           |
| `ai.agent.max_tool_calls`     | 最大工具调用次数 | `20`                             |
| `ai.agent.max_idle_rounds`    | 最大空转轮数     | `3`                              |
| `ai.agent.temperature`        | Agent 温度       | `0.3`                            |
| `ai.agent.image_timeout_ms`   | 图片分析超时     | `25000`                          |

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
├── agentEngine.ts              # Agent 引擎 (v4.3.0 重构, v4.7.0 增强)
├── agentMemory.ts              # 跨会话记忆管理 (v4.7.0 新增)
├── circuitBreaker.ts           # 模型调用熔断器 (v4.7.0 新增)
├── aiConfigService.ts          # AI 配置服务
├── ragEngine.ts                # RAG 引擎
├── features.ts                 # 文件处理功能
├── utils.ts                    # 工具函数
├── vendorConfig.ts             # 供应商配置
└── adapters/
    ├── workersAiAdapter.ts     # Workers AI 适配器
    └── openAiCompatibleAdapter.ts # OpenAI 兼容适配器

apps/api/src/lib/ai/agentTools/   # 工具模块 (v4.3.0 新增, v4.7.0 扩展)
├── index.ts                    # 工具统一入口
├── types.ts                    # 工具类型定义 (含 examples 字段)
├── agentToolUtils.ts           # 工具通用函数
├── search.ts                   # 搜索工具 (6个)
├── content.ts                  # 内容理解工具 (7个)
├── navigation.ts               # 导航工具 (4个)
├── stats.ts                    # 统计工具 (5个)
├── fileops.ts                  # 文件操作工具 (17个, 含 batch_move/batch_delete)
├── tags.ts                     # 标签管理工具 (6个)
├── share.ts                    # 分享链接工具 (10个)
├── version.ts                  # 版本管理工具 (4个)
├── notes.ts                    # 笔记备注工具 (5个)
├── permission.ts               # 权限管理工具 (6个)
├── storage.ts                  # 存储管理工具 (8个)
├── system.ts                   # 系统管理工具 (11个)
└── ai-enhance.ts               # AI 增强工具 (5个)

apps/web/src/
├── pages/
│   ├── AIChat.tsx              # AI 对话页面 (v4.7.0 增强: 拖拽/@mention/引用)
│   └── AISettings.tsx          # AI 设置页面 (v4.7.0 增强: 记忆管理 Tab)
└── components/ai/
    ├── AIChatWidget.tsx        # 全局悬浮聊天组件
    ├── chat/
    │   ├── AssistantContent.tsx
    │   ├── ChatHeader.tsx
    │   ├── ChatSidebar.tsx
    │   ├── ReasoningSection.tsx  # 推理展示 (v4.7.0 优化)
    │   ├── ToolCallCard.tsx    # 工具调用卡片 (v4.3.0 增强)
    │   ├── ToolInfoModal.tsx
    │   ├── DraftPreview.tsx    # 草稿预览 (v4.6.0 新增)
    │   ├── PlanProgressBar.tsx # 计划进度条 (v4.7.0 新增)
    │   └── WelcomeScreen.tsx
    └── settings/
        ├── AdvancedConfigPanel.tsx
        ├── IndexProcessingTab.tsx
        ├── ModelCard.tsx
        ├── ModelFormModal.tsx
        ├── ProvidersSection.tsx
        ├── StatsCard.tsx
        ├── TaskProgress.tsx
        ├── TasksCenter.tsx
        ├── VectorsTable.tsx
        └── MemoryManagementTab.tsx  # 记忆管理 (v4.7.0 新增)
```

### 核心类/函数

#### ModelGateway（模型网关）

统一管理所有模型调用：

```typescript
class ModelGateway {
  getActiveModel(userId): Promise<ModelConfig>;
  getModelById(modelId, userId): Promise<ModelConfig>;
  chatCompletion(userId, request, modelId?): Promise<ChatCompletionResponse>;
  chatCompletionStream(userId, request, onChunk, options?): Promise<void>;
  getAdapter(config): IModelAdapter;
}
```

#### AgentEngine（Agent 引擎）v4.3.0

```typescript
class AgentEngine {
  run(userId, query, history, modelId?, onChunk?, signal?, sessionId?): Promise<AgentResult>;
  executeConfirmAction(confirmId, userId): Promise<unknown>;
}

// SSE 事件类型
type AgentChunk =
  | { type: 'text'; content: string; done: false }
  | { type: 'reasoning'; content: string; done: false }
  | { type: 'tool_start'; toolName: string; toolCallId: string; args: Record<string, unknown>; done: false }
  | { type: 'tool_result'; toolCallId: string; toolName: string; result: unknown; done: false }
  | {
      type: 'confirm_request';
      confirmId: string;
      toolName: string;
      args: Record<string, unknown>;
      summary: string;
      done: true;
    }
  | { type: 'done'; sessionId: string; sources: AgentSource[]; done: true }
  | { type: 'error'; message: string; done: true };
```

#### AgentToolExecutor（工具执行器）v4.3.0

```typescript
class AgentToolExecutor {
  execute(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  executeConfirmed(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

// 工具定义
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
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

| 字段              | 类型    | 说明                                      |
| ----------------- | ------- | ----------------------------------------- |
| id                | text    | 主键 UUID                                 |
| user_id           | text    | 用户 ID                                   |
| name              | text    | 模型显示名称                              |
| provider          | text    | providers: workers_ai / openai_compatible |
| model_id          | text    | 模型 ID                                   |
| api_endpoint      | text?   | API 端点（OpenAI 兼容）                   |
| api_key_encrypted | text?   | 加密的 API Key                            |
| is_active         | integer | 是否激活 (0/1)                            |
| capabilities      | text    | 能力 JSON 数组                            |
| max_tokens        | integer | 最大 Token 数                             |
| temperature       | real    | 温度参数                                  |
| system_prompt     | text?   | 系统提示词                                |
| config_json       | text    | 扩展配置 JSON                             |
| created_at        | text    | 创建时间                                  |
| updated_at        | text    | 更新时间                                  |

#### ai_chat_sessions（对话会话表）

| 字段       | 类型  | 说明          |
| ---------- | ----- | ------------- |
| id         | text  | 主键 UUID     |
| user_id    | text  | 用户 ID       |
| title      | text  | 会话标题      |
| model_id   | text? | 使用的模型 ID |
| created_at | text  | 创建时间      |
| updated_at | text  | 更新时间      |

#### ai_chat_messages（对话消息表）

| 字段       | 类型     | 说明                            |
| ---------- | -------- | ------------------------------- |
| id         | text     | 主键 UUID                       |
| session_id | text     | 会话 ID                         |
| role       | text     | 角色: user / assistant / system |
| content    | text     | 消息内容                        |
| sources    | text?    | 来源文件 JSON                   |
| model_used | text?    | 使用的模型                      |
| latency_ms | integer? | 响应延迟（毫秒）                |
| created_at | text     | 创建时间                        |

#### ai_confirm_requests（确认请求表）v4.3.0

| 字段       | 类型  | 说明                     |
| ---------- | ----- | ------------------------ |
| id         | text  | 主键 UUID                |
| user_id    | text  | 用户 ID                  |
| session_id | text? | 会话 ID                  |
| tool_name  | text  | 工具名称                 |
| args       | text  | 参数 JSON                |
| summary    | text  | 操作摘要                 |
| status     | text  | 状态: pending / consumed |
| created_at | text  | 创建时间                 |
| expires_at | text  | 过期时间                 |

---

## 相关文档

- [API 文档 - AI 部分](./API_AI.md)
- [更新日志](../CHANGELOG.md)
- [架构文档](./architecture.md)
