# 错误响应统一化审计（2026-11-22）

> 范围：`apps/api/src/routes/*.ts` 中仍手写 `return c.json({ success: false, error: {...} })` 的残留，未覆盖 `apps/api/src/lib`、`services` 等目录。
> 目标：找出不适合 codemod 自动转换的存量，判断哪些是真 bug、哪些应保持现状。
> **快照时间：2026-11-22 23:51（UTC 15:51）**。多路 agent 正在并行改造，本文件中的数量与行号会随后续提交变化（实测 10 分钟内 `aiConfigRoutes.ts` 已整体上移 1 行）；行号以该快照的实际 AST 扫描为准，不要直接引用 `.workbuddy/tools/skipped-errors.json`（该文件生成于 23:42，已过期）。若行号对不上，以同一文件内的错误码/message 定位。

## 0. 审计方法

- 用 TypeScript AST 遍历 `return c.json(...)`，复刻 `.workbuddy/tools/codemod-error-responses.mjs` 的判定顺序（顶层字段 → error 是否对象字面量 → error 字段 → code 形态 → 状态码 → try/catch → 嵌套函数），保证分类口径与 codemod 一致。
- 标准失败响应形态见 `apps/api/src/middleware/error.ts`：`{ success:false, error:{ code, name, message, requestId, timestamp } }`，HTTP 状态取自 `ERROR_CODES[key].httpStatus`。
- 码表：`packages/shared/src/constants/errorCodes.ts`（365 行，`as const satisfies Record<string, ErrorInfo>`）。
- **行号口径**：本文件所有 `文件:行` 均指该 `return c.json(...)` 语句的起始行。多行对象字面量时，`code:` 那一行在其下方 2~4 行，`grep "code: 'XXX'"` 得到的行号会略大，属正常差异。

## 1. 总览

按 codemod 原始口径，路由内手写错误响应共 **349 处**（已自动转换 190 + 跳过 159）。截至快照：

| 类别                                            | 原始跳过          | 当前残留 | 说明                                                    |
| ----------------------------------------------- | ----------------- | -------- | ------------------------------------------------------- |
| 字面错误码（`code: 'XXX'`）                     | 74                | **57**   | 去重后 30 个码；不含 §4.1 的 2 处动态码                 |
| 位于 try 块内                                   | 37                | **37**   | 16 处在 try 主体、21 处在 catch                         |
| 状态码与码表不一致                              | 13                | **13**   | 全部需要人工判定，见 §2                                 |
| 无字面量状态码（默认 200）                      | 3                 | **3**    | 真 bug，见 §2.1                                         |
| error 含额外字段                                | 12                | **2**    | 其余 10 处已在并行任务中处理完；剩余 2 处同时属于字面码 |
| 顶层含额外字段                                  | 3                 | **0**    | 已处理完                                                |
| error 为透传值                                  | 17                | **1**    | `share.ts:309`                                          |
| 动态错误码（非字面量、非 `ERROR_CODES.x.code`） | —（原混在其它类） | **2**    | 见 §4.1                                                 |
| **合计**                                        | **159**           | **113**  | —                                                       |

**统一进度**：已统一 ≈ 236 / 349（**68%**），待处理 113（**32%**）。其中约 45 处是在本轮并行改造中由其它 agent 完成的，因此与 `skipped-errors.json` 的 23:42 快照相比，字面码少了 17 处、透传值少了 16 处、额外字段少了 15 处。

`apps/api/src/routes/` 内现有 `throwAppError(...)` 573 处、`throw new AppError(...)` 2 处、`throwApiError(...)` 14 处。

### 1.1 按文件的残留分布

| 文件              | 字面码 | try/catch | 状态码不一致 | 无状态码 | 其它                      | 小计    |
| ----------------- | ------ | --------- | ------------ | -------- | ------------------------- | ------- |
| ai.ts             | 0      | 0         | 5            | 3        | 0                         | 8       |
| aiChatRoutes.ts   | 0      | 10        | 1            | 0        | 0                         | 11      |
| aiConfigRoutes.ts | 1      | 17        | 0            | 0        | 0                         | 18      |
| admin.ts          | 7      | 0         | 0            | 0        | 0                         | 7       |
| buckets.ts        | 5      | 0         | 0            | 0        | 0                         | 5       |
| cron.ts           | 3      | 0         | 0            | 0        | 0                         | 3       |
| directLink.ts     | 4      | 0         | 0            | 0        | 0                         | 4       |
| files.ts          | 20     | 1         | 1            | 0        | 2（动态码）+2（额外字段） | 24      |
| permissions.ts    | 2      | 0         | 0            | 0        | 0                         | 2       |
| preview.ts        | 3      | 0         | 1            | 0        | 0                         | 4       |
| share.ts          | 3      | 1         | 5            | 0        | 1（透传）                 | 10      |
| tasks.ts          | 9      | 7         | 0            | 0        | 0                         | 16      |
| batch.ts          | 0      | 1         | 0            | 0        | 0                         | 1       |
| **合计**          | **57** | **37**    | **13**       | **3**    | **3**                     | **113** |

