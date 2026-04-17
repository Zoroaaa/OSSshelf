# OSSshelf AI 模块增强计划

> 目标：将 AI 模块从「够用的文件助手」做成「有竞争力的智能文件管理 Agent」  
> 参考项目：OpenClaw、Hermes（Agent 架构）/ LobeChat、Open WebUI（交互设计）  
> 原则：借鉴思路，不集成代码；所有改动在现有 Cloudflare Workers + D1 + Vectorize 栈内完成

---

## 优先级一：Agent 能力增强（核心竞争力）

### 1.1 Planning 层——结构化任务规划

**现状问题**  
`agentEngine` 是单轮 ReAct loop：LLM call → 选工具 → 执行 → 下一轮。  
`_next_actions` 字段已有但只是建议，engine 没有真正消费它驱动全局规划。  
复杂任务（批量整理、多步操作）容易中途超 `maxToolCalls` 截断。

**目标行为**  
用户说「把下载文件夹里所有超过 1 年没动的文件，按类型归档到对应子文件夹，重复的删掉」→ Agent 先生成执行计划，再逐步执行，中途可展示进度。

**改动位置**：`agentEngine.ts`

**实现步骤**

1. **意图复杂度判断**  
   在 `run()` 入口处，通过关键词 + LLM 快速判断是否为「多步任务」（涉及批量/条件/多阶段操作）。简单问答跳过规划直接走现有 ReAct。

2. **新增 `planPhase()` 方法**  
   复杂任务触发。让 LLM 输出结构化 JSON 计划：
   ```typescript
   interface ExecutionPlan {
     goal: string;
     steps: Array<{
       id: string;           // step-1, step-2 ...
       description: string;  // 人类可读描述
       toolHint?: string;    // 预期使用的工具
       dependsOn?: string[]; // 依赖哪些步骤完成
       status: 'pending' | 'running' | 'done' | 'skipped';
     }>;
     estimatedToolCalls: number;
   }
   ```

3. **计划驱动执行**  
   每轮执行前注入当前计划状态到 context，LLM 根据计划执行而不是自由发挥。  
   每步完成后更新 `step.status`，超出 `maxToolCalls` 时优先完成当前步骤再暂停。

4. **SSE 新增 `plan` chunk 类型**  
   前端可实时渲染执行计划进度（见优先级三 1.3）。
   ```typescript
   // 新增 chunk 类型
   { type: 'plan', plan: ExecutionPlan, done: false }
   { type: 'plan_step_update', stepId: string, status: string, done: false }
   ```

---

### 1.2 跨会话记忆——语义 Memory

**现状问题**  
每次对话从零开始。`conversationHistory` 只是当前 session 内的上下文。  
`vectorIndex` 只索引了文件内容，没有索引对话记忆。

**目标行为**  
用户说「上次你帮我整理的那个设计文件夹」→ Agent 能找回上次操作上下文。  
用户偏好、常用路径、重要文件被记住，减少重复提问。

**改动位置**：`vectorIndex.ts`（新增函数）、`agentEngine.ts`（召回注入）、`aiChatRoutes.ts`（写入触发）

**实现步骤**

1. **Memory 写入**（对话结束时触发，放在 `waitUntil`）  
   - 用 LLM 从 `fullText + toolCalls` 中提取 3-5 条结构化事实：
     ```typescript
     interface MemoryFact {
       type: 'operation' | 'preference' | 'path' | 'file_ref';
       summary: string;  // 一句话，如「用户将设计文件夹归档到 /Archive/2024/Design」
       sessionId: string;
       createdAt: string;
     }
     ```
   - 写入 Vectorize，namespace 用 `memory:{userId}`，区别于文件索引的 `file:{userId}`。
   - D1 同步存一份 `ai_memories` 表（便于管理和清理）：`id, userId, sessionId, type, summary, embeddingId, createdAt`

2. **Memory 召回**（每次对话开始时）  
   - 在 `agentEngine.run()` 里，RAG 检索时并行召回 memory（top-3）。
   - 拼入 system prompt 的末尾（低权重区域），格式：
     ```
     [历史记忆]
     - 用户习惯把设计资产放在 /Projects/Design 文件夹
     - 2024-03 曾整理过下载文件夹，归档规则：按年份+类型
     ```
   - 召回结果置信度低时不注入，避免噪音。

