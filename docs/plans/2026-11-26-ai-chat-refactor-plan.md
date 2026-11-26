# AI 对话模块重构增强计划：从文件助手到多步任务智能助手

> 状态：待评审｜日期：2026-11-26｜范围：`apps/api/src/{agents,lib/ai,routes,db,migrations}` + `apps/web/src/{pages/AIChat.tsx,components/ai,hooks/useOssShelfChat.ts,services/ai.ts}`
> 说明：本文只给方案与判据，不含代码实现。所有"现状"结论来自当前代码与迁移文件的事实核对，行号标在关键证据后。**一切影响行为的阈值都进系统配置，默认值只在配置注册表单处定义一次。**

---

## 实施记录（2026-11-26）

**已完成**
- P0：FTS v2 迁移（122）+ 前缀匹配修复；`completeText`/embedding/rerank 预扣与结算（轮内调用不重复计请求）；AI 路由拒绝 API Key；`generate_summary/generate_tags` 纳入审批；删除 `AgentToolExecutor.execute` 死路径与 `_confirmed` 双轨；工具结果全量 `_untrusted`；删除提示词中的虚假循环防护声明；配置化第一批（8.2 全部 + `estimated_tokens_per_request` + 版本失效 + 静态守卫）。
- P1：`ai_task_runs/steps/events`（123）+ `PlanRuntime`（状态推导、失败重试/死信、审批挂起、续跑）+ `update_plan` 落库 + L1 任务上下文注入 + REST run/resume + 前端失败/待审批「继续执行」。
- P3：`retrievalService` 收敛向量+FTS+RRF；删除固定权重与业务层 LIKE 补漏；阈值/倍数/`rrf_k`/分块/重排模型与超时全部配置化；FTS 熔断改 TTL 半开。
- P4：AIChat 状态收敛到单 reducer（19 个 useState → useReducer）；删除手写 `TOOL_META`，改为 `GET /api/ai-chat/tools` 由后端定义派生；每日 Cron 增加 AI 孤儿清理（file_chunks/ai_task_items/ai_task_*/ai_memories）。文档同步；新增 7 个测试文件（配置守卫、任务状态机、FTS 契约、工具选择、工具目录、孤儿清理、前端 reducer）；P0–P3 阶段本地 28 项冒烟全绿，P4 新增工具目录端点已登录态实测 200（102 工具 / 15 分类）。
- P2（部分）：输入区本地文件上传/拖入，复用文件系统预签名上传并自动加入 @ 引用。
- P5（2026-11-26 前端体验补强）：消息 metadata 贯通（模型名/用量/耗时/引用文件），`ai_chat_messages` 的 `model_used`/`input_tokens`/`output_tokens`/`mentioned_files` 首次落库；会话 `model_id` 改存 `ai_models.id`（原写供应商 key 导致刷新回退）；会话列表工具调用改为累计口径；模型下拉列全部已配置模型并支持搜索、会话内切换写回会话 + 切换时 system 注入「已换模型延续上文」；发送到首 token 之间「模型正在准备回复…」占位气泡；输入框支持粘贴文件；`fallbackTimestamps` 加 200 条上限；对话框每条回复右下角常显模型与 token。

- P6（2026-11-26 第二轮补强）：修「发送后引用文件丢失」——`useChat.sendMessage(message, options)` 的 `options.metadata` 是请求级、不落到消息上，改为 `sendMessage({ text, metadata:{ mentionedFiles } }, { body })`；未建会话也能切换模型（去掉 `disabled={!connected}`，新增 `sessionActive` 提示）；批量引用解析（新增 `POST /api/files/batch-get`，一次最多 100 个 id，`AssistantContent` 统一补名，消除逐条 `filesApi.get`）；token 估算器配置化（`estimateTokens(text, { charsPerToken, cjkTokensPerChar })` 按字符类别分别计数并 clamp，预算经 `ContextBudget.tokenEstimate` 单点下发）；`invalidateAsset(env, fileId, { reason, reindex })` 统一入口（FTS 同步 + 可选重排队索引，改名/摘要/标签/索引共 6 处调用点收敛，动态导入避免 fileService↔aiTaskQueue 模块环）；P2b 落地：迁移 124 `ai_ingest_assets` + `IngestPolicy`（`steps`/`ocr`）+ `POST/GET /api/ai-chat/assets` 与 `/retry`（状态按 `ai_tasks` 派生并回写，失败步骤单独重试，重试次数上限）+ `ai.ingest.max_file_bytes`/`max_attempts` 配置与设置页「上传解析」分类。

**P6 遗留**
- OCR 与页码/行号/区域锚点未实现：`policy.ocr` 只记录意图，接口返回 `ocrSupported:false`，不要当可用开关宣传。
- 资产卡片 UI 未接（接口已可用，前端尚未展示解析状态与重试按钮）。
- 「真实 tokenizer」未接入：仍是可配置估算器，系数只能逼近真实分词，预算裁剪按保守截断兜底。
- `ai.ui.*` 的流式节流/重试提示文案等待消费项仍未逐项对照。

**与计划的偏差（及原因）**
- 未新增 `POST /api/ai-chat/intake` multipart 端点，改为前端复用 `/api/files/upload`。原因：配额、去重、Telegram 分片、文件夹权限都在原链路已实现，另造一套会分叉安全校验；聊天页只需要「上传 + 加入引用」。
- 上传解析不与上传 API 强绑：上传完成后由客户端调 `/api/ai-chat/assets` 登记，避免文件系统链路反向依赖 AI 队列；未登记的旧文件行为不变。

**未完成（下一阶段）**
- P2b 剩余：OCR、页码/行号锚点、资产卡片 UI。
- P3b 剩余：真实 tokenizer（厂商 tokenizer/计数 API）替代估算器。
- P4b 已收口：批量引用解析、`fallbackTimestamps` 上限、`ai.ui.*` 前端消费（超时/长度/推荐语/能力标签）均已完成。


---

## 0. 一句话结论

**当前模块是"会话式文件检索 + 102 个工具调用器"，天花板不是工具数量或通信协议，而是缺一个把"意图 → 持久化任务状态机 → 受控工具执行 → 可恢复结果"串起来的编排内核；重构以"任务状态机 + 单一工具契约 + 统一摄取管线"为三根支柱，并把所有硬编码阈值收编进系统配置（含已生效的 `ai.agent.max_context_tokens`），让行为可在不发布代码的前提下调优。**