> `files.ts` 中的 `CROSS_BUCKET` 与 `BUCKET_SWITCH_REQUIRES_MIGRATION` 两处，在“字面码”和“error 额外字段”两列各计一次，故小计有重复。

## 2. 状态码与码表不一致（13 处）

全部为 `ERROR_CODES.<KEY>.code` 与显式状态码不匹配，codemod 为避免改变 HTTP 语义而跳过。

| #    | 文件:行                            | 码键               | 当前 | 码表 | 判定                                                                                                                                                                             | 建议                                                                                                                |
| ---- | ---------------------------------- | ------------------ | ---- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1-5  | `ai.ts:87 / 159 / 305 / 383 / 492` | `INTERNAL_ERROR`   | 503  | 500  | **bug（语义错位）**。5 处均为 `if (!c.env.AI_TASKS_QUEUE)` → “AI 任务队列未配置，请联系管理员”。队列未部署是服务不可用，不是内部错误，且响应体 `code=G000` 与 HTTP 503 自相矛盾  | 改用 `throwAppError('SERVICE_UNAVAILABLE', ...)`（G001，503）或 `AI_SERVICE_UNAVAILABLE`（I000，503），**保留 503** |
| 6    | `aiChatRoutes.ts:165`              | `VALIDATION_ERROR` | 409  | 400  | **bug**。“会话 ID 已存在”是资源冲突而非参数格式错误                                                                                                                              | 改 `throwAppError('CONFLICT', '会话 ID 已存在')`，**保留 409**                                                      |
| 7    | `files.ts:455`                     | `FILE_TOO_LARGE`   | 400  | 413  | **bug（不一致）**。同文件 `files.ts:444 / 499 / 504` 已改用 `throwAppError('FILE_TOO_LARGE')` 返回 413，此处 400 是漏网；前端 `apps/web/src/utils/index.ts:62` 已有 413 专门文案 | 改为 `throwAppError`，接受 413                                                                                      |
| 8    | `preview.ts:228`                   | `FILE_TOO_LARGE`   | 400  | 413  | **可能有意**。这是“已有文件过大不能在线预览”，不是请求体过大，413 语义不贴切                                                                                                     | 建议**保留 400** 并加注释说明为例外；若要全站统一则改 413（需产品确认）                                             |
| 9-12 | `share.ts:635 / 793 / 1102 / 1284` | `FILE_TOO_LARGE`   | 400  | 413  | 同第 8 条，文案均为“文件过大，请下载后查看”                                                                                                                                      | 同上，**保留 400** + 注释                                                                                           |
| 13   | `share.ts:1491`                    | `VALIDATION_ERROR` | 403  | 400  | **bug**。“此上传链接最多允许 N 个文件，已达上限”对应码表里现成的 `SHARE_UPLOAD_LIMIT_EXCEEDED`（S005，403）                                                                      | 改 `throwAppError('SHARE_UPLOAD_LIMIT_EXCEEDED', ...)`，**保留 403**                                                |

### 2.1 无字面量状态码（3 处，真 bug）

| 文件:行     | 码键       | 实际 HTTP | 应有 |
| ----------- | ---------- | --------- | ---- |
| `ai.ts:103` | `CONFLICT` | **200**   | 409  |
| `ai.ts:321` | `CONFLICT` | **200**   | 409  |
| `ai.ts:399` | `CONFLICT` | **200**   | 409  |

三处均为 `/index/all`、`/summarize/batch`、`/tags/batch` 里“已有同类任务正在运行”，调用 `c.json(obj)` 时漏传状态码，于是 HTTP 200 携带 `success:false`。同文件的 `/index/rebuild`（`ai.ts:166` 附近）已经用 `throwAppError('CONFLICT', ...)`，属同一模板复制遗漏。

**影响**：只按 HTTP 状态判断的客户端会把失败当成功；`requestId`/`timestamp` 也缺失。

**改法**：直接 `throwAppError('CONFLICT', '已有索引任务正在运行，请等待完成')`，一次性修掉状态码与响应结构。

> 建议优先处理这 3 条 —— 改造成本最低、危害最明确。

