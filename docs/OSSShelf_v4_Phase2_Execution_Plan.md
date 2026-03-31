# OSSShelf v4.0 第二批次执行计划

> 基于《OSSShelf v4.0 增强优化方案》Phase 2，目标：权限系统 v2 + RESTful v1 API + OpenAPI 文档
> 
> **状态：✅ 已完成**
> **版本：3.6.0**

---

## 概述

**执行周期**：3 周
**核心目标**：构建 RBAC 权限系统、开放 RESTful API、提供 OpenAPI 文档
**完成日期**：2025年

### 现状分析（已完成）

| 模块 | 原现状 | 已解决问题 |
|------|------|------|
| 权限管控 | 有 `filePermissions` 表（read/write/admin），支持文件夹递归授权 | ✅ 支持组/角色概念；权限继承基于递归 CTE；支持时效性权限；权限检查已优化 |
| API 开放 | 所有路由需 JWT auth，已支持 API Key 认证 | ✅ 已有 API 版本号，已有 OpenAPI 文档，已实现速率限制 |
| Webhook | `webhooks` 表已存在 | ✅ 已实现事件分发逻辑 |

### Phase 1 完成确认（✅ 已完成）

- [x] 版本控制修复 - `versionManager.ts` 已实现
- [x] 备忘录基础建设 - 数据库、路由、前端组件已完成
- [x] API Key 机制 - 数据库、路由、认证中间件、前端组件已完成
- [x] 文件编辑功能 - API 和前端编辑器组件已完成

---

## Week 4：权限系统 v2 基础（✅ 已完成）

### 任务 4.1：数据库迁移 - 用户组与权限扩展（✅ 已完成）

**文件**：`apps/api/migrations/0012_permission_v2.sql`

**表结构**：
```sql
-- 用户组
CREATE TABLE IF NOT EXISTS user_groups (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

-- 权限记录扩展字段
ALTER TABLE file_permissions ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'user';
ALTER TABLE file_permissions ADD COLUMN group_id TEXT REFERENCES user_groups(id) ON DELETE CASCADE;
ALTER TABLE file_permissions ADD COLUMN expires_at TEXT;
ALTER TABLE file_permissions ADD COLUMN inherit_to_children INTEGER NOT NULL DEFAULT 1;
ALTER TABLE file_permissions ADD COLUMN scope TEXT NOT NULL DEFAULT 'explicit'; -- explicit | inherited
ALTER TABLE file_permissions ADD COLUMN source_permission_id TEXT REFERENCES file_permissions(id);

CREATE INDEX idx_file_permissions_group   ON file_permissions(group_id);
CREATE INDEX idx_file_permissions_expires ON file_permissions(expires_at);
CREATE INDEX idx_file_permissions_scope   ON file_permissions(scope);
```

**实现要点**：
- D1 不支持事务性 DDL，迁移失败需手动回滚
- 先创建新表，再添加 ALTER 语句
- 为现有数据设置默认值

### 任务 4.2：更新 Schema 定义（✅ 已完成）

**修改文件**：`apps/api/src/db/schema.ts`

**新增表定义**：
```typescript
export const userGroups = sqliteTable(
  'user_groups',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
    updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
  },
  (table) => ({
    ownerIdx: index('idx_user_groups_owner').on(table.ownerId),
  })
);

export const groupMembers = sqliteTable(
  'group_members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    addedBy: text('added_by').references(() => users.id),
    createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  },
  (table) => ({
    userIdx: index('idx_group_members_user').on(table.userId),
    groupIdx: index('idx_group_members_group').on(table.groupId),
    uniqueIdx: uniqueIndex('idx_group_members_unique').on(table.groupId, table.userId),
  })
);
```

**修改 filePermissions 表**：
```typescript
export const filePermissions = sqliteTable(
  'file_permissions',
  {
    // ... 现有字段
    subjectType: text('subject_type').notNull().default('user'),
    groupId: text('group_id').references(() => userGroups.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at'),
    inheritToChildren: integer('inherit_to_children', { mode: 'boolean' }).notNull().default(true),
    scope: text('scope').notNull().default('explicit'),
    sourcePermissionId: text('source_permission_id').references(() => filePermissions.id),
  },
  // ... 索引
);
```

### 任务 4.3：创建权限解析器模块（✅ 已完成）

**文件**：`apps/api/src/lib/permissionResolver.ts`

