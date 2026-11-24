# OSSshelf 全面审计与升级方案（2026-11-23）

- 代码基线：`8009853`（test: 为 shared 与 web 补齐 vitest 测试框架）
- 审计方式：只读静态走读 + `pnpm audit --json`（1063 个依赖）+ 实测 `pnpm lint` + 对照 `docs/audits/2026-11-09-full-audit.md` 逐项复核
- 性质：只审计与出方案，未修改业务代码、未提交、未部署
- 与既有审计的关系：**本报告是 11-09 全量审计的"结算 + 增量版"**。先确认哪些已修（避免重复投入），再列出存量遗留与本次新发现。

---

## 0. 一句话结论

11-09 审计暴露的 **全部 12 个 P0（数据双计、去重误删、API Key 提权、WS 绕过配额等）已确认修复**，当前风险重心转移到三处：**① 运行时依赖的高危 CVE 链（hono / drizzle-orm / axios / xlsx / epubjs→xmldom，共 8 项 high+）；② Service Worker 缓存错配（鉴权响应入缓存、登出不清、cacheFirst 分支不可达）造成的跨账号数据泄露面；③ 质量门禁薄弱（lint 基线 785 个问题且单次跑 11 分钟、web 测试仅 1 个文件、CI 无依赖审计步骤）**。建议按本文第四节四阶段推进：Phase 0 依赖热修当周可发，Phase 1 前端重依赖重组，Phase 2 drizzle 升级 + 测试补齐，Phase 3 工具链现代化。

---

## 1. 审计方法与证据来源

| 手段 | 覆盖 | 关键产出 |
|---|---|---|
| 静态走读 + 定向 grep | apps/api、apps/web、packages/shared、migrations、wrangler.toml、CI | 逐项核对 11-09 审计 P0/P1 现状（见第 2 节证据列） |
| `pnpm audit --json` | 1063 个依赖，177 条通告（1 critical / 68 high / 96 moderate / 12 low） | 第 3.6 节依赖决策表（已按 runtime / dev-only 分层） |
| 实测 `pnpm lint` | 全仓 eslint（`--max-warnings 0`） | **785 个问题（44 error / 741 warning），本机耗时 11 分 18 秒** |
| CI / 配置核对 | `.github/workflows/deploy-api.yml`、`wrangler.toml`、`vite.config.ts`、`sw.js` | 门禁缺口清单 |

未覆盖（与 11-09 审计相同）：真实 D1 执行计划、Workers 运行时内存/Queue 重投实测、渗透级验证。这些仍需运行时复现，不在静态结论之列。

---

## 2. 11-09 审计修复确认（已修，勿重复投入）

以下结论均为**逐项在当前代码中核对过**，不是凭提交信息推断。

### 2.1 P0 级（12/12 已修）

| 编号 | 问题 | 现状 | 证据 |
|---|---|---|---|
| P0-01 | 存储统计双重记账（触发器+应用层） | ✅ 已修 | `114_storage_accounting.sql` 重写触发器为唯一记账源并全量重算；`files.ts:599`、`fileService.ts:512` 注释确认手动记账已移除 |
| P0-02 | 去重引用计数错误→误删共享对象 | ✅ 已修 | `lib/dedup.ts` 重写：按 `r2_key` 聚合判断引用，`ref_count` 降级为兼容字段；`checkAndClaimDedup` 改纯 SELECT |
| P0-03 | API Key scopes 未生效 + 自签发提权链 | ✅ 已修 | `requireApiKeyScope` 已接入 14 个路由文件；`apiKeys.ts` 挂 `denyApiKeyAuth()`；`api_keys:read` 仅管理员可授 |
| P0-04/05 | 团队挂载越权 / 权限申请自批 | ✅ 已修（随安全整改落地） | 提交 `25714c9 落地全量安全审计整改`，权限判定收敛至 `permissionResolver` |
| P0-06 | AI 全局配置无管理员校验 | ✅ 已修 | `aiConfigRoutes.ts` 引入 `requireAdmin`（grep 确认） |
| P0-07 | WS 聊天完全绕过配额与限流 | ✅ 已修 | `OSSShelfAgent.ts:317` 每条消息 `reserveAiQuota` 原子预扣 → `settle`/`release` 结算 |
| P0-08 | 中断回答记 0 token | ✅ 已修 | abort 分支按 `inputTokensEstimate + partialOutputTokens` 部分结算（`OSSShelfAgent.ts:592`） |
| P0-09 | 前端上传按钮恒定禁用 | ✅ 已修（随 11-09 方案落地） | 权限字段与 `canWrite` 判断已接入 |
| P0-10 | 星标空结果契约不一致→白屏 | ✅ 已修 | `files.ts:711-716` 空结果返回 `data: []` + `pagination` |
| P0-11 | 团队上传丢 teamId | ✅ 已修 | `presignUpload.ts` 全链路（single/parts/proxy）透传 `teamId`（131/176/192/214/255 行） |
| P0-12 | 摘要/标签工具伪实现 | ✅ 已修 | `content.ts:644-660` 真实 `createTaskRecord` + `enqueueAiTasks` 入队，返回 taskId |