## 3. 位于 try 块内的残留（37 处）

codemod 一律跳过，但**两类情况风险完全不同**：

- **catch 块内（21 处）**：把 `return c.json(..., 500)` 换成 `throw` 是**行为等价**的（全局 `errorHandler` 会生成同样的 500 + `INTERNAL_ERROR` 结构），只是补上了 `name/requestId/timestamp`。可以安全转换。
- **try 主体内（16 处）**：直接 `throw` 会被**同一个 try 的 catch 捕获**，再被改写成 500，业务状态码（404/400）会丢失 —— 必须改造。

### 3.1 try 主体内（16 处，需要改造后再转）

所有 16 处所在的 handler，其 catch 都是“记日志 + 返回 500”。因此共同改法有两种，任选其一：

- **方案 A（推荐，一次性）**：在该 handler 的 `catch` 首行加 `if (error instanceof AppError) throw error;`，后续 throw 即可透传到全局处理器。当前 `routes/` 下还没有任何文件用这个模式（`grep "instanceof AppError"` 仅命中 `middleware/error.ts`），需要团队统一约定。
- **方案 B**：把校验前移到 `try` 之外。

| 文件:行                  | 码键               | 现状                               | 改造建议                                                                    |
| ------------------------ | ------------------ | ---------------------------------- | --------------------------------------------------------------------------- |
| `aiChatRoutes.ts:208`    | `NOT_FOUND`        | try 内查会话不存在                 | 方案 A（catch 在 219 行）                                                   |
| `aiChatRoutes.ts:498`    | `NOT_FOUND`        | try 内“记忆不存在”                 | 方案 A（catch 在 503 行）                                                   |
| `aiConfigRoutes.ts:945`  | `NOT_FOUND`        | try 内“模型不存在”                 | 方案 A（`POST /test` 的 catch 返回 500 且带 `data` 字段，见 §3.3 注意事项） |
| `aiConfigRoutes.ts:960`  | `NOT_FOUND`        | try 内“供应商不存在”               | 同上                                                                        |
| `aiConfigRoutes.ts:998`  | `VALIDATION_ERROR` | try 内参数缺失                     | 同上；**该分支本可不进 try**（纯参数判断），方案 B 更干净                   |
| `aiConfigRoutes.ts:1010` | `VALIDATION_ERROR` | try 内模型 ID 格式非法             | 同上，方案 B 可行                                                           |
| `aiConfigRoutes.ts:1105` | `NOT_FOUND`        | try 内“配置项不存在”               | 方案 A（`PUT /system-config/:key`）                                         |
| `aiConfigRoutes.ts:1110` | `VALIDATION_ERROR` | try 内配置值校验失败               | 方案 A                                                                      |
| `aiConfigRoutes.ts:1122` | `NOT_FOUND`        | try 内 `updateAiConfig` 返回 false | 方案 A                                                                      |
| `aiConfigRoutes.ts:1146` | `NOT_FOUND`        | try 内“配置项不存在”（reset）      | 方案 A                                                                      |
| `tasks.ts:764`           | `VALIDATION_ERROR` | try 内“任务缺少存储桶ID”           | 方案 A（catch 在 1196）                                                     |
| `tasks.ts:801`           | `VALIDATION_ERROR` | try 内“文件尚未上传完成”           | 方案 A                                                                      |
| `tasks.ts:927`           | `VALIDATION_ERROR` | try 内“分片未全部完成”             | 方案 A                                                                      |
| `tasks.ts:943`           | `VALIDATION_ERROR` | try 内“分片记录不完整”             | 方案 A                                                                      |
| `tasks.ts:1067`          | `VALIDATION_ERROR` | try 内“etag 不能为空”              | 方案 A                                                                      |
| `tasks.ts:1074`          | `VALIDATION_ERROR` | try 内“分片数量不匹配”             | 方案 A                                                                      |

### 3.2 catch 块内（21 处，可直接转）

| 文件                | 行                                             | 数量 | 说明                                                                                                                            |
| ------------------- | ---------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| `aiChatRoutes.ts`   | 185, 219, 387, 429, 447, 470, 486, 503         | 8    | 均为 handler 级 catch → 500                                                                                                     |
| `aiConfigRoutes.ts` | 533, 660, 687, 740, 799, 926, 1087, 1134, 1155 | 9    | 均为 handler 级 catch → 500                                                                                                     |
| `batch.ts`          | 362                                            | 1    | 只包住 `assertZipLimits()`，catch 后半段无清理逻辑，直接 `throwAppError('VALIDATION_ERROR', msg)` 即可（注意不要再包 `return`） |
| `files.ts`          | 371                                            | 1    | 同 `batch.ts:362`，`assertZipLimits` 的 catch                                                                                   |
| `share.ts`          | 974                                            | 1    | 同 `batch.ts:362`，`assertZipLimits` 的 catch                                                                                   |
| `tasks.ts`          | 1196                                           | 1    | `completeTask` 的外层 catch；catch 内已先 `logger.error`，改为 `throwAppError('INTERNAL_ERROR', '完成上传任务失败')` 等价       |

