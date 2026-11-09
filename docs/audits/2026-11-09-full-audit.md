# OSSshelf 全面审计报告

- 审计日期：2026-11-09
- 代码基线：`7911e61`（fix(web): 修复系统分享入口 405 并补齐 PWA 入口能力）
- 审计方式：只读静态审计（未修改业务代码、未提交、未部署）
- 覆盖范围：`apps/web`、`apps/api`、`packages/shared`、`migrations`、`wrangler`/CI 配置、近期 AI 重构链路
- 置信度口径：
  - **确认**：已在代码/迁移中逐行核对，机制确定
  - **需验证**：静态推断成立，但最终表现取决于部署配置或需运行时复现

> 说明：本报告中的行号基于上述基线。排序不代表修复顺序，修复优先级见文末。

---

## 一、结论摘要：最该先修的 5 件事

1. **存储配额/桶统计被双重记账**：D1 触发器（`080_optimizations.sql`）与应用层手动 `updateUserStorage/updateBucketStats` 同时生效，上传后统计约为真实值的 2 倍，永久删除后可能变负数，用户会在真实容量一半时就提示超额。
2. **去重引用计数语义错误，会删掉仍被其他文件使用的物理对象**：删除一个"命中去重"的文件时，因其 `refCount` 仍为 1，会直接删除共享对象，导致原文件仍在列表中但无法下载（静默数据丢失）。
3. **API Key 的 scopes 完全没有生效**：`apiKeyScopes` 只写入上下文、全仓无任何读取；只读 Key 可删除/上传文件，且任意有效 Key 都能调用 `POST /api/keys` 重新签发全权限 Key（提权）。
4. **AI 配额与配置存在两处可直接击穿的缺口**：WS 聊天只在签发 ticket 时校验一次配额，ticket 有效期实际是 2 小时；`PUT /ai-config/system-config/:key` 等全局配置接口只要求登录，任意用户可把日配额改为 0（不限量）。
5. **前端核心上传入口在多数场景不可用**：Files 页上传/新建文件夹按钮依赖后端从不返回的 `permissions` 字段，按钮恒定禁用；同时团队工作区 ≤100MB 文件上传丢失 `teamId`，文件会落到个人空间。

---

## 二、P0 清单（数据损坏、越权、核心功能不可用）

### P0-01 存储统计双重记账（触发器 + 应用层）
- 位置：
  - `apps/api/migrations/080_optimizations.sql:83-127`（`trg_files_storage_insert/update/delete/restore`）
  - `apps/api/src/routes/files.ts:704-713`（上传后手动 `updateUserStorage` + `updateBucketStats`）
  - `apps/api/src/routes/files.ts:1447-1452`（预签名上传完成后同样手动记账）
  - `apps/api/src/lib/fileService.ts:430-436`（软删手动扣减）
  - `apps/api/src/routes/files.ts:1150-1154`（永久删除再次扣减）
  - `apps/api/src/routes/downloads.ts:192-194`（URL 下载落库后手动记账）
- 问题：文件 `INSERT` 时触发器已 `+size`、桶 `+size/+1`，应用层又重复执行一次；软删时触发器与手动逻辑同时 `-size`；永久删除时再扣一次。
- 影响：
  - 活跃文件期间 `users.storage_used` 与 `storage_buckets.storage_used/file_count` 约为真实值 2 倍，配额在真实占用一半时耗尽；
  - 永久删除后统计可能变负数，进而让配额校验长期失真；
  - 管理端"存储审计"与真实对象存储对不上。
- 建议：二选一并一次性校准。推荐**保留触发器、删除应用层所有手动记账**（含上传、软删、永久删、URL 下载、版本替换）；若坚持应用层记账，则必须 `DROP TRIGGER` 并补齐所有路径。上线前执行一次全量重算脚本。
- 置信度：**确认**（静态；凡已应用 080 迁移的库必现）

### P0-02 去重引用计数错误，删除共享对象导致数据丢失
- 位置：`apps/api/src/lib/dedup.ts:57-83`、`apps/api/src/lib/dedup.ts:96-111`、`apps/api/src/routes/files.ts:1132-1146`
- 问题：
  - `checkAndClaimDedup` 的 `UPDATE ... RETURNING` 未限制行数，会把**所有**同 hash 行 `refCount + 1`，却只返回第一行的 `r2Key`；新插入的去重文件行 `refCount` 仍为默认 1。
  - 删除这个新行时，`releaseFileRef` 的 `refCount > 1` 条件不成立，直接置 0 并返回 `shouldDeleteStorage=true`，随后物理删除共享对象。
- 影响：原文件记录仍在，但对象已被删除 → 下载/预览 404；反向删除原行时新行又永远无法回收（对象泄漏）。
- 建议：新增独立 `dedup_refs(r2Key PRIMARY KEY, ref_count)` 表按物理对象计数；或插入去重行时继承 `refCount + 1`，删除时按 `r2Key` 聚合判断。`UPDATE` 必须用子查询精确定位单行。
- 置信度：**确认**

### P0-03 API Key scopes 未生效且可自签发高权限 Key
- 位置：
  - `apps/api/src/middleware/auth.ts:140`（写入 `apiKeyScopes`）
  - `apps/api/src/types/env.ts:70`（仅有声明）
  - `apps/api/src/routes/apiKeys.ts:23,93-95`（定义 scope 规则）
  - `apps/api/src/index.ts:168`（`/api/keys` 仅挂 `authMiddleware`）
