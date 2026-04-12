# Changelog

All notable changes to this project will be documented in this file.

## [v4.5.0] - 2026-04-12

### Added - AI 模型库大幅扩展与引擎优化 🚀

**核心功能 - AI 模型库扩展（80+ 模型）**

- **模型库大幅扩展**
  - 从 16 个厂商约 50 个模型扩展到 **80+ 个模型**
  - 覆盖 2025 年最新推理模型、视觉多模态模型、长上下文模型
  - 新增多个主流厂商的最新旗舰模型

- **新增 OpenAI 模型**
  - `o3 Mini`：轻量级推理模型，支持 function calling
  - `GPT-5`：最新旗舰模型，支持推理和视觉

- **新增 Anthropic Claude 模型**
  - `Claude Sonnet 4`：新一代平衡模型，支持 extended thinking
  - `Claude Opus 4.1`：最强大的推理模型，支持 budget_tokens 配置

- **新增 Google Gemini 模型**
  - `Gemini 2.5 Pro`：支持 thinking_level 配置
  - `Gemini 3`：最新一代，200 万 token 上下文

- **新增百度文心一言模型**
  - `ERNIE X1 (深度思考)`：32K 上下文，支持视觉和推理
  - `ERNIE 4.5 Turbo`：128K 上下文，支持视觉

- **新增阿里通义千问模型**
  - `QwQ 32B (推理模型)`：支持 thinking_budget 配置
  - `Qwen3 235B`：256K 上下文，支持推理和视觉

- **新增字节火山引擎模型**
  - `豆包 Seed 1.6 (深度思考)`：支持 reasoning_effort 配置
  - `豆包 Seed 2.0 Pro`：128K 输出，支持深度思考

- **新增 MiniMax 模型**
  - `MiniMax M1 (推理模型)`
  - `MiniMax M2.5`：192K 输出
  - `MiniMax M2.7`：204K 上下文，131K 输出

- **新增月之暗面 Kimi 模型**
  - `Kimi K2 Thinking`：支持 thinking 配置
  - `Kimi K2.5`：支持视觉和思考

- **新增智谱 GLM 模型**
  - `GLM-5`：200K 上下文，最新旗舰推理模型

- **新增 xAI Grok 模型**
  - `Grok 4` / `Grok 4.1`：标准模型
  - `Grok 4 Thinking` / `Grok 4.1 Thinking`：深度思考模型

- **新增 OpenRouter 模型**
  - `Claude Sonnet 4 (via OpenRouter)`
  - `Claude Opus 4 (via OpenRouter)`
  - `o1 Preview (via OpenRouter)`
  - `Gemini 2.5 Pro Preview (via OpenRouter)`
  - `DeepSeek R1 (via OpenRouter)`

**Agent 引擎增强**

- **上下文 Token 预算管理**
  - 新增 `ai.agent.max_context_tokens` 配置项（默认 100000）
  - 支持动态裁剪历史消息，避免超出上下文限制
  - 智能 Token 估算算法（中文 0.67 tokens/char，英文 0.25 tokens/char）

- **降级机制改进**
  - Native Function Calling → Prompt-Based Fallback 容错性更强
  - 第一轮无工具调用时自动注入强制提示重试
  - 最大降级重试次数限制（防止无限循环）

- **Token 统计增强**
  - 实时统计 inputTokens 和 outputTokens
  - 返回 AgentRunMeta 元数据供前端展示

**模型网关增强**

- **providerId 关联**
  - 模型可归属到特定提供商（`provider_id` 字段）
  - 支持按提供商筛选和管理模型

- **排序功能**
  - 支持 `sort_order` 字段自定义模型显示顺序
  - 前端按提供商分组并按排序展示

- **只读模式**
  - 新增 `is_readonly` 字段标记只读模型
  - 系统内置模型或特殊模型可标记为不可编辑

- **Thinking 配置完善**
  - 完整解析所有 thinking 相关字段：
    - `supports_thinking`
    - `thinking_param_format` (object/boolean/string)
    - `thinking_param_name`
    - `thinking_enabled_value` / `thinking_disabled_value`
    - `thinking_nested_key`
    - `disable_thinking_for_features`

**API 完善**

- **提供商管理 API 增强**
  - 新增 `POST /api/ai-config/ai-providers/:id/set-default` - 设置默认提供商
  - 提供商支持 `sort_order` 排序字段
  - 提供商支持 `is_active` 激活状态字段

- **模型管理 API 增强**
  - 创建/更新模型支持所有新字段
  - 模型列表返回包含 providerId 和 sortOrder

**数据库变更**

- 无需新的迁移文件（新字段已在 v4.4.0 迁移中预留）

### Changed

- vendorConfig.ts 大幅更新，新增 30+ 个模型定义
- modelGateway.ts 解析逻辑增强，支持所有新字段
- agentEngine.ts 上下文管理和降级机制优化
- aiConfigRoutes.ts API 接口完善
- AI_FEATURES.md 文档更新至 v4.5.0
- API_AI.md 文档更新至 v4.5.0
- README.md 版本号更新至 v4.5.0

### Improved