**功能**：
- `resolveEffectivePermission()` - 解析有效权限（递归 CTE 方案）
- `checkPermissionWithCache()` - 带缓存的权限检查
- `invalidatePermissionCache()` - 权限缓存失效
- `propagatePermissionToChildren()` - 权限传播到子文件

**核心实现**：
```typescript
export interface PermissionResolution {
  hasAccess: boolean;
  permission: 'read' | 'write' | 'admin' | null;
  source: 'explicit' | 'inherited' | 'owner';
  sourceFileId?: string;
  sourceFilePath?: string;
  expiresAt?: string;
}

export async function resolveEffectivePermission(
  db: DrizzleDb,
  env: Env,
  fileId: string,
  userId: string,
  requiredLevel: PermissionLevel
): Promise<PermissionResolution> {
  // 1. 检查文件所有者
  // 2. 查当前文件的显式 user 权限
  // 3. 查当前文件的显式 group 权限（需先查用户所在组）
  // 4. 沿 parentId 链向上遍历（递归 CTE），查 inherit_to_children=1 的权限
  // 5. 取最高级别
}

export async function checkPermissionWithCache(
  db: DrizzleDb,
  env: Env,
  fileId: string,
  userId: string,
  requiredLevel: PermissionLevel
): Promise<PermissionResolution> {
  const cacheKey = `perm:${fileId}:${userId}`;
  
  // 1. 尝试从 KV 缓存获取
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // 2. 解析权限
  const result = await resolveEffectivePermission(db, env, fileId, userId, requiredLevel);
  
  // 3. 写入缓存（TTL 5 分钟）
  await env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
  
  return result;
}

export async function invalidatePermissionCache(
  env: Env,
  fileId: string
): Promise<void> {
  // 删除该文件相关的所有权限缓存
  // 使用 KV 的 list 功能批量删除
}
```

**递归 CTE 查询示例**：
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
  AND fp.inherit_to_children = 1
ORDER BY a.depth ASC, 
  CASE fp.permission WHEN 'admin' THEN 3 WHEN 'write' THEN 2 ELSE 1 END DESC
LIMIT 1;
```

### 任务 4.4：创建用户组路由（✅ 已完成）

**文件**：`apps/api/src/routes/groups.ts`

**路由设计**：
```
GET    /api/groups                    -- 列出用户拥有的组
POST   /api/groups                    -- 创建新组
GET    /api/groups/:id                -- 获取组详情
PUT    /api/groups/:id                -- 更新组信息
DELETE /api/groups/:id                -- 删除组
GET    /api/groups/:id/members        -- 列出组成员
POST   /api/groups/:id/members        -- 添加成员
DELETE /api/groups/:id/members/:userId -- 移除成员
PUT    /api/groups/:id/members/:userId/role -- 更新成员角色
```

**关键实现**：
```typescript
// 创建组
app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const { name, description } = await c.req.json();
  
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();
  
  await db.insert(userGroups).values({
    id: groupId,
    ownerId: userId,
    name,
    description,
    createdAt: now,
    updatedAt: now,
  });
  
  // 创建者自动成为组管理员
  await db.insert(groupMembers).values({
    id: crypto.randomUUID(),
    groupId,
    userId,
    role: 'admin',
    addedBy: userId,
    createdAt: now,
  });
  
  return c.json({ success: true, data: { id: groupId, name, description } });
});

