# OSSshelf 部署文档

## 环境要求

- **Node.js**: >= 20.0.0
- **pnpm**: >= 8.0.0
- **Cloudflare 账户**（用于部署 Workers、D1、KV）

## 本地开发

### 1. 克隆项目

```bash
git clone https://github.com/your-repo/ossshelf.git
cd ossshelf
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

复制配置示例文件：

```bash
cp apps/api/wrangler.toml.example apps/api/wrangler.toml
```

编辑 `apps/api/wrangler.toml`，填入真实的配置：

```toml
name = "ossshelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "YOUR_D1_DATABASE_ID"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"

[vars]
ENVIRONMENT = "development"
JWT_SECRET = "your-jwt-secret-change-in-production"

[triggers]
crons = ["0 3 * * *"]
```

### 4. 创建数据库

```bash
# 创建 D1 数据库
wrangler d1 create ossshelf-db

# 创建 KV 命名空间
wrangler kv:namespace create KV
```

将返回的 `database_id` 和 `id` 填入 `wrangler.toml`。

### 5. 运行数据库迁移

```bash
# 本地迁移
pnpm db:migrate:local

# 或生成新的迁移文件
pnpm db:generate
```

### 6. 启动开发服务器

```bash
# 启动 API 服务
pnpm dev:api

# 启动前端服务（新终端）
pnpm dev:web
```

- API 服务: http://localhost:8787
- 前端服务: http://localhost:5173

## 生产部署

### 1. 创建 Cloudflare 资源

#### 创建 D1 数据库

```bash
wrangler d1 create ossshelf-db
```

记录返回的 `database_id`。

#### 创建 KV 命名空间

```bash
wrangler kv:namespace create KV --preview false
```

记录返回的 `id`。

### 2. 配置生产环境

编辑 `apps/api/wrangler.toml`：

```toml
name = "ossshelf-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "ossshelf-db"
database_id = "YOUR_PRODUCTION_D1_DATABASE_ID"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_PRODUCTION_KV_NAMESPACE_ID"

[vars]
ENVIRONMENT = "production"
JWT_SECRET = "YOUR_SECURE_JWT_SECRET"

[triggers]
crons = ["0 3 * * *"]

[env.production]
vars = { ENVIRONMENT = "production", JWT_SECRET = "YOUR_SECURE_JWT_SECRET" }

[env.production.triggers]
crons = ["0 3 * * *"]
```

### 3. 运行生产数据库迁移

```bash
pnpm db:migrate
```

### 4. 部署 API

```bash
pnpm deploy:api
```

### 5. 构建并部署前端

```bash
# 构建
pnpm build:web

# 部署到 Cloudflare Pages
wrangler pages deploy apps/web/dist --project-name=ossshelf-web
```

### 6. 配置自定义域名

#### API 域名

```bash
wrangler domains add your-api-domain.com
```

#### 前端域名

在 Cloudflare Pages 控制台添加自定义域名。

### 7. 更新 CORS 配置

部署后，更新 `apps/api/src/index.ts` 中的 CORS 配置：

```typescript
app.use(
  '*',
  cors({
    origin: ['https://your-domain.com'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'PROPFIND', 'MKCOL', 'COPY', 'MOVE', 'HEAD'],
    allowHeaders: ['Content-Type', 'Authorization', 'Depth', 'Destination', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'Content-Range'],
    maxAge: 86400,
    credentials: true,
  })
);
```

## 存储桶配置

### 方式一：通过应用界面配置（推荐）

1. 登录 OSSshelf
2. 进入 **设置 → 存储桶管理**
3. 点击 **添加存储桶**
4. 填写存储桶信息：
   - 名称：显示名称
   - 提供商：选择存储提供商
   - Bucket 名称：实际存储桶名称
   - Endpoint：API 端点
   - Region：区域
   - Access Key ID：访问密钥 ID
   - Secret Access Key：访问密钥
   - 路径样式：是否使用路径样式 URL

### 方式二：各云服务商配置示例

#### Cloudflare R2

```
提供商: r2
Endpoint: https://<account-id>.r2.cloudflarestorage.com
Region: auto
Bucket: your-bucket-name
```

#### AWS S3

```
提供商: s3
Endpoint: https://s3.<region>.amazonaws.com
Region: us-east-1
Bucket: your-bucket-name
```

#### 阿里云 OSS

```
提供商: oss
Endpoint: https://oss-<region>.aliyuncs.com
Region: oss-<region>
Bucket: your-bucket-name
```

#### 腾讯云 COS

```
提供商: cos
Endpoint: https://cos.<region>.myqcloud.com
Region: <region>
Bucket: your-bucket-name
```

#### 华为云 OBS

```
提供商: obs
Endpoint: https://obs.<region>.myhuaweicloud.com
Region: <region>
Bucket: your-bucket-name
```

#### Backblaze B2

```
提供商: b2
Endpoint: https://s3.<region>.backblazeb2.com
Region: <region>
Bucket: your-bucket-name
```

#### MinIO

```
提供商: minio
Endpoint: https://your-minio-server.com
Region: us-east-1 (或自定义)
Bucket: your-bucket-name
路径样式: 是
```

#### Telegram

```
提供商: telegram
Bot Token: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11  # 从 @BotFather 获取
Chat ID: -1001234567890  # 频道/群组/私聊的 ID
API 代理: https://api.telegram.org (可选)
```

**Telegram 配置步骤**:
1. 向 @BotFather 发送 `/newbot` 创建一个新 Bot
2. 保存 Bot Token
3. 创建一个频道或群组，将 Bot 添加为管理员
4. 获取 Chat ID:
   - 频道：在频道中发送消息，然后访问 `https://api.telegram.org/bot<token>/getUpdates`
   - 群组：添加 Bot 到群组，发送消息，然后访问 `https://api.telegram.org/bot<token>/getUpdates`
   - 私聊：直接与 Bot 对话，然后访问 `https://api.telegram.org/bot<token>/getUpdates`
