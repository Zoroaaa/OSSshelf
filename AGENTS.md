# AGENTS.md — OSSshelf 协作规范

面向在本仓库工作的 AI coding agent。开始改代码前读完；**用户当次指令与本文件冲突时，以用户指令为准**。

只写「读代码看不出来」的内容：精确命令、目录边界、必须遵守的约束、踩过的坑。
流程：定位目录 → 核对第 3 节约束 → 最小改动 → 按第 9 节验证 → 汇报改动与未验证项。

## 1. 项目与命令

OSSshelf v3.2.0：Cloudflare 上的多厂商 OSS 文件管理系统（文件 / 预览 / 分享 / WebDAV / 团队协作 / AI Agent）。
React 19 + Vite 6 + Tailwind 3 + TanStack Query 5 + Zustand 4；Hono 4 on Workers；D1 + Drizzle；KV + Vectorize + Queues；Agents SDK（DO）。
**一个 Worker 同时承载 API、WebDAV、Agent WebSocket 与前端静态资源**，没有独立前端站点。

命令都在根目录执行；依赖只在根目录 `pnpm install`，子目录单独装会破坏 workspace 软链。

```bash
pnpm dev:setup                                                # 首次/换机：Node 检查 + .dev.vars + shared 构建 + 本地 D1 迁移（幂等）
pnpm dev:api                                                  # wrangler dev，http://127.0.0.1:8787
pnpm dev:web                                                  # vite，http://127.0.0.1:3000（代理 /api /dav /agents）
pnpm smoke                                                    # 关键链路冒烟，需上面两个服务在跑
pnpm audit:gate                                               # 生产依赖 high/critical 审计门禁（CI 部署前强制，豁免见 scripts/audit-exemptions.json）

pnpm typecheck                                                # 三包递归 tsc --noEmit
pnpm test                                                     # 全仓 vitest（api / web / shared）
pnpm --filter web test                                        # 单包测试（api / shared 同理换 filter）
pnpm --filter api exec vitest run src/lib/pathUtils.test.ts   # 单文件
pnpm build:web                                                # shared build → tsc → vite build
pnpm lint                                                     # 根 eslint（基线见第 9 节）
pnpm db:migrate:local                                         # 本地 D1 应用迁移
```

`db:migrate`（`--remote`）、`deploy:api`、`wrangler deploy` 是发布动作，agent 不执行（见第 10 节）。

## 2. 仓库地图

| 路径                                   | 职责                                         | 边界                                                  |
| -------------------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `apps/api/src/index.ts`                | 中间件、子应用注册、Cron、队列               | 新路由文件必须在此登记（3.2）                         |
| `apps/api/src/routes`                  | HTTP：鉴权、zod 校验、响应                   | 不写跨模块长事务，不内联 S3 / provider 细节           |
| `apps/api/src/lib/*Service.ts`         | 业务编排：文件、分享、权限、团队、版本、笔记 | 不返回 HTTP 响应                                      |
| `apps/api/src/lib/ai`                  | Agent 运行时、工具、检索、模型、用量         | 模型调用只走 `modelRuntime.ts`                        |
| `apps/api/src/agents`                  | `OSSShelfAgent`（Durable Object）、WS 鉴权   | DO 类名与迁移 tag 上线后不可改                        |
| `apps/api/src/db`                      | Drizzle schema 与连接                        | 只做类型推导，不是建表依据（3.5）                     |
| `apps/api/migrations`                  | SQL 迁移，**表结构唯一事实源**               | 只增编号，不改已执行文件                              |
| `apps/web/src/{pages,components}`      | 页面与业务组件                               | 请求走 hooks/services；`components/ui` 保持无业务耦合 |
| `apps/web/src/{hooks,services,stores}` | 数据编排、API 封装、客户端状态               | 服务端数据进 TanStack Query，不进 store               |
| `packages/shared`                      | 错误码、MIME、logger、共享类型               | 改这里等于改契约，前后端都要 typecheck                |
| `mobile/`                              | Capacitor Android 壳（加载已部署站点）        | **独立用 npm**（自带 package-lock.json），不进 pnpm workspace；不要在根目录 pnpm install 它 |

