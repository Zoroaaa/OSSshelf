import { describe, it, expect, vi, afterEach } from 'vitest';
import { clearClientCaches } from './clearClientCaches';

describe('clearClientCaches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('删除全部 Cache Storage 条目', async () => {
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['a', 'b']), delete: del });
    await clearClientCaches();
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith('a');
    expect(del).toHaveBeenCalledWith('b');
  });

  it('caches API 抛错时不向外抛出（不阻塞登出）', async () => {
    vi.stubGlobal('caches', {
      keys: vi.fn().mockRejectedValue(new Error('boom')),
      delete: vi.fn(),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(clearClientCaches()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