- 模型选择体验优化：更丰富的预设模型库
- Agent 引擎稳定性提升：更好的错误恢复机制
- Token 使用效率优化：智能裁剪避免浪费

---

## [v4.4.0] - 2026-04-08

### Added - AI 模块全面优化 🚀

**核心功能 - AI 提供商配置**

- **提供商管理功能（ai_providers 表）**
  - 新增 `ai_providers` 表用于管理自定义提供商（OpenAI 兼容 API）
  - 支持 16 个系统内置提供商（国内厂商 + 国际厂商）
  - 每个提供商包含独立的 `thinking_config` 配置用于推理模式
  - 支持用户自定义添加私有提供商

- **系统内置提供商（16 个）**
  - 国内厂商（9 个）：
    - 百度文心一言、腾讯混元、阿里通义千问、字节火山引擎
    - 智谱AI、MiniMax、月之暗面（Kimi）、硅基流动、DeepSeek
  - 国际厂商（7 个）：
    - OpenAI、Anthropic Claude、Google Gemini、Mistral AI
    - xAI Grok、Groq、Perplexity、OpenRouter

- **thinking_config 配置格式**
  - 布尔类型：百度、阿里、硅基流动
  - 对象类型：腾讯、字节、智谱、月之暗面、DeepSeek、Anthropic、xAI
  - 字符串类型：OpenAI、Google

**AI 对话全环节优化**

- **消息记录增强（ai_chat_messages 表）**
  - 新增 `tool_calls` 字段：存储工具调用记录
  - 新增 `reasoning` 字段：存储推理内容
  - 完整记录 Agent 对话过程

- **Agent 上下文管理优化**
  - 新增 `ai.agent.max_context_tokens` 配置项
  - 支持动态裁剪历史消息，避免超出上下文限制
  - 默认最大上下文 Token 数：100000

**模型配置深度优化**

- **模型与提供商关联**
  - `ai_models` 表新增 `provider_id` 字段
  - 模型可归属到特定提供商进行分组展示
  - 支持按提供商筛选和管理模型

- **模型排序功能**
  - `ai_models` 表新增 `sort_order` 字段
  - 支持自定义模型显示顺序
  - 前端按提供商分组展示模型

- **推理模式支持增强**
  - `ai_models` 表新增 `supports_thinking` 字段
  - 新增 `thinking_param_format`、`thinking_param_name` 等字段
  - 支持各提供商独立的推理配置

**移动端适配优化**

- **AI 设置页面响应式优化**
  - 标签页横向滚动优化
  - 模型卡片堆叠排列
  - 操作按钮触控友好
  - 表单布局自适应

**前端改进**

- AISettings.tsx 增强
  - 新增「管理提供商」按钮和模态框
  - 模型按提供商分组展示
  - 显示提供商名称、描述、系统标识
  - 显示每个提供商下的激活模型数量

- ProviderManageModal 组件
  - 提供商列表展示
  - 支持添加自定义提供商
  - 支持编辑和删除提供商

**后端改进**

- aiConfigRoutes.ts 增强
  - 新增 GET /api/ai-config/providers - 获取系统内置提供商列表
  - 新增 GET /api/ai-config/ai-providers - 获取所有提供商（含用户自定义）
  - 新增 POST /api/ai-config/ai-providers - 创建自定义提供商
  - 新增 PUT /api/ai-config/ai-providers/:id - 更新提供商
  - 新增 DELETE /api/ai-config/ai-providers/:id - 删除提供商

- modelGateway.ts 增强
  - 支持 provider_id 关联
  - 支持 sort_order 排序
  - parseModelConfig 解析新增字段

**数据库变更**

- 新增迁移文件 `0012_ai_providers.sql`
  - ai_providers 表：AI 提供商管理
  - ai_models 表新增字段：provider_id、sort_order

- 新增迁移文件 `0012_ai_chat_messages_tool_calls.sql`
  - ai_chat_messages 表新增字段：tool_calls、reasoning
  - ai_config 表新增配置项：ai.agent.max_context_tokens

**新文件**

后端：

- 迁移文件：
  - `apps/api/migrations/0012_ai_providers.sql`
  - `apps/api/migrations/0012_ai_chat_messages_tool_calls.sql`

前端：

- `apps/web/src/components/ai/settings/ProviderManageModal.tsx` - 提供商管理模态框

### Changed

- AI_FEATURES.md 文档更新至 v4.4.0
- API_AI.md 文档更新至 v4.4.0
- README.md 版本号更新至 v4.4.0
- architecture.md 架构文档更新，新增提供商管理架构

### Fixed

- 修复模型列表分组展示逻辑
- 优化提供商配置加载性能
- 改进移动端 AI 设置页面布局

---

## [v4.3.0] - 2026-04-08

### Added - AI Agent 全面升级 🚀

**核心架构重构**

- **Agent 引擎全面重构（agentEngine.ts）**
  - 采用 ReAct 架构（Reason → Act → Observe → Reason...）
  - 支持多轮推理和链式工具调用
  - 智能意图识别与工具选择矩阵
  - 视觉意图检测与自动链式调用
  - 循环防护机制（调用签名去重 + 空转检测）
  - 写操作确认机制（敏感操作需用户确认）