为什么是这条路：
- 工具已有 102 个、模型运行时已统一、混合检索骨架已存在——继续堆工具只会放大提示词与审批面（默认模型 `@cf/meta/llama-3.1-8b-instruct` 未校验 `function_calling` 却下发近百工具，`agentTools/index.ts:93`）。
- 传输层已由 SDK 封装，不是瓶颈；真正的限制是 `update_plan` 只渲染不落库（`system.ts:289`，`types.ts:79` 白名单例外），多步执行靠提示词自律（`prompts/agentSystem.ts:9-150`），中断/审批/超限后状态散在 DO 消息、D1 镜像、客户端乐观消息三处。
- 现状已把 `ai.agent.max_context_tokens`、`ai.agent.max_steps`、`ai.tool.max_result_bytes`、`ai.rag.rerank_enabled`、`ai.request.*`、`ai.quota.*` 接入配置（注册表 `aiConfigService.ts:65-83,145-370`，读取点 `OSSShelfAgent.ts:353-357`、`toolAdapter.ts:107`、`vectorIndex.ts:441`）——**这套机制是对的，问题是覆盖范围太小**，十几个同样影响行为的常量还在代码里写死。

---

## 1. 现状事实基线（先对齐，再谈改）

### 1.1 功能框架

| 层 | 现状 | 关键证据 |
|---|---|---|
| 传输 | WS（`CF_AGENT_*` 协议，SDK 定义）+ REST 换票 | `agents/auth.ts:20,61-92`、`index.ts:237-244`、`useOssShelfChat.ts:196-204` |
| 会话 | 每会话一个 DO（`${userId}:${sessionId}`），DO SQLite 存消息，D1 是审计镜像 | `OSSShelfAgent.ts:12-14,133-158`、`auth.ts:57-59` |
| 推理 | `streamText` + `stepCountIs(20)`，system = 主提示词 + 上下文 + 记忆 | `OSSShelfAgent.ts:364,415-424` |
| 工具 | 102 个定义/执行器，写操作 `needsApproval`，结果截断 16KB | `agentTools/index.ts:93-120`、`toolAdapter.ts:45-62,105-128` |
| 模型 | 3 种 provider 统一到 `modelRuntime.ts`，`completeText`/`embedMany` 共用 | `modelRuntime.ts:114-158,385-483` |
| 检索 | Vectorize 向量 + `files_fts` FTS5（表结构冲突）+ LIKE 补漏，三套并存 | `vectorIndex.ts:550-609`、`search.ts:373-400,594-691` |
| 配额 | 原子预扣 `reserveAiQuota` + settle/release，WS 每条消息预扣 | `usage.ts:172-365`、`OSSShelfAgent.ts:313-335` |
| 后端任务 | Queue `ossshelf-ai-tasks`，一消息一文件，`ai_task_items` 幂等 | `index.ts:260-296`、`wrangler.toml:68-79` |
| 配置 | `aiConfig` 表 + 60s TTL 缓存（`WeakMap<Env>`），注册表在 `aiConfigService.ts` | `aiConfigService.ts:65-83,117-139,145-370` |
| 前端 | 单页 `AIChat.tsx` + 7 子组件；状态散在 10+ useState、SDK 内部、5 个 Query key、3 个模块级缓存 | `AIChat.tsx:70-109`、`useOssShelfChat.ts:63,221-269` |

### 1.2 主数据流

```
AIChat.tsx:345 发送(乐观消息)
  → POST /api/ai-chat/ws-ticket 换票(TTL 10min)      aiChatRoutes.ts:38-68 / auth.ts:20
  → WSS /agents/OSSShelfAgent/{userId}:{sessionId}   useOssShelfChat.ts:196-204
  → onConnect 校验身份/DO 绑定                        OSSShelfAgent.ts:133-158
  → onChatMessage:
       reserveAiQuota → resolveModelRuntime ∥ buildAgentTools
       → system(主提示词 + 上下文文件 + 记忆)
       → trimMessagesByBudget(max_context_tokens × ratio) → pruneMessages
       → streamText(tools, stepCountIs(max_steps))      OSSShelfAgent.ts:353-357,415-424
       → onFinish: recordUsage+settle / 镜像 D1 / 记忆提取
  → SDK 分片广播 → useAgentChat → mapUIMessages → MessageBubble
```

### 1.3 上下文管理与配置化现状（重点核对）

**已配置化且生效的部分**（不要重做）：
- `ai.agent.max_context_tokens`（注册 `aiConfigService.ts:68,206`，读取 `OSSShelfAgent.ts:355`，使用 `budget = maxContextTokens × CONTEXT_HISTORY_RATIO` 裁剪历史 `:367-368`）。
- `ai.agent.max_steps`（`:67,196` → `OSSShelfAgent.ts:354` → `stepCountIs(maxSteps)` `:423`）。
- `ai.tool.max_result_bytes`（`:71,236` → `toolAdapter.ts:107`）、`ai.request.max_retries`（`:73,256` → `:356` → `streamText` `:422`）。

**仍硬编码、但直接决定行为的部分**（要收编，见第 8 章）：
- `CONTEXT_HISTORY_RATIO = 0.7`、`MIN_KEEP_MESSAGES = 2`（`OSSShelfAgent.ts:46,48`，用于 `:104,108,367`）——预算的分配比例不可调，等于 `max_context_tokens` 只调了一半。
- `MAX_CONTEXT_FILES = 5`（`:51` → `:254`）、`MEMORY_EXTRACT_INTERVAL = 4`（`:50`）、`maxPersistedMessages = 200`（`:120`）、`chatStreamStallTimeoutMs = 120_000`（`:122`，声明后无其他引用，实际是否生效不明）。
- 票据 TTL 10min 前后端各写一份（`auth.ts:20` vs `useOssShelfChat.ts:59`），前端重连阈值 9s / 乐观消息超时 10s 冲突（`useOssShelfChat.ts:61` vs `AIChat.tsx:37`）。
- 检索阈值：`topK×2/×5/40/50`、`threshold 0.5/0.25`、RRF `k=60`、FTS 最多 8 token、rerank 模型 `@cf/baai/bge-reranker-base`、分块 `1000/128/20`、正文截断 `50000`（`vectorIndex.ts:24-30,311-378,383-446,441,501-511`、`retrieval/fts.ts`）。
- token 估算 `0.25/0.67` 字符比例（`utils.ts:204-210`），是非 tokenizer 的近似。

### 1.4 文件/图片/文档处理现状

