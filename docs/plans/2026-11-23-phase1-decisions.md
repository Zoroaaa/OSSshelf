# Phase 1 决策记录（2026-11-23）

对应升级方案 `2026-11-23-comprehensive-audit-and-upgrade-plan.md` §3.6 / Phase 1.2。

## xlsx / x-data-spreadsheet / pptx-preview

| 包 | 决策 | 原因 |
|---|---|---|
| `xlsx` 0.18.5 | **替换为 `exceljs`**（动态 import，仅预览 xlsx 时加载） | 方案首选 a)（SheetJS 官方 CDN tarball）在当前 CI/沙箱外网策略下无法稳定锁定 lockfile；exceljs 走 npm registry，可被 `pnpm audit` 持续跟踪。渲染改用 `textContent` 逐格构建 `<table>`，不再 `innerHTML` 拼 HTML，并限制 2000 行 × 50 列 |
| `x-data-spreadsheet` | **直接移除** | 全仓无任何 import（死依赖），同时消除 `opencollective→inquirer→tmp/minimist/node-fetch` 整条链 |
| `pptx-preview` | **保留 + 动态 import** | 仅预览 pptx 时才加载 echarts/lodash；`docx-preview` 同步改为动态 import |

### 已知取舍
- **旧版 `.xls`（BIFF）不再支持在线预览**：exceljs 不读 BIFF。预览会走降级提示「请下载查看」。需要恢复时，可在有外网的环境改用 SheetJS 官方 tarball（`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`）并仅对 `.xls` 动态加载。
- exceljs 带来 `brace-expansion` 传递依赖通告，已用 `pnpm.overrides` 固定到 ≥1.1.20 / ≥2.1.6。

## 其余 Phase 1 项
- 1.1 预览器懒加载：`filepreview/lazyPreviews.tsx`；highlight.js 拆到 `highlightCode.ts`，不再进入 `/files` 首屏依赖。
- 1.3 SW：`/api/*` 不进 SW、缓存版本升至 v4（激活时清掉 v3 遗留鉴权缓存）、登出清空全部 Cache Storage。
- 1.4 上传：批量上传整批结束统一失效一次；拖拽上传由串行改 3 并发。
- 1.5 下载：Files 页与团队空间统一走 `services/downloadFile.ts`；预签名直链原生流式；代理下载 >50MB 直接提示而不是 Blob 撑爆内存。
