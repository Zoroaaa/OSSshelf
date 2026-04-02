# OSSshelf 部署文档

本文档基于项目实际配置文件，提供完整的部署指南，确保您能够一次性成功部署 OSSshelf。

**当前版本**: v4.0.0

---

## 📋 目录

- [部署架构概览](#部署架构概览)
- [版本更新说明](#版本更新说明)
- [环境要求](#环境要求)
- [快速部署](#快速部署)
- [GitHub Secrets 配置](#github-secrets-配置)
- [Cloudflare Pages 前端部署](#cloudflare-pages-前端部署)
- [GitHub Actions 后端部署](#github-actions-后端部署)
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

本项目采用现代化的 CI/CD 部署方式：

| 组件       | 部署平台           | 触发方式                      |
| ---------- | ------------------ | ----------------------------- |
| 前端 (Web) | Cloudflare Pages   | GitHub 仓库连接，自动构建部署 |
| 后端 (API) | Cloudflare Workers | GitHub Actions 自动部署       |

```
                         ┌─────────────────────────────────────┐
                         │           GitHub 仓库                │
                         │    (push to main 分支触发部署)        │
                         └─────────────────┬───────────────────┘
                                           │
              ┌────────────────────────────┴────────────────────────────┐
              │                                                         │
              │                                                         │
┌─────────────▼─────────────┐                           ┌──────────────▼────────────┐
│   Cloudflare Pages        │                           │    GitHub Actions          │
│   (前端自动构建部署)        │                           │    (后端自动部署)           │
│   触发: push to main      │                           │    触发: apps/api/** 变更   │
└─────────────┬─────────────┘                           └──────────────┬────────────┘
              │                                                        │
              │                                           ┌────────────▼────────────┐
              │                                           │  Cloudflare Workers     │
              │                                           │  (API 服务)              │
              │                                           └────────────┬────────────┘
              │                                                        │
              │                                           ┌────────────▼────────────┐
              │                                           │  D1 / KV / R2           │
              │                                           │  (Cloudflare 资源)       │
              │                                           └─────────────────────────┘
              │
┌─────────────▼─────────────┐
│      用户浏览器            │
│   https://your.pages.dev  │
└───────────────────────────┘
```

---

## 版本更新说明

详细的版本更新日志请参阅 [CHANGELOG.md](../CHANGELOG.md)。

### v4.0.0 (2026-04-02)

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

### v3.8.0 (2026-04-02)

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

### v3.5.0 (2026-03-30)

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

### v3.4.0 (2026-03-27)

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

### v3.3.0 (2026-03-24)

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
| Workers         | 无服务器计算                          | 10万次请求/天            |
| Pages           | 静态托管                              | 无限制                   |

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
| `JWT_SECRET`                 | JWT 签名密钥        | 生成 32+ 字符随机字符串                |
| `CORS_ORIGINS`               | CORS 允许域名       | 前端域名，多个用逗号分隔               |
| `TRASH_RETENTION_DAYS`       | 回收站保留天数      | 可选，默认 30                          |

#### 获取 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击右上角头像 → My Profile → API Tokens
3. 点击「Create Token」
4. 选择「Edit Cloudflare Workers」模板
5. 配置权限：
   - Account Resources: Include → Your Account
   - Zone Resources: Include → All zones（或指定域名）
6. 创建并复制 Token

### Step 4: 运行数据库迁移

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

迁移文件位于 `apps/api/migrations/`：

- `0001_init.sql` - 初始化表结构
- `0002_optimization.sql` - 性能优化索引
- `0003_folder_upload_types.sql` - 文件夹上传类型限制
- `0004_telegram_storage.sql` - Telegram 存储支持
- `0005_dedup_and_upload_links.sql` - 文件去重和上传链接
- `0006_upload_progress.sql` - 上传进度追踪
- `0007_phase7.sql` - 第七阶段功能
- `0008_direct_link.sql` - 文件直链功能
- `0009_file_versions.sql` - 文件版本控制 (v3.3.0)
- `0010_notes.sql` - 文件笔记 (v3.5.0)
- `0011_api_keys.sql` - API Keys (v3.5.0)
- `0012_permission_v2.sql` - 权限系统 v2 (v3.6.0)
- `0014_ai_features.sql` - AI 功能 (v3.7.0)
- `0015_notifications.sql` - 通知系统 (v3.8.0)
- `0016_fts5.sql` - FTS5 全文搜索 (v3.8.0)
- `0018_email.sql` - 邮件通知系统 (v4.0.0)

### Step 5: 设置加密密钥

存储桶凭证需要加密存储，设置加密密钥：

```bash
# 生成 32 字节随机密钥
openssl rand -base64 32

# 设置为 Cloudflare Worker Secret
wrangler secret put ENCRYPTION_KEY --name ossshelf-api
# 粘贴上面生成的密钥
```

### Step 6: 连接 Cloudflare Pages（前端部署）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 Workers & Pages → Create application → Pages → Connect to Git
3. 选择您的 GitHub 仓库
4. 配置构建设置：
   - **项目名称**: `ossshelf-web`（或自定义）
   - **生产分支**: `main`
   - **构建命令**: `pnpm install && pnpm build:web`
   - **构建输出目录**: `apps/web/dist`
5. 添加环境变量：
   - `VITE_API_URL`: 您的 API 地址（如 `https://ossshelf-api.your-subdomain.workers.dev`）
6. 点击「Save and Deploy」

首次部署后，每次推送到 main 分支都会自动触发前端构建和部署。

### Step 7: 验证部署

```bash
# 测试 API
curl https://your-api.workers.dev/api/auth/registration-config

# 预期返回：
# {"success":true,"data":{"open":true,"requireInviteCode":false}}

# 访问前端
# 打开 https://your-project.pages.dev
```

---

## GitHub Secrets 配置

### 必需 Secrets

| Secret 名称                  | 必需 | 说明                                     |
| ---------------------------- | ---- | ---------------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | ✅   | Workers 部署权限                         |
| `CLOUDFLARE_ACCOUNT_ID`      | ✅   | Cloudflare 账户标识                            |
| `CLOUDFLARE_D1_DATABASE_ID`  | ✅   | D1 数据库绑定                                  |
| `CLOUDFLARE_KV_NAMESPACE_ID` | ✅   | KV 命名空间绑定                                |
| `JWT_SECRET`                 | ✅   | JWT 签名密钥                                   |
| `CORS_ORIGINS`               | ✅   | CORS 允许域名                                  |
| `PUBLIC_URL`                 | ⚪   | 应用公网地址，用于生成文件直接访问链接（可选）  |

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
JWT_SECRET = "${{ secrets.JWT_SECRET }}"
CORS_ORIGINS = "${{ secrets.CORS_ORIGINS }}"
TRASH_RETENTION_DAYS = "${{ secrets.TRASH_RETENTION_DAYS || '30' }}"
```

---

## Cloudflare Pages 前端部署

### 自动部署配置

Cloudflare Pages 通过 GitHub 集成实现自动部署：

| 触发条件          | 行为                     |
| ----------------- | ------------------------ |
| Push 到 main 分支 | 自动构建并部署到生产环境 |
| Pull Request      | 生成预览部署（可选）     |

### 构建配置

| 配置项       | 值                               |
| ------------ | -------------------------------- |
| 构建命令     | `pnpm install && pnpm build:web` |
| 输出目录     | `apps/web/dist`                  |
| Node.js 版本 | 20.x                             |
| 包管理器     | pnpm                             |

### 环境变量

在 Cloudflare Pages 设置中配置：

| 变量名         | 说明          |
| -------------- | ------------- |
| `VITE_API_URL` | 后端 API 地址 |

**设置路径**: Cloudflare Dashboard → Workers & Pages → 您的项目 → Settings → Environment variables

### 手动触发部署

如需手动触发前端部署：

1. 进入 Cloudflare Dashboard → Workers & Pages → 您的项目
2. 点击「View details」
3. 点击「Retry deployment」

---

## GitHub Actions 后端部署

### 工作流配置

后端部署由 `.github/workflows/deploy-api.yml` 控制：

```yaml
name: Deploy API to Cloudflare Workers

on:
  push:
    branches:
      - main
    paths:
      - 'apps/api/**'
      - 'packages/shared/**'
      - '.github/workflows/deploy-api.yml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build shared package
        run: pnpm --filter @osshelf/shared build

      - name: Generate wrangler.toml
        # 动态生成配置文件

      - name: Deploy to Cloudflare Workers
        run: pnpm deploy:api
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### 触发条件

后端部署在以下情况自动触发：

- `apps/api/` 目录下任何文件变更
- `packages/shared/` 目录下任何文件变更
- `.github/workflows/deploy-api.yml` 工作流文件变更

### 查看部署状态

1. 进入 GitHub 仓库 → Actions 标签页
2. 选择「Deploy API to Cloudflare Workers」工作流
3. 查看运行日志和状态

### 手动触发部署

后端部署支持手动触发：

1. 进入 GitHub 仓库 → Actions 标签页
2. 选择「Deploy API to Cloudflare Workers」工作流
3. 点击「Run workflow」按钮
4. 选择分支后点击绿色「Run workflow」按钮

---

## 邮件服务配置

v4.0.0+ 版本集成了 Resend 邮件服务，用于邮箱验证、密码重置等功能。

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

#### 方式二：通过环境变量配置

在 GitHub Secrets 中添加：

```bash
# 可选：如果需要通过环境变量配置
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_ADDRESS=noreply@yourdomain.com
RESEND_FROM_NAME=OSSShelf
```

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

**限制说明**（定义于 `apps/api/src/lib/telegramClient.ts`）：

| 限制项         | 值                       |
| -------------- | ------------------------ |
| 单文件最大     | 2 GB                     |
| 小文件直传阈值 | 49 MB                    |
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

1. 进入 Cloudflare Dashboard → Workers & Pages → 您的项目
2. Settings → Custom domains
3. 点击「Set up a custom domain」
4. 输入域名并验证

### CORS 配置

> **⚠️ 重要 - 部署前必须配置！**
>
> CORS 允许域名通过环境变量 `CORS_ORIGINS` 配置，**部署前请务必将其设置为您的前端域名，否则前端将无法正常访问 API！**

如果前端和 API 使用不同域名，需要配置 CORS。通过环境变量 `CORS_ORIGINS` 设置：

**配置方式**：

1. **GitHub Secrets**（推荐）：添加 `CORS_ORIGINS` Secret
2. **wrangler.toml**：在 `[vars]` 中添加 `CORS_ORIGINS` 变量

**配置示例**：

```toml
# wrangler.toml
[vars]
CORS_ORIGINS = "https://your-frontend.pages.dev,https://your-custom-domain.com"
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

#### 2. 前端部署失败：`Build failed`

**原因**: 构建命令或输出目录配置错误

**解决**:

- 确认构建命令为 `pnpm install && pnpm build:web`
- 确认输出目录为 `apps/web/dist`

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
# 手动触发定时任务
curl -X POST https://your-api.workers.dev/cron/all
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

1. 检查 CORS 配置
2. 确认 `VITE_API_URL` 环境变量正确
3. 检查浏览器控制台错误

#### 9. 版本控制功能不可用（v3.3.0）

**排查步骤**:

1. 确认已运行 `0008_file_versions.sql` 迁移
2. 检查数据库中是否存在 `file_versions` 表
3. 查看 API 日志确认版本接口是否正常

```bash
# 检查迁移状态
wrangler d1 execute ossshelf-db --command "SELECT name FROM sqlite_master WHERE type='table' AND name='file_versions'"
```

#### 10. 预览功能异常（v3.3.0）

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
- 定期轮换 JWT_SECRET 和 ENCRYPTION_KEY

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
index_name = "ossshelf-vectors"
```

#### 4. 部署更新

```bash
# 重新部署
pnpm deploy:api
```

### AI 功能验证

部署完成后，访问 AI 设置页面验证功能：

1. 登录系统
2. 进入「设置」→「AI 功能」
3. 检查功能状态是否显示为已配置

### AI 功能说明

| 功能       | 模型             | 说明                   |
| ---------- | ---------------- | ---------------------- |
| 文件摘要   | Llama 3.1 8B     | 自动为文本文件生成摘要 |
| 图片描述   | LLaVA 1.5 7B     | 自动识别图片内容并描述 |
| 图片标签   | ResNet-50        | 自动生成图片分类标签   |
| 智能重命名 | Llama 3.1 8B     | 根据内容推荐文件名     |
| 语义搜索   | BGE-M3 (1024 维) | 基于语义相似度搜索文件 |

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
- ✅ 定期轮换 JWT_SECRET 和 ENCRYPTION_KEY
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

推送后：

- **前端**: Cloudflare Pages 自动检测并重新构建部署
- **后端**: 如果 `apps/api/` 有变更，GitHub Actions 自动部署

### 数据库迁移

如果更新包含数据库迁移：

```bash
# 检查是否有新迁移文件
ls apps/api/migrations/

# 执行迁移
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

#### 回滚后端

```bash
# 查看部署历史
wrangler deployments list

# 回滚到指定版本
wrangler rollback --version <version>
```

#### 回滚前端

1. 进入 Cloudflare Dashboard → Workers & Pages → 您的项目
2. 点击「View details」
3. 在部署历史中选择要回滚的版本
4. 点击「Rollback to this deployment」

---

## 附录：常用命令

```bash
# 开发
pnpm dev:api          # 本地开发 API
pnpm dev:web          # 本地开发前端

# 构建
pnpm build:api        # 构建 API
pnpm build:web        # 构建前端

# 部署（通常由 CI/CD 自动执行）
pnpm deploy:api       # 部署 API

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
  - [ ] `JWT_SECRET`
  - [ ] `CORS_ORIGINS`
  - [ ] `ALERT_TG_BOT_TOKEN`（可选）
  - [ ] `ALERT_TG_CHAT_ID`（可选）
- [ ] 运行数据库迁移（包含 v3.3.0 版本控制表）
- [ ] 设置 ENCRYPTION_KEY Secret
- [ ] 连接 Cloudflare Pages
- [ ] 配置前端环境变量 `VITE_API_URL`
- [ ] 验证部署成功

### 更新部署

- [ ] 拉取最新代码
- [ ] 检查数据库迁移（特别是 v3.3.0 的 `file_versions` 表）
- [ ] 推送到 GitHub
- [ ] 验证自动部署成功

### v3.3.0 升级检查清单

- [ ] 确认已运行 `0008_file_versions.sql` 迁移
- [ ] 验证版本控制 API 可用 (`/api/versions`)
- [ ] 确认前端已更新以支持新预览类型
- [ ] 测试错误码响应格式
