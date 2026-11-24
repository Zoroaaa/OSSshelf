import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, compare } from './lint-baseline-lib.mjs';

const R = '/repo';
const res = (file, msgs) => ({ filePath: `${R}/${file}`, messages: msgs });
const w = (ruleId, line = 1) => ({ ruleId, severity: 1, line, message: 'm' });

test('summarize：按 文件×规则 计数，路径相对化，无 ruleId 归为 unused-disable-directive', () => {
  const { counts, errors } = summarize(
    [res('a.ts', [w('x'), w('x', 9), { ruleId: null, severity: 1, line: 3, message: 'u' }]), res('b.ts', [])],
    R
  );
  assert.deepEqual(counts, { 'a.ts::x': 2, 'a.ts::unused-disable-directive': 1 });
  assert.equal(errors.length, 0);
});

test('summarize：收集 error（severity 2）', () => {
  const { errors } = summarize([res('a.ts', [{ ruleId: 'r', severity: 2, line: 5, message: 'bad' }])], R);
  assert.deepEqual(errors, [{ file: 'a.ts', line: 5, rule: 'r', message: 'bad' }]);
});

test('compare：新文件/新规则/数量增长均为回归；持平与减少不是', () => {
  const baseline = { 'a.ts::x': 2, 'b.ts::y': 3 };
  const { regressions, improvements } = compare(
    { 'a.ts::x': 3, 'b.ts::y': 1, 'c.ts::z': 1 },
    baseline
  );
  assert.deepEqual(regressions.map((g) => g.key).sort(), ['a.ts::x', 'c.ts::z']);
  assert.deepEqual(improvements, [{ key: 'b.ts::y', allowed: 3, actual: 1 }]);
});

test('compare：问题全部消失时视为改进而非回归', () => {
  const { regressions, improvements } = compare({}, { 'a.ts::x': 2 });
  assert.equal(regressions.length, 0);
  assert.equal(improvements.length, 1);
});
