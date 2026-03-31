# OSSShelf v4.0 第一批次执行计划

> 基于《OSSShelf v4.0 增强优化方案》Phase 1，目标：基础稳固（版本控制修复 + 备忘录基础 + API Key 机制 + 文件编辑）
> 
> **状态：✅ 已完成**
> **版本：3.5.0**

---

## 概述

**执行周期**：3 周
**核心目标**：填补现有功能的空洞，修复已识别的严重问题
**完成日期**：2024年

### 现状分析（已完成）

| 模块 | 原现状 | 已解决问题 |
|------|------|------|
| 版本控制 | `fileVersions` 表已存在，路由已实现 | ✅ 文件更新时自动版本快照；maxVersions 限制已执行；版本清理 cron 已优化 |
| 备忘录/笔记 | 几乎缺失 | ✅ 已完成建设 |
| API 开放 | 仅支持 JWT 认证 | ✅ 已实现 API Key 机制 |
| 文件编辑 | 仅支持新建文本文件 | ✅ 支持编辑已存在文件；支持在线编辑器 |

---

## Week 1：版本控制修复（✅ 已完成）

### 任务 1.1：创建版本管理器模块（✅ 已完成）

**文件**：`apps/api/src/lib/versionManager.ts`

**功能**：
- `createVersionSnapshot()` - 创建版本快照
- `pruneExcessVersions()` - 裁剪超量版本
- `checkAndCreateVersion()` - 检查并自动创建版本

**实现要点**：
```typescript
// 核心逻辑
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

export async function pruneExcessVersions(
  db: DrizzleDb,
  env: Env,
  fileId: string,
  maxVersions: number
): Promise<void> {
  // 查最老的超量版本 → 递减 ref_count → ref_count=0 则加入 R2 删除队列
}
```

### 任务 1.2：集成版本自动触发（✅ 已完成）

**修改文件**：`apps/api/src/routes/files.ts`

**触发时机**：
1. 文件内容更新（新增编辑接口）
2. 预签名上传完成回调
3. WebDAV PUT

**实现方案**：
- 在文件内容更新后调用 `createVersionSnapshot()`
- 需要区分"新建文件"和"更新文件"场景

### 任务 1.3：优化版本清理 Cron（✅ 已完成）

**修改文件**：`apps/api/src/routes/cron.ts`

**现有问题**：
- 版本清理逻辑已存在，但未处理 `ref_count` 递减
- 未正确处理孤儿 r2Key

**优化内容**：
1. 递减被删除版本的 `ref_count`
2. 当 `ref_count = 0` 时，从 R2 删除物理对象
3. 添加 maxVersions 超量清理逻辑

### 任务 1.4：修复孤儿 r2Key 清理（✅ 已完成）

**修改文件**：`apps/api/src/lib/dedup.ts`

**实现要点**：
- 当版本删除时，正确处理 `ref_count`
- `ref_count = 0` 时标记为待删除
- 在 cleanup 中批量清理孤儿对象

---

## Week 2：备忘录基础建设（✅ 已完成）

### 任务 2.1：数据库迁移（✅ 已完成）

**文件**：`apps/api/migrations/0010_notes.sql`

**表结构**：
```sql
-- 文件笔记表
CREATE TABLE IF NOT EXISTS file_notes (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,          -- Markdown 原文
  content_html TEXT,                  -- 预渲染 HTML
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  parent_id   TEXT REFERENCES file_notes(id),   -- 支持回复/线程
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TEXT
);

-- 笔记版本历史
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

-- files 表新增字段
ALTER TABLE files ADD COLUMN description TEXT;
ALTER TABLE files ADD COLUMN note_count INTEGER DEFAULT 0;
```

**索引**：
```sql
CREATE INDEX idx_file_notes_file ON file_notes(file_id, deleted_at, created_at DESC);
CREATE INDEX idx_file_notes_user ON file_notes(user_id, created_at DESC);
CREATE INDEX idx_file_notes_pinned ON file_notes(file_id, is_pinned);
CREATE INDEX idx_note_mentions_user ON note_mentions(user_id, is_read);
```

### 任务 2.2：更新 Schema 定义（✅ 已完成）

**修改文件**：`apps/api/src/db/schema.ts`

**新增表定义**：
- `fileNotes` 表
- `fileNoteHistory` 表
- `noteMentions` 表

