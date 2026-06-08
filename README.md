<div align="center">

# 🗄️ OSSshelf

**基于 Cloudflare 的智能文件管理平台**

文件管理 · AI 智能助手 · 多存储支持 · 在线预览 · 文件分享 · WebDAV · 权限管理

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com)
[![Version](https://img.shields.io/badge/version-5.0.0-blue.svg)](CHANGELOG.md)
[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/Zoroaaa/OSSshelf)

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [部署指南](#-部署指南) • [API文档](#-api-文档)

</div>

---

## 🔗 快速访问

<div align="center">

| 资源类型    | 链接                                             | 备注                     |
| ----------- | ------------------------------------------------ | ------------------------ |
| 📖 项目文档 | 👉 [完整介绍](https://zread.ai/Zoroaaa/OSSshelf) | 详细的项目说明和使用指南 |
| 🤖 AI 文档  | 👉 [AI 功能说明](docs/AI_FEATURES.md)            | AI Agent 使用指南        |
| 📝 更新日志 | 👉 [CHANGELOG](CHANGELOG.md)                     | 版本更新历史             |

</div>

## 📋 目录

- [功能特性](#-功能特性)
- [技术栈](#-技术栈)
- [系统限制](#-系统限制)
- [快速开始](#-快速开始)
- [部署指南](#-部署指南)
- [使用说明](#-使用说明)
- [项目结构](#-项目结构)
- [API 文档](#-api-文档)
- [开发命令](#-开发命令)
- [常见问题](#-常见问题)

---

## 📢 版本更新

详细的版本更新日志请参阅 [CHANGELOG.md](CHANGELOG.md)。

### 最新版本 v4.7.0 - AI Agent 全面增强：Planning 层、跨会话记忆、交互体验升级 🧠

**核心更新**：

#### 🧠 Agent 能力增强（4 项重大改进）

- **📋 Planning 层——结构化任务规划**
  - 新增 `ExecutionPlan` 接口：目标、步骤列表、依赖关系、状态追踪
  - `planPhase()` 方法：复杂任务自动生成结构化执行计划
  - SSE 新增 `plan` / `plan_step_update` 事件类型，前端实时渲染进度条
  - 超出 `maxToolCalls` 时优先完成当前步骤再暂停
  - 技术优势：复杂多步任务不再中途截断，执行过程可视化

- **🧠 跨会话语义记忆系统**
  - 双存储架构：D1（结构化查询）+ Vectorize（语义检索）
  - 对话结束时自动提取 3-5 条结构化事实（操作/偏好/路径/文件引用）
  - 每次对话开始时召回相关历史记忆注入上下文（top-3）
  - 命名空间隔离：`memory:{userId}` 区别于文件索引
  - 前端 AISettings 新增「记忆管理」Tab（浏览/筛选/删除）
  - 技术优势：Agent 具备跨会话上下文记忆能力

- **🔧 工具定义 Few-shot Examples**
  - ToolDefinition schema 新增 `examples` 字段
  - 为高频工具补充 2-3 个典型调用示例
  - 弱模型工具选择准确率显著提升
  - 工具总数扩展至 **100+**，覆盖 13+ 个功能模块

- **📦 长任务队列打通——批量操作增强**
  - 新增 `batch_move` / `batch_delete` 工具
  - BATCH_THRESHOLD = 20：超过阈值自动入队，返回 taskId 追踪进度
  - 队列失败时自动降级为同步执行
  - 支持 `agent_batch` 任务类型在 Task Center 展示

#### 💬 交互体验提升（3 项）

- **🖱️ 文件拖拽注入**
  - 从文件列表拖拽文件到对话框 → 自动填入 contextFileIds
  - 消息框显示「附带文件」Chip 样式，支持多文件拖拽

- **@️ @文件快捷引用**
  - 输入 `@` 触发文件搜索下拉框（debounce 300ms）
  - 键盘导航 + 点击选择，选中后显示 Chip 可移除
  - 参考 LobeChat 的 @mention 交互设计

- **💭 对话消息引用/追问**
  - 右键/长按消息 → 选择「引用此消息」
  - 输入框顶部显示引用预览条，发送时自动拼接 `[引用]` 前缀
  - Agent 可针对历史消息进行追问和上下文延续

#### ⚙️ 工程优化（3 项）

- **🧠 Reasoning 展示优化**：默认折叠，streaming 时自动展开，完成后显示字数统计
- **🛡️ 模型熔断器**：连续失败 3 次自动熔断，10 分钟后恢复探测，区分模型错误/网络超时
- **📐 工具定义统一规范**：标准化 name/description/parameters/examples 字段，启动校验缺失字段

#### 🛡️ 安全性与稳定性修复（22 项 Bug + 中断恢复）

**Critical 安全漏洞修复（4 项）**

- 🔒 **跨用户数据泄露**：`collectFolderFiles` 增加 userId 过滤，防止文件夹遍历越权
- 💥 **WebDAV OOM 崩溃**：DELETE/MOVE/COPY 改用 SQL 查询，消除全量内存加载
- ⏱️ **时序攻击防护**：分享密码比对使用 `timingSafeEqual()` 常量时间比较 + KV 限流
- 🚫 **CSRF 绕过修复**：CORS fallback 拒绝未知 origin 而非回退到白名单首项

**High 严重问题修复（6 项）**

- 🛡️ **Token 缓存泄漏**：Query Token 认证路径添加 `Cache-Control: private, no-store`
- 🔒 **sortBy SQL 注入**：新增字段白名单 + switch 安全映射
- 💾 **流式下载 OOM**：share 下载改为 Response body 直接透传
- 🔄 **TOCTOU 竞态条件**：下载计数改用原子 CAS 单条 SQL 完成
- 🔐 **WebDAV 暴力破解防护**：IP 维度 KV 速率限制（5min/10次）
- 🔗 **直链滥用限制**：IP+Token 双维度速率限制（60次/分钟）

**Medium/Low 问题修复（8 项）**

- 广播过滤器逻辑修正、错误码去重、类型安全强化、权限常量提取、缩略图参数校验、ESM 冗余清理、魔术数字常量化

**AI 对话中断恢复**

- ✅ 流式输出中断时保留已输出内容（不再丢失）
- ✅ 显示"输出已中断"状态提示 + "重新生成"按钮
- ✅ API 层统一 AbortError 处理 + signal 检查

#### 📊 额外稳定性修复（7 项）

- 🔴 **storageUsed 竞态条件**：tasks.ts/downloads.ts 统一原子方法 `updateUserStorage()`，消除并发丢失更新
- 🔴 **文件列表分页**：SQL ORDER BY + limit/offset 分页，消除 D1 1000 行截断
- 🟡 **softDelete 配额释放**：软删除时立即扣减 storageUsed，不再等 cron 硬删除
- 🟡 **JWT Refresh Token**：新增静默续期机制，移动端体验大幅改善
- 🟡 **Analytics SQL 聚合**：GROUP BY 替代全量拉取，性能提升 10x+
- 🟡 **分享上传配额校验**：增加 owner 的 storageUsed 检查，堵住配额绕过漏洞
- 🔵 **LIKE 搜索转义**：% 和 \_ 自动转义，消除通配符误匹配

#### ⚡ 性能优化（5 项）

- 文件列表排序移至 SQL（配合分页）
- AI 任务队列 per-user 并发背压控制
- cleanup.ts 分批硬删除（防 cron 超时）
- WebDAV 原子化 storageUsed
- 向量索引断点续传

#### 🆕 新增功能（6 项）

| 功能           | 说明                             |
| -------------- | -------------------------------- |
| 文件夹大小统计 | 前端详情面板展示递归占用空间     |
| 增量向量索引   | 上传自动触发索引，新文件立即可搜 |
| Zip 打包下载   | 文件夹一键打包下载               |
| 文件访问日志   | 文件维度访问记录查看             |
| 标签全局管理页 | 合并/重命名/批量删除             |
| AI 对话导出    | Markdown/PDF 一键导出            |

> 完整修复清单请参阅 [CHANGELOG.md](CHANGELOG.md) 的 v4.7.0 章节。

### 历史版本 v4.6.0 - 用户体验全面优化与AI能力增强 🚀

**核心更新**：

- 🤖 **AI 模型库大幅扩展**：从 16 个厂商约 50 个模型扩展到 **80+ 个模型**，覆盖 2025 年最新推理模型
- 🧠 **新增主流推理模型**：
  - OpenAI: o3 Mini、GPT-5
  - Anthropic: Claude Sonnet 4、Claude Opus 4.1
  - Google: Gemini 2.5 Pro、Gemini 3
  - 百度: ERNIE X1 (深度思考)、ERNIE 4.5 Turbo
  - 阿里: Qwen3 235B (256K上下文)
  - 字节: 豆包 Seed 1.6/2.0 Pro (深度思考)
  - MiniMax: M1/M2.5/M2.7 推理模型系列
  - 月之暗面: Kimi K2 Thinking/K2.5
  - 智谱: GLM-5 (200K上下文)
- ⚡ **Agent 引擎增强**：
  - 新增 `maxContextTokens` 配置（默认 100K tokens）
  - 智能 Token 预算管理，动态裁剪历史消息
  - 改进 Native → Prompt-Based 降级机制，容错性更强
  - 完善的 Token 估算（中英文自适应）
- 🔧 **模型网关增强**：
  - 支持 `providerId` 字段，模型可归属特定提供商
  - 支持 `sortOrder` 字段，自定义模型显示顺序
  - 新增 `isReadonly` 只读模式标记
  - 完整的 thinking 配置字段解析
- 🌐 **API 完善**：
  - 新增设置默认提供商接口
  - 提供商管理支持排序和激活状态

**模型能力统计**：

| 能力类型       | 模型数量 | 代表模型                                                                  |
| -------------- | -------- | ------------------------------------------------------------------------- |
| **推理/思考**  | 25+      | GPT-5, o3 Mini, Claude Opus 4.1, Gemini 3, DeepSeek R1, GLM-5, Qwen3 235B |
| **视觉多模态** | 20+      | GPT-4o, Claude Sonnet 4, Gemini 2.5 Pro, Qwen3 235B, ERNIE 4.5 Turbo      |
| **长上下文**   | 15+      | Gemini 3 (2M), Gemini 2.5 Pro (2M), GLM-5 (200K), Kimi K2.5 (128K)        |
| **代码专用**   | 5+       | Codestral, QwQ 32B                                                        |
| **嵌入向量**   | 2        | BGE-M3, Mistral Embed                                                     |

详细说明请参阅 [docs/AI_FEATURES.md](docs/AI_FEATURES.md) 和 [docs/API_AI.md](docs/API_AI.md)。

更多历史版本请参阅 [CHANGELOG.md](CHANGELOG.md)。

---

## ✨ 功能特性

- 📁 **文件管理**: 文件上传、下载、预览、移动、重命名、删除
- 🪣 **多存储支持**: 支持 Cloudflare R2、AWS S3、阿里云 OSS、腾讯云 COS、华为云 OBS、Backblaze B2、MinIO 等
- 📦 **Telegram 存储**: 通过 Telegram Bot API 存储文件，支持大文件分片上传（最大 2GB）
- 🔄 **大文件上传**: 分片上传、断点续传、秒传
- 🔗 **文件分享**: 支持文件/文件夹分享，密码保护、过期时间、下载次数限制
- 👁️ **分享预览**: 分享页面支持图片、视频、音频、PDF、文本等文件在线预览
- 🔗 **文件直链**: 为文件生成公开访问直链，支持设置有效期，无需登录即可访问
- 📤 **上传链接**: 创建公开上传链接，允许他人无需登录上传文件到指定文件夹
- 📁 **文件夹上传**: 支持拖拽上传整个文件夹，自动重建目录结构
- 📧 **邮件通知系统 v4.0.0**:
  - 注册邮箱验证、邮箱更换确认
  - 忘记密码邮件重置
  - 用户可自定义邮件通知偏好（@提及、分享接收、配额警告、AI完成、系统通知）
  - 管理员可群发系统公告邮件
  - Resend API 集成，支持邮件模板
- 📝 **文件预览**: 图片、视频、音频、PDF、Office 文档、代码高亮、EPUB 电子书、字体文件、ZIP 压缩包、CSV 表格
  - **图片**: JPEG/PNG/GIF/WebP/SVG/BMP/TIFF
  - **视频**: MP4/WebM/OGG/MOV/AVI/MKV
  - **音频**: MP3/WAV/OGG/AAC/FLAC/M4A
  - **PDF**: 分页预览、缩放控制
  - **Office**: Word/Excel/PowerPoint 本地渲染
  - **代码**: 50+ 编程语言语法高亮
  - **Markdown**: GFM 语法、数学公式、代码高亮
  - **EPUB**: 电子书阅读器、目录导航
  - **字体**: TTF/OTF/WOFF/WOFF2 字符预览
  - **ZIP**: 压缩包内容列表、文件树展示
  - **CSV**: 表格视图、搜索、排序、分页
- 📜 **版本控制**: 可编辑文本文件的版本历史管理、版本回滚（仅支持代码、配置、Markdown 等文本文件）
- 🔐 **权限管理 v2**: 用户组管理、权限继承、时效性权限、RBAC 权限模型
- 🏢 **团队协作 v5.0.0**:
  - 团队空间：创建团队作为协作组织单元
  - 成员管理：四级角色体系（owner/admin/member/guest）
  - 资源挂载：将个人文件挂载到团队空间共享访问
  - 角色模板：viewer/editor/manager 一键授权替代手动设置
  - 权限申请与审批：成员发起申请 → 管理员审批 → 自动授权工作流
  - 批量权限操作：多文件一次性授权/撤销
  - 详细说明: [CHANGELOG.md](CHANGELOG.md) 的 v5.0.0 章节
- 🔑 **API Keys**: 创建和管理 API 密钥，支持细粒度权限控制，实现程序化访问
- 🌐 **RESTful v1 API**: 标准化 API 接口，支持 OpenAPI 文档和 Swagger UI
- 🔔 **Webhook**: 文件事件订阅，支持第三方系统集成
- 💬 **文件笔记**: 为文件添加评论和笔记，支持 @提及和回复
- 🏷️ **标签系统**: 为文件添加自定义标签
- 🔍 **高级搜索**: 按名称、类型、大小、时间等条件搜索，支持 FTS5 全文搜索
- ⭐ **收藏夹**: 快速收藏文件/文件夹，侧边栏快捷访问
- 📊 **存储分析**: 存储空间分布、活跃度热力图、大文件排行
- 🔔 **通知系统**: 实时通知、已读未读管理

<details>
<summary>📋 通知触发场景</summary>

| 场景           | 通知类型                                | 触发条件                               |
| -------------- | --------------------------------------- | -------------------------------------- |
| **文件分享**   | `share_received`                        | 分享链接被下载时通知文件所有者         |
|                | `upload_link_received`                  | 上传链接收到新文件时通知链接创建者     |
| **笔记互动**   | `mention`                               | 笔记中 @提及其他用户（需输入完整邮箱） |
|                | `reply`                                 | 笔记被回复时通知原笔记作者             |
| **权限授予**   | `permission_granted`                    | 被授予文件/文件夹权限时通知被授予者    |
|                | `permission_granted_to`                 | 权限授予成功时通知授予者               |
| **AI 处理**    | `ai_complete`                           | AI 摘要/标签生成完成时通知             |
| **文件操作**   | `file_uploaded`                         | 文件上传成功                           |
|                | `file_downloaded`                       | 文件下载成功                           |
|                | `file_deleted` / `folder_deleted`       | 文件/文件夹移入回收站                  |
|                | `file_starred` / `file_unstarred`       | 收藏/取消收藏                          |
| **存储桶管理** | `bucket_created`                        | 存储桶创建成功                         |
|                | `bucket_updated`                        | 存储桶配置更新                         |
|                | `bucket_deleted`                        | 存储桶删除                             |
| **Webhook**    | `webhook_created` / `deleted`           | Webhook 创建/删除                      |
| **API Key**    | `apikey_created` / `deleted`            | API Key 创建/删除                      |
| **账户安全**   | `password_changed`                      | 密码更改成功（安全提醒）               |
| **系统管理**   | `invite_code_created`                   | 邀请码生成                             |
|                | `registration_opened` / `closed`        | 注册开放/关闭                          |
|                | `invite_registration_opened` / `closed` | 邀请码注册开放/关闭                    |

</details>

- 🤖 **AI 功能 v4.6.0 全面升级**:
  - **用户体验优化**：5项非AI功能改进（详情面板、换桶操作、移动端全屏预览等）v4.6.0 新增
  - **对话式权限管理**：自然语言授权、过期时间管理、已过期权限查询 v4.6.0 新增
  - **对话式文件创建**：草稿预览、多轮起草流程、DraftPreview组件 v4.6.0 新增
  - **智能整理建议**：四维度分析（命名/标签/归类/结构）、可执行建议 v4.6.0 新增
  - **文件集合分析**：多场景分析（对比/总结/时间脉络）、aiSummary代理 v4.6.0 新增
  - **懒加载优化**：路由级代码分割、虚拟滚动、图片懒加载，首屏加载减少40%+ v4.6.0 新增
  - **模型库大幅扩展**：16 个厂商 **80+ 个模型**，覆盖 2025 年最新推理/视觉/长上下文模型
  - Agent 引擎：ReAct 架构，多轮推理，链式调用，Token 预算管理（v4.5.0 增强）
  - 95+ 个智能工具：覆盖文件操作、权限管理、分享链接等 13+ 个模块（v4.6.0 扩展）
  - 智能意图识别：自动识别搜索、视觉、内容理解等意图
  - 视觉分析增强：图片搜索结果自动触发视觉分析链路
  - 写操作确认：敏感操作需用户确认后执行
  - 提供商管理：16 个系统内置提供商 + 用户自定义（v4.4.0）
  - Thinking Config：各提供商独立推理模式配置（v4.4.0）
  - 模型分组展示：按提供商分组，支持排序（v4.4.0）
  - 对话记录增强：支持工具调用和推理内容存储（v4.4.0）
  - 多模型支持：Workers AI（9个模型）+ OpenAI 兼容 API + 80+ 预设模型
  - AI 对话系统：SSE 流式响应、会话管理、RAG 文件问答
  - 文件摘要生成（可配置专用模型）
  - 图片智能描述 + 标签生成（需 vision 能力模型）
  - 语义搜索（Vectorize 向量索引）
  - 智能重命名建议
  - 批量操作优化（取消+超时+错误限制）
  - 详细说明: [docs/AI_FEATURES.md](docs/AI_FEATURES.md)
- 📥 **离线下载**: 支持 URL 离线下载到云存储
- 📡 **WebDAV**: 完整的 WebDAV 协议支持（优化 Windows 资源管理器兼容性）
- 🔄 **存储桶迁移**: 支持在不同存储桶之间迁移文件（跨 provider）
- 💾 **文件去重**: Copy-on-Write 机制，相同文件只存储一份
- 👥 **多用户**: 用户管理、存储配额、审计日志
- ⏰ **定时任务**: 自动清理回收站、过期分享
- 🗑️ **回收站**: 删除文件进入回收站，30 天保留期，支持恢复

### 🪣 支持的存储提供商

| 提供商        | 说明     | 特点           |
| ------------- | -------- | -------------- |
| Cloudflare R2 | 推荐     | 无出站流量费用 |
| AWS S3        | 标准兼容 | 全球部署       |
| 阿里云 OSS    | 国内优化 | 低延迟         |
| 腾讯云 COS    | 国内优化 | 低延迟         |
| 华为云 OBS    | 国内优化 | 低延迟         |
| Backblaze B2  | 高性价比 | 免费额度       |
| MinIO         | 私有部署 | 完全控制       |
| Telegram      | 免费     | 最大 2GB       |

---

## 🔧 技术栈

| 组件   | 技术                                                  |
| ------ | ----------------------------------------------------- |
| 前端   | React 18 + Vite 5 + Tailwind CSS 3                    |
| 后端   | Hono 4 + Cloudflare Workers                           |
| 数据库 | Cloudflare D1 (SQLite) + Drizzle ORM                  |
| 存储   | S3 兼容协议 + Telegram Bot API                        |
| AI     | Cloudflare Workers AI + Vectorize + OpenAI Compatible |
| 认证   | JWT + bcrypt                                          |
| 邮件   | Resend API (v4.0.0+)                                  |

---

## ⚙️ 系统限制

以下常量定义于 `packages/shared/src/constants/index.ts` 和 `apps/api/src/lib/` 目录：

### 文件限制

| 常量                       | 值     | 说明                  | 定义位置                |
| -------------------------- | ------ | --------------------- | ----------------------- |
| `MAX_FILE_SIZE`            | 5 GB   | S3 兼容存储单文件最大 | shared/constants        |
| `DEFAULT_STORAGE_QUOTA`    | 10 GB  | 默认存储配额          | shared/constants        |
| `UPLOAD_CHUNK_SIZE`        | 10 MB  | S3 分片大小           | shared/constants        |
| `MULTIPART_THRESHOLD`      | 100 MB | S3 分片上传阈值       | shared/constants        |
| `MAX_CONCURRENT_PARTS`     | 3      | 最大并发分片数        | shared/constants        |
| `TG_MAX_FILE_SIZE`         | 50 MB  | Telegram 直传上限     | api/lib/telegramClient  |
| `TG_CHUNKED_THRESHOLD`     | 49 MB  | Telegram 分片阈值     | api/lib/telegramClient  |
| `TG_CHUNK_SIZE`            | 30 MB  | Telegram 分片大小     | api/lib/telegramChunked |
| `TG_MAX_CHUNKED_FILE_SIZE` | 2 GB   | Telegram 最大文件     | api/lib/telegramClient  |

### 时间限制

| 常量                    | 值      | 说明              |
| ----------------------- | ------- | ----------------- |
| `JWT_EXPIRY`            | 7 天    | JWT 有效期        |
| `WEBDAV_SESSION_EXPIRY` | 30 天   | WebDAV 会话有效期 |
| `SHARE_DEFAULT_EXPIRY`  | 7 天    | 分享默认有效期    |
| `TRASH_RETENTION_DAYS`  | 30 天   | 回收站保留天数    |
| `DEVICE_SESSION_EXPIRY` | 30 天   | 设备会话有效期    |
| `UPLOAD_TASK_EXPIRY`    | 24 小时 | 上传任务有效期    |

### 安全限制

| 常量                     | 值      | 说明             |
| ------------------------ | ------- | ---------------- |
| `LOGIN_MAX_ATTEMPTS`     | 5 次    | 最大登录尝试次数 |
| `LOGIN_LOCKOUT_DURATION` | 15 分钟 | 登录锁定时长     |

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0
- **Cloudflare 账户**（免费账户即可）

### 本地开发

```bash
# 1. 克隆项目
git clone https://github.com/your-repo/ossshelf.git
cd ossshelf

# 2. 安装依赖
pnpm install

# 3. 创建 Cloudflare 资源（本地开发）
wrangler login
wrangler d1 create ossshelf-db
wrangler kv:namespace create KV

# 4. 配置 wrangler.toml
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
# 编辑 wrangler.toml，填入 D1 数据库 ID 和 KV 命名空间 ID

# 5. 运行数据库迁移
pnpm db:migrate

# 6. 启动开发服务器
pnpm dev:api  # API 服务 (http://localhost:8787)
pnpm dev:web  # 前端服务 (http://localhost:5173)
```

### 访问地址

| 服务   | 地址                      |
| ------ | ------------------------- |
| 前端   | http://localhost:5173     |
| API    | http://localhost:8787     |
| WebDAV | http://localhost:8787/dav |

---

## 📦 部署指南

详细的部署文档请参阅 [docs/deployment.md](docs/deployment.md)。

### 前置准备

1. **Cloudflare 账户** - 注册 [Cloudflare](https://dash.cloudflare.com/sign-up)
2. **域名**（可选）- 绑定自定义域名
3. **存储服务** - 准备好至少一个存储提供商的凭证

### 一键部署步骤

```bash
# Step 1: 创建生产资源
wrangler d1 create ossshelf-db
wrangler kv:namespace create KV --preview false

# 记录输出的 database_id 和 id，填入 wrangler.toml
```

```bash
# Step 2: 配置 wrangler.toml
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
```

编辑 `apps/api/wrangler.toml`：

```toml
name = "ossshelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "你的D1数据库ID"  # ← 替换这里

[[kv_namespaces]]
binding = "KV"
id = "你的KV命名空间ID"  # ← 替换这里

[vars]
ENVIRONMENT = "production"
JWT_SECRET = "生成一个强随机字符串"  # ← 替换这里
CORS_ORIGINS = "https://your-frontend.pages.dev"  # ← 替换为你的前端域名

[triggers]
crons = ["0 3 * * *"]  # 每天凌晨3点清理
```

```bash
# Step 3: 设置加密密钥（用于加密存储桶凭证）
wrangler secret put ENCRYPTION_KEY
# 输入一个32字节的随机字符串，例如: openssl rand -base64 32

# Step 4: 运行数据库迁移
pnpm db:migrate

# Step 5: 部署 API
pnpm deploy:api

# Step 6: 构建并部署前端
pnpm build:web
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

### 部署验证

```bash
# 检查 API 是否正常运行
curl https://your-api.workers.dev/api/auth/registration-config

# 应返回: {"success":true,"data":{"open":true,"requireInviteCode":false}}
```

### 环境变量说明

| 变量名           | 必填 | 说明                                           |
| ---------------- | ---- | ---------------------------------------------- |
| `JWT_SECRET`     | ✅   | JWT 签名密钥，建议 32+ 字符随机字符串          |
| `ENCRYPTION_KEY` | ✅   | 存储桶凭证加密密钥，32 字节                    |
| `PUBLIC_URL`     | ⚪   | 应用公网地址，用于生成文件直接访问链接（可选） |
| `CORS_ORIGINS`   | ✅   | CORS 允许域名，多个用逗号分隔                  |

---

## 📖 使用说明

### 首次使用

> **重要**: 第一个注册的用户自动成为管理员，拥有完整管理权限。

### 存储桶配置

1. 登录后进入「设置」→「存储桶」
2. 点击「添加存储桶」
3. 选择存储提供商并填写配置：

#### Cloudflare R2 配置示例

```json
{
  "provider": "r2",
  "bucketName": "my-bucket",
  "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
  "region": "auto",
  "accessKeyId": "你的 Access Key ID",
  "secretAccessKey": "你的 Secret Access Key"
}
```

#### Telegram 配置步骤

1. 通过 [@BotFather](https://t.me/BotFather) 创建 Bot，获取 Token
2. 创建频道或群组，将 Bot 添加为管理员
3. 获取 Chat ID（转发消息到 [@userinfobot](https://t.me/userinfobot)）
4. 在存储桶管理中选择 Telegram 提供商：

```json
{
  "provider": "telegram",
  "bucketName": "Chat ID（如 -1001234567890）",
  "accessKeyId": "Bot Token（如 123456:ABC-DEF...）",
  "secretAccessKey": "telegram-no-secret"
}
```

### 文件上传

| 方式       | 说明                           |
| ---------- | ------------------------------ |
| 拖拽上传   | 直接拖入页面                   |
| 点击上传   | 点击上传按钮选择文件           |
| 文件夹上传 | 支持上传整个文件夹             |
| 大文件     | ≥ 100MB 自动分片，支持断点续传 |

### 文件分享

1. 右键点击文件/文件夹 → 选择「分享」
2. 设置选项：
   - 密码保护（可选）
   - 过期时间（可选）
   - 下载次数限制（可选）
3. 复制分享链接

### WebDAV 连接

| 配置项     | 值                            |
| ---------- | ----------------------------- |
| 服务器地址 | `https://your-domain.com/dav` |
| 用户名     | 注册邮箱                      |
| 密码       | 账户密码                      |
| 认证方式   | Basic Auth                    |

**Windows 资源管理器连接**：

1. 打开「此电脑」
2. 点击「映射网络驱动器」
3. 输入 WebDAV 地址
4. 输入邮箱和密码

### 管理员功能

管理员可在「管理」页面：

- 管理所有用户（查看、编辑配额、重置密码、删除）
- 控制注册开关（开放/关闭注册）
- 生成和管理邀请码
- 配置邮件服务（Resend API、发件人设置）(v4.0.0+)
- 发送测试邮件验证配置 (v4.0.0+)
- 群发系统公告邮件 (v4.0.0+)
- 查看系统统计和审计日志
- 创建和管理团队空间 (v5.0.0)

---

## 📁 项目结构

```
ossshelf/
├── apps/
│   ├── api/                    # 后端 API 服务
│   │   ├── src/
│   │   │   ├── db/             # 数据库连接与 Schema
│   │   │   ├── lib/            # 核心库（AI、存储、权限等）
│   │   │   ├── middleware/     # 中间件
│   │   │   ├── routes/         # API 路由（含 teams.ts / permissions.ts 扩展）
│   │   │   └── index.ts        # 入口
│   │   ├── migrations/         # 数据库迁移（按功能模块分类）
│   │   └── wrangler.toml       # Cloudflare 配置
│   └── web/                    # 前端应用
│       └── src/
│   │           ├── components/     # UI 组件（含 teams/ / permissions/ 协作组件）
│           ├── pages/          # 页面组件
│           ├── hooks/          # 自定义 Hooks
│           ├── services/       # API 服务
│           └── stores/         # 状态管理
├── packages/
│   └── shared/                 # 共享代码（常量、类型等）
└── docs/                       # 文档
```

详细架构请参阅 [docs/architecture.md](docs/architecture.md)。

---

## 📚 API 文档

详细的 API 文档请参阅 [docs/api.md](docs/api.md)。

### API 路由概览

| 路由前缀             | 说明                                  |
| -------------------- | ------------------------------------- |
| `/api/auth`          | 用户认证、邮箱验证、密码重置          |
| `/api/files`         | 文件管理                              |
| `/api/buckets`       | 存储桶管理                            |
| `/api/share`         | 文件分享                              |
| `/api/direct`        | 文件直链                              |
| `/api/presign`       | 预签名 URL                            |
| `/api/tasks`         | 上传任务                              |
| `/api/downloads`     | 离线下载                              |
| `/api/batch`         | 批量操作                              |
| `/api/search`        | 文件搜索                              |
| `/api/permissions`   | 权限与标签 + 团队权限/批量操作/审批流（v5.0.0 扩展）         |
| `/api/preview`       | 文件预览                              |
| `/api/versions`      | 版本控制                              |
| `/api/notes`         | 文件笔记                              |
| `/api/api-keys`      | API Keys 管理                         |
| `/api/groups`        | 用户组管理                            |
| `/api/teams`          | 团队空间管理（v5.0.0 新增）            |
| `/api/roles/templates`| 角色模板查询（v5.0.0 新增）           |
| `/api/webhooks`      | Webhook 管理                          |
| `/api/ai`            | AI 文件处理功能 (v4.3.0 增强)         |
| `/api/ai-config`     | AI 配置管理、系统配置 (v4.3.0 增强)   |
| `/api/ai-chat`       | AI 对话系统、Agent 引擎 (v4.3.0 增强) |
| `/api/analytics`     | 存储分析                              |
| `/api/notifications` | 通知系统                              |
| `/api/v1`            | RESTful v1 API                        |
| `/api/v1/docs`       | OpenAPI 文档                          |
| `/api/admin`         | 管理员接口、邮件配置                  |
| `/api/migrate`       | 存储桶迁移                            |
| `/api/telegram`      | Telegram 存储                         |
| `/cron`              | 定时任务                              |
| `/dav`               | WebDAV                                |

---

## 💻 开发命令

```bash
# 开发
pnpm dev:web      # 启动前端开发服务器
pnpm dev:api      # 启动 API 开发服务器

# 构建
pnpm build:web    # 构建前端
pnpm build:api    # 构建 API

# 部署
pnpm deploy:api   # 部署 API 到 Cloudflare Workers

# 数据库
pnpm db:generate  # 生成数据库迁移
pnpm db:migrate   # 运行数据库迁移（生产）
pnpm db:studio    # 打开 Drizzle Studio

# 代码质量
pnpm lint         # 运行 ESLint
pnpm lint:fix     # 自动修复 ESLint 问题
pnpm format       # 格式化代码
pnpm typecheck    # 类型检查
```

---

## ❓ 常见问题

### Q: 忘记密码怎么办？

A: v4.0.0+ 版本支持邮件重置密码。在登录页面点击"忘记密码"，输入注册邮箱即可收到重置链接。如果是管理员且邮件服务未配置，需要通过数据库直接修改密码哈希。

### Q: 邮箱验证有什么用？

A: 邮箱验证是v4.0.0新增的安全功能。验证邮箱后才能使用部分功能（可配置），同时支持密码重置、邮箱更换等安全操作。

### Q: 如何配置邮件服务？

A: v4.0.0+ 集成了Resend邮件服务。管理员在管理面板→邮件配置中配置Resend API Key和发件人信息即可启用邮件功能。

### Q: 文件删除后能恢复吗？

A: 文件删除后进入回收站，保留 30 天。在此期间可以从回收站恢复。

### Q: 存储配额不够怎么办？

A: 联系管理员增加配额，或清理不需要的文件。

### Q: Telegram 存储有什么限制？

A: 单文件最大 2GB，无法真正删除文件（仅删除消息引用），需要稳定的网络连接。

### Q: WebDAV 连接失败？

A:

1. 确认用户名密码正确（用户名是注册邮箱）
2. 检查 Basic Auth 是否启用
3. 确认 Workers 域名已配置 SSL

### Q: 上传失败？

A:

1. 检查存储桶配置是否正确
2. 确认 Access Key/Secret Key 权限
3. 检查 CORS 配置

### Q: 定时任务不执行？

A:

1. 确认 Cron Triggers 已配置
2. 检查 wrangler.toml 中的 crons 配置
3. 查看 Workers 日志排查错误

---

## 🔄 更新流程

如果你 Fork 了本项目，当上游有更新时：

```bash
# 1. 添加上游仓库（仅需一次）
git remote add upstream https://github.com/original-repo/ossshelf.git

# 2. 拉取上游更新
git fetch upstream
git merge upstream/main

# 3. 检查是否有新的数据库迁移文件
ls apps/api/migrations/

# 4. 如果有新的迁移文件，执行迁移
pnpm db:migrate

# 5. 重新部署
pnpm deploy:api
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

---

## 📄 许可证

[MIT](LICENSE)

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐️ Star 支持一下！**

</div>