### 2.2 P1/P2 级（核对确认已修的重点项）

| 问题 | 证据 |
|---|---|
| renameFile 不级联子项 path、无重名校验 | `fileService.ts:379+`：重名检查（按 owner+team 命名空间）+ `buildDescendantPathUpdate` + `db.batch` + 冲突映射 409 |
| 预览 `Cache-Control: public`、MIME 嗅探 | `files.ts:187-188`：`private, no-store` + `X-Content-Type-Options: nosniff` |
| URL 下载 SSRF / 伪造 Content-Length | `downloads.ts:142` `redirect:'manual'` + 重定向逐跳 `isPrivateUrl` 复检 |
| provider 允许 `http://` | `providerService.ts:154-158`：`normalizeBaseUrl` 强制 https + 私网黑名单 |
| 分享口令明文入库 / 无尝试限流 / query 传参 | `shareService.ts` 全部 `hashPassword`；`share.ts:1363` 基于 `loginAttempts` 的尝试限流；`collab.ts:96-102` 改 POST body |
| `/cron/*` 无鉴权 | `cron.ts:23-24`：`authMiddleware` + `requireAdmin` |
| 两套清理实现漂移 | `cleanup.ts:34,37` 复用 `releaseFileRef` + `storageGC`（`deleteObjectSafely`） |
| `TRASH_RETENTION_DAYS` 被忽略 | `env.ts:75` `getEnvNumber(env, 'TRASH_RETENTION_DAYS', 30)` |
| `JWT_SECRET` 写入 CI vars | 已改 `wrangler secret put`（`deploy-api.yml` 注释确认跨部署持久） |
| CORS 缺 `X-API-Key` / 生产 sourcemap / 版本号漂移 | `index.ts:98`；`vite.config.ts:35` 默认关 sourcemap；`index.ts:183` 用 `APP_VERSION` 常量 |
| 迁移非幂等 + CI 不 apply | `deploy-api.yml`：preflight（`preflight-migrations.mjs`）→ `d1 migrations apply --remote` → Deploy Hook 串行 |
| SW install `cache.addAll` 全有或全无 | `sw.js:32-38` 逐资源 `cache.add().catch()` |
| 手写错误响应 349 处 | 已收敛至 **10 处**（仅 `share.ts`、`teams.ts` 残留，grep 实测） |
| 搜索建议竞态 | `useFileSearch.ts:37-38` debounce + AbortController |
| `ai_memories` 缺索引 | `116_ai_memories_session_index.sql` 建 `idx_memories_session` |

**结论：11-09 审计的止损阶段已基本完成，且质量不错——修复都不是补丁式的（如配额改成 reserve/settle 两阶段、去重改成对象级计数）。**

---

## 3. 存量遗留与新发现

### 3.1 安全（S）

