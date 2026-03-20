# OSSshelf 部署文档

## 环境要求

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Cloudflare 账户
- Cloudflare D1 (SQLite)
- Cloudflare Workers
- Cloudflare KV (可选，用于缓存和迁移状态)

## 快速部署

### 1. 创建 Cloudflare 资源

```bash
# 登录 Cloudflare
wrangler login

# 创建 D1 数据库
wrangler d1 create ossshelf-db

# 创建 KV 命名空间 (可选，用于迁移状态追踪)
wrangler kv:namespace create KV
```

### 2. 配置 wrangler.toml

复制并配置 `apps/api/wrangler.toml.example`:

```toml
name = "ossshelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "your-database-id"

[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"
```

### 3. 环境变量

在 wrangler.toml 或 Cloudflare Dashboard 中配置以下 secrets:

```bash
# 设置 JWT 密钥
wrangler secret put JWT_SECRET
# 输入一个随机的强密码，用于签名 JWT token

# 设置加密密钥 (用于加密存储桶密钥)
wrangler secret put ENCRYPTION_KEY
# 输入一个 32 字节的随机字符串

# 设置管理员邮箱
wrangler secret put ADMIN_EMAIL
# 输入管理员邮箱地址
```

### 4. 运行数据库迁移

```bash
# 生成迁移 (首次)
pnpm db:generate

# 运行迁移
pnpm db:migrate
```

### 5. 部署 API

```bash
pnpm deploy:api
```

### 6. 部署前端

```bash
# 构建前端
pnpm build:web

# 部署到 Cloudflare Pages
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

### 7. 配置定时任务

通过 Cloudflare Dashboard 或 wrangler.toml 配置 Cron Triggers:

```toml
# wrangler.toml
[triggers]
crons = ["0 3 * * *"]  # 每天凌晨 3 点

[[routes]]
pattern = "/cron/*"
zone_name = "your-domain.com"
```

## 存储提供商配置

### Cloudflare R2

```json
{
  "provider": "r2",
  "bucketName": "my-bucket",
  "endpoint": "https://account-id.r2.cloudflarestorage.com",
  "region": "auto",
  "accessKeyId": "your-access-key-id",
  "secretAccessKey": "your-secret-access-key"
}
```

**特点**: 无出站流量费用，适合大量下载场景

### AWS S3

```json
{
  "provider": "s3",
  "bucketName": "my-bucket",
  "endpoint": "https://s3.amazonaws.com",
  "region": "us-east-1",
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
}
```

### 阿里云 OSS

```json
{
  "provider": "oss",
  "bucketName": "my-bucket",
  "endpoint": "https://oss-cn-hangzhou.aliyuncs.com",
  "region": "cn-hangzhou",
  "accessKeyId": "your-access-key-id",
  "secretAccessKey": "your-secret-access-key"
}
```

### 腾讯云 COS

```json
{
  "provider": "cos",
  "bucketName": "my-bucket-1234567890",
  "endpoint": "https://cos.ap-guangzhou.myqcloud.com",
  "region": "ap-guangzhou",
  "accessKeyId": "your-access-key-id",
  "secretAccessKey": "your-secret-access-key"
}
```

### 华为云 OBS

```json
{
  "provider": "obs",
  "bucketName": "my-bucket",
  "endpoint": "https://obs.cn-south-1.myhuaweicloud.com",
  "region": "cn-south-1",
  "accessKeyId": "your-access-key-id",
  "secretAccessKey": "your-secret-access-key"
}
```

### Backblaze B2

```json
{
  "provider": "b2",
  "bucketName": "my-bucket",
  "endpoint": "https://s3.us-west-000.backblazeb2.com",
  "region": "us-west-000",
  "accessKeyId": "your-application-key-id",
  "secretAccessKey": "your-application-key"
}
```

### MinIO

```json
{
  "provider": "minio",
  "bucketName": "my-bucket",
  "endpoint": "https://minio.example.com:9000",
  "region": "custom",
  "accessKeyId": "your-access-key",
  "secretAccessKey": "your-secret-key",
  "pathStyle": true
}
```

### Telegram Bot Storage

```json
{
  "provider": "telegram",
  "bucketName": "1234567890",
  "endpoint": "https://api.telegram.org",
  "accessKeyId": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "secretAccessKey": "telegram-no-secret"
}
```

**配置说明**:
- `bucketName`: Telegram Chat ID (频道/群组/私聊的 ID)
- `accessKeyId`: Telegram Bot Token
- `endpoint`: 可选的 Bot API 代理地址 (如 https://api.telegram.org)

**Telegram Bot 设置步骤**:
1. 通过 @BotFather 创建一个新的 Bot
2. 获取 Bot Token
3. 创建一个 Telegram 频道或群组
4. 将 Bot 添加到频道/群组，并设置为管理员
5. 获取频道/群组的 Chat ID (可以通过转发消息到 @userinfobot 或使用 Telegram API 获取)

## 部署架构

```
                    ┌─────────────────┐
                    │  Cloudflare      │
                    │  Pages (前端)    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Cloudflare     │
                    │  Workers (API)  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
