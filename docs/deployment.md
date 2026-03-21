# OSSshelf 部署文档

本文档基于项目实际配置文件，提供完整的部署指南，确保您能够一次性成功部署 OSSshelf。

---

## 📋 目录

- [环境要求](#环境要求)
- [快速部署](#快速部署)
- [详细配置说明](#详细配置说明)
- [存储提供商配置](#存储提供商配置)
- [部署架构](#部署架构)
- [自定义域名](#自定义域名)
- [性能优化](#性能优化)
- [监控与日志](#监控与日志)
- [备份与恢复](#备份与恢复)
- [故障排查](#故障排查)
- [安全建议](#安全建议)
- [更新部署](#更新部署)

---

## 环境要求

### 必需环境

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 20.0.0 | 推荐使用 LTS 版本 |
| pnpm | >= 8.0.0 | 包管理器 |

### Cloudflare 资源

| 资源 | 说明 | 免费额度 |
|------|------|----------|
| Cloudflare 账户 | 注册地址：https://dash.cloudflare.com | 免费 |
| D1 数据库 | SQLite 数据库 | 5GB 存储，500万行读取/天 |
| KV 命名空间 | 键值存储 | 1GB 存储，10万次读取/天 |
| Workers | 无服务器计算 | 10万次请求/天 |
| Pages | 静态托管 | 无限制 |

### 安装工具

```bash
# 安装 pnpm
npm install -g pnpm

# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

---

## 快速部署

### Step 1: 克隆项目

```bash
git clone https://github.com/your-repo/ossshelf.git
cd ossshelf

# 安装依赖
pnpm install
```

### Step 2: 创建 Cloudflare 资源

```bash
# 创建 D1 数据库
wrangler d1 create ossshelf-db

# 输出示例：
# ✅ Successfully created DB 'ossshelf-db'
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
#
# [[d1_databases]]
# binding = "DB"
# database_name = "ossshelf-db"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 创建 KV 命名空间（生产环境）
wrangler kv:namespace create KV --preview false

# 输出示例：
# ✅ Successfully created namespace 'KV'
# id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
#
# [[kv_namespaces]]
# binding = "KV"
# id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

> **重要**: 请记录输出的 `database_id` 和 `id`，后续配置需要使用。

### Step 3: 配置 wrangler.toml

配置模板位于 `apps/api/wrangler.toml.example`：

```bash
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
```

编辑 `apps/api/wrangler.toml`，填入实际值：

```toml
name = "ossshelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "你的D1数据库ID"  # ← 替换为 Step 2 的 database_id

[[kv_namespaces]]
binding = "KV"
id = "你的KV命名空间ID"  # ← 替换为 Step 2 的 id

[vars]
ENVIRONMENT = "production"
JWT_SECRET = "your-super-secret-jwt-key-at-least-32-chars"  # ← 生成强随机字符串

# 定时任务：每天凌晨 3 点清理回收站
[triggers]
crons = ["0 3 * * *"]
```

### Step 4: 设置加密密钥

存储桶凭证需要加密存储，设置加密密钥：

```bash
# 生成 32 字节随机密钥
openssl rand -base64 32

# 设置为环境变量
wrangler secret put ENCRYPTION_KEY
# 粘贴上面生成的密钥
```

### Step 5: 运行数据库迁移

```bash
# 运行迁移（生产环境）
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

### Step 6: 部署 API

```bash
pnpm deploy:api
```

部署成功后，会输出 API 地址，例如：`https://ossshelf-api.your-subdomain.workers.dev`

### Step 7: 部署前端

```bash
# 构建前端
pnpm build:web

# 部署到 Cloudflare Pages
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

### Step 8: 验证部署

```bash
# 测试 API
curl https://your-api.workers.dev/api/auth/registration-config

# 预期返回：
# {"success":true,"data":{"open":true,"requireInviteCode":false}}
```

---

## 详细配置说明

### wrangler.toml 完整配置

基于 `apps/api/wrangler.toml.example`：

```toml
name = "ossshelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# ─────────────────────────────────────────────────────────────
# D1 数据库配置
# ─────────────────────────────────────────────────────────────
[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# ─────────────────────────────────────────────────────────────
# KV 命名空间（用于迁移状态追踪）
# ─────────────────────────────────────────────────────────────
[[kv_namespaces]]
binding = "KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# ─────────────────────────────────────────────────────────────
# 环境变量
# ─────────────────────────────────────────────────────────────
[vars]
ENVIRONMENT = "production"
JWT_SECRET = "your-jwt-secret-key"

# ─────────────────────────────────────────────────────────────
# 定时任务
# ─────────────────────────────────────────────────────────────
[triggers]
crons = ["0 3 * * *"]  # 每天凌晨 3 点执行清理
```

### 环境变量说明

| 变量名 | 配置方式 | 说明 |
|--------|----------|------|
| `JWT_SECRET` | `[vars]` 或 `secret` | JWT 签名密钥，建议 32+ 字符 |
| `ENCRYPTION_KEY` | `wrangler secret` | 存储桶凭证加密密钥，32 字节 |

**推荐使用 Secret 存储敏感信息**：

```bash
# 设置 JWT 密钥（推荐）
wrangler secret put JWT_SECRET

# 设置加密密钥（必须）
wrangler secret put ENCRYPTION_KEY
```

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

| 限制项 | 值 |
|--------|-----|
| 单文件最大 | 2 GB |
| 小文件直传阈值 | 49 MB |
| 分片大小 | 30 MB |
| 文件删除 | 仅删除引用，无法真正删除 |

---

## 部署架构

```
                         ┌─────────────────────────────────────┐
                         │           用户浏览器                 │
                         └─────────────────┬───────────────────┘
                                           │
                         ┌─────────────────▼───────────────────┐
                         │      Cloudflare Pages (前端)        │
                         │      https://web.pages.dev          │
                         └─────────────────┬───────────────────┘
                                           │ API 请求
                         ┌─────────────────▼───────────────────┐
                         │     Cloudflare Workers (API)        │
                         │     https://api.workers.dev         │
                         └─────────────────┬───────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
┌─────────────▼─────────────┐  ┌──────────▼──────────┐  ┌──────────────▼────────────┐
│   Cloudflare D1 (DB)      │  │  Cloudflare KV      │  │    外部存储服务            │
│   - 用户数据               │  │  - 迁移状态         │  │    - R2/S3/OSS/COS        │
│   - 文件元数据             │  │  - 缓存             │  │    - Telegram             │
│   - 存储桶配置             │  │                     │  │    - MinIO/B2             │
└───────────────────────────┘  └─────────────────────┘  └───────────────────────────┘
```

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

```bash
# 在 Cloudflare Pages 设置中添加自定义域名
# 或使用命令
wrangler pages domain add ossshelf-web your-domain.com
```

### CORS 配置

如果前端和 API 使用不同域名，需要配置 CORS。在 `apps/api/src/index.ts` 中已默认配置：

```typescript
app.use('*', cors({
  origin: ['https://your-frontend.pages.dev', 'https://your-domain.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
```

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

#### 1. 部署失败：`Error: No such binding: DB`

**原因**: wrangler.toml 中 D1 配置错误

**解决**: 检查 `database_id` 是否正确

```bash
# 查看现有数据库
wrangler d1 list

# 查看数据库详情
wrangler d1 info ossshelf-db
```

#### 2. 上传失败：`Storage exceeded`

**原因**: 存储配额不足

**解决**: 
- 检查用户存储配额
- 检查存储桶配额
- 清理不需要的文件

#### 3. WebDAV 连接失败

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

#### 4. 定时任务不执行

**排查步骤**:
1. 确认 Cron Triggers 已配置
2. 检查 wrangler.toml 中的 crons 配置
3. 查看 Workers 日志

```bash
# 手动触发定时任务
curl -X POST https://your-api.workers.dev/cron/all
```

#### 5. Telegram 上传失败

**排查步骤**:
1. 确认 Bot Token 有效
2. 检查 Bot 是否已添加到目标频道/群组
3. 确认 Bot 有发送文档权限
4. 测试连接：

```bash
curl "https://api.telegram.org/bot<TOKEN>/getMe"
```

#### 6. 前端无法访问 API

**排查步骤**:
1. 检查 CORS 配置
2. 确认 API 地址正确
3. 检查浏览器控制台错误

---

## 安全建议

### 1. 密钥管理

- ✅ 使用 `wrangler secret` 存储敏感信息
- ✅ 定期轮换 JWT_SECRET 和 ENCRYPTION_KEY
- ❌ 不要在 wrangler.toml 中存储敏感信息

### 2. 访问控制

- 启用 Cloudflare Access 限制管理面板 IP
- 配置防火墙规则限制异常请求

### 3. 数据安全

- 定期备份数据库
- 启用存储桶版本控制
- 定期审查审计日志

### 4. 账户安全

- 启用 Cloudflare 账户 2FA
- 使用 API Token 代替 Global API Key
- 定期检查账户活动

---

## 更新部署

### 标准更新流程

```bash
# 1. 拉取最新代码
git pull

# 2. 安装依赖
pnpm install

# 3. 检查数据库迁移
ls apps/api/migrations/

# 4. 如果有新迁移文件，执行迁移
pnpm db:migrate

# 5. 部署 API
pnpm deploy:api

# 6. 构建并部署前端
pnpm build:web
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

### 从 Fork 更新

```bash
# 1. 添加上游仓库（仅需一次）
git remote add upstream https://github.com/original-repo/ossshelf.git

# 2. 拉取上游更新
git fetch upstream
git merge upstream/main

# 3. 解决冲突后继续部署流程
```

### 回滚部署

```bash
# 查看部署历史
wrangler deployments list

# 回滚到指定版本
wrangler rollback --version <version>
```

---

## 附录：常用命令

```bash
# 开发
pnpm dev:api          # 本地开发 API
pnpm dev:web          # 本地开发前端

# 构建
pnpm build:api        # 构建 API
pnpm build:web        # 构建前端

# 部署
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