**注意**：`ai.ts` 的若干 catch（如 `ai.ts:148-153`）已在 `markTaskFailed(...)` 之后改为 `throwAppError`，说明“catch 内先做清理再 throw”的模式在本仓库已被接受，可直接推广。

### 3.3 两个需要留意的细节

1. `aiConfigRoutes.ts` 的 `POST /test` catch 返回体带顶层 `data: { valid:false, ... }`。若改成 throw，前端就拿不到这个 `data`，需要改用 `new AppError('...', { details: { valid:false, ... } })` 并确认前端读的是 `details`。**属于会改变响应结构，需人工确认**。
2. `batch.ts:362` / `files.ts:371` / `share.ts:974` 三个 catch 只包 `assertZipLimits()`，函数抛的是普通 `Error`；改成 `throwAppError('VALIDATION_ERROR', ...)` 后状态码仍为 400，语义等价。

## 4. 字面错误码清单（57 处 / 去重 30 个码）

`码表现状` 列的判定依据：键名是否已在 `ERROR_CODES` 中存在（**注意**：`throwAppError` 接收的是**键名**，不是 code 字符串；`AppError.name` 也用键名）。

| #   | 字面码                             | 次数 | 位置                                                                                                                                      | 码表现状                                               | 建议归属                                                                                                                                                                                                  | 建议 httpStatus                                              |
| --- | ---------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `NO_STORAGE`                       | 12   | `directLink.ts:329,414`（500）<br>`files.ts:573,1325`（400）<br>`preview.ts:282,391,484`（500）<br>`tasks.ts:144,452,552,760,1315`（400） | 无同名键；近似 `NO_STORAGE_CONFIGURED`（F505，500）    | **需人工确认**：500 的 5 处并入 `NO_STORAGE_CONFIGURED` 即可；400 的 7 处是“用户还没配桶”，用 500 也算合理，但会改变前端提示路径。若坚持 400，建议新增 `STORAGE_NOT_CONFIGURED`                           | 400（新增 `STORAGE_NOT_CONFIGURED` 时）/ 500（沿用 F505 时） |
| 2   | `TG_REF_NOT_FOUND`                 | 4    | `directLink.ts:295,380`（404）<br>`files.ts:197,259`（404）                                                                               | **已存在** `TG_REF_NOT_FOUND`（TG03，404）             | 直接 `throwAppError('TG_REF_NOT_FOUND', ...)`                                                                                                                                                             | 404（不变）                                                  |
| 3   | `BUCKET_IN_USE`                    | 3    | `buckets.ts:408,516,541`（409）                                                                                                           | **已存在** `BUCKET_IN_USE`（B401，**400**）            | 键存在但状态码冲突：直接转换会把 409 变 400。语义上“桶仍被引用，不能停用/删除”是冲突                                                                                                                      | 建议把码表 B401 改为 **409**，然后直接转换                   |
| 4   | `FETCH_FAILED`                     | 3    | `share.ts:1114,1236,1304`（502）                                                                                                          | 无同名键；近似 `BUCKET_CONNECTION_FAILED`（F502，502） | 上游拉取失败。建议并入 `BUCKET_CONNECTION_FAILED`；若要保留可读性则新增 `FETCH_FAILED`                                                                                                                    | 502（不变）                                                  |
| 5   | `TG_CONFIG_ERROR`                  | 3    | `files.ts:530,1290`（500）<br>`tasks.ts:632`（404）                                                                                       | **已存在** `TG_CONFIG_ERROR`（TG04，500）              | 500 的两处直接转；`tasks.ts` 那一处文案是“找不到 Telegram 存储桶”，实际是桶不存在                                                                                                                         | 500（不变）；404 那处建议改 `BUCKET_NOT_FOUND`               |
| 6   | `AUDIT_FAILED`                     | 2    | `admin.ts:934,1037`（500）                                                                                                                | 无                                                     | 运维动作失败，建议复用 `INTERNAL_ERROR`（G000），message 已含原因；或新增 `STORAGE_AUDIT_FAILED`                                                                                                          | 500                                                          |
| 7   | `FILE_NOT_EDITABLE`                | 2    | `files.ts:1754,1830`（400）                                                                                                               | 无；近似 `FILE_PREVIEW_NOT_SUPPORTED`（F008，400）     | “此类型不支持在线编辑”。建议新增 `FILE_NOT_EDITABLE`（F106）以保留语义                                                                                                                                    | 400（新增时）                                                |
| 8   | `FILE_TOO_LARGE`                   | 2    | `files.ts:1765,1845`（400）                                                                                                               | **已存在** `FILE_TOO_LARGE`（F001，**413**）           | 在线编辑 1MB 上限，属“内容过大”而非请求体过大；转换后变 413。建议**保留 400** 并注释                                                                                                                      | 400（保留）                                                  |
| 9   | `TAG_EXISTS`                       | 2    | `permissions.ts:567,826`（409）                                                                                                           | 无；近似 `PERMISSION_ALREADY_EXISTS`（P400，409）      | 建议新增 `TAG_ALREADY_EXISTS`（409）；若不愿加键，用 `CONFLICT`（G409，409）                                                                                                                              | 409                                                          |
| 10  | `TG_REF_MISSING`                   | 2    | `files.ts:586,1336`（500）                                                                                                                | 无同名键；与 TG03 语义相近                             | 语义是“去重引用记录缺失”= 数据不一致，用 404 会误导客户端。建议新增 `TG_REF_MISSING`（500），不要并入 TG03                                                                                                | 500（新增时）                                                |
| 11  | `TG_UPLOAD_ERROR`                  | 2    | `tasks.ts:657,690`（500）                                                                                                                 | 无；与 `TG_UPLOAD_FAILED`（TG00，502）重复             | 明显是同一语义的两种拼写，建议并入 `TG_UPLOAD_FAILED`。**状态会 500 → 502**（502 更准确：上游失败）                                                                                                       | 502（并入后）                                                |
| 12  | `TG_UPLOAD_FAILED`                 | 2    | `files.ts:548,1300`（502）                                                                                                                | **已存在** `TG_UPLOAD_FAILED`（TG00，502）             | 直接转换                                                                                                                                                                                                  | 502（不变）                                                  |
| 13  | `ALERT_NOT_CONFIGURED`             | 1    | `cron.ts:128`（400）                                                                                                                      | 无                                                     | “缺 ALERT_TG_BOT_TOKEN 等 Secret”属服务端配置缺失，400 不贴切。建议新增键并改 500                                                                                                                         | 500（建议）/ 400（保留）                                     |
| 14  | `ALERT_SEND_FAILED`                | 1    | `cron.ts:148`（502）                                                                                                                      | 无                                                     | 建议新增 `ALERT_SEND_FAILED`                                                                                                                                                                              | 502                                                          |
| 15  | `AUDIT_NEEDED`                     | 1    | `admin.ts:1093`（400）                                                                                                                    | 无                                                     | 与 `AUDIT_REQUIRED` 是同一件事的两种拼写，**建议合并**                                                                                                                                                    | 400 或 409 需定                                              |
| 16  | `AUDIT_REQUIRED`                   | 1    | `admin.ts:1163`（409）                                                                                                                    | 无                                                     | 建议保留 `AUDIT_REQUIRED` 一个键；`AUDIT_NEEDED` 改为它                                                                                                                                                   | 409                                                          |
| 17  | `BAD_REQUEST`                      | 1    | `admin.ts:1062`（400）                                                                                                                    | 无                                                     | 文案“缺少 bucketId”，应改用 `MISSING_PARAMETER`（G101，400）                                                                                                                                              | 400（不变）                                                  |
| 18  | `BUCKET_CONFIG_ERROR`              | 1    | `admin.ts:1076`（500）                                                                                                                    | 无同名键                                               | “无法解析存储桶配置”。建议新增 `BUCKET_CONFIG_ERROR`；若不想加键用 `INTERNAL_ERROR`                                                                                                                       | 500                                                          |
| 19  | `BUCKET_IS_DEFAULT`                | 1    | `buckets.ts:391`（409）                                                                                                                   | 无                                                     | 建议新增 `BUCKET_IS_DEFAULT`（409）；或并入 `BUCKET_IN_USE`（同为“不能停用”）                                                                                                                             | 409                                                          |
| 20  | `BUCKET_LAST_ACTIVE`               | 1    | `buckets.ts:423`（409）                                                                                                                   | 无                                                     | 建议并入 `BUCKET_IN_USE` 或新增专用键                                                                                                                                                                     | 409                                                          |
| 21  | `BUCKET_NOT_FOUND`                 | 1    | `files.ts:2218`（404）                                                                                                                    | **已存在** `BUCKET_NOT_FOUND`（F501，404）             | 直接转换                                                                                                                                                                                                  | 404（不变）                                                  |
| 22  | `BUCKET_SWITCH_REQUIRES_MIGRATION` | 1    | `files.ts:2241`（409）                                                                                                                    | 无                                                     | 建议新增同名键（保留可读的错误码）；额外字段 `inheritedFiles` 走 `details`                                                                                                                                | 409                                                          |
| 23  | `CROSS_BUCKET`                     | 1    | `files.ts:1978`（409）                                                                                                                    | 无                                                     | **前端 `apps/web/src/pages/Files.tsx:1877` 精确比较 `code === 'CROSS_BUCKET'`**，新增键时必须保持 code 字符串为 `CROSS_BUCKET`，否则前端跳转会失效。额外字段 `sourceBucketId/targetBucketId` 走 `details` | 409                                                          |
| 24  | `DUPLICATE_MODEL`                  | 1    | `aiConfigRoutes.ts:463`（409）                                                                                                            | 无；近似 `CONFLICT`（G409，409）                       | 建议用 `CONFLICT`；如需区分可新增 `MODEL_ALREADY_EXISTS`                                                                                                                                                  | 409                                                          |
| 25  | `EMAIL_SEND_FAILED`                | 1    | `admin.ts:556`（500）                                                                                                                     | **已存在** `EMAIL_SEND_FAILED`（A407，500）            | 直接转换                                                                                                                                                                                                  | 500（不变）                                                  |
| 26  | `FILE_ALREADY_EXISTS`              | 1    | `files.ts:1707`（409）                                                                                                                    | **已存在** `FILE_ALREADY_EXISTS`（F400，409）          | 直接转换（message 来自 `renameResult.error`）                                                                                                                                                             | 409（不变）                                                  |
| 27  | `S3_ERROR`                         | 1    | `tasks.ts:1091`（500）                                                                                                                    | 无；近似 `BUCKET_CONNECTION_FAILED`（F502，502）       | 合并分片失败，属上游 S3 失败。建议并入 `BUCKET_CONNECTION_FAILED` 或新增 `S3_ERROR`                                                                                                                       | 502（并入后）/ 500（保留）                                   |
| 28  | `TG_DOWNLOAD_FAILED`               | 1    | `files.ts:274`（502）                                                                                                                     | **已存在** `TG_DOWNLOAD_FAILED`（TG01，502）           | 直接转换                                                                                                                                                                                                  | 502（不变）                                                  |
| 29  | `VALIDATION_ERROR`                 | 1    | `files.ts:2193`（400）                                                                                                                    | **已存在** `VALIDATION_ERROR`（G100，400）             | 这里写的是字面量 `'VALIDATION_ERROR'`（恰好等于键名但形态不对），换成 `throwAppError('VALIDATION_ERROR', '缺少 targetBucketId')`                                                                          | 400（不变）                                                  |
| 30  | `VERSION_CLEANUP_FAILED`           | 1    | `cron.ts:75`（500）                                                                                                                       | 无                                                     | 建议新增 `VERSION_CLEANUP_FAILED`（V005）；或用 `INTERNAL_ERROR`                                                                                                                                          | 500                                                          |