- **工具数量大幅扩展（95 个工具）**
  - 从 v4.2.0 的 4 个工具扩展到 95 个
  - 分为 13 个功能模块：
    - 🔍 搜索与发现（7 个）：search_files, filter_files, search_by_tag, search_duplicates, smart_search, get_similar_files, get_file_details
    - 📄 内容理解与分析（7 个）：read_file_text, analyze_image, compare_files, extract_metadata, generate_summary, generate_tags, content_preview
    - 📂 目录导航（7 个）：navigate_path, list_folder, get_recent_files, get_starred_files, get_parent_chain, get_folder_tree, get_storage_overview
    - 📊 统计与分析（5 个）：get_storage_stats, get_activity_stats, get_user_quota_info, get_file_type_distribution, get_sharing_stats
    - 📁 文件操作（15 个）：create_text_file, create_code_file, create_file_from_template, edit_file_content, append_to_file, find_and_replace, rename_file, move_file, copy_file, delete_file, restore_file, create_folder, batch_rename, star_file, unstar_file
    - 🏷️ 标签管理（7 个）：add_tag, remove_tag, get_file_tags, list_all_tags_for_management, merge_tags, tag_folder, auto_tag_files
    - 🔗 分享链接（8 个）：create_share_link, list_shares, update_share_settings, revoke_share, get_share_stats, create_direct_link, revoke_direct_link, create_upload_link_for_folder
    - 📜 版本管理（4 个）：get_file_versions, restore_version, compare_versions, set_version_retention
    - 📝 笔记备注（5 个）：add_note, get_notes, update_note, delete_note, search_notes
    - 🔐 权限管理（6 个）：get_file_permissions, grant_permission, revoke_permission, set_folder_access_level, list_user_groups, manage_group_members
    - 💾 存储桶管理（8 个）：get_storage_usage, get_large_files, get_folder_sizes, get_cleanup_suggestions, list_buckets, get_bucket_info, set_default_bucket, migrate_file_to_bucket
    - ⚙️ 系统管理（11 个）：get_system_status, get_help, get_version_info, get_faq, get_user_profile, list_api_keys, create_api_key, revoke_api_key, list_webhooks, create_webhook, get_audit_logs
    - 🤖 AI 增强（5 个）：trigger_ai_summary, trigger_ai_tags, rebuild_vector_index, ask_rag_question, smart_rename_suggest

**智能化提升**

- **意图识别系统**
  - 自动识别搜索类、视觉类、内容理解类、统计类意图
  - 根据意图精准选择工具
  - 搜索关键词提取优化（2-5 个核心词）

- **链式推理规则**
  - 工具结果中的 `_next_actions` 字段驱动下一步行动
  - 图片搜索结果自动触发 analyze_image 链路
  - 视觉意图检测模式匹配（中英文）

- **循环防护机制**
  - 基于调用签名（工具名+参数哈希）去重
  - 基于"有效信息轮"计数的空转检测
  - 单次响应最大 20 次工具调用（可配置）
  - 无上限次数限制替代死板的轮次限制

**写操作确认机制**

- 敏感操作（删除、移动、权限变更等）需用户确认
- 确认请求存储在 `ai_confirm_requests` 表
- 5 分钟有效期，一次性使用
- 前端展示确认卡片，用户点击后执行

**SSE 流式响应增强**

- 新增 `confirm_request` 事件类型
- 工具调用结果包含操作摘要
- 推理内容实时显示

**前端改进**

- ToolCallCard 组件增强
  - 支持确认请求卡片渲染
  - 显示操作摘要和参数
  - 确认/取消按钮

- ChatMessageBubble 组件增强
  - 支持 83 个工具的调用显示
  - 工具结果格式化渲染
  - 文件引用解析和渲染

**后端改进**

- agentTools/index.ts
  - 统一的工具注册和路由
  - 工具名称相似度匹配
  - 按类别获取工具列表

- agentTools/types.ts
  - 工具定义类型
  - 写操作标记集合（WRITE_TOOLS）
  - 文件记录类型

- agentEngine.ts
  - ReAct 循环实现
  - Native Tool Calling 和 Prompt-Based 双模式
  - 自动链式调用逻辑
  - 历史消息裁剪

**数据库变更**

- 新增迁移文件 `0011_ai_confirm_requests.sql`
  - ai_confirm_requests 表：写操作确认请求存储

**新文件**

后端：