// 添加成员
app.post('/:id/members', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('id');
  const { userId: targetUserId, role = 'member' } = await c.req.json();
  
  // 检查操作者是否是组管理员
  const membership = await db.select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .get();
  
  if (!membership || membership.role !== 'admin') {
    throwAppError('FORBIDDEN', '只有组管理员可以添加成员');
  }
  
  // 添加成员
  await db.insert(groupMembers).values({
    id: crypto.randomUUID(),
    groupId,
    userId: targetUserId,
    role,
    addedBy: userId,
    createdAt: new Date().toISOString(),
  });
  
  return c.json({ success: true, data: { message: '成员已添加' } });
});
```

---

## Week 5：权限 UI 重构（✅ 已完成）

### 任务 5.1：创建用户组管理组件（✅ 已完成）

**目录**：`apps/web/src/components/groups/`

**组件清单**：
```
├── GroupList.tsx           -- 用户组列表
├── GroupCreateDialog.tsx   -- 创建组弹窗
├── GroupDetail.tsx         -- 组详情页
├── GroupMemberList.tsx     -- 成员列表
├── GroupMemberAddDialog.tsx -- 添加成员弹窗
└── index.ts                -- 导出入口
```

**GroupList.tsx 关键实现**：
```typescript
export function GroupList() {
  const { data: groups, isLoading } = useQuery({
    queryKey: ['user-groups'],
    queryFn: () => groupsApi.list().then(r => r.data.data),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">用户组</h2>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          创建组
        </Button>
      </div>
      
      {groups?.map(group => (
        <GroupCard key={group.id} group={group} />
      ))}
    </div>
  );
}
```

### 任务 5.2：重构权限管理面板（✅ 已完成）

**修改文件**：`apps/web/src/components/files/permissions/FilePermissionManager.tsx`

**新增功能**：
1. 支持选择用户或组进行授权
2. 支持设置过期时间
3. 显示权限来源（显式/继承）
4. 显示继承路径提示

**关键改动**：
```typescript
interface PermissionGrantFormData {
  subjectType: 'user' | 'group';
  userId?: string;
  groupId?: string;
  permission: 'read' | 'write' | 'admin';
  expiresAt?: string;
}

export function FilePermissionManager({ fileId, isOwner }: FilePermissionManagerProps) {
  const [subjectType, setSubjectType] = useState<'user' | 'group'>('user');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  
  // ... 现有逻辑
  
  return (
    <div className="space-y-4">
      {/* 授权类型选择 */}
      <div className="flex gap-2">
        <Button
          variant={subjectType === 'user' ? 'default' : 'outline'}
          onClick={() => setSubjectType('user')}
        >
          <User className="h-4 w-4 mr-1" />
          用户
        </Button>
        <Button
          variant={subjectType === 'group' ? 'default' : 'outline'}
          onClick={() => setSubjectType('group')}
        >
          <Users className="h-4 w-4 mr-1" />
          用户组
        </Button>
      </div>
      
      {/* 过期时间设置 */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">过期时间（可选）</label>
        <Input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </div>
      
      {/* 权限列表 */}
      {permissions.map(perm => (
        <PermissionCard
          key={perm.id}
          permission={perm}
          showSource={true}
        />
      ))}
    </div>
  );
}
```

### 任务 5.3：创建继承权限提示组件（✅ 已完成）

**文件**：`apps/web/src/components/files/permissions/InheritedPermBadge.tsx`

```typescript
interface InheritedPermBadgeProps {
  sourceFilePath: string;
  sourcePermission: string;
}

export function InheritedPermBadge({ sourceFilePath, sourcePermission }: InheritedPermBadgeProps) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <ArrowUpRight className="h-3 w-3" />
      <span>继承自</span>
      <span className="font-medium text-foreground">{sourceFilePath}</span>
      <Badge variant="outline" className="text-xs">
        {PERMISSION_LABELS[sourcePermission]}
      </Badge>
    </div>
  );
}
```

### 任务 5.4：更新权限路由以支持新功能（✅ 已完成）

**修改文件**：`apps/api/src/routes/permissions.ts`

**新增/修改路由**：
```typescript
// 扩展授权接口
app.post('/grant', async (c) => {
  const { fileId, userId, groupId, permission, expiresAt, subjectType = 'user' } = await c.req.json();
  
  // 验证权限
  if (subjectType === 'group') {
    // 检查组是否存在且用户是组管理员
    const group = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).get();
    if (!group) throwAppError('GROUP_NOT_FOUND', '用户组不存在');
    
    const membership = await db.select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .get();
    
    if (!membership || membership.role !== 'admin') {
      throwAppError('FORBIDDEN', '只有组管理员可以授权');
    }
  }
  
  // 创建权限记录
  await db.insert(filePermissions).values({
    id: crypto.randomUUID(),
    fileId,
    userId: subjectType === 'user' ? userId : null,
    groupId: subjectType === 'group' ? groupId : null,
    subjectType,
    permission,
    expiresAt,
    grantedBy: c.get('userId')!,
    inheritToChildren: true,
    scope: 'explicit',
    createdAt: now,
    updatedAt: now,
  });
  
  // 使权限缓存失效
  await invalidatePermissionCache(env, fileId);
  
  return c.json({ success: true });
});