### 4.1 非字面量、codemod 无法处理的 2 处

| 文件:行         | 形态                                                                                                                  | 说明                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `files.ts:1722` | `code: (ERROR_CODES[errorCode as keyof typeof ERROR_CODES] ?? ERROR_CODES.VALIDATION_ERROR).code`，状态码为三元表达式 | 运行时才确定码。建议改成 `throwApiError({ code, message })`（`middleware/error.ts` 已有按 code 反查键名的能力），或显式 `if/else` 分支 |
| `files.ts:2000` | 同上                                                                                                                  | 同上                                                                                                                                   |

> 附注：同类问题在 `aiConfigRoutes.ts` 曾有一处（`code: status === 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_ERROR` 的包装函数），快照前已被并行任务重构为 `errorResponse()`（按 HTTP 状态 `throw new AppError(...)`），可作为 §4.1 改造的参考实现。

**注意**：`middleware/error.ts` 的 `throwApiError` 遇到未登记 code 会降级为 `INTERNAL_ERROR`，因此把 `'CROSS_BUCKET'`、`'TG_REF_MISSING'` 这类字面码直接交给 `throwApiError` 会丢掉原 code —— 必须先登记到 `ERROR_CODES`。

### 4.2 剩余 1 处透传值

`share.ts:309`：`error:` 是变量而非对象字面量，需看该变量的类型决定是否可用 `throwApiError`。**需人工确认**。

