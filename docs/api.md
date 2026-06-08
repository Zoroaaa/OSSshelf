# OSSshelf API 文档

> **本文档已迁移至自动生成的交互式页面，以下为快速导航。**

## 在线文档

| 文档 | 地址 | 说明 |
|------|------|------|
| **统一 API 文档（Scalar）** | `/api/docs` | 所有 API 的交互式文档入口，推荐使用 |
| **v1 RESTful API（Swagger UI）** | `/api/v1/docs` | OpenAPI 3.1.0 规范自动生成，覆盖 files/folders/shares/search/me |
| **AI API 文档** | `docs/API_AI.md` | AI 功能独立文档 |

## 快速开始

### Base URL

```
https://your-api.workers.dev/api
```

### 认证方式

```http
# JWT Bearer Token
Authorization: Bearer <jwt-token>

# API Key（程序化访问）
X-API-Key: osk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 健康检查

```http
GET /api/health
```

## API 分组概览

| 分组 | 路由前缀 | 说明 |
|------|----------|------|
| Auth | `/api/auth` | 用户认证 — 注册、登录、JWT 管理 |
| Files | `/api/files` | 文件管理 — CRUD、上传下载、预览、回收站 |
| Buckets | `/api/buckets` | 存储桶管理 — R2/S3/OSS/COS 等多厂商后端 |
| Share | `/api/share` | 分享管理 — 下载分享、上传链接 |
| DirectLink | `/api/direct` | 文件直链 — 公开访问链接 |
| Presign | `/api/presign` | 预签名上传/下载 |
| Search | `/api/search` | 搜索 — 关键词、FTS5 全文、语义搜索 |
| Batch | `/api/batch` | 批量操作 — 删除/移动/复制/重命名 |
| Permissions | `/api/permissions` | 权限与标签管理 |
| Groups | `/api/groups` | 用户组管理 |
| Teams | `/api/teams` | 团队协作 (v5.0) |
| Webhooks | `/api/webhooks` | 事件订阅与第三方集成 |
| Tasks | `/api/tasks` | 上传任务管理（分片上传） |
| Downloads | `/api/downloads` | 离线下载任务 |
| Preview | `/api/preview` | 多格式在线预览 |
| Versions | `/api/versions` | 文件版本控制 |
| Notes | `/api/notes` | 文件笔记与评论 |
| ApiKeys | `/api/keys` | API Key 管理 |
| Analytics | `/api/analytics` | 存储分析统计 |
| Notifications | `/api/notifications` | 通知系统 |
| Admin | `/api/admin` | 管理员接口 |
| AI | `/api/ai`, `/api/ai-config`, `/api/ai-chat` | AI 功能 |
| Telegram | `/api/telegram` | Telegram Bot 集成 |
| Migrate | `/api/migrate` | 跨存储桶数据迁移 |
| Cron | `/cron` | 定时清理任务 |
| WebDAV | `/dav` | 标准 WebDAV 协议 |

### 统一响应格式

```json
// 成功
{ "success": true, "data": { ... } }

// 错误
{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

---

> 详细接口说明请访问 **[/api/docs](/api/docs)** 查看交互式文档。
