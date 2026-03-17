# OSSshelf 部署文档

## 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Node.js | >= 20.0.0 |
| pnpm | >= 8.0.0 |
| Cloudflare 账号 | 必需 |

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/your-username/OSSshelf.git
cd OSSshelf
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置 Cloudflare 资源

#### 登录 Cloudflare

```bash
npx wrangler login
```

#### 创建 D1 数据库

```bash
npx wrangler d1 create ossshelf-db
```

记录返回的 `database_id`，后续填入配置文件。

#### 创建 KV 命名空间（可选）

```bash
npx wrangler kv:namespace create KV
```

记录返回的 `id`，后续填入配置文件。

### 4. 配置 wrangler.toml

```bash
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
database_id = "your-d1-database-id"    # 替换为实际 ID

[[kv_namespaces]]
binding = "KV"
id = "your-kv-namespace-id"            # 替换为实际 ID（可选）

[vars]
ENVIRONMENT = "development"
JWT_SECRET = "your-secure-jwt-secret"  # 替换为安全密钥

[triggers]
crons = ["0 3 * * *"]                  # 每天凌晨3点执行定时任务
```

### 5. 数据库迁移

```bash
# 本地开发环境
pnpm db:migrate:local

# 生产环境
pnpm db:migrate
```

### 6. 启动开发服务

```bash
# 终端 1: 启动 API 服务 (端口 8787)
pnpm dev:api

# 终端 2: 启动 Web 服务 (端口 5173)
pnpm dev:web
```

访问 http://localhost:5173 开始使用。

---

## 生产部署

### 部署 API 服务

```bash
# 构建检查
pnpm build:api

# 部署到 Cloudflare Workers
pnpm deploy:api
```

### 部署 Web 前端

#### 方式一: Cloudflare Pages

```bash
# 构建
pnpm build:web

# 在 Cloudflare Dashboard 中:
# 1. 创建 Pages 项目
# 2. 连接 Git 仓库，或手动上传 apps/web/dist 目录
# 3. 构建命令: pnpm build:web
# 4. 输出目录: apps/web/dist
```

#### 方式二: 其他静态托管

```bash
# 构建
pnpm build:web

# 将 apps/web/dist 目录部署到任意静态托管服务
# 注意配置 VITE_API_URL 环境变量指向 API 地址
```

---

## GitHub Actions 自动部署

项目已配置 `.github/workflows/deploy-api.yml`，支持自动部署：

### 配置 Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 描述 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 数据库 ID |
| `CLOUDFLARE_KV_NAMESPACE_ID` | KV 命名空间 ID |
| `JWT_SECRET` | JWT 签名密钥 |
| `TRASH_RETENTION_DAYS` | 回收站保留天数（可选，默认 30） |

### 获取 Cloudflare API Token

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 "Create Token"
3. 选择 "Custom token" 模板
4. 配置权限：
   - Zone:Read (如需自定义域名)
   - Account:Read
   - D1:Edit
   - Workers Scripts:Edit
   - Workers KV Storage:Edit
   - R2:Edit (如使用 R2)

---

## 配置说明

### 环境变量

#### API 服务 (wrangler.toml)

| 变量 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| `ENVIRONMENT` | string | 运行环境 | `development` |
| `JWT_SECRET` | string | JWT 签名密钥 | - |
| `TRASH_RETENTION_DAYS` | number | 回收站保留天数 | 30 |

#### Web 应用 (.env)

| 变量 | 类型 | 描述 |
|------|------|------|
| `VITE_API_URL` | string | API 地址，同域部署可留空 |

### 定时任务配置

Cloudflare Workers 免费账户限制最多 **5 个 cron triggers**。本项目使用单个 cron trigger（每天凌晨 3 点执行），触发后会依次执行：

1. **回收站清理** - 删除超过保留天数的文件
2. **会话清理** - 清理过期的 WebDAV 会话、上传任务、登录记录
3. **分享清理** - 删除过期的分享链接

### 系统常量

定义在 `packages/shared/src/constants/index.ts`：

| 常量 | 值 | 描述 |
|------|-----|------|
| `MAX_FILE_SIZE` | 5GB | 单文件最大大小 |
| `DEFAULT_STORAGE_QUOTA` | 10GB | 默认用户存储配额 |
| `JWT_EXPIRY` | 7天 | JWT 令牌有效期 |
| `UPLOAD_CHUNK_SIZE` | 10MB | 分片上传块大小 |
| `MULTIPART_THRESHOLD` | 100MB | 触发分片上传的阈值 |
| `TRASH_RETENTION_DAYS` | 30天 | 回收站文件保留天数 |

---

## 存储桶配置

通过 Web 界面的「存储桶管理」页面，可以添加和配置多个存储桶：

### 支持的存储厂商

| 厂商 | 标识 | 说明 |
|------|------|------|
| Cloudflare R2 | `r2` | Cloudflare 原生对象存储 |
| Amazon S3 | `s3` | AWS 标准对象存储服务 |
| 阿里云 OSS | `oss` | 阿里云对象存储服务 |
| 腾讯云 COS | `cos` | 腾讯云对象存储服务 |
| 华为云 OBS | `obs` | 华为云对象存储服务 |
| Backblaze B2 | `b2` | Backblaze 云存储 |
| MinIO | `minio` | 开源对象存储服务器 |
| 自定义 S3 兼容 | `custom` | 其他支持 S3 协议的存储服务 |

### 配置参数

1. **存储厂商** - 选择支持的存储服务提供商
2. **显示名称** - 存储桶的友好名称
3. **存储桶名称** - 在存储服务中创建的实际桶名称
4. **Endpoint URL** - 存储服务的 API 端点（留空使用默认）
5. **区域** - 存储桶所在的区域（部分厂商必填）
6. **访问凭证** - Access Key ID 和 Secret Access Key
7. **Path-style URL** - 是否使用路径风格的 URL（MinIO/B2 等需要）
8. **默认存储桶** - 设置为默认存储位置
9. **存储限额** - 可选的存储桶级别的空间限制

---

## 自定义域名

### API 自定义域名

1. 在 Cloudflare Workers 控制台选择你的 Worker
2. 点击 "Triggers" → "Custom Domains"
3. 添加你的域名（需要先在 Cloudflare 添加该域名）
4. 更新 Web 应用的 `VITE_API_URL` 环境变量
5. 重新构建部署 Web 应用

### Web 自定义域名

如使用 Cloudflare Pages：

1. 在 Pages 项目设置中添加自定义域名
2. 按照提示配置 DNS 记录

---

## 故障排查

### 部署失败

1. 检查 `wrangler.toml` 配置是否正确
2. 确认 Cloudflare API Token 权限是否足够
3. 查看 Cloudflare Workers 控制台日志

### 数据库迁移失败

1. 确认 D1 数据库 ID 正确
2. 检查迁移文件 SQL 语法
3. 尝试手动执行迁移：`npx wrangler d1 migrations apply ossshelf-db`

### 文件上传失败

1. 检查存储桶配置是否正确
2. 确认存储桶凭证有效
3. 查看存储桶 CORS 配置

### WebDAV 连接失败

1. 确认使用正确的邮箱和密码
2. 检查 URL 格式：`https://your-domain.com/dav`
3. 确认客户端支持 Basic Auth
