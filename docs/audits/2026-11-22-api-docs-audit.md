# API 文档元数据审计（2026-11-22）

> 范围：`apps/api/src/routes/docs.ts` 的 `routeMetadata` 与 `apps/api/src/index.ts` 实际挂载的路由。
> 方法：静态解析（`app.route(prefix, router)` + 各 router 内 `app.<method>('/path')`），脚本 `.workbuddy/tools/audit-api-docs.mjs`，可重复执行。

## 结论

| 指标                           | 数量  |
| ------------------------------ | ----- |
| 挂载的 router                  | 32    |
| 实际路由                       | 315   |
| 已登记元数据                   | 133   |
| 死条目（元数据有、路由无）     | **0** |
| 未登记对外路由                 | 174   |
| 内部路由（/dav /cron /agents） | 8     |

## 本次修复：24 条死元数据

这些条目指向的路由已改名或删除，导致文档里出现点不开的接口。处理方式分三类：

| 处理                         | 条目                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 改名（路由已迁移）           | auth/verify-email→verify-code、search(POST)→search/advanced、versions 3 条、notes 3 条、admin 6 条（邀请码/审计/邮件）、ai-chat 4 条、migrate/tasks→/:migrationId |
| 删除（功能已下线或语义已变） | auth/refresh、versions/create、analytics/type-distribution、ai(POST)、ai-chat/chat、ai-chat/sessions/:id（GET）                                                   |
| 方法变更                     | admin/mail/config：POST → PUT /admin/email/config                                                                                                                 |

修复后死条目为 **0**，并新增静态守卫 `apps/api/src/routes/docs.metadata.test.ts`：任何元数据键对应不到真实路由都会让测试失败。

## 未登记路由（文档中不可见）

共 174 条。按文件分布：

| 文件              | 条数 |
| ----------------- | ---- |
| ai.ts             | 24   |
| aiConfigRoutes.ts | 20   |
| tasks.ts          | 14   |
| share.ts          | 13   |
| admin.ts          | 11   |
| teams.ts          | 11   |
| files.ts          | 9    |
| downloads.ts      | 9    |
| aiChatRoutes.ts   | 9    |
| permissions.ts    | 8    |
| search.ts         | 5    |
| directLink.ts     | 5    |
| notifications.ts  | 5    |
| auth.ts           | 3    |
| buckets.ts        | 3    |
| batch.ts          | 3    |
| versions.ts       | 3    |
| preview.ts        | 2    |
| migrate.ts        | 2    |
| notes.ts          | 2    |
| groups.ts         | 2    |
| webhooks.ts       | 2    |
| aiUsageRoutes.ts  | 2    |
| analytics.ts      | 2    |
| docs.ts           | 2    |
| presign.ts        | 1    |
| apiKeys.ts        | 1    |
| index.ts          | 1    |

明细：

### ai.ts

| 方法   | 路径                                 |
| ------ | ------------------------------------ |
| GET    | `/api/ai/status`                     |
| POST   | `/api/ai/index/all`                  |
| POST   | `/api/ai/index/rebuild`              |
| GET    | `/api/ai/tasks/failed-items`         |
| GET    | `/api/ai/index/status`               |
| DELETE | `/api/ai/index/task`                 |
| POST   | `/api/ai/summarize/batch`            |
| GET    | `/api/ai/summarize/task`             |
| POST   | `/api/ai/tags/batch`                 |
| DELETE | `/api/ai/summarize/batch`            |
| DELETE | `/api/ai/tags/batch`                 |
| GET    | `/api/ai/tags/task`                  |
| POST   | `/api/ai/process-selected`           |
| GET    | `/api/ai/index/stats`                |
| GET    | `/api/ai/index/vectors`              |
| POST   | `/api/ai/index/vectors/batch-delete` |
| DELETE | `/api/ai/index/vectors/all`          |
| GET    | `/api/ai/index/sample/:fileId`       |
| DELETE | `/api/ai/index/:fileId`              |
| POST   | `/api/ai/search`                     |
| POST   | `/api/ai/summarize/:fileId`          |
| POST   | `/api/ai/tags/:fileId`               |
| POST   | `/api/ai/rename-suggest/:fileId`     |
| POST   | `/api/ai/name-suggest`               |

