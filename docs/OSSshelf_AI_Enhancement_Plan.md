# OSSshelf AI 增强方案

> 基于对现有代码库（agentEngine / ragEngine / agentTools / vectorIndex / schema）的完整审计，按影响力 × 改动量排序。

---

## 已完成的优化（v1 补丁）

在正式增强方案之前，以下问题已在上一轮修复：

| 问题                                             | 文件             | 修复方式                                                            |
| ------------------------------------------------ | ---------------- | ------------------------------------------------------------------- |
| `ESTIMATED_TOKENS_PER_CHAR = 0.5` 对中文严重低估 | `ragEngine.ts`   | 改为 `estimateTokens()` 函数，中文 0.67 / 英文 0.25 动态切换        |
| `FILE_LIST_PATTERNS` 只覆盖中文                  | `ragEngine.ts`   | 补充 8 条英文正则（`how many files` / `storage usage` 等）          |
| `runAutoChain` 无视觉意图时也触发图片分析        | `agentEngine.ts` | 新增 `hasVisualIntent(query)` 门控，`query` 透传进入 `runAutoChain` |
| `buildFileTextForVector` 未索引 `aiTags`         | `vectorIndex.ts` | 展开 tags JSON 数组拼入向量文本，提升图片标签召回率                 |

---

## 优先做（改动小、价值高）

### 1. 写操作工具集

**为什么：** Agent 当前是纯只读的，但用户在对话中提出"帮我把这份合同打上'重要'标签"，Agent 只能回答"你去前端操作吧"——体验断层。`fileTags`、`fileNotes`、`files.name/description`、`shares` 表完全支持写入，缺的只是工具层。

**改动位置：** `agentTools.ts` 新增 6 个工具，`AGENT_SYSTEM_PROMPT` 更新能力边界说明。

**新增工具清单：**

```typescript
// agentTools.ts 新增

// 1. rename_file
{
  name: 'rename_file',
  description: '重命名文件或文件夹。执行前必须在回复中告知用户将要执行的操作。',
  parameters: {
    fileId: { type: 'string', description: '文件 UUID' },
    newName: { type: 'string', description: '新文件名（含扩展名）' },
  },
  required: ['fileId', 'newName'],
}

// 2. add_tag
{
  name: 'add_tag',
  description: '为文件添加标签。标签不存在时自动创建。',
  parameters: {
    fileId: { type: 'string' },
    tagName: { type: 'string', description: '标签名称' },
    color: { type: 'string', description: '标签颜色（可选，十六进制如 #FF5733）' },
  },
  required: ['fileId', 'tagName'],
}

// 3. remove_tag
{
  name: 'remove_tag',
  description: '从文件移除标签。',
  parameters: {
    fileId: { type: 'string' },
    tagName: { type: 'string' },
  },
  required: ['fileId', 'tagName'],
}

// 4. write_note
{
  name: 'write_note',
  description: '为文件添加或更新备注。',
  parameters: {
    fileId: { type: 'string' },
    content: { type: 'string', description: '备注内容（支持 Markdown）' },
  },
  required: ['fileId', 'content'],
}

// 5. update_description
{
  name: 'update_description',
  description: '更新文件的描述字段。',
  parameters: {
    fileId: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['fileId', 'description'],
}

// 6. create_share
{
  name: 'create_share',
  description: '为文件创建分享链接。',
  parameters: {
    fileId: { type: 'string' },
    expiresInDays: { type: 'number', description: '有效天数，不传则永久有效' },
    password: { type: 'string', description: '访问密码（可选）' },
    downloadLimit: { type: 'number', description: '最大下载次数（可选）' },
  },
  required: ['fileId'],
}
```

**安全机制：** 写工具在执行器里统一加确认标记，Agent 必须先输出操作摘要再执行：

```typescript
// AgentToolExecutor.execute() 写操作前置检查
const WRITE_TOOLS = new Set([
  'rename_file',
  'add_tag',
  'remove_tag',
  'write_note',
  'update_description',
  'create_share',
]);

// 在 execute() 入口处，写工具返回一个 pending_confirm 结构
// Agent 读到这个结构后输出确认提示，用户确认后再调用 _confirm=true 参数重新触发
```