| 编号 | 级别 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| S1 | **P1** | SW 缓存三重错配：① `networkFirst: ['/api/']` 排在 `cacheFirst` 之前，预览/缩略图的 cacheFirst 分支**不可达**（每次都走网络）；② 鉴权响应（`/api/user`、`/api/buckets`）仍写入 DYNAMIC 缓存；③ logout 不清任何 cache。同设备换账号/离线时可能读到上一账号数据 | `sw.js:22-25, 98-105`；`stores/auth.ts` 无任何 cache 清理代码 | `/api` 一律直接放行（不进 SW），仅保留 SPA 导航与静态资源策略；`logout()` 清空全部 cache storage；验收：换账号后 `caches.match('/api/user')` 无旧数据 |
| S2 | P2 | `ALERT_TG_CHAT_ID`、`CF_ACCOUNT_ID` 明文写在 `wrangler.toml`（chat_id 属轻度敏感，泄露可给告警号发垃圾消息） | `wrangler.toml:76-79` | chat_id 迁到 Secret（与 `ALERT_TG_BOT_TOKEN` 同处维护）；账户 ID 可保留 |
| S3 | P2 | API Key 创建/删除/改 scope 无审计日志（scopes 强制已到位，但操作轨迹缺失） | `apiKeys.ts` 无 `audit_logs` 写入 | 三处写操作补 `audit_logs`，管理页可查 |
| S4 | P3 | API Key 无法按 scope 细粒度过期轮换提醒 | — | 可选：管理页展示"最近使用时间"，超期未用提醒作废 |

### 3.2 数据正确性（D）

| 编号 | 级别 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| D1 | P1 | 存储对账机制已有（`storageReconciliation.test.ts`、管理端明细），但**没有定期自动执行**——触发器 `MAX(0,...)` 只防负数，不纠偏漂移 | cron 仅 `0 3 * * *` 跑回收站清理 | 每日 cron 增加对账任务：`sum(files.size)` vs `users.storage_used`、桶侧同口径，偏差超阈值发 Telegram 告警（复用现有 alert 通道） |
| D2 | P2 | 删除会话/文件后 `ai_task_items`、`ai_memories`、`file_chunks` 残留正文与向量（无 FK，靠应用层清理，异常时残留） | 11-09 P2-3 未修；`091/116` 只补了索引 | 清理链路统一走一个 `cascadePurge(env, kind, id)` 入口；或加低频 cron 扫孤儿 |
| D3 | P2 | `file_versions` 引用的旧 r2Key 回收规则未与 dedup 主链路对齐（版本表独立引用对象，删除文件时版本对象的判定路径需复核） | `files.ts:1977` 注释声明"只在 r2_key 无其它引用时调用"，但版本表是否计入引用无显式测试 | 补一条集成测试：删除带 3 个版本且其中 1 个去重共享的文件 → 对象存活判定正确 |
| D4 | P2 | schema 与迁移的漂移目前靠注释声明（`schema.ts:774` 明确记录 ai_config 历史手工重建），但**没有防回归的自动校验** | `120/121` 为数据迁移无表变更（已核实），存量漂移已文档化 | 增加 schema-drift 守卫测试：解析 migrations 全量建表 DDL 与 `schema.ts` 声明的表/列名集合做 diff，不一致即 fail（写一次，永久防 `drizzle-kit generate` 事故） |

### 3.3 质量门禁（Q）

