import { describe, it, expect } from 'vitest';
import { createZipStream, assertZipLimits, ZIP_MAX_ENTRIES, type ZipEntrySource } from './zipStream';

const encoder = new TextEncoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ParsedEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  size: number;
}

/** 解析 STORE + data descriptor 的 ZIP，验证结构与内容 */
function parseZip(bytes: Uint8Array): ParsedEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: ParsedEntry[] = [];
  let pos = 0;

  while (view.getUint32(pos, true) === 0x04034b50) {
    expect(view.getUint16(pos + 6, true)).toBe(0x0808); // UTF-8 + data descriptor
    expect(view.getUint16(pos + 8, true)).toBe(0); // STORE
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    const dataStart = pos + 30 + nameLen + extraLen;

    // data descriptor 在本实现中紧跟数据（尺寸已知需要扫描签名）
    const ddPos = findDescriptor(bytes, view, dataStart);
    const data = bytes.subarray(dataStart, ddPos);
    expect(view.getUint32(ddPos, true)).toBe(0x08074b50);
    const crc = view.getUint32(ddPos + 4, true);
    const compressedSize = view.getUint32(ddPos + 8, true);
    const uncompressedSize = view.getUint32(ddPos + 12, true);
    expect(compressedSize).toBe(data.length);
    expect(uncompressedSize).toBe(data.length);

    entries.push({ name, data, crc, size: data.length });
    pos = ddPos + 16;
  }

  expect(view.getUint32(pos, true)).toBe(0x02014b50); // central dir start
  return entries;
}

function findDescriptor(bytes: Uint8Array, view: DataView, from: number): number {
  // 本测试数据量很小，逐字节寻找 descriptor 签名即可
  for (let i = from; i + 16 <= bytes.length; i++) {
    if (view.getUint32(i, true) === 0x08074b50) {
      const crc = view.getUint32(i + 4, true);
      if (crc32(bytes.subarray(from, i)) === crc) return i;
    }
  }
  throw new Error('data descriptor not found');
}

describe('zipStream', () => {
  it('生成 STORE + data descriptor 的合法 ZIP 并保留 UTF-8 文件名', async () => {
    const sources: ZipEntrySource[] = [
      { name: 'a.txt', size: 5, open: async () => streamOf('hello') },
      { name: 'dir/中文.txt', size: 6, open: async () => streamOf('世界', '!!') },
    ];

    const entries = parseZip(await collect(createZipStream(sources)));
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'dir/中文.txt']);

    const hello = encoder.encode('hello');
    expect(Array.from(entries[0].data)).toEqual(Array.from(hello));
    expect(entries[0].crc).toBe(crc32(hello));

    const world = encoder.encode('世界!!');
    expect(Array.from(entries[1].data)).toEqual(Array.from(world));
    expect(entries[1].crc).toBe(crc32(world));
  });

  it('跳过不可读的条目而不破坏 ZIP 结构', async () => {
    const sources: ZipEntrySource[] = [
      { name: 'missing.txt', size: 1, open: async () => null },
      { name: 'broken.txt', size: 1, open: async () => { throw new Error('boom'); } },
      { name: 'ok.txt', size: 2, open: async () => streamOf('ok') },
    ];

    const entries = parseZip(await collect(createZipStream(sources)));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('ok.txt');
  });

  it('入口限额：条目数与总大小', () => {
    expect(() => assertZipLimits(new Array(ZIP_MAX_ENTRIES + 1).fill({ size: 0 }))).toThrow(/65535/);
    expect(() => assertZipLimits([{ size: 5 * 1024 ** 3 }])).toThrow(/4GB/);
    expect(() => assertZipLimits([{ size: 1 }, { size: 2 }])).not.toThrow();
  });
});
