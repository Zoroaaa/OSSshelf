/**
 * zipStream.ts
 * 纯 JS ZIP 生成器（STORE 模式，无压缩，真流式）
 *
 * 设计说明：
 *   - 运行在 Cloudflare Workers，不依赖任何 npm 包
 *   - 使用 ZIP STORE（方法=0），跳过压缩，适合已压缩格式（视频/图片）
 *   - 逐文件边读边写：文件内容不进入 Worker 内存，仅按 chunk 透传
 *   - 使用 data descriptor（通用标志位 bit 3）：CRC/大小写在数据之后，
 *     因此无需先读完文件即可发送 local header
 *   - 文件名使用 UTF-8 编码，设置 Language Encoding Flag（Bit 11）
 *   - 不支持 ZIP64：总大小必须 < 4GiB、文件数 < 65535，超限在入口拒绝
 *
 * 用法：
 *   const stream = createZipStream([
 *     { name: 'a.txt', size: 10, open: () => Promise<ReadableStream | null> },
 *   ]);
 *   return new Response(stream, { headers: { 'Content-Type': 'application/zip' } });
 */

/** 写入小端 uint16 */
function u16(buf: DataView, offset: number, val: number) {
  buf.setUint16(offset, val, true);
}

/** 写入小端 uint32 */
function u32(buf: DataView, offset: number, val: number) {
  buf.setUint32(offset, val, true);
}

/** CRC-32 查找表（IEEE 多项式 0xEDB88320） */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c;
  }
  return t;
})();

/** 增量计算 CRC-32（传入上一次的中间值，初始为 0xffffffff） */
function crc32Update(crc: number, data: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < data.length; i++) {
    c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return c;
}

function crc32Final(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

/** 将 JS Date 打包为 DOS date/time 格式（uint32 LE，高16=date，低16=time） */
function dosDateTime(date: Date): number {
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const t = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return ((d & 0xffff) << 16) | (t & 0xffff);
}

/** ZIP 入口上限（ZIP32 约束） */
export const ZIP_MAX_ENTRIES = 65535;
export const ZIP_MAX_TOTAL_BYTES = 0xffffffff - 1024 * 1024;

export interface ZipEntrySource {
  /** ZIP 内路径（可含子目录，用 / 分隔） */
  name: string;
  /** 原始大小（用于入口限额校验，不参与生成逻辑） */
  size: number;
  /** 最后修改时间（默认 now） */
  modDate?: Date;
  /** 打开内容流；返回 null 表示该文件不可读，将被跳过 */
  open: () => Promise<ReadableStream<Uint8Array> | null>;
}

interface EntryMeta {
  nameBytes: Uint8Array;
  crc: number; // 增量 CRC 中间值
  size: number;
  localHeaderOffset: number;
  dosDateTime: number;
}

function buildLocalHeader(meta: EntryMeta): Uint8Array {
  const lhSize = 30 + meta.nameBytes.length;
  const lh = new Uint8Array(lhSize);
  const v = new DataView(lh.buffer);
  u32(v, 0, 0x04034b50); // local file header signature
  u16(v, 4, 20); // version needed: 2.0
  u16(v, 6, 0x0808); // flags: UTF-8 (bit 11) + data descriptor (bit 3)
  u16(v, 8, 0); // compression method: STORE
  u16(v, 10, meta.dosDateTime & 0xffff); // last mod time
  u16(v, 12, (meta.dosDateTime >>> 16) & 0xffff); // last mod date
  u32(v, 14, 0); // crc-32: 写入 data descriptor
  u32(v, 18, 0); // compressed size: 写入 data descriptor
  u32(v, 22, 0); // uncompressed size: 写入 data descriptor
  u16(v, 26, meta.nameBytes.length);
  u16(v, 28, 0); // extra field length
  lh.set(meta.nameBytes, 30);
  return lh;
}

function buildDataDescriptor(meta: EntryMeta): Uint8Array {
  const dd = new Uint8Array(16);
  const v = new DataView(dd.buffer);
  u32(v, 0, 0x08074b50); // data descriptor signature
  u32(v, 4, crc32Final(meta.crc));
  u32(v, 8, meta.size);
  u32(v, 12, meta.size);
  return dd;
}

function buildCentralRecord(meta: EntryMeta): Uint8Array {
  const recSize = 46 + meta.nameBytes.length;
  const cd = new Uint8Array(recSize);
  const v = new DataView(cd.buffer);
  u32(v, 0, 0x02014b50); // central dir signature
  u16(v, 4, 20); // version made by
  u16(v, 6, 20); // version needed
  u16(v, 8, 0x0808); // flags: UTF-8 + data descriptor
  u16(v, 10, 0); // compression: STORE
  u16(v, 12, meta.dosDateTime & 0xffff);
  u16(v, 14, (meta.dosDateTime >>> 16) & 0xffff);
  u32(v, 16, crc32Final(meta.crc));
  u32(v, 20, meta.size);
  u32(v, 24, meta.size);
  u16(v, 28, meta.nameBytes.length);
  u16(v, 30, 0); // extra field length
  u16(v, 32, 0); // file comment length
  u16(v, 34, 0); // disk number start
  u16(v, 36, 0); // internal attributes
  u32(v, 38, 0); // external attributes
  u32(v, 42, meta.localHeaderOffset);
  cd.set(meta.nameBytes, 46);
  return cd;
}

function buildEocd(entryCount: number, cdSize: number, cdStart: number): Uint8Array {
  const eocd = new Uint8Array(22);
  const v = new DataView(eocd.buffer);
  u32(v, 0, 0x06054b50);
  u16(v, 4, 0); // disk number
  u16(v, 6, 0); // disk with central dir
  u16(v, 8, entryCount);
  u16(v, 10, entryCount);
  u32(v, 12, cdSize);
  u32(v, 16, cdStart);
  u16(v, 20, 0); // comment length
  return eocd;
}

/** 入口限额校验；超限抛出 Error，由路由转换为 4xx */
export function assertZipLimits(entries: Array<{ size: number }>): void {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`ZIP 打包最多 ${ZIP_MAX_ENTRIES} 个文件，当前 ${entries.length} 个`);
  }
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (total > ZIP_MAX_TOTAL_BYTES) {
    throw new Error(`ZIP 总大小不能超过 4GB，当前 ${(total / 1024 / 1024).toFixed(0)}MB`);
  }
}