| 编号 | 级别 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| Q1 | **P1** | lint 基线失败：**785 problems（44 error / 741 warning）**，`--max-warnings 0` 下永远过不了；且本机全量跑 **11 分 18 秒**（eslint 8 + type-aware lint + Windows），慢到没人会本地跑 | 实测输出；AGENTS.md §9 自己也承认"基线不通过" | 双轨治理：① CI 引入 **baseline 冻结**（如 `eslint-baseline` 或按文件豁免清单生成工具），只拦"新增问题"，存量按文件逐步清；② Phase 3 升 ESLint 9 + typescript-eslint 8（flat config + `projectService`，速度可提升数倍）。两件事分开做，不要绑在同一个 PR |
| Q2 | **P1** | web 侧测试仅 **1 个文件**（dialogStack）；api 侧 20 个测试集中在 lib/ai 与工具函数，**routes 与核心 service 层（fileService/permissionResolver/shareService/dedup/bucketResolver）接近零覆盖** | `find -name "*.test.*"` 共 23 个 | 按"改哪补哪"原则优先补四个域：dedup 删除链、permissionResolver 角色/继承、shareService 密码+限额、bucketResolver 记账。每个域至少 1 happy path + 1 边界 |
| Q3 | **P1** | CI 无任何依赖审计步骤，177 条通告处于无人值守状态 | `deploy-api.yml` 无 audit 步骤 | 加 `pnpm audit --prod --audit-level high`（runtime 依赖）作为部署前门禁 + 配置 Renovate/Dependabot 周更 PR；dev-only 通告不阻塞但出周报 |
| Q4 | P2 | smoke 仅本地手动；无 E2E | `scripts/smoke-test.mjs` | Phase 3 引入 Playwright 最小集（登录/上传/下载/分享/权限拒绝 5 条链路），PR 手动触发即可，不必每 push |
| Q5 | P2 | 无 coverage 阈值与报告 | vitest 未配 coverage | api 侧先开 `--coverage` 出报告不设阈值，Phase 2 结束后按实际基线定阈值 |

### 3.4 性能与体验（P）

| 编号 | 级别 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| P1 | **P1** | FilePreview 静态引入全部 11 个预览器及其重依赖（pdfjs-dist、xlsx、pptx-preview→echarts、epubjs→@xmldom/xmldom+lodash、opentype.js、jszip、x-data-spreadsheet），全部进入 `/files` 相关 chunk | `FilePreview.tsx:56-67` 全静态 import；grep 确认 xlsx 仅 OfficePreview 引用 | 预览器全部改 `React.lazy` 按 mimeType 动态加载（页面级懒加载已做，此为最后一层）；配合 `manualChunks`（已有）按预览器分 chunk。**此项同时是 V2/V3 两个 CVE 重灾区的止血手段**，收益双重 |
| P2 | P2 | 多文件上传无并发上限（11-09 #38 未修），且逐文件 `invalidateQueries(['files'])` | `presignUpload.ts`/`Files.tsx` 无 concurrency 标记；`useFolderUpload.ts` | 2–3 并发队列 + 批次结束统一失效一次 |
| P3 | P2 | 前端下载仍 fetch→blob（大文件内存翻倍）；后端流式已就绪 | 11-09 #24；后端 `streamUtils`/流式传输已落地 | 小文件走 blob（保留进度），超阈值（如 >50MB）走直链/`a[download]` |
| P4 | P3 | SW 缓存错配导致预览/缩略图缓存策略失效→重复拉取 | 同 S1 | S1 修复顺带解决 |

### 3.5 架构治理（G）

| 编号 | 级别 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| G1 | **P1** | AGENTS.md 自身漂移四处：① 迁移"下一个编号 120"（实际 121 已存在，**下一个是 122**）；② 仓库地图缺 `mobile/`；③ §10 自己规定"不提交 `*.tsbuildinfo`"，但 `apps/web/tsconfig.tsbuildinfo` 已被跟踪且处于修改状态；④ 根目录 `lint_output.txt`、`2026-11-11/` 工作产物入库 | `git ls-files` 实测 | 一次提交收口：`git rm --cached apps/web/tsconfig.tsbuildinfo lint_output.txt`；`2026-11-11/` 移入 `docs/plans/`；补 mobile/ 行；迁移号改 122 |
| G2 | P2 | `mobile/`（Capacitor Android 壳）使用 npm 独立 `package-lock.json`，与"依赖只在根目录 pnpm install"的 workspace 规则未声明边界 | `mobile/package-lock.json` 存在；AGENTS.md 无 mobile 条目 | 二选一：明确 mobile 独立用 npm（AGENTS.md 写清楚"mobile 不进 workspace"），或迁 pnpm。倾向前者（Capacitor 生态对 npm 更友好） |
| G3 | P2 | 错误响应迁移收尾：`share.ts`/`teams.ts` 剩 10 处手写；11-22 审计 §2 列出的 13 处"状态码与码表不一致"与 3 处 `CONFLICT` 返回 200 需逐条确认清零 | grep 实测；`2026-11-22-error-response-audit.md` | 一次性收尾 PR，全部 `throwAppError` 化，`errorContract.test.ts` 加对应断言 |
| G4 | P3 | shared 类型漂移收尾（`FilePermission` 缺字段、`DownloadTask` 语义混乱） | 11-09 P2-15 | 随 Phase 2 类型对齐 PR 处理 |
| G5 | — | 已建立的治理机制确认有效：`docs.metadata.test.ts`（文档元数据守卫）、`errorCodes.test.ts`（码表静态守卫）、`preflight-migrations.mjs`（迁移预检）、d1-112-repair runbook | — | 保持，勿删 |