- 问题：全仓没有任何路由读取/校验 `apiKeyScopes`；`/api/keys` 对 API Key 身份同样放行，且创建 Key 时只拦截 `api_keys:read` 一个 scope。
- 影响：`files:read` 的 Key 可删除文件、创建分享、修改桶；泄露的低权限 Key 可调用 `POST /api/keys` 自助签发包含 `files:write/shares:write` 的新 Key，形成提权链（仅 `api_keys:read` 受管理员限制）。
- 建议：增加 `requireScope(scope)` 中间件并逐路由声明；禁止 API Key 访问 `/api/keys`，或限制只能签发 scope 子集；记录 Key 操作审计日志。
- 置信度：**确认**

### P0-04 团队挂载越权（知道 fileId 即可拉取他人文件）
- 位置：`apps/api/src/lib/teamService.ts:597-603`、`apps/api/src/lib/teamService.ts:626-654`
- 问题：挂载只校验"团队成员 +（文件所有者或团队 admin/owner）"，**未校验挂载者对目标文件是否拥有任何权限**；随后写入 team 级 `read` 权限并默认穿透子项。
- 影响：任意团队管理员拿到 fileId 即可把他人私有文件挂到自己的团队，全员获得读取权限；目录穿透会波及整个子树。
- 建议：仅允许文件 owner 或已拥有 `read/admin` 的用户挂载；服务端必须对目标文件执行 `checkFilePermission`，穿透前对子项做批量校验。
- 置信度：**确认**

### P0-05 权限申请可自建团队并自批，越权获取他人文件
- 位置：`apps/api/src/lib/permissionService.ts:531-548`、`apps/api/src/lib/permissionService.ts:552-600`
- 问题：审批人校验为"文件所有者 或 targetTeamId 的管理员"。申请人可自建团队并成为 owner，再提交 `targetTeamId = 自己的团队` 的申请，然后自己批准；审批直接写入 `requestedPermission` 并创建挂载。
- 影响：可把任意已知 fileId 的私有文件以团队权限（甚至 admin）授权给自己团队，完整越权。
- 建议：创建申请时校验申请人与 `targetTeamId` 的关系及文件对该团队的可见性；禁止 `requesterId === reviewerId`；审批授予权限不得高于申请人对该文件的实际权限。
- 置信度：**确认**

### P0-06 AI 全局配置接口无管理员校验
- 位置：`apps/api/src/routes/aiConfigRoutes.ts:60`（仅 `authMiddleware`）、`apps/api/src/routes/aiConfigRoutes.ts:1189-1224`（`PUT /system-config/:key`）、`:378-392`（`POST /catalog-sync`）、`:1227+`（重置配置）
- 问题：全局 AI 配置的读写、目录快照同步均只要求登录，未校验 `role === 'admin'`。
- 影响：任意注册用户可把 `ai.quota.daily_tokens/daily_requests` 改为 0（按现有语义视为不限量）、修改默认模型/timeout/摘要 prompt、覆盖 models.dev 快照，影响全站成本与行为。
- 建议：新增 `adminMiddleware`，对全局配置/快照/供应商预设写操作强制管理员；配置变更写审计日志。
- 置信度：**确认**

### P0-07 AI WebSocket 聊天完全绕过配额与限流
- 位置：`apps/api/src/routes/aiChatRoutes.ts:25-67`（配额仅在签发 `/ws-ticket` 时检查）、`apps/api/src/agents/OSSShelfAgent.ts:277-325`（`onChatMessage` 无 `checkAiQuota`/限流）、`apps/api/src/middleware/aiRateLimit.ts:23`
- 问题：HTTP 侧 `checkAiQuota` 只在 ticket 签发时执行；WS 内每条消息不再校验每日请求/每日 token/RPM。
- 影响：一张 ticket 可在有效期内无限发消息、无限消耗 token；三项配额全部失效。
- 建议：在 DO `onChatMessage` 进入模型调用前做原子预扣（reserve）与消息级 RPM 限制；ticket 改为短 TTL 且一次性。
- 置信度：**确认**

### P0-08 中断/异常回答记 0 token，点"停止"即可免费获取内容
- 位置：`apps/api/src/agents/OSSShelfAgent.ts:474-493`
- 问题：`result.status !== 'completed'` 时一律写 `inputTokens: 0, outputTokens: 0`；AI SDK 在 abort 场景不触发 `onFinish` 的正常用量路径。
- 影响：用户中断即可免费获得已生成内容；AI 成本与用量统计系统性失真，无法据此做配额与容量决策。
- 建议：中断时用最后一条 assistant 文本估算 token（或读取 SDK 的 partial usage）并标记 `aborted`；补齐异常路径的兜底记账。
- 置信度：**确认**

