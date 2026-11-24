# drizzle-orm 0.29 → 0.45.4 升级与回滚手册

对应方案 `2026-11-23-comprehensive-audit-and-upgrade-plan.md` Phase 2 / 2.1（消除 CVE-2026-39356）。

## 本次变更面
- `drizzle-orm` ^0.29.0 → ^0.45.4；`drizzle-kit` ^0.20 → ^0.31（仅 studio/generate 使用，运行时不依赖）。
- 新增 `@types/node` 并在 `apps/api/tsconfig.json` 的 `types` 加入 `node`：此前测试文件的 `node:fs` 等类型是靠 drizzle 0.29 的传递引用碰巧可用，升级后暴露，属于隐式依赖显式化。
- **无 schema / 迁移 / 数据变更**，所以回滚不涉及数据库。

## 升级前的验证（已做）
- `pnpm typecheck`：源码 0 个类型错误（API diff 无需改业务代码）。
- `pnpm test`：全部通过，其中 dedup / schema 漂移用例是在**真实迁移后的 SQLite** 上经 drizzle 0.45 执行。
- `wrangler deploy --dry-run`：Worker 可正常打包。
- `pnpm audit:gate`：prod high=0，drizzle 豁免已删除。

## 未覆盖（部署后请人工冒烟）
真实 D1 上的以下路径（顺序即优先级）：登录 → 文件列表/搜索 → 上传（预签名）→ 删除/回收站 → 分享访问 → AI 对话与模型列表 → 每日 cron（可在 CF 控制台手动触发 scheduled）。
重点看 Worker 日志里是否出现 `no such column` / `SQLITE_ERROR` / `D1_ERROR`。

## 回滚
```
git revert <本次升级提交>   # 恢复 package.json / pnpm-lock.yaml / tsconfig
git push origin main        # 触发 deploy workflow 重新部署
```
注意：恢复后审计门禁会因 drizzle CVE 失败，需要同时在 `scripts/audit-exemptions.json` 临时加回豁免（带 followUp），否则 CI 会拦住回滚部署。
