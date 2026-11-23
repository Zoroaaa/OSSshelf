/**
 * audit-gate.mjs — 依赖安全门禁
 *
 * 职责：CI 部署前拦截生产依赖（--prod）中的 high/critical 通告。
 * 约束：
 *   - 豁免清单 scripts/audit-exemptions.json 必须带「跟进阶段 + 原因」，
 *     每项豁免都要有明确的消除时间点（对应 docs/plans 升级方案）。
 *   - 门禁只看 high/critical；moderate/low 进周报不阻塞。
 *   - pnpm audit 无法区分「构建链依赖」与「运行时 bundle 依赖」，
 *     因此豁免以 module_name 为粒度，人工判定后维护。
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXEMPT_FILE = path.join(root, 'scripts', 'audit-exemptions.json');

const exemptions = JSON.parse(readFileSync(EXEMPT_FILE, 'utf8'));

let raw;
try {
  raw = execSync('pnpm audit --prod --json', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  // pnpm audit 在存在通告时以非零码退出，但 JSON 仍输出在 stdout
  raw = e.stdout ?? '';
  if (!raw.trim()) {
    console.error('[audit-gate] pnpm audit 无输出，网络或 registry 异常，人工排查');
    process.exit(1);
  }
}

const report = JSON.parse(raw);
const advisories = Object.values(report.advisories ?? {});
const meta = report.metadata?.vulnerabilities ?? {};
console.log(`[audit-gate] prod 通告：critical=${meta.critical} high=${meta.high} moderate=${meta.moderate} low=${meta.low}`);

const blocking = [];
const exempted = [];
for (const adv of advisories) {
  if (adv.severity !== 'high' && adv.severity !== 'critical') continue;
  const rule = exemptions[adv.module_name];
  if (rule) {
    exempted.push({ name: adv.module_name, severity: adv.severity, reason: rule.reason, followUp: rule.followUp });
  } else {
    blocking.push({ name: adv.module_name, severity: adv.severity, versions: adv.vulnerable_versions, patched: adv.patched_versions, title: adv.title });
  }
}

if (exempted.length) {
  console.log('[audit-gate] 豁免项（须按 followUp 消除）：');
  for (const e of exempted) console.log(`  - [${e.severity}] ${e.name} → ${e.reason}（跟进：${e.followUp}）`);
}

if (blocking.length) {
  console.error('[audit-gate] 存在未豁免的高危通告，禁止部署：');
  for (const b of blocking) {
    console.error(`  - [${b.severity}] ${b.name}（受影响 ${b.versions}，修复 ${b.patched}）：${b.title}`);
  }
  process.exit(1);
}

console.log('[audit-gate] 通过：生产依赖无未豁免的 high/critical 通告');