### P0-09 前端上传/新建文件夹按钮恒定禁用
- 位置：`apps/web/src/pages/Files.tsx:235-240`（`currentFolderInfo` 来自 `filesApi.get`）、`apps/web/src/pages/Files.tsx:1274-1276`、`apps/web/src/pages/Files.tsx:1304-1306`；后端 `apps/api/src/routes/files.ts:151-174` 附近返回的文件夹信息不含 `permissions`
- 问题：按钮 `disabled` 条件读取 `currentFolderInfo.permissions`，但该字段后端从不返回；根目录下 query 还被 `enabled: !!folderId` 关闭。
- 影响：上传文件、上传文件夹按钮始终禁用，用户只能拖拽上传；新建文件夹等同理。
- 建议：后端在文件详情返回 `accessPermission` 或按 `isOwner/团队角色/继承权限` 计算的可写标记；前端根目录默认可写，并统一用 `canWrite` 判断。
- 置信度：**确认**

### P0-10 星标/标签筛选空结果返回对象，前端崩溃白屏
- 位置：`apps/api/src/routes/files.ts:813-815`、`apps/api/src/routes/files.ts:831-837`；前端 `apps/web/src/pages/Starred.tsx:23,58,66`
- 问题：空结果返回 `data: { files: [], total: 0 }`，其余分支返回数组；前端直接 `files.map(...)`。
- 影响：零收藏用户打开 `/starred` 抛 `files.map is not a function`，页面白屏；标签筛选无结果时同类问题可能出现。
- 建议：统一 `GET /api/files` 的 `data` 为数组（分页信息放 `pagination`），或前端兼容两种形状并立刻统一契约。
- 置信度：**确认**

### P0-11 团队工作区上传丢失 teamId，文件落到个人空间
- 位置：`apps/web/src/services/presignUpload.ts:145`（单文件分支未透传 `teamId`）、`apps/web/src/services/presignUpload.ts:192,218`（代理回退同样不带）、`apps/web/src/components/teams/TeamWorkspace.tsx:315-319`（调用方确实传了 `teamId`）、`apps/web/src/hooks/useFolderUpload.ts:216`
- 问题：`presignUpload` 在 ≤100MB 时调用 `singlePresignUpload` 漏传 `teamId`；CORS 回退 `proxyUpload` 也未携带。
- 影响：团队工作区小于 100MB 的文件、以及所有回退上传，都会以 `teamId=null` 落库，文件出现在个人空间且团队成员不可见；数据归属错误。
- 建议：`presignUpload` → `singlePresignUpload/proxyUpload` 全链路透传 `teamId`，并在 `TeamWorkspace` 统一改为并发队列；补一条"团队上传落库后从团队接口可查"的回归测试。
- 置信度：**确认**

### P0-12 AI Agent 的摘要/标签工具是伪实现
- 位置：`apps/api/src/lib/ai/agentTools/content.ts:611-641`、`:643-664`
- 问题：`generate_summary`/`generate_tags` 只做权限与存在性检查，随后直接返回 `status: 'queued'` 与"已加入队列"，实际没有任何 enqueue 调用。
- 影响：模型向用户谎报任务已提交，用户等待后摘要/标签永远不会更新；属于"声明了但没实现"。
- 建议：接入真实队列（与 `aiTaskQueue` 的 summary/tag 任务复用），或删除工具并更新系统提示词。
- 置信度：**确认**

---

## 三、P1 清单（高风险、明显缺陷、契约不一致）

### AI 链路
1. **配额无原子预扣，可并发击穿** — `apps/api/src/lib/ai/usage.ts:163`、`apps/api/src/middleware/aiRateLimit.ts:23`。`checkAiQuota` 只读已落库事件，Burst 请求全部通过。建议计数器行原子 upsert / DO 计数，先预扣后结算。
2. **`recordUsage` 未 await / 未 waitUntil** — `apps/api/src/lib/ai/modelRuntime.ts:446,463,513,536`。Worker 返回后可能被回收，记账随机丢失。建议 `await` 或在路由层 `waitUntil`。
3. **WS ticket TTL 与注释不符且可重放** — `apps/api/src/agents/auth.ts:13`（`2 * 60 * 60_000` = 2 小时，注释写 60s）；未校验会话是否已删除、无一次性 nonce。建议 60s + jti 一次性 + 会话存在性校验。
4. **视觉调用只支持 data URL** — `apps/api/src/lib/ai/modelRuntime.ts:324-344,421-424,256`。远程 `image_url` 直接报"缺少图片内容"，外部协议分支写死 `mediaType:'image'`。建议先下载转 base64 或按 mime 传递。置信度：需验证（取决于实际调用方传参）。
5. **`/ai-config/test` 无 rate limit 且默认不记账** — `apps/api/src/routes/aiConfigRoutes.ts:1029-1142`。可无限调用测试接口消耗 Workers AI 额度。建议挂 `aiRateLimit` 并 `record: true`。
6. **向量 embedding/rerank 全链路不记账** — `apps/api/src/lib/ai/vectorIndex.ts:183,315,428`；`/index/rebuild` 可重复触发。建议按条数/ token 记账并纳入配额；rerank 不要硬编码模型。
7. **重建索引先清标记再入队** — `apps/api/src/routes/ai.ts:186-189`。入队失败会导致全库永久 `vectorIndexedAt=NULL`，检索静默为空。建议入队成功后再清标记，失败回滚。
8. **`trigger_ai_summary/tags`、`rebuild_vector_index` 不在写工具审批列表** — `apps/api/src/lib/ai/toolAdapter.ts:118`、`apps/api/src/lib/ai/agentTools/types.ts:88-146`。提示注入可静默烧额度、覆盖摘要标签。建议纳入 `WRITE_TOOLS` 并限流。
9. **队列任务无 running 租约/幂等** — `apps/api/src/lib/ai/aiTaskQueue.ts:459-471`。Queue 至少一次投递会并发重复执行摘要、索引、批量移动。建议条件更新抢占 `running` + 幂等键。
10. **"断点续传"是半成品** — `apps/api/src/lib/ai/aiTaskQueue.ts:515-546,598-603`。不会跳过已处理项，只把 JSON 写进 `error` 列，重跑重复烧 token 且原始 JSON 会透出。建议实现 `skipped` 或移除分支。
11. **供应商允许 `http://`，密钥加密不成立** — `apps/api/src/lib/ai/providers/providerService.ts:81,145`。可明文出网、可指向任意主机；非 AES-GCM 值按明文返回，112 迁移也直接拷贝历史明文。建议强制 https + 私网黑名单 + 迁移时统一加密。
12. **删除供应商不清理引用** — `apps/api/src/lib/ai/providers/providerService.ts:354-385`。`ai_feature_config`/会话 `modelId` 悬空，运行期静默回退默认模型。建议事务内清理。
13. **`temperature: raw.temperature || 0.7`** — `apps/api/src/lib/ai/modelConfigMapper.ts:98`。温度 0 无法设置。建议改 `??`。
14. **会话 id 客户端可指定、撞 id 直接 500** — `apps/api/src/routes/aiChatRoutes.ts:151-175`。建议服务端生成或冲突返回 409。
15. **AI 会话分页未 clamp** — `apps/api/src/routes/aiChatRoutes.ts:430-431`。超大 `limit` 可造成全表扫描。

