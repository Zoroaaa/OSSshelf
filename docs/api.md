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
  "data": { }
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

| 错误码 | 描述 |
|--------|------|
| UNAUTHORIZED | 未授权，Token 无效或过期 |
| FORBIDDEN | 禁止访问，权限不足 |
| NOT_FOUND | 资源不存在 |
| VALIDATION_ERROR | 参数验证失败 |
| FILE_TOO_LARGE | 文件大小超过限制 |
| STORAGE_EXCEEDED | 存储空间不足 |
| SHARE_EXPIRED | 分享链接已过期 |
| LOGIN_LOCKED | 登录已被锁定 |
| PERMISSION_DENIED | 权限不足 |

---

## 认证接口

### 用户注册
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "用户名"
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

### 获取当前用户信息
```http
GET /api/auth/me
Authorization: Bearer <token>
```

### 更新用户信息
```http
PUT /api/auth/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "新昵称",
  "currentPassword": "当前密码",
  "newPassword": "新密码"
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

---

## 文件接口

### 列出文件
```http
GET /api/files?parentId=<folderId>&search=<keyword>&sortBy=name&sortOrder=asc
Authorization: Bearer <token>
```

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

---

## 回收站接口

### 列出回收站文件
```http
GET /api/files/trash
Authorization: Bearer <token>
```

### 恢复文件
```http
POST /api/files/<fileId>/restore
Authorization: Bearer <token>
```

### 永久删除
```http
DELETE /api/files/<fileId>/permanent
Authorization: Bearer <token>
```

### 清空回收站
```http
DELETE /api/files/trash/empty
Authorization: Bearer <token>
```

---

## 存储桶接口

### 列出存储桶
```http
GET /api/buckets
Authorization: Bearer <token>
```

### 创建存储桶
```http
POST /api/buckets
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "我的 S3 存储桶",
  "provider": "s3",
  "bucketName": "my-bucket",
  "region": "us-east-1",
  "accessKeyId": "AKIA...",
  "secretAccessKey": "secret...",
  "isDefault": true
}
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

### 删除存储桶
```http
DELETE /api/buckets/<bucketId>
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

### 分片上传初始化
```http
POST /api/presign/multipart/init
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileName": "large-file.iso",
  "fileSize": 5368709120,
  "mimeType": "application/octet-stream",
  "parentId": null
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
  "uploadId": "upload-id",
  "bucketId": "bucket-uuid",
  "parts": [
    { "partNumber": 1, "etag": "etag-1" },
    { "partNumber": 2, "etag": "etag-2" }
  ]
}
```

---

## 分享接口

### 创建分享
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

### 获取分享信息
```http
GET /api/share/<shareId>
```

### 访问分享（需要密码时）
```http
POST /api/share/<shareId>/access
Content-Type: application/json

{
  "password": "访问密码"
}
```

### 下载分享文件
```http
GET /api/share/<shareId>/download
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

### 批量删除
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
  "targetParentId": "folder-id"
}
```

---

## 搜索接口

### 搜索文件
```http
GET /api/search?q=keyword&type=all&tags=tag1,tag2
Authorization: Bearer <token>
```

### 高级搜索
```http
POST /api/search/advanced
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "keyword",
  "mimeType": "image/",
  "minSize": 0,
  "maxSize": 10485760,
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "tags": ["tag1"]
}
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

### 列出上传任务
```http
GET /api/tasks/list
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
GET /api/downloads/list
Authorization: Bearer <token>
```

### 重试失败任务
```http
POST /api/downloads/<taskId>/retry
Authorization: Bearer <token>
```

---

## 预览接口

### 获取预览信息
```http
GET /api/preview/<fileId>/info
Authorization: Bearer <token>
```

### 获取原始内容
```http
GET /api/preview/<fileId>/raw
Authorization: Bearer <token>
```

### 获取缩略图
```http
GET /api/preview/<fileId>/thumbnail
Authorization: Bearer <token>
```

---

## 管理员接口

### 获取审计日志
```http
GET /api/admin/audit-logs?page=1&limit=50
Authorization: Bearer <token>
```

### 获取系统统计
```http
GET /api/admin/stats
Authorization: Bearer <token>
```

### 获取用户列表
```http
GET /api/admin/users?page=1&limit=50
Authorization: Bearer <token>
```

### 更新用户
```http
PUT /api/admin/users/<userId>
Authorization: Bearer <token>
Content-Type: application/json

{
  "storageQuota": 21474836480,
  "role": "user"
}
```

---

## WebDAV 接口

WebDAV 协议端点: `/dav`

### 连接配置

| 配置项 | 值 |
|--------|-----|
| 服务器地址 | `https://your-domain.com/dav` |
| 用户名 | 注册邮箱 |
| 密码 | 账户密码 |
| 认证方式 | Basic Auth |

### 支持的操作

| 操作 | 方法 | 描述 |
|------|------|------|
| 列出目录 | PROPFIND | Depth: 0 (当前), 1 (包含子项) |
| 下载文件 | GET | - |
| 上传文件 | PUT | 自动创建父目录 |
| 创建目录 | MKCOL | - |
| 删除 | DELETE | 永久删除 |
| 移动/重命名 | MOVE | 需要 Destination 头 |
| 复制 | COPY | 需要 Destination 头 |
