# OSSshelf AI 功能说明文档

**版本**: v4.3.0
**更新日期**: 2026-04-08

---

## 📋 目录

- [功能概述](#功能概述)
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

v4.3.0 版本对 AI 功能进行了全面升级，核心变化如下：

| 功能 | 说明 | 版本 |
| --- | --- | --- |
| **Agent 引擎重构** | ReAct 架构，多轮推理，链式调用 | v4.3.0 重构 |
| **95 个智能工具** | 覆盖文件操作、权限管理、分享链接等 13 个模块 | v4.3.0 新增 |
| **智能意图识别** | 自动识别搜索、视觉、内容理解等意图 | v4.3.0 新增 |
| **链式推理** | 工具结果驱动下一步行动 | v4.3.0 新增 |
| **视觉分析增强** | 图片搜索结果自动触发视觉分析 | v4.3.0 新增 |
| **写操作确认** | 敏感操作需用户确认后执行 | v4.3.0 新增 |
| **AI 系统配置** | 可配置默认模型、参数、限制、重试策略、提示词模板 | v4.2.0 |
| **向量库管理** | 查看和删除向量索引，支持分页和搜索 | v4.2.0 |
| **任务中心** | 统一显示所有任务状态，实时进度监控 | v4.2.0 |
| **全局 AI 聊天** | 悬浮式 AI 聊天组件，支持会话切换 | v4.2.0 |
| **自定义模型** | 支持任意 Workers AI 模型 ID | v4.2.0 |
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

| 意图类型 | 特征 | 工具选择 |
| --- | --- | --- |
| **搜索类** | 提到文件名/内容关键词 | search_files |
| **过滤类** | 只说文件类型/属性 | filter_files |
| **标签类** | 提到标签 | search_by_tag |
| **视觉类** | 涉及图片外观/场景/描述 | filter_files → analyze_image |
| **内容理解类** | 想了解文件内容 | read_file_text / analyze_image |
| **统计类** | 问存储/文件数量 | get_storage_stats |
| **操作类** | 创建/编辑/删除文件 | 对应写操作工具 |

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

// 完成
{ type: "done", sessionId: "xxx", sources: [...] }
```

### 推理内容支持

以下模型支持显示推理内容：

| 厂商 | 模型 | 说明 |
| --- | --- | --- |
| DeepSeek | R1 系列 | 显示完整推理过程 |
| 智谱 | GLM-4.5/4.6/4.7/5 | 支持 thinking 模式 |
| 阿里 | QwQ 系列 | 显示推理过程 |

---

## 智能工具集

v4.3.0 提供了 **95 个智能工具**，分为 13 个功能模块：

### 工具模块总览

| 模块 | 工具数 | 功能描述 |
| --- | --- | --- |
| 🔍 搜索与发现 | 7 | 文件搜索、过滤、标签搜索、重复检测、文件详情 |
| 📄 内容理解 | 7 | 文件读取、图片分析、文件对比、元数据提取 |
| 📂 目录导航 | 7 | 文件夹浏览、目录树、最近文件、收藏文件、存储概览 |
| 📊 统计分析 | 5 | 存储统计、活动统计、配额信息、文件分布 |
| 📁 文件操作 | 15 | 创建、编辑、重命名、移动、复制、删除等 |
| 🏷️ 标签管理 | 7 | 添加/移除标签、合并标签、自动打标签、标签管理 |
| 🔗 分享链接 | 8 | 创建分享、直链、上传链接、分享管理 |
| 📜 版本管理 | 4 | 版本查看、恢复、对比、保留策略 |
| 📝 笔记备注 | 5 | 添加/获取/更新/删除/搜索笔记 |
| 🔐 权限管理 | 6 | 权限查看、授权、撤销、用户组管理 |
| 💾 存储管理 | 8 | 存储桶管理、文件迁移、存储分析 |
| ⚙️ 系统管理 | 11 | 用户配置、API Key、Webhook、审计日志、FAQ |
| 🤖 AI 增强 | 5 | AI 摘要、AI 标签、向量索引、RAG 问答 |

### 详细工具列表

#### 🔍 搜索与发现（7 个）

| 工具名称 | 功能 | 参数 |
| --- | --- | --- |
| `search_files` | 关键词搜索文件 | query, limit, mimeType |
| `filter_files` | 按条件过滤文件 | mimeTypePrefix, minSize, maxSize, dateRange |
| `search_by_tag` | 按标签搜索 | tagNames, matchAll |
| `search_duplicates` | 查找重复文件 | - |
| `smart_search` | 智能语义搜索 | query, limit |
| `get_similar_files` | 获取相似文件 | fileId, limit |
| `get_file_details` | 获取文件详情 | fileId |

#### 📄 内容理解与分析（7 个）

| 工具名称 | 功能 | 参数 |
| --- | --- | --- |
| `read_file_text` | 读取文本文件内容 | fileId, startLine, endLine |
| `analyze_image` | 分析图片内容 | fileId, question |
| `compare_files` | 对比两个文件 | fileId1, fileId2 |
| `extract_metadata` | 提取文件元数据 | fileId |
| `generate_summary` | 生成文件摘要 | fileId |
| `generate_tags` | 生成文件标签 | fileId |
| `content_preview` | 内容预览 | fileId, maxLength |

#### 📂 目录导航（7 个）

| 工具名称 | 功能 | 参数 |
| --- | --- | --- |
| `navigate_path` | 导航到指定路径 | path |
| `list_folder` | 列出文件夹内容 | folderId, sortBy, sortOrder |
| `get_recent_files` | 获取最近文件 | limit, mimeType |
| `get_starred_files` | 获取收藏文件 | limit |
| `get_parent_chain` | 获取父级路径链 | fileId |
| `get_folder_tree` | 获取目录树 | folderId, depth |
| `get_storage_overview` | 获取存储概览 | - |

#### 📊 统计与分析（5 个）

| 工具名称 | 功能 | 参数 |
| --- | --- | --- |
| `get_storage_stats` | 获取存储统计 | - |
| `get_activity_stats` | 获取活动统计 | days |
| `get_user_quota_info` | 获取用户配额 | - |
| `get_file_type_distribution` | 获取文件类型分布 | - |
| `get_sharing_stats` | 获取分享统计 | - |

#### 📁 文件操作（15 个）⭐ 写操作

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `create_text_file` | 创建文本文件 | ✅ |
| `create_code_file` | 创建代码文件 | ✅ |
| `create_file_from_template` | 从模板创建文件 | ✅ |
| `edit_file_content` | 编辑文件内容 | ✅ |
| `append_to_file` | 追加内容到文件 | ✅ |
| `find_and_replace` | 查找替换 | ✅ |
| `rename_file` | 重命名文件 | ✅ |
| `move_file` | 移动文件 | ✅ |
| `copy_file` | 复制文件 | ✅ |
| `delete_file` | 删除文件 | ✅ |
| `restore_file` | 恢复文件 | ✅ |
| `create_folder` | 创建文件夹 | ✅ |
| `batch_rename` | 批量重命名 | ✅ |
| `star_file` | 收藏文件 | ✅ |
| `unstar_file` | 取消收藏 | ✅ |

#### 🏷️ 标签管理（7 个）

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `add_tag` | 添加标签 | ✅ |
| `remove_tag` | 移除标签 | ✅ |
| `get_file_tags` | 获取文件标签 | ❌ |
| `list_all_tags_for_management` | 列出所有标签（管理用） | ❌ |
| `merge_tags` | 合并标签 | ✅ |
| `auto_tag_files` | 自动打标签 | ✅ |
| `tag_folder` | 为文件夹打标签 | ✅ |

#### 🔗 分享链接（8 个）

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `create_share_link` | 创建分享链接 | ✅ |
| `list_shares` | 列出分享 | ❌ |
| `update_share_settings` | 更新分享设置 | ✅ |
| `revoke_share` | 撤销分享 | ✅ |
| `get_share_stats` | 获取分享详情 | ❌ |
| `create_direct_link` | 创建直链 | ✅ |
| `revoke_direct_link` | 撤销直链 | ✅ |
| `create_upload_link_for_folder` | 创建上传链接 | ✅ |

#### 📜 版本管理（4 个）

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `get_file_versions` | 获取版本列表 | ❌ |
| `restore_version` | 恢复版本 | ✅ |
| `compare_versions` | 对比版本 | ❌ |
| `set_version_retention` | 设置保留策略 | ✅ |

#### 📝 笔记备注（5 个）

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `add_note` | 添加笔记 | ✅ |
| `get_notes` | 获取笔记列表 | ❌ |
| `update_note` | 更新笔记 | ✅ |
| `delete_note` | 删除笔记 | ✅ |
| `search_notes` | 搜索笔记 | ❌ |

#### 🔐 权限管理（6 个）

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `get_file_permissions` | 获取权限 | ❌ |
| `grant_permission` | 授权 | ✅ |
| `revoke_permission` | 撤销权限 | ✅ |
| `set_folder_access_level` | 设置访问级别 | ✅ |
| `list_user_groups` | 列出用户组 | ❌ |
| `manage_group_members` | 管理组成员 | ✅ |

#### 💾 存储管理（8 个）

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `get_storage_usage` | 获取存储使用 | ❌ |
| `get_large_files` | 获取大文件 | ❌ |
| `get_folder_sizes` | 获取文件夹大小 | ❌ |
| `get_cleanup_suggestions` | 清理建议 | ❌ |
| `list_buckets` | 列出存储桶 | ❌ |
| `get_bucket_info` | 获取存储桶信息 | ❌ |
| `set_default_bucket` | 设置默认桶 | ✅ |
| `migrate_file_to_bucket` | 迁移文件 | ✅ |

#### ⚙️ 系统管理（11 个）

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `get_system_status` | 系统状态 | ❌ |
| `get_help` | 获取帮助 | ❌ |
| `get_version_info` | 版本信息 | ❌ |
| `get_user_profile` | 用户配置 | ❌ |
| `list_api_keys` | 列出 API Key | ❌ |
| `create_api_key` | 创建 API Key | ✅ |
| `revoke_api_key` | 撤销 API Key | ✅ |
| `list_webhooks` | 列出 Webhook | ❌ |
| `create_webhook` | 创建 Webhook | ✅ |
| `get_audit_logs` | 审计日志 | ❌ |

#### 🤖 AI 增强（5 个）

| 工具名称 | 功能 | 需确认 |
| --- | --- | --- |
| `trigger_ai_summary` | 触发 AI 摘要 | ❌ |
| `trigger_ai_tags` | 触发 AI 标签 | ❌ |
| `rebuild_vector_index` | 重建向量索引 | ❌ |
| `ask_rag_question` | RAG 问答 | ❌ |
| `smart_rename_suggest` | 智能重命名建议 | ❌ |

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

| 模型 ID | 名称 | 参数量 | 特点 | 推荐场景 |
| --- | --- | --- | --- | --- |
| `@cf/deepseek/deepseek-r1-distill-qwen-32b` | DeepSeek R1 32B | 32B | 推理能力强 | 数学、代码、复杂推理 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Llama 3.3 70B | 70B | Meta 最新 | 复杂任务首选 |
| `@cf/qwen/qwen1.5-14b-chat-awq` | Qwen 1.5 14B | 14B | 中文优秀 | 中文对话 |
| `@cf/meta/llama-3.1-8b-instruct` | Llama 3.1 8B | 8B | 通用型 | 默认模型，日常使用 |
| `@cf/mistral/mistral-7b-instruct-v0.2` | Mistral 7B | 7B | 速度快 | 实时对话 |
| `@cf/google/gemma-2b-it-lora` | Gemma 2B | 2B | 轻量 | 简单任务 |

#### 视觉模型 (Vision)

| 模型 ID | 名称 | 用途 |
| --- | --- | --- |
| `@cf/llava-hf/llava-1.5-7b-hf` | LLaVA 1.5 7B | 图片理解和描述 |

#### 嵌入模型 (Embedding)

| 模型 ID | 名称 | 用途 |
| --- | --- | --- |
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

| 能力 | 说明 | 适用功能 |
| --- | --- | --- |
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
| --- | --- | --- |
| 文件摘要 | chat 模型 | 推荐使用大参数模型 |
| 图片描述 | vision 模型 | 必须支持图片理解 |
| 图片标签 | chat 模型 | 使用文本模型生成标签 |
| 智能重命名 | chat 模型 | 推荐使用轻量快速模型 |

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

| 功能 | 要求的能力 | 可选模型示例 |
| --- | --- | --- |
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

v4.3.0 AI 系统配置功能，支持细粒度的 AI 参数调整。

### 配置分类

| 分类 | 说明 | 配置项示例 |
| --- | --- | --- |
| 🤖 默认模型 | 各功能的默认模型 | 默认聊天模型、默认视觉模型 |
| ⚙️ 模型参数 | 模型调用参数 | 默认温度、最大 Token |
| 📏 内容限制 | 内容生成限制 | 摘要最大长度、标签最大数量 |
| 🔄 重试策略 | 错误重试配置 | 最大重试次数、重试间隔 |
| 💬 提示词模板 | 自定义提示词 | 摘要提示词、标签提示词 |
| ✨ 功能开关 | 功能启用控制 | 启用推理内容显示 |
| 🤖 Agent 配置 | Agent 行为配置 | 最大工具调用次数、最大空转轮数 |

### 配置项示例

| 配置 Key | 说明 | 默认值 |
| --- | --- | --- |
| `ai.default_model.chat` | 默认聊天模型 | `@cf/meta/llama-3.1-8b-instruct` |
| `ai.default_model.vision` | 默认视觉模型 | `@cf/llava-hf/llava-1.5-7b-hf` |
| `ai.default_model.summary` | 默认摘要模型 | `@cf/meta/llama-3.1-8b-instruct` |
| `ai.parameter.temperature` | 默认温度 | `0.7` |
| `ai.parameter.max_tokens` | 默认最大 Token | `4096` |
| `ai.limit.summary_max_length` | 摘要最大长度 | `500` |
| `ai.limit.tags_max_count` | 标签最大数量 | `10` |
| `ai.retry.max_attempts` | 最大重试次数 | `3` |
| `ai.retry.delay_ms` | 重试间隔（毫秒） | `1000` |
| `ai.agent.max_tool_calls` | 最大工具调用次数 | `20` |
| `ai.agent.max_idle_rounds` | 最大空转轮数 | `3` |
| `ai.agent.temperature` | Agent 温度 | `0.3` |
| `ai.agent.image_timeout_ms` | 图片分析超时 | `25000` |

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
├── agentEngine.ts              # Agent 引擎 (v4.3.0 重构)
├── aiConfigService.ts          # AI 配置服务
├── ragEngine.ts                # RAG 引擎
├── features.ts                 # 文件处理功能
├── utils.ts                    # 工具函数
├── vendorConfig.ts             # 供应商配置
└── adapters/
    ├── workersAiAdapter.ts     # Workers AI 适配器
    └── openAiCompatibleAdapter.ts # OpenAI 兼容适配器

apps/api/src/lib/ai/agentTools/   # 工具模块 (v4.3.0 新增)
├── index.ts                    # 工具统一入口
├── types.ts                    # 工具类型定义
├── agentToolUtils.ts           # 工具通用函数
├── search.ts                   # 搜索工具 (6个)
├── content.ts                  # 内容理解工具 (7个)
├── navigation.ts               # 导航工具 (4个)
├── stats.ts                    # 统计工具 (5个)
├── fileops.ts                  # 文件操作工具 (15个)
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
│   ├── AIChat.tsx              # AI 对话页面
│   └── AISettings.tsx          # AI 设置页面
└── components/ai/
    ├── AIChatWidget.tsx        # 全局悬浮聊天组件
    ├── chat/
    │   ├── AssistantContent.tsx
    │   ├── ChatHeader.tsx
    │   ├── ChatSidebar.tsx
    │   ├── ReasoningSection.tsx
    │   ├── ToolCallCard.tsx    # 工具调用卡片 (v4.3.0 增强)
    │   ├── ToolInfoModal.tsx
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
        └── VectorsTable.tsx
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
  | { type: 'confirm_request'; confirmId: string; toolName: string; args: Record<string, unknown>; summary: string; done: true }
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

| 字段 | 类型 | 说明 |
| --- | --- | --- |
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
| --- | --- | --- |
| id | text | 主键 UUID |
| user_id | text | 用户 ID |
| title | text | 会话标题 |
| model_id | text? | 使用的模型 ID |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

#### ai_chat_messages（对话消息表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 UUID |
| session_id | text | 会话 ID |
| role | text | 角色: user / assistant / system |
| content | text | 消息内容 |
| sources | text? | 来源文件 JSON |
| model_used | text? | 使用的模型 |
| latency_ms | integer? | 响应延迟（毫秒） |
| created_at | text | 创建时间 |

#### ai_confirm_requests（确认请求表）v4.3.0

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 UUID |
| user_id | text | 用户 ID |
| session_id | text? | 会话 ID |
| tool_name | text | 工具名称 |
| args | text | 参数 JSON |
| summary | text | 操作摘要 |
| status | text | 状态: pending / consumed |
| created_at | text | 创建时间 |
| expires_at | text | 过期时间 |

---

## 相关文档

- [API 文档 - AI 部分](./API_AI.md)
- [更新日志](../CHANGELOG.md)
- [架构文档](./architecture.md)