### aiConfigRoutes.ts

| 方法   | 路径                                               |
| ------ | -------------------------------------------------- |
| GET    | `/api/ai-config/ai-providers`                      |
| PUT    | `/api/ai-config/providers/:providerId`             |
| DELETE | `/api/ai-config/providers/:providerId`             |
| POST   | `/api/ai-config/providers/:providerId/set-default` |
| POST   | `/api/ai-config/providers/:providerId/test`        |
| GET    | `/api/ai-config/providers/:providerId/models`      |
| POST   | `/api/ai-config/providers/:providerId/models`      |
| GET    | `/api/ai-config/catalog-status`                    |
| POST   | `/api/ai-config/catalog-sync`                      |
| DELETE | `/api/ai-config/catalog-snapshot`                  |
| PUT    | `/api/ai-config/models/:modelId`                   |
| DELETE | `/api/ai-config/models/:modelId`                   |
| POST   | `/api/ai-config/models/:modelId/activate`          |
| GET    | `/api/ai-config/workers-ai/models`                 |
| GET    | `/api/ai-config/status`                            |
| GET    | `/api/ai-config/feature-config`                    |
| PUT    | `/api/ai-config/feature-config`                    |
| POST   | `/api/ai-config/test`                              |
| PUT    | `/api/ai-config/system-config/:key`                |
| POST   | `/api/ai-config/system-config/:key/reset`          |

### tasks.ts

| 方法   | 路径                         |
| ------ | ---------------------------- |
| DELETE | `/api/tasks/clear-completed` |
| DELETE | `/api/tasks/clear-failed`    |
| POST   | `/api/tasks/start`           |
| POST   | `/api/tasks/part`            |
| POST   | `/api/tasks/part-done`       |
| POST   | `/api/tasks/part-proxy`      |
| POST   | `/api/tasks/telegram-part`   |
| POST   | `/api/tasks/complete`        |
| POST   | `/api/tasks/abort`           |
| GET    | `/api/tasks/:taskId`         |
| DELETE | `/api/tasks/:taskId`         |
| POST   | `/api/tasks/:taskId/pause`   |
| POST   | `/api/tasks/:taskId/retry`   |
| POST   | `/api/tasks/:taskId/resume`  |

### share.ts

| 方法 | 路径                                   |
| ---- | -------------------------------------- |
| POST | `/api/share/:id/folder/:folderId`      |
| GET  | `/api/share/:id/preview`               |
| GET  | `/api/share/:id/stream`                |
| GET  | `/api/share/:id/raw`                   |
| GET  | `/api/share/:id/preview-info`          |
| GET  | `/api/share/:id/download`              |
| GET  | `/api/share/:id/zip`                   |
| GET  | `/api/share/:id/file/:fileId/download` |
| GET  | `/api/share/:id/file/:fileId/preview`  |
| GET  | `/api/share/:id/file/:fileId/stream`   |
| GET  | `/api/share/:id/file/:fileId/raw`      |
| GET  | `/api/share/upload/:token`             |
| POST | `/api/share/upload/:token`             |

### admin.ts

| 方法   | 路径                                               |
| ------ | -------------------------------------------------- |
| GET    | `/api/admin/users/:id`                             |
| GET    | `/api/admin/registration`                          |
| PUT    | `/api/admin/registration`                          |
| DELETE | `/api/admin/registration/codes/:code`              |
| GET    | `/api/admin/ai/traces`                             |
| GET    | `/api/admin/ai/traces/:traceId`                    |
| GET    | `/api/admin/storage-audit`                         |
| GET    | `/api/admin/storage-reconcile`                     |
| POST   | `/api/admin/storage-audit/force`                   |
| POST   | `/api/admin/storage-audit/cleanup-orphans`         |
| GET    | `/api/admin/storage-audit/missing-files/:bucketId` |

### teams.ts

