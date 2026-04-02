# OSSShelf v3.0 增强优化方案

> 基于对当前代码库（schema、routes、lib、前端组件）的完整审阅，针对五大核心方向及补充改善提出可落地执行方案。

---

## 目录

1. [现状诊断总结](#0-现状诊断总结)
2. [备忘录与笔记功能深化](#1-备忘录与笔记功能深化)
3. [文件夹/文件权限管控深化](#2-文件夹文件权限管控深化)
4. [文件版本控制优化](#3-文件版本控制优化)
5. [API 驱动：RESTful 开放 API](#4-api-驱动restful-开放-api)
6. [智能化体验：Cloudflare Workers AI](#5-智能化体验cloudflare-workers-ai)
7. [其他质量提升补充](#6-其他质量提升补充)
8. [综合执行大纲](#7-综合执行大纲)

---

## 0. 现状诊断总结

| 模块            | 现状评估                                                                                                          | 主要问题                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **备忘录/笔记** | 几乎缺失。`storageBuckets.notes` 仅有桶级备注，文件/文件夹无任何 memo 字段                                        | 零功能，需从头建设                                                                                                                     |
| **权限管控**    | 有 `filePermissions` 表（read/write/admin），支持文件夹递归授权                                                   | 无组/角色概念；权限继承依赖路径前缀字符串比较，脆弱；无时效性/条件权限                                                                 |
| **版本控制**    | `fileVersions` 表已建，支持查询/回滚/下载/删除；Restore 逻辑为"复制旧版本 r2Key 创建新版本号"，基于 ref_count CoW | 版本触发点不明确（何时自动创建新版本？）；版本清理 cron 未见实现；`maxVersions` 限制检查缺失；版本 diff 无法比较；文件夹版本完全不支持 |
| **API 开放**    | 所有路由需 JWT auth，无 API Key 机制，无速率限制，无版本号，无 OpenAPI 文档                                       | 对第三方集成极不友好                                                                                                                   |
| **AI 智能化**   | 无任何 AI 功能                                                                                                    | 空白，有大量发挥空间                                                                                                                   |
| **整体架构**    | Hono + D1 + R2/S3 + KV，monorepo，已有 audit、dedup、WebDAV                                                       | 搜索为 LIKE 查询，无全文索引；无通知系统；无文件内容预处理管道                                                                         |

---

## 1. 备忘录与笔记功能深化

### 1.1 需求定位

当前 `storageBuckets` 有一个简单 `notes` text 字段，但文件、文件夹均无任何 memo/annotation 机制。需要建设一套支持 **文件级笔记、文件夹级笔记、富文本内容、版本历史、@提及** 的完整备忘录系统。

### 1.2 数据库结构

```sql
-- migration: 0010_notes.sql

CREATE TABLE IF NOT EXISTS file_notes (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,          -- Markdown 原文
  content_html TEXT,                  -- 预渲染 HTML（由 Worker AI 或服务端生成）
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  parent_id   TEXT REFERENCES file_notes(id),   -- 支持回复/线程
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TEXT
);

CREATE INDEX idx_file_notes_file    ON file_notes(file_id, deleted_at, created_at DESC);
CREATE INDEX idx_file_notes_user    ON file_notes(user_id, created_at DESC);
CREATE INDEX idx_file_notes_pinned  ON file_notes(file_id, is_pinned);

-- 笔记版本历史（轻量快照）
CREATE TABLE IF NOT EXISTS file_note_history (
  id        TEXT PRIMARY KEY,
  note_id   TEXT NOT NULL REFERENCES file_notes(id) ON DELETE CASCADE,
  content   TEXT NOT NULL,
  version   INTEGER NOT NULL,
  edited_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 笔记 @提及
CREATE TABLE IF NOT EXISTS note_mentions (
  id       TEXT PRIMARY KEY,
  note_id  TEXT NOT NULL REFERENCES file_notes(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_read  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_note_mentions_user ON note_mentions(user_id, is_read);

-- files 表新增字段
ALTER TABLE files ADD COLUMN description TEXT;           -- 一行简介（用于搜索/预览）
ALTER TABLE files ADD COLUMN note_count INTEGER DEFAULT 0; -- 缓存笔记数
```

### 1.3 后端路由结构

```
apps/api/src/routes/notes.ts

GET    /api/notes/:fileId           -- 获取文件所有笔记（支持分页、排序）
POST   /api/notes/:fileId           -- 新建笔记
PUT    /api/notes/:fileId/:noteId   -- 编辑笔记（自动追加历史快照）
DELETE /api/notes/:fileId/:noteId   -- 软删除
GET    /api/notes/:fileId/:noteId/history  -- 查看编辑历史
POST   /api/notes/:fileId/:noteId/pin      -- 置顶/取消置顶
GET    /api/notes/mentions/unread   -- 获取未读 @提及
PUT    /api/notes/mentions/:id/read -- 标为已读
```

### 1.4 前端组件规划

```
apps/web/src/components/notes/
├── NotePanel.tsx          -- 右侧抽屉/面板，与 FilePreview 并列
├── NoteEditor.tsx         -- Markdown 编辑器（推荐 @uiw/react-md-editor，轻量）
├── NoteThread.tsx         -- 线程视图（主笔记 + 回复列表）
├── NoteCard.tsx           -- 单条笔记卡片，含置顶标记、时间、操作
├── MentionBadge.tsx       -- 顶部导航未读提醒
└── NoteHistoryDialog.tsx  -- 历史版本对比 diff 视图
```

### 1.5 关键实现要点

- **Markdown 安全渲染**：服务端用 `unified + remark-parse + rehype-sanitize` 预处理，结果存 `content_html`，前端直接渲染，避免 XSS
- **@提及解析**：POST/PUT 时正则扫描 `@username`，查用户表，批量写 `note_mentions`
- **files.note_count 维护**：通过 trigger 或在 notes 路由中手动 `+1/-1`（D1 无 trigger，选后者）
- **笔记搜索集成**：`/api/search` 增加 `includeNotes: boolean` 参数，LIKE 扫描 `file_notes.content`

---

## 2. 文件夹/文件权限管控深化

### 2.1 现状问题分析

当前权限系统的核心问题：

1. **无组/角色层**：每次授权都是"用户 → 文件"的点对点关系，管理 N 个用户 × M 个文件夹复杂度是 O(N×M)
2. **文件夹递归授权脆弱**：`/grant` 路由通过 `path.startsWith(folderPath + '/')` 字符串匹配子文件，路径变更即失效
3. **无继承模型**：子文件夹无法从父文件夹继承权限，子文件授权状态与父级解耦
4. **无时效/条件权限**：不支持"只读 7 天"、"仅在 IP 范围内有效"等场景
5. **Permission check 是逐文件查询**：`checkFilePermission` 在循环中会产生 N+1

### 2.2 重新设计：RBAC + 继承链

#### 数据库结构

```sql
-- migration: 0011_permission_v2.sql

-- 用户组
CREATE TABLE IF NOT EXISTS user_groups (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 组成员
CREATE TABLE IF NOT EXISTS group_members (
  id        TEXT PRIMARY KEY,
  group_id  TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',  -- member | admin
  added_by  TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);
CREATE INDEX idx_group_members_user  ON group_members(user_id);
CREATE INDEX idx_group_members_group ON group_members(group_id);

-- 权限记录 v2（替换现有 filePermissions）
-- 支持 subject_type: user | group
-- 支持 scope: explicit | inherited
-- 支持过期时间
ALTER TABLE file_permissions ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'user';
ALTER TABLE file_permissions ADD COLUMN group_id TEXT REFERENCES user_groups(id) ON DELETE CASCADE;
ALTER TABLE file_permissions ADD COLUMN expires_at TEXT;
ALTER TABLE file_permissions ADD COLUMN inherit_to_children INTEGER NOT NULL DEFAULT 1;
ALTER TABLE file_permissions ADD COLUMN scope TEXT NOT NULL DEFAULT 'explicit'; -- explicit | inherited
ALTER TABLE file_permissions ADD COLUMN source_permission_id TEXT REFERENCES file_permissions(id);

CREATE INDEX idx_file_permissions_group   ON file_permissions(group_id);
CREATE INDEX idx_file_permissions_expires ON file_permissions(expires_at);
```

#### 权限解析算法（`lib/permissionResolver.ts`）

```typescript
// 优先级：显式权限 > 继承权限；用户权限 > 组权限
// 步骤：
// 1. 查当前文件的显式 user 权限
// 2. 查当前文件的显式 group 权限（需先查用户所在组）
// 3. 沿 parentId 链向上遍历（最多 N 层），查 inherit_to_children=1 的权限
// 4. 取最高级别
export async function resolveEffectivePermission(
  db: DrizzleDb,
  fileId: string,
  userId: string,
  requiredLevel: PermissionLevel
): Promise<PermissionResolution>;
```

关键优化：用 **递归 CTE** 一次性查整条祖先链，避免逐层 round-trip：

```sql
WITH RECURSIVE ancestors AS (
  SELECT id, parent_id, 0 AS depth FROM files WHERE id = ?
  UNION ALL
  SELECT f.id, f.parent_id, a.depth + 1
  FROM files f JOIN ancestors a ON f.id = a.parent_id
  WHERE a.depth < 10
)
SELECT fp.* FROM file_permissions fp
JOIN ancestors a ON fp.file_id = a.id
WHERE (fp.user_id = ? OR fp.group_id IN (...))
  AND (fp.expires_at IS NULL OR fp.expires_at > CURRENT_TIMESTAMP)
ORDER BY a.depth ASC, fp.permission DESC
LIMIT 1;
```

### 2.3 权限事件传播

取消原有"授权时批量写子文件"的做法（O(n) 写入，且文件增删后失效），改为：

- **读时解析**（lazy resolution）：`resolveEffectivePermission` 实时沿继承链查询
- **缓存层**：结果写入 KV，key = `perm:${fileId}:${userId}`，TTL 5 分钟
- **失效策略**：文件夹权限变更时，通过 `invalidatePermissionCache(folderId)` 批量删除 KV 前缀

### 2.4 前端权限管理 UI

```
apps/web/src/components/permissions/
├── PermissionPanel.tsx       -- 整体面板，tab: 用户 / 组 / 继承来源
├── UserPermissionList.tsx    -- 直接授权的用户列表
├── GroupManager.tsx          -- 创建/管理用户组
├── PermissionGrantDialog.tsx -- 授权弹窗（支持选用户/组、级别、过期时间）
├── InheritedPermBadge.tsx    -- 显示"继承自 /parent/folder"的来源提示
└── PermissionAuditLog.tsx    -- 权限操作历史（复用 auditLogs）
```

---

## 3. 文件版本控制优化

### 3.1 现有实现评估

**合理之处：**

- `fileVersions` 表结构合理，`ref_count` + CoW 实现去重存储，避免同一内容多份存储
- Restore 逻辑正确：将旧版本 r2Key 创建为新的最高版本号（非原地覆盖），保留完整历史
- `maxVersions` / `versionRetentionDays` 配置放在 files 表，支持文件级独立配置

**问题：**

| 问题                       | 严重性  | 说明                                                                         |
| -------------------------- | ------- | ---------------------------------------------------------------------------- |
| **版本创建时机不明确**     | 🔴 严重 | 现有 `files.ts` PUT 逻辑未见自动创建版本快照的代码，版本功能实质上是"手动"的 |
| **maxVersions 限制未执行** | 🔴 严重 | 版本数超限时没有自动裁剪旧版本的逻辑                                         |
| **版本 cron 清理未实现**   | 🟡 中   | `versionRetentionDays` 字段存在但 `cleanup.ts` 中无对应 job                  |
| **孤儿版本 r2Key 泄漏**    | 🟡 中   | 删除版本时仅更新 `ref_count`，`ref_count` 降为 0 后不一定及时从 R2 删除      |
| **版本 diff 无法比较**     | 🟠 低   | 文本文件无增量 diff，用户只能逐版本下载对比                                  |
| **文件夹无版本支持**       | 🟠 低   | `FOLDER_VERSION_NOT_SUPPORTED` 是直接报错，无快照机制                        |

### 3.2 修复方案

#### 3.2.1 版本自动触发（核心修复）

在 `files.ts` 的文件更新路由中，增加版本快照逻辑：

```typescript
// lib/versionManager.ts
export async function createVersionSnapshot(
  db: DrizzleDb,
  env: Env,
  file: File,
  options: { changeSummary?: string; createdBy: string }
): Promise<void> {
  // 1. 如果 hash 相同，跳过（内容未变）
  // 2. 检查现有版本数，超过 maxVersions 则先裁剪最老版本
  // 3. 写入 fileVersions 记录
  // 4. 更新 files.currentVersion
}

export async function pruneExcessVersions(db: DrizzleDb, env: Env, fileId: string, maxVersions: number): Promise<void> {
  // 查最老的超量版本 → 递减 ref_count → ref_count=0 则加入 R2 删除队列
}
```

触发时机：

- 直接上传（`PUT /api/files/:id` 替换内容时）
- 预签名上传完成回调
- WebDAV PUT

#### 3.2.2 版本清理 Cron Job

在 `cleanup.ts` 新增：

```typescript
export async function cleanExpiredVersions(env: Env): Promise<CleanupResult> {
  // 1. 查 versionRetentionDays 过期的 fileVersions
  //    WHERE created_at < datetime('now', '-' || f.version_retention_days || ' days')
  // 2. 对每个过期版本：ref_count-- → 若 =0 则 s3Delete(r2Key)
  // 3. DELETE from fileVersions WHERE id IN (...)
}
```

#### 3.2.3 文本文件 Diff 预览

对 `text/*` 和 `application/json` 类 MIME，版本下载时可在 preview 路由中加一个 diff 端点：

```
GET /api/versions/:fileId/diff?from=3&to=5
```

使用 `diff` npm 包（pure JS，兼容 Workers）计算 unified diff，返回给前端渲染高亮。

#### 3.2.4 文件夹快照（轻量方案）

文件夹快照不存储实际内容，只记录"时间点的子树清单"：

```sql
CREATE TABLE IF NOT EXISTS folder_snapshots (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  snapshot    TEXT NOT NULL,  -- JSON: [{id, name, path, hash, size}]
  label       TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

可用于恢复时对比"哪些文件在这个时间点存在"，不涉及 R2 存储。

---

## 4. API 驱动：RESTful 开放 API

### 4.1 现状问题

目前所有接口仅支持 JWT（用户会话 Token），没有适合程序调用的 API Key 机制，也无速率限制和 OpenAPI 文档。第三方工具（CLI、CI/CD、n8n、Zapier）无法安全集成。

### 4.2 API Key 机制

#### 数据库结构

```sql
-- migration: 0012_api_keys.sql
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,   -- SHA-256(key)，明文只在创建时返回一次
  key_prefix  TEXT NOT NULL,          -- 展示用，如 "osk_live_abc123..."
  scopes      TEXT NOT NULL,          -- JSON array: ["files:read","files:write","shares:read"]
  last_used_at TEXT,
  expires_at  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_api_keys_user   ON api_keys(user_id, is_active);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
```

#### Scope 设计

```
files:read        -- 列出、下载、搜索文件
files:write       -- 上传、修改、删除文件
shares:read       -- 查看分享
shares:write      -- 创建/删除分享
buckets:read      -- 查看存储桶配置
admin:read        -- 管理员查询（仅 admin 角色可授予）
```

#### 认证中间件扩展

```typescript
// middleware/auth.ts - 扩展
// 优先检查 Authorization: Bearer <jwt>
// 其次检查 Authorization: ApiKey osk_live_xxxx
// 或 X-API-Key: osk_live_xxxx header

export const apiKeyMiddleware = async (c, next) => {
  const apiKey = c.req.header('X-API-Key') || extractApiKeyFromBearer(c);
  if (apiKey) {
    const hash = await sha256(apiKey);
    const keyRecord = await db.select()...where(eq(api_keys.key_hash, hash)).get();
    // 验证、检查过期、检查 scope、更新 last_used_at
  }
};
```

### 4.3 速率限制

利用已有的 KV binding 实现滑动窗口限流：

```typescript
// lib/rateLimit.ts
export async function checkRateLimit(
  kv: KVNamespace,
  key: string, // api_key_id 或 user_id 或 ip
  limit: number, // 默认 1000 req/hour
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }>;

// 在 /api/v1/* 路由挂载
app.use('/api/v1/*', rateLimitMiddleware({ limit: 1000, window: 3600_000 }));
```

### 4.4 API 版本化与路由结构

```
/api/v1/
├── files/
│   ├── GET    /                  -- 列出文件（支持 path= 参数）
│   ├── POST   /upload            -- 直接上传（multipart）
│   ├── GET    /:id               -- 文件元数据
│   ├── GET    /:id/download      -- 下载
│   ├── DELETE /:id               -- 删除
│   └── GET    /:id/versions      -- 版本列表
├── folders/
│   ├── POST   /                  -- 创建文件夹
│   └── GET    /:id/tree          -- 子树列表
├── shares/
│   ├── POST   /                  -- 创建分享链接
│   └── DELETE /:id               -- 撤销分享
├── search/
│   └── GET    /                  -- 全文搜索
└── me/
    └── GET    /                  -- 当前用户信息 + 配额
```

### 4.5 OpenAPI / Swagger 文档

使用 `@hono/zod-openapi` 替换现有的 zod 手动 parse 方式：

```typescript
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
// 路由定义同时即是文档，零额外维护成本

// 自动生成 /api/v1/openapi.json
// 挂载 Swagger UI 在 /api/v1/docs
app.doc('/api/v1/openapi.json', { openapi: '3.1.0', info: { title: 'OSSShelf API', version: '1.0.0' } });
```

### 4.6 Webhook 通知

支持第三方系统订阅文件事件：

```sql
CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,    -- HMAC 签名密钥
  events      TEXT NOT NULL,    -- JSON: ["file.uploaded","file.deleted","share.created"]
  is_active   INTEGER NOT NULL DEFAULT 1,
  last_status INTEGER,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

事件分发在各路由操作完成后，通过 `ctx.waitUntil(dispatchWebhook(...))` 异步执行，不阻塞响应。

---

## 5. 智能化体验：Cloudflare Workers AI

### 5.1 可用能力评估

Workers AI 在 OSSShelf 场景下最有价值的模型：

| 模型                             | 用途                       | 延迟   |
| -------------------------------- | -------------------------- | ------ |
| `@cf/meta/llama-3.1-8b-instruct` | 文件总结、智能重命名、问答 | ~1-3s  |
| `@cf/baai/bge-base-en-v1.5`      | 文本向量化（语义搜索）     | ~100ms |
| `@cf/microsoft/resnet-50`        | 图片分类标签               | ~200ms |
| `@cf/openai/whisper`             | 音频/视频转文字            | ~5-30s |
| `@cf/llava-hf/llava-1.5-7b-hf`   | 图片内容理解               | ~2-5s  |

### 5.2 功能一：语义搜索（核心，强烈推荐）

当前搜索是 `LIKE '%keyword%'`，无法处理同义词、模糊描述。

**实现方案：**

```
1. 文件上传/修改后（异步，waitUntil）：
   - 提取文件名、description、笔记内容 → 合并为 text
   - 调用 bge-base 生成 embedding（768维 float32）
   - 存入 Vectorize index（Cloudflare 托管向量数据库）

2. 搜索时：
   - 同时发起：① 现有 LIKE 关键词搜索  ② Vectorize ANN 查询
   - 合并结果，向量结果赋予相似度分数
   - 返回混合排序结果
```

```typescript
// lib/vectorIndex.ts
export async function indexFileVector(env: Env, file: File, notes: string[]): Promise<void> {
  const text = [file.name, file.description, ...notes].filter(Boolean).join('\n');
  const { data } = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [text] });
  await env.VECTORIZE.upsert([
    {
      id: file.id,
      values: data[0],
      metadata: { userId: file.userId, mimeType: file.mimeType },
    },
  ]);
}

// wrangler.toml 新增：
// [[vectorize]]
// binding = "VECTORIZE"
// index_name = "ossshelf-files"
// dimensions = 768
// metric = "cosine"
```

### 5.3 功能二：文件内容 AI 总结

针对文本文件（txt/md/pdf 预览内容）和图片，生成智能摘要：

```
GET /api/ai/summarize/:fileId
```

```typescript
// 文本文件
const textContent = await fetchFileText(env, file); // 截取前 4096 字符
const summary = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
  messages: [
    { role: 'system', content: '你是文件助手，用3句话概括文件内容。' },
    { role: 'user', content: textContent },
  ],
  max_tokens: 200,
});
// 缓存到 KV，TTL 24h，key = `ai:summary:${file.id}:${file.hash}`

// 图片文件
const imgBase64 = await fetchImageBase64(env, file);
const caption = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
  image: imgBase64,
  prompt: '描述这张图片的主要内容，用于文件管理系统的搜索标签。',
});
```

结果存入 `files.description` 字段（用户可手动覆盖）。

### 5.4 功能三：图片自动标签

```typescript
// 图片上传完成后 waitUntil
const result = await env.AI.run('@cf/microsoft/resnet-50', {
  image: [...imageBytes],
});
// result.label 如 "document, spreadsheet" 自动写入 fileTags
```

### 5.5 功能四：智能重命名建议

上传时文件名为 `IMG_20240315_143022.jpg` 类的场景：

```
POST /api/ai/rename-suggest
{ "fileId": "xxx" }
→ { "suggestions": ["合同签署现场照片", "办公室会议记录", "产品原型截图"] }
```

结合图片理解模型分析图片内容，给出3个命名建议，用户一键采纳。

### 5.6 功能五：对话式文件问答（进阶）

```
POST /api/ai/chat
{
  "fileId": "xxx",
  "message": "这份合同的付款条款是什么？"
}
```

流程：提取文件文本 → RAG（Vectorize 检索相关段落）→ LLM 回答。适用于 PDF/文档类文件。

### 5.7 Workers AI 配置补充

```toml
# wrangler.toml 新增
[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "ossshelf-files"
dimensions = 768
metric = "cosine"
```

---

## 6. 其他质量提升补充

### 6.1 全文搜索升级

D1 支持 FTS5 扩展，可建 virtual table：

```sql
CREATE VIRTUAL TABLE files_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  content=files,
  content_rowid=rowid
);
-- 触发器维护：INSERT/UPDATE/DELETE 时同步 fts 表
```

搜索时：`WHERE files_fts MATCH 'invoice 2024'`，性能远超 LIKE 并支持词干匹配。

### 6.2 通知系统

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,    -- share_received | mention | permission_granted | quota_warning
  title       TEXT NOT NULL,
  body        TEXT,
  data        TEXT,             -- JSON 附加数据
  is_read     INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

前端通过 SSE（Server-Sent Events）或 WebSocket（Durable Objects）实时推送。轻量方案：轮询 `/api/notifications/unread-count`，每 30s 一次。

### 6.3 收藏夹 / 快速访问

```sql
ALTER TABLE files ADD COLUMN is_starred INTEGER DEFAULT 0;
CREATE INDEX idx_files_starred ON files(user_id, is_starred, updated_at DESC);
```

前端侧边栏增加"收藏"分区，`GET /api/files?starred=true`。

### 6.4 文件预览增强

- **Office 文件在线编辑**：集成 Collabora Online 或 OnlyOffice（自建），提供 WOPI 接口
- **视频转码缩略图**：上传视频后 waitUntil 调用 Cloudflare Images 或自建 FFmpeg Worker 生成封面
- **PDF 首页缩略图**：通过 Cloudflare Images Transform 生成，存入 R2 缓存

### 6.5 存储分析 Dashboard

在 Admin 和用户个人页增加：

```
GET /api/analytics/storage-breakdown  -- 按 MIME 类型分布
GET /api/analytics/activity-heatmap   -- 上传/下载活跃度（7/30/90天）
GET /api/analytics/large-files        -- 最占空间的 Top 20 文件
GET /api/analytics/shared-links-stats -- 分享链接访问统计
```

数据来源：`auditLogs` 聚合查询 + `files` 表统计，无需额外存储。

### 6.6 双因素认证（2FA）

`users` 表新增 `totp_secret` 字段，`/api/auth/2fa` 路由实现 TOTP（RFC 6238）。使用 `otpauth` npm 包（Workers 兼容），配合前端展示二维码。

### 6.7 客户端加密（端对端）

在浏览器端用 Web Crypto API 加密文件后再上传（密钥不离开客户端），服务端仅存密文。适合高隐私需求用户。

```
files 表新增：
- is_client_encrypted INTEGER DEFAULT 0
- encryption_hint TEXT    -- 密钥提示，不存密钥本身
```

---

## 7. 综合执行大纲

### Phase 1：基础稳固（已完成 ✅）

**目标：填补现有功能的空洞，修复已识别的严重问题**

**版本：3.5.0**

```
Week 1:
  ✅ 修复版本控制：
     - 实现 versionManager.ts（createVersionSnapshot + pruneExcessVersions）
     - 在文件更新路由中接入自动版本触发
     - 实现 cleanExpiredVersions cron job
     - 修复孤儿 r2Key 清理（ref_count=0 → 加入删除队列）

Week 2:
  ✅ 备忘录基础建设：
     - 数据库迁移：0010_notes.sql
     - 后端路由 notes.ts（CRUD + history + pin）
     - 前端 NotePanel + NoteEditor + NoteCard 组件

Week 3:
  ✅ API Key 机制：
     - 数据库迁移：0011_api_keys.sql
     - apiKeyMiddleware 接入认证层
     - /api/keys CRUD 路由
     - KV 速率限制中间件
  ✅ 文件编辑功能：
     - 文件编辑 API（PUT /api/files/:id/content）
     - 前端文件编辑器组件（CodeEditor、TextEditor、FileEditor）
     - 新建文件增强（模板选择）
```

### Phase 2：权限与 API 开放（已完成 ✅）

**版本：3.6.0**

```
Week 4:
  ✅ 权限系统 v2：
     - 数据库迁移：0012_permission_v2.sql
     - user_groups / group_members 表及路由
     - permissionResolver.ts（递归 CTE 方案）
     - KV 权限缓存层

Week 5:
  ✅ 权限 UI 重构：
     - GroupManager 组件
     - PermissionPanel 重构（支持组、过期时间）
     - InheritedPermBadge 继承来源提示

Week 6:
  ✅ RESTful v1 API + 文档：
     - /api/v1/* 路由用 @hono/zod-openapi 重写
     - OpenAPI JSON 生成
     - Swagger UI 挂载
     - Webhook 基础实现
```

### Phase 3：AI 智能化（已完成 ✅）

**版本：3.7.0**

**实际完成情况与计划偏差：**

- 迁移文件编号：0013 → 0014（中间插入了 0013_fix_user_id_nullable.sql）
- 向量模型升级：bge-base-en-v1.5 (768维) → bge-m3 (1024维，多语言支持更好)
- 搜索阈值调整：0.7 → 0.5（bge-m3 cosine 分数偏低）

```
Week 7:
  ✅ Workers AI 接入：
     - Env 类型定义 AI 和 Vectorize 绑定（可选，未配置时功能降级）
     - 文件向量化 pipeline（上传后 autoProcessFile 自动触发）
     - 语义搜索接口 + 移动端集成

Week 8:
  ✅ AI 功能扩展：
     - /api/ai/summarize/:fileId（文本文件摘要）
     - /api/ai/tags/:fileId（图片自动标签 + 描述）
     - /api/ai/rename-suggest/:fileId（智能重命名建议）
     - /api/ai/index/*（向量索引管理，含一键全量索引）
     - 前端 AISummaryCard + ImageTagsDisplay + SmartRenameDialog + AISettings

额外完成（计划外）：
  ✅ 移动端页面排版优化：
     - MobileFilesToolbar（底部操作栏、视图切换、FAB）
     - MobileSearchPanel（语义搜索开关、高级搜索）
     - MobileBottomNav（底部导航优化）
  ✅ 预览组件拆分重构：
     - 12 个独立预览组件（Image/Video/Audio/Pdf/Markdown/Code/Office/Csv/Zip/Font/Epub）
     - previewUtils 工具函数
```

### Phase 4：体验完善（已完成 ✅）

**版本：3.8.0**

```
Week 9:
  ✅ 收藏夹功能：
     - files.is_starred 字段已存在，无需迁移
     - GET /api/files?starred=true 筛选收藏文件
     - POST /api/files/:id/star 添加收藏
     - DELETE /api/files/:id/star 取消收藏
     - 前端 Starred.tsx 页面 + StarredFiles.tsx 组件 + 侧边栏入口
  ✅ 存储分析 Dashboard：
     - GET /api/analytics/storage-breakdown（按类型分布统计）
     - GET /api/analytics/activity-heatmap（活跃度热力图）
     - GET /api/analytics/large-files（大文件 Top 20）
     - GET /api/analytics/storage-trend（存储趋势）
     - GET /api/analytics/bucket-stats（存储桶统计）
     - 前端 Analytics.tsx 页面 + StorageDashboard.tsx + 图表组件

Week 10:
  ✅ 通知系统：
     - 数据库迁移：0015_notifications.sql
     - notifications 表（share_received | mention | permission_granted | ai_complete | system）
     - 后端 API：GET /api/notifications, PUT /api/notifications/:id/read, DELETE /api/notifications/:id
     - 前端 NotificationBell（铃铛按钮）+ NotificationList（通知列表弹窗）
     - PC端：侧边栏底部显示，向上展开弹窗
     - 移动端：顶部栏右侧显示，向下展开弹窗
     - 注意：通知触发逻辑需在业务代码中调用 createNotification 函数
  ✅ FTS5 全文搜索升级：
     - 数据库迁移：0016_fts5.sql
     - files_fts 虚拟表 + 同步触发器
     - 支持 unicode61 中文分词
     - 后端：通过 fts=true 参数启用 FTS5 搜索
     - 前端：搜索栏 FTS5 开关按钮（桌面端 + 移动端）

Week 11（可选 - 未实现）:
  📋 2FA 双因素认证：
     - 数据库迁移：0017_2fa.sql
     - TOTP 生成与验证
     - 前端 TwoFactorSetup + TwoFactorVerify
  📋 文件夹快照：
     - 数据库迁移：0018_folder_snapshots.sql
     - 轻量快照（仅记录子树清单，不存储实际内容）
```

---

### 数据库迁移总览

| 编号 | 文件名                     | 涉及功能                                                                   | 状态      |
| ---- | -------------------------- | -------------------------------------------------------------------------- | --------- |
| 0010 | `notes.sql`                | file_notes, file_note_history, note_mentions                               | ✅ 已完成 |
| 0011 | `api_keys.sql`             | api_keys                                                                   | ✅ 已完成 |
| 0012 | `permission_v2.sql`        | user_groups, group_members, file_permissions 扩展字段                      | ✅ 已完成 |
| 0013 | `fix_user_id_nullable.sql` | 修复 user_id 可空问题                                                      | ✅ 已完成 |
| 0014 | `ai_features.sql`          | files.ai_summary, files.ai_tags, files.vector_indexed_at, files.is_starred | ✅ 已完成 |
| 0015 | `notifications.sql`        | notifications table                                                        | ✅ 已完成 |
| 0016 | `fts5.sql`                 | files_fts virtual table + sync triggers                                    | ✅ 已完成 |
| 0017 | `2fa.sql`                  | users.totp_secret, users.totp_enabled                                      | 📋 计划中 |
| 0018 | `folder_snapshots.sql`     | folder_snapshots table                                                     | 📋 计划中 |

---

### 新增目录结构

```
apps/api/src/
├── lib/
│   ├── versionManager.ts     ← ✅ 已实现: 版本自动触发、清理
│   ├── permissionResolver.ts ← ✅ 已实现: RBAC + 继承链解析
│   ├── vectorIndex.ts        ← ✅ 已实现: Vectorize 向量管理（bge-m3, 1024维）
│   ├── aiFeatures.ts         ← ✅ 已实现: AI 功能封装（摘要、标签、重命名）
│   ├── rateLimit.ts          ← ✅ 已实现: KV 滑动窗口限流
│   └── webhook.ts            ← ✅ 已实现: Webhook 分发
├── routes/
│   ├── notes.ts              ← ✅ 已实现
│   ├── groups.ts             ← ✅ 已实现
│   ├── apiKeys.ts            ← ✅ 已实现
│   ├── webhooks.ts           ← ✅ 已实现
│   ├── ai.ts                 ← ✅ 已实现: AI 功能 API
│   ├── analytics.ts          ← ✅ 已实现: 存储分析 API
│   ├── notifications.ts      ← ✅ 已实现: 通知 API
│   ├── snapshots.ts          ← 📋 计划中: 文件夹快照 API
│   └── v1/                   ← ✅ 已实现: 开放 API v1
│       ├── files.ts
│       ├── folders.ts
│       ├── shares.ts
│       └── search.ts

apps/web/src/components/
├── notes/                    ← ✅ 已实现
│   ├── NotePanel.tsx
│   ├── NoteEditor.tsx
│   ├── NoteCard.tsx
│   └── NoteHistoryDialog.tsx
├── permissions/              ← ✅ 已实现
│   ├── PermissionPanel.tsx
│   ├── GroupManager.tsx
│   └── PermissionGrantDialog.tsx
├── groups/                   ← ✅ 已实现
│   ├── GroupList.tsx
│   ├── GroupCreateDialog.tsx
│   └── GroupMemberDialog.tsx
├── webhooks/                 ← ✅ 已实现
│   ├── WebhookList.tsx
│   └── WebhookCreateDialog.tsx
├── editor/                   ← ✅ 已实现
│   ├── FileEditor.tsx
│   ├── CodeEditor.tsx
│   └── TextEditor.tsx
├── ai/                       ← ✅ 已实现
│   ├── AISummaryCard.tsx
│   ├── ImageTagsDisplay.tsx
│   ├── SmartRenameDialog.tsx
│   ├── AISettings.tsx
│   └── AIIndexButton.tsx
├── mobile/                   ← ✅ 已实现（计划外）
│   ├── MobileFilesToolbar.tsx
│   ├── MobileSearchPanel.tsx
│   └── MobileBottomNav.tsx
├── filepreview/              ← ✅ 已实现（计划外）
│   ├── ImagePreview.tsx
│   ├── VideoPreview.tsx
│   ├── AudioPreview.tsx
│   ├── PdfPreview.tsx
│   ├── MarkdownPreview.tsx
│   ├── CodePreview.tsx
│   ├── OfficePreview.tsx
│   ├── CsvPreview.tsx
│   ├── ZipPreview.tsx
│   ├── FontPreview.tsx
│   ├── EpubPreview.tsx
│   └── previewUtils.ts
├── analytics/                ← ✅ 已实现
│   ├── StorageDashboard.tsx
│   ├── StorageBreakdownChart.tsx
│   ├── ActivityHeatmap.tsx
│   └── LargeFilesList.tsx
└── notifications/            ← ✅ 已实现
    ├── NotificationBell.tsx
    ├── NotificationList.tsx
    └── NotificationItem.tsx
```

---

> **当前版本：v3.8.0**
>
> **已完成**：Phase 1-4（版本控制修复 + 备忘录基础 + API Key + 文件编辑 + 权限系统 v2 + RESTful v1 API + OpenAPI 文档 + Webhook + AI 智能化 + 移动端优化 + 预览组件拆分 + 收藏夹 + 存储分析 Dashboard + 通知系统 + FTS5 全文搜索）
>
> **下一步**：Phase 5（2FA 双因素认证 + 文件夹快照）