- `apps/api/src/lib/ai/agentTools/index.ts` - 工具统一入口
- `apps/api/src/lib/ai/agentTools/types.ts` - 工具类型定义
- `apps/api/src/lib/ai/agentTools/search.ts` - 搜索工具模块
- `apps/api/src/lib/ai/agentTools/content.ts` - 内容理解工具模块
- `apps/api/src/lib/ai/agentTools/navigation.ts` - 导航工具模块
- `apps/api/src/lib/ai/agentTools/stats.ts` - 统计工具模块
- `apps/api/src/lib/ai/agentTools/fileops.ts` - 文件操作工具模块
- `apps/api/src/lib/ai/agentTools/tags.ts` - 标签管理工具模块
- `apps/api/src/lib/ai/agentTools/share.ts` - 分享链接工具模块
- `apps/api/src/lib/ai/agentTools/version.ts` - 版本管理工具模块
- `apps/api/src/lib/ai/agentTools/notes.ts` - 笔记备注工具模块
- `apps/api/src/lib/ai/agentTools/permission.ts` - 权限管理工具模块
- `apps/api/src/lib/ai/agentTools/storage.ts` - 存储桶管理工具模块
- `apps/api/src/lib/ai/agentTools/system.ts` - 系统管理工具模块
- `apps/api/src/lib/ai/agentTools/ai-enhance.ts` - AI 增强工具模块
- `apps/api/src/lib/ai/agentTools/agentToolUtils.ts` - 工具通用工具函数

### Changed

- AI_FEATURES.md 文档更新至 v4.3.0
- API_AI.md 文档更新至 v4.3.0
- README.md 版本号更新至 v4.3.0
- architecture.md 架构文档更新

### Fixed

- 修复 Agent 循环调用问题
- 修复视觉分析超时问题
- 优化工具调用去重逻辑
- 改进搜索无结果时的处理策略

---

## [v4.2.0] - 2026-04-06

### Added - AI Agent 引擎与系统配置 🚀

**核心功能 - Agent 引擎**

- **Agent 引擎（agentEngine.ts）**
  - 支持 Function Calling 工具调用
  - 支持推理内容（Reasoning Content）显示
  - 内置工具：search_files、get_file_content、list_files、get_file_info
  - 多轮对话上下文记忆
  - 流式输出支持

- **推理内容支持**
  - DeepSeek R1 系列模型：显示完整推理过程
  - 智谱 GLM-4.5/4.6/4.7/5：支持 thinking 模式
  - 阿里 QwQ 系列：显示推理过程

- **SSE 流式响应格式增强**
  - 新增 `reasoning` 事件类型（推理内容）
  - 新增 `toolStart` 事件类型（工具调用开始）
  - 新增 `toolResult` 事件类型（工具调用结果）

**AI 系统配置**

- **高级配置标签页**
  - 默认模型配置（chat、vision、summary、image_caption、image_tag、rename）
  - 模型参数配置（temperature、max_tokens）
  - 内容限制配置（摘要最大长度、标签最大数量）
  - 重试策略配置（最大重试次数、重试间隔）
  - 提示词模板配置
  - 功能开关配置（启用推理内容显示）

- **配置 API**
  - GET /api/ai-config/system-config - 获取所有配置
  - PUT /api/ai-config/system-config/:key - 更新配置
  - POST /api/ai-config/system-config/:key/reset - 重置为默认值
  - GET /api/ai-config/feature-models - 获取各功能可用模型列表

**向量库管理**

- **向量库标签页**
  - 已索引文件列表（分页显示）
  - 文件名、类型、大小、索引时间、摘要状态
  - 搜索过滤功能
  - 单个删除向量索引

- **向量库 API**
  - GET /api/ai/index/vectors - 获取向量索引列表
  - DELETE /api/ai/index/vectors/:fileId - 删除单个索引
  - GET /api/ai/index/diagnose - 向量索引诊断
  - GET /api/ai/index/sample/:fileId - 获取文件索引样本

**任务中心**

- **任务中心标签页**
  - 统一显示所有任务状态
  - 索引任务状态
  - 摘要生成任务状态
  - 标签生成任务状态
  - 文件处理总览统计

**全局 AI 聊天组件**

- **AIChatWidget 组件**
  - 页面右下角悬浮按钮
  - 快速发起 AI 对话
  - 会话列表切换
  - 抽屉式聊天面板
  - 支持最小化/展开

**Workers AI 自定义模型**

- **自定义模型选项**
  - 支持输入任意 `@cf/` 开头的模型 ID
  - 例如：`@cf/deepseek/deepseek-r1`、`@cf/black-forest-labs/flux-2-klein-4b`
  - 可在 Workers AI 模型目录查看所有可用模型

**前端改进**

- ChatMessageBubble 组件增强
  - 支持推理内容折叠显示
  - 支持工具调用结果显示
  - 优化 Markdown 渲染

- AISettings 页面增强
  - 新增「向量库」标签页
  - 新增「任务中心」标签页
  - 新增「高级配置」标签页
  - 标签页横向滚动优化

**后端改进**

- agentEngine.ts
  - 实现完整的 Agent 引擎
  - 工具定义和执行
  - 推理内容提取

- aiConfigService.ts
  - AI 系统配置管理
  - 配置项定义和默认值
  - 配置更新和重置

- agentTools.ts
  - Agent 工具集实现
  - 文件搜索、内容获取等工具

- utils.ts
  - AI 相关工具函数
  - 消息格式化、请求处理

**模型能力更新**

- 新增 `function_calling` 能力标识
- 支持识别推理内容模型
- 智谱模型支持 thinking 配置

**数据库变更**

- 新增迁移文件 `0021_ai_system_config.sql`
  - ai_system_config 表：AI 系统配置存储

**新文件**

后端：