### 3.6 依赖升级决策（V）

`pnpm audit` 共 177 条通告。**绝大多数（undici/js-yaml/nanoid/postcss/esbuild/browserslist 等）来自构建工具链（vite/wrangler/eslint/miniflare），不影响线上运行时**。下表只列 runtime 影响 + 需要决策的：

| 包 | 当前 | 通告 | 目标 | 决策 | 阶段 |
|---|---|---|---|---|---|
| **hono**（api runtime） | 4.12.8 | high `CVE-2026-54290` + moderate ×2（`validator('form')` 校验绕过等） | ≥4.13.16 | **立即升**。`^4.0.0` 改 lockfile 级升级即可，无破坏面 | Phase 0 |
| **axios**（web runtime） | 1.13.6 | high ×4（`CVE-2026-42043/42033/42035/42264`）+ moderate 数条；连带 `form-data` high | ≥1.20.0 | **立即升**（axios 1.x 内无破坏性变更） | Phase 0 |
| **react-router-dom**（web runtime） | 6.30.3 | moderate `CVE-2026-53668` | ≥6.30.6 | **立即升**到 6.30.6；7.x 迁移（含 data router）单独立项，不混入安全升级 | Phase 0 / 7.x 另立项 |
| **katex**（web runtime） | 0.16.40 | low `CVE-2026-103923` | ≥0.18.2 | 立即升（渲染 API 兼容，回归数学公式预览即可） | Phase 0 |
| **@xmldom/xmldom**（经 epubjs，web runtime） | 0.7.13 | **high ×4**（`CVE-2026-34601/41673/41674/41675` + moderate ×2） | ≥0.8.15 | epubjs 0.3.93 锁死 0.7.13 → 用 `pnpm.overrides` 强制 ≥0.8.15 并回归 epub 预览；长期评估替换 epubjs | Phase 0（overrides） |
| **lodash**（经 epubjs/pptx-preview，web runtime） | 4.17.23 | high `CVE-2026-4800` + moderate `CVE-2026-2950` | ≥4.18.1 | 同上 `pnpm.overrides`；随 V3 替换预览器时自然消失 | Phase 0（overrides） |
| **drizzle-orm**（api runtime） | 0.29.5 | **high `CVE-2026-39356`**（修复需 ≥0.45.2，跨度 16 个 minor） | ≥0.45.2 | **专项升级**：0.30+ 有 API 变化（`db.batch` 行为、类型推导收紧），需全量 typecheck + 本地迁移 + EXPLAIN 回归 + 回滚预案。唯一一个"必须动大刀"的 runtime 依赖 | **Phase 2** |
| **xlsx**（web runtime，OfficePreview） | 0.18.5 | **high ×2：`CVE-2023-30533`（原型污染）、`CVE-2024-22363`（ReDoS）；npm 上 `patched_versions: <0.0.0`——官方已不在 npm 发布，无补丁** | 无 npm 补丁 | **决策项**：a) 首选——改用 SheetJS 官方 CDN 自托管 0.20.2+（vendor 进仓库）；b) 换 exceljs（体积大，配合懒加载可接受）；c) 若预览场景可接受降级能力，评估直接移除。三选一在 Phase 1 定，与 P1 懒加载一起做 | Phase 1 |
| **x-data-spreadsheet**（web runtime） | 1.1.9 | moderate `CVE-2022-25646` 无补丁；且把 `opencollective→inquirer→tmp` 整条 junk 链拖进安装树 | 无补丁 | **替换或移除**（csv/xlsx 预览可用简单表格渲染替代） | Phase 1 |
| **pptx-preview**（web runtime） | 1.0.7 | 连带 echarts 5.6.0（moderate `CVE-2026-45249`）+ lodash 进 bundle | — | 评估替换或保留+懒加载（echarts 仅在预览 pptx 时加载） | Phase 1 |
| 工具链：eslint 8.57 / ts-eslint 7 / pnpm 8.15 / vite 6.4 | — | eslint 8 已 EOL；多条 moderate 属 dev 链 | eslint 9 + ts-eslint 8 + pnpm 10 + vite 7 | 与 Q1 的提速治理合并执行；CI 的 pnpm pin 同步 | Phase 3 |
| **zod** | 4.6.7 | 通告针对 <4.6.6，当前安装已满足 | 保持 | 无需动作 | — |