**`AGENT_SYSTEM_PROMPT` 能力边界更新：**

```
✅ 可以：搜索、过滤、读取内容、视觉分析、查看统计、对比文件
✅ 可以（需告知）：重命名、添加/移除标签、添加备注、更新描述、创建分享链接
❌ 不能：删除文件、移动文件、修改文件内容、管理权限组
```

---

### 2. 搜索记忆 + 偏好学习

**为什么：** `searchHistory` 表已在记录每次搜索词，但完全没被 AI 利用。用户的搜索词和高频文件类型是最直接的偏好信号，注入 RAG 上下文可以提升搜索结果相关性，同时让 LLM 的回答更贴合用户习惯。零新表，纯逻辑改动。

**改动位置：** `ragEngine.ts` → `buildContext()` 方法。

**实现思路：**

```typescript
// ragEngine.ts — buildContext() 开头新增

async function getUserSearchPreferences(
  env: Env,
  userId: string
): Promise<{
  topQueries: string[];
  topMimeTypes: string[];
}> {
  const db = getDb(env.DB);

  // 最近 30 天搜索记录，取 top 10 高频词
  const recent = await db
    .select({ query: searchHistory.query })
    .from(searchHistory)
    .where(
      and(
        eq(searchHistory.userId, userId),
        gte(searchHistory.createdAt, new Date(Date.now() - 30 * 86400_000).toISOString())
      )
    )
    .orderBy(desc(searchHistory.createdAt))
    .limit(50)
    .all();

  // 词频统计（简单分词：按空格和标点切割）
  const freq = new Map<string, number>();
  for (const r of recent) {
    const words = r.query.split(/[\s，。、,.\-_]+/).filter((w) => w.length >= 2);
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const topQueries = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  // 近期访问文件的 mimeType 分布（从 auditLogs 取 file.view 事件）
  const recentFiles = await db
    .select({ mimeType: files.mimeType })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)))
    .orderBy(desc(files.updatedAt))
    .limit(30)
    .all();

  const mimeFreq = new Map<string, number>();
  for (const f of recentFiles) {
    if (f.mimeType) {
      const cat = getMimeTypeCategory(f.mimeType);
      mimeFreq.set(cat, (mimeFreq.get(cat) || 0) + 1);
    }
  }
  const topMimeTypes = [...mimeFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  return { topQueries, topMimeTypes };
}
```

**注入 system prompt：**

```typescript
// buildContext() 中，在 systemContent 拼接前

const prefs = await getUserSearchPreferences(env, request.userId);
const prefHint =
  prefs.topQueries.length > 0
    ? `\n\n[用户偏好参考] 该用户近期常用搜索词：${prefs.topQueries.join('、')}；` +
      `常用文件类型：${prefs.topMimeTypes.join('、')}。搜索结果匹配以上偏好时适当提升排序。`
    : '';

const systemContent = `${SYSTEM_PROMPTS.default}${prefHint}\n\n== 相关文件信息 ==\n...`;
```

**向量搜索权重提升：** 在 `ragEngine.searchRelevantFiles()` 里，对命中用户 topQueries 关键词的文件 `similarityScore += 0.15`（上限 1.0）。

---

### 3. 版本变更 AI 差异摘要

**为什么：** `fileVersions` 表已有完整的版本数据，但 `get_file_versions` 工具只返回版本列表（号码/大小/时间），用户还需要自己对比才能知道改了什么。加一个版本摘要字段，在新版本上传后异步生成，成本极低。

**Schema 变更：** `fileVersions` 表新增一列：

```sql
-- migration: 0010_ai_version_summary.sql
ALTER TABLE file_versions ADD COLUMN ai_change_summary TEXT;
```

**Drizzle schema 更新：**

```typescript
// db/schema.ts — fileVersions 表新增字段
aiChangeSummary: text('ai_change_summary'),
```

**生成逻辑：** 在 `aiTaskQueue.ts` 新增 `version_summary` 任务类型：