type Phase = 'header' | 'data' | 'descriptor' | 'central' | 'done';

/**
 * 流式生成 ZIP。拉取（pull）驱动，仅在有消费者需求时读取下一个 chunk，
 * 避免把整个 ZIP 缓冲进 Worker 内存。
 */
export function createZipStream(sources: ZipEntrySource[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  let phase: Phase = 'header';
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let meta: EntryMeta | null = null;
  let offset = 0;
  const entries: EntryMeta[] = [];

  let centralIndex = 0;
  let centralSize = 0;
  let centralStart = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          if (phase === 'header') {
            if (index >= sources.length) {
              phase = 'central';
              continue;
            }
            const source = sources[index++];
            let stream: ReadableStream<Uint8Array> | null = null;
            try {
              stream = await source.open();
            } catch {
              stream = null;
            }
            if (!stream) continue; // 单个文件不可读时跳过，不影响整体打包

            const nextMeta: EntryMeta = {
              nameBytes: encoder.encode(source.name),
              crc: 0xffffffff,
              size: 0,
              localHeaderOffset: offset,
              dosDateTime: dosDateTime(source.modDate ?? new Date()),
            };
            meta = nextMeta;
            reader = stream.getReader();

            const header = buildLocalHeader(nextMeta);
            offset += header.length;
            phase = 'data';
            controller.enqueue(header);
            return;
          }

          if (phase === 'data') {
            const { done, value } = await reader!.read();
            if (done) {
              reader!.releaseLock();
              reader = null;
              phase = 'descriptor';
              continue;
            }
            if (!value || value.length === 0) continue;

            meta!.crc = crc32Update(meta!.crc, value);
            meta!.size += value.length;
            offset += value.length;
            if (offset > ZIP_MAX_TOTAL_BYTES) {
              controller.error(new Error('ZIP 超过 4GB 上限'));
              return;
            }
            controller.enqueue(value);
            return;
          }

          if (phase === 'descriptor') {
            const descriptor = buildDataDescriptor(meta!);
            offset += descriptor.length;
            entries.push(meta!);
            meta = null;
            phase = 'header';
            controller.enqueue(descriptor);
            return;
          }

          if (phase === 'central') {
            if (centralIndex === 0) centralStart = offset;
            if (centralIndex < entries.length) {
              const record = buildCentralRecord(entries[centralIndex++]);
              centralSize += record.length;
              offset += record.length;
              controller.enqueue(record);
              return;
            }
            const eocd = buildEocd(entries.length, centralSize, centralStart);
            phase = 'done';
            controller.enqueue(eocd);
            return;
          }

          controller.close();
          return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      reader?.cancel(reason).catch(() => undefined);
    },
  });
}