- `apps/api/src/lib/ai/agentEngine.ts` - Agent 引擎
- `apps/api/src/lib/ai/aiConfigService.ts` - AI 配置服务
- `apps/api/src/lib/ai/agentTools.ts` - Agent 工具集
- `apps/api/src/lib/ai/utils.ts` - AI 工具函数

前端：

- `apps/web/src/components/ai/AIChatWidget.tsx` - 全局悬浮聊天组件

### Changed

- AI_FEATURES.md 文档更新至 v4.2.0
- API_AI.md 文档更新至 v4.2.0
- README.md 版本号更新至 v4.2.0

### Fixed

- 修复推理内容显示格式问题
- 修复工具调用结果显示问题
- 优化向量库列表分页性能

---

## [v4.1.0] - 2026-04-03

### Added - AI 系统全面升级 🤖

**核心功能 - 多模型支持与 AI 对话系统**

- **多模型架构（Model Gateway Pattern）**
  - 支持 Cloudflare Workers AI 内置模型（9个模型可选）
  - 支持 OpenAI 兼容 API 接入（GPT-4o、Claude、Gemini、Ollama 等）
  - 适配器模式设计，可扩展更多 AI 提供商
  - 零配置即用：未添加模型时自动使用 Workers AI 默认模型

- **AI 对话系统**
  - 全新 AI 对话页面 `/ai-chat`，现代化聊天 UI
  - SSE 流式响应，实时打字效果
  - 会话管理：创建、切换、删除会话
  - RAG 引擎集成：基于文件内容进行智能问答
  - Markdown 渲染、代码高亮、源文件引用

- **AI 配置中心**
  - 独立 AI 设置页面 `/ai-settings`
  - 模型管理：添加、编辑、删除、激活模型
  - Workers AI 模型快速启用（一键添加并激活）
  - 模型测试功能：发送 "Hello" 测试连接可用性
  - 功能级模型配置：
    - 文件摘要专用模型
    - 图片描述专用模型（需 vision 能力）
    - 图片标签专用模型
    - 智能重命名专用模型

**Workers AI 可用模型**

| 模型                         | 参数量 | 类型      | 说明                      |
| ---------------------------- | ------ | --------- | ------------------------- |
| DeepSeek R1 Distill Qwen 32B | 32B    | chat      | 推理能力强，数学/代码专家 |
| Llama 3.3 70B (FP8)          | 70B    | chat      | Meta 最新大模型           |
| Qwen 1.5 14B Chat            | 14B    | chat      | 中文能力优秀              |
| Llama 3.1 8B Instruct        | 8B     | chat      | 默认模型，通用问答        |
| Mistral 7B Instruct v0.2     | 7B     | chat      | 响应速度快                |
| Gemma 2B LoRA                | 2B     | chat      | 轻量极速                  |
| LLaVA 1.5 7B Vision          | 7B     | vision    | 图片理解                  |
| BGE-M3 Embedding             | -      | embedding | 向量化/语义搜索           |

**批量操作优化**

- 一键摘要任务优化
  - 支持取消操作
  - 单文件超时控制（30秒）
  - 连续错误限制（10次终止）
  - 并发数降低至 3
- 一键标签+描述任务优化
  - 同样支持取消和超时（60秒/图片）
- 一键索引任务优化
  - 同样支持取消和超时（60秒/文件）
- 任务状态自动轮询（每 3 秒刷新）

**前端改进**

- 移动端完整支持
  - 底部导航新增「AI 对话」入口
  - 更多菜单新增「AI 配置」入口
  - AIChat 页面移动端适配（抽屉式侧边栏）
  - AISettings 页面响应式布局优化
- ModelCard 组件增强
  - 新增「测试连接」按钮
  - 显示测试结果（成功/失败 + 响应时间 + AI 回复）

**后端改进**

- features.ts 重构
  - 统一使用 ModelGateway 调用模型
  - 三层回退机制：功能级模型 → 用户默认 → Workers AI 默认
  - 所有 AI 功能传递 userId，支持个性化配置
- modelGateway.ts 修复
  - 修复 Drizzle ORM camelCase 字段映射问题
  - 新增 getDefaultWorkersAiModel() 默认回退方法
- aiConfigRoutes.ts 增强
  - 新增 POST /api/ai-config/test 模型测试接口
  - 新增 GET /api/ai-config/feature-config 功能配置接口
  - 新增 PUT /api/ai-config/feature-config 功能配置保存接口
  - URL 验证逻辑优化（Workers AI 不需要 URL）
- aiChatRoutes.ts 增强
  - GET /sessions 添加 try-catch 错误处理
  - 完善会话列表错误容错
- ai.ts 路由增强
  - 新增 DELETE /api/ai/summarize/batch 取消摘要任务
  - 新增 DELETE /api/ai/tags/batch 取消标签任务
  - 所有功能路由传递 userId 参数

**数据库变更**

- 新增迁移文件 `0020_ai_models_config.sql`
  - ai_models 表：用户自定义 AI 模型配置
  - ai_chat_sessions 表：AI 对话会话
  - ai_chat_messages 表：对话消息记录
  - ai_usage_stats 表：AI 使用统计（预留）

**路由注册**