- 对话页**不接受本地上传**，明确提示先去文件页上传再 @引用（`Composer.tsx:180-185`）；拖拽 `application/osshelf-file-ids` 全仓无生产者，是死路径。
- 后台处理：上传触发 tags/summary/index（`features.ts:680-828`），摘要按扩展名分四类提示词（`features.ts:30-123`，已配置化），图片描述/标签走视觉模型（`content.ts:466-479`）。
- 解析深度：`readFileContent` 截断 50,000 字符，分块 1000/overlap 128/最多 20 块（`vectorIndex.ts:24-30,501-548`）——**长文档只覆盖约 1/3**，无 OCR/表格/结构化抽取。

### 1.5 工具与任务执行链路现状

```
tool_call → toolAdapter.buildAgentTools(条件注入 4 组 + 6 个只读白名单, 关键词正则硬编码于 toolAdapter.ts:64-103)
  → needsApproval(WRITE_TOOLS 45 个, types.ts:88-151) → 客户端 addToolApprovalResponse
  → executeConfirmed → TOOL_EXECUTOR_MAP(与定义双份维护) → truncateResult
  → SDK 回填 tool part → D1 镜像 toolCalls JSON → 前端 ToolCallCard 展示
```
- 条件注入只看**最后一条用户消息前 500 字符**，多步任务中途需要的工具可能缺席。
- 旧 `AgentToolExecutor.execute`（diff 预览/`pending_confirm`）已成死代码（`agentTools/index.ts:307-448`），但前端 `DiffPreview` 仍在本地复算 diff（`useEditPreview.ts`）——审批预览与真实执行不同源。

---

## 2. 根因诊断（哪些是真瓶颈）

按"不修会导致什么"排序，P0 为必须先除的根因。

| # | 现象（表象） | 根因（要修的点） | 不修的后果 | 级别 |
|---|---|---|---|---|
| R1 | 多步任务半途而废、无法续跑 | `update_plan` 只渲染不持久化；状态散在 DO/D1/客户端三处 | 永远是"问答增强版"，达不到目标 | P0 |
| R2 | 中断/审批后状态不一致 | 工具结果、审批、流续传由 SDK 基类黑盒接管，无自建 checkpoint；D1 镜像失败只记日志 | 不可恢复、审计与事实源分叉 | P0 |
| R3 | 检索时好时坏、FTS 形同虚设 | `070_system.sql:57-83` 与 `110_ai_agents.sql:68-76` 两次定义 `files_fts` 结构不同；110 被 `IF NOT EXISTS` 跳过，运行时查 `file_id` 失败并永久回退 LIKE（`retrieval/fts.ts:16,31,65-67`） | 语义检索退化为文件名模糊匹配 | P0 |
| R4 | 工具"声明了但没执行"/审批可绕过 | `generate_summary`/`generate_tags` 会入队却不在 `WRITE_TOOLS`（`content.ts:649,687` vs `types.ts:88-151`）；`_confirmed` 双轨遗留 | 模型谎报执行、越权写入 | P0 |
| R5 | 配额可绕过 | 轮内 `analyze_image`/`ask_rag_question`/记忆提取追加 `completeText` 只记账不预扣（`content.ts:466`、`ai-enhance.ts:451`、`agentMemory.ts:68`）；ws-ticket 与每消息双计请求数 | 成本失控、`UsageTab` 与配额对不上 | P0 |
| R6 | @引用/拖拽上传不可用 | Composer 拒绝本地文件、拖拽 MIME 无生产者 | "上传即上下文"链路不存在 | P1 |
| R7 | 文档问答覆盖不全 | 50k 截断 + max20 块约 17.5k 字符；无 OCR/表格解析；无分块级来源定位 | 长文档答非所问、引用不可信 | P1 |
| R8 | 提示词注入面 | 普通工具返回（文件名/笔记/摘要）直接进上下文，只有**被截断时**才标 `_untrusted`（`toolAdapter.ts:45-62`） | 恶意文件名/笔记可劫持 Agent | P0 |
| R9 | API Key 可越权调 AI | AI 路由全未挂 `requireApiKeyScope`/`denyApiKeyAuth`（对比 `middleware/auth.ts:171-215`） | 任意 scope Key 可调模型 | P0 |
| R10 | 三套检索策略语义漂移 | RRF(k=60)、固定权重(1.2/0.8)、LIKE 补漏并存，注释写 FTS 回退实为 LIKE（`search.ts:373-400`） | 结果不可解释、无法评估优化 | P1 |
| R11 | 前端状态漂移 | 无对话 store；`MAX_QUERY_LENGTH` 两处定义、10s vs 9s 冲突、`fallbackTimestamps` 只增不删、`TOOL_META` 手工同步 100+ 工具 | 切会话错乱、长对话内存增长、展示漂移 | P2 |
| R12 | 文档与实现口径分裂 | v3.2.0 vs v3.0 vs v2.7.0；SSE 称移除但 README 仍写；工具 95+/100+；视觉调用方式三处矛盾 | 基于文档决策会走错方向 | P1（治理） |
| R13 | 删会话/文件留孤儿 | `file_chunks`/`ai_task_items`/`ai_memories` 无 FK、无 cascade purge | 数据膨胀、跨会话残留向量 | P2 |
| **R14** | **配了但调不动、改了不生效** | **配置注册表只覆盖 20 来项，行为关键常量仍硬编码（第 8 章清单）；跨 isolate 缓存 60s 独立（`aiConfigService.ts:117-139`）；`ai.quota.estimated_tokens_per_request` 在 `usage.ts:167` 被读取却未进 UI 注册表（`SYSTEM_CONFIG_UI_META` `:65-83`）** | **线上调参必须发版；配置页可见项与实际生效项不一致** | **P0** |

**判定**：R1–R5、R8、R9、R14 是升级为任务助手的前置条件；R6/R7 是能力缺口；R10–R13 穿插处理。

---

## 3. 目标架构

### 3.1 设计原则（每条对应一个现状痛点）