## 3. 硬约束

每条都对应过线上或联调问题；`→` 后面是违反后的现象。

### 3.1 一个 Worker 承载全部流量

`wrangler.toml` 的 `run_worker_first` 必须同时写裸路径与通配符（`/api` 和 `/api/*`）。
新增后端顶层前缀漏写 → 请求被 SPA 回退成 `index.html`，前端 `JSON.parse` 报错，离真实原因很远。
本地手动部署前先 `pnpm build:web`：`deploy:api` 只构建 shared 再 `wrangler deploy`，不重建 `web/dist`。

### 3.2 子应用必须安装错误处理

`index.ts` 里 `for (const subApp of subApps) installErrorHandler(subApp)`。
新增 `routes/*.ts` 没加进 `subApps` → `AppError` 被子应用的独立 `onError` 吞成纯文本 500，错误码与 HTTP 状态全丢。

### 3.3 错误码要取 `.code`

`ERROR_CODES` 是 `as const satisfies Record<string, ErrorInfo>`，键集合即 `ErrorCode` 联合类型。

- 抛错用 `throwAppError('FILE_NOT_FOUND')`，不要 `return c.json({ error })` 自造结构。
- 取值用 `ERROR_CODES.X.code`；写成 `code: ERROR_CODES.X` 会把整个对象塞进响应。
- 改码表后跑 `apps/api/src/lib/errorCodes.test.ts`（静态守卫）。

### 3.4 响应结构

标准成功：`{ success: true, data, pagination? }`；标准失败：`{ success: false, error: { code, name, message, requestId, timestamp } }`，后者只由 `middleware/error.ts` 产出。

- 失败一律 `throwAppError(key, message)` 或 `new AppError(key, { message, details })`；**禁止手写 `c.json({ success: false })`**（2026-11-22 已清空存量 349 处）。
- `catch` 块内可以直接 throw；**`try` 主体内**先在该 catch 首行加 `if (e instanceof AppError) throw e;`，否则业务状态码会被本地 catch 改写。
- 新增错误码必须进 `packages/shared` 的 `ERROR_CODES`，遵守 `[模块][序号]`（A/B/F/G/I/K/M/N/P/S/T/TG/TM/U/V/W/X）；`code` 与 `httpStatus` 一旦发布不要改，前端可能比较字符串。
- 前端比较错误码必须用 `ERROR_CODES.X.code`，不要写字面量。

背景与逐条判定见 `docs/audits/2026-11-22-error-response-audit.md`。

### 3.5 SQL 迁移是唯一事实源

表结构看 `migrations/*.sql`，`schema.ts` 只做类型推导。禁止用 `drizzle-kit generate` 覆盖 migrations。
编号只增不改，当前最大 119，下一个 120。远程迁移由 CI 执行，agent 只写文件与本地验证。

### 3.6 shared 必须先构建

`@osshelf/shared` 的 exports 指向 `dist`；改完不 build → 「代码改了没生效」或运行时仍是旧常量。
`build:web` / `deploy:api` 已内置该步骤；单独跑 api 时自己先 build。

### 3.7 存储与密钥

- 桶在应用内配置，走 `lib/bucketResolver.ts` 的 `resolveBucketConfig`；不硬编码桶名、endpoint、密钥。
- `wrangler.toml` 里被注释的 `[[r2_buckets]]` 是历史遗留，不要为了「跑通」而解注释。
- 删对象走 `lib/storageGC.ts`（`deleteObjectSafely` / `processDeletionQueue`），不要自己拼 S3 DeleteObject。
- 密钥只在 Worker Secrets 与 `apps/api/.dev.vars`；不读、不写、不提交。

## 4. 后端