```
app.route('/api/ai', aiRoutes)           # AI 文件处理功能
app.route('/api/ai-config', aiConfigRoutes) # AI 配置管理
app.route('/api/ai-chat', aiChatRoutes)     # AI 对话系统
```

**新文件**

后端：

- `apps/api/src/lib/ai/modelGateway.ts` - 模型网关
- `apps/api/src/lib/ai/types.ts` - 类型定义
- `apps/api/src/lib/ai/adapters/workersAiAdapter.ts` - Workers AI 适配器
- `apps/api/src/lib/ai/adapters/openAiCompatibleAdapter.ts` - OpenAI 兼容适配器
- `apps/api/src/lib/ai/ragEngine.ts` - RAG 引擎
- `apps/api/src/routes/aiConfigRoutes.ts` - AI 配置路由
- `apps/api/src/routes/aiChatRoutes.ts` - AI 对话路由

前端：

- `pages/AIChat.tsx` - AI 对话页面
- `pages/AISettings.tsx` - AI 设置页面
- `components/ai/chat/ChatMessageBubble.tsx` - 消息气泡组件
- `components/ai/chat/ChatInputBox.tsx` - 输入框组件
- `components/ai/chat/SuggestedQuestions.tsx` - 建议问题组件
- `components/ai/settings/ModelCard.tsx` - 模型卡片组件
- `components/ai/settings/TaskProgress.tsx` - 任务进度组件
- `components/ai/settings/StatsCard.tsx` - 统计卡片组件

### Fixed

- 修复 AI sessions 500 错误（添加 try-catch 容错）
- 修复 AISettings header sticky 问题（改为 flex 布局）
- 修复点击会话跳转首页问题（添加 /ai-chat/:sessionId 路由）
- 修复模型测试 "Invalid url" 错误（Workers AI 不需要 URL）
- 修复 parseModelConfig 字段映射错误（camelCase vs snake_case）
- 修复 Image 图标导入冲突（改为 ImageIcon）

### Changed

- AI 功能从 Settings.tsx 迁移到独立 AISettings.tsx 页面
- aiFeatures.ts 重构为 lib/ai/features.ts（使用 ModelGateway）
- 移除冗余的页脚导航链接

---

## [v4.0.0] - 2026-04-02

### Added - 邮件通知系统

#### 核心功能

- **注册邮箱验证（6位验证码）**
  - 新用户注册后自动发送6位数字验证码邮件
  - 验证码有效期10分钟
  - 首个注册用户（管理员）自动验证
  - 未验证用户显示提示横幅
  - API: POST /api/auth/verify-code, POST /api/auth/resend-verification

- **密码重置流程（6位验证码）**
  - 忘记密码发送6位验证码邮件
  - 验证码有效期10分钟
  - 防邮箱枚举攻击（无论邮箱是否存在都返回200）
  - API: POST /api/auth/forgot-password, POST /api/auth/reset-password

- **邮箱更换功能（6位验证码）**
  - 更换邮箱需要验证新邮箱
  - 发送6位验证码到新邮箱
  - 验证码有效期10分钟
  - 旧邮箱收到更换成功通知
  - API: POST /api/auth/change-email, POST /api/auth/verify-code

- **邮件偏好设置**
  - 用户可自定义邮件通知偏好
  - 支持5种通知类型：@提及、分享接收、配额警告、AI完成、系统通知
  - 所有邮件发送都检查用户偏好
  - API: GET /api/auth/email-preferences, PUT /api/auth/email-preferences

- **管理面板邮件配置**
  - Resend API 配置界面
  - 发件人地址和名称设置
  - 发送测试邮件功能
  - 群发系统公告（支持按角色筛选）
  - API: GET/PUT /api/admin/email/config, POST /api/admin/email/test, POST /api/admin/email/broadcast

#### 安全增强

- **JWT失效机制**
  - 密码修改后自动更新 `passwordChangedAt`
  - 密码重置后自动更新 `passwordChangedAt`
  - 登录时检查JWT是否失效
  - 失效后自动清除会话并要求重新登录

- **验证码安全**
  - 6位随机数字验证码
  - 验证码一次性使用机制
  - 验证码10分钟有效期
  - 重发验证码限流（1分钟1次）
  - 验证码明文存储（短有效期，无需哈希）

- **邮件模板**
  - 3套精美邮件模板（注册验证/密码重置/更换邮箱）
  - 不同验证类型使用不同配色方案
  - 响应式设计，移动端友好

#### 数据库变更

- 新增迁移文件 `0018_email.sql`
  - 新增 `email_tokens` 表（存储6位验证码）
    - `code` 字段存储验证码（明文，10分钟有效期）
    - 支持3种类型：verify_email、reset_password、change_email
  - `users` 表新增 `email_verified` 字段
  - `users` 表新增 `email_preferences` 字段
  - `users` 表新增 `password_changed_at` 字段

#### 前端页面

- 新增/更新页面
  - `VerifyEmail.tsx` - 邮箱验证码输入页（6位验证码输入框）
  - `ForgotPassword.tsx` - 忘记密码页面（发送验证码）
  - `ResetPassword.tsx` - 重置密码页面（验证码+新密码）
  - `EmailConfig.tsx` - 管理面板邮件配置页面