```typescript
// features.ts 新增

export async function generateVersionSummary(
  env: Env,
  fileId: string,
  newVersionId: string,
  userId: string
): Promise<void> {
  const db = getDb(env.DB);

  // 取最新两个版本
  const versions = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.versionNumber))
    .limit(2)
    .all();

  if (versions.length < 2) return; // 首版无需对比

  const [newVer, oldVer] = versions;

  // 只对文本类文件生成摘要，图片等跳过
  if (!canGenerateSummary(null, newVer.fileName || '')) return;

  const newText = await buildFileTextForVector(env, fileId);
  if (!newText || newText.length < 50) return;

  const summary = await callChatModel(env, userId, 'summary', {
    messages: [
      {
        role: 'system',
        content: '你是文件变更分析助手。用 1-2 句话描述这次文件更新的主要变化。只关注内容变化，不提文件名或时间。',
      },
      {
        role: 'user',
        content: `文件名：${newVer.fileName}\n版本：v${oldVer.versionNumber} → v${newVer.versionNumber}\n当前内容摘要：\n${newText.slice(0, 2000)}`,
      },
    ],
    maxTokens: 150,
  });

  await db.update(fileVersions).set({ aiChangeSummary: summary }).where(eq(fileVersions.id, newVersionId));
}
```

**触发时机：** 在 `versionManager.ts` 的版本创建完成后调用 `enqueueAutoProcessFile`，或直接在 `aiTaskQueue` 的消息处理里监听 `type === 'version_summary'`。

**`get_file_versions` 工具返回值更新：**

```typescript
// agentTools.ts — get_file_versions 返回结构新增 aiChangeSummary 字段
versions: versions.map((v) => ({
  versionNumber: v.versionNumber,
  size: formatBytes(v.size || 0),
  createdAt: v.createdAt,
  aiChangeSummary: v.aiChangeSummary || null, // 新增
}));
```

---

### 4. AI 事件 Webhook 扩展

**为什么：** 当前 `WebhookEvent` 只有 7 种文件操作事件，AI 处理完成后没有任何外部通知能力。用户无法把摘要结果推送到 Notion、Slack 或自己的系统，AI 成不了数据管道的一环。

**改动位置：** `webhook.ts`、`aiTaskQueue.ts`。

**新增事件类型：**

```typescript
// webhook.ts — WebhookEvent 类型扩展
export type WebhookEvent =
  | 'file.uploaded'
  | 'file.deleted'
  | 'file.updated'
  | 'share.created'
  | 'share.deleted'
  | 'permission.granted'
  | 'permission.revoked'
  // 新增 AI 事件
  | 'ai.summary_complete' // 文件摘要生成完成
  | 'ai.tags_generated' // 图片标签生成完成
  | 'ai.index_complete' // 向量索引完成
  | 'ai.insight_triggered'; // 主动洞察发现异常（见方案6）
```

**事件 payload 结构：**

```typescript
// ai.summary_complete payload
{
  event: 'ai.summary_complete',
  timestamp: '2025-04-06T10:00:00Z',
  data: {
    fileId: 'xxx',
    fileName: '季度报告.pdf',
    mimeType: 'application/pdf',
    summary: '本报告总结了 Q1 销售数据，主要结论包括...',
    tokensUsed: 320,
  }
}

// ai.tags_generated payload
{
  event: 'ai.tags_generated',
  timestamp: '...',
  data: {
    fileId: 'xxx',
    fileName: 'photo.jpg',
    tags: ['风景', '山脉', '日落'],
    caption: '夕阳西下的山脊线，橙红色天空...',
  }
}
```

**触发点：** 在 `aiTaskQueue.ts` 的任务完成回调里：

```typescript
// processAiTaskMessage() 任务完成后

await dispatchWebhook(env, userId, 'ai.summary_complete', {
  fileId: file.id,
  fileName: file.name,
  mimeType: file.mimeType,
  summary: result.summary,
});
```

**前端 Webhook 配置页更新：** `VALID_EVENTS` 数组和 `WEBHOOK_EVENTS` 显示列表补充上述 4 个新事件。

---

### 5. 意图分类预路由（替换 `isFileListQuery` 正则）

> **注：** 此方案在 v1 补丁中已补充了英文正则作为过渡方案。本方案是更彻底的重构，在资源允许时实施。

**为什么：** 当前正则只能区分"统计类 vs 非统计类"两种意图，而实际上至少有 5 种需要不同处理路径：统计类、语义搜索类、内容问答类、视觉类、通用对话类。错误路由直接导致 Agent 幻觉（例如把"帮我分析这段代码"路由到统计查询路径）。

