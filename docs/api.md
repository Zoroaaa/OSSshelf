# OSSshelf API 文档

本文档基于项目实际路由代码，详细描述 OSSshelf 的所有 API 接口。

**当前版本**: v3.7.0

---

## 📋 目录

- [基础信息](#基础信息)
- [认证接口](#认证接口)
- [文件接口](#文件接口)
- [回收站接口](#回收站接口)
- [存储桶接口](#存储桶接口)
- [Telegram 接口](#telegram-接口)
- [存储桶迁移接口](#存储桶迁移接口)
- [预签名上传接口](#预签名上传接口)
- [分享接口](#分享接口)
- [文件直链接口](#文件直链接口)
- [批量操作接口](#批量操作接口)
- [搜索接口](#搜索接口)
- [权限与标签接口](#权限与标签接口)
- [用户组接口](#用户组接口) - v3.6.0
- [Webhook 接口](#webhook-接口) - v3.6.0
- [AI 功能接口](#ai-功能接口) - v3.7.0
- [上传任务接口](#上传任务接口)
- [离线下载接口](#离线下载接口)
- [预览接口](#预览接口)
- [版本控制接口](#版本控制接口)
- [文件笔记接口](#文件笔记接口)
- [API Keys 接口](#api-keys-接口)
- [RESTful v1 API](#restful-v1-api) - v3.6.0
- [管理员接口](#管理员接口)
- [定时任务接口](#定时任务接口)
- [WebDAV 接口](#webdav-接口)

---

## 基础信息

### Base URL

```
https://your-api.workers.dev/api
```

### 认证方式

- **Bearer Token (JWT)**: 大多数 API 使用此方式
- **API Key**: 程序化访问推荐使用此方式（v4.0 新增）
- **Basic Auth**: WebDAV 接口使用此方式

#### JWT Token 认证

```http
Authorization: Bearer <jwt-token>
```

#### API Key 认证（v4.0 新增）

API Key 适用于脚本、自动化工具、第三方集成等场景。

**方式一：X-API-Key Header**

```http
X-API-Key: osk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**方式二：Authorization Header**

```http
Authorization: ApiKey osk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**API Key 格式**：`osk_live_` 前缀 + 64 位十六进制字符

**API Key 特点**：

- 仅在创建时显示一次，请妥善保存
- 支持 Scope 权限控制
- 支持过期时间设置
- 可随时禁用或删除

### 响应格式

JSON

### 统一响应格式

**成功响应**:

```json
{
  "success": true,
  "data": { ... }
}
```

**错误响应**:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  }
}
```

### 错误码（v3.3.0 统一管理）

错误码定义于 `packages/shared/src/constants/errorCodes.ts`，采用分层命名和数字编码：

#### 认证相关错误 (1xxx)

| 错误码                       | 数字码 | 描述                     |
| ---------------------------- | ------ | ------------------------ |
| `AUTH_UNAUTHORIZED`          | 1001   | 未授权，Token 无效或过期 |
| `AUTH_TOKEN_EXPIRED`         | 1002   | Token 已过期             |
| `AUTH_PERMISSION_DENIED`     | 1003   | 权限不足                 |
| `AUTH_LOGIN_LOCKED`          | 1004   | 登录已被锁定             |
| `AUTH_DEVICE_LIMIT_EXCEEDED` | 1005   | 设备数量超限             |
| `AUTH_INVALID_CREDENTIALS`   | 1006   | 用户名或密码错误         |

#### 文件相关错误 (2xxx)

| 错误码                  | 数字码 | 描述             |
| ----------------------- | ------ | ---------------- |
| `FILE_NOT_FOUND`        | 2001   | 文件不存在       |
| `FILE_TOO_LARGE`        | 2002   | 文件大小超过限制 |
| `FILE_TYPE_NOT_ALLOWED` | 2003   | 文件类型不允许   |
| `FILE_ALREADY_EXISTS`   | 2004   | 文件已存在       |
| `FILE_INVALID_NAME`     | 2005   | 文件名无效       |
| `FOLDER_NOT_EMPTY`      | 2006   | 文件夹非空       |

#### 存储相关错误 (3xxx)

| 错误码                     | 数字码 | 描述         |
| -------------------------- | ------ | ------------ |
| `STORAGE_EXCEEDED`         | 3001   | 存储空间不足 |
| `STORAGE_BUCKET_ERROR`     | 3002   | 存储桶错误   |
| `STORAGE_BUCKET_NOT_FOUND` | 3003   | 存储桶不存在 |
| `STORAGE_UPLOAD_FAILED`    | 3004   | 上传失败     |

#### 分享相关错误 (4xxx)

| 错误码                          | 数字码 | 描述                 |
| ------------------------------- | ------ | -------------------- |
| `SHARE_EXPIRED`                 | 4001   | 分享链接已过期       |
| `SHARE_PASSWORD_REQUIRED`       | 4002   | 分享需要密码         |
| `SHARE_PASSWORD_INVALID`        | 4003   | 分享密码错误         |
| `SHARE_DOWNLOAD_LIMIT_EXCEEDED` | 4004   | 分享下载次数已达上限 |
| `SHARE_NOT_FOUND`               | 4005   | 分享不存在           |

#### 版本控制相关错误 (6xxx) - v3.3.0

| 错误码                   | 数字码 | 描述         |
| ------------------------ | ------ | ------------ |
| `VERSION_NOT_FOUND`      | 6001   | 版本不存在   |
| `VERSION_RESTORE_FAILED` | 6002   | 版本恢复失败 |
| `VERSION_LIMIT_EXCEEDED` | 6003   | 版本数量超限 |

#### 系统相关错误 (5xxx)

| 错误码             | 数字码 | 描述           |
| ------------------ | ------ | -------------- |
| `VALIDATION_ERROR` | 5001   | 参数验证失败   |
| `INTERNAL_ERROR`   | 5002   | 服务器内部错误 |
| `TASK_NOT_FOUND`   | 5003   | 任务不存在     |
| `TASK_EXPIRED`     | 5004   | 上传任务已过期 |
| `INVALID_URL`      | 5005   | URL 无效       |

#### 增强错误响应格式

```json
{
  "success": false,
  "error": {
    "code": "FILE_TOO_LARGE",
    "codeNumber": 2002,
    "message": "文件大小超过限制",
    "details": {
      "maxSize": 5368709120,
      "actualSize": 6442450944
    },
    "timestamp": "2024-03-24T12:00:00Z",
    "requestId": "req-abc123"
  }
}
```

---

## 认证接口

路由文件: `apps/api/src/routes/auth.ts`

### 获取注册配置

```http
GET /api/auth/registration-config
```

**响应**:

```json
{
  "success": true,
  "data": {
    "open": true,
    "requireInviteCode": false
  }
}
```

### 用户注册

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "用户名",
  "inviteCode": "邀请码（可选）"
}
```

**响应**:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "用户名",
      "role": "user",
      "storageQuota": 10737418240,
      "storageUsed": 0,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    },
    "token": "jwt-token",
    "deviceId": "device-uuid"
  }
}
```

### 用户登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "deviceId": "可选设备ID",
  "deviceName": "可选设备名称"
}
```

**响应**:

```json
{
  "success": true,
  "data": {
    "user": { ... },
    "token": "jwt-token",
    "deviceId": "device-uuid"
  }
}
```

### 用户登出

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

### 获取当前用户信息

```http
GET /api/auth/me
Authorization: Bearer <token>
```

### 更新用户信息

```http
PATCH /api/auth/me
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新昵称",
  "currentPassword": "当前密码",
  "newPassword": "新密码"
}
```

### 注销账户

```http
DELETE /api/auth/me
Authorization: Bearer <token>
Content-Type: application/json

{
  "password": "当前密码确认"
}
```

### 获取已登录设备

```http
GET /api/auth/devices
Authorization: Bearer <token>
```

### 注销设备

```http
DELETE /api/auth/devices/<deviceId>
Authorization: Bearer <token>
```

### 获取用户统计信息

```http
GET /api/auth/stats
Authorization: Bearer <token>
```

---

## 文件接口

路由文件: `apps/api/src/routes/files.ts`

### 列出文件

```http
GET /api/files?parentId=<folderId>&search=<keyword>&sortBy=name&sortOrder=asc
Authorization: Bearer <token>
```

**查询参数**:

| 参数        | 类型   | 说明                                               |
| ----------- | ------ | -------------------------------------------------- |
| `parentId`  | string | 父文件夹ID（可选，不传则列出根目录）               |
| `search`    | string | 搜索关键词（可选）                                 |
| `sortBy`    | string | 排序字段：`name`, `size`, `createdAt`, `updatedAt` |
| `sortOrder` | string | 排序方向：`asc` 或 `desc`                          |

### 创建文件夹

```http
POST /api/files
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新建文件夹",
  "parentId": null,
  "bucketId": "bucket-id"
}
```

### 上传文件（代理模式）

```http
POST /api/files/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <二进制文件>
parentId: <父文件夹ID>
bucketId: <存储桶ID>
```

### 获取文件信息

```http
GET /api/files/<fileId>
Authorization: Bearer <token>
```

### 更新文件/文件夹

```http
PUT /api/files/<fileId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新名称",
  "parentId": "新父文件夹ID"
}
```

### 更新文件夹设置

```http
PUT /api/files/<fileId>/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "allowedMimeTypes": ["image/*", "application/pdf"]
}
```

### 移动文件

```http
POST /api/files/<fileId>/move
Authorization: Bearer <token>
Content-Type: application/json

{
  "targetParentId": "目标文件夹ID"
}
```

### 删除文件/文件夹（移至回收站）

```http
DELETE /api/files/<fileId>
Authorization: Bearer <token>
```

### 下载文件

```http
GET /api/files/<fileId>/download
Authorization: Bearer <token>
```

### 文件预览

```http
GET /api/files/<fileId>/preview
Authorization: Bearer <token>
```

或通过 URL 参数传递 token：

```http
GET /api/files/<fileId>/preview?token=<jwt-token>
```

---

## 回收站接口

### 列出回收站文件

```http
GET /api/files/trash
Authorization: Bearer <token>
```

### 恢复文件

```http
POST /api/files/trash/<fileId>/restore
Authorization: Bearer <token>
```

### 永久删除

```http
DELETE /api/files/trash/<fileId>
Authorization: Bearer <token>
```

### 清空回收站

```http
DELETE /api/files/trash
Authorization: Bearer <token>
```

---

## 存储桶接口

路由文件: `apps/api/src/routes/buckets.ts`

### 列出存储桶

```http
GET /api/buckets
Authorization: Bearer <token>
```

### 获取存储提供商信息

```http
GET /api/buckets/providers
Authorization: Bearer <token>
```

返回支持的存储提供商列表及其默认配置。

### 创建存储桶

```http
POST /api/buckets
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "我的 S3 存储桶",
  "provider": "s3",
  "bucketName": "my-bucket",
  "endpoint": "https://s3.amazonaws.com",
  "region": "us-east-1",
  "accessKeyId": "AKIA...",
  "secretAccessKey": "secret...",
  "pathStyle": false,
  "isDefault": true,
  "notes": "备注",
  "storageQuota": 107374182400
}
```

**支持的 provider**: `r2`, `s3`, `oss`, `cos`, `obs`, `b2`, `minio`, `custom`, `telegram`

### 获取单个存储桶

```http
GET /api/buckets/<bucketId>
Authorization: Bearer <token>
```

### 更新存储桶

```http
PUT /api/buckets/<bucketId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "更新的名称",
  "isDefault": true
}
```

### 设为默认存储桶

```http
POST /api/buckets/<bucketId>/set-default
Authorization: Bearer <token>
```

### 启用/禁用存储桶

```http
POST /api/buckets/<bucketId>/toggle
Authorization: Bearer <token>
```

### 测试存储桶连接

```http
POST /api/buckets/<bucketId>/test
Authorization: Bearer <token>
```

### 删除存储桶

```http
DELETE /api/buckets/<bucketId>
Authorization: Bearer <token>
```

---

## Telegram 接口

路由文件: `apps/api/src/routes/telegram.ts`

### 测试 Telegram Bot 连接

```http
POST /api/telegram/test
Authorization: Bearer <token>
Content-Type: application/json

{
  "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "chatId": "-1001234567890",
  "apiBase": "https://api.telegram.org"
}
```

**响应**:

```json
{
  "success": true,
  "data": {
    "connected": true,
    "message": "连接成功！Bot @botname → Chat Title",
    "botName": "botname",
    "chatTitle": "Chat Title"
  }
}
```

---

## 存储桶迁移接口

路由文件: `apps/api/src/routes/migrate.ts`

### 启动迁移任务

```http
POST /api/migrate/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "sourceBucketId": "来源存储桶ID",
  "targetBucketId": "目标存储桶ID",
  "fileIds": ["fileId1", "fileId2"],
  "targetFolderId": "目标文件夹ID",
  "deleteSource": false
}
```

| 参数             | 说明                    |
| ---------------- | ----------------------- |
| `sourceBucketId` | 来源存储桶ID            |
| `targetBucketId` | 目标存储桶ID            |
| `fileIds`        | 可选，不传则迁移整个桶  |
| `targetFolderId` | 可选，不传则保持原位置  |
| `deleteSource`   | 可选，`true` = 移动模式 |

**响应**:

```json
{
  "success": true,
  "data": {
    "migrationId": "uuid",
    "total": 100,
    "status": "running",
    "message": "迁移任务已启动，共 100 个文件"
  }
}
```

### 查询迁移进度

```http
GET /api/migrate/<migrationId>
Authorization: Bearer <token>
```

### 取消迁移

```http
POST /api/migrate/<migrationId>/cancel
Authorization: Bearer <token>
```

---

## 预签名上传接口

路由文件: `apps/api/src/routes/presign.ts`

### 获取上传预签名 URL

```http
POST /api/presign/upload
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileName": "example.zip",
  "fileSize": 52428800,
  "mimeType": "application/zip",
  "parentId": null,
  "bucketId": null
}
```

**响应（小文件）**:

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...",
    "fileId": "uuid",
    "r2Key": "files/userId/fileId/example.zip",
    "bucketId": "bucket-uuid",
    "expiresIn": 3600
  }
}
```

**响应（需要代理）**:

```json
{
  "success": true,
  "data": {
    "useProxy": true
  }
}
```

### 确认上传

```http
POST /api/presign/confirm
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "uuid",
  "fileName": "example.zip",
  "fileSize": 52428800,
  "mimeType": "application/zip",
  "parentId": null,
  "r2Key": "files/userId/fileId/example.zip",
  "bucketId": "bucket-uuid"
}
```

### 分片上传初始化

```http
POST /api/presign/multipart/init
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileName": "large-file.iso",
  "fileSize": 5368709120,
  "mimeType": "application/octet-stream",
  "parentId": null,
  "bucketId": null
}
```

### 获取分片上传 URL

```http
POST /api/presign/multipart/part
Authorization: Bearer <token>
Content-Type: application/json

{
  "r2Key": "files/userId/fileId/large-file.iso",
  "uploadId": "upload-id",
  "partNumber": 2,
  "bucketId": "bucket-uuid"
}
```

### 完成分片上传

```http
POST /api/presign/multipart/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "uuid",
  "fileName": "large-file.iso",
  "fileSize": 5368709120,
  "mimeType": "application/octet-stream",
  "parentId": null,
  "r2Key": "files/userId/fileId/large-file.iso",
  "uploadId": "upload-id",
  "bucketId": "bucket-uuid",
  "parts": [
    { "partNumber": 1, "etag": "etag-1" },
    { "partNumber": 2, "etag": "etag-2" }
  ]
}
```

### 取消分片上传

```http
POST /api/presign/multipart/abort
Authorization: Bearer <token>
Content-Type: application/json

{
  "r2Key": "files/userId/fileId/large-file.iso",
  "uploadId": "upload-id",
  "bucketId": "bucket-uuid"
}
```

### 获取下载预签名 URL

```http
GET /api/presign/download/<fileId>
Authorization: Bearer <token>
```

### 获取预览预签名 URL

```http
GET /api/presign/preview/<fileId>
Authorization: Bearer <token>
```

---

## 分享接口

路由文件: `apps/api/src/routes/share.ts`

### 创建下载分享

```http
POST /api/share
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file-id",
  "password": "访问密码",
  "expiresAt": "2024-12-31T23:59:59Z",
  "downloadLimit": 10
}
```

### 创建上传链接

```http
POST /api/share/upload-link
Authorization: Bearer <token>
Content-Type: application/json

{
  "folderId": "文件夹ID",
  "password": "访问密码",
  "expiresAt": "2024-12-31T23:59:59Z",
  "maxUploadSize": 104857600,
  "allowedMimeTypes": ["image/*", "application/pdf"],
  "maxUploadCount": 10
}
```

### 获取分享信息（公开）

```http
GET /api/share/<shareId>?password=<密码>
```

### 分享预览（公开，仅图片）

```http
GET /api/share/<shareId>/preview?password=<密码>
```

### 下载分享文件（公开）

```http
GET /api/share/<shareId>/download?password=<密码>
```

### 下载文件夹分享的 ZIP（公开）

```http
GET /api/share/<shareId>/zip?password=<密码>&fileIds=id1,id2
```

### 下载文件夹分享中的单个文件（公开）

```http
GET /api/share/<shareId>/file/<fileId>/download?password=<密码>
```

### 获取上传链接信息（公开）

```http
GET /api/share/upload/<uploadToken>?password=<密码>
```

### 通过上传链接上传文件（公开）

```http
POST /api/share/upload/<uploadToken>
Content-Type: multipart/form-data

file: <二进制文件>
password: <密码（可选）>
```

### 列出我的分享

```http
GET /api/share
Authorization: Bearer <token>
```

### 删除分享

```http
DELETE /api/share/<shareId>
Authorization: Bearer <token>
```

### 分享预览（公开，支持图片/视频/音频/PDF/文本）

```http
GET /api/share/<shareId>/preview?password=<密码>
```

返回文件内容，用于在线预览。

### 分享流式预览（公开，视频/音频）

```http
GET /api/share/<shareId>/stream?password=<密码>
```

支持 Range 请求，适用于视频/音频流式播放。

### 分享文本内容（公开）

```http
GET /api/share/<shareId>/raw?password=<密码>
```

返回文本文件内容（限 10MB 以内）。

### 文件夹分享子文件预览（公开）

```http
GET /api/share/<shareId>/file/<fileId>/preview?password=<密码>
```

预览文件夹分享中的单个文件。

### 文件夹分享子文件流式预览（公开）

```http
GET /api/share/<shareId>/file/<fileId>/stream?password=<密码>
```

流式预览文件夹分享中的视频/音频文件。

### 文件夹分享子文件文本内容（公开）

```http
GET /api/share/<shareId>/file/<fileId>/raw?password=<密码>
```

获取文件夹分享中文本文件的内容。

---

## 文件直链接口

路由文件: `apps/api/src/routes/directLink.ts`

文件直链允许为文件生成公开访问链接，无需登录即可下载或预览文件。

### 创建直链

```http
POST /api/direct
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file-id",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

**参数说明**:

| 参数        | 说明                        |
| ----------- | --------------------------- |
| `fileId`    | 文件 ID（必填）             |
| `expiresAt` | 过期时间（可选，默认 7 天） |

**响应**:

```json
{
  "success": true,
  "data": {
    "token": "uuid-token",
    "fileId": "file-id",
    "fileName": "example.pdf",
    "directUrl": "https://your-domain.com/api/direct/uuid-token",
    "expiresAt": "2024-12-31T23:59:59Z",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### 获取文件的直链信息

```http
GET /api/direct/file/<fileId>
Authorization: Bearer <token>
```

返回指定文件的直链信息，如果未创建直链则返回 `null`。

### 通过直链下载文件（公开）

```http
GET /api/direct/<token>
```

无需认证，直接下载文件。

### 通过直链预览文件（公开）

```http
GET /api/direct/<token>/preview
```

无需认证，在线预览文件（支持图片、视频、音频、PDF、文本等）。

### 获取直链信息（公开）

```http
GET /api/direct/<token>/info
```

返回直链对应的文件信息（文件名、大小、MIME 类型、过期时间）。

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "file-id",
    "name": "example.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "directLinkExpiresAt": "2024-12-31T23:59:59Z"
  }
}
```

### 更新直链有效期

```http
PUT /api/direct/<fileId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

### 删除直链

```http
DELETE /api/direct/<fileId>
Authorization: Bearer <token>
```

---

## 批量操作接口

路由文件: `apps/api/src/routes/batch.ts`

### 批量删除（移至回收站）

```http
POST /api/batch/delete
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileIds": ["id1", "id2", "id3"]
}
```

### 批量移动

```http
POST /api/batch/move
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileIds": ["id1", "id2"],
  "targetParentId": "folder-id"
}
```

### 批量复制

```http
POST /api/batch/copy
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileIds": ["id1", "id2"],
  "targetParentId": "folder-id",
  "targetBucketId": "bucket-id"
}
```

### 批量重命名

```http
POST /api/batch/rename
Authorization: Bearer <token>
Content-Type: application/json

{
  "items": [
    { "fileId": "id1", "newName": "新名称1" },
    { "fileId": "id2", "newName": "新名称2" }
  ]
}
```

### 批量永久删除

```http
POST /api/batch/permanent-delete
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileIds": ["id1", "id2"]
}
```

### 批量恢复

```http
POST /api/batch/restore
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileIds": ["id1", "id2"]
}
```

---

## 搜索接口

路由文件: `apps/api/src/routes/search.ts`

### 搜索文件

```http
GET /api/search?query=keyword&parentId=folderId&tags=tag1,tag2&mimeType=image/*&minSize=0&maxSize=10485760&createdAfter=2024-01-01T00:00:00Z&createdBefore=2024-12-31T23:59:59Z&isFolder=false&bucketId=bucket-id&sortBy=createdAt&sortOrder=desc&page=1&limit=50
Authorization: Bearer <token>
```

**查询参数**:

| 参数                             | 说明                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `query`                          | 搜索关键词                                           |
| `parentId`                       | 搜索范围（文件夹ID）                                 |
| `tags`                           | 标签过滤（逗号分隔）                                 |
| `mimeType`                       | MIME类型过滤（支持通配符如 `image/*`）               |
| `minSize` / `maxSize`            | 文件大小范围（字节）                                 |
| `createdAfter` / `createdBefore` | 创建时间范围                                         |
| `updatedAfter` / `updatedBefore` | 更新时间范围                                         |
| `isFolder`                       | 是否只搜索文件夹                                     |
| `bucketId`                       | 存储桶过滤                                           |
| `sortBy`                         | 排序字段（`name`, `size`, `createdAt`, `updatedAt`） |
| `sortOrder`                      | 排序方向（`asc`, `desc`）                            |
| `page` / `limit`                 | 分页                                                 |

### 高级搜索

```http
POST /api/search/advanced
Authorization: Bearer <token>
Content-Type: application/json

{
  "conditions": [
    { "field": "name", "operator": "contains", "value": "report" },
    { "field": "size", "operator": "gte", "value": 1048576 }
  ],
  "logic": "and",
  "sortBy": "createdAt",
  "sortOrder": "desc",
  "page": 1,
  "limit": 50
}
```

**支持的 field**: `name`, `mimeType`, `size`, `createdAt`, `updatedAt`, `tags`

**支持的 operator**: `contains`, `equals`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `in`

### 搜索建议

```http
GET /api/search/suggestions?q=keyword&type=name
Authorization: Bearer <token>
```

**type**: `name`（文件名）, `tags`（标签）, `mime`（MIME类型）

### 最近文件

```http
GET /api/search/recent?limit=20
Authorization: Bearer <token>
```

---

## 权限与标签接口

路由文件: `apps/api/src/routes/permissions.ts`

### 授予权限

```http
POST /api/permissions/grant
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file-id",
  "userId": "user-id",
  "permission": "read"
}
```

**permission**: `read`（只读）, `write`（读写）, `admin`（管理）

### 撤销权限

```http
POST /api/permissions/revoke
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file-id",
  "userId": "user-id"
}
```

### 获取文件权限列表

```http
GET /api/permissions/file/<fileId>
Authorization: Bearer <token>
```

### 检查权限

```http
GET /api/permissions/check/<fileId>
Authorization: Bearer <token>
```

### 搜索用户（用于授权）

```http
GET /api/permissions/users/search?q=email@example.com
Authorization: Bearer <token>
```

### 添加标签

```http
POST /api/permissions/tags/add
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file-id",
  "name": "重要",
  "color": "#ef4444"
}
```

### 移除标签

```http
POST /api/permissions/tags/remove
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file-id",
  "tagName": "重要"
}
```

### 获取文件标签

```http
GET /api/permissions/tags/file/<fileId>
Authorization: Bearer <token>
```

### 获取用户所有标签

```http
GET /api/permissions/tags/user
Authorization: Bearer <token>
```

### 批量获取标签

```http
POST /api/permissions/tags/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileIds": ["id1", "id2"]
}
```

---

## 上传任务接口

路由文件: `apps/api/src/routes/tasks.ts`

### 创建上传任务

```http
POST /api/tasks/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileName": "large-file.iso",
  "fileSize": 5368709120,
  "mimeType": "application/octet-stream",
  "parentId": null,
  "bucketId": null
}
```

### 获取分片上传 URL（S3）

```http
POST /api/tasks/part
Authorization: Bearer <token>
Content-Type: application/json

{
  "taskId": "uuid",
  "partNumber": 1
}
```

### 标记分片完成（S3）

```http
POST /api/tasks/part-done
Authorization: Bearer <token>
Content-Type: application/json

{
  "taskId": "uuid",
  "partNumber": 1,
  "etag": "etag-value"
}
```

### 代理上传分片（S3）

```http
POST /api/tasks/part-proxy
Authorization: Bearer <token>
Content-Type: multipart/form-data

taskId: <taskId>
partNumber: <partNumber>
chunk: <二进制数据>
```

### Telegram 分片上传

```http
POST /api/tasks/telegram-part
Authorization: Bearer <token>
Content-Type: multipart/form-data

taskId: <taskId>
partNumber: <partNumber>
chunk: <二进制数据>
```

### 完成上传任务

```http
POST /api/tasks/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "taskId": "uuid",
  "parts": [
    { "partNumber": 1, "etag": "etag-1" }
  ],
  "hash": "可选的文件哈希"
}
```

### 取消上传任务

```http
POST /api/tasks/abort
Authorization: Bearer <token>
Content-Type: application/json

{
  "taskId": "uuid"
}
```

### 列出上传任务

```http
GET /api/tasks/list
Authorization: Bearer <token>
```

### 获取单个任务

```http
GET /api/tasks/<taskId>
Authorization: Bearer <token>
```

### 删除任务

```http
DELETE /api/tasks/<taskId>
Authorization: Bearer <token>
```

### 暂停任务

```http
POST /api/tasks/<taskId>/pause
Authorization: Bearer <token>
```

### 恢复任务

```http
POST /api/tasks/<taskId>/resume
Authorization: Bearer <token>
```

### 清空历史任务

```http
DELETE /api/tasks/clear
Authorization: Bearer <token>
```

### 清空已完成任务

```http
DELETE /api/tasks/clear-completed
Authorization: Bearer <token>
```

### 清空失败任务

```http
DELETE /api/tasks/clear-failed
Authorization: Bearer <token>
```

### 清空所有任务

```http
DELETE /api/tasks/clear-all
Authorization: Bearer <token>
```

---

## 离线下载接口

路由文件: `apps/api/src/routes/downloads.ts`

### 创建下载任务

```http
POST /api/downloads/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://example.com/file.zip",
  "fileName": "downloaded-file.zip",
  "parentId": null,
  "bucketId": null
}
```

### 列出下载任务

```http
GET /api/downloads/list?status=completed&page=1&limit=20
Authorization: Bearer <token>
```

**status**: `pending`, `downloading`, `completed`, `failed`, `paused`

### 获取单个任务

```http
GET /api/downloads/<taskId>
Authorization: Bearer <token>
```

### 更新任务

```http
PATCH /api/downloads/<taskId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileName": "new-name.zip",
  "parentId": "folder-id",
  "bucketId": "bucket-id"
}
```

### 删除任务

```http
DELETE /api/downloads/<taskId>
Authorization: Bearer <token>
```

### 重试失败任务

```http
POST /api/downloads/<taskId>/retry
Authorization: Bearer <token>
```

### 暂停任务

```http
POST /api/downloads/<taskId>/pause
Authorization: Bearer <token>
```

### 恢复任务

```http
POST /api/downloads/<taskId>/resume
Authorization: Bearer <token>
```

### 清理已完成任务

```http
DELETE /api/downloads/completed
Authorization: Bearer <token>
```

### 清理失败任务

```http
DELETE /api/downloads/failed
Authorization: Bearer <token>
```

---

## 预览接口

路由文件: `apps/api/src/routes/preview.ts`

### 支持的预览类型

| 类型       | MIME 类型 / 扩展名                        | 预览方式                        |
| ---------- | ----------------------------------------- | ------------------------------- |
| 图片       | image/\*                                  | 浏览器原生 `<img>`              |
| 视频       | video/\*                                  | 浏览器原生 `<video>`            |
| 音频       | audio/\*                                  | 浏览器原生 `<audio>`            |
| PDF        | application/pdf                           | pdf.js 分页渲染                 |
| Markdown   | text/markdown, .md                        | react-markdown + GFM + 数学公式 |
| 代码       | text/\*, .js/.ts/.py 等                   | highlight.js 语法高亮           |
| Word       | application/msword, .docx                 | docx-preview 本地渲染           |
| Excel      | application/vnd.ms-excel, .xlsx           | xlsx 库 + 样式保留              |
| PowerPoint | application/vnd.ms-powerpoint, .pptx      | pptx-preview 本地渲染           |
| EPUB       | application/epub+zip, .epub               | epub.js 电子书阅读器            |
| 字体       | font/ttf, font/otf, font/woff, font/woff2 | FontFace API 字符预览           |
| ZIP        | application/zip                           | JSZip 文件列表预览              |
| CSV        | text/csv, .csv                            | PapaParse 表格视图              |

### 预览大小限制

- **最大预览文件大小**: 30MB（定义于 `apps/api/src/routes/preview.ts`）
- 超过限制的文件将提示下载查看

### 获取预览信息

```http
GET /api/preview/<fileId>/info
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "file-id",
    "name": "document.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "previewable": true,
    "previewType": "pdf",
    "language": null,
    "extension": ".pdf",
    "canPreview": true
  }
}
```

**previewType**: `image`, `video`, `audio`, `pdf`, `text`, `markdown`, `csv`, `code`, `word`, `excel`, `powerpoint`, `epub`, `font`, `archive`, `unknown`

### 获取原始内容

```http
GET /api/preview/<fileId>/raw
Authorization: Bearer <token>
```

返回文本内容（限 10MB 以内文件）。

### 流式预览

```http
GET /api/preview/<fileId>/stream
Authorization: Bearer <token>
```

支持 Range 请求，适用于视频/音频流式播放。

### 获取缩略图

```http
GET /api/preview/<fileId>/thumbnail?width=256&height=256
Authorization: Bearer <token>
```

仅支持图片文件。

### Office 文档预览

```http
GET /api/preview/<fileId>/office
Authorization: Bearer <token>
```

返回 Base64 编码的文件内容，用于前端 Office 预览组件。

---

## 版本控制接口

路由文件: `apps/api/src/routes/versions.ts`

版本控制功能允许管理文件的历史版本，支持版本回滚和对比。

> **v3.5.0 重要变更**: 版本控制仅支持可编辑的文本文件类型（代码、配置、Markdown 等）。图片、视频、音频等二进制文件不再支持版本控制。

### 获取文件版本列表

```http
GET /api/versions/file/<fileId>
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "fileId": "file-id",
    "currentVersion": 3,
    "totalVersions": 3,
    "versionable": true,
    "versions": [
      {
        "id": "version-id-1",
        "versionNumber": 1,
        "size": 1048576,
        "hash": "sha256-hash",
        "note": "初始版本",
        "tags": ["release"],
        "createdAt": "2024-03-20T10:00:00Z",
        "createdBy": {
          "id": "user-id",
          "name": "用户名"
        }
      },
      {
        "id": "version-id-2",
        "versionNumber": 2,
        "size": 2097152,
        "hash": "sha256-hash-2",
        "note": "更新内容",
        "tags": [],
        "createdAt": "2024-03-22T14:30:00Z",
        "createdBy": {
          "id": "user-id",
          "name": "用户名"
        }
      }
    ]
  }
}
```

### 获取单个版本信息

```http
GET /api/versions/<versionId>
Authorization: Bearer <token>
```

### 创建新版本

```http
POST /api/versions/create
Authorization: Bearer <token>
Content-Type: multipart/form-data

fileId: <fileId>
file: <二进制文件>
note: 版本备注
tags: ["tag1", "tag2"]
```

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "new-version-id",
    "fileId": "file-id",
    "versionNumber": 4,
    "size": 3145728,
    "hash": "sha256-hash-new",
    "note": "版本备注",
    "tags": ["tag1", "tag2"],
    "createdAt": "2024-03-24T12:00:00Z"
  }
}
```

### 版本回滚

```http
POST /api/versions/<versionId>/restore
Authorization: Bearer <token>
Content-Type: application/json

{
  "note": "回滚到版本3"
}
```

回滚后会创建一个新版本，内容与目标版本相同。

### 版本对比

```http
GET /api/versions/compare?fileId=<fileId>&v1=1&v2=3
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "fileId": "file-id",
    "version1": {
      "versionNumber": 1,
      "size": 1048576,
      "hash": "sha256-hash-1",
      "createdAt": "2024-03-20T10:00:00Z"
    },
    "version2": {
      "versionNumber": 3,
      "size": 3145728,
      "hash": "sha256-hash-3",
      "createdAt": "2024-03-24T12:00:00Z"
    },
    "diff": {
      "sizeDiff": 2097152,
      "modified": true
    }
  }
}
```

### 下载指定版本

```http
GET /api/versions/<versionId>/download
Authorization: Bearer <token>
```

### 更新版本备注

```http
PATCH /api/versions/<versionId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "note": "更新后的备注",
  "tags": ["important", "release"]
}
```

### 删除版本

```http
DELETE /api/versions/<versionId>
Authorization: Bearer <token>
```

> **注意**: 无法删除当前正在使用的版本，需要先回滚到其他版本。

### 获取版本统计

```http
GET /api/versions/stats
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "totalVersions": 150,
    "totalSize": 524288000,
    "filesWithVersions": 45,
    "oldestVersion": "2024-01-01T00:00:00Z",
    "newestVersion": "2024-03-24T12:00:00Z"
  }
}
```

---

## 文件笔记接口

路由文件: `apps/api/src/routes/notes.ts`

文件笔记功能允许用户为文件添加评论和讨论，支持 @提及和嵌套回复。

### 获取文件笔记列表

```http
GET /api/notes/file/<fileId>
Authorization: Bearer <token>
```

**查询参数**:

| 参数    | 说明              |
| ------- | ----------------- |
| `page`  | 页码，默认 1      |
| `limit` | 每页数量，默认 20 |

**响应**:

```json
{
  "success": true,
  "data": {
    "notes": [
      {
        "id": "note-id",
        "fileId": "file-id",
        "content": "这是一条笔记评论",
        "mentions": ["user-id-1", "user-id-2"],
        "parentId": null,
        "replies": [
          {
            "id": "reply-id",
            "content": "这是一条回复",
            "mentions": [],
            "createdBy": {
              "id": "user-id",
              "name": "用户名",
              "email": "user@example.com"
            },
            "createdAt": "2026-03-30T10:00:00Z"
          }
        ],
        "createdBy": {
          "id": "user-id",
          "name": "用户名",
          "email": "user@example.com"
        },
        "createdAt": "2026-03-30T09:00:00Z",
        "updatedAt": "2026-03-30T09:00:00Z"
      }
    ],
    "total": 10,
    "page": 1,
    "limit": 20
  }
}
```

### 创建笔记

```http
POST /api/notes
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file-id",
  "content": "这是一条笔记，@user@example.com 请查看",
  "parentId": null
}
```

**说明**:

- `content` 中使用 `@邮箱` 格式可以提及其他用户
- `parentId` 为 null 时是顶级笔记，否则是回复

### 更新笔记

```http
PATCH /api/notes/<noteId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "更新后的笔记内容"
}
```

### 删除笔记

```http
DELETE /api/notes/<noteId>
Authorization: Bearer <token>
```

> **注意**: 删除顶级笔记会同时删除所有回复

### 获取用户被提及的笔记

```http
GET /api/notes/mentions
Authorization: Bearer <token>
```

---

## API Keys 接口

路由文件: `apps/api/src/routes/apiKeys.ts`

API Key 管理功能允许用户创建和管理用于程序化访问的密钥。

详细的 API Key 使用指南请参阅 [api-key-guide.md](api-key-guide.md)。

### 获取 API Key 列表

```http
GET /api/api-keys
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "keys": [
      {
        "id": "key-id",
        "name": "我的脚本密钥",
        "prefix": "osk_live_abc123",
        "scopes": ["files:read", "files:write"],
        "expiresAt": "2027-03-30T00:00:00Z",
        "lastUsedAt": "2026-03-29T15:30:00Z",
        "createdAt": "2026-03-30T10:00:00Z"
      }
    ],
    "total": 1
  }
}
```

> **注意**: 完整的密钥只在创建时显示一次，之后只显示前缀

### 创建 API Key

```http
POST /api/api-keys
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "我的脚本密钥",
  "scopes": ["files:read", "files:write"],
  "expiresInDays": 365
}
```

**可用 Scopes**:

| Scope           | 说明                 |
| --------------- | -------------------- |
| `files:read`    | 读取文件列表和内容   |
| `files:write`   | 上传、修改、删除文件 |
| `shares:read`   | 查看分享信息         |
| `shares:write`  | 创建和管理分享       |
| `buckets:read`  | 查看存储桶配置       |
| `api_keys:read` | 查看 API Keys 列表   |

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "key-id",
    "name": "我的脚本密钥",
    "key": "osk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "scopes": ["files:read", "files:write"],
    "expiresAt": "2027-03-30T00:00:00Z",
    "createdAt": "2026-03-30T10:00:00Z"
  }
}
```

> **重要**: `key` 字段仅在创建时返回，请立即保存！

### 撤销 API Key

```http
DELETE /api/api-keys/<keyId>
Authorization: Bearer <token>
```

### 获取 API Key 使用统计

```http
GET /api/api-keys/<keyId>/stats
Authorization: Bearer <token>
```

---

## 管理员接口

路由文件: `apps/api/src/routes/admin.ts`

所有管理员接口需要 `admin` 角色。

### 获取用户列表

```http
GET /api/admin/users
Authorization: Bearer <token>
```

### 获取单个用户

```http
GET /api/admin/users/<userId>
Authorization: Bearer <token>
```

### 更新用户

```http
PATCH /api/admin/users/<userId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新名称",
  "role": "user",
  "storageQuota": 21474836480,
  "newPassword": "new-password"
}
```

### 删除用户

```http
DELETE /api/admin/users/<userId>
Authorization: Bearer <token>
```

### 获取注册配置

```http
GET /api/admin/registration
Authorization: Bearer <token>
```

### 更新注册配置

```http
PUT /api/admin/registration
Authorization: Bearer <token>
Content-Type: application/json

{
  "open": false,
  "requireInviteCode": true
}
```

### 创建邀请码

```http
POST /api/admin/registration/codes
Authorization: Bearer <token>
Content-Type: application/json

{
  "count": 5
}
```

### 删除邀请码

```http
DELETE /api/admin/registration/codes/<code>
Authorization: Bearer <token>
```

### 获取系统统计

```http
GET /api/admin/stats
Authorization: Bearer <token>
```

### 获取审计日志

```http
GET /api/admin/audit-logs?page=1&limit=50&userId=user-id&action=user.login
Authorization: Bearer <token>
```

---

## 定时任务接口

路由文件: `apps/api/src/routes/cron.ts`

这些接口通常由 Cloudflare Cron Triggers 调用。

### 回收站清理

```http
POST /cron/trash-cleanup
```

清理超过保留期的回收站文件。

### 会话清理

```http
POST /cron/session-cleanup
```

清理过期的 WebDAV 会话、上传任务和登录记录。

### 分享清理

```http
POST /cron/share-cleanup
```

清理过期的分享链接。

### 全量清理

```http
POST /cron/all
```

执行所有清理任务。

---

## WebDAV 接口

路由文件: `apps/api/src/routes/webdav.ts`

WebDAV 协议端点: `/dav`

### 连接配置

| 配置项     | 值                            |
| ---------- | ----------------------------- |
| 服务器地址 | `https://your-domain.com/dav` |
| 用户名     | 注册邮箱                      |
| 密码       | 账户密码                      |
| 认证方式   | Basic Auth                    |

### 支持的操作

| 操作        | 方法      | 描述                          |
| ----------- | --------- | ----------------------------- |
| 列出目录    | PROPFIND  | Depth: 0 (当前), 1 (包含子项) |
| 下载文件    | GET       | -                             |
| 查看文件头  | HEAD      | -                             |
| 上传文件    | PUT       | 自动创建父目录                |
| 创建目录    | MKCOL     | -                             |
| 删除        | DELETE    | 永久删除                      |
| 移动/重命名 | MOVE      | 需要 Destination 头           |
| 复制        | COPY      | 需要 Destination 头           |
| 锁定资源    | LOCK      | 支持 Windows 资源管理器       |
| 解锁资源    | UNLOCK    | 支持 Windows 资源管理器       |
| 属性修改    | PROPPATCH | 只读属性，返回 403            |

### Windows 资源管理器兼容性优化

- **401 响应必须携带 DAV 头**：Windows Mini-Redirector 以此判断服务器是否支持 WebDAV
- **PROPFIND 响应路径精确匹配**：根节点 `<href>` 必须与请求路径完全一致
- **实现 LOCK/UNLOCK**：Windows 在写操作前会发送 LOCK 请求，缺少此功能会导致卡死
- **路径规范化**：自动处理路径末尾斜杠，确保路径一致性

### PROPFIND 示例

```http
PROPFIND /dav/ HTTP/1.1
Host: your-domain.com
Authorization: Basic base64(email:password)
Depth: 1
```

### PUT 上传示例

```http
PUT /dav/folder/file.txt HTTP/1.1
Host: your-domain.com
Authorization: Basic base64(email:password)
Content-Type: text/plain

文件内容...
```

### MKCOL 创建目录示例

```http
MKCOL /dav/new-folder/ HTTP/1.1
Host: your-domain.com
Authorization: Basic base64(email:password)
```

### MOVE 移动示例

```http
MOVE /dav/old-name.txt HTTP/1.1
Host: your-domain.com
Authorization: Basic base64(email:password)
Destination: https://your-domain.com/dav/new-name.txt
```

### COPY 复制示例

```http
COPY /dav/file.txt HTTP/1.1
Host: your-domain.com
Authorization: Basic base64(email:password)
Destination: https://your-domain.com/dav/copy-of-file.txt
```

---

## 用户组接口

路由文件: `apps/api/src/routes/groups.ts`

用户组功能允许创建和管理用户组，实现批量权限管理。

### 获取用户组列表

```http
GET /api/groups
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": [
    {
      "id": "group-id",
      "name": "开发团队",
      "description": "开发部门成员",
      "ownerId": "user-id",
      "memberCount": 5,
      "createdAt": "2026-03-31T10:00:00Z",
      "updatedAt": "2026-03-31T10:00:00Z"
    }
  ]
}
```

### 创建用户组

```http
POST /api/groups
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "开发团队",
  "description": "开发部门成员"
}
```

### 获取用户组详情

```http
GET /api/groups/<groupId>
Authorization: Bearer <token>
```

### 更新用户组

```http
PUT /api/groups/<groupId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新名称",
  "description": "新描述"
}
```

### 删除用户组

```http
DELETE /api/groups/<groupId>
Authorization: Bearer <token>
```

### 获取组成员列表

```http
GET /api/groups/<groupId>/members
Authorization: Bearer <token>
```

### 添加组成员

```http
POST /api/groups/<groupId>/members
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "user-id",
  "role": "member"
}
```

**role**: `member`（普通成员）或 `admin`（组管理员）

### 移除组成员

```http
DELETE /api/groups/<groupId>/members/<userId>
Authorization: Bearer <token>
```

### 更新成员角色

```http
PUT /api/groups/<groupId>/members/<userId>/role
Authorization: Bearer <token>
Content-Type: application/json

{
  "role": "admin"
}
```

---

## Webhook 接口

路由文件: `apps/api/src/routes/webhooks.ts`

Webhook 功能允许订阅文件事件，实现第三方系统集成。

### 获取 Webhook 列表

```http
GET /api/webhooks
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": [
    {
      "id": "webhook-id",
      "url": "https://example.com/webhook",
      "events": ["file.uploaded", "file.deleted"],
      "isActive": true,
      "lastStatus": 200,
      "createdAt": "2026-03-31T10:00:00Z"
    }
  ]
}
```

### 创建 Webhook

```http
POST /api/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://example.com/webhook",
  "events": ["file.uploaded", "file.deleted", "file.updated"]
}
```

**支持的事件**:

| 事件                 | 说明         |
| -------------------- | ------------ |
| `file.uploaded`      | 文件上传完成 |
| `file.deleted`       | 文件删除     |
| `file.updated`       | 文件更新     |
| `share.created`      | 分享创建     |
| `share.deleted`      | 分享删除     |
| `permission.granted` | 权限授予     |
| `permission.revoked` | 权限撤销     |

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "webhook-id",
    "url": "https://example.com/webhook",
    "secret": "whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "events": ["file.uploaded", "file.deleted"],
    "warning": "请妥善保存此密钥，系统不会再次显示"
  }
}
```

> **重要**: `secret` 字段仅在创建时返回，用于验证 Webhook 签名

### 删除 Webhook

```http
DELETE /api/webhooks/<webhookId>
Authorization: Bearer <token>
```

### Webhook 签名验证

Webhook 请求会携带 `X-Webhook-Signature` 头，使用 HMAC-SHA256 签名：

```typescript
// 验证示例
const signature = request.headers['x-webhook-signature'];
const expectedSignature = await hmacSha256(secret, requestBody);

if (signature === expectedSignature) {
  // 验证通过
}
```

### Webhook 请求格式

```json
{
  "event": "file.uploaded",
  "timestamp": "2026-03-31T10:00:00Z",
  "data": {
    "fileId": "file-id",
    "fileName": "document.pdf",
    "fileSize": 1048576,
    "mimeType": "application/pdf",
    "userId": "user-id",
    "bucketId": "bucket-id"
  }
}
```

---

## AI 功能接口

路由文件: `apps/api/src/routes/ai.ts`

AI 功能基于 Cloudflare AI 和 Vectorize 实现，提供文件摘要、图片标签、智能重命名和语义搜索等功能。

### 获取 AI 功能状态

```http
GET /api/ai/status
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "configured": true,
    "features": {
      "semanticSearch": true,
      "summary": true,
      "imageTags": true,
      "renameSuggest": true
    }
  }
}
```

### 语义搜索

```http
POST /api/ai/search
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "查找关于项目计划的文档",
  "limit": 20,
  "threshold": 0.7,
  "mimeType": "application/pdf"
}
```

**参数说明**:

| 参数        | 类型   | 必填 | 说明                              |
| ----------- | ------ | ---- | --------------------------------- |
| `query`     | string | 是   | 搜索查询文本                      |
| `limit`     | number | 否   | 返回结果数量，默认 20，最大 50    |
| `threshold` | number | 否   | 相似度阈值，默认 0.7，范围 0-1    |
| `mimeType`  | string | 否   | MIME 类型过滤                     |

**响应**:

```json
{
  "success": true,
  "data": [
    {
      "id": "file-id",
      "name": "项目计划书.pdf",
      "size": 1048576,
      "mimeType": "application/pdf",
      "score": 0.85,
      "aiSummary": "这是一份关于2026年项目开发的计划书...",
      "createdAt": "2026-04-01T10:00:00Z"
    }
  ]
}
```

### 生成文件摘要

```http
POST /api/ai/summarize/:fileId
Authorization: Bearer <token>
```

为文本文件生成内容摘要，使用 Llama 3.1 8B 模型。

**响应**:

```json
{
  "success": true,
  "data": {
    "summary": "这是一份项目开发文档，主要包含技术架构设计和开发计划...",
    "cached": false
  }
}
```

### 生成图片标签

```http
POST /api/ai/tags/:fileId
Authorization: Bearer <token>
```

为图片文件生成智能标签和描述，使用 LLaVA 1.5 7B 和 ResNet-50 模型。

**响应**:

```json
{
  "success": true,
  "data": {
    "tags": ["风景", "山脉", "自然", "户外", "天空"],
    "caption": "一张展示壮丽山脉风景的照片，天空中有白云..."
  }
}
```

### 智能重命名建议

```http
POST /api/ai/rename-suggest/:fileId
Authorization: Bearer <token>
```

根据文件内容智能推荐文件名。

**响应**:

```json
{
  "success": true,
  "data": {
    "suggestions": [
      "项目开发计划书.pdf",
      "2026年项目规划文档.pdf",
      "技术架构设计方案.pdf"
    ]
  }
}
```

### 获取文件 AI 信息

```http
GET /api/ai/file/:fileId
Authorization: Bearer <token>
```

获取文件的 AI 处理信息，包括摘要、标签和向量索引状态。

**响应**:

```json
{
  "success": true,
  "data": {
    "hasSummary": true,
    "summary": "文件摘要内容...",
    "summaryAt": "2026-04-01T10:00:00Z",
    "hasTags": true,
    "tags": ["标签1", "标签2"],
    "tagsAt": "2026-04-01T10:00:00Z",
    "vectorIndexed": true,
    "vectorIndexedAt": "2026-04-01T10:00:00Z"
  }
}
```

### 向量索引单个文件

```http
POST /api/ai/index/:fileId
Authorization: Bearer <token>
```

为单个文件创建向量索引，用于语义搜索。

### 批量向量索引

```http
POST /api/ai/index/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileIds": ["file-id-1", "file-id-2", "file-id-3"]
}
```

**响应**:

```json
{
  "success": true,
  "data": [
    { "fileId": "file-id-1", "status": "success" },
    { "fileId": "file-id-2", "status": "success" },
    { "fileId": "file-id-3", "status": "failed", "error": "Empty text content" }
  ]
}
```

### 索引所有文件

```http
POST /api/ai/index/all
Authorization: Bearer <token>
```

启动后台任务，为所有未索引的文件创建向量索引。

**响应**:

```json
{
  "success": true,
  "data": {
    "message": "索引任务已启动，将在后台运行",
    "task": {
      "id": "task-uuid",
      "status": "running",
      "total": 0,
      "processed": 0,
      "failed": 0,
      "startedAt": "2026-04-01T10:00:00Z"
    }
  }
}
```

### 获取索引任务状态

```http
GET /api/ai/index/status
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "task-uuid",
    "status": "running",
    "total": 100,
    "processed": 45,
    "failed": 2,
    "startedAt": "2026-04-01T10:00:00Z",
    "updatedAt": "2026-04-01T10:05:00Z"
  }
}
```

### 取消索引任务

```http
DELETE /api/ai/index/task
Authorization: Bearer <token>
```

### 删除文件向量索引

```http
DELETE /api/ai/index/:fileId
Authorization: Bearer <token>
```

### AI 功能说明

1. **文件摘要生成**
   - 仅支持文本文件（代码、配置、Markdown 等）
   - 使用 Llama 3.1 8B 模型
   - 自动缓存结果，避免重复生成
   - 文件上传后自动触发

2. **图片智能描述和标签**
   - 使用 LLaVA 1.5 7B 生成描述
   - 使用 ResNet-50 生成标签
   - 支持中英文输出
   - 图片上传后自动触发

3. **智能重命名**
   - 根据文件内容或 AI 描述生成建议
   - 提供 3 个候选名称
   - 保留原文件扩展名

4. **语义搜索**
   - 使用 BGE-M3 多语言模型（1024 维向量）
   - 支持中文和多语言搜索
   - 需要先创建 Vectorize 索引
   - 需要先为文件创建向量索引

5. **Vectorize 配置要求**
   - 索引维度：1024
   - 距离度量：cosine
   - 创建命令：`wrangler vectorize create ossshelf-vectors --dimensions=1024 --metric=cosine`

---

## RESTful v1 API

路由文件: `apps/api/src/routes/v1/`

v3.6.0 新增的 RESTful API，遵循 OpenAPI 规范，提供标准化接口。

### OpenAPI 文档

```http
GET /api/v1/openapi.json
```

返回 OpenAPI 3.1.0 规范的 JSON 文档。

### Swagger UI

访问 `/api/v1/docs` 查看交互式 API 文档。

### v1 API 端点

#### 文件 API

```http
GET /api/v1/files              # 列出文件
POST /api/v1/files/upload      # 上传文件
GET /api/v1/files/:id          # 获取文件信息
GET /api/v1/files/:id/download # 下载文件
DELETE /api/v1/files/:id       # 删除文件
```

#### 文件夹 API

```http
POST /api/v1/folders           # 创建文件夹
GET /api/v1/folders/:id/tree   # 获取文件夹树
```

#### 分享 API

```http
POST /api/v1/shares            # 创建分享
GET /api/v1/shares             # 列出分享
DELETE /api/v1/shares/:id      # 删除分享
```

#### 搜索 API

```http
GET /api/v1/search             # 搜索文件
```

#### 当前用户 API

```http
GET /api/v1/me                 # 获取当前用户信息
GET /api/v1/me/quota           # 获取存储配额
```

### v1 API 特点

1. **标准化响应格式**

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 100
  }
}
```

2. **统一错误处理**

```json
{
  "success": false,
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "文件不存在"
  }
}
```

3. **支持 API Key 认证**

```http
X-API-Key: osk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

或

```http
Authorization: ApiKey osk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