- 新增组件
  - `EmailVerificationBanner.tsx` - 未验证用户提示横幅
  - `EmailPreferencesForm` - 邮件偏好设置表单
  - `EmailChangeForm` - 更换邮箱表单

- 功能集成
  - 登录页面添加"忘记密码"链接
  - 设置页面新增"邮箱设置"选项卡
  - 管理面板新增"邮件配置"选项卡
  - MainLayout 集成验证提示横幅

#### 邮件模板

- 5个精美邮件模板
  - 验证邮箱模板（紫色渐变主题）
  - 重置密码模板（粉红渐变主题）
  - 更换邮箱确认模板（蓝色渐变主题）
  - 密码变更通知模板
  - 系统通知模板

#### 环境变量变更

- `PUBLIC_URL` 从必填改为可选
  - 不再用于邮件验证链接
  - 仅用于文件直接访问链接生成

### Changed

- **邮件通知控制**
  - 所有邮件发送都检查用户偏好设置
  - 密码修改通知映射到 `system` 偏好
  - 重置密码成功通知映射到 `system` 偏好
  - 邮箱更换成功通知映射到 `system` 偏好

- **审计日志**
  - 新增审计类型：`admin.email_config_update`
  - 新增审计类型：`admin.email_test`
  - 新增审计类型：`admin.email_broadcast`

### Improved

- **用户体验**
  - 邮箱验证状态清晰展示
  - 邮件发送结果实时反馈
  - 密码强度实时指示
  - 验证链接过期友好提示

- **安全性**
  - 所有安全相关邮件不受偏好设置影响
  - 密码变更后强制重新登录
  - 防止邮箱枚举攻击

### Fixed

- 修复密码修改后未更新 `passwordChangedAt` 的问题
- 修复邮件链接使用localhost的问题
- 修复重置密码成功通知未检查邮件偏好的问题
- 修复邮箱更换成功通知未检查邮件偏好的问题

### Technical Details

- **技术栈**
  - Resend API（邮件服务）
  - Cloudflare KV（配置存储）
  - Cloudflare D1（Token存储）
  - SHA-256（Token哈希）

- **性能优化**
  - 邮件配置KV缓存
  - Token哈希索引优化
  - 邮件模板预编译

- **代码质量**
  - TypeScript严格模式
  - 完整的类型定义
  - 错误处理完善
  - 代码注释清晰

## [v3.8.0] - 2026-04-02

### Added

- 收藏夹功能
  - 快速收藏/取消收藏文件和文件夹
  - 侧边栏「收藏」入口，快捷访问收藏文件
  - 文件列表支持收藏图标显示
  - API: POST/DELETE /api/files/:id/star
- 存储分析 Dashboard
  - 存储空间分布统计（按文件类型、MIME 类型）
  - 活跃度热力图（上传/下载/删除活动统计）
  - 大文件排行 Top 20
  - 存储趋势分析（按天统计上传量）
  - 存储桶统计
  - API: GET /api/analytics/\*
- 通知系统
  - 实时通知铃铛（PC端侧边栏底部、移动端顶部栏）
  - 通知列表弹窗（向上/向下展开自适应）
  - 支持已读/未读状态管理
  - 支持全部标记已读、删除通知
  - 通知类型：share_received、mention、permission_granted、ai_complete、system
  - API: GET /api/notifications, PUT /api/notifications/:id/read, DELETE /api/notifications/:id
- FTS5 全文搜索
  - 基于 SQLite FTS5 的全文搜索引擎
  - 支持 unicode61 中文分词
  - 搜索文件名、描述、AI 摘要
  - 前端搜索栏 FTS5 开关（桌面端 + 移动端）
  - 数据库迁移：0016_fts5.sql（虚拟表 + 同步触发器）

### Changed

- 数据库结构扩展
  - 新增迁移文件 0015_notifications.sql（notifications 表）
  - 新增迁移文件 0016_fts5.sql（files_fts 虚拟表）
- 前端组件优化
  - NotificationBell 支持 align 和 direction 属性
  - NotificationList API 调用已启用

### Improved

- 搜索性能提升：FTS5 全文搜索替代 LIKE 查询
- 用户体验：通知铃铛位置优化（PC端侧边栏、移动端顶部栏）

## [v3.7.0] - 2026-04-01

### Added

- AI 功能集成（基于 Cloudflare AI）
  - 文件摘要生成：自动为文本文件生成内容摘要
  - 图片智能描述：自动识别图片内容并生成描述
  - 图片标签生成：使用 ResNet-50 模型自动生成图片标签
  - 智能重命名建议：根据文件内容智能推荐文件名
  - 语义搜索：基于 Vectorize 实现语义相似文件搜索
  - 向量索引管理：支持批量索引、增量索引、索引状态查询
- 移动端页面排版优化
  - 新增移动端底部操作栏（MobileFilesToolbar）
  - 新增移动端搜索面板（MobileSearchPanel）
  - 优化移动端底部导航（MobileBottomNav）
  - 改进视图切换、排序、浮动操作按钮交互
  - 增强移动端触摸体验和响应式布局
