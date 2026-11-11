# OSSshelf 部署文档

本文档基于项目实际配置文件，提供完整的部署指南，确保您能够一次性成功部署 OSSshelf。

**当前版本**: v3.2.0

---

## 📋 目录

- [部署架构概览](#部署架构概览)
- [版本更新说明](#版本更新说明)
- [环境要求](#环境要求)
- [快速部署](#快速部署)
- [GitHub Secrets 配置](#github-secrets-配置)
- [Worker 构建与部署](#worker-构建与部署)
- [GitHub Actions 迁移与部署编排](#github-actions-迁移与部署编排)
- [邮件服务配置](#邮件服务配置)
- [存储提供商配置](#存储提供商配置)
- [自定义域名](#自定义域名)
- [性能优化](#性能优化)
- [监控与日志](#监控与日志)
- [备份与恢复](#备份与恢复)
- [故障排查](#故障排查)
- [安全建议](#安全建议)
- [更新部署](#更新部署)

---

## 部署架构概览

前后端合并为**单个 Cloudflare Worker**（`ossshelf-api`）承载：前端静态资源通过 Workers
静态资源绑定（`[assets]`）发布，API、WebDAV、SSE、Agent Durable Object 走同一 Worker。
前端与 API 同源，前端默认用相对路径请求 `/api`，不再需要 `VITE_API_URL`。

| 组件          | 部署平台                     | 触发方式                                            |
| ------------- | ---------------------------- | --------------------------------------------------- |
| 前端静态资源  | Cloudflare Workers `[assets]` | Workers Builds（由 Deploy Hook 触发）               |
| API / WebDAV  | Cloudflare Workers           | 同上，同一 Worker                                   |
| D1 迁移       | GitHub Actions               | push 命中 `apps/api/**`、`apps/web/**` 等路径时执行 |

```
                    ┌──────────────────────────────┐
                    │         GitHub 仓库           │
                    │      (push to main 分支)      │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │       GitHub Actions          │
                    │  1. typecheck / 单测          │
                    │  2. 生成 wrangler.toml        │
                    │  3. D1 预检 + 迁移            │
                    │  4. POST Deploy Hook ─────┐   │
                    └───────────────────────────┼───┘
                                                │
                    ┌───────────────────────────▼──────────────┐
                    │            Workers Builds                │
                    │  build: pnpm build:web                   │
                    │  deploy: npx wrangler deploy             │
                    └───────────────────────────┬──────────────┘
                                                │
                    ┌───────────────────────────▼──────────────┐
                    │   Worker: ossshelf-api                   │
                    │   ├─ [assets]  apps/web/dist（SPA 回退）  │
                    │   └─ /api /dav /agents /cron /health      │
                    │  绑定: D1 / KV / Queue / DO / AI / Vectorize│
                    └──────────────────────────────────────────┘
```

顺序保证：**迁移成功之后才触发部署**，避免新代码跑在旧表结构上。因此 Workers Builds 的
推送构建必须用「构建监视路径不命中」挡掉（见下文），只保留 Deploy Hook 一条部署入口。

---

## 版本更新说明

详细的版本更新日志请参阅 [CHANGELOG.md](../CHANGELOG.md)。

### v3.0.0 (2026-06-08)

本次更新为**重大版本升级**，核心变化：权限管理系统重构为团队协作能力。

**团队协作功能（6 项）**

1. **团队管理** — 创建/编辑/删除团队，成员管理（添加/移除/角色变更）
2. **资源挂载** — 将文件/文件夹挂载到团队，成员自动获得继承权限
3. **角色模板** — viewer(只读)/editor(读写)/manager(管理) 三级角色
4. **权限申请审批** — 用户可申请访问权限，管理员审批后自动授权
5. **批量操作** — 批量授权/批量撤销（1-50 个文件）
6. **8 级权限解析链** — owner > user > group > team > inherited(user/group/team) > no access

**API 文档改造**

- 删除冗余的 `src/routes/v1` 目录（~800 行）
- 改为基于路由内省的自动文档生成（Scalar UI）
- 访问 `/api/docs` 查看在线 API 文档

**数据库迁移**

- 新增迁移文件 `100_team_collaboration.sql`
  - 新增 5 张表：teams、team_members、team_resources、permission_requests、role_templates
  - 扩展 file_permissions 表增加 team_id 字段

**升级步骤**

```bash
# 1. 拉取上游最新代码
git pull origin main

# 2. 部署
# push 后由 GitHub Actions 执行 D1 迁移，成功后触发 Workers Builds 构建部署
git push origin main
```

### v2.6.0 (2026-04-13)

本次更新包含用户体验全面优化和AI能力增强：

**非AI功能优化（5项）**

1. **移除复制/剪切，跨桶移动智能提示**
   - 删除复制/剪切/粘贴文件操作（避免数据错位）
   - 新增跨桶移动检测和确认引导
   - MoveFolderPicker 显示"将跨桶迁移"Badge

2. **简化展示模式 + 列表图片缩略图**
   - ViewMode 简化为 list/grid（删除 masonry/gallery）
   - 列表模式新增 40×40px 图片缩略图
   - 删除 GalleryItem.tsx 和 MasonryItem.tsx

3. **移动端预览全屏体验**
   - 底部操作栏默认隐藏（tap-to-toggle）
   - 移动端屏幕利用率提升30%+

4. **文件/文件夹详情面板**
   - 新增 GET /:id/detail API
   - FileDetailPanel 组件（Sheet 形式）
   - 右键菜单新增"详情"入口

5. **文件/文件夹换桶操作**
   - MigrateBucketDialog 组件
   - 右键菜单新增"换桶"入口
   - 支持单文件/文件夹粒度迁移

**AI功能增强（4项）**

1. **对话式权限管理**
   - grant_permission 新增 expiresInDays 参数
   - 新增 list_expired_permissions 工具

2. **对话式文件创建（含草稿预览）**
   - 新增 draft_and_create_file 工具
   - DraftPreview 组件支持多格式渲染

3. **智能整理建议**
   - 新增 smart_organize_suggest 工具
   - 四维度分析：命名、标签、归类、结构

4. **文件集合分析**
   - 新增 analyze_file_collection 工具
   - 支持多种分析类型（summary/compare/timeline等）

**性能优化**

- 懒加载功能：路由级代码分割、组件级懒加载、图片懒加载、虚拟滚动
- 首屏加载时间减少40%+
- 内存占用降低60%（大文件夹场景）

**已移除的功能**

- 复制/剪切/粘贴文件操作
- Masonry/Gallery 展示模式及相关组件

**升级步骤**

```bash
# 1. 拉取上游最新代码
git pull origin main

# 2. 部署
# push 后由 GitHub Actions 执行 D1 迁移，成功后触发 Workers Builds 构建部署
git push origin main
```

### v2.5.0 (2026-04-12)

本次更新包含 AI 模型库大幅扩展：

**核心变更**

1. **模型库扩展至80+个模型**
   - 覆盖16个厂商的最新推理/视觉/长上下文模型
   - 新增 OpenAI o3 Mini/GPT-5、Claude Sonnet 4/Opus 4.1 等

2. **Agent 引擎增强**
   - Token 预算管理（默认100K tokens）
   - 智能 Token 估算算法
   - 降级机制改进

3. **模型网关增强**
   - providerId 关联、排序功能、只读模式
   - Thinking 配置字段完善

### v2.2.0 (2026-04-06)

本次更新包含以下重要变更：

**新功能 - AI Agent 引擎与系统配置**

1. **Agent 引擎**
   - 支持 Function Calling 工具调用
   - 支持推理内容显示（DeepSeek R1、智谱 GLM、阿里 QwQ）
   - 内置工具：search_files、get_file_content、list_files、get_file_info

2. **AI 系统配置**
   - 可配置默认模型、参数、限制
   - 可配置重试策略、提示词模板
   - 功能开关控制

3. **向量库管理**
   - 查看和删除向量索引
   - 支持分页和搜索

4. **任务中心**
   - 统一显示所有任务状态
   - 实时进度监控

5. **全局 AI 聊天**
   - 悬浮式 AI 聊天组件
   - 支持会话切换

6. **自定义模型**
   - 支持任意 Workers AI 模型 ID

**数据库迁移**

- 新增迁移文件 `0021_ai_system_config.sql`
  - 新增 `ai_system_config` 表

**升级步骤**

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 运行数据库迁移
pnpm db:migrate

# 3. 推送触发部署
git push origin main
```

### v2.1.0 (2026-04-03)

本次更新包含以下重要变更：

**新功能 - AI 系统全面升级**

1. **多模型架构**
   - 支持 Workers AI（实时模型目录）+ OpenAI 兼容 API
   - Model Gateway Pattern 设计
   - 适配器模式可扩展

2. **AI 对话系统**
   - 全新 AI 对话页面 `/ai-chat`
   - Agents SDK WebSocket 流式响应
   - 会话管理与长期记忆
   - 向量 + FTS5 混合检索

3. **AI 配置中心**
   - 独立 AI 设置页面 `/ai-settings`
   - 模型管理、功能级配置
   - 一键启用、连接测试

4. **批量操作优化**
   - 支持取消操作
   - 超时控制
   - 错误限制

**数据库迁移**

- 新增迁移文件 `0020_ai_models_config.sql`
  - 新增 `ai_models` 表
  - 新增 `ai_chat_sessions` 表
  - 新增 `ai_chat_messages` 表

**升级步骤**

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 运行数据库迁移
pnpm db:migrate

# 3. 推送触发部署
git push origin main
```

### v2.0.0 (2026-04-02)

本次更新包含以下重要变更：

**新功能 - 邮件通知系统**

1. **注册邮箱验证**
   - 新用户注册后自动发送验证邮件
   - 邮箱验证链接有效期24小时
   - 首个注册用户（管理员）自动验证

2. **密码重置流程**
   - 忘记密码邮件重置功能
   - 重置链接有效期1小时
   - 防邮箱枚举攻击

3. **邮箱更换功能**
   - 更换邮箱需要验证新邮箱
   - 更换确认链接有效期1小时

4. **邮件偏好设置**
   - 用户可自定义邮件通知偏好
   - 支持5种通知类型

5. **管理面板邮件配置**
   - Resend API 配置界面
   - 发送测试邮件功能
   - 群发系统公告

**安全增强**

1. **JWT失效机制**
   - 密码修改后自动更新 `passwordChangedAt`
   - 密码重置后自动更新 `passwordChangedAt`
   - 登录时检查JWT是否失效

2. **Token安全**
   - Token使用SHA-256哈希存储
   - Token一次性使用机制
   - 重发验证邮件限流

**数据库迁移**

- 新增迁移文件 `0018_email.sql`
  - 新增 `email_tokens` 表
  - `users` 表新增 `email_verified` 字段
  - `users` 表新增 `email_preferences` 字段
  - `users` 表新增 `password_changed_at` 字段

**环境变量**

- 新增可选环境变量 `PUBLIC_URL`（用于生成文件直接访问链接）

**部署注意事项**

1. **配置邮件服务（可选）**

   如需使用邮件通知功能，在管理面板配置Resend即可，无需配置PUBLIC_URL

2. **执行数据库迁移**

   ```bash
   wrangler d1 execute ossshelf-db --file=./apps/api/migrations/0018_email.sql
   ```

3. **配置Resend邮件服务**
   - 注册Resend账号并验证域名
   - 在管理面板配置API Key和发件人信息

### v1.9.0 (2026-04-02)

- 迁移文件：`0014_ai_features.sql`

**升级步骤**

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 创建 Vectorize 索引（如果需要 AI 功能）
wrangler vectorize create ossshelf-vectors --dimensions=1024 --metric=cosine

# 3. 更新 wrangler.toml 配置
# 添加以下配置：
# [[vectorize]]
# binding = "VECTORIZE"
# index_name = "ossshelf-vectors"

# 4. 运行数据库迁移（重要！）
pnpm db:migrate

# 5. 推送触发部署
git push origin main
```

**AI 功能配置（可选）**

如果需要启用 AI 功能，需要在 Cloudflare Dashboard 中：

1. 启用 Workers AI
2. 创建 Vectorize 索引
3. 更新 wrangler.toml 配置

详细配置请参阅 [AI 功能配置](#ai-功能配置) 章节。

### v1.6.0 (2026-03-30)

本次更新包含以下重要变更：

**数据库迁移**

- 新增 `file_notes` 表用于文件笔记功能
- 新增 `api_keys` 表用于 API Key 管理
- 迁移文件：`0010_notes.sql`、`0011_api_keys.sql`

**升级步骤**

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 运行数据库迁移（重要！）
pnpm db:migrate

# 3. 推送触发部署
git push origin main
```

### v1.5.0 (2026-03-27)

本次更新包含以下重要变更：

**功能增强**

- 预览功能大幅强化，支持 EPUB、字体、ZIP、CSV 增强预览
- 预览大小限制从 10MB 提升至 30MB

**升级步骤**

```bash
git pull origin main
pnpm db:migrate
git push origin main
```

### v1.4.0 (2026-03-24)

本次更新包含以下重要变更：

**数据库迁移**

- 新增 `file_versions` 表用于文件版本控制
- 迁移文件：`0008_file_versions.sql`

**升级步骤**

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 运行数据库迁移（重要！）
pnpm db:migrate

# 3. 推送触发部署
git push origin main
```

---

## 环境要求

### 必需环境

| 软件    | 版本要求  | 说明              |
| ------- | --------- | ----------------- |
| Node.js | >= 20.0.0 | 推荐使用 LTS 版本 |
| pnpm    | >= 8.0.0  | 包管理器          |

### Cloudflare 资源

| 资源            | 说明                                  | 免费额度                 |
| --------------- | ------------------------------------- | ------------------------ |
| Cloudflare 账户 | 注册地址：https://dash.cloudflare.com | 免费                     |
| D1 数据库       | SQLite 数据库                         | 5GB 存储，500万行读取/天 |
| KV 命名空间     | 键值存储                              | 1GB 存储，10万次读取/天  |
| Workers         | 无服务器计算（含静态资源）             | 10万次请求/天            |
| Workers Builds  | 构建与部署（连接 GitHub）              | 按构建分钟计             |

### GitHub 资源

| 资源           | 说明                     |
| -------------- | ------------------------ |
| GitHub 仓库    | 用于托管代码和触发 CI/CD |
| GitHub Secrets | 存储敏感配置信息         |

---

## 快速部署

### Step 1: Fork 或克隆项目

将项目 Fork 到您的 GitHub 账户，或克隆后推送到您的仓库。

```bash
git clone https://github.com/your-username/ossshelf.git
cd ossshelf
```

### Step 2: 创建 Cloudflare 资源

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建 D1 数据库
wrangler d1 create ossshelf-db
# 记录输出的 database_id

# 创建 KV 命名空间
wrangler kv:namespace create KV --preview false
# 记录输出的 id

# (可选) 创建 R2 存储桶用于文件存储
wrangler r2 bucket create ossshelf-files
```

> **重要**: 请记录输出的 `database_id` 和 KV `id`，后续配置需要使用。

### Step 3: 配置 GitHub Secrets

在您的 GitHub 仓库中配置以下 Secrets：

**进入仓库 → Settings → Secrets and variables → Actions → New repository secret**

| Secret 名称                  | 说明                | 获取方式                               |
| ---------------------------- | ------------------- | -------------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | Cloudflare API 令牌 | [创建教程](#获取-cloudflare-api-token) |
| `CLOUDFLARE_ACCOUNT_ID`      | Cloudflare 账户 ID  | Dashboard 右侧边栏                     |
| `CLOUDFLARE_D1_DATABASE_ID`  | D1 数据库 ID        | Step 2 创建时获得                      |
| `CLOUDFLARE_KV_NAMESPACE_ID` | KV 命名空间 ID      | Step 2 创建时获得                      |
| `JWT_SECRET`                 | JWT 签名密钥        | 生成 32+ 字符随机字符串（仅首次手工写入 Worker） |
| `CORS_ORIGINS`               | CORS 允许域名       | Worker 访问域名；同源可留空，多个用逗号分隔 |
| `PUBLIC_URL`                 | 应用公网地址        | 用于生成直链，同源部署填 Worker 域名 |
| `CF_BUILDS_DEPLOY_HOOK`      | Workers Builds Deploy Hook | Worker → Settings → Builds → Deploy Hooks 创建后复制 URL |
| `TRASH_RETENTION_DAYS`       | 回收站保留天数      | 可选，默认 30                          |

> `CLOUDFLARE_D1_DATABASE_ID` 与 `CLOUDFLARE_KV_NAMESPACE_ID` 由 `scripts/generate-wrangler.mjs` 在 CI 中生成 `wrangler.toml` 时注入，配置文件本身不入库。
> Workers AI 实时模型目录的账户 ID 复用 `CLOUDFLARE_ACCOUNT_ID`（工作流注入为 `CF_ACCOUNT_ID`）；API Token 通过 `wrangler secret put CF_API_TOKEN` **手工**写入 Worker Secret，流水线不再每次重写。`CLOUDFLARE_API_TOKEN` 需要额外勾选 `Workers AI:Read`。

#### 获取 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击右上角头像 → My Profile → API Tokens
3. 点击「Create Token」
4. 选择「Edit Cloudflare Workers」模板
5. 配置权限：
   - Account Resources: Include → Your Account
   - Zone Resources: Include → All zones（或指定域名）
   - 如需 Workers AI 实时模型目录：Account → Workers AI → Read
6. 创建并复制 Token（填入 `CLOUDFLARE_API_TOKEN`；如需 Workers AI 实时模型目录，再手工执行 `wrangler secret put CF_API_TOKEN`）
7. 安全建议：模型目录可单独创建仅含 `Workers AI:Read` 的 Token，手工写入 Worker Secret `CF_API_TOKEN`，避免把部署 Token 暴露给 Worker

### Step 4: 运行数据库迁移

> **迁移只能通过 `wrangler d1 migrations apply` 或 CI 执行，禁止在 D1 控制台手工执行迁移 SQL。**
> 手工执行不会写入 `d1_migrations`，下一次 CI 会重复执行同一条迁移并因 `duplicate column name` 等错误失败。
> 已经手工执行过的库，请先按 [d1-112-repair.md](runbooks/d1-112-repair.md) 对齐 schema 与迁移记录。

首次部署前需要初始化数据库：

```bash
# 安装依赖
pnpm install

# 创建临时 wrangler.toml 用于本地迁移
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
# 编辑 wrangler.toml 填入实际的 database_id 和 KV id

# 运行迁移
pnpm db:migrate
```

部署前的迁移预检（CI 会在 `Apply D1 migrations` 之前自动执行，本地也可手动运行）：

```bash
cd apps/api
node scripts/preflight-migrations.mjs --remote   # 比对 d1_migrations 与真实 schema
node scripts/preflight-migrations.mjs --plan     # 只静态检查迁移文件，不连数据库
```

预检会输出具体的迁移文件、对象与修复提示：发现“对象已存在但迁移未记录”或“已记录但对象缺失”时直接失败，
避免部署进行到一半才报 SQLite 错误；IF NOT EXISTS 重复建对象等可容忍差异只输出警告。

迁移文件位于 `apps/api/migrations/`：

- `0001_init.sql` - 初始化表结构
- `0002_optimization.sql` - 性能优化索引
- `0003_folder_upload_types.sql` - 文件夹上传类型限制
- `0004_telegram_storage.sql` - Telegram 存储支持
- `0005_dedup_and_upload_links.sql` - 文件去重和上传链接
- `0006_upload_progress.sql` - 上传进度追踪
- `0007_phase7.sql` - 第七阶段功能
- `0008_direct_link.sql` - 文件直链功能
- `0009_file_versions.sql` - 文件版本控制 (v1.4.0)
- `0010_notes.sql` - 文件笔记 (v1.6.0)
- `0011_api_keys.sql` - API Keys (v1.6.0)
- `0012_permission_v2.sql` - 权限系统 v2 (v1.7.0)
- `0014_ai_features.sql` - AI 功能 (v1.8.0)
- `0015_notifications.sql` - 通知系统 (v1.9.0)
- `0016_fts5.sql` - FTS5 全文搜索 (v1.9.0)
- `0018_email.sql` - 邮件通知系统 (v2.0.0)
- `0020_ai_models_config.sql` - AI 模型配置 (v2.1.0)
- `0021_ai_system_config.sql` - AI 系统配置 (v2.2.0)
- `100_team_collaboration.sql` - 团队协作功能 (v3.0.0)

#### 新增迁移的自检清单

- [ ] 建表 / 建索引 / 建触发器使用 `IF NOT EXISTS`，删除对象使用 `IF EXISTS`
- [ ] 不使用已存在的对象名（新增索引/触发器前先确认命名不冲突）
- [ ] `ALTER TABLE ... ADD/DROP COLUMN` 无法幂等（SQLite 限制）：文件头写 `⚠️ 不可重复执行` 注释，
      并在 PR 里说明“该迁移只能依赖 `d1_migrations` 记录避免重跑”
- [ ] `node scripts/preflight-migrations.mjs --plan` 的输出中，除 ADD/DROP COLUMN 外没有其它不可重复语句
- [ ] 在空库上完整跑一遍：`wrangler d1 migrations apply ossshelf-db --local`
- [ ] 部署前 `node scripts/preflight-migrations.mjs --remote` 通过
- [ ] **不修改已发布（已在生产执行过）的迁移文件**：需要调整 schema 时新增一个迁移，而不是改历史文件

### Step 5: 设置运行时密钥

存储桶凭证使用 AES-GCM 加密，加密密钥由 `JWT_SECRET` 派生（SHA-256），**无需单独配置 `ENCRYPTION_KEY`**。只需设置 JWT 密钥：

```bash
wrangler secret put JWT_SECRET --name ossshelf-api
# 输入 32+ 字符随机密钥，例如: openssl rand -base64 32
```

### Step 6: 连接 Workers Builds（构建并部署同一个 Worker）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Workers & Pages → 选择 Worker `ossshelf-api` → Settings → Builds → Connect
3. 选择您的 GitHub 仓库，生产分支 `main`
4. 构建设置：
   - **根目录**: `apps/api`（wrangler 配置所在目录，也是构建与部署命令的运行目录）
   - **构建命令**: `cd .. && pnpm install --frozen-lockfile && pnpm build:web && node scripts/generate-wrangler.mjs`
   - **部署命令**: `npx wrangler deploy`
   - **构建监视路径**: 包含 `__none__`、排除 `*`（挡掉 push 触发的构建，只保留 Deploy Hook 入口）
   - **构建期环境变量**: `CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_KV_NAMESPACE_ID`、`PUBLIC_URL`、`CORS_ORIGINS`、`CF_ACCOUNT_ID`
5. Settings → Builds → Deploy Hooks：创建指向 `main` 的 Hook，URL 写入仓库 Secret `CF_BUILDS_DEPLOY_HOOK`

此后每次 push 命中工作流路径，Actions 先跑 D1 预检与迁移，成功后 POST Hook 触发构建部署；
不再有「push 自动构建」与「迁移」并发抢跑的问题。

### Step 7: 验证部署

```bash
# 测试 API（同源，静态资源与 API 在同一个 Worker 域名下）
curl https://ossshelf-api.your-subdomain.workers.dev/api/auth/registration-config

# 预期返回：
# {"success":true,"data":{"open":true,"requireInviteCode":false}}

# 前端与 API 同源
# 打开 https://ossshelf-api.your-subdomain.workers.dev
```

---

## GitHub Secrets 配置

### 必需 Secrets

| Secret 名称                  | 必需 | 说明                                           |
| ---------------------------- | ---- | ---------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | ✅   | Workers 部署权限                               |
| `CLOUDFLARE_ACCOUNT_ID`      | ✅   | Cloudflare 账户标识                            |
| `CLOUDFLARE_D1_DATABASE_ID`  | ✅   | D1 数据库绑定                                  |
| `CLOUDFLARE_KV_NAMESPACE_ID` | ✅   | KV 命名空间绑定                                |
| `JWT_SECRET`                 | ✅   | JWT 签名密钥                                   |
| `CORS_ORIGINS`               | ✅   | CORS 允许域名                                  |
| `PUBLIC_URL`                 | ⚪   | 应用公网地址，用于生成文件直接访问链接（可选） |

> Workers AI 模型目录无需新增必需 Secret：默认复用 `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`（需 `Workers AI:Read`）。也可额外配置 `CF_API_TOKEN`（仅 `Workers AI:Read`），工作流会优先使用它，并通过 `wrangler secret put` 写入 Worker Secret。

### 可选 Secrets

| Secret 名称            | 默认值 | 说明                                          |
| ---------------------- | ------ | --------------------------------------------- |
| `TRASH_RETENTION_DAYS` | 30     | 回收站文件保留天数                            |
| `ALERT_TG_BOT_TOKEN`   | -      | 告警 Telegram Bot Token，用于接收系统告警通知 |
| `ALERT_TG_CHAT_ID`     | -      | 告警 Telegram Chat ID，指定告警消息发送目标   |

#### 配置 Telegram 告警（可选）

如需接收系统告警通知（如定时任务执行失败、存储异常等），可配置 Telegram Bot：

1. **创建 Bot**：在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)，发送 `/newbot` 创建 Bot，记录返回的 Token
2. **获取 Chat ID**：
   - **个人消息**：直接使用你的 User ID（转发任意消息到 [@userinfobot](https://t.me/userinfobot) 获取），需要先向 Bot 发送 `/start`
   - **频道/群组**：创建频道或群组，将 Bot 添加为管理员，转发消息到 [@userinfobot](https://t.me/userinfobot) 获取 Chat ID（以 `-100` 开头）
3. **配置 Secrets**：将 Token 和 Chat ID 添加到 GitHub Secrets

### 配置示例

GitHub Actions 工作流位于 `.github/workflows/deploy-api.yml`，会自动读取这些 Secrets 并生成 `wrangler.toml`：

```yaml
# 工作流会生成以下配置
[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "${{ secrets.CLOUDFLARE_D1_DATABASE_ID }}"

[[kv_namespaces]]
binding = "KV"
id = "${{ secrets.CLOUDFLARE_KV_NAMESPACE_ID }}"

[vars]
PUBLIC_URL = "${{ secrets.PUBLIC_URL }}"
CORS_ORIGINS = "${{ secrets.CORS_ORIGINS }}"
TRASH_RETENTION_DAYS = "${{ secrets.TRASH_RETENTION_DAYS || '30' }}"
```

> `JWT_SECRET`、`ALERT_TG_BOT_TOKEN` 与 `CF_API_TOKEN` 属于敏感值，工作流会在部署后通过
> `wrangler secret put` 写入 Worker Secrets，不再出现在 `[vars]` 中。

---

## Worker 构建与部署

前端静态资源与 API 由同一个 Worker（`ossshelf-api`）承载，构建与部署统一交给 Workers Builds。

### 构建设置

| 配置项           | 值                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------- |
| 根目录           | `apps/api`（wrangler 配置所在目录，构建与部署命令都在此执行）                             |
| 构建命令         | `cd .. && pnpm install --frozen-lockfile && pnpm build:web && node scripts/generate-wrangler.mjs` |
| 部署命令         | `npx wrangler deploy`                                                                    |
| 构建监视路径     | 包含 `__none__`，排除 `*`                                                                |
| 构建期环境变量   | `CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_KV_NAMESPACE_ID`、`PUBLIC_URL`、`CORS_ORIGINS`、`CF_ACCOUNT_ID` |

`wrangler.toml` 不入库，由 `scripts/generate-wrangler.mjs` 在构建期生成到 `apps/api/wrangler.toml`；
脚本路径与 cwd 无关，输出位置固定，`npx wrangler deploy` 在 `apps/api` 下读取同一文件。

### 部署入口只有一条

| 触发方式                  | 行为                                                    |
| ------------------------- | ------------------------------------------------------- |
| push 到 main              | 监视路径全部排除 → 不构建（见下方例外说明）             |
| Deploy Hook（Actions POST）| 构建并部署，Build history 的 `Triggered by` 标记为 deploy hook |

例外：push 含 0 个文件变更、或 ≥3000 文件 / ≥20 commits 时会绕过监视路径强制构建。日常提交不受影响。

### 静态资源路由

```toml
[assets]
directory = "../web/dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api", "/api/*", "/dav", "/dav/*", "/agents", "/agents/*", "/cron", "/cron/*", "/health"]
```

`/api/*` 不匹配 `/api` 本身，因此裸路径与通配符都要列；否则浏览器直访会被 SPA 回退成 `index.html`。

### 查看部署状态

1. Dashboard → Workers & Pages → `ossshelf-api` → Deployments → Build history（`Triggered by` 列）
2. 同页 Version history：Active 版本对应的 commit 即当前线上代码

---

## GitHub Actions 迁移与部署编排

### 职责

工作流 `.github/workflows/deploy-api.yml` **只负责** 质量校验与 D1 迁移，部署通过 Deploy Hook 转交 Workers Builds：

| 步骤                              | 作用                                     |
| --------------------------------- | ---------------------------------------- |
| Install / Build shared / Typecheck / 单测 | 校验                          |
| Generate wrangler.toml            | 用 secrets 生成 `apps/api/wrangler.toml` |
| Preflight D1 migration state      | 拦截「手工改过但未记录」的 schema 漂移   |
| Apply D1 migrations               | 迁移到最新                               |
| Trigger Workers Builds deploy     | POST Hook，失败则整条 run 红且不部署     |

顺序语义：迁移任一步失败都不会发出 Hook，线上代码保持不变；`CF_BUILDS_DEPLOY_HOOK` 缺失时步骤显式报错退出。

Worker secrets（`JWT_SECRET` / `ALERT_TG_BOT_TOKEN` / `CF_API_TOKEN`）跨部署持久存在，
只在首次部署或轮换时手工执行 `wrangler secret put`（见 Step 5），流水线不再每次重写。

### 触发条件

- `apps/api/**`、`apps/web/**`、`packages/shared/**`、`scripts/**`
- 根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`
- `.github/workflows/deploy-api.yml`

纯前端改动同样会走完「迁移预检 → Hook → Builds 部署」。

### 手动触发

1. 进入 GitHub 仓库 → Actions → 「Deploy API to Cloudflare Workers」
2. 点击「Run workflow」，选择分支后运行（会重跑迁移并再次 POST Hook）

---

## 邮件服务配置

v2.0.0+ 版本集成了 Resend 邮件服务，用于邮箱验证、密码重置等功能。

### 1. 注册 Resend 账号

1. 访问 [https://resend.com](https://resend.com)
2. 点击 "Start for free" 注册账号
3. 验证您的邮箱

### 2. 添加并验证域名

1. 进入 Dashboard → [Domains](https://resend.com/domains)
2. 点击 "Add Domain"
3. 输入您的域名（例如：`yourdomain.com`）
4. 添加DNS记录验证域名：
   ```
   类型: MX
   名称: send
   值: feedback-smtp.us-east-1.amazonses.com
   ```
5. 等待验证完成（通常几分钟到几小时）

### 3. 获取 API Key

1. 进入 [API Keys](https://resend.com/api-keys)
2. 点击 "Create API Key"
3. 输入名称（例如：OSSShelf Production）
4. 选择权限：`Sending access`
5. 复制生成的API Key（以 `re_` 开头）

### 4. 在 OSSShelf 中配置

#### 方式一：通过管理面板配置（推荐）

1. 登录 OSSShelf 管理员账号
2. 进入 **管理面板** → **邮件配置**
3. 填写配置信息：
   - **API Key**: 粘贴刚才复制的 Resend API Key
   - **发件人地址**: `noreply@yourdomain.com`（必须是验证过的域名）
   - **发件人名称**: `OSSShelf` 或您想要的名称
4. 点击 **保存配置**
5. 点击 **发送测试邮件** 验证配置

#### 方式二：通过环境变量配置（已废弃）

邮件配置统一存放在 KV（管理面板写入），不再读取 `RESEND_*` / `SMTP_*` 环境变量，请使用方式一。

### 5. 邮件功能说明

**注意**: 邮件验证已升级为6位验证码方式，无需配置 `PUBLIC_URL` 环境变量。

邮件功能只需在管理面板配置 Resend API Key 即可使用：

- 注册邮箱验证（6位验证码）
- 忘记密码重置（6位验证码）
- 更换邮箱确认（6位验证码）
- 系统通知邮件

### 6. 测试邮件功能

配置完成后，测试以下功能：

1. **注册验证邮件**
   - 注册新用户
   - 检查是否收到6位验证码邮件
   - 输入验证码完成验证

2. **忘记密码邮件**
   - 在登录页点击"忘记密码"
   - 输入邮箱地址
   - 检查是否收到6位验证码邮件

3. **测试邮件**
   - 在管理面板 → 邮件配置
   - 点击"发送测试邮件"
   - 检查收件箱

### 7. 邮件偏好设置

用户可以在 **设置** → **邮箱设置** 中自定义邮件通知偏好：

| 偏好类型     | 默认值 | 说明                              |
| ------------ | ------ | --------------------------------- |
| @提及通知    | 开启   | 当有人在文件或评论中@您时发送邮件 |
| 分享接收通知 | 开启   | 当他人分享文件给您时发送邮件      |
| 配额警告     | 开启   | 存储空间即将用尽时发送警告邮件    |
| AI处理完成   | 关闭   | AI摘要或标签处理完成时发送邮件    |
| 系统通知     | 开启   | 重要的系统更新和安全提醒          |

### 8. 群发系统公告

管理员可以在 **管理面板** → **邮件配置** 中群发系统公告：

1. 选择目标用户（所有用户/仅管理员/仅普通用户）
2. 输入邮件主题和内容
3. 点击发送
4. 查看发送结果（成功数/失败数）

### 9. 故障排查

#### 问题：邮件发送失败

**检查清单**:

- ✅ Resend API Key 是否正确
- ✅ 发件人域名是否已验证
- ✅ `PUBLIC_URL` 是否已配置
- ✅ 发件人地址是否使用验证过的域名

**查看日志**:

```bash
# Cloudflare Workers 日志
wrangler tail

# 搜索错误信息
# "Email send failed"
# "Email service not configured"
```

#### 问题：验证码未收到

**原因**: Resend配置问题或邮件被拦截

**解决方案**:

1. 检查管理面板中的Resend API Key配置
2. 确认发件人域名已在Resend中验证
3. 检查邮箱垃圾邮件文件夹
4. 查看Resend控制台的发送日志

#### 问题：验证码验证失败

**原因**: 验证码过期或输入错误

**解决方案**:

1. 验证码有效期为10分钟，请及时使用
2. 确认输入的6位验证码正确无误
3. 点击"重新发送"获取新的验证码
4. 检查邮箱地址是否正确

#### 问题：验证邮件进入垃圾箱

**解决方案**:

1. 在 Resend 中验证域名
2. 配置 SPF、DKIM 记录
3. 联系邮件服务商提升信誉度

### 10. 邮件服务限制

Resend 免费版限制：

- 每月 3,000 封邮件
- 每天 100 封邮件
- 1 个域名

如需更高配额，请升级到付费计划。

---

## 存储提供商配置

支持的存储提供商定义于 `apps/api/src/routes/buckets.ts`：

### Cloudflare R2（推荐）

**优势**: 无出站流量费用，与 Workers 同区域低延迟

**获取凭证**：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 R2 → 管理 R2 API 令牌
3. 创建 API 令牌，权限选择「对象读和写」

**配置示例**：

```json
{
  "provider": "r2",
  "name": "我的 R2 存储桶",
  "bucketName": "my-bucket",
  "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
  "region": "auto",
  "accessKeyId": "你的 Access Key ID",
  "secretAccessKey": "你的 Secret Access Key"
}
```

### AWS S3

**获取凭证**：

1. 登录 AWS Console
2. IAM → 用户 → 创建用户 → 添加权限 `AmazonS3FullAccess`
3. 创建访问密钥

**配置示例**：

```json
{
  "provider": "s3",
  "name": "我的 S3 存储桶",
  "bucketName": "my-bucket",
  "endpoint": "https://s3.amazonaws.com",
  "region": "us-east-1",
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
}
```

### 阿里云 OSS

**获取凭证**：

1. 登录阿里云控制台
2. RAM → 用户 → 创建用户 → 添加权限 `AliyunOSSFullAccess`
3. 创建 AccessKey

**配置示例**：

```json
{
  "provider": "oss",
  "name": "我的 OSS 存储桶",
  "bucketName": "my-bucket",
  "endpoint": "https://oss-cn-hangzhou.aliyuncs.com",
  "region": "cn-hangzhou",
  "accessKeyId": "你的 AccessKey ID",
  "secretAccessKey": "你的 AccessKey Secret"
}
```

### 腾讯云 COS

**获取凭证**：

1. 登录腾讯云控制台
2. 访问管理 → API 密钥管理 → 新建密钥

**配置示例**：

```json
{
  "provider": "cos",
  "name": "我的 COS 存储桶",
  "bucketName": "my-bucket-1234567890",
  "endpoint": "https://cos.ap-guangzhou.myqcloud.com",
  "region": "ap-guangzhou",
  "accessKeyId": "你的 SecretId",
  "secretAccessKey": "你的 SecretKey"
}
```

### 华为云 OBS

**配置示例**：

```json
{
  "provider": "obs",
  "name": "我的 OBS 存储桶",
  "bucketName": "my-bucket",
  "endpoint": "https://obs.cn-south-1.myhuaweicloud.com",
  "region": "cn-south-1",
  "accessKeyId": "你的 AK",
  "secretAccessKey": "你的 SK"
}
```

### Backblaze B2

**获取凭证**：

1. 登录 Backblaze B2
2. Account → App Keys → Add New Application Key

**配置示例**：

```json
{
  "provider": "b2",
  "name": "我的 B2 存储桶",
  "bucketName": "my-bucket",
  "endpoint": "https://s3.us-west-000.backblazeb2.com",
  "region": "us-west-000",
  "accessKeyId": "你的 keyID",
  "secretAccessKey": "你的 applicationKey",
  "pathStyle": true
}
```

### MinIO

**配置示例**：

```json
{
  "provider": "minio",
  "name": "我的 MinIO 存储桶",
  "bucketName": "my-bucket",
  "endpoint": "https://minio.example.com:9000",
  "region": "custom",
  "accessKeyId": "你的 Access Key",
  "secretAccessKey": "你的 Secret Key",
  "pathStyle": true
}
```

> **注意**: MinIO 通常需要设置 `pathStyle: true`

### Telegram Bot 存储

**设置步骤**：

1. **创建 Bot**
   - 在 Telegram 中搜索 [@BotFather](https://t.me/BotFather)
   - 发送 `/newbot` 并按提示创建 Bot
   - 记录返回的 Token（格式：`123456:ABC-DEF...`）

2. **创建频道/群组**
   - 创建一个频道或群组用于存储文件
   - 将 Bot 添加为管理员

3. **获取 Chat ID**
   - 方法一：转发频道消息到 [@userinfobot](https://t.me/userinfobot)
   - 方法二：访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`

**配置示例**：

```json
{
  "provider": "telegram",
  "name": "我的 Telegram 存储",
  "bucketName": "-1001234567890",
  "endpoint": "https://api.telegram.org",
  "accessKeyId": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "secretAccessKey": "telegram-no-secret"
}
```

**限制说明**（定义于 `apps/api/src/lib/telegramClient.ts` 与 `telegramChunked.ts`）：

| 限制项         | 值                       |
| -------------- | ------------------------ |
| 单文件最大     | 2 GB                     |
| 小文件直传阈值 | 50 MB                    |
| 分片大小       | 30 MB                    |
| 文件删除       | 仅删除引用，无法真正删除 |

---

## 自定义域名

### API 域名配置

```bash
# 添加自定义域名
wrangler domains add ossshelf-api your-domain.com

# 或在 wrangler.toml 中配置
[[routes]]
pattern = "api.your-domain.com/*"
zone_name = "your-domain.com"
```

### 前端域名配置

前后端已同源，前端不再单独部署，直接给 Worker `ossshelf-api` 绑定自定义域：

1. 进入 Cloudflare Dashboard → Workers & Pages → `ossshelf-api`
2. Settings → Domains & Routes → Add custom domain
3. 输入域名并验证（原 Pages 项目的域名需先解绑，避免同一主机名冲突）

> 切换顺序：先在 workers.dev 域名验证新 Worker 可用，再把自定义域从 Pages 解绑并绑到 Worker；
> 不建议两台同时占用同一主机名。

### CORS 配置

> 同源部署（前端与 API 同一个 Worker 域名）时 CORS 不是必需项，留空即可。
> 仅当你有外部域名/客户端跨域调用 API 时才配置。

如果存在跨域调用，通过 `CORS_ORIGINS` 设置：

**配置方式**：

1. **GitHub Secrets**（推荐）：添加 `CORS_ORIGINS` Secret（CI 写入 `[vars]`）
2. **wrangler.toml**：在 `[vars]` 中添加 `CORS_ORIGINS` 变量

**配置示例**：

```toml
# wrangler.toml
[vars]
# 回滚期可同时保留新旧域名
CORS_ORIGINS = "https://ossshelf-api.your-subdomain.workers.dev,https://your-custom-domain.com"
```

**多个域名**：用逗号分隔，如 `https://a.com,https://b.com`

**本地开发**：默认已允许 `localhost:3000`、`localhost:5173` 等本地开发地址，无需额外配置。

---

## 性能优化

### 1. 开启 Cloudflare CDN

- 在 Cloudflare Dashboard 中添加域名
- 开启 Proxy 模式（橙色云朵）
- 配置页面规则缓存静态资源

### 2. 预签名 URL 优化

大文件使用预签名 URL 直接上传到存储，减少 Workers CPU 消耗：

- 文件 ≤ 100MB：直接上传
- 文件 > 100MB：分片上传

### 3. 数据库索引

系统已自动创建必要的索引（见 `apps/api/migrations/`），无需手动优化。

### 4. KV 缓存策略

- 迁移状态：实时更新
- 预签名 URL：短期缓存

---

## 监控与日志

### 实时日志

```bash
# 实时查看 Workers 日志
wrangler tail

# 过滤特定日志
wrangler tail --format=json | jq 'select(.event.request.url | contains("api/files"))'
```

### Cloudflare Dashboard 监控

1. 进入 Workers & Pages
2. 选择你的 Worker
3. 查看「指标」和「日志」

### GitHub Actions 日志

1. 进入 GitHub 仓库 → Actions
2. 选择具体的工作流运行
3. 查看每个步骤的详细日志

### 设置告警

在 Cloudflare Dashboard 中配置：

- Workers 错误率告警
- Workers 延迟告警
- D1 查询超时告警

---

## 备份与恢复

### 数据库备份

```bash
# 导出数据库
wrangler d1 export ossshelf-db --output=backup.sql

# 导入数据库
wrangler d1 execute ossshelf-db --file=backup.sql
```

### 定期备份脚本

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
wrangler d1 export ossshelf-db --output="backup_${DATE}.sql"
# 上传到存储桶或其他安全位置
```

### 存储桶备份

- 定期使用存储提供商的管理控制台导出数据
- 启用存储桶版本控制
- 配置跨区域复制（如有需要）

---

## 故障排查

### 常见问题

#### 1. GitHub Actions 部署失败：`Authentication error`

**原因**: Cloudflare API Token 无效或权限不足

**解决**:

- 检查 `CLOUDFLARE_API_TOKEN` Secret 是否正确
- 确认 Token 有 Workers 编辑权限

#### 2. Workers Builds 失败：`Build failed`

**原因**: 构建命令、根目录或构建期环境变量配置错误

**解决**:

- 确认根目录为 `apps/api`，构建命令为 `cd .. && pnpm install --frozen-lockfile && pnpm build:web && node scripts/generate-wrangler.mjs`
- 确认构建期已注入 `CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_KV_NAMESPACE_ID`（缺失时生成脚本会直接退出）
- 若报找不到 `apps/web/dist`，说明构建命令里漏了 `pnpm build:web`

#### 3. API 请求失败：`No such binding: DB`

**原因**: D1 数据库绑定配置错误

**解决**: 检查 `CLOUDFLARE_D1_DATABASE_ID` Secret 是否正确

```bash
# 查看现有数据库
wrangler d1 list

# 查看数据库详情
wrangler d1 info ossshelf-db
```

#### 4. 上传失败：`Storage exceeded`

**原因**: 存储配额不足

**解决**:

- 检查用户存储配额
- 检查存储桶配额
- 清理不需要的文件

#### 5. WebDAV 连接失败

**排查步骤**:

1. 确认 API 地址正确
2. 确认用户名是注册邮箱
3. 检查 SSL 证书
4. 查看 Workers 日志

```bash
# 测试 WebDAV 连接
curl -X PROPFIND https://your-api.workers.dev/dav/ \
  -u "email@example.com:password" \
  -H "Depth: 0"
```

#### 6. 定时任务不执行

**排查步骤**:

1. 确认 Cron Triggers 已配置
2. 查看 Workers 日志

```bash
# 手动触发定时任务（需管理员登录令牌）
curl -X POST https://your-api.workers.dev/cron/all \
  -H "Authorization: Bearer <admin-jwt-token>"
```

#### 7. Telegram 上传失败

**排查步骤**:

1. 确认 Bot Token 有效
2. 检查 Bot 是否已添加到目标频道/群组
3. 确认 Bot 有发送文档权限
4. 测试连接：

```bash
curl "https://api.telegram.org/bot<TOKEN>/getMe"
```

#### 8. 前端无法访问 API

**排查步骤**:

1. 前后端已同源，前端请求 `/api` 相对路径；若被返回成 HTML，检查 `[assets] run_worker_first` 是否覆盖 `/api` 与 `/api/*`
2. 检查浏览器控制台与 Network 面板的实际请求地址
3. 若前端被单独部署到别的域名，才需要配置 `VITE_API_URL` 与 `CORS_ORIGINS`

#### 9. 直链打开失败跳转首页

**原因**: 直链域名与 Worker 域名不一致，或 `/api/direct` 未列入 `run_worker_first`，请求被静态资源的 SPA 回退吃掉。

**解决方案**:

**方案一：配置 PUBLIC_URL（推荐）**

将 `PUBLIC_URL` 指向 Worker 的访问域名：

```bash
# GitHub Secrets 中添加
PUBLIC_URL=https://ossshelf-api.your-subdomain.workers.dev
```

或在 `wrangler.toml` 中配置：

```toml
[vars]
PUBLIC_URL = "https://ossshelf-api.your-subdomain.workers.dev"
```

**方案二：确认 Worker 路由不回退**

同源部署下，`[assets] run_worker_first` 已显式覆盖以下路径，不会再被 SPA 回退：

- `/api`、`/api/*` - API 接口（裸路径也要列，`/api/*` 不匹配 `/api` 本身）
- `/dav`、`/dav/*` - WebDAV 服务
- `/agents`、`/agents/*` - Agent Durable Object
- `/cron`、`/cron/*` - 定时任务
- `/health` - 健康检查

**验证直链配置**:

```bash
# 测试直链是否正常工作
curl -I https://your-api.workers.dev/api/direct/<token>
# 应返回 200 或文件内容，而非 HTML 页面
```

#### 10. 版本控制功能不可用（v1.4.0）

**排查步骤**:

1. 确认已运行 `0008_file_versions.sql` 迁移
2. 检查数据库中是否存在 `file_versions` 表
3. 查看 API 日志确认版本接口是否正常

```bash
# 检查迁移状态
wrangler d1 execute ossshelf-db --command "SELECT name FROM sqlite_master WHERE type='table' AND name='file_versions'"
```

#### 10. 预览功能异常（v1.4.0）

**排查步骤**:

1. 确认前端已更新到最新版本
2. 检查文件 MIME 类型是否支持
3. 对于 CAD/3D 模型预览，确认文件格式正确
4. 查看浏览器控制台是否有渲染错误

---

## 安全建议

### 1. 环境变量管理

- 使用 `wrangler secret` 管理敏感信息
- 不要在代码中硬编码密钥
- 定期轮换 JWT_SECRET（存储桶凭证加密密钥由它派生，轮换后需重新录入存储桶凭证）

### 2. 访问控制

- 限制管理员接口访问
- 启用登录保护（默认已启用）
- 定期检查审计日志

### 3. 存储桶安全

- 使用最小权限原则配置 Access Key
- 定期检查存储桶使用情况
- 启用存储桶加密

### 4. AI 功能安全

- AI 功能需要显式配置才能启用
- 文件内容仅在处理时临时读取
- 向量索引存储在 Cloudflare Vectorize
- 不会将文件内容永久存储在 AI 服务中

---

## AI 功能配置

v2.2.0 版本的 AI 功能包含以下核心能力：

### 前置要求

1. Cloudflare Workers AI 已启用
2. Cloudflare Vectorize 已创建索引

### 配置步骤

#### 1. 启用 Workers AI

在 Cloudflare Dashboard 中：

1. 进入 Workers & Pages
2. 选择你的 Worker
3. 点击 Settings → Variables
4. 确认 AI binding 已配置

#### 2. 创建 Vectorize 索引

```bash
# 创建向量索引
wrangler vectorize create ossshelf-vectors --dimensions=1024 --metric=cosine

# 验证索引创建成功
wrangler vectorize list
```

#### 3. 更新 wrangler.toml

```toml
# 添加 AI binding（通常已自动配置）
[ai]
binding = "AI"

# 添加 Vectorize binding
[[vectorize]]
binding = "VECTORIZE"
index_name = "ossshelf-files"
```

#### 4. 部署更新

```bash
# push 到 main：Actions 迁移 → Deploy Hook → Workers Builds 构建部署
git push origin main
```

### AI 功能验证

部署完成后，访问 AI 设置页面验证功能：

1. 登录系统
2. 进入「AI 配置」页面
3. 检查各功能状态

### v2.2.0 新功能

| 功能         | 说明                                             |
| ------------ | ------------------------------------------------ |
| Agent 引擎   | 支持 Function Calling 工具调用、推理内容显示     |
| AI 系统配置  | 可配置默认模型、参数、限制、重试策略、提示词模板 |
| 向量库管理   | 查看和删除向量索引，支持分页和搜索               |
| 任务中心     | 统一显示所有任务状态，实时进度监控               |
| 全局 AI 聊天 | 悬浮式 AI 聊天组件，支持会话切换                 |
| 自定义模型   | 支持任意 Workers AI 模型 ID                      |

### v2.1.0 功能

| 功能        | 说明                                                       |
| ----------- | ---------------------------------------------------------- |
| 多模型架构  | Workers AI 实时模型目录（可回退内置清单）+ OpenAI 兼容 API |
| AI 对话系统 | Agents SDK WebSocket 流式响应、会话管理与长期记忆          |
| AI 配置中心 | 模型管理、功能级配置、一键启用、连接测试                   |
| 文件摘要    | 自动为文本文件生成摘要                                     |
| 图片描述    | 自动识别图片内容并描述                                     |
| 图片标签    | 自动生成图片分类标签                                       |
| 智能重命名  | 根据内容推荐文件名                                         |
| 语义搜索    | 基于语义相似度搜索文件                                     |

### Workers AI 可用模型

| 模型            | 类型      | 说明                      |
| --------------- | --------- | ------------------------- |
| DeepSeek R1 32B | chat      | 推理能力强，数学/代码专家 |
| Llama 3.3 70B   | chat      | Meta 最新大模型           |
| Qwen 1.5 14B    | chat      | 中文能力优秀              |
| Llama 3.1 8B    | chat      | 默认模型，通用问答        |
| Mistral 7B      | chat      | 响应速度快                |
| Gemma 2B        | chat      | 轻量极速                  |
| LLaVA 1.5 7B    | vision    | 图片理解                  |
| BGE-M3          | embedding | 文本向量化                |

### 成本说明

Cloudflare Workers AI 和 Vectorize 的定价：

- Workers AI：按请求计费，有免费额度
- Vectorize：按向量数量和查询次数计费

详细定价请参阅 Cloudflare 官方文档。

---

## 安全建议

### 1. 密钥管理

- ✅ 使用 GitHub Secrets 存储敏感信息
- ✅ 使用 `wrangler secret` 存储运行时密钥
- ✅ 定期轮换 JWT_SECRET 与 CF_API_TOKEN
- ❌ 不要在代码中存储敏感信息

### 2. 访问控制

- 启用 Cloudflare Access 限制管理面板 IP
- 配置防火墙规则限制异常请求

### 3. 数据安全

- 定期备份数据库
- 启用存储桶版本控制
- 定期审查审计日志

### 4. 账户安全

- 启用 Cloudflare 账户 2FA
- 启用 GitHub 账户 2FA
- 使用 API Token 代替 Global API Key
- 定期检查账户活动

---

## 更新部署

### 自动更新（推荐）

项目已配置 CI/CD，更新非常简单：

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 推送到 GitHub
git push origin main
```

推送后由 GitHub Actions 依次执行：质量校验 → 生成 wrangler.toml → D1 预检 → D1 迁移 →
POST Deploy Hook；Workers Builds 收到 Hook 后执行 `pnpm build:web` 与 `wrangler deploy`，
前端静态资源与 API 作为同一个 Worker 一起上线。

### 数据库迁移

迁移由工作流自动执行（`Apply D1 migrations`），本地无需再手工跑一次。手工核对：

```bash
# 检查是否有新迁移文件
ls apps/api/migrations/

# 手工执行（仅本地或紧急兜底）
pnpm db:migrate
```

### 从 Fork 更新

```bash
# 1. 添加上游仓库（仅需一次）
git remote add upstream https://github.com/original-repo/ossshelf.git

# 2. 拉取上游更新
git fetch upstream
git merge upstream/main

# 3. 解决冲突后推送
git push origin main
```

### 回滚部署

前端与 API 是同一个 Worker 的同一份版本，回滚一次即可同时生效：

```bash
# 查看部署历史
wrangler deployments list

# 回滚到指定版本
wrangler rollback --version <version>
```

或 Dashboard → Workers & Pages → `ossshelf-api` → Deployments → Version history 选择版本回退。

> 注意：代码回滚不会自动回滚 D1 迁移。若该版本依赖已被后续迁移修改的表结构，需评估是否兼容。

---

## 附录：常用命令

```bash
# 开发
pnpm dev:api          # 本地开发 API
pnpm dev:web          # 本地开发前端

# 构建
pnpm build:api        # 构建 API
pnpm build:web        # 构建前端

# 部署（正常流程由 CI 完成：迁移成功后 Deploy Hook 触发 Workers Builds）
# 手动兜底需先 pnpm build:web，且要求 apps/api/wrangler.toml 已生成
pnpm deploy:api

# 数据库
pnpm db:generate      # 生成迁移
pnpm db:migrate       # 运行迁移
pnpm db:studio        # 打开 Drizzle Studio

# Cloudflare
wrangler tail         # 实时日志
wrangler d1 list      # 列出数据库
wrangler kv:key list  # 列出 KV 键

# 代码质量
pnpm lint             # ESLint
pnpm typecheck        # 类型检查
```

---

## 附录：部署检查清单

### 首次部署

- [ ] Fork 项目到 GitHub
- [ ] 创建 Cloudflare D1 数据库
- [ ] 创建 Cloudflare KV 命名空间
- [ ] 配置 GitHub Secrets
  - [ ] `CLOUDFLARE_API_TOKEN`
  - [ ] `CLOUDFLARE_ACCOUNT_ID`
  - [ ] `CLOUDFLARE_D1_DATABASE_ID`
  - [ ] `CLOUDFLARE_KV_NAMESPACE_ID`
  - [ ] `CF_BUILDS_DEPLOY_HOOK`
  - [ ] `PUBLIC_URL`
  - [ ] `CORS_ORIGINS`（可选，仅跨域调用需要）
  - [ ] `JWT_SECRET`（仅首次手工 `wrangler secret put`）
  - [ ] `ALERT_TG_BOT_TOKEN`（可选）
  - [ ] `ALERT_TG_CHAT_ID`（可选）
  - [ ] `CF_API_TOKEN`（可选，仅 Workers AI Read）
- [ ] 连接 Workers Builds（根目录、构建命令、监视路径、构建期环境变量）
- [ ] 创建 Deploy Hook 并写入 `CF_BUILDS_DEPLOY_HOOK`
- [ ] 验证 workers.dev 域名可访问（SPA 刷新、`/api`、WebDAV）
- [ ] 切换自定义域（先从 Pages 解绑再绑到 Worker）

### 更新部署

- [ ] 拉取最新代码
- [ ] 检查是否有新迁移文件
- [ ] 推送到 GitHub（Actions 迁移成功后自动触发 Builds 部署）
- [ ] 验证 Actions 与 Builds 均成功

### v1.4.0 升级检查清单

- [ ] 确认已运行 `0008_file_versions.sql` 迁移
- [ ] 验证版本控制 API 可用 (`/api/versions`)
- [ ] 确认前端已更新以支持新预览类型
- [ ] 测试错误码响应格式
