/**
 * lint 基线冻结的纯逻辑（无 I/O，便于测试）。
 *
 * 基线 = 「文件 × 规则」维度的问题数量，不记录行号（改动代码导致行号漂移不会误报）。
 * 门禁规则：
 *   1. 任何 error 一律失败（基线只允许冻结 warning，不允许冻结 error）；
 *   2. 某 (文件, 规则) 的数量超过基线 → 失败（含基线里没有的新文件/新规则）；
 *   3. 低于基线 → 通过，并提示收紧基线（棘轮：存量只许减少）。
 */

export function summarize(eslintResults, root) {
  const counts = {};
  const errors = [];
  for (const file of eslintResults) {
    const rel = file.filePath.startsWith(root) ? file.filePath.slice(root.length).replace(/^[\\/]/, '') : file.filePath;
    const relPosix = rel.split('\\').join('/');
    for (const m of file.messages) {
      const rule = m.ruleId ?? (m.fatal ? 'parse-error' : 'unused-disable-directive');
      if (m.severity === 2) errors.push({ file: relPosix, line: m.line, rule, message: m.message });
      const key = `${relPosix}::${rule}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return { counts, errors };
}

export function compare(current, baseline) {
  const regressions = [];
  const improvements = [];
  for (const [key, n] of Object.entries(current)) {
    const allowed = baseline[key] ?? 0;
    if (n > allowed) regressions.push({ key, allowed, actual: n });
  }
  for (const [key, allowed] of Object.entries(baseline)) {
    const n = current[key] ?? 0;
    if (n < allowed) improvements.push({ key, allowed, actual: n });
  }
  return { regressions, improvements };
}

export function sortedObject(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