**改动位置：** `ragEngine.ts`，新增 `classifyIntent()` 函数。

**实现：** 用 Workers AI 小模型做轻量分类（约 50-80ms，比一次向量搜索快）：

```typescript
// ragEngine.ts

export type QueryIntent =
  | 'file_stats' // 统计：文件数量/存储用量
  | 'file_search' // 搜索：找某类或某个文件
  | 'content_qa' // 问答：基于文件内容回答
  | 'image_visual' // 视觉：通过图片外观找图
  | 'general'; // 通用：不涉及文件的问题

async function classifyIntent(env: Env, query: string): Promise<QueryIntent> {
  // 快速正则预过滤（避免每次都调用模型）
  if (FILE_LIST_PATTERNS.some((p) => p.test(query))) return 'file_stats';

  const VISUAL_PATTERNS = [/照片|图片.*(找|搜)|找.*照片|photo|image/i, /描述|外观|颜色|样子|scene/i];
  if (VISUAL_PATTERNS.some((p) => p.test(query))) return 'image_visual';

  // 模型分类（仅在正则未命中时调用）
  if (!env.AI) return 'file_search'; // 降级

  try {
    const result = await (env.AI as any).run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: `将用户问题分类为以下之一，只输出分类词，不输出其他内容：
file_stats（询问文件数量/存储统计）
file_search（寻找特定文件）
content_qa（基于文件内容的问答）
image_visual（通过图片视觉内容找图）
general（与文件无关的通用问题）`,
        },
        { role: 'user', content: query },
      ],
      max_tokens: 10,
    });

    const label = (result?.response || '').trim().toLowerCase() as QueryIntent;
    const valid: QueryIntent[] = ['file_stats', 'file_search', 'content_qa', 'image_visual', 'general'];
    return valid.includes(label) ? label : 'file_search';
  } catch {
    return 'file_search'; // 降级
  }
}
```

**在 `buildContext()` 中按意图路由：**

```typescript
const intent = await classifyIntent(env, request.query);

switch (intent) {
  case 'file_stats':
    // 原有统计路径
    break;
  case 'image_visual':
    // 直接走 filter_files(image/*) + analyze_image 链路
    // 不做语义向量搜索（图片 summary 通常是视觉描述，不适合文本向量匹配）
    break;
  case 'content_qa':
    // 语义搜索 + 完整内容读取（includeFileContent: true）
    break;
  case 'general':
    // 跳过文件搜索，直接走 LLM
    break;
  default: // file_search
  // 原有向量搜索路径
}
```

---

## 中期做（需要新逻辑，价值高）

### 6. 主动洞察引擎

**为什么：** 用户不知道自己的文件库里有什么问题——重复文件浪费空间、长期未访问的孤儿文件、存储增长异常。这些信息完全可以从现有表里计算出来，通过 Cron + Notification 主动推送，不需要用户主动问。

**改动位置：** `cron.ts` 新增 `/cron/ai-insights`，`notificationUtils.ts` 新增 `ai_insight` 类型。

**三种洞察规则：**

```typescript
// cron.ts — 新增 /cron/ai-insights 端点

// 规则 1：重复文件检测
// 查找 hash 相同、owner 相同、且总大小 > 10MB 的重复组
const dupGroups = await db
  .select({ hash: files.hash, cnt: count(), totalSize: sum(files.size) })
  .from(files)
  .where(and(isNull(files.deletedAt), isNotNull(files.hash)))
  .groupBy(files.hash)
  .having(gt(count(), 1))
  .all();

// 规则 2：孤儿文件（上传 > 30 天，未被分享，无标签，无备注，无 AI 摘要）
const orphanThreshold = new Date(Date.now() - 30 * 86400_000).toISOString();
const orphans = await db
  .select({ id: files.id, userId: files.userId, name: files.name, size: files.size })
  .from(files)
  .where(
    and(
      isNull(files.deletedAt),
      lt(files.createdAt, orphanThreshold),
      isNull(files.aiSummary),
      isNull(files.aiTags),
      eq(files.noteCount, 0)
    )
  )
  .limit(5)
  .all();

// 规则 3：存储增长异常（7 天内增长超过 30%）
// 对比 files 表 createdAt 分布

// 发现问题后写 notifications（type: 'ai_insight'）
// data 字段存结构化洞察信息，前端 AI Chat 入口展示气泡
await createNotification(env, userId, {
  type: 'ai_insight',
  title: '发现 3 组重复文件',
  body: '共占用 245 MB，建议清理',
  data: JSON.stringify({ insightType: 'duplicates', count: 3, totalSize: 245 * 1024 * 1024 }),
});
```