### 文件管理 / 权限
16. **预览响应 `Cache-Control: public` 且 MIME 来自上传方** — `apps/api/src/routes/files.ts:170-173`。私有内容可能被共享缓存；上传 `text/html`/`image/svg+xml` 后同源预览可触发存储型 XSS。建议 `private, no-store` + `X-Content-Type-Options: nosniff` + 服务端 MIME 白名单/附件下载。置信度：确认；实际泄露面取决于 API 是否与应用同源。
17. **WebDAV MOVE 无"目标为自身/后代"校验** — `apps/api/src/routes/webdav.ts:761-800`；`buildLogicalPathFromCache` 的祖先遍历无 visited 集合（`:233` 附近）。可制造 parentId 环导致 PROPFIND 死循环/CPU 超限。建议移动前检查祖先链、遍历加 visited。
18. **路径语义混用：`path` 既存 `/<parentId>/<name>` 又存 WebDAV 名称路径** — `apps/api/src/routes/files.ts:597,1243`、`apps/api/src/routes/webdav.ts:717,793,922`。递归靠 `LIKE 'X/%'`，名称含 `%`/`_` 会误匹配；跨入口递归失效。建议统一按 `parentId` 递归，或全部改用 ID 路径并 `ESCAPE`。
19. **WebDAV 覆盖写先删旧对象再写新对象** — `apps/api/src/routes/webdav.ts:548-615`。写失败即丢旧内容；无大小上限、不校验 `isFolder`。建议先写新键再切换 DB，失败保留旧对象。
20. **URL 下载仅信 `Content-Length` 校验配额，且跟随重定向** — `apps/api/src/routes/downloads.ts:115-131,161-166`。可伪造长度绕过配额；`fetch` 默认跟随跳转可绕过 `isPrivateUrl`（SSRF）。建议边读边累计上限、`redirect:'manual'`、流式写入。
21. **上传分享口令明文入库** — `apps/api/src/lib/shareService.ts:178`（下载分享走 `hashPassword`）。建议统一 hash，并兼容旧值升级。
22. **上传分享口令无尝试限流** — `apps/api/src/routes/share.ts:161-170`（下载分享在 `:120` 有限流）。建议复用同一限流键。
23. **ZIP 打包全量读内存且部分失败仍 200** — `apps/api/src/routes/files.ts:386-398`。500MB 上限远超 Worker 内存；缺文件仍返回成功包。建议流式 ZIP + 内存预算，失败返回 5xx。
24. **批量操作无事务、与单文件路径不一致** — `apps/api/src/routes/batch.ts:86-110,275-335`。逐条 `await`，批量软删不扣配额、不清向量/FTS、不发 webhook。建议复用 `fileService` 并用 D1 `batch()` 原子化。
25. **迁移删除源文件绕过 `releaseFileRef`** — `apps/api/src/routes/migrate.ts:507-524`。直接 `s3Delete` + 软删，可能删掉去重共享对象。建议走统一删除链路。
26. **S3 删除异常被吞，DB 记录仍删除** — `apps/api/src/routes/files.ts:2202-2211`。产生孤儿对象，无补偿任务。建议保留记录/入重试队列。
27. **`renameFile` 不更新子项 path、无重名校验** — `apps/api/src/lib/fileService.ts:347-382`（`moveFile` 有级联，rename 没有）。重命名文件夹后子文件 path 失效，分享/导航错乱。建议复用 move 的级联逻辑并补冲突检查。
28. **批量重命名参数名不一致** — `apps/api/src/lib/ai/agentTools/fileops.ts:1282` 传 `template`，`apps/api/src/lib/ai/aiTaskQueue.ts:339` 读 `newName`。>50 件时全部失败。
29. **≤50 件批量重命名直写 D1** — `apps/api/src/lib/ai/agentTools/fileops.ts:1348-1356`。绕过 `renameFile`，无重名检查、不刷子项 path/FTS/向量/审计。
30. **团队角色未参与权限判定** — `apps/api/src/lib/permissionResolver.ts:306-340`。只按 `teamId` 匹配权限记录，viewer/admin 得到同等权限。若产品期望 viewer 只读，需要按角色映射最大权限。置信度：需验证（可能是产品设计）。
31. **分享下载计数在取流前 +1，`downloadLimit` 从未比较** — `apps/api/src/routes/share.ts:458,835,975`。失败也消耗次数，`maxUses` 实际是死功能。
32. **上传次数先读后自增** — `apps/api/src/routes/share.ts:1353-1364,1529-1532`。并发可超 `maxUploadCount`。
33. **列表接口 `parseInt` 未校验** — `apps/api/src/routes/files.ts:788-790`、`apps/api/src/routes/downloads.ts:292-308`。可传入 NaN/负数导致 500 或异常分页。