**修改 files 表**：
- 添加 `description` 字段
- 添加 `noteCount` 字段

### 任务 2.3：创建笔记路由（✅ 已完成）

**文件**：`apps/api/src/routes/notes.ts`

**路由设计**：
```
GET    /api/notes/:fileId           -- 获取文件所有笔记（支持分页、排序）
POST   /api/notes/:fileId           -- 新建笔记
PUT    /api/notes/:fileId/:noteId   -- 编辑笔记（自动追加历史快照）
DELETE /api/notes/:fileId/:noteId   -- 软删除
GET    /api/notes/:fileId/:noteId/history  -- 查看编辑历史
POST   /api/notes/:fileId/:noteId/pin      -- 置顶/取消置顶
GET    /api/notes/mentions/unread   -- 获取未读 @提及
PUT    /api/notes/mentions/:id/read -- 标为已读
```

**关键实现**：
1. **Markdown 安全渲染**：使用 `unified + remark-parse + rehype-sanitize` 预处理
2. **@提及解析**：POST/PUT 时正则扫描 `@username`，查用户表，批量写 `note_mentions`
3. **files.note_count 维护**：在 notes 路由中手动 `+1/-1`

### 任务 2.4：前端组件开发（✅ 已完成）

**目录**：`apps/web/src/components/notes/`

**组件清单**：
```
├── NotePanel.tsx          -- 右侧抽屉/面板，与 FilePreview 并列
├── NoteEditor.tsx         -- Markdown 编辑器（推荐 @uiw/react-md-editor）
├── NoteThread.tsx         -- 线程视图（主笔记 + 回复列表）
├── NoteCard.tsx           -- 单条笔记卡片，含置顶标记、时间、操作
├── MentionBadge.tsx       -- 顶部导航未读提醒
└── NoteHistoryDialog.tsx  -- 历史版本对比 diff 视图
```

**实现要点**：
1. NotePanel 作为文件详情页的侧边栏
2. NoteEditor 支持实时预览和 @用户 自动补全
3. NoteCard 显示笔记摘要、作者、时间、操作按钮

### 任务 2.5：集成到文件详情页（✅ 已完成）

**修改文件**：`apps/web/src/components/share/ShareFilePreview.tsx` 或相关文件详情组件

**实现**：
- 添加笔记面板入口按钮
- 集成 NotePanel 组件
- 显示笔记数量角标

---

## Week 3：API Key 机制 + 文件编辑功能（✅ 已完成）

### 任务 3.1：数据库迁移 - API Keys（✅ 已完成）

**文件**：`apps/api/migrations/0011_api_keys.sql`

**表结构**：
```sql
-- API Keys 表
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,   -- SHA-256(key)
  key_prefix  TEXT NOT NULL,          -- 展示用，如 "osk_live_abc123..."
  scopes      TEXT NOT NULL,          -- JSON array
  last_used_at TEXT,
  expires_at  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Webhooks 表（可选，Phase 2 实现）
CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  events      TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  last_status INTEGER,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Scope 设计**：
```
files:read        -- 列出、下载、搜索文件
files:write       -- 上传、修改、删除文件
shares:read       -- 查看分享
shares:write      -- 创建/删除分享
buckets:read      -- 查看存储桶配置
admin:read        -- 管理员查询
```

### 任务 3.2：更新 Schema 定义（✅ 已完成）

**修改文件**：`apps/api/src/db/schema.ts`

**新增表定义**：
- `apiKeys` 表
- `webhooks` 表（预留）

### 任务 3.3：扩展认证中间件（✅ 已完成）

**修改文件**：`apps/api/src/middleware/auth.ts`

**实现方案**：
```typescript
// 认证优先级：
// 1. Authorization: Bearer <jwt>
// 2. Authorization: ApiKey osk_live_xxxx
// 3. X-API-Key: osk_live_xxxx header