**`wrangler.toml` Cron 配置：**

```toml
[triggers]
crons = [
  "0 2 * * *",   # 已有：每天 2 点清理垃圾
  "0 3 * * 1",   # 新增：每周一 3 点跑 AI 洞察
]
```

---

### 7. 跨文件关系推理

**为什么：** 用户上传了"需求文档.docx"和"技术方案.pdf"，它们在语义上高度相关，但系统对此一无所知。建立自动关联图后，Agent 的 `find_related_files` 工具可以直接命中，不再依赖用户自己打标签。

**Schema 变更：**

```sql
-- migration: 0011_file_relations.sql
CREATE TABLE IF NOT EXISTS file_relations (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  related_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  relation_score REAL NOT NULL,
  detected_at TEXT NOT NULL,
  UNIQUE(file_id, related_file_id)
);
CREATE INDEX idx_file_relations_file ON file_relations(file_id, relation_score DESC);
```

**生成逻辑：** 在文件向量索引完成后触发：

```typescript
// features.ts — indexFileVector 完成后调用

async function buildFileRelations(env: Env, fileId: string, userId: string): Promise<void> {
  // 用当前文件的向量在 Vectorize 中查 top-5 最相似文件
  const similar = await searchSimilarFiles(env, '', userId, { limit: 5, threshold: 0.6 });
  // （实际传入文件本身的向量，不是 query 字符串）

  const db = getDb(env.DB);
  const relations = similar
    .filter((r) => r.fileId !== fileId && r.score >= 0.6)
    .map((r) => ({
      id: crypto.randomUUID(),
      fileId,
      relatedFileId: r.fileId,
      relationScore: r.score,
      detectedAt: new Date().toISOString(),
    }));

  if (relations.length > 0) {
    await db.insert(fileRelations).values(relations).onConflictDoNothing();
  }
}
```

**新增 Agent 工具 `find_related_files`：**

```typescript
{
  name: 'find_related_files',
  description: '查找与指定文件语义相关的其他文件（基于内容相似度自动检测）。适合用户问"有没有和这个文档配套的文件"时使用。',
  parameters: {
    fileId: { type: 'string', description: '文件 UUID' },
    minScore: { type: 'number', description: '最低相关度（0-1），默认 0.6' },
    limit: { type: 'number', description: '返回数量，默认 5' },
  },
  required: ['fileId'],
}
```

---

### 8. 自然语言全局搜索

**为什么：** 现有搜索是关键词匹配，用户要精确知道文件名才好用。自然语言搜索让用户说"上周张总发来的那份预算"就能找到文件，LLM 负责解析条件，现有过滤器负责执行——两层解耦，改动面小。

**改动位置：** `routes/search.ts` 新增 `/search/nl` 端点，前端搜索框新增 AI 模式切换。

**后端解析器：**

```typescript
// routes/search.ts — POST /search/nl

const { query, userId } = await parseRequest(c);

const parseResult = await callChatModel(env, userId, 'summary', {
  messages: [
    {
      role: 'system',
      content: `将用户的自然语言搜索请求解析为结构化过滤条件，输出 JSON，不输出其他内容。
字段说明：
- query: 核心搜索词（可选）
- mimeTypePrefix: 文件类型前缀如 "image/" "application/pdf"（可选）
- createdAfter: ISO 日期字符串（可选）
- createdBefore: ISO 日期字符串（可选）
- minSizeBytes: 数字（可选）
- interpretation: 对查询的中文解释（必填，展示给用户）

今天是 ${new Date().toISOString().split('T')[0]}。`,
    },
    { role: 'user', content: query },
  ],
  maxTokens: 200,
});

// 解析 JSON，执行 filter_files + search_files 双路径
const conditions = JSON.parse(parseResult);
```

