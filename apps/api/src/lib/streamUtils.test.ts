import { describe, it, expect } from 'vitest';
import { sliceReadableStream } from './streamUtils';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe('sliceReadableStream', () => {
  it('跨 chunk 截取闭区间', async () => {
    const result = await readAll(sliceReadableStream(streamOf('abc', 'def', 'ghi'), 2, 6));
    expect(result).toBe('cdefg');
  });

  it('起点在前、终点跨 chunk', async () => {
    const result = await readAll(sliceReadableStream(streamOf('01234', '56789'), 1, 7));
    expect(result).toBe('1234567');
  });

  it('终点超出流长度时截到末尾', async () => {
    const result = await readAll(sliceReadableStream(streamOf('abc', 'def'), 4, 99));
    expect(result).toBe('ef');
  });

  it('起点超出流长度返回空', async () => {
    const result = await readAll(sliceReadableStream(streamOf('abc'), 10, 20));
    expect(result).toBe('');
  });

  it('单字节区间', async () => {
    const result = await readAll(sliceReadableStream(streamOf('abcdef'), 3, 3));
    expect(result).toBe('d');
  });
});