## 5. 结论与建议

### 5.1 下一批值得修（按性价比排序）

1. **`ai.ts` 的 3 处“无状态码”CONFLICT**（`:103/:321/:399`）—— 现状是 HTTP 200 + `success:false`，属明确 bug，一行改动即可，收益最高。
2. **`ai.ts` 的 5 处 503/500 错位**（`:87/:159/:305/:383/:492`）—— 换成 `SERVICE_UNAVAILABLE` 保留 503，同时让响应体 code 与 HTTP 状态自洽。
3. **`share.ts:1491` 改用 `SHARE_UPLOAD_LIMIT_EXCEEDED`**、**`aiChatRoutes.ts:165` 改用 `CONFLICT`** —— 两者码表里已有精确对应的键，零新增成本。
4. **`files.ts:455` 的 `FILE_TOO_LARGE` 改 413** —— 与同文件其它调用保持一致，前端已有 413 文案。
5. **登记 4 个高频缺键码**：`NO_STORAGE`（12 次）、`TG_REF_MISSING`（2）、`CROSS_BUCKET`（1，必须保字面名）、`BUCKET_SWITCH_REQUIRES_MIGRATION`（1，需 `details`）—— 一次性消掉 16 处。
6. **catch 内 21 处**可直接转，风险低；建议先做一个文件（如 `aiConfigRoutes.ts`）验证行为一致后再推广。