### 前端 / PWA
34. **Service Worker 缓存策略顺序与路径错误** — `apps/web/public/sw.js:94-108`。`/api/` networkFirst 先匹配，导致预览、`/api/buckets`、`/api/user` 的专门策略永远不可达；pattern 与实际路由不符（`/api/files/:id/preview`、`/api/auth/me`）。建议具体路径优先匹配并修正 pattern。
35. **`/api/` 鉴权响应写入 DYNAMIC cache，登出不清缓存** — `apps/web/public/sw.js:93-97`、`apps/web/src/stores/auth.ts:42`。同设备换账号或离线时可能读到上一账号数据。建议只缓存匿名白名单，logout 时清理 cache。
36. **分享接收上传失败仍清空缓存** — `apps/web/src/pages/Files.tsx:536-543`（内部吞错，随后 `clearSharedFiles`）。失败文件永久丢失。建议汇总失败项，全部成功或用户确认后再清理。
37. **大文件整文件读入内存计算 SHA-256** — `apps/web/src/services/presignUpload.ts:204,825`。数 GB 文件移动端 OOM。建议流式/分块哈希或服务端计算。
38. **多选上传无并发上限** — `apps/web/src/pages/Files.tsx:1289-1293`，且每个文件又整读内存。建议 2–3 并发队列。
39. **文件夹上传/拖拽不传 `bucketId`（团队路径还丢 teamId）** — `apps/web/src/hooks/useFolderUpload.ts:216`、`apps/web/src/hooks/useFileDragDrop.ts:92`。非默认桶目录下拖拽写入默认桶。
40. **标签搜索序列化不匹配** — `apps/web/src/services/storage.ts:362` 发 `tags[]=x`，`apps/api/src/routes/search.ts:97` 只解析 `tags='a,b'`。标签搜索静默失效并返回全部文件。置信度：需验证（取决于 axios 序列化配置）。
41. **协议 handler 解析整条 URL** — `apps/web/public/manifest.json:85`、`apps/web/src/utils/protocolPath.ts:34`。`web+osshelf://photos` 会被当作目录名，提示未找到目录。
42. **manifest 的 `action=open` 无处理分支** — `apps/web/src/pages/Files.tsx:558-577`、`apps/web/public/manifest.json:71`。只做一半的入口；`action=upload` 依赖用户激活，冷启动多失败。
43. **移动端快捷操作丢当前目录** — `apps/web/src/components/layouts/MainLayout.tsx:346-347`、`apps/web/src/components/layouts/MobileBottomNav.tsx:191-210`。子目录里点上传/新建会跳回根目录。
44. **FilePreview 静态引入重型预览器** — `apps/web/src/pages/Files.tsx:1843`、`apps/web/src/components/files/FilePreview.tsx:55-65`。PDF/xlsx/epub/opentype 全进 `/files` 首屏 chunk，移动端首屏显著变慢。建议按 mimeType 动态 `lazy()`。
45. **Webhook 事件契约不一致** — `apps/api/src/routes/webhooks.ts:26-34`（`VALID_EVENTS` 不含 `ai.*`）vs `apps/api/src/lib/webhook.ts:36-48`（`WEBHOOK_EVENTS` 对外展示 `ai.*`）。用户选择 AI 事件后创建被 400 拒绝。建议统一事件清单。
46. **邮箱验证实际未启用** — `apps/api/src/middleware/auth.ts` 定义了 `requireEmailVerification` 但全仓未使用；登录也不检查 `emailVerified`。注册验证流程形同装饰。建议在登录或关键操作处启用，或删除相关承诺。
47. **`/cron/*` 无鉴权** — `apps/api/src/index.ts:182`、`apps/api/src/routes/cron.ts`。任何人都能触发清理任务（触发过早删除、增加 D1/S3 成本）。建议加内部密钥/管理员校验。

---

## 四、P2 清单（冗余、漂移、可维护性与低危问题）