1. **plan 是一等公民**：任务计划落 D1，步骤有状态机，模型只决定"下一步"，不负责"记住做到哪"。→ R1/R2
2. **单一工具契约**：一个 `ToolSpec` 同时携带 schema、执行器、副作用分类、所需 scope、前端元数据，由它生成 toolset / `TOOL_META` / 审批策略。→ R4/R11
3. **摄取与对话解耦**：上传是独立 ingest 管线（可排队、可观测、可重试），对话只消费"已解析资产"；上传时携带存储位置/分类/处理策略。→ R6/R7
4. **上下文分层 + 单一预算源**：`ai.agent.max_context_tokens` 是唯一总量开关，各层按注册表中的比例/上限分配，禁止在代码里再写死比例。→ R14
5. **一切阈值配置化**：默认值只在 `aiConfigService` 注册表定义一次；读取统一走 `getAiConfigNumber/String/Boolean/JSON`；新增"配置项—读取点"静态守卫，杜绝配了不读/读了没注册。→ R14
6. **幂等 + 可重放**：写操作带 `idempotencyKey`，事件追加到 `ai_task_events`，可从 checkpoint 重放。→ R2/R5
7. **最小权限**：工具级 ACL + API Key scope + 会话归属三重校验，不可逆操作强确认。→ R8/R9
8. **平台约束优先**：长任务进 Queue/DO alarm，不在单请求里跑；一个 Worker 承载全部流量；DO 实例名与 DO 绑定保持稳定，状态存在 D1 而非依赖 SDK 私有状态。

### 3.2 组件拓扑

```
[Web] AIChat / Composer(上传意图) / ChatSidebar / AI 设置页(配置只读镜像)
   │  REST: sessions, intake(新), plan(新), assets(新), effective-config(新)
   │  WSS : OSSShelfAgent(DO)
   ▼
[Agent DO] onChatMessage 编排器(改造)
   ├─ ContextBuilder(新)       L0-L5 分层 + 从配置读预算/比例/上限
   ├─ PlanRuntime(新)          步骤状态机 + checkpoint + 重放
   ├─ ToolRegistry(改造)       单一 ToolSpec → toolset / 元数据 / 权限
   ├─ ApprovalGate(改造)       统一写操作确认 + diff 服务端同源
   └─ modelRuntime(保持唯一入口)
   ▼
[D1] ai_task_runs / ai_task_steps / ai_task_events / ai_ingest_assets(新)
     ai_chat_sessions / ai_chat_messages(审计镜像,保留)
     ai_usage_events / ai_quota_counters / ai_config(保留,扩展注册项)
[Queue] ossshelf-ai-tasks 扩展消息类型: ingest / parse / plan-step
[Vectorize] file:{userId} + memory:{userId}（namespace 不变）
```

---

## 4. 链路优化（改什么、为什么）

### 4.1 主对话链路（目标态）

```
发送 → 意图预分类(规则优先, 模型可选且不额外计费)
  → 多步任务: 创建/复用 TaskRun，生成 TaskStep[] 落 D1（原子）
  → 每步: ContextBuilder 按步骤裁剪(预算读 ai.agent.max_context_tokens)
       → modelRuntime.streamText(受控工具子集)
       → ToolRegistry.execute(幂等键 + scope 校验) → 写 TaskEvent
       → 需审批: 挂起步骤, 推送 approval-requested, 回应后续跑
       → 失败: 按配置 retry/dead-letter, 写 TaskEvent, 不静默吞
  → 完成: 汇总 steps → 答复 + 来源引用 → settle 配额 → 镜像 D1
```

**为什么**：把"模型一轮里连续调用 N 个工具"改成"模型每次决定一步，编排器推进状态机"，才能在步数上限、审批、断线、DO 回收后准确续跑；每步可独立计费、审计、回滚。

### 4.2 工具执行

- 用 `ToolSpec` 生成 AI SDK toolset（改造 `toolAdapter.ts:105-128`），清理 `agentTools/index.ts:307-448` 的旧 `execute` 路径与 `_confirmed` 双轨（schema 层剥离保留一个版本做兼容）。
- 条件注入从"最后一条消息关键词"改为"任务步骤声明的 requiredTools ∪ query 命中组"；命中规则、只读白名单、注入上限从代码搬进配置 `ai.tool.conditional_groups`（json）。
- 审批 diff 服务端同源：把 diff 计算从 `useEditPreview.ts` 移到工具执行器，审批 payload 带服务端 diff 预览，前端只渲染。
- 默认模型校验 `function_calling`；不支持时降级为"单次问答 + 明确工具清单"而非下发近百工具（能力字段已在 `modelCatalog.ts:66-74`）。

### 4.3 检索统一

- **先修 R3**：新建迁移（下一编号 122，以执行时 `ls apps/api/migrations` 为准）以 `files_fts_v2` 重建 FTS5，统一列名为 `file_id`，停用 070 的旧触发器；验证通过后再切换 `retrieval/fts.ts` 查询目标。不 drop 旧表，保留回退路径。
- 三套策略收敛为 `RetrievalService`：向量召回 → FTS5 关键词召回 → RRF 融合 → 可选 rerank；删除 `search.ts:594-691` 固定权重与 `:373-400` LIKE 补漏（LIKE 仅作为 FTS 熔断时的降级，集中一处）。
- FTS 熔断从永久 `WeakSet`（`retrieval/fts.ts:16`）改为带 TTL 的半开探测，TTL 走配置。
- 所有阈值参数化（见第 8 章）；rerank 模型不再硬编码。
- 元数据变更（重命名/移动/加签/编辑/迁移桶）统一走 `invalidateAsset(fileId)` 重索引（现状只同步 FTS，`fileService.ts:443`）。

### 4.4 配额与记账单点

- 所有模型调用（含工具内二次调用、记忆抽取、embedding、rerank、test）统一经 `modelRuntime.withMeter()`：调用前预扣、调用后按真实 usage settle；`completeTextWithConfig(record:false)` 改为由包裹层统一记账。→ R5
- 请求数只在 `onChatMessage` 计一次；ws-ticket 签发只做限流不计费。
- 每步 TaskStep 记录 `budgetUsed`；任务级预算耗尽时优雅停止并给出已完成摘要，而非中途崩掉。预算上限走配置。

---

## 5. 必要重构范围（文件级）

> 原则：只增迁移不改历史迁移；DO 绑定与实例命名保持稳定；状态 Ownership 从 SDK 私有状态迁到 D1，不依赖 SDK 内部实现细节。

