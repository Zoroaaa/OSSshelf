# OSSshelf API 文档

## 基础信息

- **Base URL**: `/api`
- **认证方式**: Bearer Token (JWT)
- **响应格式**: JSON

## 统一响应格式

### 成功响应

```json
{
  "success": true,
  "data": {}
}
```

### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  }
}
```

## 错误码列表

| 错误码                        | 描述                     |
| ----------------------------- | ------------------------ |
| UNAUTHORIZED                  | 未授权，Token 无效或过期 |
| FORBIDDEN                     | 禁止访问，权限不足       |
| NOT_FOUND                     | 资源不存在               |
| VALIDATION_ERROR              | 参数验证失败             |
| FILE_TOO_LARGE                | 文件大小超过限制         |
| STORAGE_EXCEEDED              | 存储空间不足             |
| SHARE_EXPIRED                 | 分享链接已过期           |
| SHARE_PASSWORD_REQUIRED       | 分享需要密码             |
| SHARE_PASSWORD_INVALID        | 分享密码错误             |
| SHARE_DOWNLOAD_LIMIT_EXCEEDED | 分享下载次数已达上限     |
| LOGIN_LOCKED                  | 登录已被锁定             |
| PERMISSION_DENIED             | 权限不足                 |
| TASK_EXPIRED                  | 上传任务已过期           |
| INTERNAL_ERROR                | 服务器内部错误           |
| REGISTRATION_CLOSED           | 注册已关闭               |
| INVITE_CODE_REQUIRED          | 需要邀请码               |
| INVITE_CODE_INVALID           | 邀请码无效               |
| INVITE_CODE_USED              | 邀请码已使用             |

---

## 认证接口

### 获取注册配置

```http
GET /api/auth/registration-config
```

返回注册开关和邀请码要求配置。

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
    "user": { "id", "email", "name", "role", "storageQuota", "storageUsed", "createdAt", "updatedAt" },
    "token": "jwt-token",
    "deviceId": "设备ID"
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
    "user": { "id", "email", "name", "role", "storageQuota", "storageUsed", "createdAt", "updatedAt" },
    "token": "jwt-token",
    "deviceId": "设备ID"
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

**响应**:

```json
{
  "success": true,
  "data": {
    "fileCount": 100,
    "folderCount": 10,
    "trashCount": 5,
    "storageUsed": 1073741824,
    "storageQuota": 10737418240,
    "recentFiles": [],
    "typeBreakdown": { "image": 524288000, "video": 314572800 },
    "bucketBreakdown": []
  }
}
```

---

## 文件接口

### 列出文件

```http
GET /api/files?parentId=<folderId>&search=<keyword>&sortBy=name&sortOrder=asc
Authorization: Bearer <token>
```

**查询参数**:

- `parentId`: 父文件夹ID（可选）
- `search`: 搜索关键词（可选）
- `sortBy`: 排序字段，默认 `createdAt`
- `sortOrder`: 排序方向，`asc` 或 `desc`，默认 `desc`

**响应**: 返回文件列表，包含 `bucket`、`owner`、`accessPermission`、`isOwner` 字段。

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

**响应**: 包含 `bucket`、`owner`、`isOwner` 字段。

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

设置文件夹允许上传的文件类型，`null` 表示不限制。

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

**Telegram 配置说明**:
- `accessKeyId`: Telegram Bot Token
- `bucketName`: Telegram Chat ID
- `endpoint`: 可选的 Bot API 代理地址
- `secretAccessKey`: 固定为 `telegram-no-secret`（占位符）

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

### 测试 Telegram Bot 连接

```http
POST /api/telegram/test
Authorization: Bearer <token>
Content-Type: application/json