// 获取权限详情（包含继承信息）
app.get('/file/:fileId/resolve', async (c) => {
  const userId = c.get('userId')!;
  const fileId = c.req.param('fileId');
  
  const resolution = await resolveEffectivePermission(db, env, fileId, userId, 'read');
  
  return c.json({
    success: true,
    data: resolution,
  });
});
```

### 任务 5.5：添加权限审计日志（✅ 已完成）

**修改文件**：`apps/api/src/routes/permissions.ts`

在权限操作后记录审计日志：
```typescript
await createAuditLog({
  env: c.env,
  userId,
  action: 'permission.grant',
  resourceType: 'permission',
  resourceId: fileId,
  details: {
    targetUserId,
    targetGroupId,
    permission,
    expiresAt,
    subjectType,
    fileName: file.name,
  },
  ipAddress: getClientIp(c),
  userAgent: getUserAgent(c),
});
```

---

## Week 6：RESTful v1 API + OpenAPI 文档（✅ 已完成）

### 任务 6.1：安装 OpenAPI 相关依赖（✅ 已完成）

**执行命令**：
```bash
pnpm add @hono/zod-openapi zod
```

### 任务 6.2：创建 API v1 路由目录结构（✅ 已完成）

**目录**：`apps/api/src/routes/v1/`

```
├── index.ts           -- v1 路由入口
├── files.ts           -- 文件 API
├── folders.ts         -- 文件夹 API
├── shares.ts          -- 分享 API
├── search.ts          -- 搜索 API
├── me.ts              -- 当前用户 API
└── openapi.ts         -- OpenAPI 文档配置
```

### 任务 6.3：创建 OpenAPI Hono 应用（✅ 已完成）

**文件**：`apps/api/src/routes/v1/index.ts`

```typescript
import { OpenAPIHono } from '@hono/zod-openapi';
import { filesRoute } from './files';
import { foldersRoute } from './folders';
import { sharesRoute } from './shares';
import { searchRoute } from './search';
import { meRoute } from './me';

const app = new OpenAPIHono();

// 注册路由
app.route('/files', filesRoute);
app.route('/folders', foldersRoute);
app.route('/shares', sharesRoute);
app.route('/search', searchRoute);
app.route('/me', meRoute);

// OpenAPI 文档
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'OSSShelf API v1',
    version: '1.0.0',
    description: 'OSSShelf 文件管理系统 RESTful API',
  },
  servers: [
    { url: '/api/v1', description: '当前服务器' },
  ],
});

