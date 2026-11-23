import { describe, it, expect } from 'vitest';
import { diffStorageMaps } from './storageReconciliation';

describe('diffStorageMaps', () => {
  it('记录值与实际值一致时无差异', () => {
    const result = diffStorageMaps(new Map([['u1', 100]]), new Map([['u1', 100]]));
    expect(result.withDiff).toBe(0);
    expect(result.totalDiff).toBe(0);
    expect(result.samples).toEqual([]);
  });

  it('识别正负差异并汇总', () => {
    const result = diffStorageMaps(
      new Map([
        ['u1', 120],
        ['u2', 50],
      ]),
      new Map([
        ['u1', 100],
        ['u2', 80],
      ])
    );
    expect(result.withDiff).toBe(2);
    expect(result.totalDiff).toBe(-10);
    expect(result.samples.map((s) => s.id).sort()).toEqual(['u1', 'u2']);
  });

  it('只在一侧出现的 id 视为 0 对比', () => {
    const result = diffStorageMaps(new Map([['only-recorded', 10]]), new Map([['only-actual', 7]]));
    expect(result.withDiff).toBe(2);
    expect(result.totalDiff).toBe(3);
  });

  it('差异样本按绝对值降序，最多 50 条', () => {
    const recorded = new Map<string, number>();
    const actual = new Map<string, number>();
    for (let i = 1; i <= 60; i++) {
      recorded.set(`u${i}`, 100 + i);
      actual.set(`u${i}`, 100);
    }
    const result = diffStorageMaps(recorded, actual);
    expect(result.withDiff).toBe(60);
    expect(result.samples).toHaveLength(50);
    expect(result.samples[0].id).toBe('u60');
  });
});

import { hasReconciliationDrift, formatDriftAlert, type ReconciliationReport } from './storageReconciliation';

function cleanReport(): ReconciliationReport {
  return {
    generatedAt: '2026-11-23T03:00:00.000Z',
    users: { checked: 3, withDiff: 0, totalDiffBytes: 0, samples: [] },
    buckets: { checked: 2, withDiff: 0, totalDiffBytes: 0, totalDiffCount: 0, samples: [] },
    unassigned: { files: 0, bytes: 0 },
    dedup: { sharedGroups: 4, crossBucketGroups: 0 },
    path: { mismatch: 0, unreachable: 0 },
  };
}

describe('hasReconciliationDrift', () => {
  it('全部一致（含正常的同桶去重共享）不算偏差', () => {
    expect(hasReconciliationDrift(cleanReport())).toBe(false);
  });

  it.each([
    ['用户记账', (r: ReconciliationReport) => (r.users.withDiff = 1)],
    ['桶记账', (r: ReconciliationReport) => (r.buckets.withDiff = 1)],
    ['路径不一致', (r: ReconciliationReport) => (r.path.mismatch = 1)],
    ['路径不可达', (r: ReconciliationReport) => (r.path.unreachable = 1)],
    ['跨桶共享', (r: ReconciliationReport) => (r.dedup.crossBucketGroups = 1)],
  ])('%s 出现偏差即判定为漂移', (_name, mutate) => {
    const r = cleanReport();
    mutate(r);
    expect(hasReconciliationDrift(r)).toBe(true);
  });
});

describe('formatDriftAlert', () => {
  it('包含各类计数与前 3 条样本', () => {
    const r = cleanReport();
    r.users = {
      checked: 3,
      withDiff: 5,
      totalDiffBytes: 1234,
      samples: Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, recorded: 10 + i, actual: 10, diff: i })),
    };
    const msg = formatDriftAlert(r, '2026-11-23T03:00:00.000Z');
    expect(msg).toContain('用户记账偏差：5');
    expect(msg).toContain('u0');
    expect(msg).toContain('u2');
    expect(msg).not.toContain('u3');
  });
});