{
  "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "chatId": "-1001234567890",
  "apiBase": "https://api.telegram.org" // 可选代理
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

### 启动迁移任务

```http
POST /api/migrate/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "sourceBucketId": "来源存储桶ID",
  "targetBucketId": "目标存储桶ID",
  "fileIds": ["fileId1", "fileId2"],  // 可选，不传则迁移整个桶
  "targetFolderId": "目标文件夹ID",   // 可选，不传则保持原位置
  "deleteSource": false               // 可选，true = 移动模式
}
```

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

**响应**:

```json
{
  "success": true,
  "data": {
    "migrationId": "uuid",
    "userId": "user-id",
    "sourceBucketId": "source-id",
    "targetBucketId": "target-id",
    "total": 100,
    "done": 50,
    "failed": 2,
    "results": [
      { "fileId": "id", "fileName": "name", "status": "done", "newR2Key": "..." },
      { "fileId": "id", "fileName": "name", "status": "failed", "error": "错误信息" }
    ],
    "status": "running",
    "startedAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:05:00Z"
  }
}
```

### 取消迁移

```http
POST /api/migrate/<migrationId>/cancel
Authorization: Bearer <token>
```

---

## 预签名上传接口

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

**响应**:

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

或返回 `{ "useProxy": true }` 表示应使用代理上传。

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

**响应**:

```json
{
  "success": true,
  "data": {
    "uploadId": "upload-id",
    "fileId": "uuid",
    "r2Key": "files/userId/fileId/large-file.iso",
    "bucketId": "bucket-uuid",
    "firstPartUrl": "https://...",
    "expiresIn": 3600
  }
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

**响应**:

```json
{
  "success": true,
  "data": {
    "downloadUrl": "https://...",
    "fileName": "example.zip",
    "mimeType": "application/zip",
    "size": 52428800,
    "expiresIn": 21600
  }
}
```

或返回 `{ "useProxy": true, "proxyUrl": "/api/files/<fileId>/download" }`。

### 获取预览预签名 URL

```http
GET /api/presign/preview/<fileId>
Authorization: Bearer <token>
```

---

## 分享接口

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

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "share-id",
    "fileId": "file-id",
    "isFolder": false,
    "expiresAt": "2024-12-31T23:59:59Z",
    "downloadLimit": 10,
    "createdAt": "2024-01-01T00:00:00Z",
    "shareUrl": "/share/share-id"
  }
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

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "share-id",
    "folderId": "folder-id",
    "folderName": "文件夹名称",
    "uploadToken": "upload-token-uuid",
    "expiresAt": "2024-12-31T23:59:59Z",
    "maxUploadSize": 104857600,
    "allowedMimeTypes": ["image/*", "application/pdf"],
    "maxUploadCount": 10,
    "createdAt": "2024-01-01T00:00:00Z",
    "uploadUrl": "/upload/upload-token-uuid"
  }
}
```

### 获取分享信息（公开）

```http
GET /api/share/<shareId>?password=<密码>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "id": "share-id",
    "file": {
      "id": "file-id",
      "name": "文件名",
      "size": 1024,
      "mimeType": "application/pdf",
      "isFolder": false
    },
    "children": null,
    "expiresAt": "2024-12-31T23:59:59Z",
    "downloadLimit": 10,
    "downloadCount": 3,
    "hasPassword": false
  }
}
```

**文件夹分享响应**（`isFolder: true`）:

```json
{
  "success": true,
  "data": {
    "id": "share-id",
    "file": {
      "id": "folder-id",
      "name": "文件夹名",
      "size": 0,
      "mimeType": null,
      "isFolder": true
    },
    "children": [
      { "id": "child-id", "name": "子文件", "size": 1024, "mimeType": "image/png", "isFolder": false, "updatedAt": "..." },
      { "id": "child-id2", "name": "子文件夹", "size": 0, "mimeType": null, "isFolder": true, "updatedAt": "..." }
    ],
    "expiresAt": "2024-12-31T23:59:59Z",
    "downloadLimit": null,
    "downloadCount": 0,
    "hasPassword": true
  }
}
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

- `fileIds`: 可选，逗号分隔的文件ID，不传则打包全部

### 下载文件夹分享中的单个文件（公开）

```http
GET /api/share/<shareId>/file/<fileId>/download?password=<密码>
```

### 获取上传链接信息（公开）

```http
GET /api/share/upload/<uploadToken>?password=<密码>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "token": "upload-token-uuid",
    "folderName": "文件夹名称",
    "expiresAt": "2024-12-31T23:59:59Z",
    "hasPassword": false,
    "maxUploadSize": 5368709120,
    "allowedMimeTypes": null,
    "maxUploadCount": null,
    "uploadCount": 0
  }
}
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