| 范围 | 文件 | 动作 |
|---|---|---|
| 编排内核 | `apps/api/src/agents/OSSShelfAgent.ts` | 大改：`onChatMessage` 拆出 `PlanRuntime`/`ContextBuilder`；配置读取集中到一处，删除散落的默认值字面量 |
| 编排内核 | `apps/api/src/lib/ai/{planRuntime,taskEvents,contextBuilder}.ts`（新） | 新建：步骤状态机、checkpoint、事件追加、分层上下文 |
| 工具契约 | `apps/api/src/lib/ai/toolAdapter.ts`、`agentTools/{index,types}.ts` | 大改：ToolSpec 单一来源；删旧 execute 路径与 `_confirmed` 双轨 |
| 工具元数据 | `apps/api/src/lib/ai/agentTools/toolSpec.ts`（新） | 新建：schema+执行+副作用+scope+renderer 聚合，派生前端 `TOOL_META` |
| 检索 | `apps/api/src/lib/ai/{vectorIndex,retrievalService}.ts`、`retrieval/fts.ts`、`agentTools/search.ts` | 中改：统一 RetrievalService；修 FTS 降级；删重复策略；阈值全配置化 |
| 提示词 | `apps/api/src/lib/ai/prompts/agentSystem.ts` | 中改：删除无实现的循环防护声明，改为步骤化输出约束 + 结构化计划协议 |
| 记账 | `apps/api/src/lib/ai/{usage,modelRuntime,agentMemory}.ts` | 中改：`withMeter()` 单点；移除调用方手工记账 |
| **配置** | **`apps/api/src/lib/ai/aiConfigService.ts`** | **扩展注册表达十几个新 key + UI 元数据；补 `estimated_tokens_per_request`；增加配置变更版本号与失效广播；增加"配置项—读取点"守卫** |
| **配置** | **`apps/api/src/routes/aiConfigRoutes.ts`** | **新增 `GET /api/ai-config/effective`（非管理员可读白名单），供前端取超时/上限/推荐语等；`GET /system-config` 保持管理员** |
| 路由 | `apps/api/src/routes/aiChatRoutes.ts` | 中改：补 API Key scope；新增 plan/runs、intake、assets 端点 |
| 路由 | `apps/api/src/index.ts` | 小改：登记新子应用；确认新顶层前缀写入 `run_worker_first`（AGENTS.md 3.1） |
| 数据 | `apps/api/migrations/122_*.sql`（新）、`src/db/schema.ts` | 新增表；FTS v2 重建；孤儿清理索引 |
| 前端 | `apps/web/src/pages/AIChat.tsx` | 大改：状态收敛到单 reducer/context；计划进度接服务端 TaskRun；上传意图入口；超时/上限读 `effective-config` |
| 前端 | `apps/web/src/components/ai/chat/{Composer,ToolCallCard,AssistantContent}.tsx` | 中改：本地上传 + 存储/分类/策略表单；diff 服务端同源；引用批量解析 |
| 前端 | `apps/web/src/hooks/useOssShelfChat.ts`、`apps/web/src/services/ai.ts` | 中改：ticket TTL 由后端下发；统一超时；新端点封装；错误结构化 |
| 前端 | `apps/web/src/components/ai/chat/{toolMeta.tsx,agentMessages.ts}` | 中改：`TOOL_META` 由 ToolSpec 生成，删手写 100+ 映射 |
| 文档 | `docs/AI_FEATURES.md`、`docs/API_AI.md`、`docs/architecture.md` | 收尾：统一版本口径、补配置项说明与新增 API |

**保持稳定的接口**：DO 绑定与实例名、Vectorize namespace、`run_worker_first` 既有前缀、错误码 `.code` 约定、模型调用唯一入口 `modelRuntime`。这些是平台/CI 硬约束，改动需单独立项评估，不属于本计划的能力重构。

---

## 6. 上传文件/图片/文档的识别与解析增强

### 6.1 目标：上传即可用（ingest 管线）

```
POST /api/ai-chat/intake (multipart, 单个或批量)
  → 落 R2 + files 行（沿用 bucketResolver，不硬编码桶）
  → 创建 IngestAsset(带 policy + 幂等键) → 入 Queue(ingest)
  → ingest: 类型路由 → 解析 → 分块 → 摘要/标签/向量 → 更新 asset.parseStatus
  → 写 TaskEvent + 推送通知 → 对话中可 @引用(带来源锚点)
```

### 6.2 上传时指定存储位置 / 分类 / 后续处理策略

- **UI**：Composer 上传前弹轻量表单（`AppDialog` / 移动端 `MobileDialog`）——目标文件夹、存储桶、分类/标签、处理策略勾选（摘要/标签/索引/OCR/结构化抽取/完成通知）。
- **契约**：序列化为 `IngestPolicy` 随上传提交，落 `IngestAsset`；策略可通过工具修改后以同一幂等键重新入队。
- **为什么**：现状必须先上传再 @引用再审批纠偏；把意图前置到上传点，减少一轮交互并让解析一次到位。

### 6.3 解析能力矩阵

| 类型 | 现状 | 增强 | 失败处理 |
|---|---|---|---|
| 文本/代码/Markdown/CSV | 50k 截断 + 20 块 | 全量分块（窗口/重叠/上限均配置化），按标题/段落切分，保留行号锚点 | 逐块状态，单块失败不影响全文件 |
| PDF/Word/PPT | 仅文本层 | 抽文本层 → 为空自动 OCR；表格转 Markdown；页码锚点 | OCR 失败标 `parseStatus=partial`，允许重试 |
| 图片 | `analyze_image` 视觉问答 | 上传即生成描述+标签+OCR；多图批量；超限明确报错 | 视觉超时走 `ai.request.vision_timeout_ms`，失败入死信 |
| 音视频 | 无 | 先做元信息 + 转写接口占位；是否接转写模型按成本与需求排期（见第 11 章） | 明确告知暂不支持，不静默吞 |

- 解析统一走 `modelRuntime`；embedding 模型变更时按 `embeddingModel` 过滤查询（现状不过滤，`vectorIndex.ts:208-217,329-349`）。
- 每块写 `file_chunks` 带 `sourceAnchor`（页码/行号/时间），引用可定位片段。

---

## 7. 上下文与任务编排

### 7.1 ContextBuilder（分层预算，总量唯一来自 `ai.agent.max_context_tokens`）