- 路由顺序：`authMiddleware` → `requireApiKeyScope` / `requireAdmin` → zod → service → `c.json`。纯读取可在路由内 `db.select`；多步写入、跨表一致性、审计、配额、通知下沉到 `lib/*Service.ts`。
- 文件级权限走 `lib/permissionResolver.ts`（`read | write | admin`）；改角色、权限模型、团队挂载关系后必须调 `invalidatePermissionCache`，否则缓存继续放行旧权限。按 id 取文件一律显式校验归属。
- 删除是软删（`deletedAt`），回收站由 `TRASH_RETENTION_DAYS`（30 天）控制，Cron `0 3 * * *` 跑 `lib/cleanup.ts`；不要在请求链路做全量清理。
- 同目录重名冲突经 `lib/dbErrors.ts` 映射 409，不要吞成 500。
- 日志统一 `logger`（`@osshelf/shared`）带模块上下文；不新增裸 `console.*`。
- 外部调用要区分「网络 / 超时 / 限流」与「资源不存在」，不要把超时当 404。
- D1 有绑定参数上限，批量写入 / 删除必须分批（沿用现有阈值，不要放大）。

## 5. 前端

- 服务端数据一律 TanStack Query（`staleTime` 5min、`retry: 1`）；HTTP 只走 `services/*`（`api-client.ts` 注 Bearer、401 登出）；Zustand 只放 `auth` / `files` / `theme`。
- **弹窗**必须用 `components/ui/AppDialog.tsx`（Radix：Portal、焦点陷阱、Escape、滚动锁、aria），移动端用 `MobileDialog`；禁止手写 `fixed inset-0`。
- **层级**只用语义 token：`z-dropdown` 25 / `z-assistant` 30 / `z-sticky` 40 / `z-overlay` 50 / `z-popover` 60 / `z-toast` 70 / `z-system` 80。禁止新增 `z-[999]` 或 `z-60`（后者是无效类）。存量数字不必一次清完，改到哪个弹窗顺手迁。
- 需要「有弹窗时隐藏」的浮层订阅 `lib/dialogStack.ts`，不要用 MutationObserver 或某个 class 当信号。
- 确认用 `confirmAction({ level, title, impact })`：`critical` 必须给 `impact`，强确认传 `requireInput`。禁止 `window.confirm` / `alert`。
- 异步三态用 `AsyncState.tsx` 的 `LoadingState` / `EmptyState` / `ErrorState`；渲染用户内容用 `SafeMarkdown`，不对不可信内容用 `dangerouslySetInnerHTML`。
- hover-only 按钮必须加 `touch-visible`，触控目标 ≥ `touch-target`（44px）。
- 断点统一 `lg`（1024px），不要同一元素混用 `md:` 与 `lg:`；页面主体用 `.app-main`，不硬编码 `pt-16 pb-20`。
- 颜色用 `hsl(var(--*))` 语义色，不写死十六进制；不用 `overflow: hidden` 掩盖溢出。
- 文案直接写中文（无 i18n），术语与周边一致；错误提示不暴露堆栈与内部码。

## 6. AI / Agent

改 `apps/api/src/{agents,lib/ai}` 前先读 `docs/AI_FEATURES.md`。

- 会话在 `OSSShelfAgent`（`AIChatAgent` DO），每会话一个 DO；DO 迁移 tag 上线后不可改或复用。
- 模型调用只走 `lib/ai/modelRuntime.ts`（provider + 配额 + 用量），不直连 `@ai-sdk/*` 或 Workers AI。
- 工具在 `lib/ai/agentTools/*`，经 `index.ts` 聚合、`toolAdapter.ts` 分发；新增要补 `TOOL_DEFINITIONS`、执行分支和 `tools.test.ts`。
- 用量写 `ai_usage_events`；改配额、限流、计费要同步前端用量页。
- 索引：`file_chunks`（FTS5）+ Vectorize，批量任务进 `AI_TASKS_QUEUE`（一条消息一个文件，保持幂等可续跑）。
- 改召回、rerank、提示词要说明对延迟、token 成本与配额的影响。

## 7. 数据库迁移

1. 新建 `apps/api/migrations/<下一个编号>_<snake_case>.sql`（`010` / `020` / … / `110` 为模块块，块内递增；写文件前 `ls apps/api/migrations` 确认当前最大编号，当前下一个是 **122**）。
2. 同步修改 `src/db/schema.ts`。
3. `pnpm db:migrate:local` 验证。
4. 新表或新关系更新 `docs/architecture.md` 数据模型。
5. 不执行远程迁移、不改 CI：生产由 `deploy-api.yml` 跑 preflight + `d1 migrations apply --remote`。