3. **记忆管理接口**  
   - `GET /api/ai/memories`：列出用户记忆条目  
   - `DELETE /api/ai/memories/:id`：删除单条  
   - 前端在 AISettings 页面增加「记忆管理」tab（见优先级三）

---

### 1.3 工具可靠性——Few-shot Examples

**现状问题**  
`TOOL_DEFINITIONS` 只有 `description`，弱模型（非 GPT-4 级）工具选择准确率不稳定。  
参考 OpenClaw/Hermes 的工具定义规范，`examples` 字段对弱模型提升显著。

**改动位置**：`agentTools/types.ts`、所有工具文件（`search.ts`、`fileops.ts` 等）

**实现步骤**

1. **扩展工具 schema，加 `examples` 字段**
   ```typescript
   interface ToolDefinition {
     function: {
       name: string;
       description: string;
       parameters: { ... };
       examples?: Array<{        // 新增
         user_query: string;     // 触发这个工具的典型用户问题
         tool_call: object;      // 对应的参数示例
       }>;
     }
   }
   ```

2. **为高频/易误用工具补充 examples**  
   优先级：`search_files`、`smart_search`、`filter_files`、`draft_and_create_file`、`move_file`  
   每个工具 2-3 个 examples，覆盖典型场景和边界场景。

3. **examples 在 prompt-based 路径中注入**  
   在 `PROMPT_BASED_SYSTEM_PROMPT` 中追加工具调用示例区段（不影响 native 路径）。  
   弱模型走 prompt-based 时能看到示例，选工具准确率预期提升。

---

### 1.4 长任务持久化——Agent 任务队列打通

**现状问题**  
`aiTaskQueue.ts` 已有完整的队列基础设施（D1 进度、背压控制、断点续传），  
但现有 task 类型只有 `index/summary/tags`（文件处理任务），  
对话 Agent 触发的长任务（批量操作、批量重命名等）没有接入队列，靠 SSE 撑着会超时。

**目标行为**  
Agent 决定执行「批量移动 200 个文件」→ 写入任务队列 → SSE 返回任务ID → 前端轮询进度。

**改动位置**：`aiTaskQueue.ts`（扩展类型）、`agentEngine.ts`（触发入队）、`agentTools/fileops.ts`

**实现步骤**

1. **扩展 task 类型**  
   在 `createTaskRecord` 中支持 `agent_batch` 类型，payload 字段存 agent 的操作序列 JSON。

2. **`fileops.ts` 中批量操作工具检测文件数量**  
   超过阈值（如 20 个文件）时，工具不直接执行，而是返回：
   ```typescript
   { status: 'queued', taskId: 'xxx', message: '任务已提交，预计 N 分钟完成' }
   ```

3. **前端 Task Center 展示 agent 发起的任务进度**  
   与现有 aiTasks 展示复用，加 `agent_batch` 类型的进度渲染。

---

## 优先级二：交互体验提升（借鉴 LobeChat / Open WebUI）

### 2.1 工具调用过程可视化增强

**现状问题**  
`ToolCallCard` 展示信息太少：只有工具名 + running/done 状态。  
用户看不懂 Agent 在干什么，缺乏信任感。

**改动位置**：`ToolCallCard.tsx`、`AssistantContent.tsx`

**实现步骤**

1. **`ToolCallCard` 展示关键参数**  
   每个工具有一个「人类可读摘要」映射表：
   ```typescript
   const TOOL_SUMMARIES: Record<string, (args: any) => string> = {
     search_files: (a) => `搜索「${a.query}」`,
     move_file: (a) => `移动文件到 ${a.targetFolderId}`,
     delete_file: (a) => `删除文件`,
     // ...
   };
   ```
   card 显示摘要 + 展开箭头，点击展开看原始 args/result。

2. **执行计划进度条**（配合 1.1 Planning）  
   收到 `plan` chunk 时，在 assistant 消息顶部渲染步骤列表，每步有 pending/running/done 状态图标。  
   参考 Open WebUI 的 agent step 展示。

