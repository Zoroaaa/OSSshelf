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