│   Cloudflare  │   │   Cloudflare  │   │   Telegram    │
│   D1 (DB)     │   │   KV (缓存)   │   │   Bot API     │
└───────────────┘   └───────────────┘   └───────────────┘
                                               │
                    ┌────────────────────────────┼────────────────────────────┐
                    │                            │                            │
             ┌──────▼──────┐            ┌───────▼───────┐          ┌───────▼───────┐
             │ Cloudflare  │            │    AWS S3     │          │  阿里云 OSS   │
             │     R2      │            │               │          │               │
             └─────────────┘            └───────────────┘          └───────────────┘
```

## 性能优化

### 1. 开启 Cloudflare CDN

- 在 Cloudflare Dashboard 中添加域名
- 开启 Proxy 模式
- 配置页面规则缓存静态资源

### 2. 预签名 URL

- 大文件使用预签名 URL 直接上传到存储
- 减少 Workers CPU 消耗
- 支持更大的文件上传

### 3. WebDAV 优化

- 使用 WebDAV 客户端连接
- 支持 Windows 资源管理器直接访问
- 优化了 LOCK/UNLOCK 操作

## 监控与日志

### 查看日志

```bash
# 实时日志
wrangler tail

# 特定时间段
wrangler tail --from 2024-01-01 --to 2024-01-02
```

### 设置告警

在 Cloudflare Dashboard 中配置:
- Workers 错误率告警
- Workers 延迟告警
- D1 查询超时告警

## 备份与恢复

### 数据库备份

```bash
# 导出
wrangler d1 execute ossshelf-db --command=".backup ossshelf-backup.db"

# 导入
wrangler d1 execute ossshelf-db --command=".restore ossshelf-backup.db"
```

### 存储桶备份

- 定期使用存储提供商的管理控制台导出数据
- 启用存储桶版本控制
- 配置跨区域复制 (如有需要)

## 故障排查

### 常见问题

#### 1. 上传失败

- 检查存储桶配置是否正确
- 确认 Access Key/Secret Key 权限
- 检查 CORS 配置

#### 2. WebDAV 连接失败

- 确认用户名密码正确
- 检查 Basic Auth 是否启用
- 确认 Workers 域名已配置 SSL

#### 3. 定时任务不执行

- 确认 Cron Triggers 已配置
- 检查 wrangler.toml 中的 crons 配置
- 查看 Workers 日志排查错误

#### 4. Telegram 上传失败

- 确认 Bot Token 有效
- 检查 Bot 是否已添加到目标频道/群组
- 确认 Bot 有发送文档权限
- 检查网络连接到 Telegram API 是否正常

## 安全建议

1. **启用 2FA**: 在 Cloudflare 账户中启用双因素认证
2. **限制 IP**: 通过 Cloudflare Access 限制管理面板 IP
3. **加密密钥**: 定期轮换 ENCRYPTION_KEY
4. **日志审计**: 定期审查审计日志
5. **备份**: 定期备份数据库和重要数据

## 更新部署

```bash
# 拉取最新代码
git pull

# 安装依赖
pnpm install

# 构建
pnpm build

# 运行迁移
pnpm db:migrate

# 部署
pnpm deploy:api
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```
