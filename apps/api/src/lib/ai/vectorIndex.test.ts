import { describe, expect, it } from 'vitest';
import { buildChunkVectorId, splitTextIntoChunks } from './vectorIndex';

describe('vector chunking', () => {
  it('keeps short text as a single chunk', () => {
    expect(splitTextIntoChunks('hello world')).toEqual(['hello world']);
  });

  it('splits long text with overlap', () => {
    const text = 'a'.repeat(4500);
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
  });

  it('caps the number of chunks', () => {
    const text = 'b'.repeat(100_000);
    expect(splitTextIntoChunks(text).length).toBeLessThanOrEqual(20);
  });

  it('builds stable chunk vector ids', () => {
    expect(buildChunkVectorId('file-1', 3)).toBe('file-1:3');
  });
});