// Swagger UI
app.get('/docs', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>OSSShelf API Documentation</title>
      <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
      <script>
        SwaggerUIBundle({
          url: '/api/v1/openapi.json',
          dom_id: '#swagger-ui',
        })
      </script>
    </body>
    </html>
  `);
});

export default app;
```

### 任务 6.4：创建文件 API 路由（✅ 已完成）

**文件**：`apps/api/src/routes/v1/files.ts`

```typescript
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';

const app = new OpenAPIHono();

// Schema 定义
const FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  size: z.number(),
  mimeType: z.string().nullable(),
  isFolder: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const FileListResponse = z.object({
  success: z.boolean(),
  data: z.object({
    files: z.array(FileSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
});

// 列出文件
const listFilesRoute = createRoute({
  method: 'get',
  path: '/',
  request: {
    query: z.object({
      parentId: z.string().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
      type: z.enum(['file', 'folder']).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: FileListResponse },
      },
      description: '文件列表',
    },
    401: {
      description: '未授权',
    },
  },
  tags: ['Files'],
  summary: '列出文件',
  description: '获取指定目录下的文件列表',
});

app.openapi(listFilesRoute, async (c) => {
  const userId = c.get('userId')!;
  const { parentId, page = '1', limit = '50', type } = c.req.valid('query');
  
  // 实现文件列表逻辑
  const files = await getFiles(db, userId, parentId, parseInt(page), parseInt(limit), type);
  
  return c.json({
    success: true,
    data: files,
  });
});

// 上传文件
const uploadFileRoute = createRoute({
  method: 'post',
  path: '/upload',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any(),
            parentId: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': { schema: z.object({ success: z.boolean(), data: FileSchema }) },
      },
      description: '上传成功',
    },
  },
  tags: ['Files'],
  summary: '上传文件',
});

app.openapi(uploadFileRoute, async (c) => {
  // 实现上传逻辑
});

// 下载文件
const downloadFileRoute = createRoute({
  method: 'get',
  path: '/{id}/download',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/octet-stream': {},
      },
      description: '文件内容',
    },
    404: {
      description: '文件不存在',
    },
  },
  tags: ['Files'],
  summary: '下载文件',
});

app.openapi(downloadFileRoute, async (c) => {
  // 实现下载逻辑
});

// 删除文件
const deleteFileRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({ success: z.boolean(), message: z.string() }) },
      },
      description: '删除成功',
    },
  },
  tags: ['Files'],
  summary: '删除文件',
});

app.openapi(deleteFileRoute, async (c) => {
  // 实现删除逻辑
});

export { app as filesRoute };
```

### 任务 6.5：挂载 v1 API 到主应用（✅ 已完成）

**修改文件**：`apps/api/src/index.ts`

```typescript
import v1Routes from './routes/v1';

// ... 现有代码

// 挂载 v1 API（速率限制已在域名层面配置）
app.route('/api/v1', v1Routes);
```

### 任务 6.7：实现 Webhook 事件分发（✅ 已完成）

**文件**：`apps/api/src/lib/webhook.ts`

```typescript
export type WebhookEvent = 
  | 'file.uploaded'
  | 'file.deleted'
  | 'file.updated'
  | 'share.created'
  | 'share.deleted'
  | 'permission.granted'
  | 'permission.revoked';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export async function dispatchWebhook(
  env: Env,
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  const db = getDb(env.DB);
  
  // 获取用户的所有活跃 webhook
  const webhooks = await db
    .select()
    .from(webhooks)
    .where(and(
      eq(webhooks.userId, userId),
      eq(webhooks.isActive, true)
    ))
    .all();
  
  for (const webhook of webhooks) {
    const events = JSON.parse(webhook.events) as WebhookEvent[];
    if (!events.includes(event)) continue;
    
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };
    
    // 异步发送
    sendWebhookRequest(env, webhook, payload).catch((error) => {
      console.error(`Webhook ${webhook.id} failed:`, error);
    });
  }
}

async function sendWebhookRequest(
  env: Env,
  webhook: typeof webhooks.$inferSelect,
  payload: WebhookPayload
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = await hmacSha256(webhook.secret, body);
  
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': payload.event,
      },
      body,
    });
    
    // 更新 webhook 状态
    await db.update(webhooks)
      .set({ lastStatus: response.status })
      .where(eq(webhooks.id, webhook.id));
  } catch (error) {
    await db.update(webhooks)
      .set({ lastStatus: 0 })
      .where(eq(webhooks.id, webhook.id));
    throw error;
  }
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### 任务 6.8：创建 Webhook 管理路由（✅ 已完成）

**文件**：`apps/api/src/routes/webhooks.ts`

```typescript
import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, webhooks } from '../db';
import { authMiddleware } from '../middleware/auth';
import { throwAppError } from '../middleware/error';
import { ERROR_CODES } from '@osshelf/shared';
import type { Env, Variables } from '../types/env';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('/*', authMiddleware);

const VALID_EVENTS = [
  'file.uploaded',
  'file.deleted',
  'file.updated',
  'share.created',
  'share.deleted',
  'permission.granted',
  'permission.revoked',
];

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
});

app.get('/', async (c) => {
  const userId = c.get('userId')!;
  const db = getDb(c.env.DB);
  
  const hooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.userId, userId))
    .orderBy(desc(webhooks.createdAt))
    .all();
  
  return c.json({
    success: true,
    data: hooks.map(h => ({
      ...h,
      events: JSON.parse(h.events),
    })),
  });
});