### 5.2 建议保持现状（或只加注释）

- `preview.ts:228` 与 `share.ts:635/793/1102/1284` 的 `FILE_TOO_LARGE` 400：这是“已有文件过大不能预览/需下载”，不是请求体过大，413 反而不准。建议保留 400，并在代码旁注明“有意为之，避免 codemod 反复命中”。
- `files.ts:1765/1845`：同理，在线编辑 1MB 限制保留 400。
- `files.ts:1722/2000` 的动态码：重构收益低于风险（`serviceMoveFile` 的错误映射本身是字符串匹配），可暂留。

### 5.3 需要产品/后端负责人拍板的两件事

1. **`NO_STORAGE` 的 400 vs 500**：12 处里 7 处 400、5 处 500。统一成 500 会让“用户还没配桶”看起来像服务故障；统一成 400 又与原 `NO_STORAGE_CONFIGURED`（F505=500）冲突。建议统一为 400 并新增 `STORAGE_NOT_CONFIGURED`（F507），把 F505 留给真正的服务端异常。
2. **`BUCKET_IN_USE` 码表写 400，但 3 处调用都返回 409**：这是码表与实现的既存分歧。若以后有人用 `throwAppError('BUCKET_IN_USE')`，会静默从 409 变 400 —— 建议直接把码表 B401 改成 409。

### 5.4 流程建议

- 建议在 codemod 里加两条白名单：`catch` 块内的 `return c.json(..., 500)`（等价安全）与 `FILE_TOO_LARGE` 预览场景（保留 400），否则每轮扫描都会重复报同一批噪音。
- 建议对新增错误码统一加一条 ESLint 规则或脚本检查：`routes/` 下不允许出现 `code: '<字面量>'`，避免改造完成后又回潮。

---

## 6. 执行结果（2026-11-22 收尾）

分两轮执行：先转机械可转换项（190 处），再补齐错误码后一次性收口剩余全部。

| 轮次   | 内容                                                                                   | 处数 |
| ------ | -------------------------------------------------------------------------------------- | ---- |
| 第一轮 | codemod 机械转换（状态与码表一致、非 try、非字面码）                                   | 190  |
| 第一轮 | share/notes 透传（新增 `throwApiError`）、ai 额外字段、可映射字面码                    | 48   |
| 第二轮 | catch 块内直接转（行为等价）                                                           | 21   |
| 第二轮 | 补齐 20 个缺失错误码后，字面码全部映射                                                 | 59   |
| 第二轮 | try 主体内：catch 首行插入 `if (e instanceof AppError) throw e` 后转换                 | 19   |
| 第二轮 | 动态码（moveFile 的 errorMap）改用 `throwAppError`                                     | 2    |
| 第二轮 | 预览/编辑场景 `FILE_TOO_LARGE` → `PREVIEW_TOO_LARGE` / `FILE_EDIT_TOO_LARGE`（仍 400） | 5    |
| 第二轮 | 单独修正：上传限额改 S005、Telegram 连接测试、ai 状态码                                | 7    |

