# OSSshelf 功能开发大纲

> 基于代码库完整分析生成，所有文件路径均已核实。  
> 执行顺序建议：非 AI 功能优先（独立、风险低），AI 功能次之。

---

## 目录

- [非 AI 功能](#非-ai-功能)
  - [1. 移除复制/剪切，跨桶移动提示](#1-移除复制剪切跨桶移动提示)
  - [2. 简化展示模式 + 列表图片缩略图](#2-简化展示模式--列表图片缩略图)
  - [3. 移动端预览全屏（隐藏底部操作栏）](#3-移动端预览全屏隐藏底部操作栏)
  - [4. 文件/文件夹详情面板](#4-文件文件夹详情面板)
  - [5. 文件/文件夹换桶操作](#5-文件文件夹换桶操作)
- [AI 功能](#ai-功能)
  - [6. 对话式权限管理](#6-对话式权限管理)
  - [7. 对话式文件创建（含草稿预览）](#7-对话式文件创建含草稿预览)
  - [8. 智能整理建议](#8-智能整理建议)
  - [9. 文件集合分析](#9-文件集合分析)

---

## 非 AI 功能

---

### 1. 移除复制/剪切，跨桶移动提示

#### 现状

- 复制/剪切入口：`useFileContextMenu.tsx`（`id: 'copy'`、`id: 'cut'`）、`Files.tsx`（`clipboard` state、`batchCopyMutation`、Ctrl+C/X/V 快捷键）
- 当前 `fileService.ts → moveFile()` 只更新 DB 的 `parentId`/`path`，**不迁移实际存储对象**，跨桶移动会造成数据错位
- 换桶能力已有：`/api/migrate/start`（异步、KV 进度跟踪），与现有移动 UI 保持一致——维持异步方式

#### 后端

**`apps/api/src/lib/fileService.ts → moveFile()`**

- 移动前查询目标文件夹的 `bucketId`
- 与源文件 `bucketId` 对比：
  - 相同 → 维持现有逻辑（仅更新 DB）
  - 不同 → 返回 `{ success: false, error: 'CROSS_BUCKET', sourceBucketId, targetBucketId }`

**`apps/api/src/routes/files.ts`**

- `PATCH /:id` 和 `POST /:id/move` 透传 `CROSS_BUCKET` 错误码给前端

**`apps/api/src/routes/batch.ts → POST /move`**

- 批量移动加跨桶检测，任一文件跨桶则整体返回 `CROSS_BUCKET`

**`apps/api/src/routes/migrate.ts`**

- `startMigrateSchema.sourceBucketId` 改为 `optional`
- 无 `sourceBucketId` 时从各 `fileId` 自身的 `bucketId` 推断来源（支持单文件/文件夹粒度发起迁移）

#### 前端

**`apps/web/src/hooks/useFileContextMenu.tsx`**

- 删除 `id: 'copy'`、`id: 'cut'`、`id: 'paste'` 三个菜单项及 handler
- 删除 Ctrl+C、Ctrl+X、Ctrl+V 快捷键注册

**`apps/web/src/pages/Files.tsx`**

- 删除 `clipboard` state 及所有 `setClipboard` 调用
- 删除 `batchCopyMutation`
- 移动操作收到 `CROSS_BUCKET` 错误时弹出确认 Dialog：
  - 提示："目标文件夹位于不同存储桶，需要迁移文件内容，是否继续？"
  - 确认 → 调用 `POST /api/migrate/start`（传 `fileIds`、`targetBucketId`、`targetFolderId`），展示现有迁移进度 UI
  - 取消 → 中止

**`apps/web/src/components/files/dialogs/MoveFolderPicker.tsx`**

- 选择目标文件夹时，若目标桶与源桶不同，文件夹名称旁显示 Badge "将跨桶迁移"

#### 清理

- 全局搜索 `batchCopy` 确认无其他入口后删除相关 API hook
- 若 `POST /batch/copy` 路由无其他消费方，一并删除

---

### 2. 简化展示模式 + 列表图片缩略图

#### 现状

- `ViewMode`（`stores/files.ts`）：`'list' | 'grid' | 'masonry'`
- `galleryMode` 是独立 boolean，控制瀑布流/图库渲染
- `FileListContainer.tsx` 有 list / grid / masonry / galleryMode 四个渲染分支
- `Files.tsx` 的 `viewModes` 数组含 list、masonry 两项 + 独立 gallery 按钮
- `items/GalleryItem.tsx`、`items/MasonryItem.tsx` 是书架/瀑布流专属组件

#### 后端

无改动。

#### 前端

**`apps/web/src/stores/files.ts`**

- `ViewMode` 改为 `'list' | 'grid'`，删除 `'masonry'`
- 删除 `galleryMode` state 及 `setGalleryMode`
- 持久化读取时：存储值为 `'masonry'` 或 galleryMode 为 `true` 时重置为 `'list'`

**`apps/web/src/components/files/FileListContainer.tsx`**

- 删除 `galleryMode` prop 及对应渲染分支
- 删除 `viewMode === 'masonry'` 分支
- 保留 `list` 和 `grid` 两个分支

**`apps/web/src/pages/Files.tsx`**

- `viewModes` 数组只保留 `list`、`grid` 两项
- 删除 gallery 切换按钮及 `galleryMode` 相关逻辑和传参

**`apps/web/src/components/files/items/ListItem.tsx`**

- 左侧图标区域当前渲染 `<FileIcon>`
- 新增判断：`file.mimeType?.startsWith('image/')` 时渲染 `<img>` 缩略图：
  - URL：复用现有预览 URL 生成逻辑
  - 尺寸：`40×40px`，`rounded`，`object-cover`
  - 加载失败（`onError`）时 fallback 回 `<FileIcon>`
- 非图片文件维持原 `<FileIcon>` 逻辑

#### 清理

- 删除 `apps/web/src/components/files/items/GalleryItem.tsx`
- 删除 `apps/web/src/components/files/items/MasonryItem.tsx`
- 全局搜索 `masonry-grid`、`galleryMode`、`GalleryItem`、`MasonryItem` 清理残留引用

---

### 3. 移动端预览全屏（隐藏底部操作栏）

#### 现状

- `FilePreview.tsx`：移动端（`window.innerWidth < 768`）初始 `windowSize` 已设为 `'fullscreen'`，容器已是 `fixed inset-0 z-50 width:100vw height:100vh`，视觉上已全屏
- **问题**：底部有 `lg:hidden fixed bottom-0` 操作栏（下载/分享/编辑等），高度 `h-14` + `safe-bottom` padding，**固定遮挡预览内容底部**
- `viewport-fit=cover` 已配置（`index.html`），`safe-area` CSS 变量已定义（`index.css`），基础设施完备

#### 后端

无改动。

#### 前端

**`apps/web/src/components/files/FilePreview.tsx`**

新增 `showMobileBar` state（默认 `false`，移动全屏时底部栏默认收起）：

- `isMobileFullscreen` 计算属性：`windowSize === 'fullscreen' && window.innerWidth < 768`
- `isMobileFullscreen` 为 true 时：
  - 底部操作栏（`lg:hidden fixed bottom-0 ...`）加条件：`showMobileBar` 为 false 时 `translate-y-full`，transition 动画
  - 预览内容区域：`showMobileBar` 为 false 时 `pb-0`，为 true 时 `pb-[calc(3.5rem+var(--safe-area-inset-bottom))]`

点击交互：

- 预览内容区域（非按钮区域）单击 → toggle `showMobileBar`
- overlay 背景单击（`e.target === overlayRef.current`）→ 关闭预览（现有逻辑保留）
- 需在事件处理中区分点击来源，避免内容区点击误触关闭

**`apps/web/src/components/files/filepreview/ImagePreview.tsx`**

- 新增 `onTap?: () => void` prop
- 图片点击时调用 `onTap`（透传给 FilePreview 的 toggle 逻辑）

---

### 4. 文件/文件夹详情面板

#### 现状

- 前端无独立详情面板，右键菜单无"详情"入口
- `files` 表已有：`name, path, size, mimeType, createdAt, updatedAt, description, currentVersion, bucketId, aiSummary, aiTags, isStarred, vectorIndexedAt`
- 文件夹子文件数/总体积需聚合，D1 支持 `WITH RECURSIVE`

#### 后端

**`apps/api/src/routes/files.ts`**

新增 `GET /:id/detail`：

```
响应字段：
基础：id, name, path, size（字节数）, mimeType, isFolder, createdAt, updatedAt, description
存储：bucketId, bucketName（JOIN storageBuckets.name）, r2Key
版本：currentVersion, maxVersions, versionRetentionDays
AI：aiSummary, aiTags（JSON 解析为数组）, vectorIndexedAt, aiSummaryAt, aiTagsAt
分享：activeShareCount（COUNT FROM shares WHERE expiresAt > now OR expiresAt IS NULL）
文件夹专属：
  - childFileCount（直接子文件数）
  - childFolderCount（直接子文件夹数）
  - totalFileCount（WITH RECURSIVE 递归所有子文件数）
  - totalSize（WITH RECURSIVE 递归所有子文件体积之和）
```

#### 前端

**新建 `apps/web/src/components/files/dialogs/FileDetailPanel.tsx`**

- 组件形式：`Sheet`（shadcn/ui），桌面端右侧滑入，移动端底部弹出
- 内容分区：
  - **基础信息**：文件名、类型图标、大小、路径（可复制按钮）、创建时间、更新时间
  - **存储信息**：桶名称、r2Key（可复制）
  - **文件夹专属**：直接含 X 文件夹 / Y 文件，递归共 N 个文件，总大小
  - **AI 信息**：摘要（超 3 行折叠展开）、标签列表、向量索引状态
  - **分享状态**：活跃分享数（点击跳转分享管理）

**`apps/web/src/hooks/useFileContextMenu.tsx`**

- 新增菜单项 `id: 'detail'`，标签"详情"，图标 `Info`，位于菜单顶部
- 触发 `onDetail(file)` 回调

**`apps/web/src/pages/Files.tsx`**

- 新增 `detailFile` state（`FileItem | null`）
- 渲染 `<FileDetailPanel file={detailFile} onClose={() => setDetailFile(null)} />`

---

### 5. 文件/文件夹换桶操作

#### 现状

- `/api/migrate/start` 支持按 `fileIds` 迁移，文件夹递归遍历子项已实现（`migrate.ts` 第 109 行）
- `sourceBucketId` 目前为必填（功能 1 已改为 optional，本功能直接复用）
- 前端换桶入口仅在 `Buckets.tsx`（全桶粒度），无文件/文件夹粒度入口

#### 后端

依赖功能 1 对 `migrate.ts` 的改动，本功能无额外后端改动。

迁移完成后确认现有逻辑已覆盖：
- 新桶创建新文件记录（保留 `parentId`、`name`、`path`、所有 AI 字段）
- 旧桶记录软删除（`deletedAt = now()`）
- 文件夹换桶时子文件 `bucketId` 一并更新

#### 前端

**新建 `apps/web/src/components/files/dialogs/MigrateBucketDialog.tsx`**

- 展示当前桶名称
- 目标桶：`<Select>` 从 `GET /api/buckets` 获取，过滤当前桶
- 文件夹提示："将递归迁移所有子文件（共 N 个）"，N 从 `GET /:id/detail` 的 `totalFileCount` 获取
- 确认后调用 `POST /api/migrate/start`（`fileIds: [file.id]`，`targetBucketId`），展示现有迁移进度 UI

**`apps/web/src/hooks/useFileContextMenu.tsx`**

- 新增菜单项 `id: 'migrate-bucket'`，标签"换桶"，图标 `Database`
- 仅在用户桶数 > 1 时显示（从全局 store 或 context 获取桶列表数量判断）
- 触发 `onMigrateBucket(file)` 回调

**`apps/web/src/pages/Files.tsx`**

- 新增 `migrateBucketFile` state（`FileItem | null`）
- 渲染 `<MigrateBucketDialog file={migrateBucketFile} onClose={...} />`

---

## AI 功能

> 均基于现有 `agentEngine.ts` ReAct 架构，改动集中于 `agentTools/` 和 system prompt。  
> 不新增表，不修改 agentEngine 核心循环。

---

### 6. 对话式权限管理

#### 现状

- 权限工具已存在：`get_file_permissions`、`grant_permission`、`revoke_permission`、`set_folder_access_level`、`list_user_groups`、`manage_group_members`（`permission.ts`）
- `grant_permission` 支持 `expiresAt` 但不支持"N 天后过期"自然表达
- 缺少查询已过期授权的工具
- `PERMISSION_PATTERNS` 覆盖不够口语化

#### 后端

**`apps/api/src/lib/ai/agentTools/permission.ts`**

- `grant_permission` 参数新增 `expiresInDays?: number`：工具层将 `now + expiresInDays` 转为 `expiresAt` ISO 字符串

- 新增 `list_expired_permissions` 工具：
  ```
  参数：{ includeExpiringSoon?: boolean, withinDays?: number }
  逻辑：查询 filePermissions 表
    - expiresAt < now → 已过期
    - includeExpiringSoon=true 时额外返回 expiresAt < now + withinDays 的记录
  返回：[{ fileId, fileName, userId, permission, expiresAt }]
  _next_actions: ['可调用 revoke_permission 批量撤销']
  ```

**`apps/api/src/lib/ai/agentTools/toolSelector.ts`**

- `PERMISSION_PATTERNS` 新增：`把.*给|让.*只能看|让.*只读|收回.*权限|过期.*授权|已过期.*权限|快过期|撤销所有`
- write intent 路径下确保注入完整 `TOOL_GROUPS.permission`

**`apps/api/src/lib/ai/agentEngine.ts`（system prompt）**

权限意图示例补充：
```
"把设计文件夹给小明只读，30天后过期"
  → grant_permission(folderId, userId, 'read', expiresInDays=30)

"检查财务文件夹谁有写权限"
  → get_file_permissions(folderId) → 过滤 permission='write'

"清理所有已过期授权"
  → list_expired_permissions() → 逐个 revoke_permission(_confirmed=true)
```

#### 前端

无（AI Chat 内使用）。

---

### 7. 对话式文件创建（含草稿预览）

#### 现状

- `create_text_file`、`create_code_file`、`create_file_from_template` 是一步创建，无多轮起草流程
- `ToolCallCard.tsx` 的 `isPendingConfirm` 分支（第 240 行）已有 `DiffPreview` 插槽
- confirm flow（`_confirmed` 机制）已完整支持写操作前用户确认

#### 后端

**`apps/api/src/lib/ai/agentTools/fileops.ts`**

新增 `draft_and_create_file` 工具：

```typescript
参数：{
  fileName: string,          // 目标文件名（含扩展名）
  targetFolderId?: string,   // 目标文件夹 ID，不传则放根目录
  userRequest: string,       // 用户原始需求（用于 confirm 展示）
  draftContent: string,      // Agent 生成的草稿内容
  _confirmed?: boolean
}

执行逻辑：
_confirmed 为 false/undefined：
  返回 pending_confirm，携带：
    confirmId, message: `是否创建文件 "${fileName}"？`,
    draftContent（透传给前端展示）,
    previewType: 'draft'   ← 告知前端用草稿预览模式

_confirmed 为 true：
  调用 writeFileContent 写入文件
  返回 { success: true, fileId, fileName, path }
```

**`apps/api/src/lib/ai/agentEngine.ts`（system prompt）**

文件创建意图新增路径描述：
```
"帮我写一个 README"
  → draft_and_create_file(fileName='README.md', draftContent=<生成内容>, _confirmed=false)
  → 用户确认后 → draft_and_create_file(_confirmed=true)

"生成一个 Python 爬虫脚本放到代码文件夹"
  → draft_and_create_file(fileName='spider.py', targetFolderId=<ID>, draftContent=<代码>, _confirmed=false)
```

#### 前端

**`apps/web/src/components/ai/chat/ToolCallCard.tsx`**

在 `isPendingConfirm` 分支（第 240 行）新增草稿预览区域：

- 判断：`resultObj?.previewType === 'draft'`
- 若为 draft 模式，在确认按钮上方渲染 `<DraftPreview content={draftContent} fileName={fileName} />`

确认区域完整结构（修改后）：
```
isPendingConfirm 为 true 时渲染：
  ├─ 警告框（现有）：confirmMessage
  ├─ [previewType === 'draft'] DraftPreview  ← 新增
  ├─ [previewDiff 存在] DiffPreview          ← 现有
  └─ 确认/取消按钮（现有）
```

**新建 `apps/web/src/components/ai/chat/DraftPreview.tsx`**

- Props：`{ content: string, fileName: string }`
- 根据 `fileName` 扩展名选择渲染方式：
  - `.md` → Markdown 渲染（复用 `MarkdownPreview` 或 react-markdown）
  - `.py / .js / .ts / .json` 等 → 代码高亮（复用 `CodePreview` 语法高亮逻辑）
  - 其他 → 纯文本 `<pre>`
- 容器：`max-h-64 overflow-y-auto rounded-xl border bg-muted/30 p-3`
- 顶部显示文件名 badge

---

### 8. 智能整理建议

#### 现状

- `smart_rename_suggest` 仅做单文件重命名建议
- `get_cleanup_suggestions` 仅做存储层面分析
- `files` 表字段（`name, mimeType, path, parentId, aiTags, aiSummary, createdAt`）完全够用，无需读取文件内容

#### 后端

**`apps/api/src/lib/ai/agentTools/ai-enhance.ts`**

新增 `smart_organize_suggest` 工具：

```typescript
参数：{
  scope: 'all' | 'folder' | 'untagged',
  folderId?: string,
  limit?: number   // 默认 200
}

执行逻辑（纯读库，不修改数据）：
查询文件列表取 id, name, mimeType, path, parentId, aiTags, aiSummary, size, createdAt

四维度分析：

命名问题（namingIssues）：
  匹配：/^(IMG|DSC|截图|Screenshot|未命名|Untitled|New )/i 或纯数字文件名
  → { fileId, currentName, issue }

标签缺失（missingTags）：
  条件：aiTags 为空 AND aiSummary 非空
  → { fileId, fileName }，提示可用 trigger_ai_tags 补全

归类建议（relocateSuggestions）：
  条件：文件在根目录（parentId IS NULL）且 mimeType 归属明确类别
  同类型文件 > 3 个时建议归入同一文件夹
  → { fileId, fileName, suggestedFolderName, reason }

结构问题（structureIssues）：
  单文件夹直接子文件数 > 100 → 建议拆分
  路径层级 > 5 → 建议平铺
  → { folderId, folderName, issue, suggestion }

返回：
{
  scannedCount, namingIssues, missingTags, relocateSuggestions, structureIssues,
  _next_actions: ['可调用 batch_rename', '可调用 auto_tag_files', '可调用 move_file']
}
```

**`apps/api/src/lib/ai/agentTools/toolSelector.ts`**

- `TOOL_GROUPS.ai_enhance` 新增 `'smart_organize_suggest'`
- `AI_ENHANCE_PATTERNS` 新增：`整理建议|归类建议|命名混乱|帮我整理|文件乱|怎么整理|哪些没标签`

#### 前端

无（AI Chat 内使用）。

---

### 9. 文件集合分析

#### 现状

- `ask_rag_question` 做问答，无法输出跨文件结构化报告
- `aiSummary` 已为大多数文件生成，可作为内容代理减少实际文件读取
- Seed-2 Pro 256K 上下文支撑中等规模文件集合分析

#### 后端

**`apps/api/src/lib/ai/agentTools/content.ts`**

新增 `analyze_file_collection` 工具：

```typescript
参数：{
  scope: 'folder' | 'tag' | 'starred',
  folderId?: string,
  tagName?: string,
  analysisType: 'summary' | 'compare' | 'extract_common' | 'timeline',
  maxFiles?: number   // 默认 20
}

执行逻辑：
1. 按 scope 查询文件列表：
   - folder：parentId = folderId（不递归）
   - tag：JOIN fileTags 过滤
   - starred：isStarred = true

2. 按 maxFiles 截取，优先取有 aiSummary 的文件

3. 构建内容摘要列表：
   - 有 aiSummary → 直接使用
   - 无 aiSummary → readFileContent 取前 500 字符
   - 图片/二进制 → 仅文件名 + mimeType

4. 返回文件内容摘要集合，由 agentEngine 主模型自行分析（工具层不调用 LLM）：
{
  files: [{ id, name, mimeType, size, summary, updatedAt }],
  totalCount, truncated, analysisType,
  _next_actions: [对应 analysisType 的分析指令]
}

analysisType 对应 _next_actions：
  summary       → '请基于以上文件摘要生成整体报告'
  compare       → '请对比以上文件的异同点'
  extract_common → '请提取以上文件的共同主题/条款/关键词'
  timeline      → '请按时间顺序梳理文件脉络'
```

**`apps/api/src/lib/ai/agentTools/toolSelector.ts`**

- `TOOL_GROUPS.content` 新增 `'analyze_file_collection'`
- `intent === 'content_qa'` 时注入此工具
- 新增触发 pattern：`分析这批|分析这些|这个文件夹.*内容|对比这些文件|提取共同|梳理一下|汇总这些`

#### 前端

无（AI Chat 内使用）。

---

## 附：改动文件速查表

| 文件 | 功能 | 操作 |
|------|------|------|
| `apps/api/src/lib/fileService.ts` | 1 | 改：跨桶检测 |
| `apps/api/src/routes/files.ts` | 1、4 | 改：透传 CROSS_BUCKET；新增 `GET /:id/detail` |
| `apps/api/src/routes/batch.ts` | 1 | 改：批量移动跨桶检测 |
| `apps/api/src/routes/migrate.ts` | 1、5 | 改：`sourceBucketId` optional，支持单文件粒度 |
| `apps/web/src/stores/files.ts` | 2 | 改：删除 masonry / galleryMode |
| `apps/web/src/components/files/FileListContainer.tsx` | 2 | 改：删除 masonry/gallery 分支 |
| `apps/web/src/components/files/items/ListItem.tsx` | 2 | 改：新增图片缩略图逻辑 |
| `apps/web/src/components/files/items/GalleryItem.tsx` | 2 | **删除** |
| `apps/web/src/components/files/items/MasonryItem.tsx` | 2 | **删除** |
| `apps/web/src/pages/Files.tsx` | 1、2、4、5 | 改：多处 |
| `apps/web/src/hooks/useFileContextMenu.tsx` | 1、4、5 | 改：删复制/剪切；新增详情/换桶菜单项 |
| `apps/web/src/components/files/dialogs/MoveFolderPicker.tsx` | 1 | 改：跨桶提示 Badge |
| `apps/web/src/components/files/FilePreview.tsx` | 3 | 改：tap-to-toggle 底部操作栏 |
| `apps/web/src/components/files/filepreview/ImagePreview.tsx` | 3 | 改：透传 onTap 事件 |
| `apps/web/src/components/files/dialogs/FileDetailPanel.tsx` | 4 | **新建** |
| `apps/web/src/components/files/dialogs/MigrateBucketDialog.tsx` | 5 | **新建** |
| `apps/api/src/lib/ai/agentTools/permission.ts` | 6 | 改：新增 `expiresInDays`；新增 `list_expired_permissions` |
| `apps/api/src/lib/ai/agentTools/fileops.ts` | 7 | 改：新增 `draft_and_create_file` |
| `apps/api/src/lib/ai/agentTools/ai-enhance.ts` | 8 | 改：新增 `smart_organize_suggest` |
| `apps/api/src/lib/ai/agentTools/content.ts` | 9 | 改：新增 `analyze_file_collection` |
| `apps/api/src/lib/ai/agentTools/toolSelector.ts` | 6、8、9 | 改：patterns 和 TOOL_GROUPS 更新 |
| `apps/api/src/lib/ai/agentEngine.ts` | 6、7 | 改：system prompt 补充意图示例 |
| `apps/web/src/components/ai/chat/ToolCallCard.tsx` | 7 | 改：新增 draft 预览分支 |
| `apps/web/src/components/ai/chat/DraftPreview.tsx` | 7 | **新建** |