| 方法   | 路径                                   |
| ------ | -------------------------------------- |
| POST   | `/api/teams/:id/transfer`              |
| GET    | `/api/teams/:id/workspace/files`       |
| POST   | `/api/teams/:id/invites`               |
| GET    | `/api/teams/:id/invites`               |
| GET    | `/api/teams/:id/invites/all`           |
| DELETE | `/api/teams/:id/invites/:inviteId`     |
| POST   | `/api/teams/:id/invites/:token/accept` |
| GET    | `/api/teams/:id/activities`            |
| GET    | `/api/teams/:id/storage`               |
| POST   | `/api/teams/:id/workspace/folder`      |
| GET    | `/api/teams/:id/workspace/all-files`   |

### files.ts

| 方法   | 路径                      |
| ------ | ------------------------- |
| GET    | `/api/files/:id/zip`      |
| POST   | `/api/files/folders/size` |
| DELETE | `/api/files/trash/:id`    |
| POST   | `/api/files/create`       |
| GET    | `/api/files/:id/logs`     |
| GET    | `/api/files/:id/raw`      |
| PUT    | `/api/files/:id/content`  |
| PUT    | `/api/files/:id/settings` |
| PUT    | `/api/files/:id/bucket`   |

### downloads.ts

| 方法   | 路径                            |
| ------ | ------------------------------- |
| DELETE | `/api/downloads/completed`      |
| DELETE | `/api/downloads/failed`         |
| POST   | `/api/downloads/batch`          |
| GET    | `/api/downloads/:taskId`        |
| PATCH  | `/api/downloads/:taskId`        |
| DELETE | `/api/downloads/:taskId`        |
| POST   | `/api/downloads/:taskId/retry`  |
| POST   | `/api/downloads/:taskId/pause`  |
| POST   | `/api/downloads/:taskId/resume` |

### aiChatRoutes.ts

| 方法   | 路径                                      |
| ------ | ----------------------------------------- |
| POST   | `/api/ai-chat/ws-ticket`                  |
| POST   | `/api/ai-chat/sessions`                   |
| PUT    | `/api/ai-chat/sessions/:sessionId`        |
| GET    | `/api/ai-chat/sessions/:sessionId/export` |
| DELETE | `/api/ai-chat/sessions`                   |
| GET    | `/api/ai-chat/memories`                   |
| POST   | `/api/ai-chat/memories/batch-delete`      |
| DELETE | `/api/ai-chat/memories`                   |
| DELETE | `/api/ai-chat/memories/:id`               |

### permissions.ts

| 方法   | 路径                                 |
| ------ | ------------------------------------ |
| POST   | `/api/permissions/tags/create`       |
| POST   | `/api/permissions/tags/add`          |
| POST   | `/api/permissions/tags/remove`       |
| POST   | `/api/permissions/tags/batch`        |
| GET    | `/api/permissions/tags/file/:fileId` |
| GET    | `/api/permissions/tags/stats`        |
| PUT    | `/api/permissions/tags/rename`       |
| DELETE | `/api/permissions/tags/:tagName`     |

### search.ts

| 方法   | 路径                      |
| ------ | ------------------------- |
| GET    | `/api/search/suggestions` |
| GET    | `/api/search/recent`      |
| GET    | `/api/search/history`     |
| DELETE | `/api/search/history`     |
| DELETE | `/api/search/history/:id` |

### directLink.ts

| 方法   | 路径                         |
| ------ | ---------------------------- |
| GET    | `/api/direct/file/:fileId`   |
| DELETE | `/api/direct/:fileId`        |
| PUT    | `/api/direct/:fileId`        |
| GET    | `/api/direct/:token/info`    |
| GET    | `/api/direct/:token/preview` |

### notifications.ts

| 方法   | 路径                              |
| ------ | --------------------------------- |
| GET    | `/api/notifications/unread-count` |
| PUT    | `/api/notifications/:id/read`     |
| DELETE | `/api/notifications/read`         |
| DELETE | `/api/notifications/:id`          |
| GET    | `/api/notifications/stream`       |

### auth.ts