3. **工具结果内联展示**  
   `search_files` 返回结果时，直接在 card 里渲染文件列表缩略图，不只是「执行完成」。

---

### 2.2 对话上下文增强

**现状问题**  
发消息时只能靠 `contextFolderId` / `contextFileIds` 注入上下文，交互笨重。

**改动位置**：`AIChat.tsx` 输入区域

**实现步骤**

1. **文件拖拽注入**  
   用户从文件列表拖文件到对话框 → 自动填入 `contextFileIds`，消息框显示「附带文件：xxx.pdf」chip。

2. **`@文件` 快捷引用**  
   输入 `@` 触发文件搜索下拉框，选择后注入 fileId 到上下文。  
   参考 LobeChat 的 `@` mention 交互。

3. **对话消息引用**  
   长按/右键某条消息 → 引用到输入框，Agent 可以针对历史消息追问。

---

### 2.3 Reasoning 展示优化

**现状问题**  
`ReasoningSection.tsx` 已有，但折叠/展开体验待优化。

**改动位置**：`ReasoningSection.tsx`、`AssistantContent.tsx`

**实现步骤**

1. 默认折叠，streaming 时自动展开并滚动。
2. 完成后保持折叠，标题显示 reasoning 总字数（「思考了 xxx 字」）。
3. 视觉上与正文区分：左侧竖线 + 半透明背景。

---

## 优先级三：开发效率（工程优化）

### 3.1 工具定义统一规范

**现状问题**  
17 个工具散落在 8 个文件里，定义风格不统一（有的有 description，有的很简略）。  
新增工具时没有 checklist，容易漏字段。

**实现步骤**

1. 制定工具定义模板（name / description / parameters / examples / category）。
2. 统一 audit 现有 17 个工具，补齐缺失字段。
3. `agentTools/index.ts` 加启动校验：缺少必填字段的工具在 dev 环境报警告。

---

### 3.2 Agent 可观测性

**现状问题**  
线上出问题只能看 logger，没有结构化的 agent 执行 trace。

**实现步骤**

1. **每次 `agentEngine.run()` 生成 `traceId`**，写入 `agentResult.meta`。
2. **关键节点打结构化日志**：plan 生成、每轮工具调用、abort、token 消耗。
3. **Admin 后台加「AI 执行日志」页面**：按 session / userId 筛选，展示工具调用链路。  
   数据来源：`aiChatMessages.toolCalls` 字段已有，加 UI 即可。

---

### 3.3 模型降级与熔断

**现状问题**  
模型调用失败时只有 native → prompt-based 一条降级路径，且仅第 0 轮触发。

**实现步骤**

1. **熔断器**：同一 modelId 连续失败 3 次 → 自动标记为不可用，切换备用模型，10 分钟后重试。  
   状态存 KV，key `circuit:{modelId}`。
2. **失败分类**：区分「模型本身错误」和「网络超时」，前者触发熔断，后者直接重试。
3. **Admin 页面展示模型健康状态**（可选，配合 3.2）。

---

## 执行路径建议

```
第一阶段（2-3周）：1.3 工具 examples → 1.1 Planning 层
  └─ 先低风险提升稳定性，再加核心新能力

第二阶段（1-2周）：1.2 跨会话记忆 → 2.1 工具卡片增强
  └─ 记忆写入/召回 + 前端可视化同步推进

第三阶段（持续）：2.2 上下文交互 → 1.4 长任务队列 → 3.x 工程优化
  └─ 交互打磨 + 长任务能力 + 可观测性补齐
```

---

## 不做的事（避免踩坑）

| 方向 | 原因 |
|---|---|
| 集成 LobeChat / Open WebUI | 独立产品，引入会造成双套用户体系和数据库 |
| 迁移到 Vercel AI SDK | Cloudflare Workers 边缘兼容性问题，得不偿失 |
| 引入 LangChain / LlamaIndex | 体积大，不兼容 Workers 环境，且你的 agentEngine 已够用 |
| 多 Agent 协作 | 当前规模下过度设计，Planning 层已能覆盖复杂任务 |