### 数据层与迁移
1. **schema 与迁移漂移**：
   - `ai_config` 迁移含 `user_id`/`value` 列（`060_ai.sql`），`apps/api/src/db/schema.ts` 未声明；
   - `storage_buckets` 迁移是 `UNIQUE ... WHERE is_default=1` 部分索引，schema 声明为普通索引（`schema.ts` 中 `userDefaultIdx`）；
   - 080 中 `idx_files_hash_bucket`、`idx_ai_tasks_completed`、`idx_tg_chunks_bucket` 等索引未写入 schema；schema 中的部分索引也未带 `WHERE`。
   - 影响：任何一次 `drizzle-kit generate` 都会生成大量"删索引/改列"的伪迁移。建议以迁移为准回写 schema，或停止使用 generate、明确以 SQL 迁移为唯一事实源。
2. **迁移非幂等且 CI 不自动执行** — `100_team_collaboration.sql`、`101`–`105`、`112` 含大量裸 `ALTER TABLE ADD/DROP COLUMN`；`.github/workflows/deploy-api.yml` 无 `d1 migrations apply` 步骤。新版本代码可能与未迁移的库同时上线。建议迁移前检查/手动步骤写入发布清单。
3. **缺索引/级联** — `ai_memories.session_id` 无索引无 FK（`091_ai_memories.sql:6`）；`file_chunks`/`ai_task_items` 无 FK；删除会话/文件后残留正文与向量。
4. **清理任务删除父文件夹会留下孤儿子项** — `apps/api/src/lib/cleanup.ts:179-196` 按 `deletedAt` 到期逐行删除，未保证子树整体删除；恢复将不可能。
5. **定时清理与 `/cron` 两套实现漂移** — `apps/api/src/lib/cleanup.ts` 不复用 `releaseFileRef`，`apps/api/src/routes/cron.ts` 复用；两套行为不同。建议合并为单一实现。
6. **`/cron/all` 调用不存在的路由** — `apps/api/src/routes/cron.ts:318-323` 请求 `/cron/ai-confirm-cleanup`，该路由不存在（111 已删除相关表），必然 404。
7. **`ai_task_items` 随 `ai_tasks` 删除后残留** — `apps/api/src/lib/cleanup.ts` 仅删 `ai_tasks`，无级联。

### 部署与配置
8. **`JWT_SECRET` 写入 wrangler `[vars]`** — `.github/workflows/deploy-api.yml:125`。非 secret 变量，会出现在 Worker 配置中。建议 `wrangler secret put`。
9. **`TRASH_RETENTION_DAYS` 环境变量被忽略** — CI 设置（`deploy-api.yml:128`），但 `apps/api/src/lib/cleanup.ts` 使用共享常量 `TRASH_RETENTION_DAYS`，`Env` 也未声明。运维改配置无效。建议读取 `env.TRASH_RETENTION_DAYS` 并给默认值。
10. **多个声明但未读取的环境变量** — `INVITE_CODE`、`DISABLE_REGISTRATION`、`MAX_FILE_SIZE`、`MAX_STORAGE_QUOTA`（`apps/api/src/types/env.ts`）全仓无 `env.*` 引用。建议删除或接入。
11. **版本号不一致** — `apps/api/src/index.ts:142` 返回 `3.5.0`，`package.json` 为 `3.2.0`。
12. **CORS `allowHeaders` 缺少 `X-API-Key`** — `apps/api/src/index.ts:95`。浏览器跨域使用 API Key 会被预检拦截。
13. **生产 sourcemap 开启** — `apps/web/vite.config.ts:33`。源码随产物公开、体积增大。建议关闭或改内部上传。

### 死代码 / 重复实现 / 契约
14. **CSRF 中间件从未使用** — `apps/api/src/middleware/csrf.ts:19` 定义后无任何挂载。当前 Bearer 鉴权下 CSRF 风险低，可删除。
15. **`packages/shared` 类型落后于 schema**：
    - `FilePermission` 缺 `subjectType/groupId/teamId/expiresAt/inheritToChildren/scope`（`packages/shared/src/types/index.ts:77-85`）；
    - `DownloadTask` 仍是 `totalSize/downloadedSize`（`:194-210`），实际表为 `fileSize/progress` 且 `fileSize` 被复用为"已下载字节"（`apps/api/src/routes/downloads.ts:151-160`），语义混乱。