**前端展示：** 搜索结果顶部显示解析说明，例如："已理解为：7 天内上传的预算相关文档"，用户可以看到 AI 的理解是否正确，信任感更强。

---

### 9. 分享页面 AI 助手

**为什么：** 分享页目前是纯静态预览，访客只能看不能问。对于长文档、数据报告类文件，访客最需要的恰恰是"这份文件说了什么"——加一个问答框，访客可以直接提问，owner 在创建分享时可以开关此功能。

**Schema 变更：** `shares` 表新增字段：

```sql
ALTER TABLE shares ADD COLUMN ai_chat_enabled INTEGER NOT NULL DEFAULT 0;
```

**后端新增无鉴权端点：**

```typescript
// routes/share.ts — POST /share/:token/ai-chat

// 验证分享 token，检查 ai_chat_enabled = 1
// 权限硬限制：只能访问当前分享文件，不能搜索其他文件
// 使用单文件 RAG 模式（includeFileContent: true，maxFiles: 1）
// 不存 session，无状态

const share = await db.select().from(shares).where(eq(shares.uploadToken, token)).get();
if (!share || !share.aiChatEnabled) return c.json({ error: 'AI chat not enabled' }, 403);

const ragContext = await ragEngine.buildContext({
  query: userMessage,
  userId: share.userId, // 用 owner 的 userId 查文件权限
  maxFiles: 1,
  includeFileContent: true,
  // 强制只查这一个文件
  fileIdFilter: share.fileId,
});
```

**前端变更：**

- `ShareDialog.tsx`：创建分享时新增"允许访客 AI 问答"开关
- `SharePage.tsx`：检测到 `aiChatEnabled` 时展示浮动问答框，右下角，折叠状态默认收起

---

## 长期做（需要基础设施投入）

### 10. 多模态文档解析增强

**为什么：** 当前文本提取是纯 `TextDecoder`，对 PDF/Office 文件只能拿到原始字节，摘要和向量索引质量很差。引入结构化提取后，文档的标题层级、表格、列表都能保留，RAG 效果会有质的提升。

**方案：** 调用已有的 Gotenberg 服务（FileConverter 项目中已部署在 Render）：

1. PDF → HTML（Gotenberg 支持）→ 提取结构化文本
2. Office → PDF → HTML → 提取文本

**改动位置：** `features.ts` → `extractTextFromFile()` 函数，加 mimeType 判断：

```typescript
async function extractTextFromFile(env: Env, file, limit?: number): Promise<string> {
  // 现有：纯 TextDecoder
  // 新增：对 PDF/Office 类型先走 Gotenberg 转换
  if (file.mimeType === 'application/pdf' || file.mimeType?.includes('officedocument')) {
    return extractTextViaGotenberg(env, file, limit);
  }
  // 原有逻辑保留
}
```

---

### 11. 音视频内容感知

**为什么：** `.mp3/.mp4/.wav` 文件当前完全没有 AI 处理——无摘要、无向量索引、无法被搜索。Workers AI 已内置 Whisper 模型，接入成本极低。

**音频转录（可立即实施）：**

```typescript
// features.ts — 新增 generateAudioTranscript()

const transcript = await (env.AI as any).run('@cf/openai/whisper', {
  audio: Array.from(new Uint8Array(audioBuffer)),
});
// transcript.text 即转录文本，走现有 summary + vectorize 流程
```

**视频关键帧（成本较高，建议只做首帧）：** 需要 FFmpeg Wasm，可在 Cloudflare Pages Function 里用 `@ffmpeg/ffmpeg` 提取首帧图片，再走 `analyze_image` 流程。

---

### 12. 扫描件 OCR 索引

**为什么：** 扫描件 PDF 和截图类图片当前只生成视觉标签（"文档/白色/文字"），无法被文本搜索命中。用 `analyze_image` 做 OCR，把识别出的文字存为 `aiSummary` 并进向量索引，这类文件就变得可搜索了。

**判断逻辑：** 在 `autoProcessFile` 里，对 `image/*` 类型文件，如果 `analyze_image` 返回的描述包含大量文字特征（描述里有"文本""数字""表格"等词），自动触发 OCR 模式：