| 层 | 内容 | 预算来源（全部为系统配置） |
|---|---|---|
| L0 固定 | AGENT_SYSTEM_PROMPT（删除虚假循环防护声明） | 固定，不计动态预算 |
| L1 任务状态 | 目标、已完成/待执行步骤、约束 | `ai.agent.task_state_ratio`（新，默认 0.1），高优先级不裁 |
| L2 已解析资产 | 上传意图 + 摘要 + 关键片段 | `ai.agent.context_asset_ratio`（新，默认 0.15） |
| L3 检索片段 | RetrievalService topK + 来源 | `ai.rag.context_top_k`（新，默认 5） |
| L4 历史消息 | DO SQLite | `max_context_tokens × ai.agent.context_history_ratio`（替代硬编码 0.7），至少留 `ai.agent.min_keep_messages` 条（替代硬编码 2） |
| L5 工具结果 | 截断 + `<untrusted>` 包裹 | `ai.tool.max_result_bytes`（已有）；**所有**结果都包裹，不只截断时 |

- 引用文件上限 `MAX_CONTEXT_FILES=5`（`:51,254`）改为 `ai.agent.max_context_files`；前端 @ 引用上限随之统一。
- token 估算从字符比例（`utils.ts:204-210`）升级为：优先用模型 tokenizer/计数 API，不可用时保留近似但配置化系数，并在 UI 显示估算误差提示。

### 7.2 PlanRuntime（状态机）

```
running ──step_done──> running
  ├──approval_needed──> awaiting_approval ──approved──> running
  │                                     └──denied────> failed(可恢复)
  ├──budget_exhausted──> failed(给出已完成摘要)
  └──all_steps_done────> succeeded
```
- 每步落 `TaskStep` + `TaskEvent`；DO 回收/断线后从 `TaskRun.currentStepId` 续跑。
- 结构化计划协议：模型输出 `{goal, steps:[{toolName,input,dependsOn}]}`，用 JSON schema 约束，替代自由文本 `update_plan`。
- 每步超时/失败上限可配置：`ai.task.step_timeout_ms`（新）、`ai.task.max_retries`（新）、步数复用 `ai.agent.max_steps`；连续失败进 dead-letter 并通知用户。

### 7.3 与 SDK 的边界

- 保留 SDK 做消息传输与流式渲染；新增 `data-task-update` 数据块下发任务状态。
- 任务状态单独走 REST `GET /api/ai-chat/runs/:id`，不塞进消息历史。
- SDK 私有状态只做传输层恢复；**任务事实源在 D1**，SDK 升级或行为变化不影响任务续跑。

---

## 8. 系统配置化清单（本次核心要求）

**统一规则**：默认值和 UI 元数据只在 `aiConfigService.ts` 的 `defaultConfigs` + `SYSTEM_CONFIG_UI_META` 定义；业务代码只调用 `getAiConfigNumber/String/Boolean/JSON(env, key, fallback)`，fallback 只能引用同一注册表的常量，不得再写字面量。新增静态守卫：扫描 `ai.agent.* / ai.task.* / ai.rag.* / ai.tool.* / ai.ui.*` 的注册项，要求每项至少有一个读取点，每个读取点的 key 都已注册。

### 8.1 现有项补齐

| key | 现状 | 处理 |
|---|---|---|
| `ai.agent.max_context_tokens` | 已注册已生效 | 保留，作为上下文总量唯一来源；UI 说明补"含历史/资产/工具结果的分配" |
| `ai.agent.max_steps` | 已注册已生效 | 保留，同时作为 TaskRun 步数上限 |
| `ai.quota.estimated_tokens_per_request` | `usage.ts:167` 读取但 UI 未注册 | 补 `SYSTEM_CONFIG_UI_META` + `defaultConfigs`，纳入配置页 |

### 8.2 新增配置项（Agent / 上下文）

| key | 默认值 | 替代的硬编码 |
|---|---|---|
| `ai.agent.context_history_ratio` | 0.7 | `CONTEXT_HISTORY_RATIO`（`OSSShelfAgent.ts:46`） |
| `ai.agent.min_keep_messages` | 2 | `MIN_KEEP_MESSAGES`（`:48`） |
| `ai.agent.max_context_files` | 5 | `MAX_CONTEXT_FILES`（`:51`）+ 前端 @ 上限 8 统一 |
| `ai.agent.memory_extract_interval` | 4 | `MEMORY_EXTRACT_INTERVAL`（`:50`） |
| `ai.agent.max_persisted_messages` | 200 | `maxPersistedMessages`（`:120`） |
| `ai.agent.stream_stall_timeout_ms` | 120000 | `chatStreamStallTimeoutMs`（`:122`），并验证确实传给 SDK |
| `ai.agent.ticket_ttl_ms` | 600000 | `auth.ts:20` + 前端 `useOssShelfChat.ts:59`，单点下发 |
| `ai.agent.task_state_ratio` | 0.1 | L1 层新预算 |
| `ai.agent.context_asset_ratio` | 0.15 | L2 层新预算 |

### 8.3 新增配置项（检索 / 摄取）

| key | 默认值 | 替代的硬编码 |
|---|---|---|
| `ai.rag.rrf_k` | 60 | RRF 融合常数（`vectorIndex.ts:550-567`） |
| `ai.rag.vector_threshold` | 0.5 | `:311-378` |
| `ai.rag.chunk_threshold` | 0.25 | `:383-446` |
| `ai.rag.top_k_multiplier` | 5 | `topK×5/50` |
| `ai.rag.fts_max_tokens` | 8 | `retrieval/fts.ts` 的 MATCH token 上限 |
| `ai.rag.rerank_model` | `@cf/baai/bge-reranker-base` | `:441` |
| `ai.rag.rerank_timeout_ms` | 10000 | 新增（现状无超时） |
| `ai.rag.chunk_overlap` | 128 | `:24-30` |
| `ai.rag.max_chunks` | 20 | `:24-30` |
| `ai.rag.max_source_chars` | 50000 | `:501-511` |
| `ai.rag.fts_circuit_ttl_ms` | 60000 | 替换永久 WeakSet 熔断 |
| `ai.ingest.ocr_enabled` | true | 新增开关 |
| `ai.ingest.max_file_bytes` | 52428800 | 新增上限 |
| `ai.ingest.parse_timeout_ms` | 120000 | 新增超时 |

### 8.4 新增配置项（任务 / 工具 / 前端）