16. **文档元数据路径漂移** — `apps/api/src/routes/docs.ts` 中 `/presign/upload`（接口不存在）、`/api-keys`（实际 `/api/keys`）、`/presign/download/:fileId`（实际 `:id`）。
17. **`StarredFiles.tsx` 重复实现且无引用**；`formatFileSize` 与 `utils/index.ts` 的 `formatBytes` 重复。
18. **`apps/web/src/services/api.ts:63,139` 使用顶层 await 动态 import** — 启动多一次瀑布，兼容性差；建议静态导入。
19. **搜索建议存在竞态** — `apps/web/src/hooks/useFileSearch.ts:113-119` 无防抖/AbortController，旧响应可覆盖新建议。
20. **Trash 分页不读 `total`** — `apps/web/src/pages/Trash.tsx:30-32,140-143`；删空本页后不回退页码。
21. **Pagination 使用本地 pageSize 推算** — `apps/web/src/components/files/Pagination.tsx:24,144`、`apps/web/src/pages/Files.tsx:1883`；搜索态仍显示文件分页。
22. **SW install 使用 `cache.addAll`** — `apps/web/public/sw.js:31-35`，任一资源失败即整个安装失败。
23. **每个文件都 `invalidateQueries(['files'])`** — `apps/web/src/hooks/useFolderUpload.ts:87,116,123`，上传 N 个触发 N 次列表请求。
24. **下载一律 fetch 成 blob** — `apps/web/src/pages/Files.tsx:657-668`；大文件内存翻倍，token 还可能进 URL。
25. **分享密码走 query 参数** — `apps/web/src/pages/SharePage.tsx:119,126`、`apps/web/src/services/collab.ts:96`；建议改用 POST body/header。
26. **`fileIds.sort()` 原地修改 query 数据** — `apps/web/src/pages/Files.tsx:288-289`。
27. **Webhook 无重试** — `apps/api/src/lib/webhook.ts` 文档声称有重试，实际单次 fetch；且 test 会把事件发给该用户所有匹配 hook，而非仅测试目标。
28. **`chatStreamStallTimeoutMs` 声明未使用** — `apps/api/src/lib/ai/modelRuntime.ts:106`、`apps/api/src/agents/OSSShelfAgent.ts:106`。慢速滴流可长期占用 DO。
29. **`imageTag` 只校验 `chat` 能力** — `apps/api/src/routes/aiConfigRoutes.ts:969`，纯文本模型可被设为图片标签模型。
30. **`modelService` 按 `modelId` 字符串回退** — `apps/api/src/lib/ai/modelService.ts:46-61`，多供应商同名模型可能用错 key/baseURL。
31. **AI 记忆计数在消息裁剪后失效** — `apps/api/src/agents/OSSShelfAgent.ts:497-502`，`messages.length - extractedCount` 变负后抽取永久停摆。
32. **D1 消息镜像按客户端 `message.id` upsert，未校验归属** — `apps/api/src/agents/OSSShelfAgent.ts:330-348`。置信度：需验证。
33. **`zipStream` 无 ZIP64** — `apps/api/src/lib/zipStream.ts:10,157-158`；条目 >65535 时静默截断（当前调用上限 200 条暂时挡住）。

---

## 五、专题分析

### 5.1 存储/配额记账：为什么必须优先修

当前系统存在两套并行的记账机制：

- 数据库触发器（080）：`files` 插入/更新/软删/恢复时自动改 `users.storage_used`、`storage_buckets.storage_used/file_count`；
- 应用代码：上传后 `updateUserStorage(+size)`、软删 `-size`、永久删除再 `-size`、URL 下载 `+size`。

两套同时生效后，同一个生命周期会出现 +2 / -2 / -1 的错配。表现为：

| 阶段 | 期望变化 | 实际变化（用户/桶） |
|---|---|---|
| 上传 | +size | +2×size（桶 file_count +2） |
| 软删 | -size | -2×size |
| 恢复 | +size | +size |
| 永久删除 | 0（已软删） | -size |
| 直接永久删除（未软删） | -size | +size（净多计） |

因此这不仅影响配额提示，还会导致：
- 用户在真实用量 50% 时就无法上传；
- 永久删除后 `storage_used` 变负，配额校验永远通过；
- 管理端空间审计与实际 S3 用量长期偏大。

修复时必须同时处理：上传、预签名完成、软删、恢复、永久删除、URL 下载、版本替换、批量删除、迁移删除、定时清理。

### 5.2 去重与对象生命周期

去重的正确模型应是"按物理对象（r2Key）计数"，当前实现按"文件行"计数，且新行不继承原行计数，因此：

- 命中去重的新文件行 `refCount=1`，但对象实际有 2 个逻辑引用；
- 删除新行 → 误删对象；
- `checkAndClaimDedup` 无 `LIMIT 1` → 所有同 hash 行计数虚高；
- 在线编辑生成新 r2Key 后旧对象既不删除也不纳入版本（`files.ts:1918-1962`）；
- 迁移与批量删除绕过 `releaseFileRef`。

建议引入 `dedup_objects` 表作为唯一事实源，所有"新增/删除/替换/迁移"统一走同一组 `claim/release` API。

### 5.3 权限模型

当前权限来源包括：owner、user 显式、group 显式、team 显式、继承。问题集中在"授权入口"而非"判定函数"：

- 团队挂载不校验挂载者对文件的权限；
- 权限申请允许自建团队 + 自批；
- API Key 不校验 scope；
- 团队角色不参与判定（viewer 与 admin 同等），需产品确认；
- 文件列表对非 owner 的 `accessPermission` 恒为 null（`files.ts:906-909,979-986`），前端会误判无权限。

建议把"能否把某文件授权给某主体"抽象为独立策略函数，所有入口（挂载、申请审批、分享、API Key）复用。

### 5.4 AI 链路（重构后重点）

重构后的统一调用链（`modelRuntime` + `providerService` + `catalog`）方向正确，但治理层没有跟上：

1. 配额只在 HTTP 中间件与 ticket 签发处生效，WS 主通道与测试、embedding、rerank 全部绕过；
2. 用量记账在失败/中断/异步场景不可靠（0 token、未 await）；
3. 全局配置无管理员边界；
4. 工具层的"写操作审批"白名单遗漏了会烧钱/写数据的工具；
5. 队列缺少幂等与租约，"续跑"未完成；
6. 供应商密钥"加密"存在明文兼容分支与 `http://` 允许项。

### 5.5 前端与 PWA