```typescript
// agentTools.ts — analyze_image executor 新增 OCR 提示词

const isLikelyDocument = /文字|文本|数字|表格|段落|标题/.test(existingDescription || '');
const prompt = isLikelyDocument
  ? '请准确转录图片中所有可见的文字内容，保持原有格式和段落结构。'
  : '请详细描述这张图片的内容，包括主体、场景、颜色、风格。';
```

---

### 13. 定时 AI 任务深度集成

**为什么：** 当前 Cron 只做清理工作，AI 任务完全依赖上传触发。时间久了会出现"向量索引过期"问题——文件有了新的 AI 摘要/标签，但向量索引还是旧版本的文本，搜索结果不准。

**两个定时任务：**

```typescript
// cron.ts 新增

// 1. 每周日 4 点：重建 30 天前未更新向量的文件索引
app.post('/cron/refresh-stale-vectors', async (c) => {
  const staleThreshold = new Date(Date.now() - 30 * 86400_000).toISOString();
  const staleFiles = await db
    .select({ id: files.id, userId: files.userId })
    .from(files)
    .where(
      and(
        isNull(files.deletedAt),
        lt(files.vectorIndexedAt, staleThreshold),
        isNotNull(files.aiSummary) // 只重建有摘要的文件
      )
    )
    .limit(200) // 批量上限，避免单次 Cron 超时
    .all();

  // 入队批量重索引
  await env.AI_TASKS_QUEUE.sendBatch(
    staleFiles.map((f) => ({ body: { type: 'index', fileId: f.id, userId: f.userId } }))
  );
});

// 2. 每天 3 点：对有新版本但摘要未更新的文件触发 summary 任务
app.post('/cron/refresh-version-summaries', async (c) => {
  // 查找 aiSummaryAt < updatedAt 的文件
  const outdated = await db
    .select({ id: files.id, userId: files.userId })
    .from(files)
    .where(
      and(
        isNull(files.deletedAt),
        isNotNull(files.aiSummary)
        // aiSummaryAt 早于 updatedAt 超过 1 小时（避免刚上传的文件重复处理）
      )
    )
    .limit(100)
    .all();
});
```

**`wrangler.toml` 更新：**

```toml
[triggers]
crons = [
  "0 2 * * *",   # 垃圾清理
  "0 3 * * 1",   # AI 洞察（方案6）
  "0 3 * * *",   # 摘要刷新（方案13）
  "0 4 * * 0",   # 向量重建（方案13）
]
```

---

## 改动文件汇总

| 文件                                                    | 方案          | 改动类型                      |
| ------------------------------------------------------- | ------------- | ----------------------------- |
| `lib/ai/agentTools.ts`                                  | 1、7          | 新增工具定义 + executor       |
| `lib/ai/ragEngine.ts`                                   | 2、5          | 偏好注入、意图分类            |
| `lib/ai/agentEngine.ts`                                 | 已完成        | 视觉意图门控                  |
| `lib/ai/features.ts`                                    | 3、10、11、12 | 版本摘要、文档解析、音频、OCR |
| `lib/vectorIndex.ts`                                    | 7、13         | 关系图构建、增量重建          |
| `lib/aiTaskQueue.ts`                                    | 3、4          | 新增任务类型、Webhook 触发    |
| `lib/webhook.ts`                                        | 4             | 新增 AI 事件类型              |
| `lib/notificationUtils.ts`                              | 6             | 新增 `ai_insight` 类型        |
| `routes/search.ts`                                      | 8             | 自然语言搜索端点              |
| `routes/share.ts`                                       | 9             | 分享页 AI 问答端点            |
| `routes/cron.ts`                                        | 6、13         | 洞察扫描、向量刷新            |
| `db/schema.ts`                                          | 3、7、9       | 新增字段和表                  |
| `migrations/`                                           | 3、7、9       | SQL 迁移文件                  |
| `apps/web/src/pages/AISettings.tsx`                     | 4             | Webhook 事件列表              |
| `apps/web/src/pages/SharePage.tsx`                      | 9             | 分享页问答框                  |
| `apps/web/src/components/files/dialogs/ShareDialog.tsx` | 9             | 创建分享开关                  |