---

## 批量操作接口

### 批量删除（移至回收站）

```http
POST /api/batch/delete
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileIds": ["id1", "id2", "id3"]
}
```

**响应**:

```json
{
  "success": true,
  "data": {
    "success": 3,
    "failed": 0,
    "errors": []
  }
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

### 搜索文件

```http
GET /api/search?query=keyword&parentId=folderId&recursive=true&tags=tag1,tag2&mimeType=image/*&minSize=0&maxSize=10485760&createdAfter=2024-01-01T00:00:00Z&createdBefore=2024-12-31T23:59:59Z&isFolder=false&bucketId=bucket-id&sortBy=createdAt&sortOrder=desc&page=1&limit=50
Authorization: Bearer <token>
```

**查询参数**:

- `query`: 搜索关键词
- `parentId`: 搜索范围（文件夹ID）
- `recursive`: 是否递归搜索子文件夹
- `tags`: 标签过滤（逗号分隔）
- `mimeType`: MIME类型过滤（支持通配符如 `image/*`）
- `minSize` / `maxSize`: 文件大小范围（字节）
- `createdAfter` / `createdBefore`: 创建时间范围
- `updatedAfter` / `updatedBefore`: 更新时间范围
- `isFolder`: 是否只搜索文件夹
- `bucketId`: 存储桶过滤
- `sortBy`: 排序字段（`name`, `size`, `createdAt`, `updatedAt`）
- `sortOrder`: 排序方向（`asc`, `desc`）
- `page` / `limit`: 分页

**响应**:

```json
{
  "success": true,
  "data": {
    "items": [],
    "total": 100,
    "page": 1,
    "limit": 50,
    "totalPages": 2,
    "aggregations": {
      "types": { "image": 50, "video": 30 },
      "mimeTypes": { "image/jpeg": 30, "image/png": 20 },
      "sizeRange": { "min": 1024, "max": 10485760 }
    }
  }
}
```

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

**响应**:

```json
{
  "success": true,
  "data": {
    "isOwner": true,
    "permissions": [
      { "id", "userId", "permission", "grantedBy", "userName", "userEmail", "createdAt" }
    ]
  }
}
```

### 检查权限

```http
GET /api/permissions/check/<fileId>
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "hasAccess": true,
    "permission": "admin",
    "isOwner": true
  }
}
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

**响应**:

```json
{
  "success": true,
  "data": {
    "taskId": "uuid",
    "fileId": "uuid",
    "uploadId": "upload-id",
    "r2Key": "files/userId/fileId/large-file.iso",
    "bucketId": "bucket-uuid",
    "totalParts": 100,
    "partSize": 52428800,
    "firstPartUrl": "https://...",
    "expiresAt": "2024-01-02T00:00:00Z"
  }
}
```

**Telegram 存储桶响应**:

```json
{
  "success": true,
  "data": {
    "taskId": "uuid",
    "fileId": "uuid",
    "uploadId": "telegram-chunked:group-id",
    "r2Key": "files/userId/fileId/large-file.iso",
    "bucketId": "bucket-uuid",
    "totalParts": 50,
    "partSize": 31457280,
    "isTelegramUpload": true,
    "isSmallFile": false,
    "expiresAt": "2024-01-02T00:00:00Z"
  }
}
```

### 获取分片上传 URL

```http
POST /api/tasks/part
Authorization: Bearer <token>
Content-Type: application/json

{
  "taskId": "uuid",
  "partNumber": 1
}
```

### 标记分片完成

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

### 代理上传分片

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
  ]
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

**previewType**: `image`, `video`, `audio`, `pdf`, `text`, `markdown`, `code`, `office`, `unknown`

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

## 管理员接口

所有管理员接口需要 `admin` 角色。

### 获取用户列表

```http
GET /api/admin/users
Authorization: Bearer <token>
```

**响应**: 返回用户列表，包含 `fileCount` 和 `bucketCount`。

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

**响应**:

```json
{
  "success": true,
  "data": {
    "open": true,
    "requireInviteCode": false,
    "inviteCodes": [{ "code": "XXXX-XXXX-XXXX", "usedBy": null, "createdAt": "2024-01-01T00:00:00Z" }]
  }
}
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

**响应**:

```json
{
  "success": true,
  "data": {
    "codes": ["XXXX-XXXX-XXXX", "YYYY-YYYY-YYYY"],
    "createdAt": "2024-01-01T00:00:00Z"
  }
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

**响应**:

```json
{
  "success": true,
  "data": {
    "userCount": 100,
    "adminCount": 2,
    "fileCount": 5000,
    "folderCount": 200,
    "bucketCount": 50,
    "totalStorageUsed": 107374182400,
    "totalStorageQuota": 1073741824000,
    "providerBreakdown": {
      "s3": { "bucketCount": 30, "storageUsed": 52428800000 },
      "r2": { "bucketCount": 20, "storageUsed": 54945382400 }
    }
  }
}
```

### 获取审计日志

```http
GET /api/admin/audit-logs?page=1&limit=50&userId=user-id&action=user.login
Authorization: Bearer <token>
```

**响应**:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "log-id",
        "userId": "user-id",
        "userEmail": "user@example.com",
        "action": "user.login",
        "resourceType": "user",
        "resourceId": "user-id",
        "details": {},
        "status": "success",
        "errorMessage": null,
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0...",
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "total": 1000,
    "page": 1,
    "limit": 50
  }
}
```

---

## 定时任务接口

这些接口通常由 Cloudflare Cron Triggers 调用。

### 回收站清理

```http
POST /api/cron/trash-cleanup
```

清理超过保留期的回收站文件。

### 会话清理

```http
POST /api/cron/session-cleanup
```

清理过期的 WebDAV 会话、上传任务和登录记录。

### 分享清理

```http
POST /api/cron/share-cleanup
```

清理过期的分享链接。

### 全量清理

```http
POST /api/cron/all
```

执行所有清理任务。

---

## WebDAV 接口

WebDAV 协议端点: `/dav`

### 连接配置

| 配置项     | 值                            |
| ---------- | ----------------------------- |
| 服务器地址 | `https://your-domain.com/dav` |
| 用户名     | 注册邮箱                      |
| 密码       | 账户密码                      |
| 认证方式   | Basic Auth                    |

### 支持的操作

| 操作        | 方法         | 描述                          |
| ----------- | ------------ | ----------------------------- |
| 列出目录    | PROPFIND     | Depth: 0 (当前), 1 (包含子项) |
| 下载文件    | GET          | -                             |
| 查看文件头  | HEAD         | -                             |
| 上传文件    | PUT          | 自动创建父目录                |
| 创建目录    | MKCOL        | -                             |
| 删除        | DELETE       | 永久删除                      |
| 移动/重命名 | MOVE         | 需要 Destination 头           |
| 复制        | COPY         | 需要 Destination 头           |
| 锁定资源    | LOCK         | 支持 Windows 资源管理器       |
| 解锁资源    | UNLOCK       | 支持 Windows 资源管理器       |
| 属性修改    | PROPPATCH    | 只读属性，返回 403             |

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