app.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json();
  const result = createWebhookSchema.safeParse(body);
  
  if (!result.success) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: result.error.errors[0].message } },
      400
    );
  }
  
  const { url, events } = result.data;
  
  // 验证事件类型
  const invalidEvents = events.filter(e => !VALID_EVENTS.includes(e));
  if (invalidEvents.length > 0) {
    return c.json(
      { success: false, error: { code: ERROR_CODES.VALIDATION_ERROR, message: `无效的事件类型: ${invalidEvents.join(', ')}` } },
      400
    );
  }
  
  // 生成密钥
  const secret = generateSecret();
  
  const webhookId = crypto.randomUUID();
  const now = new Date().toISOString();
  
  const db = getDb(c.env.DB);
  await db.insert(webhooks).values({
    id: webhookId,
    userId,
    url,
    secret,
    events: JSON.stringify(events),
    isActive: true,
    lastStatus: null,
    createdAt: now,
  });
  
  return c.json({
    success: true,
    data: {
      id: webhookId,
      url,
      secret, // 仅创建时返回
      events,
      warning: '请妥善保存此密钥，系统不会再次显示',
    },
  });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const webhookId = c.req.param('id');
  const db = getDb(c.env.DB);
  
  const webhook = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
    .get();
  
  if (!webhook) {
    throwAppError('WEBHOOK_NOT_FOUND', 'Webhook 不存在');
  }
  
  await db.delete(webhooks).where(eq(webhooks.id, webhookId));
  
  return c.json({ success: true, data: { message: 'Webhook 已删除' } });
});

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default app;
```

### 任务 6.9：前端 Webhook 管理界面（✅ 已完成）

**目录**：`apps/web/src/components/webhooks/`

**新增组件**：
```
├── WebhookList.tsx         -- Webhook 列表
├── WebhookCreateDialog.tsx -- 创建 Webhook 弹窗
└── WebhookShowSecretDialog.tsx -- 显示密钥弹窗
```

---

## 执行顺序与依赖关系

```
Week 4: 权限系统 v2 基础
├── 4.1 数据库迁移 0012_permission_v2.sql
├── 4.2 更新 schema.ts（依赖 4.1）
├── 4.3 创建 permissionResolver.ts（依赖 4.2）
└── 4.4 创建 groups.ts 路由（依赖 4.2）

Week 5: 权限 UI 重构
├── 5.1 创建用户组管理组件（依赖 4.4）
├── 5.2 重构权限管理面板（依赖 4.3）
├── 5.3 创建继承权限提示组件（依赖 5.2）
├── 5.4 更新权限路由（依赖 4.3）
└── 5.5 添加权限审计日志（依赖 5.4）

Week 6: RESTful v1 API + OpenAPI
├── 6.1 安装 OpenAPI 依赖（独立）
├── 6.2 创建 API v1 目录结构（依赖 6.1）
├── 6.3 创建 OpenAPI Hono 应用（依赖 6.2）
├── 6.4 创建文件 API 路由（依赖 6.3）
├── 6.5 挂载 v1 API（依赖 6.3）
├── 6.6 实现 Webhook 事件分发（独立）
├── 6.7 创建 Webhook 管理路由（依赖 6.6）
└── 6.8 前端 Webhook 管理界面（依赖 6.7）
```

---

## 验收标准

### 权限系统 v2
- [x] 可创建/管理用户组
- [x] 可为组添加/移除成员
- [x] 可为用户或组授予文件权限
- [x] 权限支持设置过期时间
- [x] 权限继承正常工作（子文件继承父文件夹权限）
- [x] 权限缓存正确失效
- [x] 递归 CTE 查询性能可接受
- [x] 前端权限管理 UI 正常显示和交互

### RESTful v1 API
- [x] /api/v1/* 路由正常工作
- [x] OpenAPI 文档可访问（/api/v1/openapi.json）
- [x] Swagger UI 正常显示（/api/v1/docs）
- [x] API Key 认证正常工作
- [x] 所有端点有完整的请求/响应 schema

### Webhook
- [x] 可创建/删除 Webhook
- [x] 文件事件正确触发 Webhook
- [x] Webhook 签名验证正确
- [x] 前端 Webhook 管理界面完整可用

---

## 风险与注意事项

1. **数据库迁移**：
   - D1 不支持事务性 DDL，迁移失败需手动回滚
   - ALTER TABLE 可能影响现有数据，需先备份

2. **权限解析性能**：
   - 递归 CTE 查询需要测试性能
   - KV 缓存 TTL 需要权衡实时性和性能
   - 权限变更时需要正确失效缓存

3. **API 兼容性**：
   - v1 API 应与现有 /api/* 路由共存
   - 保持向后兼容，不破坏现有功能

4. **Webhook 安全**：
   - 密钥仅在创建时显示一次
   - 签名验证使用 HMAC-SHA256
   - 需要处理超时和重试

5. **OpenAPI 文档**：
   - Schema 定义需要与实际实现保持同步
   - 复杂的响应结构需要仔细定义

---

## 后续批次预告

- **Phase 3**（📋 计划中）：AI 智能化（Workers AI + 语义搜索 + 文件总结）
- **Phase 4**（📋 计划中）：体验完善（FTS5 搜索、通知系统、收藏夹、2FA）