| key | 默认值 | 替代的硬编码 |
|---|---|---|
| `ai.task.step_timeout_ms` | 60000 | 新增 |
| `ai.task.max_retries` | 3 | 新增 |
| `ai.task.dead_letter_after` | 10 | 审计记录的连续错误阈值 |
| `ai.task.approval_required_level` | `write` | 审批分级（`write`/`irreversible`） |
| `ai.tool.conditional_groups` | json | `toolAdapter.ts:64-103` 关键词正则/分组/白名单 |
| `ai.tool.max_tool_definitions` | 60 | 每步下发工具上限。实施时测得条件注入后候选约 70 个，40 会按定义顺序把写工具挤掉；60 只裁尾部且写工具优先保留 |
| `ai.model.anthropic_thinking_budget` | 1024 | `modelRuntime.ts:197-200` |
| `ai.ui.connect_timeout_ms` | 10000 | `AIChat.tsx:37` |
| `ai.ui.identity_wait_ms` | 9000 | `useOssShelfChat.ts:61` |
| `ai.ui.max_query_length` | 15000 | `AIChat.tsx:35` + `Composer.tsx:54` |
| `ai.ui.suggestions` | json | `AIChat.tsx:39-48` 推荐语 |
| `ai.ui.capability_tags` | json | `WelcomeScreen.tsx:13` |

### 8.5 配置生效机制（否则"配了不生效"）

- `aiConfigService.ts:117-139` 的 60s TTL `WeakMap<Env>` 按 isolate 独立，改配置后最多 60s 不一致。方案：配置写入时递增 `ai_config_version`（KV 或 D1 单行），读取时把版本纳入缓存键；前缀一致即失效，保持现有 TTL 作为兜底。
- 前端只通过 `GET /api/ai-config/effective`（非管理员可读白名单）获取超时/上限/推荐语，敏感项（密钥、供应商）不下发。
- 配置变更写审计日志；`aiConfigRoutes` 的写操作保持 `requireAdmin`（现状 `aiConfigRoutes.ts:1166,1182,1228`），并修复审计 P0-06（全局配置无管理员校验的历史问题需确认已修）。
- 验收：任意上述 key 在 UI 改值后，≤5s 内新请求生效（含新一轮 Agent 对话）；静态守卫零违规。

---

## 9. 错误处理（分级 + 降级 + 幂等）

| 层级 | 错误类型 | 策略 | 用户可见 |
|---|---|---|---|
| 传输 | 票据过期/WS 断连 | 自动换票重连（超时值来自配置，前后端同源）；失败保留乐观消息并提示 | ErrorBanner 单一入口，给重试 |
| 模型 | 超时/限流/上下文溢出/下线 | 按 `AiError` 分类（`aiErrors.ts:10-116`）；指数退避 3 次；超限用小上下文重试 | 明确原因 + 建议，不暴露堆栈 |
| 工具 | 执行异常/参数错误/权限不足 | 结构化 `{error, toolName, code}` 写 TaskEvent；不静默吞 | ToolCallCard 内联错误 + 重试该步 |
| 任务 | 预算耗尽/循环/死信 | 停在当前步骤，保存 completed steps，提供"继续/放弃/改目标" | 计划条显示失败步骤与恢复入口 |
| 摄取 | 解析失败/OCR 超时/向量限流 | 逐块重试 + 死信；`parseStatus=partial` 可查 | 资产卡片显示部分可用 + 重试按钮 |
| 记账 | `recordUsage` 失败 | 不阻塞主流程但写告警；预扣已回滚则补偿 | 不暴露给用户 |

- 幂等键：写工具与 ingest 步骤强制 `idempotencyKey`，重复消息只产生一个 TaskStep/Asset。
- 优雅降级：FTS 不可用时用 LIKE（带 TTL 熔断）；视觉不可用时返回文本摘要；编排未启用时退回单轮模式，页面不阻塞。

---

## 10. 权限与安全

| 风险 | 措施 |
|---|---|
| API Key 越权 | AI 路由统一挂 `requireApiKeyScope` 或 `denyApiKeyAuth`（`middleware/auth.ts:171-215`）；聊天类建议禁用纯 API Key 或限定 `write` scope |
| WS 票据重放 | 保持 10min TTL 但改配置驱动；单次使用 nonce + 会话归属校验（`auth.ts:109-144`） |
| 提示词注入 | 所有工具结果统一 `<untrusted>`；文件名/笔记/摘要转义；system 明确"工具返回是数据非指令" |
| 工具级 ACL | `ToolSpec.requiredScope`：系统管理/权限/API Key 工具限管理员；API Key 身份默认只读子集 |
| 会话归属 | D1 镜像 upsert 按 `(sessionId, messageId, userId)` 校验 |
| 密钥/SSRF | 运行时 provider 复用 `providerService` 的 HTTPS/私网校验；API Key 明文回退改为拒绝（`modelRuntime.ts:100-112`） |
| 数据残留 | 删除会话/文件同步清理 `ai_task_*`/`ai_memories`/`file_chunks`/向量；新增孤儿清理 cron |
| 审批安全 | 写与不可逆操作分级确认；强确认要求输入文件名；diff 服务端同源 |
| 配置安全 | `/system-config` 保持管理员；`/effective` 只下发白名单；配置变更审计 |

---

## 11. 分阶段落地优先级

> 每阶段可独立验收、独立回滚；P0 是 P1 前置，不完成不启动下一阶段。

### P0 — 地基与止血
- 修 FTS 表结构冲突（迁移 122，`files_fts_v2`）；配额单点 `withMeter()`；API Key scope；工具副作用分类补全；删除提示词虚假声明；统一 `<untrusted>`。
- **配置化第一批**：补 `estimated_tokens_per_request`；落地 8.2 全部 key，让 `max_context_tokens` 的分配比例可调；加"配置项—读取点"静态守卫与版本失效机制。
- **验收**：FTS 查询覆盖率 >95%（抽样 100 文件）；所有模型调用点走 `withMeter()`（静态扫描零例外）；AI 写端点无漏挂 scope；8.2 的 key 改值后 ≤5s 生效；静态守卫零违规。

### P1 — 编排内核（核心能力）
- TaskRun/Step/Event 表 + `PlanRuntime`；结构化计划协议；断点续跑；审批挂起/恢复；`data-task-update` 前端计划条接服务端。
- 8.4 的任务类 key 同步落地。
- **验收**：5 步任务（搜索→读文件→改文件→打标签→生成分享链接）中断 3 次、审批 2 次后准确续跑完成；D1 事件序列与终态一致；步数上限触发给已完成摘要而非崩溃。

### P2 — 上传即上下文（能力缺口）
- Composer 本地上传 + 存储/分类/策略表单；ingest 队列管线；资产卡片；@引用带来源锚点；修拖拽死路径。
- 8.3 摄取类 key 同步落地。
- **验收**：上传 1 个 PDF + 2 张图片并指定策略，可在同会话引用且答案带页码/区域来源；解析失败可见可重试；刷新后资产状态保持；上传策略改配置后可重新处理。