硬规则：已执行的迁移不改、不改名、不重排、不复用编号；迁移尽量 `IF NOT EXISTS` 并考虑存量回填；线上「手工执行过但未记录」按 `docs/runbooks/d1-112-repair.md` 修，不要删 `d1_migrations`。

## 8. 注释与文档

注释解释**为什么、有什么约束、哪里容易踩坑**，「做了什么」交给代码。

- 新增文件头部：`/** 文件名 — 职责 */` + 2–4 行关键约束。
- 必须注释：魔数 / 阈值 / 时间窗口、外部系统怪癖（S3 兼容、Telegram 分片、WebDAV 客户端）、兼容逻辑与移除条件、并发 / 缓存 / 权限约束。
- 分区线单行 `// ── 上传 ─────`，不逐函数加。
- 禁止：复述代码、留着注释掉的旧代码、无归属的 `// TODO`（写成 `// TODO(模块): 原因 + 触发条件`）。
- 注释与实现不一致时以代码为准，立刻改或删。

文档同步（同一次改动内完成）：

| 改了什么                  | 同步到                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| 表 / 字段 / 索引          | 迁移文件 + `docs/architecture.md`                                                                |
| API 模块或对外契约        | `docs/api.md`；新增对外接口必须补 `routes/docs.ts` 的 `routeMetadata`，否则 `/api/docs` 里看不到 |
| 部署 / 绑定 / 环境变量    | `docs/deployment.md` + `wrangler.toml`                                                           |
| AI 能力 / 配额 / 模型接入 | `docs/AI_FEATURES.md`                                                                            |
| 发版                      | `CHANGELOG.md` + 根 / api / web 三处 `version`（平时不改）                                       |

## 9. 验证

| 改动范围             | 命令                                 |
| -------------------- | ------------------------------------ |
| 任何 TS              | `pnpm typecheck`                     |
| `apps/api/**`        | 追加 `pnpm --filter api test`                                    |
| `apps/web/**`        | 追加 `pnpm --filter web test`；UI 产物改动加 `pnpm build:web`     |
| `packages/shared/**` | 追加 `pnpm --filter @osshelf/shared test`；改产物先 build 再 typecheck |
| UI / 交互            | 起两个服务实点，覆盖 375px 与 1024px |

- 测试失败先找根因；不允许删、跳、弱化测试或改断言。
- 没验证的（真实桶、模型 key、线上 D1）在汇报里写「未验证 + 原因」。
- web 测试栈已固定为 vitest + jsdom + @testing-library/react（`vitest.config.ts` 用 mergeConfig 复用 vite 的 alias）；不要引入 jest 等第二套框架。`dialogStack` 是模块单例，跨用例共享，测试需固定 id 并 afterEach 清理。
- lint 基线不通过（`--max-warnings 0` + 历史 `any` / 非空断言）。不要批量修绿或加 disable，只保证改动文件不新增问题。
- UI 验证用 Chrome headless，每次换新的 `--user-data-dir`，否则 Service Worker 会返回旧模块。

## 10. Git 与禁区

- 提交信息 `fix(files): 修复…`（Conventional Commits + 中文），一个提交一个目的。
- 用户没要求就不 commit / push / 建分支；强推只能 `--force-with-lease`。
- 不提交 `.dev.vars`、`.env*`、`dist/`、`.wrangler/`、`*.tsbuildinfo`、`.workbuddy/`。
- 不执行部署与远程迁移；不改 `wrangler.toml` 的 name / 绑定 / DO tag / Cron；不改 `.github/workflows` 部署链路。
- 不顺手重构、不批量格式化、不改无关命名；发现风险先报告。

## 11. 维护本文件

只写代码里看不出来的东西。新增顶层目录或包、部署 / 迁移步骤变化、同一个坑被踩第二次时更新。
子包规则变多时加 `apps/api/AGENTS.md` / `apps/web/AGENTS.md`：**最近的优先**，冲突以子包为准，用户指令最高。
能自动化的（ESLint、守卫测试、CI）优先自动化，不靠文档约束。