PWA 入口（分享、file_handlers、protocol_handlers、快捷方式）此前已补过一轮，但仍存在：
- 分享接收失败后清缓存导致文件丢失；
- SW 缓存策略不可达且跨账号复用缓存；
- 协议 handler 把整条 URL 当路径；
- `action=open` 无处理分支；
- 移动端快捷操作丢当前目录。

首屏方面，`FilePreview` 静态引入 PDF/Office/Epub 解析器，是 `/files` chunk 过大的主因，建议按需懒加载。

### 5.6 数据层与迁移

- schema 已不再是唯一事实源，迁移中手工添加的列/索引未回写，`drizzle-kit generate` 会产出破坏性伪迁移；
- 迁移非幂等，且 CI 不自动 apply，存在"代码先上、库未迁"的时间窗；
- 部分关联表缺 FK/索引，删除路径依赖应用层手工清理，异常时会残留正文与向量。

### 5.7 契约与死代码

已确认的前后端契约问题：
- `GET /api/files` 空筛选返回对象 vs 数组；
- 文件详情缺 `permissions`；
- 标签搜索参数格式；
- Webhook `ai.*` 事件不可创建；
- 文档元数据路径漂移；
- 共享类型落后于 schema。

死代码/重复实现：
- `csrfProtection` 从未挂载；
- `requireEmailVerification` 从未启用；
- `lib/cleanup.ts` 与 `routes/cron.ts` 两套清理；
- `/cron/ai-confirm-cleanup` 不存在；
- `StarredFiles.tsx`、`formatFileSize` 重复。

### 5.8 部署与配置

- `JWT_SECRET` 放在明文 `[vars]`；
- `TRASH_RETENTION_DAYS` 等变量未被代码读取；
- CORS 未允许 `X-API-Key`；
- 生产 sourcemap 开启；
- 版本号与实际 package 不一致；
- CI 不执行 D1 迁移。

---

## 六、需运行时验证的清单

以下条目静态分析成立，但最终影响取决于部署形态或调用方，建议按序复现：

1. 私有预览 `Cache-Control: public` 是否被 CDN/中间缓存实际缓存（与自定义域、缓存规则有关）。
2. 预览 MIME 是否可同源执行（取决于 `VITE_API_URL` 是否与前端同源）。
3. 团队 viewer 是否应只读（当前角色不参与判定，属产品决策）。
4. 标签搜索参数序列化（取决于 axios `paramsSerializer`）。
5. 协议 handler 的实际入参格式（不同浏览器差异）。
6. WebDAV MOVE 环是否可稳定构造（需带认证的 DAV 客户端）。
7. `ai_memories` 抽取停摆的实际触发比例（依赖消息裁剪策略）。
8. D1 消息镜像跨会话覆盖是否可利用（需知悉 message.id）。
9. AI 视觉远程 `image_url` 的实际调用方（若始终传 data URL 则不触发）。
10. 生产库是否已应用 080 触发器（若未应用，P0-01 暂不显现，但一旦应用即生效）。

---

## 七、建议修复顺序

> 仅为依赖关系与技术优先级建议，不代表排期。

1. **先止损数据正确性**：P0-01 存储双计、P0-02 去重删除、P0-10 星标白屏、P0-11 团队上传归属。
2. **再封权限缺口**：P0-03 API Key scope、P0-04 团队挂载、P0-05 权限申请自批、P0-06 AI 全局配置。
3. **再补 AI 治理**：P0-07 WS 配额、P0-08 中断记账、P0-12 伪入队，随后是 P1 的原子预扣与队列幂等。
4. **再恢复核心交互**：P0-09 上传按钮、P1 分享接收、SW 缓存、标签搜索。
5. **最后做结构性清理**：schema/迁移对齐、死代码删除、清理任务合并、部署配置收口。

每一步建议配套的验证：
- 存储/去重：构造"上传同内容两次 → 删除一份 → 校验另一份可下载 + 统计值"用例；
- 权限：用两个普通账号 + 一个自建团队复现挂载与审批；
- AI：用低配额账号走 HTTP 与 WS 两条路径，校验超限行为一致；
- 前端：零收藏账号、团队工作区 10MB 文件、系统分享失败场景。

---

## 八、附录：审计覆盖与未覆盖

**已覆盖**
- `apps/api/src` 路由、中间件、服务层、AI 子模块、Agent 工具、迁移；
- `apps/web/src` 页面、请求层、stores/hooks、PWA 资源与 SW；
- `packages/shared` 类型与常量；
- `wrangler.toml.example`、`.github/workflows`、`_routes.json`、`manifest.json`、`vite.config.ts`。

**未覆盖 / 建议后续补充**
- 真实 D1 实例的执行计划（需 `EXPLAIN QUERY PLAN`）；
- Cloudflare 运行时实测（Workers 内存上限、Queue 重投、DO 并发）；
- 第三方存储适配（Telegram/S3/R2）在弱网与部分失败下的端到端行为；
- 浏览器兼容性矩阵（iOS Safari 的 Web Share Target、protocol handler）；
- 安全渗透级验证（越权、SSRF、XSS 的实际可利用性）。

---

## 九、一句话总结

这套系统的功能面已经很完整，但**数据一致性（存储计数/去重）与权限边界（API Key/团队/审批）存在会直接造成数据丢失或越权的 P0 缺陷**，AI 重构后治理层（配额、记账、配置权限、队列幂等）也明显滞后；建议按第七节的顺序先止损，再做结构性清理。
