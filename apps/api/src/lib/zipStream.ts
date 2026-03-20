/**
 * zipStream.ts
 * 纯 JS ZIP 生成器（STORE 模式，无压缩）
 *
 * 设计说明：
 *   - 运行在 Cloudflare Workers，不依赖任何 npm 包
 *   - 使用 ZIP STORE（方法=0），跳过压缩，适合已压缩格式（视频/图片）
 *   - 支持流式生成：逐文件累积 ArrayBuffer，最终拼接为完整 ZIP
 *   - 文件名使用 UTF-8 编码，设置 Language Encoding Flag（Bit 11）
 *   - 不支持 ZIP64（单文件 < 4GB，总大小 < 4GB，文件数 < 65535）
 *
 * 用法：
 *   const zip = new ZipBuilder();
 *   zip.addFile('hello.txt', new TextEncoder().encode('hello'));
 *   zip.addFile('img/photo.jpg', jpgBytes);
 *   return new Response(zip.finalize(), { headers: { 'Content-Type': 'application/zip' } });
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

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: Uint8Array; // UTF-8 encoded
  data: Uint8Array;
  crc: number;
  localHeaderOffset: number;
  dosDateTime: number; // packed DOS date+time (low 16 = time, high 16 = date)
}

/** 将 JS Date 打包为 DOS date/time 格式（uint32 LE，高16=date，低16=time） */
function dosDateTime(date: Date): number {
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const t = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return ((d & 0xffff) << 16) | (t & 0xffff);
}

export class ZipBuilder {
  private entries: ZipEntry[] = [];
  private offset = 0;
  private chunks: Uint8Array[] = [];

  /**
   * 向 ZIP 中添加一个文件。
   * @param path    ZIP 内路径（可含子目录，用 / 分隔）
   * @param data    文件字节内容
   * @param modDate 最后修改时间（默认 now）
   */
  addFile(path: string, data: Uint8Array | ArrayBuffer, modDate?: Date): void {
    const fileData = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const nameBytes = new TextEncoder().encode(path);
    const crc = crc32(fileData);
    const dt = dosDateTime(modDate ?? new Date());

    const localHeaderOffset = this.offset;

    // ── Local File Header（30 + name length bytes）─────────────────────
    // Signature 4 + version 2 + flags 2 + method 2 + mod time 2 + mod date 2
    // + crc 4 + compressed 4 + uncompressed 4 + name len 2 + extra len 2
    const lhSize = 30 + nameBytes.length;
    const lh = new Uint8Array(lhSize);
    const lhv = new DataView(lh.buffer);
    u32(lhv, 0, 0x04034b50); // local file header signature
    u16(lhv, 4, 20); // version needed: 2.0
    u16(lhv, 6, 0x0800); // general purpose flags: UTF-8 (bit 11)
    u16(lhv, 8, 0); // compression method: STORE
    u16(lhv, 10, dt & 0xffff); // last mod time
    u16(lhv, 12, (dt >>> 16) & 0xffff); // last mod date
    u32(lhv, 14, crc); // crc-32
    u32(lhv, 18, fileData.length); // compressed size
    u32(lhv, 22, fileData.length); // uncompressed size
    u16(lhv, 26, nameBytes.length); // file name length
    u16(lhv, 28, 0); // extra field length
    lh.set(nameBytes, 30);

    this.chunks.push(lh);
    this.chunks.push(fileData);
    this.offset += lhSize + fileData.length;

    this.entries.push({
      name: nameBytes,
      data: fileData,
      crc,
      localHeaderOffset,
      dosDateTime: dt,
    });
  }

  /**
   * 完成 ZIP：追加中央目录记录 + End of Central Directory，返回完整字节。
   */
  finalize(): Uint8Array {
    const cdStart = this.offset;
    let cdSize = 0;

    // ── Central Directory Records ──────────────────────────────────────
    for (const entry of this.entries) {
      const cdRecSize = 46 + entry.name.length;
      const cd = new Uint8Array(cdRecSize);
      const cdv = new DataView(cd.buffer);
      u32(cdv, 0, 0x02014b50); // central dir signature
      u16(cdv, 4, 20); // version made by
      u16(cdv, 6, 20); // version needed
      u16(cdv, 8, 0x0800); // general purpose flags: UTF-8
      u16(cdv, 10, 0); // compression: STORE
      u16(cdv, 12, entry.dosDateTime & 0xffff); // last mod time
      u16(cdv, 14, (entry.dosDateTime >>> 16) & 0xffff); // last mod date
      u32(cdv, 16, entry.crc); // crc-32
      u32(cdv, 20, entry.data.length); // compressed size
      u32(cdv, 24, entry.data.length); // uncompressed size
      u16(cdv, 28, entry.name.length); // file name length
      u16(cdv, 30, 0); // extra field length
      u16(cdv, 32, 0); // file comment length
      u16(cdv, 34, 0); // disk number start
      u16(cdv, 36, 0); // internal attributes
      u32(cdv, 38, 0); // external attributes
      u32(cdv, 42, entry.localHeaderOffset); // relative offset of local header
      cd.set(entry.name, 46);

      this.chunks.push(cd);
      cdSize += cdRecSize;
    }

    // ── End of Central Directory Record（22 bytes）──────────────────────
    const eocd = new Uint8Array(22);
    const eocdv = new DataView(eocd.buffer);
    u32(eocdv, 0, 0x06054b50); // end of central dir signature
    u16(eocdv, 4, 0); // disk number
    u16(eocdv, 6, 0); // disk with central dir
    u16(eocdv, 8, this.entries.length); // entries on this disk
    u16(eocdv, 10, this.entries.length); // total entries
    u32(eocdv, 12, cdSize); // central dir size
    u32(eocdv, 16, cdStart); // central dir offset
    u16(eocdv, 20, 0); // comment length

    this.chunks.push(eocd);

    // 拼接所有 chunks
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, pos);
      pos += chunk.length;
    }
    return out;
  }
}