export const apiKeyMiddleware = async (c, next) => {
  const apiKey = c.req.header('X-API-Key') || extractApiKeyFromBearer(c);
  if (apiKey) {
    const hash = await sha256(apiKey);
    const keyRecord = await db.select()...where(eq(api_keys.key_hash, hash)).get();
    // 验证、检查过期、检查 scope、更新 last_used_at
  }
};
```

**关键点**：
- API Key 验证使用 SHA-256 哈希比对
- 检查 `is_active` 和 `expires_at`
- 验证 scope 权限
- 更新 `last_used_at`

### 任务 3.4：创建 API Key 管理路由（✅ 已完成）

**文件**：`apps/api/src/routes/apiKeys.ts`

**路由设计**：
```
GET    /api/keys              -- 列出用户所有 API Key
POST   /api/keys              -- 创建新 API Key（返回明文 key，仅一次）
GET    /api/keys/:id          -- 获取单个 API Key 详情
DELETE /api/keys/:id          -- 删除（撤销）API Key
PATCH  /api/keys/:id          -- 更新 API Key（名称、scope）
```

**安全要点**：
- 创建时生成随机 key：`osk_live_${randomBytes(32).toString('base64url')}`
- 仅在创建时返回明文 key，之后无法恢复
- 存储时只保存 SHA-256 哈希

### 任务 3.5：前端 API Key 管理界面（✅ 已完成）

**目录**：`apps/web/src/components/settings/`

**组件清单**：
```
├── ApiKeyList.tsx         -- API Key 列表
├── ApiKeyCreateDialog.tsx -- 创建 API Key 弹窗
├── ApiKeyShowOnceDialog.tsx -- 创建成功后显示 key（仅一次）
└── ApiKeyDeleteDialog.tsx -- 删除确认弹窗
```

**页面集成**：
- 在用户设置页面添加 "API Keys" 标签页

---

## 文件编辑功能（✅ 已完成）

### 任务 3.6：创建文件编辑 API（✅ 已完成）

**修改文件**：`apps/api/src/routes/files.ts`

**新增路由**：
```
PUT    /api/files/:id/content    -- 更新文件内容（触发版本快照）
GET    /api/files/:id/raw        -- 获取文件原始内容（用于编辑器加载）
```

**实现要点**：
```typescript
// PUT /api/files/:id/content
app.put('/:id/content', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  const { content, changeSummary } = await c.req.json();
  
  // 1. 权限检查（需要 write 权限）
  // 2. 获取原文件信息
  // 3. 创建版本快照（调用 versionManager.createVersionSnapshot）
  // 4. 更新文件内容到存储
  // 5. 更新 files 表（hash, size, updatedAt）
  // 6. 返回更新结果
});