- 预览组件拆分重构
  - 将 FilePreview 拆分为独立预览组件
  - 新增 filepreview 目录，包含 12 个独立预览组件
  - ImagePreview、VideoPreview、AudioPreview
  - PdfPreview、MarkdownPreview、CodePreview
  - OfficePreview、CsvPreview、ZipPreview
  - FontPreview、EpubPreview
  - 新增 previewUtils 工具函数

### Changed

- 数据库结构扩展
  - files 表新增 ai_summary、ai_summary_at 字段
  - files 表新增 ai_tags、ai_tags_at 字段
  - files 表新增 vector_indexed_at 字段
  - files 表新增 is_starred 字段
  - 新增迁移文件 0014_ai_features.sql

### Improved

- AI 功能自动触发：上传文件后自动生成摘要/标签
- 语义搜索支持中文和多语言
- 移动端交互体验优化

## [v3.6.0] - 2026-03-31

### Added

- 权限系统 v2：用户组管理、权限继承、时效性权限
  - 新增用户组（user_groups）和组成员（group_members）表
  - 支持为用户或组授予文件权限
  - 权限支持设置过期时间
  - 权限继承：子文件自动继承父文件夹权限
  - 递归 CTE 权限解析算法
  - KV 权限缓存层
- RESTful v1 API：标准化 API 接口
  - `/api/v1/files` - 文件管理 API
  - `/api/v1/folders` - 文件夹管理 API
  - `/api/v1/shares` - 分享管理 API
  - `/api/v1/search` - 搜索 API
  - `/api/v1/me` - 当前用户 API
- OpenAPI 文档：自动生成 API 文档
  - 访问 `/api/v1/openapi.json` 获取 OpenAPI 规范
  - 访问 `/api/v1/docs` 查看 Swagger UI
- Webhook 通知：文件事件订阅
  - 支持订阅文件上传、删除、更新等事件
  - HMAC-SHA256 签名验证
  - Webhook 管理界面

### Changed

- 权限管理界面重构
  - 支持选择用户或组进行授权
  - 显示权限来源（显式/继承）
  - 显示继承路径提示

### Improved

- 权限解析性能优化：使用递归 CTE 一次性查询整条祖先链
- API 文档完善：所有 v1 API 端点有完整的请求/响应 schema

## [v3.5.0] - 2026-03-30

### Added

- API Keys 管理：支持创建、管理 API 密钥，实现程序化访问
  - 支持 6 种权限范围：文件读取、文件写入、分享读取、分享管理、存储桶查看、API Keys 管理
  - 支持设置密钥过期时间
  - 完整的 API Key 使用文档
- 文件笔记面板：为文件添加评论和笔记
  - 支持 @提及其他用户
  - 支持笔记回复（嵌套评论）
  - 支持删除笔记和回复
- 文件编辑功能：直接在系统内创建和编辑文本文件
  - 支持多种文本格式（代码、配置文件、Markdown 等）
  - 编辑时自动创建版本快照

### Changed

- 文件版本控制功能重构
  - 仅支持可编辑的文本文件类型（代码、配置、Markdown 等）
  - 图片、视频、音频等二进制文件不再支持版本控制
  - 版本存储优化：每次编辑生成独立的存储路径，确保历史版本内容不被覆盖
  - 版本恢复功能修复：正确恢复到指定版本内容

### Improved

- 版本历史 UI 优化：仅对可编辑文件显示版本历史按钮
- 右键菜单优化：版本历史选项仅对可编辑文件显示

## [v3.4.0] - 2026-03-27

### Added

- 大幅强化文件预览功能
- 预览大小限制从 10MB 提升至 30MB
- 新增 EPUB 电子书预览（目录导航、翻页、键盘快捷键）
- 新增字体文件预览（TTF/OTF/WOFF/WOFF2）
- 新增 ZIP 压缩包内容列表预览（文件树、压缩统计）
- CSV 表格增强预览（搜索、排序、分页）
- PowerPoint 幻灯片本地预览
- PDF 分页预览与缩放控制
- Excel 多工作表切换与样式保留预览

### Improved

- 优化预览窗口大小控制（小/中/大/全屏）
- 统一预览类型配置（previewTypes.ts）
- 预览组件性能优化

## [v3.3.0] - 2026-03-24

### Added

- 文件版本控制功能
- 增强 Markdown 文件预览
- 新增 Excel 文件预览
- 后端错误码统一管理

## [v3.2.0] - 2026-03-23

### Added

- 直接创建文件功能
- 文件直链功能
- 分享页面预览功能

### Improved

- 优化移动端排版
- 其他细节优化

## [v3.1.0] - 2026-03-20

### Added

- 支持文件夹生成分享链接
- 支持指定文件夹生成上传链接给无账号人员上传文件
- 支持 Telegram 分片上传
- 存储桶迁移功能

### Improved

- 其他功能细节优化调整

## [v2.1.0] - 2026-03-19

### Added

- Telegram 存储支持

### Improved

- 优化 WebDAV 在 Windows 资源管理器等场景的使用
- 优化其他一系列功能

## [v1.1.0] - 2026-03-17

### Added

- 初始版本发布