5. 在 OSSshelf 中创建存储桶，选择 Telegram 提供商并填入配置

**注意事项**:
- Bot 需要有发送消息和删除消息的权限
- 单文件最大 50MB（Bot API 限制）
- 建议使用专用频道存储文件，避免消息干扰

## 定时任务配置

系统使用 Cloudflare Cron Triggers 执行定时任务。在 `wrangler.toml` 中配置：

```toml
[triggers]
crons = ["0 3 * * *"]  # 每天凌晨 3 点执行
```

定时任务包括：

- 回收站清理（清理超过 30 天的文件）
- 会话清理（清理过期的 WebDAV 会话、上传任务）
- 分享清理（清理过期的分享链接）

## 环境变量说明

| 变量名      | 说明                          | 必需 |
| ----------- | ----------------------------- | ---- |
| DB          | D1 数据库绑定                 | 是   |
| KV          | KV 命名空间绑定               | 是   |
| FILES       | R2 存储桶绑定（遗留）         | 否   |
| ENVIRONMENT | 环境 (development/production) | 是   |
| JWT_SECRET  | JWT 签名密钥                  | 是   |

## 数据库管理

### 查看数据库

```bash
# 本地数据库
wrangler d1 execute ossshelf-db --local --command "SELECT * FROM users LIMIT 10"

# 生产数据库
wrangler d1 execute ossshelf-db --command "SELECT * FROM users LIMIT 10"
```

### 使用 Drizzle Studio

```bash
pnpm db:studio
```

## 常见问题

### 1. 部署失败：数据库未找到

确保 `wrangler.toml` 中的 `database_id` 正确，并且数据库已创建。

### 2. CORS 错误

检查 API 的 CORS 配置是否包含前端域名。

### 3. 上传失败：存储桶未配置

确保至少配置了一个存储桶并设为默认。

### 4. WebDAV 连接失败

- 确认 WebDAV 端点为 `/dav`
- 使用邮箱作为用户名
- 检查密码是否正确

### 5. 定时任务未执行

- 确认 `wrangler.toml` 中配置了 `triggers.crons`
- 生产环境需要使用 `[env.production.triggers]`

## 监控与日志

### 查看实时日志

```bash
wrangler tail
```

### 查看 Cron 执行日志

```bash
wrangler tail --format json
```

在 Cloudflare 控制台可以查看：

- Workers 日志
- D1 查询日志
- Cron 触发历史

## 备份策略

### 数据库备份

```bash
# 导出 D1 数据库
wrangler d1 export ossshelf-db --output backup.sql
```

### 文件备份

文件存储在各云服务商的对象存储中，请使用各平台提供的备份功能。

## 版本更新

### 更新步骤

1. 拉取最新代码

   ```bash
   git pull
   ```

2. 安装依赖

   ```bash
   pnpm install
   ```

3. 检查数据库迁移

   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

4. 部署
   ```bash
   pnpm deploy:api
   pnpm build:web
   wrangler pages deploy apps/web/dist --project-name=ossshelf-web
   ```

## 安全建议

1. **JWT_SECRET**: 使用强随机字符串（至少 32 字符）
2. **HTTPS**: 确保所有流量通过 HTTPS
3. **访问控制**: 配置 Cloudflare Access 限制管理接口
4. **密钥轮换**: 定期更换存储桶访问密钥
5. **审计日志**: 定期检查审计日志