// GET /api/files/:id/raw
app.get('/:id/raw', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('id');
  
  // 1. 权限检查
  // 2. 获取文件元数据
  // 3. 检查是否为可编辑文件（text/*, application/json 等）
  // 4. 从存储读取内容
  // 5. 返回文本内容
});
```

**支持的文件类型**：
- `text/*`（text/plain, text/markdown, text/html, text/css, text/javascript 等）
- `application/json`
- `application/xml`
- `application/javascript`
- 其他文本格式（.yaml, .toml, .ini, .env 等）

### 任务 3.7：前端文件编辑器组件（✅ 已完成）

**目录**：`apps/web/src/components/editor/`

**组件清单**：
```
├── FileEditor.tsx           -- 文件编辑器主组件
├── FileEditorToolbar.tsx    -- 编辑器工具栏（保存、版本历史等）
├── FileEditorHeader.tsx     -- 文件信息头部（名称、类型、大小）
├── CodeEditor.tsx           -- 代码编辑器（基于 Monaco Editor 或 CodeMirror）
├── TextEditor.tsx           -- 纯文本编辑器
├── MarkdownEditor.tsx       -- Markdown 编辑器（实时预览）
├── EditorSaveDialog.tsx     -- 保存确认弹窗（输入变更说明）
└── EditorVersionHistory.tsx -- 版本历史侧边栏
```

**编辑器选择**：
- **代码文件**：Monaco Editor（VS Code 同款编辑器）
- **Markdown 文件**：支持实时预览的 Markdown 编辑器
- **纯文本文件**：简单的 textarea 或 CodeMirror

**功能特性**：
1. 语法高亮（根据文件类型自动识别）
2. 行号显示
3. 自动缩进
4. 查找替换
5. 撤销/重做
6. 保存前检测内容变化
7. 版本历史快速查看

### 任务 3.8：集成文件编辑器到文件详情页（✅ 已完成）

**修改文件**：
- `apps/web/src/components/share/ShareFilePreview.tsx`
- 或创建新的文件详情页组件

**实现**：
1. 对于可编辑文件，显示"编辑"按钮
2. 点击后打开编辑器模态框或跳转到编辑页面
3. 编辑器加载文件内容
4. 保存时调用 `PUT /api/files/:id/content`
5. 显示保存成功/失败提示
6. 自动刷新文件预览

### 任务 3.9：新建文件增强（✅ 已完成）

**修改文件**：`apps/web/src/components/files/FileCreateDialog.tsx`（或类似组件）

**增强功能**：
1. 支持选择文件类型模板：
   - 空白文本文件
   - Markdown 文档
   - JSON 文件
   - HTML 文件
   - CSS 样式表
   - JavaScript 脚本
   - 自定义模板

2. 新建后自动打开编辑器

3. 支持从模板创建：
   - README.md 模板
   - package.json 模板
   - .gitignore 模板
   - 配置文件模板

---

## 执行顺序与依赖关系

```
Week 1: 版本控制修复
├── 1.1 创建 versionManager.ts
├── 1.2 集成到 files.ts（依赖 1.1）
├── 1.3 优化 cron.ts 版本清理（独立）
└── 1.4 修复 dedup.ts 孤儿清理（独立）

Week 2: 备忘录基础建设
├── 2.1 数据库迁移 0010_notes.sql
├── 2.2 更新 schema.ts（依赖 2.1）
├── 2.3 创建 notes.ts 路由（依赖 2.2）
├── 2.4 前端组件开发（依赖 2.3）
└── 2.5 集成到文件详情页（依赖 2.4）

Week 3: API Key 机制 + 文件编辑
├── 3.1 数据库迁移 0011_api_keys.sql
├── 3.2 更新 schema.ts（依赖 3.1）
├── 3.3 扩展 auth.ts 中间件（依赖 3.2）
├── 3.4 创建 apiKeys.ts 路由（依赖 3.2）
├── 3.5 前端 API Key 管理界面（依赖 3.4）
├── 3.6 创建文件编辑 API（独立）
├── 3.7 前端文件编辑器组件（依赖 3.6）
├── 3.8 集成到文件详情页（依赖 3.7）
└── 3.9 新建文件增强（依赖 3.7）
```

---

## 验收标准

### 版本控制
- [x] 文件内容更新时自动创建版本快照
- [x] 版本数超过 maxVersions 时自动裁剪最老版本
- [x] 版本清理 cron 正确处理 ref_count 和孤儿 r2Key
- [x] 所有版本操作有完整的审计日志

### 备忘录
- [x] 可为任意文件添加/编辑/删除笔记
- [x] 支持 Markdown 格式和安全渲染
- [x] 支持 @提及 用户并记录通知
- [x] 笔记历史版本可追溯
- [x] 前端笔记面板正常显示和交互

### API Key
- [x] 可创建/列出/删除 API Key
- [x] API Key 认证正常工作
- [x] Scope 权限控制生效
- [x] 前端管理界面完整可用

### 文件编辑
- [x] 可编辑文本类型文件（txt, md, json, html, css, js 等）
- [x] 编辑器支持语法高亮
- [x] 保存时自动创建版本快照
- [x] 可查看编辑历史和版本对比
- [x] 新建文件支持模板选择
- [x] 新建后自动打开编辑器

---

## 风险与注意事项

1. **数据库迁移**：D1 不支持事务性 DDL，迁移失败需手动回滚
2. **版本触发时机**：需仔细区分"新建"和"更新"场景，避免误创建版本
3. **API Key 安全**：明文 key 仅显示一次，需提醒用户保存
4. **文件编辑安全**：
   - 需验证文件类型是否可编辑
   - 大文件需限制编辑（建议 < 1MB）
   - 二进制文件禁止编辑
5. **编辑器性能**：Monaco Editor 较大，需考虑按需加载
6. **并发编辑**：多人同时编辑同一文件需考虑冲突处理（暂不实现协同编辑）

---

## 后续批次预告

- **Phase 2**（✅ 已完成 - v3.6.0）：权限系统 v2（RBAC + 继承链）+ RESTful v1 API + OpenAPI 文档
- **Phase 3**（📋 计划中）：AI 智能化（Workers AI + 语义搜索 + 文件总结）
- **Phase 4**（📋 计划中）：体验完善（FTS5 搜索、通知系统、收藏夹、2FA）
