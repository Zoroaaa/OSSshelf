import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 契约测试：分享接口读取根文件/根文件夹时，必须同时带上 `isNull(files.deletedAt)`。
 * 否则用户把文件移入回收站（软删除）后，已发出的分享链接仍能下载内容。
 *
 * 这里的实现方式是对源码做静态断言：share.ts 里每一处
 * `eq(files.id, share.fileId)` 都必须与 `isNull(files.deletedAt)` 出现在同一个 where 表达式中。
 */
const shareSrc = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'share.ts'), 'utf8');

describe('分享接口的软删除过滤', () => {
  it('每处按分享根文件查询都过滤了 deleted_at', () => {
    const lines = shareSrc.split('\n');
    const offenders: number[] = [];

    lines.forEach((line, index) => {
      if (line.includes('eq(files.id, share.fileId)') && !line.includes('isNull(files.deletedAt)')) {
        offenders.push(index + 1);
      }
    });

    expect(offenders, `share.ts 第 ${offenders.join(', ')} 行缺少 isNull(files.deletedAt)`).toEqual([]);
  });
});
