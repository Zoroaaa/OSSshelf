# lint 门禁与基线冻结

- 本地：`pnpm lint`（约 15 秒）。CI：deploy-api 工作流中 `Lint gate` 步骤。
- 规则：**error 一律失败**；warning 以「文件 × 规则」计数，超过 `lint-baseline.json` 才失败（不记行号，改代码不会误报）。
- 清理存量后运行 `pnpm lint:baseline:update` 收紧基线（提交 diff 应只有数字减小/条目删除；出现增加说明在放行新问题，评审时拒绝）。
- 原始 ESLint 输出：`pnpm lint:raw`；自动修复：`pnpm lint:fix`。
- 配置：根目录 `eslint.config.mjs`（ESLint 9 flat + typescript-eslint 8，不含 eslint-plugin-prettier；格式用 `pnpm format:check`）。
- 范围：仅 `.ts/.tsx`（与旧配置一致，vendored 的 js/mjs 不检查）。
- 工具自测：`pnpm test:scripts`。