| 方法 | 路径                          |
| ---- | ----------------------------- |
| POST | `/api/auth/change-email`      |
| GET  | `/api/auth/email-preferences` |
| PUT  | `/api/auth/email-preferences` |

### buckets.ts

| 方法 | 路径                           |
| ---- | ------------------------------ |
| POST | `/api/buckets/:id/set-default` |
| POST | `/api/buckets/:id/toggle`      |
| POST | `/api/buckets/:id/test`        |

### batch.ts

| 方法 | 路径                          |
| ---- | ----------------------------- |
| POST | `/api/batch/permanent-delete` |
| POST | `/api/batch/restore`          |
| POST | `/api/batch/zip`              |

### versions.ts

| 方法  | 路径                                               |
| ----- | -------------------------------------------------- |
| GET   | `/api/versions/:fileId/versions/:version/download` |
| POST  | `/api/versions/:fileId/versions/:version/restore`  |
| PATCH | `/api/versions/:fileId/version-settings`           |

### preview.ts

| 方法 | 路径                      |
| ---- | ------------------------- |
| GET  | `/api/preview/:id/raw`    |
| GET  | `/api/preview/:id/stream` |

### migrate.ts

| 方法 | 路径                               |
| ---- | ---------------------------------- |
| POST | `/api/migrate/:migrationId/run`    |
| POST | `/api/migrate/:migrationId/cancel` |

### notes.ts

| 方法 | 路径                             |
| ---- | -------------------------------- |
| PUT  | `/api/notes/:fileId/:noteId`     |
| POST | `/api/notes/:fileId/:noteId/pin` |

### groups.ts

| 方法 | 路径                                         |
| ---- | -------------------------------------------- |
| PUT  | `/api/groups/:id/members/:memberUserId/role` |
| GET  | `/api/groups/:id/files`                      |

### webhooks.ts

| 方法 | 路径                     |
| ---- | ------------------------ |
| GET  | `/api/webhooks/events`   |
| POST | `/api/webhooks/:id/test` |

### aiUsageRoutes.ts

| 方法 | 路径                    |
| ---- | ----------------------- |
| GET  | `/api/ai/usage/summary` |
| GET  | `/api/ai/usage/quota`   |

### analytics.ts

| 方法 | 路径                           |
| ---- | ------------------------------ |
| GET  | `/api/analytics/storage-trend` |
| GET  | `/api/analytics/bucket-stats`  |

### docs.ts

| 方法 | 路径                |
| ---- | ------------------- |
| GET  | `/api/docs`         |
| GET  | `/api/openapi.json` |

### presign.ts

| 方法 | 路径                       |
| ---- | -------------------------- |
| GET  | `/api/presign/preview/:id` |

### apiKeys.ts

| 方法  | 路径            |
| ----- | --------------- |
| PATCH | `/api/keys/:id` |

### index.ts

| 方法 | 路径   |
| ---- | ------ |
| GET  | `/api` |

## 内部路由（默认不登记）

| 方法 | 路径                    |
| ---- | ----------------------- |
| POST | `/cron/trash-cleanup`   |
| POST | `/cron/session-cleanup` |
| POST | `/cron/share-cleanup`   |
| POST | `/cron/version-cleanup` |
| POST | `/cron/data-cleanup`    |
| POST | `/cron/reconcile`       |
| POST | `/cron/all`             |
| POST | `/cron/test-alert`      |

## 建议

1. **新增对外接口必须补一条 `routeMetadata`**，否则 `/api/docs` 里看不到（已在 AGENTS.md 的文档同步表里标注）。
2. 下列属于内部/调试用途，**不建议登记**：`/files/:id/raw`、`/files/:id/logs`、`/files/:id/zip`、`/share/:id/stream`、`/share/:id/raw` 等。
3. 若要补登记，按价值排序：`ai.ts`(24) / `aiConfigRoutes.ts`(20) / `tasks.ts`(14) / `share.ts`(13) / `admin.ts`(11) / `teams.ts`(11)。
4. 死条目守卫已自动化；未登记数量属于「待补描述」而非错误，不做断言，避免噪声。