---

## 4. 升级路线图（四阶段）

> 依赖关系：Phase 0 是纯热修无破坏面；Phase 1 的懒加载是 xlsx/预览器 CVE 的止血伞；Phase 2 的 drizzle 升级必须独立成 PR（回滚单位 = 单个 PR）；Phase 3 全部独立，不与业务改动混提交。

### Phase 0 — 热修与收口（当周可发）

| # | 动作 | 涉及 | 验收标准 |
|---|---|---|---|
| 0.1 | hono→4.13.16+、axios→1.20.0、react-router-dom→6.30.6、katex→0.18.2 | api/web package.json + lockfile | `pnpm typecheck` + 三包 test 全绿；`pnpm build:web` 成功；smoke 通过 |
| 0.2 | `pnpm.overrides` 强制 `@xmldom/xmldom≥0.8.15`、`lodash≥4.18.1` | 根 package.json | epub 预览回归（打开 .epub 翻页/目录）；audit 中这两包 high 清零 |
| 0.3 | CI 加 `pnpm audit --prod --audit-level high` 门禁（允许豁免清单文件） | deploy-api.yml | runtime high/critical = 0（或全部在豁免清单并有跟进 issue） |
| 0.4 | 错误响应收尾：share.ts/teams.ts 10 处 + 11-22 审计 §2 状态码错位逐条清 | routes | `errorContract.test.ts` 断言全过；grep `success: false` in routes = 0 |
| 0.5 | 仓库卫生：git rm --cached tsbuildinfo/lint_output.txt、归档 2026-11-11/、AGENTS.md 校准（迁移号 122、补 mobile/、加 .gitignore 条目） | AGENTS.md、.gitignore | `git status` 不再出现 tsbuildinfo；AGENTS.md 与实际一致 |
| 0.6 | S2：ALERT_TG_CHAT_ID 迁 Secret；S3：API Key 操作补审计日志 | wrangler.toml、apiKeys.ts | 告警发送回归通过；管理端可查 Key 操作记录 |

### Phase 1 — 前端重依赖重组（1–2 周）

| # | 动作 | 验收标准 |
|---|---|---|
| 1.1 | FilePreview 预览器全量 `React.lazy` 化 + manualChunks 按预览器拆分 | `/files` 首屏 chunk 对比报告（预览器依赖全部移出首屏）；11 种 mimeType 各抽 1 个文件预览回归 |
| 1.2 | xlsx / x-data-spreadsheet / pptx-preview 三选一决策并落地（§3.6 表） | 选型记录写入 `docs/plans/`；对应 CVE 包从 lockfile 消失或被 vendor |
| 1.3 | SW 缓存策略重构（S1）：`/api` 放行不缓存、导航 networkFirst、logout 清 cache | 换账号不读到旧数据（手测 + sw 单测）；预览二次打开命中 HTTP 缓存 |
| 1.4 | 上传并发队列（2–3）+ 批量失效合并（P2） | 10 文件上传网络面板并发 ≤3；列表请求 1 次 |
| 1.5 | 大文件下载走直链（P3） | >50MB 下载内存平稳（DevTools performance） |

### Phase 2 — 存储层升级与测试补齐（2–4 周）