**最终进度：349 → 0**（`routes/` 内不再有手写 `c.json({ success: false })`，只剩 `success: true` 与 DB 字段）。
`routes/` 下 `throwAppError` 687 处 + `new AppError` 10 处。

### 6.1 错误码表变更

新增 20 个码（遵守 `[模块][序号]` 约定）：

| 模块                     | 新增                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F（存储/文件）           | `F507` STORAGE_NOT_CONFIGURED(400)、`F508` STORAGE_FETCH_FAILED(502)、`F509` STORAGE_AUDIT_FAILED(500)、`F510` STORAGE_AUDIT_NEEDED(400)、`F511` STORAGE_AUDIT_REQUIRED(409)、`F512` FILE_NOT_EDITABLE(400)、`F513` PREVIEW_TOO_LARGE(400)、`F514` S3_ERROR(500)、`F515` FILE_EDIT_TOO_LARGE(400) |
| B（存储桶）              | `B403` BUCKET_IS_DEFAULT(409)、`B404` BUCKET_LAST_ACTIVE(409)、`B405` BUCKET_CONFIG_ERROR(500)、`B406` BUCKET_SWITCH_REQUIRES_MIGRATION(409)、`B407` CROSS_BUCKET(409)                                                                                                                            |
| TG                       | `TG07` TG_REF_MISSING(500)、`TG08` TG_BUCKET_NOT_FOUND(404)                                                                                                                                                                                                                                       |
| P / I / V                | `P402` TAG_EXISTS(409)、`I503` DUPLICATE_MODEL(409)、`V402` VERSION_CLEANUP_FAILED(500)                                                                                                                                                                                                           |
| X（系统/告警，新增区段） | `X001` ALERT_NOT_CONFIGURED(400)、`X002` ALERT_SEND_FAILED(502)                                                                                                                                                                                                                                   |

**修正**：`BUCKET_IN_USE` 的 httpStatus 从 400 改为 **409**（实现一直返回 409，之前一旦有人用 `throwAppError` 会静默降级）。
**语义拆分**：`NO_STORAGE` 拆成「用户未配桶」`F507/400` 与「服务端无可用配置」`F505/500`；`TG_CONFIG_ERROR` 的 404 场景改用 `TG08/404`。

### 6.2 前端契约同步

- `Files.tsx` 的跨桶引导：`code === 'CROSS_BUCKET'` → `ERROR_CODES.CROSS_BUCKET.code`，补充字段改读 `error.details.{sourceBucketId,targetBucketId}`。
- `Register.tsx` 的四个注册态判断改用 `ERROR_CODES.*.code`（码表新增 A106/A107/A108/A204）。

### 6.3 顺带修掉的三个真 bug

1. **`aiConfigRoutes.ts` 的 `errorResponse()` 把整个错误码对象塞进 `code`**：响应变成 `error.code = { code:'G000', httpStatus:500, ... }`，前端拿不到字符串码；且 409 被标成 VALIDATION_ERROR。已按 HTTP 状态映射到 UNAUTHORIZED/FORBIDDEN/NOT_FOUND/CONFLICT/VALIDATION_ERROR/INTERNAL_ERROR。
2. **`buckets.ts` Telegram 连接测试失败返回 HTTP 200 + success:false**：同函数下方的 S3 分支本来就正确抛错。已改为 `throwAppError('BUCKET_CONNECTION_FAILED')`。
3. **注册页四个错误分支是死代码**：前端比较 `REGISTRATION_CLOSED` / `INVITE_CODE_*`，后端只返回 FEATURE_DISABLED / VALIDATION_ERROR，导致「注册已关闭」「邀请码无效」永远显示通用错误。已在码表新增 A204/A106/A107/A108 并前后端同时改用。

### 6.4 仍存在的差异（有意保留）

- `TG_UPLOAD_ERROR`（原 500）并入 `TG_UPLOAD_FAILED`（502），属语义纠正（上游失败），2 处状态从 500 变 502。
- 汉字错误信息与英文错误码并存：`code` 面向程序、`message` 面向用户，不再统一。

### 6.5 补充修复：`details` 在生产环境被丢弃

统一过程中发现 `createErrorResponse` 的 `details: isDev ? error.details : undefined`——`AppError` 显式给出的业务 `details`（如跨桶移动的 `sourceBucketId` / `targetBucketId`）在线上会被剥掉，前端跨桶引导拿不到数据。

已改为：**`AppError` 分支始终返回 `details`**；未捕获异常的 `details` 与 `stack` 仍然只在开发环境暴露。这样「业务细节」与「内部堆栈」的边界才正确。