### P3 — 检索与上下文统一（质量提升）
- RetrievalService 统一；L0–L5 分层上下文 + 真实 tokenizer；元数据变更统一重索引；rerank 可配置 + 超时。
- 8.3 检索类 key 全部落地。
- **验收**：长文档（>50k 字符）问答覆盖率对比基线提升；三套策略收敛为一套；重命名/移动后无旧路径残留；`max_context_tokens` 调整后历史/资产/检索比例按配置变化。

### P4 — 工程债、体验与文档（收尾）
- 前端状态收敛（单 reducer/context、删手写 `TOOL_META`、批量引用解析、有界缓存）；孤儿清理 cron；8.4 前端类 key；文档口径统一；测试补齐。
- **验收**：`pnpm typecheck`/`pnpm test`/`pnpm audit:gate`/`pnpm build:web` 全绿；web 测试覆盖对话主链路；文档与实现无已知矛盾。

---

## 12. 持续增强清单（按需求和成本排期，不是禁区）

下列能力在当前版本未落地，但**不设"不做"边界**；触发条件满足就排期实施：

| 能力 | 现状 | 排期触发条件 | 所属阶段 |
|---|---|---|---|
| 传输层升级/替换 SDK | 依赖 `@cloudflare/ai-chat` 私有协议 | 编排层抽稳定接口后；或 SDK 阻塞多步任务恢复 | P1 后评估 |
| 音视频转写接入 | 元信息与占位 | 有明确需求且 token 成本可接受 | 需求驱动 |
| 生图/语音输出 | 模型目录已过滤这些类型 | 产品需要且成本/合规评估通过 | 需求驱动 |
| 工具数量继续增长 | 102 个 | ToolSpec 契约稳定、步级下发生效后，增长不再放大提示词 | P1 后 |
| 会话过期与归档 | 无时间过期逻辑 | 存储/合规要求触发 | 独立小项 |
| 配置灰度/按用户覆盖 | 全局配置 + 功能级模型配置 | 需要按租户调参时 | 配置机制稳定后 |
| 成本归因到任务/租户 | 有价格元数据未使用 | 用量页需要成本视图时 | P1 后 |

**踩过的坑要避免**：DO 绑定与实例命名变更、迁移历史改写、CI/远程迁移流程改动——这些是平台与发布约束，需单独立项和灰度评估，不是能力上的禁区。

---

## 13. 风险与验收标准

### 13.1 主要风险

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| SDK 私有状态变化 | `@cloudflare/ai-chat` 升级改变恢复行为 | 任务事实源在 D1，不依赖 SDK 状态；锁版本；升级前跑续跑测试 |
| FTS 迁移破坏检索 | 122 迁移在存量库失败 | 先 `pnpm db:migrate:local`；保留 LIKE 降级；建 v2 表不 drop 旧表 |
| 配置改动不生效 | isolate 缓存 60s | 版本号纳入缓存键 + ≤5s 生效验收 |
| 配置项泛滥 | 新增 40+ key 无治理 | 静态守卫（有注册无读取 / 有读取无注册均报错）；UI 分组折叠高级项 |
| Queue 重投重复执行 | 消费者无幂等 | 强制 `idempotencyKey` + TaskStep 唯一约束 |
| 工具契约重构回归 | 102 工具双份维护漂移 | `validateToolDefinitions` 扩展为校验 ToolSpec 五要素；契约测试先行 |
| 前端状态大改回归 | 切会话/流式/审批错乱 | P1 接服务端计划、P4 再收敛状态；每阶段手测脚本 |
| 成本上升 | 规划与结构化输出增加 token | 规则优先预分类；步级工具子集；`ai.task.*` 预算上限；按任务归因 |

### 13.2 全局验收标准（最终态）

1. **多步任务**：独立完成 ≥3 类跨工具任务（整理文件并打标、检索+摘要+生成分享、批量处理并汇报），中断/审批后续跑，结果可审计。
2. **上传即上下文**：对话内上传文件/图片/文档，指定存储位置/分类/处理策略；解析完成前不阻塞，完成后可引用并带来源锚点。
3. **配置化**：第 8 章全部 key 在配置页可见可改；改值 ≤5s 生效；静态守卫零违规；无行为关键常量残留在代码里（`max_context_tokens` 及其分配比例必须来自配置）。
4. **一致性**：D1 TaskRun/Step/Event 与 DO 消息、客户端展示三方一致；审计无孤儿；配额与用量可对账。
5. **安全**：AI 写端点全有 scope 校验；工具结果不可信标记全覆盖；API Key 不越权；无提示词注入成功用例。
6. **质量门禁**：`pnpm typecheck`/`pnpm test`/`pnpm audit:gate`/`pnpm build:web` 全绿；新增迁移通过本地验证；文档与实现无已知矛盾。

---

### 来源与置信度

- 代码事实：`apps/api/src/agents/{OSSShelfAgent,auth}.ts`；`apps/api/src/lib/ai/**`（45 文件，含 `aiConfigService.ts:65-83,117-139,145-370`、`modelRuntime.ts:100-112,197-200,296-301`、`vectorIndex.ts:24-30,311-446,501-548`、`toolAdapter.ts:45-128`、`usage.ts:146-170`）；`apps/api/src/routes/{ai,aiChatRoutes,aiConfigRoutes,aiUsageRoutes}.ts`；`apps/web/src/{pages/AIChat.tsx,components/ai/**,hooks/useOssShelfChat.ts,services/ai.ts}`；`apps/api/migrations/{070,110,091,115,120,121}_*.sql`；`apps/api/src/db/schema.ts`；`apps/api/wrangler.toml`；`apps/api/src/index.ts`。
- 审计/已知问题：`docs/audits/2026-11-09-full-audit.md`、`docs/plans/2026-11-23-comprehensive-audit-and-upgrade-plan.md`。
- 文档口径：`docs/AI_FEATURES.md`（v3.2.0）、`docs/API_AI.md`（v3.0）、`docs/architecture.md`、`README.md`、`AGENTS.md`。
- 置信度：现状与行号为高（代码直读）；`maxPersistedMessages`/`chatStreamStallTimeoutMs` 是否被 SDK 消费无法从本仓库确认（仅见声明）；远程迁移与本地是否一致未做运行时验证，FTS 方案需本地验证后推广。