| # | 动作 | 验收标准 |
|---|---|---|
| 2.1 | drizzle-orm 0.29→0.45+ 专项：API diff 盘点 → 升级 → 本地迁移 → 关键查询 EXPLAIN 回归 → 回滚预案成文 | 三包 typecheck/test 全绿；smoke 通过；EXPLAIN 无新增全表扫描；`docs/runbooks/` 留回滚手册 |
| 2.2 | 核心域测试补齐（Q2）：dedup 删除链、permissionResolver、shareService、bucketResolver 各 ≥2 用例 | 覆盖报告产出；四个域各有 1 happy + 1 边界（含 D3 的版本对象回收用例） |
| 2.3 | 每日对账 cron（D1）：sum(files.size) vs users.storage_used，偏差告警 | 本地构造偏差 → TG 收到告警；`storageReconciliation` 测试接入 cron 路径 |
| 2.4 | schema-drift 守卫测试（D4） | 故意给 schema.ts 加不存在的列 → 测试红 |
| 2.5 | shared 类型对齐收尾（G4） | `FilePermission`/`DownloadTask` 与迁移一致，前端 typecheck 过 |

### Phase 3 — 工具链现代化（持续，各自独立 PR）

| # | 动作 | 验收标准 |
|---|---|---|
| 3.1 | ESLint 9 + typescript-eslint 8（flat config + projectService）+ lint 基线冻结工具（Q1） | lint 耗时 ≤2 分钟；CI 挂 lint 门禁（冻结清单外零问题）；`pnpm lint` 本机可日常跑 |
| 3.2 | pnpm 8→10（含 CI pin）、vite 6→7 | install/build 回归；lockfile 迁移一次完成 |
| 3.3 | Playwright 最小 E2E 集（Q4）：登录/上传/下载/分享/权限拒绝 | PR 手动触发跑通 5 条链路 |
| 3.4 | Tailwind 3→4（独立决策，改动面大，收益主要是长期维护性） | 单独评估后再排期，不设硬验收 |
| 3.5 | react-router 7 迁移评估 | 同上 |

---

## 5. 附录：风险总览

| 维度 | 11-09 时点 | 当前 | 趋势 |
|---|---|---|---|
| P0 数量 | 12 | **0** | ↓ 已清零 |
| 手写错误响应 | 349 | 10 | ↓ 收敛 97% |
| runtime 高危 CVE | 未盘点 | **8 项（hono/axios/xlsx×2/xmldom×4/drizzle）** | 需 Phase 0/2 清 |
| lint 基线 | 不通过 | 785 问题 + 11 分钟耗时 | → 需冻结+提速双轨 |
| web 测试 | 0 | 1 个文件 | ↑ 但仍远低 |
| CI 门禁 | 无迁移预检 | typecheck+test+preflight+migrate | ↑ 缺 audit 与 lint |

**执行顺序上唯一要强调的约束**：xlsx / x-data-spreadsheet / pptx-preview 的替换决策（1.2）**必须与懒加载（1.1）同一个 PR 或紧随其后**——否则替换后包体不降反升，且预览回归范围扩大。其余条目相互独立，可并行。


---

## 执行进度（2026-11-24 更新）

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 | ✅ | 283e87b；0.4 的“残留手写错误响应”核实为误报 |
| Phase 1 | ✅ | a94b22f；决策记录见 `2026-11-23-phase1-decisions.md` |
| 2.1 drizzle 升级 | ✅（待部署后冒烟） | 见 `docs/runbooks/drizzle-orm-upgrade.md` |
| 2.2 核心域测试 | 🟡 | 测试台 `src/test/d1Shim.ts` 已建；dedup 已覆盖并修复版本引用误删；permissionResolver / shareService / bucketResolver 待补 |
| 2.3 对账 cron | ✅ | 对账早已接入 cron；补了偏差独立告警 |
| 2.4 schema 漂移守卫 | ✅ | 060 回填 ai_models 8 列；仅余 ai_config 已知差异（白名单） |
| 2.5 shared 类型对齐 | ⬜ | 未开始 |
| Phase 3 | ⬜ | 未开始 |
