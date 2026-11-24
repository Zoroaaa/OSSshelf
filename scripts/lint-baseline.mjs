#!/usr/bin/env node
/**
 * lint 门禁（基线冻结）
 *   node scripts/lint-baseline.mjs            检查：error 或超出基线的新增问题 → 退出码 1
 *   node scripts/lint-baseline.mjs --update   以当前结果重写基线（只应在“清理存量后收紧”时使用）
 *
 * 为什么不直接 --max-warnings 0：存量有数百条 warning（non-null 断言 / any），
 * 一次清完不现实；冻结基线能立刻挡住“新增”，同时让存量可以逐文件清理。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, compare, sortedObject } from './lint-baseline-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'lint-baseline.json');
const update = process.argv.includes('--update');

const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
const r = spawnSync(bin, ['.', '-f', 'json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
if (r.error || !r.stdout) {
  console.error('[lint] ESLint 运行失败：', r.error?.message ?? r.stderr);
  process.exit(2);
}
const { counts, errors } = summarize(JSON.parse(r.stdout), root);

if (errors.length > 0) {
  console.error(`[lint] 存在 ${errors.length} 个 error（error 不允许被基线冻结，必须修复）：`);
  for (const e of errors.slice(0, 50)) console.error(`  ${e.file}:${e.line}  ${e.rule}  ${e.message}`);
  if (errors.length > 50) console.error(`  … 另有 ${errors.length - 50} 个`);
  process.exit(1);
}

if (update) {
  writeFileSync(baselinePath, JSON.stringify(sortedObject(counts), null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`[lint] 基线已更新：${Object.keys(counts).length} 个 文件×规则 条目，共 ${total} 条 warning`);
  process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const { regressions, improvements } = compare(counts, baseline);

if (regressions.length > 0) {
  console.error(`[lint] 发现 ${regressions.length} 处新增/增长的问题（超出冻结基线）：`);
  for (const g of regressions) console.error(`  ${g.key}  基线 ${g.allowed} → 现在 ${g.actual}`);
  console.error('请修复它们；若确属必须保留，需在评审中说明后再运行 `pnpm lint:baseline:update`。');
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`[lint] 通过：0 error，${total} 条存量 warning 均在基线内`);
if (improvements.length > 0) {
  const fewer = improvements.reduce((s, g) => s + (g.allowed - g.actual), 0);
  console.log(`[lint] 存量已减少 ${fewer} 条，建议运行 \`pnpm lint:baseline:update\` 收紧基线`);
}
